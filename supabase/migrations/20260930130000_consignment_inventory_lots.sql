-- Track supplier-owned consignment alongside store-owned inventory.
-- The product stock count remains the sellable aggregate; lots preserve ownership
-- and per-receipt cost so sales and returns can update supplier liability.

CREATE TABLE IF NOT EXISTS public.inventory_stock_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  ownership text NOT NULL CHECK (ownership IN ('store_owned', 'consigned')),
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  supplier_name_snapshot text,
  quantity_received numeric(14,3) NOT NULL CHECK (quantity_received > 0),
  quantity_remaining numeric(14,3) NOT NULL CHECK (quantity_remaining >= 0),
  quantity_sold numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity_sold >= 0),
  unit_cost numeric(14,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  received_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT inventory_stock_lots_consignment_supplier
    CHECK (ownership <> 'consigned' OR supplier_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS inventory_stock_lots_fifo_idx
  ON public.inventory_stock_lots (product_id, received_at, id)
  WHERE quantity_remaining > 0;
CREATE INDEX IF NOT EXISTS inventory_stock_lots_supplier_idx
  ON public.inventory_stock_lots (store_id, supplier_id, received_at)
  WHERE ownership = 'consigned';

CREATE TABLE IF NOT EXISTS public.sale_item_stock_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  sale_item_id uuid NOT NULL,
  lot_id uuid NOT NULL REFERENCES public.inventory_stock_lots(id) ON DELETE RESTRICT,
  quantity_base_units numeric(14,3) NOT NULL CHECK (quantity_base_units > 0),
  quantity_returned numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity_returned >= 0),
  unit_cost numeric(14,4) NOT NULL CHECK (unit_cost >= 0),
  ownership text NOT NULL CHECK (ownership IN ('store_owned', 'consigned')),
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sale_item_stock_allocations_return_bound
    CHECK (quantity_returned <= quantity_base_units),
  CONSTRAINT sale_item_stock_allocations_item_fk
    FOREIGN KEY (sale_item_id) REFERENCES public.sale_items(id)
    ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS sale_item_stock_allocations_item_idx
  ON public.sale_item_stock_allocations (sale_item_id, id);
CREATE INDEX IF NOT EXISTS sale_item_stock_allocations_supplier_idx
  ON public.sale_item_stock_allocations (store_id, supplier_id)
  WHERE ownership = 'consigned';

ALTER TABLE public.inventory_stock_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_item_stock_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Store members can read inventory stock lots" ON public.inventory_stock_lots;
CREATE POLICY "Store members can read inventory stock lots"
  ON public.inventory_stock_lots FOR SELECT TO authenticated
  USING ((SELECT public.user_belongs_to_store(store_id)));

DROP POLICY IF EXISTS "Store members can read sale item stock allocations" ON public.sale_item_stock_allocations;
CREATE POLICY "Store members can read sale item stock allocations"
  ON public.sale_item_stock_allocations FOR SELECT TO authenticated
  USING ((SELECT public.user_belongs_to_store(store_id)));

REVOKE ALL ON public.inventory_stock_lots FROM anon, authenticated;
REVOKE ALL ON public.sale_item_stock_allocations FROM anon, authenticated;
GRANT SELECT ON public.inventory_stock_lots, public.sale_item_stock_allocations TO authenticated;

-- Existing balances are treated as store-owned opening stock because historical
-- receipts cannot reliably tell us whether any units were on consignment.
INSERT INTO public.inventory_stock_lots (
  store_id, product_id, ownership, quantity_received, quantity_remaining,
  unit_cost, received_at
)
SELECT p.store_id, p.id, 'store_owned', p.current_stock, p.current_stock,
       COALESCE(p.cost_price, 0), COALESCE(p.created_at, now())
FROM public.products p
WHERE p.current_stock > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.inventory_stock_lots l WHERE l.product_id = p.id
  );

