-- Migration 22: align deployed sale/reporting schema with selling-option reports.
-- This repairs environments where migration 20 only partially applied.

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS category_name text,
  ADD COLUMN IF NOT EXISTS selling_option_id uuid REFERENCES public.product_selling_options(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS selling_option_label text,
  ADD COLUMN IF NOT EXISTS unit_label text DEFAULT 'unit',
  ADD COLUMN IF NOT EXISTS package_size numeric(12,3),
  ADD COLUMN IF NOT EXISTS package_unit text,
  ADD COLUMN IF NOT EXISTS stock_source text DEFAULT 'product',
  ADD COLUMN IF NOT EXISTS cost_price numeric;

UPDATE public.sale_items si
SET
  category_name = COALESCE(si.category_name, c.name, 'Uncategorized'),
  selling_option_id = COALESCE(si.selling_option_id, pso.id),
  selling_option_label = COALESCE(si.selling_option_label, pso.label, p.unit, 'unit'),
  unit_label = COALESCE(si.unit_label, pso.unit_label, p.unit, 'unit'),
  package_size = COALESCE(si.package_size, pso.quantity_value),
  package_unit = COALESCE(si.package_unit, pso.quantity_unit),
  stock_source = COALESCE(si.stock_source, CASE WHEN pso.id IS NULL THEN 'product' ELSE 'selling_option' END),
  cost_price = COALESCE(si.cost_price, p.cost_price, 0)
FROM public.products p
LEFT JOIN public.categories c ON c.id = p.category_id
LEFT JOIN public.product_selling_options pso
  ON pso.product_id = p.id
  AND pso.is_default
  AND pso.is_active
WHERE p.id = si.product_id;

UPDATE public.sale_items
SET
  category_name = COALESCE(category_name, 'Uncategorized'),
  unit_label = COALESCE(unit_label, 'unit'),
  stock_source = COALESCE(stock_source, 'product'),
  cost_price = COALESCE(cost_price, 0);

ALTER TABLE public.sale_items
  ALTER COLUMN unit_label SET DEFAULT 'unit',
  ALTER COLUMN unit_label SET NOT NULL,
  ALTER COLUMN stock_source SET DEFAULT 'product',
  ALTER COLUMN stock_source SET NOT NULL,
  ALTER COLUMN cost_price SET DEFAULT 0;

CREATE INDEX IF NOT EXISTS sale_items_selling_option_idx
  ON public.sale_items(selling_option_id);

ALTER TABLE public.stock_adjustments DROP CONSTRAINT IF EXISTS stock_adjustments_quantity_delta_check;
ALTER TABLE public.stock_adjustments DROP CONSTRAINT IF EXISTS stock_adjustments_stock_before_check;
ALTER TABLE public.stock_adjustments DROP CONSTRAINT IF EXISTS stock_adjustments_stock_after_check;

ALTER TABLE public.stock_adjustments
  ALTER COLUMN quantity_delta TYPE numeric(12,3) USING quantity_delta::numeric,
  ALTER COLUMN stock_before TYPE numeric(12,3) USING stock_before::numeric,
  ALTER COLUMN stock_after TYPE numeric(12,3) USING stock_after::numeric,
  ADD COLUMN IF NOT EXISTS selling_option_id uuid REFERENCES public.product_selling_options(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS selling_option_label text,
  ADD COLUMN IF NOT EXISTS unit_label text,
  ADD COLUMN IF NOT EXISTS package_size numeric(12,3),
  ADD COLUMN IF NOT EXISTS package_unit text,
  ADD COLUMN IF NOT EXISTS stock_source text;

UPDATE public.stock_adjustments sa
SET
  selling_option_id = COALESCE(sa.selling_option_id, pso.id),
  selling_option_label = COALESCE(sa.selling_option_label, pso.label, p.unit, 'unit'),
  unit_label = COALESCE(sa.unit_label, pso.unit_label, p.unit, 'unit'),
  package_size = COALESCE(sa.package_size, pso.quantity_value),
  package_unit = COALESCE(sa.package_unit, pso.quantity_unit),
  stock_source = COALESCE(sa.stock_source, CASE WHEN pso.id IS NULL THEN 'product' ELSE 'selling_option' END)
FROM public.products p
LEFT JOIN public.product_selling_options pso
  ON pso.product_id = p.id
  AND pso.is_default
  AND pso.is_active
WHERE p.id = sa.product_id;

UPDATE public.stock_adjustments
SET
  unit_label = COALESCE(unit_label, 'unit'),
  stock_source = COALESCE(stock_source, 'product');

ALTER TABLE public.stock_adjustments
  ADD CONSTRAINT stock_adjustments_quantity_delta_check CHECK (quantity_delta <> 0),
  ADD CONSTRAINT stock_adjustments_stock_before_check CHECK (stock_before >= 0),
  ADD CONSTRAINT stock_adjustments_stock_after_check CHECK (stock_after >= 0);

CREATE INDEX IF NOT EXISTS stock_adjustments_selling_option_idx
  ON public.stock_adjustments(selling_option_id);

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  selling_option_id uuid REFERENCES public.product_selling_options(id) ON DELETE SET NULL,
  selling_option_label text,
  unit_label text NOT NULL,
  package_size numeric(12,3),
  package_unit text,
  movement_type text NOT NULL,
  quantity_delta numeric(12,3) NOT NULL CHECK (quantity_delta <> 0),
  stock_before numeric(12,3) NOT NULL CHECK (stock_before >= 0),
  stock_after numeric(12,3) NOT NULL CHECK (stock_after >= 0),
  stock_source text NOT NULL,
  reference_type text,
  reference_id uuid,
  note text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_movements_store_created_idx
  ON public.inventory_movements(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_movements_product_option_idx
  ON public.inventory_movements(product_id, selling_option_id);
CREATE INDEX IF NOT EXISTS inventory_movements_selling_option_idx
  ON public.inventory_movements(selling_option_id);
CREATE INDEX IF NOT EXISTS inventory_movements_created_by_idx
  ON public.inventory_movements(created_by);

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_movements: scoped read" ON public.inventory_movements;
CREATE POLICY "inventory_movements: scoped read" ON public.inventory_movements
FOR SELECT TO authenticated
USING (public.user_belongs_to_store(store_id));

GRANT SELECT ON public.inventory_movements TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_log_stock_adjustment_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_name text;
BEGIN
  SELECT name INTO v_product_name
  FROM public.products
  WHERE id = NEW.product_id;

  INSERT INTO public.inventory_movements(
    store_id,
    product_id,
    product_name,
    selling_option_id,
    selling_option_label,
    unit_label,
    package_size,
    package_unit,
    movement_type,
    quantity_delta,
    stock_before,
    stock_after,
    stock_source,
    reference_type,
    reference_id,
    note,
    created_by
  )
  VALUES (
    NEW.store_id,
    NEW.product_id,
    COALESCE(v_product_name, 'Unknown product'),
    NEW.selling_option_id,
    NEW.selling_option_label,
    COALESCE(NEW.unit_label, 'unit'),
    NEW.package_size,
    NEW.package_unit,
    CASE
      WHEN NEW.stock_source = 'conversion' AND NEW.quantity_delta < 0 THEN 'conversion_out'
      WHEN NEW.stock_source = 'conversion' AND NEW.quantity_delta > 0 THEN 'conversion_in'
      ELSE NEW.reason::text
    END,
    NEW.quantity_delta,
    NEW.stock_before,
    NEW.stock_after,
    COALESCE(NEW.stock_source, CASE WHEN NEW.selling_option_id IS NULL THEN 'product' ELSE 'selling_option' END),
    'stock_adjustment',
    NEW.id,
    COALESCE(NEW.note, ''),
    NEW.created_by
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS log_stock_adjustment_movement_trigger ON public.stock_adjustments;
CREATE TRIGGER log_stock_adjustment_movement_trigger
  AFTER INSERT ON public.stock_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_log_stock_adjustment_movement();

REVOKE ALL ON FUNCTION public.trg_log_stock_adjustment_movement() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_log_stock_adjustment_movement() FROM anon;
REVOKE ALL ON FUNCTION public.trg_log_stock_adjustment_movement() FROM authenticated;

CREATE OR REPLACE FUNCTION public.trg_deduct_stock_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_store uuid;
  v_product public.products%ROWTYPE;
  v_option public.product_selling_options%ROWTYPE;
  v_before numeric;
  v_after numeric;
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

  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = NEW.product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % does not exist', NEW.product_id;
  END IF;

  IF v_product.store_id <> v_sale_store THEN
    RAISE EXCEPTION 'Product % does not belong to sale store %', NEW.product_id, v_sale_store;
  END IF;

  IF NEW.selling_option_id IS NOT NULL THEN
    SELECT *
    INTO v_option
    FROM public.product_selling_options
    WHERE id = NEW.selling_option_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selling option % does not exist', NEW.selling_option_id;
    END IF;

    IF v_option.product_id <> NEW.product_id OR v_option.store_id <> v_sale_store THEN
      RAISE EXCEPTION 'Selling option % does not belong to sale product/store', NEW.selling_option_id;
    END IF;

    IF v_option.stock_quantity < NEW.quantity THEN
      RAISE EXCEPTION 'Insufficient stock for %. Available %, requested %',
        COALESCE(NEW.selling_option_label, v_option.label), v_option.stock_quantity, NEW.quantity;
    END IF;

    v_before := v_option.stock_quantity;
    v_after := v_before - NEW.quantity;

    UPDATE public.product_selling_options
    SET stock_quantity = v_after,
        updated_at = now()
    WHERE id = v_option.id;

    IF v_option.is_default THEN
      UPDATE public.products
      SET current_stock = round(v_after)::integer,
          updated_at = now()
      WHERE id = NEW.product_id;
    END IF;

    INSERT INTO public.inventory_movements(
      store_id, product_id, product_name, selling_option_id, selling_option_label,
      unit_label, package_size, package_unit, movement_type, quantity_delta,
      stock_before, stock_after, stock_source, reference_type, reference_id, note, created_by
    )
    VALUES (
      v_sale_store,
      NEW.product_id,
      NEW.product_name,
      NEW.selling_option_id,
      COALESCE(NEW.selling_option_label, v_option.label),
      COALESCE(NEW.unit_label, v_option.unit_label),
      COALESCE(NEW.package_size, v_option.quantity_value),
      COALESCE(NEW.package_unit, v_option.quantity_unit),
      'sale',
      -NEW.quantity,
      v_before,
      v_after,
      'selling_option',
      'sale',
      NEW.sale_id,
      'POS sale ' || NEW.sale_id::text,
      auth.uid()
    );
  ELSE
    IF v_product.current_stock < NEW.quantity THEN
      RAISE EXCEPTION 'Insufficient stock for product %. Available %, requested %',
        NEW.product_id, v_product.current_stock, NEW.quantity;
    END IF;

    v_before := v_product.current_stock;
    v_after := v_before - NEW.quantity;

    UPDATE public.products
    SET current_stock = v_after::integer,
        updated_at = now()
    WHERE id = NEW.product_id;

    INSERT INTO public.inventory_movements(
      store_id, product_id, product_name, unit_label, movement_type, quantity_delta,
      stock_before, stock_after, stock_source, reference_type, reference_id, note, created_by
    )
    VALUES (
      v_sale_store,
      NEW.product_id,
      NEW.product_name,
      COALESCE(NEW.unit_label, v_product.unit, 'unit'),
      'sale',
      -NEW.quantity,
      v_before,
      v_after,
      'product',
      'sale',
      NEW.sale_id,
      'POS sale ' || NEW.sale_id::text,
      auth.uid()
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deduct_stock_on_sale_trigger ON public.sale_items;
CREATE TRIGGER deduct_stock_on_sale_trigger
  AFTER INSERT ON public.sale_items
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_deduct_stock_on_sale();

REVOKE ALL ON FUNCTION public.trg_deduct_stock_on_sale() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_deduct_stock_on_sale() FROM anon;
REVOKE ALL ON FUNCTION public.trg_deduct_stock_on_sale() FROM authenticated;

CREATE OR REPLACE FUNCTION public.process_pos_sale_v2(
  p_id uuid,
  p_store_id uuid,
  p_cashier_id uuid,
  p_subtotal numeric,
  p_tax numeric,
  p_discount numeric,
  p_total numeric,
  p_cash_received numeric,
  p_change numeric,
  p_items jsonb,
  p_payment_method public.payment_method DEFAULT 'cash',
  p_payment_reference text DEFAULT NULL,
  p_discount_type text DEFAULT 'amount',
  p_discount_value numeric DEFAULT NULL,
  p_tax_rate numeric DEFAULT NULL
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
  v_option public.product_selling_options%ROWTYPE;
  v_product_id uuid;
  v_option_id uuid;
  v_qty integer;
  v_unit_price numeric;
  v_category_name text;
  v_option_label text;
  v_unit_label text;
  v_package_size numeric;
  v_package_unit text;
  v_subtotal numeric := 0;
  v_discount_type text := COALESCE(NULLIF(p_discount_type, ''), 'amount');
  v_discount_value numeric := COALESCE(p_discount_value, p_discount, 0);
  v_discount numeric := 0;
  v_tax_rate numeric;
  v_tax numeric;
  v_total numeric;
  v_tendered numeric;
  v_change numeric;
  v_receipt_number text;
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

  FOR v_product_id, v_option_id, v_qty IN
    SELECT
      (value->>'productId')::uuid,
      NULLIF(value->>'sellingOptionId', '')::uuid,
      SUM((value->>'quantity')::integer)::integer
    FROM jsonb_array_elements(p_items) AS line(value)
    GROUP BY (value->>'productId')::uuid, NULLIF(value->>'sellingOptionId', '')::uuid
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

    IF v_option_id IS NOT NULL THEN
      SELECT *
      INTO v_option
      FROM public.product_selling_options
      WHERE id = v_option_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Selling option % does not exist', v_option_id;
      END IF;

      IF v_option.product_id <> v_product_id OR v_option.store_id <> p_store_id THEN
        RAISE EXCEPTION 'Selling option % does not belong to sale product/store', v_option_id;
      END IF;

      IF NOT v_option.is_active THEN
        RAISE EXCEPTION 'Selling option % is disabled', v_option.label;
      END IF;

      IF v_option.stock_quantity < v_qty THEN
        RAISE EXCEPTION 'Insufficient stock for %. Available %, requested %',
          v_option.label, v_option.stock_quantity, v_qty;
      END IF;

      v_subtotal := v_subtotal + round(v_option.selling_price * v_qty, 2);
    ELSE
      IF v_product.current_stock < v_qty THEN
        RAISE EXCEPTION 'Insufficient stock for %. Available %, requested %',
          v_product.name, v_product.current_stock, v_qty;
      END IF;

      v_subtotal := v_subtotal + round(v_product.selling_price * v_qty, 2);
    END IF;
  END LOOP;

  IF v_discount_type NOT IN ('amount', 'percent') THEN
    RAISE EXCEPTION 'Discount type must be amount or percent';
  END IF;

  IF v_discount_value < 0 OR COALESCE(p_cash_received, 0) < 0 THEN
    RAISE EXCEPTION 'Sale totals cannot be negative';
  END IF;

  IF v_discount_type = 'percent' THEN
    IF v_discount_value > 100 THEN
      RAISE EXCEPTION 'Percent discount cannot exceed 100';
    END IF;
    v_discount := round(v_subtotal * v_discount_value / 100, 2);
  ELSE
    v_discount := round(v_discount_value, 2);
  END IF;

  IF v_discount > v_subtotal THEN
    RAISE EXCEPTION 'Discount cannot exceed subtotal';
  END IF;

  SELECT COALESCE(p_tax_rate, tax_rate, 0)
  INTO v_tax_rate
  FROM public.stores
  WHERE id = p_store_id;

  IF v_tax_rate IS NULL OR v_tax_rate < 0 OR v_tax_rate > 100 THEN
    RAISE EXCEPTION 'Tax rate must be between 0 and 100';
  END IF;

  v_tax := round((v_subtotal - v_discount) * v_tax_rate / 100, 2);
  v_total := round(v_subtotal - v_discount + v_tax, 2);

  IF p_payment_method = 'cash' THEN
    v_tendered := COALESCE(p_cash_received, 0);
    v_change := round(v_tendered - v_total, 2);
    IF v_change < 0 THEN
      RAISE EXCEPTION 'Cash received is less than sale total';
    END IF;
  ELSE
    v_tendered := v_total;
    v_change := 0;
  END IF;

  IF abs(COALESCE(p_subtotal, 0) - v_subtotal) > 0.01
    OR abs(COALESCE(p_tax, 0) - v_tax) > 0.01
    OR abs(COALESCE(p_discount, 0) - v_discount) > 0.01
    OR abs(COALESCE(p_total, 0) - v_total) > 0.01
    OR abs(COALESCE(p_change, 0) - v_change) > 0.01 THEN
    RAISE EXCEPTION 'Submitted sale totals do not match current product prices, discount, or tax';
  END IF;

  v_receipt_number := public.generate_receipt_number(p_store_id);

  INSERT INTO public.sales (
    id,
    store_id,
    cashier_id,
    subtotal,
    tax,
    discount,
    total,
    cash_received,
    change,
    status,
    payment_method,
    payment_reference,
    discount_type,
    discount_value,
    tax_rate,
    receipt_number
  )
  VALUES (
    p_id,
    p_store_id,
    auth.uid(),
    v_subtotal,
    v_tax,
    v_discount,
    v_total,
    v_tendered,
    v_change,
    'completed',
    p_payment_method,
    p_payment_reference,
    v_discount_type,
    v_discount_value,
    v_tax_rate,
    v_receipt_number
  )
  RETURNING * INTO v_sale;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS line(value)
  LOOP
    v_product_id := (v_item->>'productId')::uuid;
    v_option_id := NULLIF(v_item->>'sellingOptionId', '')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    v_option_label := NULL;
    v_unit_label := NULL;
    v_package_size := NULL;
    v_package_unit := NULL;

    SELECT *
    INTO v_product
    FROM public.products
    WHERE id = v_product_id;

    SELECT c.name
    INTO v_category_name
    FROM public.categories c
    WHERE c.id = v_product.category_id;

    IF v_option_id IS NOT NULL THEN
      SELECT *
      INTO v_option
      FROM public.product_selling_options
      WHERE id = v_option_id;

      v_unit_price := v_option.selling_price;
      v_option_label := v_option.label;
      v_unit_label := v_option.unit_label;
      v_package_size := v_option.quantity_value;
      v_package_unit := v_option.quantity_unit;
    ELSE
      v_unit_price := v_product.selling_price;
      v_option_label := COALESCE(NULLIF(v_product.unit, ''), 'unit');
      v_unit_label := COALESCE(NULLIF(v_product.unit, ''), 'unit');
    END IF;

    INSERT INTO public.sale_items (
      sale_id,
      product_id,
      product_name,
      category_name,
      selling_option_id,
      selling_option_label,
      unit_label,
      package_size,
      package_unit,
      stock_source,
      quantity,
      unit_price,
      cost_price,
      line_total
    )
    VALUES (
      v_sale.id,
      v_product.id,
      v_product.name,
      COALESCE(v_category_name, 'Uncategorized'),
      v_option_id,
      COALESCE(v_option_label, v_item->>'sellingOptionLabel', v_unit_label),
      COALESCE(v_unit_label, v_item->>'unitLabel', 'unit'),
      v_package_size,
      v_package_unit,
      CASE WHEN v_option_id IS NULL THEN 'product' ELSE 'selling_option' END,
      v_qty,
      v_unit_price,
      v_product.cost_price,
      round(v_unit_price * v_qty, 2)
    );
  END LOOP;

  INSERT INTO public.sale_payments (
    sale_id, store_id, method, status, amount, amount_tendered, change_amount, reference_number, created_by
  )
  VALUES (
    v_sale.id, p_store_id, p_payment_method, 'captured', v_total, v_tendered, v_change, p_payment_reference, auth.uid()
  );

  INSERT INTO public.receipts(sale_id, store_id, receipt_number, issued_by, payload)
  VALUES (
    v_sale.id,
    p_store_id,
    v_receipt_number,
    auth.uid(),
    jsonb_build_object(
      'sale', to_jsonb(v_sale),
      'items', (
        SELECT jsonb_agg(to_jsonb(si) ORDER BY si.product_name)
        FROM public.sale_items si
        WHERE si.sale_id = v_sale.id
      ),
      'totals', jsonb_build_object(
        'subtotal', v_subtotal,
        'discount', v_discount,
        'tax', v_tax,
        'total', v_total,
        'amountTendered', v_tendered,
        'change', v_change
      )
    )
  );

  INSERT INTO public.sale_events(sale_id, store_id, event_type, amount, actor_id, metadata)
  VALUES (v_sale.id, p_store_id, 'completed', v_total, auth.uid(), jsonb_build_object('receiptNumber', v_receipt_number));

  PERFORM public.log_audit_event(
    p_store_id,
    'sale.completed',
    'sale',
    v_sale.id,
    jsonb_build_object('total', v_total, 'paymentMethod', p_payment_method, 'receiptNumber', v_receipt_number)
  );

  RETURN v_sale;
END;
$$;

REVOKE ALL ON FUNCTION public.process_pos_sale_v2(uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, jsonb, public.payment_method, text, text, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_pos_sale_v2(uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, jsonb, public.payment_method, text, text, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_pos_sale_v2(uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, jsonb, public.payment_method, text, text, numeric, numeric) TO authenticated;
