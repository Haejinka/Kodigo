-- Base-unit inventory, bulk purchasing, automatic pricing, and auditable restocking.
-- The Supabase CLI is not installed in this workspace, so this migration was
-- created directly using the repository's existing sequential convention.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS bulk_purchase_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS auto_pricing_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS margin_percentage numeric(6,3);

-- Earlier forms stored the case/pack price in cost_price. Normalize it to the
-- base-piece purchase price while retaining the supplier invoice price.
UPDATE public.products
SET bulk_purchase_price = cost_price,
    cost_price = round(cost_price / conversion_factor, 4)
WHERE purchase_unit IS NOT NULL
  AND conversion_factor > 1
  AND bulk_purchase_price IS NULL;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_margin_percentage_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_margin_percentage_check
  CHECK (margin_percentage IS NULL OR (margin_percentage >= 0 AND margin_percentage < 100));

ALTER TABLE public.product_selling_options
  ADD COLUMN IF NOT EXISTS inventory_multiplier numeric(12,3) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS shares_base_stock boolean NOT NULL DEFAULT false;

ALTER TABLE public.product_selling_options DROP CONSTRAINT IF EXISTS product_selling_options_inventory_multiplier_check;
ALTER TABLE public.product_selling_options
  ADD CONSTRAINT product_selling_options_inventory_multiplier_check CHECK (inventory_multiplier >= 1);

-- The default piece/unit option becomes the shared base-stock option.
UPDATE public.product_selling_options pso
SET shares_base_stock = true,
    inventory_multiplier = 1,
    stock_quantity = p.current_stock
FROM public.products p
WHERE p.id = pso.product_id
  AND pso.is_default
  AND pso.kind IN ('unit', 'custom');

CREATE TABLE IF NOT EXISTS public.restock_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity_in_purchase_units numeric(12,3) NOT NULL CHECK (quantity_in_purchase_units > 0),
  purchase_unit text NOT NULL,
  pieces_per_purchase_unit numeric(12,3) NOT NULL CHECK (pieces_per_purchase_unit >= 1),
  pieces_added numeric(12,3) NOT NULL CHECK (pieces_added > 0),
  purchase_price_per_unit numeric(12,2) NOT NULL CHECK (purchase_price_per_unit >= 0),
  purchase_price_per_piece numeric(12,4) NOT NULL CHECK (purchase_price_per_piece >= 0),
  stock_before numeric(12,3) NOT NULL,
  stock_after numeric(12,3) NOT NULL,
  restocked_by uuid REFERENCES auth.users(id),
  restocked_at timestamptz NOT NULL DEFAULT now(),
  note text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS restock_history_store_date_idx ON public.restock_history(store_id, restocked_at DESC);
CREATE INDEX IF NOT EXISTS restock_history_product_date_idx ON public.restock_history(product_id, restocked_at DESC);
CREATE INDEX IF NOT EXISTS restock_history_restocked_by_idx ON public.restock_history(restocked_by);
ALTER TABLE public.restock_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "restock history: scoped read" ON public.restock_history;
CREATE POLICY "restock history: scoped read" ON public.restock_history
FOR SELECT TO authenticated
USING (public.user_belongs_to_store(store_id));

REVOKE ALL ON public.restock_history FROM anon;
GRANT SELECT ON public.restock_history TO authenticated;

CREATE OR REPLACE FUNCTION private.sync_shared_option_stock(p_product_id uuid, p_base_stock numeric)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.product_selling_options
  SET stock_quantity = floor(GREATEST(p_base_stock, 0) / GREATEST(inventory_multiplier, 1)),
      updated_at = now()
  WHERE product_id = p_product_id AND shares_base_stock;
$$;

REVOKE ALL ON FUNCTION private.sync_shared_option_stock(uuid, numeric) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.sync_shared_options_after_product_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  PERFORM private.sync_shared_option_stock(NEW.id, NEW.current_stock);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_shared_options_after_product_stock() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS sync_shared_options_after_product_stock_trigger ON public.products;
CREATE TRIGGER sync_shared_options_after_product_stock_trigger
AFTER UPDATE OF current_stock ON public.products
FOR EACH ROW
WHEN (OLD.current_stock IS DISTINCT FROM NEW.current_stock)
EXECUTE FUNCTION private.sync_shared_options_after_product_stock();

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
  v_before numeric;
  v_after numeric;
  v_piece_delta numeric;
