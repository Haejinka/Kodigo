-- Migration 37: unit-aware receiving, fixed bundle prices, immutable cost
-- snapshots, and auditable price history.
--
-- Product stock and product.cost_price are base-unit values. Package prices
-- are entered as a delivery total and are converted at the database boundary.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS price_rounding numeric(12,2) NOT NULL DEFAULT 1;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_price_rounding_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_price_rounding_check CHECK (price_rounding > 0);

ALTER TABLE public.product_selling_options
  ADD COLUMN IF NOT EXISTS pricing_method text NOT NULL DEFAULT 'percent',
  ADD COLUMN IF NOT EXISTS manual_selling_price numeric(10,2);

UPDATE public.product_selling_options
SET pricing_method = CASE
  WHEN discount_type = 'amount' THEN 'amount'
  ELSE 'percent'
END
WHERE pricing_method IS NULL OR pricing_method = '';

ALTER TABLE public.product_selling_options DROP CONSTRAINT IF EXISTS product_selling_options_pricing_method_check;
ALTER TABLE public.product_selling_options
  ADD CONSTRAINT product_selling_options_pricing_method_check
  CHECK (pricing_method IN ('fixed', 'percent', 'amount'));

ALTER TABLE public.product_selling_options DROP CONSTRAINT IF EXISTS product_selling_options_manual_price_check;
ALTER TABLE public.product_selling_options
  ADD CONSTRAINT product_selling_options_manual_price_check
  CHECK (manual_selling_price IS NULL OR manual_selling_price >= 0);

-- A product may be received in several package formats, while one default is
-- used for suggestions and purchase-order display.
CREATE TABLE IF NOT EXISTS public.product_restocking_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  label text NOT NULL,
  conversion_factor numeric(12,3) NOT NULL DEFAULT 1 CHECK (conversion_factor >= 1),
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_restocking_options_label_check CHECK (length(trim(label)) > 0)
);