CREATE OR REPLACE FUNCTION private.create_opening_stock_lot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(NEW.current_stock, 0) > 0 THEN
    INSERT INTO public.inventory_stock_lots (
      store_id, product_id, ownership, quantity_received, quantity_remaining,
      unit_cost, received_at
    ) VALUES (
      NEW.store_id, NEW.id, 'store_owned', NEW.current_stock, NEW.current_stock,
      COALESCE(NEW.cost_price, 0), COALESCE(NEW.created_at, now())
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_opening_stock_lot_trigger ON public.products;
CREATE TRIGGER create_opening_stock_lot_trigger
  AFTER INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION private.create_opening_stock_lot();

-- Positive stock adjustments create lots. Negative adjustments consume FIFO
-- lots, keeping the detailed ownership ledger aligned with products.current_stock.
CREATE OR REPLACE FUNCTION private.sync_stock_lots_from_adjustment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner text := COALESCE(NULLIF(current_setting('kodigo.stock_ownership', true), ''), 'store_owned');
  v_supplier_id uuid := NULLIF(current_setting('kodigo.stock_supplier_id', true), '')::uuid;
  v_supplier_name text;
  v_unit_cost numeric := NULLIF(current_setting('kodigo.stock_unit_cost', true), '')::numeric;
  v_remaining numeric := abs(NEW.quantity_delta);
  v_lot public.inventory_stock_lots%ROWTYPE;
  v_take numeric;
BEGIN
  IF NEW.quantity_delta > 0 THEN
    -- Sale returns restore their original lots in the return-item trigger below.
    IF NEW.note LIKE 'Returned sale %' THEN RETURN NEW; END IF;
    IF v_owner NOT IN ('store_owned', 'consigned') THEN
      RAISE EXCEPTION 'Invalid inventory ownership type';
    END IF;
    IF v_owner = 'consigned' AND v_supplier_id IS NULL THEN
      RAISE EXCEPTION 'A supplier is required for consigned stock';
    END IF;
    IF v_supplier_id IS NOT NULL THEN
      SELECT name INTO v_supplier_name FROM public.suppliers WHERE id = v_supplier_id;
    END IF;
    INSERT INTO public.inventory_stock_lots (
      store_id, product_id, ownership, supplier_id, supplier_name_snapshot, quantity_received,
      quantity_remaining, unit_cost, created_by
    ) VALUES (
      NEW.store_id, NEW.product_id, v_owner, v_supplier_id, v_supplier_name,
      NEW.quantity_delta, NEW.quantity_delta,
      COALESCE(v_unit_cost, (SELECT cost_price FROM public.products WHERE id = NEW.product_id), 0), NEW.created_by
    );
  ELSIF NEW.quantity_delta < 0 THEN
    FOR v_lot IN
      SELECT * FROM public.inventory_stock_lots
      WHERE product_id = NEW.product_id AND quantity_remaining > 0
      ORDER BY received_at, id
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(v_lot.quantity_remaining, v_remaining);
      UPDATE public.inventory_stock_lots
      SET quantity_remaining = quantity_remaining - v_take
      WHERE id = v_lot.id;
      v_remaining := v_remaining - v_take;
    END LOOP;
    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'Inventory ownership lots do not match product stock for product %', NEW.product_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_stock_lots_from_adjustment_trigger ON public.stock_adjustments;
CREATE TRIGGER sync_stock_lots_from_adjustment_trigger
  AFTER INSERT ON public.stock_adjustments
  FOR EACH ROW EXECUTE FUNCTION private.sync_stock_lots_from_adjustment();

CREATE OR REPLACE FUNCTION private.allocate_sale_item_stock_lots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lot public.inventory_stock_lots%ROWTYPE;
  v_remaining numeric := COALESCE(NEW.base_unit_quantity, NEW.quantity, 0);
  v_take numeric;
  v_total_cost numeric := 0;
  v_has_owned boolean := false;
  v_has_consigned boolean := false;
BEGIN
  IF v_remaining <= 0 THEN RAISE EXCEPTION 'Sale line has no base-unit quantity'; END IF;

  FOR v_lot IN
    SELECT * FROM public.inventory_stock_lots
    WHERE product_id = NEW.product_id AND quantity_remaining > 0
    ORDER BY received_at, id
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_lot.quantity_remaining, v_remaining);
    UPDATE public.inventory_stock_lots
    SET quantity_remaining = quantity_remaining - v_take,
        quantity_sold = quantity_sold + v_take
    WHERE id = v_lot.id;
    INSERT INTO public.sale_item_stock_allocations (
      store_id, sale_item_id, lot_id, quantity_base_units, unit_cost,
      ownership, supplier_id
    ) VALUES (
      (SELECT store_id FROM public.sales WHERE id = NEW.sale_id),
      NEW.id, v_lot.id, v_take, v_lot.unit_cost, v_lot.ownership, v_lot.supplier_id
    );
    v_total_cost := v_total_cost + (v_take * v_lot.unit_cost);
    v_has_owned := v_has_owned OR v_lot.ownership = 'store_owned';
    v_has_consigned := v_has_consigned OR v_lot.ownership = 'consigned';
    v_remaining := v_remaining - v_take;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Inventory ownership lots are short by % base units for product %', v_remaining, NEW.product_id;
  END IF;

  NEW.cost_per_base_unit := CASE
    WHEN COALESCE(NEW.base_unit_quantity, 0) > 0 THEN v_total_cost / NEW.base_unit_quantity
    ELSE 0 END;
  NEW.cogs := v_total_cost;
  NEW.cost_price := CASE
    WHEN COALESCE(NEW.quantity, 0) > 0 THEN v_total_cost / NEW.quantity
    ELSE 0 END;
  NEW.gross_profit := NEW.line_total - v_total_cost;
  NEW.gross_margin := CASE WHEN NEW.line_total > 0
    THEN (NEW.line_total - v_total_cost) / NEW.line_total ELSE 0 END;
  NEW.stock_source := CASE
    WHEN v_has_owned AND v_has_consigned THEN 'mixed'
    WHEN v_has_consigned THEN 'consigned'
    ELSE 'product' END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS allocate_sale_item_stock_lots_trigger ON public.sale_items;
