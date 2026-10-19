-- POS hardware options are stored with each store and default on to preserve
-- the current print and cash-drawer workflow until an admin changes them.
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS receipt_printing_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cash_drawer_integration_enabled boolean NOT NULL DEFAULT true;

-- A sale-item/lot pair can only be allocated once. Supplier liability remains
-- derived from the lot's sold quantity and captured supplier unit cost.
CREATE UNIQUE INDEX IF NOT EXISTS sale_item_stock_allocations_item_lot_uidx
  ON public.sale_item_stock_allocations (sale_item_id, lot_id);

-- Void adjustments restore the original lots in the sale status trigger below.
-- Keep legacy pre-lot voids in balance by making only any unallocated remainder
-- a store-owned lot here.
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
  v_allocated numeric := 0;
  v_void_sale_id uuid;
  v_lot public.inventory_stock_lots%ROWTYPE;
  v_take numeric;
BEGIN
  IF NEW.quantity_delta > 0 THEN
    -- Sale returns restore their original lots in the return-item trigger below.
    IF NEW.note LIKE 'Returned sale %' THEN RETURN NEW; END IF;

    IF NEW.note LIKE 'Voided sale %' THEN
      v_void_sale_id := substring(NEW.note FROM 13)::uuid;
      SELECT COALESCE(SUM(a.quantity_base_units - a.quantity_returned), 0)
      INTO v_allocated
      FROM public.sale_items si
      JOIN public.sale_item_stock_allocations a ON a.sale_item_id = si.id
      WHERE si.sale_id = v_void_sale_id
        AND si.product_id = NEW.product_id;
      v_remaining := GREATEST(v_remaining - v_allocated, 0);
      IF v_remaining <= 0 THEN RETURN NEW; END IF;

      -- Sales made before lot tracking have no source lots to restore.
      v_owner := 'store_owned';
      v_supplier_id := NULL;
      v_supplier_name := NULL;
      v_unit_cost := NULL;
    END IF;

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
      v_remaining, v_remaining,
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

CREATE OR REPLACE FUNCTION private.restore_sale_stock_lots_after_void()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_allocation public.sale_item_stock_allocations%ROWTYPE;
  v_restore numeric;
BEGIN
  IF OLD.status <> 'completed' OR NEW.status <> 'voided' THEN RETURN NEW; END IF;

  FOR v_allocation IN
    SELECT a.*
    FROM public.sale_item_stock_allocations a
    JOIN public.sale_items si ON si.id = a.sale_item_id
    WHERE si.sale_id = NEW.id
      AND a.quantity_returned < a.quantity_base_units
    ORDER BY a.allocation_sequence DESC
    FOR UPDATE OF a
  LOOP
    v_restore := v_allocation.quantity_base_units - v_allocation.quantity_returned;
    UPDATE public.inventory_stock_lots
    SET quantity_remaining = quantity_remaining + v_restore,
        quantity_sold = CASE WHEN v_allocation.ownership = 'consigned'
          THEN GREATEST(0, quantity_sold - v_restore)
          ELSE quantity_sold END
    WHERE id = v_allocation.lot_id;

    UPDATE public.sale_item_stock_allocations
    SET quantity_returned = quantity_base_units
    WHERE id = v_allocation.id;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restore_sale_stock_lots_after_void_trigger ON public.sales;
CREATE TRIGGER restore_sale_stock_lots_after_void_trigger
  AFTER UPDATE OF status ON public.sales
  FOR EACH ROW EXECUTE FUNCTION private.restore_sale_stock_lots_after_void();

CREATE TABLE IF NOT EXISTS public.consignment_supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  reference text,
  note text NOT NULL DEFAULT '',
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS consignment_supplier_payments_balance_idx
  ON public.consignment_supplier_payments (store_id, supplier_id, paid_at DESC);

ALTER TABLE public.consignment_supplier_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Consignment payments are visible to store members" ON public.consignment_supplier_payments;
CREATE POLICY "Consignment payments are visible to store members"
  ON public.consignment_supplier_payments FOR SELECT TO authenticated
  USING (public.user_belongs_to_store(store_id));