CREATE INDEX IF NOT EXISTS product_restocking_options_product_idx
  ON public.product_restocking_options(product_id, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS product_restocking_options_label_idx
  ON public.product_restocking_options(product_id, lower(label))
  WHERE is_active;
CREATE UNIQUE INDEX IF NOT EXISTS product_restocking_options_default_idx
  ON public.product_restocking_options(product_id)
  WHERE is_default AND is_active;

CREATE OR REPLACE FUNCTION public.trg_product_restocking_options_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_product_restocking_options_updated_at() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_product_restocking_options_updated_at ON public.product_restocking_options;
CREATE TRIGGER trg_product_restocking_options_updated_at
BEFORE UPDATE ON public.product_restocking_options
FOR EACH ROW EXECUTE FUNCTION public.trg_product_restocking_options_updated_at();

CREATE OR REPLACE FUNCTION public.validate_product_restocking_option_store()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id uuid;
BEGIN
  SELECT store_id INTO v_store_id FROM public.products WHERE id = NEW.product_id;
  IF v_store_id IS NULL OR v_store_id <> NEW.store_id THEN
    RAISE EXCEPTION 'Restocking option product/store mismatch';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_product_restocking_option_store() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS validate_product_restocking_option_store_trigger ON public.product_restocking_options;
CREATE TRIGGER validate_product_restocking_option_store_trigger
BEFORE INSERT OR UPDATE OF product_id, store_id ON public.product_restocking_options
FOR EACH ROW EXECUTE FUNCTION public.validate_product_restocking_option_store();

-- Backfill the legacy one-package configuration. New products write this
-- table directly; the legacy columns remain for compatibility with older UI.
INSERT INTO public.product_restocking_options(product_id, store_id, label, conversion_factor, is_default, is_active)
SELECT p.id, p.store_id, trim(p.purchase_unit), greatest(coalesce(p.conversion_factor, 1), 1), true, true
FROM public.products p
WHERE nullif(trim(coalesce(p.purchase_unit, '')), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.product_restocking_options ro WHERE ro.product_id = p.id
  )
ON CONFLICT DO NOTHING;

ALTER TABLE public.product_restocking_options ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "product restocking options: scoped read" ON public.product_restocking_options;
CREATE POLICY "product restocking options: scoped read"
ON public.product_restocking_options FOR SELECT TO authenticated
USING (public.user_belongs_to_store(store_id));

DROP POLICY IF EXISTS "product restocking options: scoped write" ON public.product_restocking_options;
CREATE POLICY "product restocking options: scoped write"
ON public.product_restocking_options FOR ALL TO authenticated
USING (
  public.current_user_role()::text IN ('admin', 'inventory')
  AND public.user_belongs_to_store(store_id)
)
WITH CHECK (
  public.current_user_role()::text IN ('admin', 'inventory')
  AND public.user_belongs_to_store(store_id)
);

REVOKE ALL ON public.product_restocking_options FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_restocking_options TO authenticated;

ALTER TABLE public.restock_history
  ADD COLUMN IF NOT EXISTS restocking_option_id uuid REFERENCES public.product_restocking_options(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS total_supplier_cost numeric(12,2),
  ADD COLUMN IF NOT EXISTS cost_before numeric(12,4),
  ADD COLUMN IF NOT EXISTS cost_after numeric(12,4),
  ADD COLUMN IF NOT EXISTS cost_change_percent numeric(12,4),
  ADD COLUMN IF NOT EXISTS suggested_selling_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS raw_suggested_selling_price numeric(12,4),
  ADD COLUMN IF NOT EXISTS price_rounding numeric(12,2);

CREATE INDEX IF NOT EXISTS restock_history_option_idx
  ON public.restock_history(restocking_option_id);

-- Price changes are append-only history. The browser can read this table, but
-- only the trigger can write it.
CREATE TABLE IF NOT EXISTS public.product_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  change_type text NOT NULL CHECK (change_type IN ('supplier_cost', 'selling_price')),
  previous_value numeric(12,4) NOT NULL,
  new_value numeric(12,4) NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_price_history_store_date_idx
  ON public.product_price_history(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS product_price_history_product_date_idx
  ON public.product_price_history(product_id, created_at DESC);

ALTER TABLE public.product_price_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "product price history: scoped read" ON public.product_price_history;
CREATE POLICY "product price history: scoped read"
ON public.product_price_history FOR SELECT TO authenticated
USING (public.user_belongs_to_store(store_id));

REVOKE ALL ON public.product_price_history FROM anon, authenticated;
GRANT SELECT ON public.product_price_history TO authenticated;

CREATE OR REPLACE FUNCTION private.record_product_price_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF OLD.cost_price IS DISTINCT FROM NEW.cost_price THEN
    INSERT INTO public.product_price_history(
      store_id, product_id, product_name, change_type,
      previous_value, new_value, reason, created_by
    ) VALUES (
      NEW.store_id, NEW.id, NEW.name, 'supplier_cost',
      coalesce(OLD.cost_price, 0), coalesce(NEW.cost_price, 0),
      'Supplier cost update', auth.uid()
    );
  END IF;
  IF OLD.selling_price IS DISTINCT FROM NEW.selling_price THEN
    INSERT INTO public.product_price_history(
      store_id, product_id, product_name, change_type,
      previous_value, new_value, reason, created_by
    ) VALUES (
      NEW.store_id, NEW.id, NEW.name, 'selling_price',
      coalesce(OLD.selling_price, 0), coalesce(NEW.selling_price, 0),
      'Owner price update', auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.record_product_price_history() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS record_product_price_history_trigger ON public.products;
CREATE TRIGGER record_product_price_history_trigger
AFTER UPDATE OF cost_price, selling_price ON public.products
FOR EACH ROW EXECUTE FUNCTION private.record_product_price_history();

-- Keep fixed bundle prices fixed when the base selling price changes. Percent
-- and amount rules are recalculated from their stored rule.
CREATE OR REPLACE FUNCTION private.sync_fixed_bundle_price_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  UPDATE public.product_selling_options
  SET discount_type = CASE WHEN pricing_method = 'fixed' THEN 'amount' ELSE discount_type END,
      discount_value = CASE
        WHEN pricing_method = 'fixed' THEN greatest(
          round(NEW.selling_price * greatest(coalesce(inventory_multiplier, quantity_value, 1), 1), 2)
            - coalesce(manual_selling_price, selling_price),
          0
        )
        ELSE discount_value
      END,
      selling_price = CASE
        WHEN pricing_method = 'fixed' THEN coalesce(manual_selling_price, selling_price)
        WHEN pricing_method = 'percent' THEN round(
          round(NEW.selling_price * greatest(coalesce(inventory_multiplier, quantity_value, 1), 1), 2)
            * (1 - least(greatest(coalesce(discount_value, 0), 0), 100) / 100),
          2
        )
        WHEN pricing_method = 'amount' THEN greatest(
          round(NEW.selling_price * greatest(coalesce(inventory_multiplier, quantity_value, 1), 1), 2)
            - greatest(coalesce(discount_value, 0), 0),
          0
        )
        ELSE selling_price
      END,
      updated_at = now()
  WHERE product_id = NEW.id
    AND is_bulk
    AND pricing_method = 'fixed';
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_fixed_bundle_price_rules() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS sync_fixed_bundle_price_rules_trigger ON public.products;
CREATE TRIGGER sync_fixed_bundle_price_rules_trigger
AFTER UPDATE OF selling_price ON public.products
FOR EACH ROW
WHEN (OLD.selling_price IS DISTINCT FROM NEW.selling_price)
EXECUTE FUNCTION private.sync_fixed_bundle_price_rules();

-- The sale row stores the cost and margin at the time of sale. These values
-- are never re-read from the current product for historical reporting.
ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS base_unit_label text,
  ADD COLUMN IF NOT EXISTS cost_per_base_unit numeric(12,4),
  ADD COLUMN IF NOT EXISTS cogs numeric(12,2),
  ADD COLUMN IF NOT EXISTS gross_profit numeric(12,2),
  ADD COLUMN IF NOT EXISTS gross_margin numeric(12,6);

UPDATE public.sale_items
SET base_unit_label = coalesce(base_unit_label, unit_label, 'unit'),
    cogs = coalesce(cogs, round(coalesce(cost_price, 0) * quantity, 2)),
    cost_per_base_unit = coalesce(
      cost_per_base_unit,
      round(
        (coalesce(cost_price, 0) * quantity)
          / greatest(coalesce(base_unit_quantity, quantity * greatest(coalesce(units_per_package, package_size, 1), 1)), 1),
        4
      )
    ),
    gross_profit = coalesce(gross_profit, round(line_total - coalesce(cost_price, 0) * quantity, 2)),
    gross_margin = coalesce(
      gross_margin,
      CASE WHEN line_total > 0 THEN (line_total - coalesce(cost_price, 0) * quantity) / line_total ELSE 0 END
    )
WHERE base_unit_label IS NULL
   OR cost_per_base_unit IS NULL
   OR cogs IS NULL
   OR gross_profit IS NULL
   OR gross_margin IS NULL;

CREATE OR REPLACE FUNCTION private.set_sale_item_purchase_cost()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, private
AS $$
DECLARE
  v_piece_cost numeric := 0;
  v_product_unit text := 'unit';
  v_multiplier numeric := 1;
  v_base_quantity numeric;
BEGIN
  SELECT coalesce(cost_price, 0), coalesce(unit, 'unit')
  INTO v_piece_cost, v_product_unit
  FROM public.products
  WHERE id = NEW.product_id;

  IF NEW.selling_option_id IS NOT NULL THEN
    SELECT CASE
      WHEN is_bulk THEN greatest(coalesce(inventory_multiplier, quantity_value, 1), 2)
      ELSE 1
    END
    INTO v_multiplier
    FROM public.product_selling_options
    WHERE id = NEW.selling_option_id;
  END IF;

  v_base_quantity := greatest(NEW.quantity * v_multiplier, 0);
  NEW.base_unit_quantity := v_base_quantity;
  NEW.units_per_package := v_multiplier;
  NEW.base_unit_label := coalesce(v_product_unit, 'unit');
  NEW.stock_source := 'product';
  NEW.cost_price := round(v_piece_cost * v_multiplier, 4);
  NEW.cost_per_base_unit := round(v_piece_cost, 4);
  NEW.cogs := round(v_piece_cost * v_base_quantity, 2);
  NEW.gross_profit := round(coalesce(NEW.line_total, 0) - NEW.cogs, 2);
  NEW.gross_margin := CASE
    WHEN coalesce(NEW.line_total, 0) > 0 THEN NEW.gross_profit / NEW.line_total
    ELSE 0
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.set_sale_item_purchase_cost() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS zzz_set_sale_item_purchase_cost_trigger ON public.sale_items;
CREATE TRIGGER zzz_set_sale_item_purchase_cost_trigger
BEFORE INSERT ON public.sale_items
FOR EACH ROW EXECUTE FUNCTION private.set_sale_item_purchase_cost();

CREATE OR REPLACE FUNCTION private.prevent_sale_item_snapshot_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Completed sale item snapshots are immutable';
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_sale_item_snapshot_update() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS prevent_sale_item_snapshot_update_trigger ON public.sale_items;
CREATE TRIGGER prevent_sale_item_snapshot_update_trigger
BEFORE UPDATE ON public.sale_items
FOR EACH ROW EXECUTE FUNCTION private.prevent_sale_item_snapshot_update();

-- Receive supplier packages and convert them to base stock in one locked
-- transaction. Selling price is deliberately not changed here.
CREATE OR REPLACE FUNCTION public.restock_product_inventory_v2(
  p_product_id uuid,
  p_restocking_option_id uuid DEFAULT NULL,
  p_quantity_in_purchase_units numeric DEFAULT NULL,
  p_purchase_unit text DEFAULT NULL,
  p_pieces_per_purchase_unit numeric DEFAULT NULL,
  p_total_supplier_cost numeric DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_restocking_option public.product_restocking_options%ROWTYPE;
  v_before numeric;
  v_after numeric;
  v_quantity numeric := coalesce(p_quantity_in_purchase_units, 0);
  v_factor numeric := coalesce(p_pieces_per_purchase_unit, 1);
  v_unit text := nullif(trim(coalesce(p_purchase_unit, '')), '');
  v_base_units numeric;
  v_old_cost numeric;
  v_new_cost numeric;
  v_total_cost numeric := p_total_supplier_cost;
  v_cost_change_percent numeric;
  v_previous_gross_margin numeric;
  v_new_gross_margin numeric;
  v_raw_suggested_price numeric;
  v_suggested_price numeric;
  v_rounding numeric;
  v_restock_id uuid := gen_random_uuid();
  v_adjustment_id uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role()::text NOT IN ('admin', 'inventory') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_quantity <= 0 OR v_quantity <> v_quantity THEN
    RAISE EXCEPTION 'Quantity received must be greater than zero';
  END IF;
  IF p_total_supplier_cost IS NOT NULL AND p_total_supplier_cost < 0 THEN
    RAISE EXCEPTION 'Supplier cost cannot be negative';
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;
  IF NOT FOUND OR NOT public.user_belongs_to_store(v_product.store_id) THEN
    RAISE EXCEPTION 'Product not found or access denied';
  END IF;

  IF p_restocking_option_id IS NOT NULL THEN
    SELECT * INTO v_restocking_option
    FROM public.product_restocking_options
    WHERE id = p_restocking_option_id
      AND product_id = p_product_id
      AND store_id = v_product.store_id
      AND is_active
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Restocking option not found or inactive';
    END IF;
    v_unit := v_restocking_option.label;
    v_factor := v_restocking_option.conversion_factor;
  END IF;

  v_unit := coalesce(v_unit, nullif(trim(coalesce(v_product.purchase_unit, '')), ''), v_product.unit, 'unit');
  IF v_factor < 1 OR v_factor <> v_factor THEN
    RAISE EXCEPTION 'Conversion factor must be at least one';
  END IF;
  v_base_units := round(v_quantity * v_factor, 3);
  v_before := coalesce(v_product.current_stock, 0);
  v_after := v_before + v_base_units;
  v_old_cost := coalesce(v_product.cost_price, 0);
  v_new_cost := CASE
    WHEN v_total_cost IS NULL THEN v_old_cost
    ELSE round(v_total_cost / greatest(v_base_units, 1), 4)
  END;

  IF v_old_cost > 0 THEN
    v_cost_change_percent := round((v_new_cost - v_old_cost) / v_old_cost * 100, 4);
  ELSIF v_new_cost > 0 THEN
    v_cost_change_percent := 100;
  ELSE
    v_cost_change_percent := 0;
  END IF;

  v_raw_suggested_price := CASE
    WHEN v_new_cost > 0 AND v_product.margin_percentage IS NOT NULL
      THEN v_new_cost / greatest(1 - v_product.margin_percentage / 100, 0.0001)
    WHEN v_new_cost > 0 AND v_old_cost > 0
      THEN coalesce(v_product.selling_price, 0) * v_new_cost / v_old_cost
    ELSE coalesce(v_product.selling_price, 0)
  END;
  v_rounding := greatest(coalesce(v_product.price_rounding, 1), 0.01);
  v_previous_gross_margin := CASE
    WHEN coalesce(v_product.selling_price, 0) > 0
      THEN (v_product.selling_price - v_old_cost) / v_product.selling_price
    ELSE 0
  END;
  v_new_gross_margin := CASE
    WHEN coalesce(v_product.selling_price, 0) > 0
      THEN (v_product.selling_price - v_new_cost) / v_product.selling_price
    ELSE 0
  END;
  v_suggested_price := CASE
    WHEN v_raw_suggested_price > 0 THEN ceil(v_raw_suggested_price / v_rounding) * v_rounding
    ELSE 0
  END;

  UPDATE public.products
  SET current_stock = round(v_after),
      cost_price = CASE WHEN v_total_cost IS NULL THEN cost_price ELSE v_new_cost END,
      purchase_unit = v_unit,
      conversion_factor = round(v_factor),
      bulk_purchase_price = CASE WHEN v_total_cost IS NULL THEN bulk_purchase_price ELSE round(v_total_cost / greatest(v_quantity, 1), 2) END,
      updated_at = now()
  WHERE id = p_product_id;
  PERFORM private.sync_shared_option_stock(p_product_id, v_after);

  INSERT INTO public.restock_history(
    id, store_id, product_id, restocking_option_id,
    quantity_in_purchase_units, purchase_unit, pieces_per_purchase_unit,
    pieces_added, purchase_price_per_unit, purchase_price_per_piece,
    total_supplier_cost, cost_before, cost_after, cost_change_percent,
    suggested_selling_price, raw_suggested_selling_price, price_rounding,
    stock_before, stock_after, restocked_by, note
  ) VALUES (
    v_restock_id, v_product.store_id, p_product_id, p_restocking_option_id,
    v_quantity, v_unit, v_factor, v_base_units,
    CASE WHEN v_total_cost IS NULL THEN 0 ELSE round(v_total_cost / greatest(v_quantity, 1), 2) END,
    v_new_cost, v_total_cost, v_old_cost, v_new_cost, v_cost_change_percent,
    v_suggested_price, v_raw_suggested_price, v_rounding,
    v_before, v_after, auth.uid(), coalesce(p_note, '')
  );

  INSERT INTO public.stock_adjustments(
    id, store_id, product_id, unit_label, package_size, package_unit,
    stock_source, reason, quantity_delta, stock_before, stock_after,
    note, created_by
  ) VALUES (
    v_adjustment_id, v_product.store_id, p_product_id, v_product.unit,
    v_factor, v_unit, 'product', 'restock', v_base_units,
    v_before, v_after, coalesce(p_note, ''), auth.uid()
  );

  RETURN jsonb_build_object(
    'restockId', v_restock_id,
    'productId', p_product_id,
    'purchaseUnit', v_unit,
    'quantityReceived', v_quantity,
    'conversionFactor', v_factor,
    'baseUnitsAdded', v_base_units,
    'stockBefore', v_before,
    'stockAfter', v_after,
    'totalSupplierCost', v_total_cost,
    'previousCostPerBaseUnit', v_old_cost,
    'newCostPerBaseUnit', v_new_cost,
    'costChangePercent', v_cost_change_percent,
    'previousGrossMargin', v_previous_gross_margin,
    'newGrossMargin', v_new_gross_margin,
    'currentSellingPrice', coalesce(v_product.selling_price, 0),
    'suggestedSellingPrice', v_suggested_price,
    'rawSuggestedSellingPrice', v_raw_suggested_price,
    'priceRounding', v_rounding
  );
END;
$$;

REVOKE ALL ON FUNCTION public.restock_product_inventory_v2(uuid, uuid, numeric, text, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restock_product_inventory_v2(uuid, uuid, numeric, text, numeric, numeric, text) TO authenticated;

-- Older clients used the legacy signature. Route it through the same
-- no-silent-price-change implementation so an older browser cannot overwrite
-- the live selling price during receipt.
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
BEGIN
  RETURN public.restock_product_inventory_v2(
    p_product_id,
    NULL,
    p_quantity_in_purchase_units,
    p_purchase_unit,
    p_pieces_per_purchase_unit,
    p_purchase_price_per_unit * p_quantity_in_purchase_units,
    p_note
  );
END;
$$;

REVOKE ALL ON FUNCTION public.restock_product_inventory(uuid, numeric, text, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restock_product_inventory(uuid, numeric, text, numeric, numeric, text) TO authenticated;

-- Keep the reporting view useful to SQL clients as well as the frontend.
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
  si.final_selling_price,
  si.base_unit_label,
  si.cost_per_base_unit,
  si.cogs,
  si.gross_profit,
  si.gross_margin
FROM public.sales s
JOIN public.sale_items si ON si.sale_id = s.id;

GRANT SELECT ON public.v_sales_report_lines TO authenticated;
