-- Migration 34: bulk purchase options share product base stock.
--
-- A product owns one inventory balance in its base unit. Selling options are
-- pricing/checkout metadata only: a bulk option consumes N base units and its
-- availability is floor(product.current_stock / N).

-- 1. Product and selling-option configuration.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS bulk_purchase_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.product_selling_options
  ADD COLUMN IF NOT EXISTS inventory_multiplier numeric(12,3) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS shares_base_stock boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_bulk boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS discount_type text NOT NULL DEFAULT 'percent',
  ADD COLUMN IF NOT EXISTS discount_value numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.product_selling_options
  DROP CONSTRAINT IF EXISTS product_selling_options_inventory_multiplier_check,
  DROP CONSTRAINT IF EXISTS product_selling_options_discount_type_check,
  DROP CONSTRAINT IF EXISTS product_selling_options_discount_value_check;

ALTER TABLE public.product_selling_options
  ADD CONSTRAINT product_selling_options_inventory_multiplier_check
    CHECK (inventory_multiplier >= 1),
  ADD CONSTRAINT product_selling_options_discount_type_check
    CHECK (discount_type IN ('percent', 'amount')),
  ADD CONSTRAINT product_selling_options_discount_value_check
    CHECK (discount_value >= 0);

-- Legacy sack/package rows are converted into bulk options. Every option now
-- shares the product balance; stock_quantity remains a derived compatibility
-- projection for existing screens and integrations.
UPDATE public.product_selling_options pso
SET is_bulk = (
      NOT pso.is_default
      AND (
        COALESCE(pso.inventory_multiplier, 1) > 1
        OR COALESCE(pso.quantity_value, 1) > 1
        OR pso.kind = 'sack'
      )
    );

UPDATE public.product_selling_options
SET is_default = false
WHERE is_bulk;

WITH ranked_base_options AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY product_id
      ORDER BY is_default DESC, created_at, id
    ) AS option_rank
  FROM public.product_selling_options
  WHERE is_active AND NOT is_bulk
)
UPDATE public.product_selling_options pso
SET is_default = ranked_base_options.option_rank = 1
FROM ranked_base_options
WHERE ranked_base_options.id = pso.id;

UPDATE public.product_selling_options pso
SET shares_base_stock = true,
    inventory_multiplier = CASE
      WHEN pso.is_bulk THEN GREATEST(COALESCE(pso.quantity_value, pso.inventory_multiplier, 1), 2)
      ELSE 1
    END,
    stock_quantity = floor(
      GREATEST(COALESCE(p.current_stock, 0), 0)
      / GREATEST(
          CASE
            WHEN pso.is_bulk THEN GREATEST(COALESCE(pso.quantity_value, pso.inventory_multiplier, 1), 2)
            ELSE 1
          END,
          1
        )
    ),
    updated_at = now()
FROM public.products p
WHERE p.id = pso.product_id;

UPDATE public.products p
SET bulk_purchase_enabled = EXISTS (
      SELECT 1
      FROM public.product_selling_options pso
      WHERE pso.product_id = p.id
        AND pso.is_active
        AND pso.is_bulk
    ),
    updated_at = now();

CREATE INDEX IF NOT EXISTS product_selling_options_bulk_idx
  ON public.product_selling_options (product_id, is_bulk, is_active);

COMMENT ON COLUMN public.products.bulk_purchase_enabled IS
  'Whether checkout may sell this product through one or more bulk options.';
COMMENT ON COLUMN public.product_selling_options.is_bulk IS
  'Bulk checkout mode. A bulk option consumes inventory_multiplier base units.';
COMMENT ON COLUMN public.product_selling_options.inventory_multiplier IS
  'Number of product base units consumed by one selling option quantity.';
COMMENT ON COLUMN public.product_selling_options.stock_quantity IS
  'Derived availability projection; product.current_stock is the source of truth.';