BEGIN
  SELECT store_id INTO v_sale_store FROM public.sales WHERE id = NEW.sale_id;
  SELECT * INTO v_product FROM public.products WHERE id = NEW.product_id FOR UPDATE;
  IF NOT FOUND OR v_product.store_id <> v_sale_store THEN RAISE EXCEPTION 'Product does not belong to sale store'; END IF;

  IF NEW.selling_option_id IS NOT NULL THEN
    SELECT * INTO v_option FROM public.product_selling_options WHERE id = NEW.selling_option_id FOR UPDATE;
    IF NOT FOUND OR v_option.product_id <> NEW.product_id OR v_option.store_id <> v_sale_store THEN
      RAISE EXCEPTION 'Selling option does not belong to sale product/store';
    END IF;

    IF v_option.shares_base_stock THEN
      v_piece_delta := NEW.quantity * GREATEST(v_option.inventory_multiplier, 1);
      IF v_product.current_stock < v_piece_delta THEN
        RAISE EXCEPTION 'Insufficient base stock for %. Available pieces %, required pieces %', v_option.label, v_product.current_stock, v_piece_delta;
      END IF;
      v_before := v_product.current_stock;
      v_after := v_before - v_piece_delta;
      UPDATE public.products SET current_stock = round(v_after), updated_at = now() WHERE id = NEW.product_id;
      PERFORM private.sync_shared_option_stock(NEW.product_id, v_after);
      NEW.stock_source := 'product';
    ELSE
      IF v_option.stock_quantity < NEW.quantity THEN RAISE EXCEPTION 'Insufficient stock for %', v_option.label; END IF;
      v_before := v_option.stock_quantity;
      v_after := v_before - NEW.quantity;
      UPDATE public.product_selling_options SET stock_quantity = v_after, updated_at = now() WHERE id = v_option.id;
      IF v_option.is_default THEN UPDATE public.products SET current_stock = round(v_after), updated_at = now() WHERE id = NEW.product_id; END IF;
    END IF;

    INSERT INTO public.inventory_movements(
      store_id, product_id, product_name, selling_option_id, selling_option_label,
      unit_label, package_size, package_unit, movement_type, quantity_delta,
      stock_before, stock_after, stock_source, reference_type, reference_id, note, created_by
    ) VALUES (
      v_sale_store, NEW.product_id, NEW.product_name, NEW.selling_option_id,
      COALESCE(NEW.selling_option_label, v_option.label), COALESCE(NEW.unit_label, v_option.unit_label),
      COALESCE(NEW.package_size, v_option.quantity_value), COALESCE(NEW.package_unit, v_option.quantity_unit),
      'sale', CASE WHEN v_option.shares_base_stock THEN -v_piece_delta ELSE -NEW.quantity END,
      v_before, v_after, CASE WHEN v_option.shares_base_stock THEN 'product' ELSE 'selling_option' END,
      'sale', NEW.sale_id, 'POS sale ' || NEW.sale_id::text, auth.uid()
    );
  ELSE
    IF v_product.current_stock < NEW.quantity THEN RAISE EXCEPTION 'Insufficient stock for product %', NEW.product_id; END IF;
    v_before := v_product.current_stock;
    v_after := v_before - NEW.quantity;
    UPDATE public.products SET current_stock = round(v_after), updated_at = now() WHERE id = NEW.product_id;
    PERFORM private.sync_shared_option_stock(NEW.product_id, v_after);
    INSERT INTO public.inventory_movements(store_id, product_id, product_name, unit_label, movement_type, quantity_delta, stock_before, stock_after, stock_source, reference_type, reference_id, note, created_by)
    VALUES (v_sale_store, NEW.product_id, NEW.product_name, COALESCE(NEW.unit_label, v_product.unit, 'unit'), 'sale', -NEW.quantity, v_before, v_after, 'product', 'sale', NEW.sale_id, 'POS sale ' || NEW.sale_id::text, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

-- Snapshot the purchase cost of the selected selling unit, not merely one piece.
CREATE OR REPLACE FUNCTION private.set_sale_item_purchase_cost()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_piece_cost numeric; v_multiplier numeric := 1;
BEGIN
  SELECT cost_price INTO v_piece_cost FROM public.products WHERE id = NEW.product_id;
  IF NEW.selling_option_id IS NOT NULL THEN
    SELECT CASE WHEN shares_base_stock THEN inventory_multiplier ELSE 1 END
    INTO v_multiplier FROM public.product_selling_options WHERE id = NEW.selling_option_id;
    IF COALESCE(v_multiplier, 1) > 1 OR EXISTS (
      SELECT 1 FROM public.product_selling_options
      WHERE id = NEW.selling_option_id AND shares_base_stock
    ) THEN
      NEW.stock_source := 'product';
    END IF;
  END IF;
  NEW.cost_price := COALESCE(v_piece_cost, 0) * COALESCE(v_multiplier, 1);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.set_sale_item_purchase_cost() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS zzz_set_sale_item_purchase_cost_trigger ON public.sale_items;
CREATE TRIGGER zzz_set_sale_item_purchase_cost_trigger
BEFORE INSERT ON public.sale_items
FOR EACH ROW EXECUTE FUNCTION private.set_sale_item_purchase_cost();

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
  v_id uuid := gen_random_uuid();
BEGIN
  IF (SELECT auth.uid()) IS NULL OR public.current_user_role()::text NOT IN ('admin', 'inventory') THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_quantity_in_purchase_units <= 0 OR p_pieces_per_purchase_unit < 1 OR p_purchase_price_per_unit < 0 THEN RAISE EXCEPTION 'Invalid restock values'; END IF;
  SELECT * INTO v_product FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND OR NOT public.user_belongs_to_store(v_product.store_id) THEN RAISE EXCEPTION 'Product not found or access denied'; END IF;
  v_before := v_product.current_stock;
  v_pieces := p_quantity_in_purchase_units * p_pieces_per_purchase_unit;
  v_after := v_before + v_pieces;
  v_piece_price := p_purchase_price_per_unit / p_pieces_per_purchase_unit;

  UPDATE public.products
  SET current_stock = round(v_after), cost_price = round(v_piece_price, 4),
      purchase_unit = p_purchase_unit, conversion_factor = round(p_pieces_per_purchase_unit),
      bulk_purchase_price = round(p_purchase_price_per_unit, 2),
      selling_price = CASE WHEN auto_pricing_enabled AND margin_percentage IS NOT NULL THEN round(v_piece_price / (1 - margin_percentage / 100), 2) ELSE selling_price END,
      updated_at = now()
  WHERE id = p_product_id;
  PERFORM private.sync_shared_option_stock(p_product_id, v_after);

  UPDATE public.product_selling_options pso
  SET selling_price = round((v_piece_price * pso.inventory_multiplier) / (1 - v_product.margin_percentage / 100), 2), updated_at = now()
  WHERE pso.product_id = p_product_id AND v_product.auto_pricing_enabled AND v_product.margin_percentage IS NOT NULL;

  INSERT INTO public.restock_history(id, store_id, product_id, quantity_in_purchase_units, purchase_unit, pieces_per_purchase_unit, pieces_added, purchase_price_per_unit, purchase_price_per_piece, stock_before, stock_after, restocked_by, note)
  VALUES (v_id, v_product.store_id, p_product_id, p_quantity_in_purchase_units, p_purchase_unit, p_pieces_per_purchase_unit, v_pieces, p_purchase_price_per_unit, v_piece_price, v_before, v_after, auth.uid(), COALESCE(p_note, ''));

  INSERT INTO public.stock_adjustments(id, store_id, product_id, unit_label, package_size, package_unit, stock_source, reason, quantity_delta, stock_before, stock_after, note, created_by)
  VALUES (gen_random_uuid(), v_product.store_id, p_product_id, v_product.unit, p_pieces_per_purchase_unit, p_purchase_unit, 'product', 'restock', v_pieces, v_before, v_after, COALESCE(p_note, ''), auth.uid());

  RETURN jsonb_build_object('restockId', v_id, 'piecesAdded', v_pieces, 'stockBefore', v_before, 'stockAfter', v_after, 'purchasePricePerPiece', v_piece_price);
END;
$$;

REVOKE ALL ON FUNCTION public.restock_product_inventory(uuid, numeric, text, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restock_product_inventory(uuid, numeric, text, numeric, numeric, text) TO authenticated;