DROP TRIGGER IF EXISTS zzzz_allocate_sale_item_stock_lots_trigger ON public.sale_items;
CREATE TRIGGER zzzz_allocate_sale_item_stock_lots_trigger
  BEFORE INSERT ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION private.allocate_sale_item_stock_lots();

CREATE OR REPLACE FUNCTION private.restore_sale_item_stock_lots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_allocation public.sale_item_stock_allocations%ROWTYPE;
  v_needed numeric;
  v_take numeric;
  v_base_per_item numeric;
  v_supplier_id uuid;
  v_store_id uuid;
  v_cost numeric;
BEGIN
  IF NOT NEW.restocked OR NEW.product_id IS NULL THEN RETURN NEW; END IF;
  SELECT si.base_unit_quantity / NULLIF(si.quantity, 0), s.store_id, si.cost_per_base_unit
    INTO v_base_per_item, v_store_id, v_cost
  FROM public.sale_items si
  JOIN public.sales s ON s.id = si.sale_id
  WHERE si.id = NEW.sale_item_id;
  v_needed := NEW.quantity * COALESCE(v_base_per_item, 1);

  FOR v_allocation IN
    SELECT * FROM public.sale_item_stock_allocations
    WHERE sale_item_id = NEW.sale_item_id
      AND quantity_returned < quantity_base_units
    ORDER BY allocation_sequence DESC
    FOR UPDATE
  LOOP
    EXIT WHEN v_needed <= 0;
    v_take := LEAST(v_allocation.quantity_base_units - v_allocation.quantity_returned, v_needed);
    UPDATE public.sale_item_stock_allocations
    SET quantity_returned = quantity_returned + v_take
    WHERE id = v_allocation.id;
    UPDATE public.inventory_stock_lots
    SET quantity_remaining = quantity_remaining + v_take,
        quantity_sold = GREATEST(0, quantity_sold - v_take)
    WHERE id = v_allocation.lot_id;
    v_needed := v_needed - v_take;
  END LOOP;

  -- Returns from sales made before lot tracking was introduced become owned stock.
  IF v_needed > 0 THEN
    INSERT INTO public.inventory_stock_lots (
      store_id, product_id, ownership, quantity_received, quantity_remaining,
      unit_cost, created_by
    ) VALUES (
      v_store_id, NEW.product_id, 'store_owned', v_needed, v_needed,
      COALESCE(v_cost, 0), auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restore_sale_item_stock_lots_trigger ON public.sale_return_items;
CREATE TRIGGER restore_sale_item_stock_lots_trigger
  AFTER INSERT ON public.sale_return_items
  FOR EACH ROW EXECUTE FUNCTION private.restore_sale_item_stock_lots();

-- Keep existing restock auditing and cost suggestions, while allowing a
-- consigned receipt to leave the store's average purchase cost untouched.
CREATE OR REPLACE FUNCTION public.receive_product_stock(
  p_product_id uuid,
  p_restocking_option_id uuid,
  p_quantity_in_purchase_units numeric,
  p_purchase_unit text,
  p_pieces_per_purchase_unit numeric,
  p_total_supplier_cost numeric,
  p_ownership text DEFAULT 'store_owned',
  p_supplier_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_result jsonb;
  v_total_cost numeric := p_total_supplier_cost;
  v_lot_id uuid := gen_random_uuid();
  v_base_units numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF public.current_user_role()::text NOT IN ('admin', 'inventory') THEN
    RAISE EXCEPTION 'Only admins or inventory users can receive inventory';
  END IF;
  IF p_ownership NOT IN ('store_owned', 'consigned') THEN
    RAISE EXCEPTION 'Invalid inventory ownership type';
  END IF;
  SELECT * INTO v_product FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND OR NOT public.user_belongs_to_store(v_product.store_id) THEN
    RAISE EXCEPTION 'Product not found or access denied';
  END IF;
  IF p_ownership = 'consigned' THEN
    IF p_supplier_id IS NULL THEN RAISE EXCEPTION 'Choose the supplier who owns this stock'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.supplier_stores ss
      WHERE ss.supplier_id = p_supplier_id AND ss.store_id = v_product.store_id
    ) THEN RAISE EXCEPTION 'Supplier is not assigned to this store'; END IF;
    IF v_total_cost IS NULL OR v_total_cost < 0 THEN
      RAISE EXCEPTION 'Enter the total amount owed to the supplier for this consignment';
    END IF;
  END IF;

  -- Set transaction-local metadata consumed by the stock-adjustment trigger.
  -- The existing restock RPC performs all canonical stock and audit writes.
  PERFORM set_config('kodigo.stock_ownership', p_ownership, true);
  PERFORM set_config('kodigo.stock_supplier_id', COALESCE(p_supplier_id::text, ''), true);
  PERFORM set_config('kodigo.stock_unit_cost', COALESCE(v_total_cost::text, ''), true);
  v_result := public.restock_product_inventory_v2(
    p_product_id, p_restocking_option_id, p_quantity_in_purchase_units,
    p_purchase_unit, p_pieces_per_purchase_unit,
    CASE WHEN p_ownership = 'consigned' THEN NULL ELSE v_total_cost END,
    p_note
  );
  v_base_units := COALESCE((v_result->>'baseUnitsAdded')::numeric, (v_result->>'base_units_added')::numeric);
  IF v_base_units IS NULL OR v_base_units <= 0 THEN
    RAISE EXCEPTION 'Stock receipt did not add a valid quantity';
  END IF;

  -- The restock adjustment trigger creates the lot atomically with the stock
  -- movement; update its generated row with the final per-base-unit valuation.
  UPDATE public.inventory_stock_lots
  SET unit_cost = COALESCE(
    round(v_total_cost / v_base_units, 4),
    (v_result->>'newCostPerBaseUnit')::numeric,
    (v_result->>'new_cost_per_base_unit')::numeric,
    v_product.cost_price,
    0
  )
  WHERE id = (
    SELECT id FROM public.inventory_stock_lots
    WHERE product_id = p_product_id
    ORDER BY received_at DESC, id DESC LIMIT 1
  );
  SELECT id INTO v_lot_id FROM public.inventory_stock_lots
  WHERE product_id = p_product_id
  ORDER BY received_at DESC, id DESC LIMIT 1;
  RETURN v_result || jsonb_build_object(
    'ownership', p_ownership, 'supplierId', p_supplier_id, 'stockLotId', v_lot_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.receive_product_stock(uuid, uuid, numeric, text, numeric, numeric, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_product_stock(uuid, uuid, numeric, text, numeric, numeric, text, uuid, text) TO authenticated;

CREATE OR REPLACE VIEW public.consignment_settlement_balances AS
SELECT
  lot.store_id,
  lot.product_id,
  p.name AS product_name,
  p.unit AS base_unit,
  lot.supplier_id,
  lot.supplier_name_snapshot AS supplier_name,
  SUM(lot.quantity_received) AS quantity_received,
  SUM(lot.quantity_remaining) AS quantity_on_hand,
  SUM(lot.quantity_sold) AS quantity_sold,
  SUM(lot.quantity_sold * lot.unit_cost) AS amount_due
FROM public.inventory_stock_lots lot
JOIN public.products p ON p.id = lot.product_id
WHERE lot.ownership = 'consigned'
GROUP BY lot.store_id, lot.product_id, p.name, p.unit, lot.supplier_id, lot.supplier_name_snapshot;

ALTER VIEW public.consignment_settlement_balances SET (security_invoker = true);
GRANT SELECT ON public.consignment_settlement_balances TO authenticated;