-- 2. Immutable sale snapshots for purchase mode, discounts, and base units.
ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS purchase_mode text NOT NULL DEFAULT 'unit',
  ADD COLUMN IF NOT EXISTS bulk_option_id uuid REFERENCES public.product_selling_options(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bulk_option_label text,
  ADD COLUMN IF NOT EXISTS bulk_quantity numeric(12,3),
  ADD COLUMN IF NOT EXISTS units_per_package numeric(12,3) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS base_unit_quantity numeric(12,3) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS regular_unit_price numeric(10,2),
  ADD COLUMN IF NOT EXISTS regular_value numeric(12,2),
  ADD COLUMN IF NOT EXISTS bulk_discount_type text,
  ADD COLUMN IF NOT EXISTS bulk_discount_value numeric(12,2),
  ADD COLUMN IF NOT EXISTS bulk_discount_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS final_selling_price numeric(12,2);

ALTER TABLE public.sale_items
  DROP CONSTRAINT IF EXISTS sale_items_purchase_mode_check,
  DROP CONSTRAINT IF EXISTS sale_items_units_per_package_check,
  DROP CONSTRAINT IF EXISTS sale_items_base_unit_quantity_check,
  DROP CONSTRAINT IF EXISTS sale_items_bulk_quantity_check,
  DROP CONSTRAINT IF EXISTS sale_items_bulk_discount_type_check,
  DROP CONSTRAINT IF EXISTS sale_items_bulk_discount_value_check,
  DROP CONSTRAINT IF EXISTS sale_items_bulk_discount_amount_check;

ALTER TABLE public.sale_items
  ADD CONSTRAINT sale_items_purchase_mode_check
    CHECK (purchase_mode IN ('unit', 'bulk')),
  ADD CONSTRAINT sale_items_units_per_package_check
    CHECK (units_per_package >= 1),
  ADD CONSTRAINT sale_items_base_unit_quantity_check
    CHECK (base_unit_quantity > 0),
  ADD CONSTRAINT sale_items_bulk_quantity_check
    CHECK (bulk_quantity IS NULL OR bulk_quantity > 0),
  ADD CONSTRAINT sale_items_bulk_discount_type_check
    CHECK (bulk_discount_type IS NULL OR bulk_discount_type IN ('percent', 'amount')),
  ADD CONSTRAINT sale_items_bulk_discount_value_check
    CHECK (bulk_discount_value IS NULL OR bulk_discount_value >= 0),
  ADD CONSTRAINT sale_items_bulk_discount_amount_check
    CHECK (bulk_discount_amount IS NULL OR bulk_discount_amount >= 0);

WITH sale_item_snapshot AS (
  SELECT
    si.id,
    si.quantity,
    si.line_total,
    si.unit_price,
    p.selling_price,
    pso.id AS selling_option_id,
    pso.is_bulk,
    pso.label AS selling_option_label,
    pso.inventory_multiplier,
    pso.quantity_value,
    pso.discount_type,
    pso.discount_value
  FROM public.sale_items si
  JOIN public.products p ON p.id = si.product_id
  LEFT JOIN public.product_selling_options pso ON pso.id = si.selling_option_id
)
UPDATE public.sale_items si
SET purchase_mode = CASE WHEN COALESCE(s.is_bulk, false) THEN 'bulk' ELSE 'unit' END,
    bulk_option_id = CASE WHEN COALESCE(s.is_bulk, false) THEN s.selling_option_id ELSE NULL END,
    bulk_option_label = CASE WHEN COALESCE(s.is_bulk, false) THEN s.selling_option_label ELSE NULL END,
    bulk_quantity = CASE WHEN COALESCE(s.is_bulk, false) THEN s.quantity ELSE NULL END,
    units_per_package = CASE
      WHEN COALESCE(s.is_bulk, false)
        THEN GREATEST(COALESCE(s.inventory_multiplier, s.quantity_value, 1), 2)
      ELSE 1
    END,
    base_unit_quantity = s.quantity * CASE
      WHEN COALESCE(s.is_bulk, false)
        THEN GREATEST(COALESCE(s.inventory_multiplier, s.quantity_value, 1), 2)
      ELSE 1
    END,
    regular_unit_price = s.selling_price,
    regular_value = round(
      s.selling_price * s.quantity * CASE
        WHEN COALESCE(s.is_bulk, false)
          THEN GREATEST(COALESCE(s.inventory_multiplier, s.quantity_value, 1), 2)
        ELSE 1
      END,
      2
    ),
    bulk_discount_type = CASE WHEN COALESCE(s.is_bulk, false) THEN s.discount_type ELSE NULL END,
    bulk_discount_value = CASE WHEN COALESCE(s.is_bulk, false) THEN s.discount_value ELSE NULL END,
    bulk_discount_amount = CASE
      WHEN COALESCE(s.is_bulk, false)
        THEN GREATEST(
          round(
            s.selling_price * s.quantity * GREATEST(COALESCE(s.inventory_multiplier, s.quantity_value, 1), 2),
            2
          ) - s.line_total,
          0
        )
      ELSE NULL
    END,
    final_selling_price = s.unit_price,
    stock_source = 'product'
FROM sale_item_snapshot s
WHERE s.id = si.id;

CREATE INDEX IF NOT EXISTS sale_items_purchase_mode_idx
  ON public.sale_items (purchase_mode, product_id);
CREATE INDEX IF NOT EXISTS sale_items_bulk_option_idx
  ON public.sale_items (bulk_option_id);

COMMENT ON COLUMN public.sale_items.quantity IS
  'Selling quantity, such as pieces or cases; use base_unit_quantity for inventory units.';
COMMENT ON COLUMN public.sale_items.base_unit_quantity IS
  'Immutable number of product base units deducted by this line.';
COMMENT ON COLUMN public.sale_items.final_selling_price IS
  'Immutable final selling price per selling quantity after the bulk discount.';

-- 3. Keep legacy option stock projections synchronized with product base stock.
CREATE OR REPLACE FUNCTION private.sync_shared_option_stock(p_product_id uuid, p_base_stock numeric)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.product_selling_options pso
  SET stock_quantity = floor(
        GREATEST(COALESCE(p_base_stock, 0), 0)
        / GREATEST(
            CASE
              WHEN pso.is_bulk THEN GREATEST(COALESCE(pso.inventory_multiplier, pso.quantity_value, 1), 2)
              ELSE 1
            END,
            1
          )
      ),
      updated_at = now()
  WHERE pso.product_id = p_product_id;
$$;

REVOKE ALL ON FUNCTION private.sync_shared_option_stock(uuid, numeric) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.derive_selling_option_stock_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_base_stock numeric;
BEGIN
  NEW.shares_base_stock := true;
  NEW.inventory_multiplier := CASE
    WHEN NEW.is_bulk THEN GREATEST(COALESCE(NEW.inventory_multiplier, NEW.quantity_value, 1), 2)
    ELSE 1
  END;

  SELECT current_stock INTO v_base_stock
  FROM public.products
  WHERE id = NEW.product_id;

  NEW.stock_quantity := floor(
    GREATEST(COALESCE(v_base_stock, 0), 0) / NEW.inventory_multiplier
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.derive_selling_option_stock_projection() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS derive_selling_option_stock_projection_trigger
  ON public.product_selling_options;
CREATE TRIGGER derive_selling_option_stock_projection_trigger
BEFORE INSERT OR UPDATE OF product_id, is_bulk, inventory_multiplier, quantity_value
ON public.product_selling_options
FOR EACH ROW
EXECUTE FUNCTION private.derive_selling_option_stock_projection();

CREATE OR REPLACE FUNCTION public.trg_deduct_stock_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_sale_store uuid;
  v_product public.products%ROWTYPE;
  v_option public.product_selling_options%ROWTYPE;
  v_multiplier numeric := 1;
  v_required_base numeric;
  v_before numeric;
  v_after numeric;
BEGIN
  SELECT store_id INTO v_sale_store
  FROM public.sales
  WHERE id = NEW.sale_id;

  IF v_sale_store IS NULL THEN
    RAISE EXCEPTION 'Sale % does not exist', NEW.sale_id;
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = NEW.product_id
  FOR UPDATE;

  IF NOT FOUND OR v_product.store_id <> v_sale_store THEN
    RAISE EXCEPTION 'Product does not belong to sale store';
  END IF;

  IF NEW.selling_option_id IS NOT NULL THEN
    SELECT * INTO v_option
    FROM public.product_selling_options
    WHERE id = NEW.selling_option_id
    FOR UPDATE;

    IF NOT FOUND
      OR v_option.product_id <> NEW.product_id
      OR v_option.store_id <> v_sale_store
      OR NOT v_option.is_active THEN
      RAISE EXCEPTION 'Selling option does not belong to an active sale product/store';
    END IF;

    v_multiplier := CASE
      WHEN v_option.is_bulk
        THEN GREATEST(COALESCE(v_option.inventory_multiplier, v_option.quantity_value, 1), 2)
      ELSE 1
    END;
  END IF;

  v_required_base := NEW.quantity * v_multiplier;
  IF v_product.current_stock < v_required_base THEN
    RAISE EXCEPTION 'Insufficient base stock for %. Available base units %, required base units %',
      v_product.name, v_product.current_stock, v_required_base;
  END IF;

  v_before := v_product.current_stock;
  v_after := round(v_before - v_required_base);

  UPDATE public.products
  SET current_stock = v_after,
      updated_at = now()
  WHERE id = NEW.product_id;

  PERFORM private.sync_shared_option_stock(NEW.product_id, v_after);

  NEW.stock_source := 'product';

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
    v_sale_store,
    NEW.product_id,
    NEW.product_name,
    NEW.selling_option_id,
    COALESCE(NEW.selling_option_label, v_option.label, v_product.unit),
    COALESCE(NEW.unit_label, v_product.unit, 'unit'),
    CASE WHEN v_multiplier > 1 THEN v_multiplier ELSE NULL END,
    CASE WHEN v_multiplier > 1 THEN COALESCE(v_product.unit, 'unit') ELSE NULL END,
    'sale',
    -v_required_base,
    v_before,
    v_after,
    'product',
    'sale',
    NEW.sale_id,
    'POS sale ' || NEW.sale_id::text,
    auth.uid()
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_deduct_stock_on_sale() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.set_sale_item_purchase_cost()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_piece_cost numeric;
  v_multiplier numeric := 1;
BEGIN
  SELECT cost_price INTO v_piece_cost
  FROM public.products
  WHERE id = NEW.product_id;

  IF NEW.selling_option_id IS NOT NULL THEN
    SELECT CASE
      WHEN is_bulk THEN GREATEST(COALESCE(inventory_multiplier, quantity_value, 1), 2)
      ELSE 1
    END
    INTO v_multiplier
    FROM public.product_selling_options
    WHERE id = NEW.selling_option_id;
  END IF;

  NEW.stock_source := 'product';
  NEW.cost_price := COALESCE(v_piece_cost, 0) * COALESCE(v_multiplier, 1);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.set_sale_item_purchase_cost() FROM PUBLIC, anon, authenticated, service_role;

-- 4. Inventory adjustments change only product base stock. The option id is
-- retained as audit metadata when supplied by an older client.
CREATE OR REPLACE FUNCTION public.adjust_inventory_stock(
  p_product_id uuid,
  p_selling_option_id uuid,
  p_quantity_delta numeric,
  p_reason text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_option public.product_selling_options%ROWTYPE;
  v_before numeric;
  v_after numeric;
  v_multiplier numeric := 1;
  v_adjustment_id uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF public.current_user_role()::text NOT IN ('admin', 'inventory') THEN
    RAISE EXCEPTION 'Only admins or inventory users can adjust stock';
  END IF;
  IF p_quantity_delta IS NULL OR p_quantity_delta = 0 THEN
    RAISE EXCEPTION 'Quantity change cannot be zero';
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.user_belongs_to_store(v_product.store_id) THEN
    RAISE EXCEPTION 'Product not found or access denied';
  END IF;

  IF p_selling_option_id IS NOT NULL THEN
    SELECT * INTO v_option
    FROM public.product_selling_options
    WHERE id = p_selling_option_id
      AND product_id = p_product_id
      AND store_id = v_product.store_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selling option not found';
    END IF;

    v_multiplier := CASE
      WHEN v_option.is_bulk
        THEN GREATEST(COALESCE(v_option.inventory_multiplier, v_option.quantity_value, 1), 2)
      ELSE 1
    END;
  END IF;

  v_before := v_product.current_stock;
  v_after := round(v_before + p_quantity_delta);
  IF v_after < 0 THEN
    RAISE EXCEPTION 'Base stock cannot be negative';
  END IF;

  UPDATE public.products
  SET current_stock = v_after,
      updated_at = now()
  WHERE id = v_product.id;

  PERFORM private.sync_shared_option_stock(v_product.id, v_after);

  INSERT INTO public.stock_adjustments(
    id,
    store_id,
    product_id,
    selling_option_id,
    selling_option_label,
    unit_label,
    package_size,
    package_unit,
    stock_source,
    reason,
    quantity_delta,
    stock_before,
    stock_after,
    note,
    created_by
  )
  VALUES (
    v_adjustment_id,
    v_product.store_id,
    v_product.id,
    CASE WHEN p_selling_option_id IS NULL THEN NULL ELSE v_option.id END,
    CASE WHEN p_selling_option_id IS NULL THEN NULL ELSE v_option.label END,
    COALESCE(v_product.unit, 'unit'),
    CASE WHEN v_multiplier > 1 THEN v_multiplier ELSE NULL END,
    CASE WHEN v_multiplier > 1 THEN COALESCE(v_product.unit, 'unit') ELSE NULL END,
    'product',
    p_reason::public.adjustment_reason,
    v_after - v_before,
    v_before,
    v_after,
    COALESCE(p_note, ''),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'adjustmentId', v_adjustment_id,
    'productId', v_product.id,
    'sellingOptionId', p_selling_option_id,
    'stockBefore', v_before,
    'stockAfter', v_after,
    'quantityDelta', v_after - v_before,
    'stockSource', 'product'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_inventory_stock(uuid, uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_inventory_stock(uuid, uuid, numeric, text, text) TO authenticated;

-- 4b. Voids and returns restore the same base-unit balance that the sale
-- consumed. Return quantities remain selling quantities for refund purposes.
CREATE OR REPLACE FUNCTION public.void_pos_sale(
  p_sale_id uuid,
  p_reason text
)
RETURNS public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_item record;
  v_before numeric;
  v_after numeric;
  v_base_quantity numeric;
  v_multiplier numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_sale
  FROM public.sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale % does not exist', p_sale_id;
  END IF;
  IF public.current_user_role()::text <> 'admin' THEN
    RAISE EXCEPTION 'Only store admins can void sales';
  END IF;
  IF NOT public.user_belongs_to_store(v_sale.store_id) THEN
    RAISE EXCEPTION 'User is not assigned to this store';
  END IF;
  IF v_sale.status <> 'completed' THEN
    RAISE EXCEPTION 'Only completed sales can be voided';
  END IF;
  IF v_sale.closeout_id IS NOT NULL THEN
    RAISE EXCEPTION 'Closed-out sales cannot be voided';
  END IF;

  FOR v_item IN
    SELECT
      si.product_id,
      si.selling_option_id,
      si.selling_option_label,
      si.unit_label,
      si.package_size,
      si.package_unit,
      si.quantity,
      si.units_per_package,
      si.base_unit_quantity
    FROM public.sale_items si
    WHERE si.sale_id = p_sale_id
      AND si.product_id IS NOT NULL
  LOOP
    v_multiplier := GREATEST(COALESCE(v_item.units_per_package, v_item.package_size, 1), 1);
    v_base_quantity := GREATEST(COALESCE(v_item.base_unit_quantity, v_item.quantity * v_multiplier), 0);

    SELECT current_stock INTO v_before
    FROM public.products
    WHERE id = v_item.product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % no longer exists', v_item.product_id;
    END IF;

    v_after := round(v_before + v_base_quantity);
    UPDATE public.products
    SET current_stock = v_after,
        updated_at = now()
    WHERE id = v_item.product_id;

    PERFORM private.sync_shared_option_stock(v_item.product_id, v_after);

    INSERT INTO public.stock_adjustments(
      store_id,
      product_id,
      selling_option_id,
      selling_option_label,
      unit_label,
      package_size,
      package_unit,
      stock_source,
      reason,
      quantity_delta,
      stock_before,
      stock_after,
      note,
      created_by
    )
    VALUES (
      v_sale.store_id,
      v_item.product_id,
      v_item.selling_option_id,
      v_item.selling_option_label,
      COALESCE(v_item.unit_label, 'unit'),
      CASE WHEN v_multiplier > 1 THEN v_multiplier ELSE NULL END,
      CASE WHEN v_multiplier > 1 THEN COALESCE(v_item.unit_label, 'unit') ELSE NULL END,
      'product',
      'other',
      v_base_quantity,
      v_before,
      v_after,
      'Voided sale ' || p_sale_id::text,
      auth.uid()
    );
  END LOOP;

  UPDATE public.sales
  SET status = 'voided',
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = COALESCE(NULLIF(p_reason, ''), 'No reason provided')
  WHERE id = p_sale_id
  RETURNING * INTO v_sale;

  UPDATE public.sale_payments
  SET status = 'voided'
  WHERE sale_id = p_sale_id
    AND status = 'captured';

  INSERT INTO public.sale_events(sale_id, store_id, event_type, reason, amount, actor_id)
  VALUES (p_sale_id, v_sale.store_id, 'voided', p_reason, v_sale.total, auth.uid());

  PERFORM public.log_audit_event(
    v_sale.store_id,
    'sale.voided',
    'sale',
    p_sale_id,
    jsonb_build_object('reason', p_reason, 'total', v_sale.total)
  );

  RETURN v_sale;
END;
$$;

CREATE OR REPLACE FUNCTION public.return_sale_items(
  p_sale_id uuid,
  p_items jsonb,
  p_reason text,
  p_refund_method public.payment_method DEFAULT 'cash',
  p_reference text DEFAULT NULL
)
RETURNS public.sale_returns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_return public.sale_returns%ROWTYPE;
  v_item jsonb;
  v_sale_item public.sale_items%ROWTYPE;
  v_qty integer;
  v_previously_returned integer;
  v_line_total numeric;
  v_refund_total numeric := 0;
  v_before numeric;
  v_after numeric;
  v_base_quantity numeric;
  v_multiplier numeric;
  v_refunded numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_sale
  FROM public.sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale % does not exist', p_sale_id;
  END IF;
  IF public.current_user_role()::text <> 'admin' THEN
    RAISE EXCEPTION 'Only store admins can process returns';
  END IF;
  IF NOT public.user_belongs_to_store(v_sale.store_id) THEN
    RAISE EXCEPTION 'User is not assigned to this store';
  END IF;
  IF v_sale.status IN ('voided', 'refunded') THEN
    RAISE EXCEPTION 'Sale is not returnable in its current status';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Return must contain at least one item';
  END IF;

  INSERT INTO public.sale_returns(
    sale_id, store_id, return_number, reason, refund_method, reference_number, created_by
  )
  VALUES (
    p_sale_id,
    v_sale.store_id,
    'RET-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' ||
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
    COALESCE(NULLIF(p_reason, ''), 'No reason provided'),
    p_refund_method,
    p_reference,
    auth.uid()
  )
  RETURNING * INTO v_return;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS line(value)
  LOOP
    SELECT * INTO v_sale_item
    FROM public.sale_items
    WHERE id = COALESCE((v_item->>'saleItemId')::uuid, (v_item->>'id')::uuid)
      AND sale_id = p_sale_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sale item does not exist for this sale';
    END IF;

    v_qty := COALESCE((v_item->>'quantity')::integer, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Return item quantity must be greater than zero';
    END IF;

    SELECT COALESCE(SUM(quantity), 0)
    INTO v_previously_returned
    FROM public.sale_return_items sri
    JOIN public.sale_returns sr ON sr.id = sri.return_id
    WHERE sr.sale_id = p_sale_id
      AND sri.sale_item_id = v_sale_item.id
      AND sr.status = 'completed';

    IF v_previously_returned + v_qty > v_sale_item.quantity THEN
      RAISE EXCEPTION 'Return quantity exceeds purchased quantity';
    END IF;

    v_line_total := round(v_sale_item.unit_price * v_qty, 2);
    v_refund_total := v_refund_total + v_line_total;

    IF COALESCE((v_item->>'restock')::boolean, true) AND v_sale_item.product_id IS NOT NULL THEN
      v_multiplier := GREATEST(COALESCE(v_sale_item.units_per_package, v_sale_item.package_size, 1), 1);
      v_base_quantity := v_qty * v_multiplier;

      SELECT current_stock INTO v_before
      FROM public.products
      WHERE id = v_sale_item.product_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % no longer exists', v_sale_item.product_id;
      END IF;

      v_after := round(v_before + v_base_quantity);
      UPDATE public.products
      SET current_stock = v_after,
          updated_at = now()
      WHERE id = v_sale_item.product_id;

      PERFORM private.sync_shared_option_stock(v_sale_item.product_id, v_after);

      INSERT INTO public.stock_adjustments(
        store_id,
        product_id,
        selling_option_id,
        selling_option_label,
        unit_label,
        package_size,
        package_unit,
        stock_source,
        reason,
        quantity_delta,
        stock_before,
        stock_after,
        note,
        created_by
      )
      VALUES (
        v_sale.store_id,
        v_sale_item.product_id,
        v_sale_item.selling_option_id,
        v_sale_item.selling_option_label,
        COALESCE(v_sale_item.unit_label, 'unit'),
        CASE WHEN v_multiplier > 1 THEN v_multiplier ELSE NULL END,
        CASE WHEN v_multiplier > 1 THEN COALESCE(v_sale_item.unit_label, 'unit') ELSE NULL END,
        'product',
        'other',
        v_base_quantity,
        v_before,
        v_after,
        'Returned sale ' || p_sale_id::text,
        auth.uid()
      );
    END IF;

    INSERT INTO public.sale_return_items(
      return_id, sale_item_id, product_id, quantity, unit_price, line_total, restocked
    )
    VALUES (
      v_return.id,
      v_sale_item.id,
      v_sale_item.product_id,
      v_qty,
      v_sale_item.unit_price,
      v_line_total,
      COALESCE((v_item->>'restock')::boolean, true)
    );
  END LOOP;

  SELECT COALESCE(SUM(abs(amount)), 0)
  INTO v_refunded
  FROM public.sale_payments
  WHERE sale_id = p_sale_id
    AND status = 'refunded';

  IF v_refunded + v_refund_total > v_sale.total + 0.01 THEN
    RAISE EXCEPTION 'Return refund cannot exceed remaining paid total';
  END IF;

  UPDATE public.sale_returns
  SET refund_amount = v_refund_total
  WHERE id = v_return.id
  RETURNING * INTO v_return;

  INSERT INTO public.sale_payments(
    sale_id, store_id, method, status, amount, amount_tendered, change_amount, reference_number, created_by
  )
  VALUES (
    p_sale_id, v_sale.store_id, p_refund_method, 'refunded', -round(v_refund_total, 2),
    round(v_refund_total, 2), 0, p_reference, auth.uid()
  );

  UPDATE public.sales
  SET status = CASE
    WHEN v_refunded + v_refund_total >= total - 0.01 THEN 'refunded'::public.sale_status
    ELSE 'partially_refunded'::public.sale_status
  END
  WHERE id = p_sale_id
  RETURNING * INTO v_sale;

  INSERT INTO public.sale_events(sale_id, store_id, event_type, reason, amount, actor_id, metadata)
  VALUES (
    p_sale_id,
    v_sale.store_id,
    'returned',
    p_reason,
    v_refund_total,
    auth.uid(),
    jsonb_build_object('returnId', v_return.id, 'method', p_refund_method, 'reference', p_reference)
  );

  PERFORM public.log_audit_event(
    v_sale.store_id,
    'sale.returned',
    'sale',
    p_sale_id,
    jsonb_build_object('returnId', v_return.id, 'amount', v_refund_total, 'reason', p_reason)
  );

  RETURN v_return;
END;
$$;

REVOKE ALL ON FUNCTION public.void_pos_sale(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_pos_sale(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.return_sale_items(uuid, jsonb, text, public.payment_method, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_sale_items(uuid, jsonb, text, public.payment_method, text) TO authenticated;

-- Restocking changes base stock and keeps automatic bulk prices tied to the
-- newly calculated regular base-unit selling price.
CREATE OR REPLACE FUNCTION public.restock_product_inventory(
  p_product_id uuid,
  p_quantity_in_purchase_units numeric,
  p_purchase_unit text,
  p_pieces_per_purchase_unit numeric,
  p_purchase_price_per_unit numeric,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_before numeric;
  v_after numeric;
  v_pieces numeric;
  v_piece_price numeric;
  v_base_selling_price numeric;
  v_id uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role()::text NOT IN ('admin', 'inventory') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_quantity_in_purchase_units <= 0
    OR p_pieces_per_purchase_unit < 1
    OR p_purchase_price_per_unit < 0 THEN
    RAISE EXCEPTION 'Invalid restock values';
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.user_belongs_to_store(v_product.store_id) THEN
    RAISE EXCEPTION 'Product not found or access denied';
  END IF;

  v_before := v_product.current_stock;
  v_pieces := p_quantity_in_purchase_units * p_pieces_per_purchase_unit;
  v_after := v_before + v_pieces;
  v_piece_price := p_purchase_price_per_unit / p_pieces_per_purchase_unit;
  v_base_selling_price := CASE
    WHEN v_product.auto_pricing_enabled AND v_product.margin_percentage IS NOT NULL
      THEN round(v_piece_price / (1 - v_product.margin_percentage / 100), 2)
    ELSE v_product.selling_price
  END;

  UPDATE public.products
  SET current_stock = round(v_after),
      cost_price = round(v_piece_price, 4),
      purchase_unit = p_purchase_unit,
      conversion_factor = round(p_pieces_per_purchase_unit),
      bulk_purchase_price = round(p_purchase_price_per_unit, 2),
      selling_price = v_base_selling_price,
      updated_at = now()
  WHERE id = p_product_id;

  PERFORM private.sync_shared_option_stock(p_product_id, v_after);

  IF v_product.auto_pricing_enabled AND v_product.margin_percentage IS NOT NULL THEN
    UPDATE public.product_selling_options pso
    SET selling_price = CASE
      WHEN pso.is_bulk THEN CASE
        WHEN COALESCE(pso.discount_type, 'percent') = 'percent' THEN round(
          round(v_base_selling_price * pso.inventory_multiplier, 2)
          * (1 - LEAST(GREATEST(COALESCE(pso.discount_value, 0), 0), 100) / 100),
          2
        )
        ELSE greatest(
          round(v_base_selling_price * pso.inventory_multiplier, 2)
          - greatest(COALESCE(pso.discount_value, 0), 0),
          0
        )
      END
      ELSE v_base_selling_price
    END,
    updated_at = now()
    WHERE pso.product_id = p_product_id;
  END IF;

  INSERT INTO public.restock_history(
    id, store_id, product_id, quantity_in_purchase_units, purchase_unit,
    pieces_per_purchase_unit, pieces_added, purchase_price_per_unit,
    purchase_price_per_piece, stock_before, stock_after, restocked_by, note
  )
  VALUES (
    v_id, v_product.store_id, p_product_id, p_quantity_in_purchase_units,
    p_purchase_unit, p_pieces_per_purchase_unit, v_pieces,
    p_purchase_price_per_unit, v_piece_price, v_before, v_after,
    auth.uid(), COALESCE(p_note, '')
  );

  INSERT INTO public.stock_adjustments(
    id, store_id, product_id, unit_label, package_size, package_unit,
    stock_source, reason, quantity_delta, stock_before, stock_after, note, created_by
  )
  VALUES (
    gen_random_uuid(), v_product.store_id, p_product_id, v_product.unit,
    p_pieces_per_purchase_unit, p_purchase_unit, 'product', 'restock',
    v_pieces, v_before, v_after, COALESCE(p_note, ''), auth.uid()
  );

  RETURN jsonb_build_object(
    'restockId', v_id,
    'piecesAdded', v_pieces,
    'stockBefore', v_before,
    'stockAfter', v_after,
    'purchasePricePerPiece', v_piece_price
  );
END;
$$;

REVOKE ALL ON FUNCTION public.restock_product_inventory(uuid, numeric, text, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restock_product_inventory(uuid, numeric, text, numeric, numeric, text) TO authenticated;

-- Package conversion belonged to the old separate-stock model. Bulk options
-- are now pricing modes only, so prevent stale clients from splitting stock.
CREATE OR REPLACE FUNCTION public.open_sack_to_kilo(
  p_sack_option_id uuid,
  p_kilo_option_id uuid,
  p_sack_quantity integer DEFAULT 1,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Package conversion is no longer supported; adjust the product base stock instead';
END;
$$;

REVOKE ALL ON FUNCTION public.open_sack_to_kilo(uuid, uuid, integer, text) FROM PUBLIC, anon, authenticated;

-- 5. Server-authoritative POS sale processing. It prices bulk options from
-- product.selling_price and the stored discount rule, then snapshots the
-- exact result before the stock trigger consumes base units.
CREATE OR REPLACE FUNCTION public.process_pos_sale_v3(
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
  p_tax_rate numeric DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_customer_tin text DEFAULT NULL,
  p_customer_address text DEFAULT NULL,
  p_terminal_identifier text DEFAULT NULL,
  p_discount_category text DEFAULT 'regular'
)
RETURNS public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
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
  v_multiplier numeric;
  v_required_base numeric;
  v_unit_price numeric;
  v_line_total numeric;
  v_regular_unit_price numeric;
  v_regular_value numeric;
  v_bulk_discount_type text;
  v_bulk_discount_value numeric;
  v_bulk_discount_amount numeric;
  v_category_name text;
  v_option_label text;
  v_unit_label text;
  v_package_size numeric;
  v_package_unit text;
  v_purchase_mode text;
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

  SELECT role::text INTO v_role
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_role NOT IN ('admin', 'cashier') THEN
    RAISE EXCEPTION 'Only store admins or cashiers can process sales';
  END IF;

  IF NOT public.user_belongs_to_store(p_store_id) THEN
    RAISE EXCEPTION 'User is not assigned to this store';
  END IF;

  IF COALESCE(p_discount_category, 'regular') NOT IN ('regular', 'senior', 'pwd', 'other') THEN
    RAISE EXCEPTION 'Invalid discount category';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Sale must contain at least one item';
  END IF;

  -- Lock each product once and reserve the combined base-unit requirement so
  -- two purchase modes for the same product cannot oversell one another.
  FOR v_product_id IN
    SELECT DISTINCT (line.value->>'productId')::uuid
    FROM jsonb_array_elements(p_items) AS line(value)
    ORDER BY 1
  LOOP
    SELECT * INTO v_product
    FROM public.products
    WHERE id = v_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % does not exist', v_product_id;
    END IF;
    IF v_product.store_id <> p_store_id THEN
      RAISE EXCEPTION 'Product % does not belong to sale store %', v_product_id, p_store_id;
    END IF;

    SELECT COALESCE(SUM(
      (line.value->>'quantity')::numeric * CASE
        WHEN COALESCE(opt.is_bulk, false)
          THEN GREATEST(COALESCE(opt.inventory_multiplier, opt.quantity_value, 1), 2)
        ELSE 1
      END
    ), 0)
    INTO v_required_base
    FROM jsonb_array_elements(p_items) AS line(value)
    LEFT JOIN public.product_selling_options opt
      ON opt.id = NULLIF(line.value->>'sellingOptionId', '')::uuid
    WHERE (line.value->>'productId')::uuid = v_product_id;

    IF v_required_base <= 0 THEN
      RAISE EXCEPTION 'Sale item quantity must be greater than zero';
    END IF;
    IF v_product.current_stock < v_required_base THEN
      RAISE EXCEPTION 'Insufficient base stock for %. Available base units %, required base units %',
        v_product.name, v_product.current_stock, v_required_base;
    END IF;
  END LOOP;

  -- Validate every option and calculate the subtotal from server-side prices.
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

    SELECT * INTO v_product
    FROM public.products
    WHERE id = v_product_id;

    v_option := NULL;
    v_multiplier := 1;
    v_purchase_mode := 'unit';
    v_unit_price := v_product.selling_price;

    IF v_option_id IS NOT NULL THEN
      SELECT * INTO v_option
      FROM public.product_selling_options
      WHERE id = v_option_id
      FOR UPDATE;

      IF NOT FOUND
        OR v_option.product_id <> v_product_id
        OR v_option.store_id <> p_store_id THEN
        RAISE EXCEPTION 'Selling option % does not belong to sale product/store', v_option_id;
      END IF;
      IF NOT v_option.is_active THEN
        RAISE EXCEPTION 'Selling option % is disabled', v_option.label;
      END IF;

      IF v_option.is_bulk THEN
        IF NOT v_product.bulk_purchase_enabled THEN
          RAISE EXCEPTION 'Bulk purchasing is disabled for %', v_product.name;
        END IF;

        v_purchase_mode := 'bulk';
        v_multiplier := GREATEST(COALESCE(v_option.inventory_multiplier, v_option.quantity_value, 1), 2);
        v_bulk_discount_type := COALESCE(NULLIF(v_option.discount_type, ''), 'percent');
        v_bulk_discount_value := GREATEST(COALESCE(v_option.discount_value, 0), 0);
        v_regular_unit_price := v_product.selling_price;
        v_regular_value := round(v_regular_unit_price * v_multiplier, 2);

        IF v_bulk_discount_type = 'percent' THEN
          IF v_bulk_discount_value > 100 THEN
            RAISE EXCEPTION 'Bulk percentage discount cannot exceed 100';
          END IF;
          v_unit_price := round(
            v_regular_value * (1 - v_bulk_discount_value / 100),
            2
          );
        ELSE
          v_unit_price := round(
            GREATEST(v_regular_value - v_bulk_discount_value, 0),
            2
          );
        END IF;
      ELSE
        v_regular_unit_price := v_product.selling_price;
        v_regular_value := v_regular_unit_price;
        v_bulk_discount_type := NULL;
        v_bulk_discount_value := NULL;
        v_unit_price := v_product.selling_price;
      END IF;
    ELSE
      v_regular_unit_price := v_product.selling_price;
      v_regular_value := v_regular_unit_price;
      v_bulk_discount_type := NULL;
      v_bulk_discount_value := NULL;
    END IF;

    v_line_total := round(v_unit_price * v_qty, 2);
    v_subtotal := v_subtotal + v_line_total;
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

  SELECT CASE
    WHEN COALESCE(p_discount_category, 'regular') IN ('senior', 'pwd') THEN 0
    ELSE COALESCE(p_tax_rate, tax_rate, 0)
  END
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
    receipt_number,
    customer_name,
    customer_tin,
    customer_address,
    terminal_identifier,
    discount_category
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
    v_receipt_number,
    NULLIF(trim(COALESCE(p_customer_name, '')), ''),
    NULLIF(trim(COALESCE(p_customer_tin, '')), ''),
    NULLIF(trim(COALESCE(p_customer_address, '')), ''),
    NULLIF(trim(COALESCE(p_terminal_identifier, '')), ''),
    COALESCE(p_discount_category, 'regular')
  )
  RETURNING * INTO v_sale;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS line(value)
  LOOP
    v_product_id := (v_item->>'productId')::uuid;
    v_option_id := NULLIF(v_item->>'sellingOptionId', '')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    v_option := NULL;
    v_multiplier := 1;
    v_purchase_mode := 'unit';
    v_unit_price := NULL;
    v_regular_unit_price := v_product.selling_price;
    v_regular_value := NULL;
    v_bulk_discount_type := NULL;
    v_bulk_discount_value := NULL;
    v_bulk_discount_amount := NULL;
    v_option_label := NULL;
    v_unit_label := NULL;
    v_package_size := NULL;
    v_package_unit := NULL;

    SELECT * INTO v_product
    FROM public.products
    WHERE id = v_product_id;

    SELECT c.name INTO v_category_name
    FROM public.categories c
    WHERE c.id = v_product.category_id;

    IF v_option_id IS NOT NULL THEN
      SELECT * INTO v_option
      FROM public.product_selling_options
      WHERE id = v_option_id;

      v_option_label := v_option.label;
      v_unit_label := COALESCE(v_product.unit, v_option.unit_label, 'unit');

      IF v_option.is_bulk THEN
        v_purchase_mode := 'bulk';
        v_multiplier := GREATEST(COALESCE(v_option.inventory_multiplier, v_option.quantity_value, 1), 2);
        v_regular_unit_price := v_product.selling_price;
        v_regular_value := round(v_regular_unit_price * v_qty * v_multiplier, 2);
        v_bulk_discount_type := COALESCE(NULLIF(v_option.discount_type, ''), 'percent');
        v_bulk_discount_value := GREATEST(COALESCE(v_option.discount_value, 0), 0);
        IF v_bulk_discount_type = 'percent' THEN
          v_unit_price := round(
            round(v_regular_unit_price * v_multiplier, 2)
            * (1 - v_bulk_discount_value / 100),
            2
          );
        ELSE
          v_unit_price := round(
            GREATEST(round(v_regular_unit_price * v_multiplier, 2) - v_bulk_discount_value, 0),
            2
          );
        END IF;
        v_bulk_discount_amount := GREATEST(v_regular_value - round(v_unit_price * v_qty, 2), 0);
        v_package_size := v_multiplier;
        v_package_unit := COALESCE(v_product.unit, 'unit');
      ELSE
        v_unit_price := v_product.selling_price;
        v_regular_unit_price := v_product.selling_price;
        v_regular_value := round(v_regular_unit_price * v_qty, 2);
      END IF;
    ELSE
      v_option_label := COALESCE(v_product.unit, 'unit');
      v_unit_label := COALESCE(v_product.unit, 'unit');
      v_unit_price := v_product.selling_price;
      v_regular_unit_price := v_product.selling_price;
      v_regular_value := round(v_regular_unit_price * v_qty, 2);
    END IF;

    v_line_total := round(v_unit_price * v_qty, 2);

    INSERT INTO public.sale_items (
      sale_id,
      product_id,
      product_name,
      category_id,
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
      line_total,
      purchase_mode,
      bulk_option_id,
      bulk_option_label,
      bulk_quantity,
      units_per_package,
      base_unit_quantity,
      regular_unit_price,
      regular_value,
      bulk_discount_type,
      bulk_discount_value,
      bulk_discount_amount,
      final_selling_price
    )
    VALUES (
      v_sale.id,
      v_product.id,
      v_product.name,
      v_product.category_id,
      COALESCE(v_category_name, 'Uncategorized'),
      v_option_id,
      COALESCE(v_option_label, v_item->>'sellingOptionLabel', v_unit_label, 'unit'),
      COALESCE(v_unit_label, v_item->>'unitLabel', 'unit'),
      v_package_size,
      v_package_unit,
      'product',
      v_qty,
      v_unit_price,
      v_product.cost_price * v_multiplier,
      v_line_total,
      v_purchase_mode,
      CASE WHEN v_purchase_mode = 'bulk' THEN v_option_id ELSE NULL END,
      CASE WHEN v_purchase_mode = 'bulk' THEN v_option_label ELSE NULL END,
      CASE WHEN v_purchase_mode = 'bulk' THEN v_qty ELSE NULL END,
      v_multiplier,
      v_qty * v_multiplier,
      v_regular_unit_price,
      v_regular_value,
      v_bulk_discount_type,
      v_bulk_discount_value,
      v_bulk_discount_amount,
      v_unit_price
    );
  END LOOP;

  INSERT INTO public.sale_payments (
    sale_id, store_id, method, status, amount, amount_tendered,
    change_amount, reference_number, created_by
  )
  VALUES (
    v_sale.id, p_store_id, p_payment_method, 'captured', v_total,
    v_tendered, v_change, p_payment_reference, auth.uid()
  );

  INSERT INTO public.receipts(sale_id, store_id, receipt_number, issued_by, payload)
  VALUES (
    v_sale.id,
    p_store_id,
    v_receipt_number,
    auth.uid(),
    private.build_receipt_snapshot(v_sale.id)
  );

  INSERT INTO public.sale_events(sale_id, store_id, event_type, amount, actor_id, metadata)
  VALUES (
    v_sale.id,
    p_store_id,
    'completed',
    v_total,
    auth.uid(),
    jsonb_build_object('receiptNumber', v_receipt_number)
  );

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

REVOKE ALL ON FUNCTION public.process_pos_sale_v3(
  uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, jsonb,
  public.payment_method, text, text, numeric, numeric, text, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_pos_sale_v3(
  uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, jsonb,
  public.payment_method, text, text, numeric, numeric, text, text, text, text, text
) TO authenticated;

-- 6. Reporting and velocity use base units while retaining package counts.
DROP VIEW IF EXISTS public.v_product_rankings;
CREATE VIEW public.v_product_rankings
WITH (security_invoker = true)
AS
SELECT
  rank() OVER (ORDER BY SUM(si.line_total) DESC) AS rank,
  si.product_id,
  MAX(si.product_name) AS product_name,
  MAX(COALESCE(si.category_name, 'Uncategorized')) AS category_name,
  NULL::uuid AS selling_option_id,
  'Multiple purchase modes'::text AS selling_option_label,
  MAX(COALESCE(si.unit_label, 'unit')) AS unit_label,
  NULL::numeric AS package_size,
  NULL::text AS package_unit,
  SUM(COALESCE(si.base_unit_quantity, si.quantity)) AS units_sold,
  SUM(si.quantity) AS packages_sold,
  SUM(si.line_total) AS revenue,
  SUM(si.quantity * si.cost_price) AS cost,
  SUM(si.line_total - (si.quantity * si.cost_price)) AS gross_profit,
  ROUND(
    100.0 * SUM(si.line_total) /
    NULLIF(SUM(SUM(si.line_total)) OVER (), 0),
    1
  ) AS percentage_of_total
FROM public.sale_items si
JOIN public.sales s ON s.id = si.sale_id
WHERE s.status <> 'voided'
GROUP BY si.product_id;

DROP VIEW IF EXISTS public.v_sales_by_selling_option;
CREATE VIEW public.v_sales_by_selling_option
WITH (security_invoker = true)
AS
SELECT
  s.store_id,
  si.product_id,
  si.product_name,
  COALESCE(si.category_name, 'Uncategorized') AS category_name,
  si.selling_option_id,
  COALESCE(si.selling_option_label, si.unit_label, 'unit') AS selling_option_label,
  COALESCE(si.unit_label, 'unit') AS unit_label,
  si.package_size,
  si.package_unit,
  si.purchase_mode,
  SUM(si.quantity) AS quantity_sold,
  SUM(COALESCE(si.base_unit_quantity, si.quantity)) AS base_units_sold,
  SUM(si.line_total) AS revenue,
  SUM(si.quantity * si.cost_price) AS cost,
  SUM(si.line_total - (si.quantity * si.cost_price)) AS gross_profit
FROM public.sale_items si
JOIN public.sales s ON s.id = si.sale_id
WHERE s.status <> 'voided'
GROUP BY
  s.store_id,
  si.product_id,
  si.product_name,
  COALESCE(si.category_name, 'Uncategorized'),
  si.selling_option_id,
  COALESCE(si.selling_option_label, si.unit_label, 'unit'),
  COALESCE(si.unit_label, 'unit'),
  si.package_size,
  si.package_unit,
  si.purchase_mode;

CREATE OR REPLACE VIEW public.v_sales_report_lines
WITH (security_invoker = true)
AS
SELECT
  s.store_id,
  s.id AS sale_id,
  s.receipt_number,
  s.cashier_id,
  s.payment_method,
  s.status,
  s.created_at AS transaction_at,
  si.id AS sale_item_id,
  si.product_id,
  si.product_name,
  COALESCE(si.category_name, 'Uncategorized') AS category_name,
  si.selling_option_id,
  COALESCE(si.selling_option_label, si.unit_label, 'unit') AS selling_option_label,
  COALESCE(si.unit_label, 'unit') AS unit_label,
  si.package_size,
  si.package_unit,
  si.quantity,
  si.unit_price,
  si.cost_price,
  si.line_total,
  si.purchase_mode,
  si.bulk_option_id,
  si.bulk_option_label,
  si.bulk_quantity,
  si.units_per_package,
  si.base_unit_quantity,
  si.regular_unit_price,
  si.regular_value,
  si.bulk_discount_type,
  si.bulk_discount_value,
  si.bulk_discount_amount,
  si.final_selling_price
FROM public.sales s
JOIN public.sale_items si ON si.sale_id = s.id;

CREATE OR REPLACE FUNCTION public.get_sales_velocity(
  p_store_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz
)
RETURNS TABLE (
  product_id uuid,
  units_sold numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
    OR COALESCE(public.current_user_role()::text, '') NOT IN ('admin', 'inventory') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at < p_start_at THEN
    RAISE EXCEPTION 'Invalid sales velocity date range';
  END IF;

  RETURN QUERY
  WITH returned AS (
    SELECT sri.sale_item_id, SUM(sri.quantity)::numeric AS returned_quantity
    FROM public.sale_return_items sri
    JOIN public.sale_returns sr ON sr.id = sri.return_id
    WHERE sr.status = 'completed'
    GROUP BY sri.sale_item_id
  )
  SELECT
    si.product_id,
    SUM(GREATEST(
      COALESCE(si.base_unit_quantity, si.quantity * CASE
        WHEN COALESCE(pso.is_bulk, false)
          THEN GREATEST(COALESCE(pso.inventory_multiplier, pso.quantity_value, 1), 2)
        ELSE 1
      END)
      - COALESCE(returned.returned_quantity, 0) * CASE
        WHEN COALESCE(pso.is_bulk, false)
          THEN GREATEST(COALESCE(pso.inventory_multiplier, pso.quantity_value, 1), 2)
        ELSE 1
      END,
      0
    ))::numeric AS units_sold
  FROM public.sales sale
  JOIN public.sale_items si ON si.sale_id = sale.id
  LEFT JOIN returned ON returned.sale_item_id = si.id
  LEFT JOIN public.product_selling_options pso ON pso.id = si.selling_option_id
  WHERE sale.status = 'completed'
    AND sale.created_at >= p_start_at
    AND sale.created_at <= p_end_at
    AND (p_store_id IS NULL OR sale.store_id = p_store_id)
    AND public.user_belongs_to_store(sale.store_id)
    AND si.product_id IS NOT NULL
    AND si.stock_source = 'product'
  GROUP BY si.product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_sales_velocity(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_velocity(uuid, timestamptz, timestamptz) TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.products TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.product_selling_options TO authenticated;
GRANT SELECT ON public.v_product_rankings TO authenticated;
GRANT SELECT ON public.v_sales_by_selling_option TO authenticated;
GRANT SELECT ON public.v_sales_report_lines TO authenticated;
