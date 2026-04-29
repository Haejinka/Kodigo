-- Migration 18: Production-readiness hardening for POS, inventory, and access control

-- 1. Persist the product fields already collected by the UI.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS purchase_unit text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS conversion_factor integer NOT NULL DEFAULT 1;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url text;

UPDATE public.products
SET conversion_factor = 1
WHERE conversion_factor IS NULL OR conversion_factor < 1;

ALTER TABLE public.products ALTER COLUMN conversion_factor SET DEFAULT 1;
ALTER TABLE public.products ALTER COLUMN conversion_factor SET NOT NULL;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_conversion_factor_positive;
ALTER TABLE public.products
ADD CONSTRAINT products_conversion_factor_positive CHECK (conversion_factor >= 1);

-- 2. Ensure multistore columns exist for deployments created from the canonical schema file.
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores (id) ON DELETE CASCADE;
UPDATE public.sales SET store_id = (SELECT id FROM public.stores LIMIT 1) WHERE store_id IS NULL;
ALTER TABLE public.sales ALTER COLUMN store_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS sales_store_created_idx ON public.sales (store_id, created_at DESC);

ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores (id) ON DELETE CASCADE;
UPDATE public.stock_adjustments SET store_id = (SELECT id FROM public.stores LIMIT 1) WHERE store_id IS NULL;
ALTER TABLE public.stock_adjustments ALTER COLUMN store_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS stock_adj_store_created_idx ON public.stock_adjustments (store_id, created_at DESC);

-- 3. Reject oversells instead of silently clamping stock to zero.
CREATE OR REPLACE FUNCTION public.trg_deduct_stock_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_store uuid;
  v_product_store uuid;
  v_current_stock integer;
BEGIN
  IF NEW.product_id IS NULL THEN
    RAISE EXCEPTION 'Sale item must reference a product';
  END IF;

  SELECT store_id
  INTO v_sale_store
  FROM public.sales
  WHERE id = NEW.sale_id;

  IF v_sale_store IS NULL THEN
    RAISE EXCEPTION 'Sale % does not exist', NEW.sale_id;
  END IF;

  SELECT store_id, current_stock
  INTO v_product_store, v_current_stock
  FROM public.products
  WHERE id = NEW.product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % does not exist', NEW.product_id;
  END IF;

  IF v_product_store <> v_sale_store THEN
    RAISE EXCEPTION 'Product % does not belong to sale store %', NEW.product_id, v_sale_store;
  END IF;

  IF v_current_stock < NEW.quantity THEN
    RAISE EXCEPTION 'Insufficient stock for product %. Available %, requested %',
      NEW.product_id, v_current_stock, NEW.quantity;
  END IF;

  UPDATE public.products
  SET current_stock = current_stock - NEW.quantity,
      updated_at = now()
  WHERE id = NEW.product_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deduct_stock_on_sale_trigger ON public.sale_items;
CREATE TRIGGER deduct_stock_on_sale_trigger
  AFTER INSERT ON public.sale_items
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_deduct_stock_on_sale();