REVOKE ALL ON public.consignment_supplier_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.consignment_supplier_payments TO authenticated;

CREATE OR REPLACE VIEW public.consignment_supplier_balances
WITH (security_invoker = true)
AS
WITH sold_balances AS (
  SELECT
    lot.store_id,
    lot.supplier_id,
    MAX(lot.supplier_name_snapshot) AS supplier_name,
    SUM(lot.quantity_received) AS quantity_received,
    SUM(lot.quantity_remaining) AS quantity_on_hand,
    SUM(lot.quantity_sold) AS quantity_sold,
    SUM(lot.quantity_sold * lot.unit_cost) AS amount_due
  FROM public.inventory_stock_lots lot
  WHERE lot.ownership = 'consigned'
  GROUP BY lot.store_id, lot.supplier_id
), payments AS (
  SELECT store_id, supplier_id, SUM(amount) AS amount_paid
  FROM public.consignment_supplier_payments
  GROUP BY store_id, supplier_id
)
SELECT
  balance.store_id,
  balance.supplier_id,
  balance.supplier_name,
  balance.quantity_received,
  balance.quantity_on_hand,
  balance.quantity_sold,
  balance.amount_due,
  COALESCE(payment.amount_paid, 0) AS amount_paid,
  GREATEST(round(balance.amount_due - COALESCE(payment.amount_paid, 0), 2), 0) AS outstanding_balance,
  GREATEST(round(COALESCE(payment.amount_paid, 0) - balance.amount_due, 2), 0) AS supplier_credit
FROM sold_balances balance
LEFT JOIN payments payment
  ON payment.store_id = balance.store_id
 AND payment.supplier_id = balance.supplier_id;

REVOKE ALL ON public.consignment_supplier_balances FROM PUBLIC, anon;
GRANT SELECT ON public.consignment_supplier_balances TO authenticated;

CREATE OR REPLACE FUNCTION public.record_consignment_supplier_payment(
  p_store_id uuid,
  p_supplier_id uuid,
  p_amount numeric,
  p_reference text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS public.consignment_supplier_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment public.consignment_supplier_payments%ROWTYPE;
  v_due numeric := 0;
  v_paid numeric := 0;
  v_outstanding numeric := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF public.current_user_role()::text <> 'admin' THEN
    RAISE EXCEPTION 'Only store admins can record supplier payments';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;
  IF NOT public.user_belongs_to_store(p_store_id) THEN
    RAISE EXCEPTION 'User is not assigned to this store';
  END IF;

  -- Lock the supplier so concurrent partial payments cannot exceed its balance.
  PERFORM 1 FROM public.suppliers WHERE id = p_supplier_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplier does not exist'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.supplier_stores ss
    WHERE ss.supplier_id = p_supplier_id AND ss.store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Supplier is not assigned to this store';
  END IF;

  SELECT COALESCE(SUM(lot.quantity_sold * lot.unit_cost), 0)
  INTO v_due
  FROM public.inventory_stock_lots lot
  WHERE lot.store_id = p_store_id
    AND lot.supplier_id = p_supplier_id
    AND lot.ownership = 'consigned';

  SELECT COALESCE(SUM(payment.amount), 0)
  INTO v_paid
  FROM public.consignment_supplier_payments payment
  WHERE payment.store_id = p_store_id
    AND payment.supplier_id = p_supplier_id;

  v_outstanding := GREATEST(round(v_due - v_paid, 2), 0);
  IF round(p_amount, 2) > v_outstanding THEN
    RAISE EXCEPTION 'Payment exceeds the outstanding consignment balance of %', v_outstanding;
  END IF;

  INSERT INTO public.consignment_supplier_payments (
    store_id, supplier_id, amount, reference, note, created_by
  ) VALUES (
    p_store_id, p_supplier_id, round(p_amount, 2), NULLIF(trim(COALESCE(p_reference, '')), ''),
    COALESCE(trim(p_note), ''), auth.uid()
  )
  RETURNING * INTO v_payment;
  RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.record_consignment_supplier_payment(uuid, uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_consignment_supplier_payment(uuid, uuid, numeric, text, text) TO authenticated;