-- 4. Process POS sales atomically from one RPC call.
CREATE OR REPLACE FUNCTION public.process_pos_sale(
  p_id uuid,
  p_store_id uuid,
  p_cashier_id uuid,
  p_subtotal numeric,
  p_tax numeric,
  p_discount numeric,
  p_total numeric,
  p_cash_received numeric,
  p_change numeric,
  p_items jsonb
)
RETURNS public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_role text;
  v_item jsonb;
  v_product public.products%ROWTYPE;
  v_product_id uuid;
  v_qty integer;
  v_subtotal numeric := 0;
  v_tax numeric := COALESCE(p_tax, 0);
  v_discount numeric := COALESCE(p_discount, 0);
  v_total numeric;
  v_change numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_cashier_id IS NOT NULL AND p_cashier_id <> auth.uid() THEN
    RAISE EXCEPTION 'Cashier id does not match authenticated user';
  END IF;

  SELECT role::text INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'cashier') THEN
    RAISE EXCEPTION 'Only store admins or cashiers can process sales';
  END IF;

  IF NOT public.user_belongs_to_store(p_store_id) THEN
    RAISE EXCEPTION 'User is not assigned to this store';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Sale must contain at least one item';
  END IF;

  FOR v_product_id, v_qty IN
    SELECT
      (value->>'productId')::uuid,
      SUM((value->>'quantity')::integer)::integer
    FROM jsonb_array_elements(p_items) AS line(value)
    GROUP BY (value->>'productId')::uuid
  LOOP
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Sale item quantity must be greater than zero';
    END IF;

    SELECT *
    INTO v_product
    FROM public.products
    WHERE id = v_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % does not exist', v_product_id;
    END IF;

    IF v_product.store_id <> p_store_id THEN
      RAISE EXCEPTION 'Product % does not belong to sale store %', v_product_id, p_store_id;
    END IF;

    IF v_product.current_stock < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for %. Available %, requested %',
        v_product.name, v_product.current_stock, v_qty;
    END IF;

    v_subtotal := v_subtotal + round(v_product.selling_price * v_qty, 2);
  END LOOP;

  IF v_tax < 0 OR v_discount < 0 OR COALESCE(p_cash_received, 0) < 0 THEN
    RAISE EXCEPTION 'Sale totals cannot be negative';
  END IF;

  v_total := round(v_subtotal + v_tax - v_discount, 2);
  IF v_total < 0 THEN
    RAISE EXCEPTION 'Discount cannot exceed subtotal plus tax';
  END IF;

  v_change := round(COALESCE(p_cash_received, 0) - v_total, 2);
  IF v_change < 0 THEN
    RAISE EXCEPTION 'Cash received is less than sale total';
  END IF;

  IF abs(COALESCE(p_subtotal, 0) - v_subtotal) > 0.01
    OR abs(COALESCE(p_total, 0) - v_total) > 0.01
    OR abs(COALESCE(p_change, 0) - v_change) > 0.01 THEN
    RAISE EXCEPTION 'Submitted sale totals do not match current product prices';
  END IF;

  INSERT INTO public.sales (
    id, store_id, cashier_id, subtotal, tax, discount, total, cash_received, change
  )
  VALUES (
    p_id, p_store_id, auth.uid(), v_subtotal, v_tax, v_discount, v_total, p_cash_received, v_change
  )
  RETURNING * INTO v_sale;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS line(value)
  LOOP
    v_product_id := (v_item->>'productId')::uuid;
    v_qty := (v_item->>'quantity')::integer;

    SELECT *
    INTO v_product
    FROM public.products
    WHERE id = v_product_id;

    INSERT INTO public.sale_items (
      sale_id, product_id, product_name, quantity, unit_price, line_total
    )
    VALUES (
      v_sale.id,
      v_product.id,
      v_product.name,
      v_qty,
      v_product.selling_price,
      round(v_product.selling_price * v_qty, 2)
    );
  END LOOP;

  RETURN v_sale;
END;
$$;

-- 5. Receive purchase orders atomically and replenish inventory with an audit trail.
CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_po_id uuid,
  p_on_time boolean
)
RETURNS public.purchase_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po public.purchase_orders%ROWTYPE;
  v_item record;
  v_before integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
  INTO v_po
  FROM public.purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order % does not exist', p_po_id;
  END IF;

  IF public.current_user_role()::text <> 'admin' THEN
    RAISE EXCEPTION 'Only store admins can receive purchase orders';
  END IF;

  IF NOT public.user_belongs_to_store(v_po.store_id) THEN
    RAISE EXCEPTION 'User is not assigned to this purchase order store';
  END IF;

  IF v_po.status <> 'sent' THEN
    RAISE EXCEPTION 'Only sent purchase orders can be received';
  END IF;

  FOR v_item IN
    SELECT product_id, product_name, quantity
    FROM public.purchase_order_items
    WHERE purchase_order_id = p_po_id
  LOOP
    SELECT current_stock
    INTO v_before
    FROM public.products
    WHERE id = v_item.product_id
      AND store_id = v_po.store_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % does not exist in purchase order store', v_item.product_id;
    END IF;

    UPDATE public.products
    SET current_stock = current_stock + v_item.quantity,
        updated_at = now()
    WHERE id = v_item.product_id;

    INSERT INTO public.stock_adjustments (
      store_id,
      product_id,
      reason,
      quantity_delta,
      stock_before,
      stock_after,
      note,
      created_by
    )
    VALUES (
      v_po.store_id,
      v_item.product_id,
      'restock'::public.adjustment_reason,
      v_item.quantity,
      v_before,
      v_before + v_item.quantity,
      'Received purchase order ' || p_po_id::text,
      auth.uid()
    );
  END LOOP;

  UPDATE public.purchase_orders
  SET status = 'received',
      on_time = p_on_time,
      received_at = now(),
      updated_at = now()
  WHERE id = p_po_id
  RETURNING * INTO v_po;

  RETURN v_po;
END;
$$;

REVOKE ALL ON FUNCTION public.process_pos_sale(uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_pos_sale(uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.receive_purchase_order(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, boolean) TO authenticated;

-- 6. Replace broad/direct sales policies with store-scoped policies.
DROP POLICY IF EXISTS "sales: authenticated read" ON public.sales;
DROP POLICY IF EXISTS "sales: authenticated insert" ON public.sales;
DROP POLICY IF EXISTS "sales: admin delete" ON public.sales;
DROP POLICY IF EXISTS "sales: scoped read" ON public.sales;
DROP POLICY IF EXISTS "sales: scoped insert" ON public.sales;
DROP POLICY IF EXISTS "sales: scoped delete" ON public.sales;
DROP POLICY IF EXISTS "sales: admin delete cascade-safe" ON public.sales;

CREATE POLICY "sales: scoped read" ON public.sales
FOR SELECT TO authenticated
USING (public.user_belongs_to_store(store_id));

CREATE POLICY "sales: scoped insert" ON public.sales
FOR INSERT TO authenticated
WITH CHECK (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text IN ('admin', 'cashier')
  AND cashier_id = auth.uid()
);

CREATE POLICY "sales: scoped delete" ON public.sales
FOR DELETE TO authenticated
USING (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text = 'admin'
);

DROP POLICY IF EXISTS "sale_items: authenticated read" ON public.sale_items;
DROP POLICY IF EXISTS "sale_items: authenticated insert" ON public.sale_items;
DROP POLICY IF EXISTS "sale_items: scoped read" ON public.sale_items;
DROP POLICY IF EXISTS "sale_items: scoped insert" ON public.sale_items;

CREATE POLICY "sale_items: scoped read" ON public.sale_items
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.sales s
    WHERE s.id = sale_items.sale_id
      AND public.user_belongs_to_store(s.store_id)
  )
);

CREATE POLICY "sale_items: scoped insert" ON public.sale_items
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.sales s
    WHERE s.id = sale_items.sale_id
      AND public.user_belongs_to_store(s.store_id)
  )
);

-- 7. Harden invite codes and profile updates.
DROP POLICY IF EXISTS "Public can read invite codes" ON public.invite_codes;
DROP POLICY IF EXISTS "Super admins can manage invite codes" ON public.invite_codes;
DROP POLICY IF EXISTS "Super admins can manage own invite codes" ON public.invite_codes;

CREATE POLICY "Super admins can manage own invite codes"
ON public.invite_codes
FOR ALL TO authenticated
USING (
  public.current_user_role()::text = 'super_admin'
  AND (created_by = auth.uid() OR created_by IS NULL)
)
WITH CHECK (
  public.current_user_role()::text = 'super_admin'
  AND created_by = auth.uid()
);

DROP POLICY IF EXISTS "profiles: self or admin update" ON public.profiles;
DROP POLICY IF EXISTS "profiles: self update" ON public.profiles;
DROP POLICY IF EXISTS "profiles: admin update" ON public.profiles;

CREATE POLICY "profiles: self update"
ON public.profiles
FOR UPDATE TO authenticated
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid()
  AND role = public.current_user_role()
);

CREATE POLICY "profiles: admin update"
ON public.profiles
FOR UPDATE TO authenticated
USING (public.current_user_role()::text = 'admin')
WITH CHECK (
  public.current_user_role()::text = 'admin'
  AND role::text IN ('admin', 'cashier')
);

DROP POLICY IF EXISTS "Admins unmap users" ON public.store_users;
CREATE POLICY "Admins unmap users" ON public.store_users
FOR DELETE TO authenticated
USING (
  public.current_user_role()::text = 'admin'
  AND public.user_belongs_to_store(store_id)
);

-- 8. Pull back broad grants from anon. RLS remains the data boundary for authenticated users.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO authenticated;
