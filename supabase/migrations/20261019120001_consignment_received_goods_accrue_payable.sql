-- Consigned goods create a supplier payable when received. Sell-through only
-- changes inventory quantities; it does not determine the amount owed.
CREATE OR REPLACE VIEW public.consignment_settlement_balances
WITH (security_invoker = true)
AS
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
  round(SUM(lot.quantity_received * lot.unit_cost), 2) AS amount_due
FROM public.inventory_stock_lots lot
JOIN public.products p ON p.id = lot.product_id
WHERE lot.ownership = 'consigned'
GROUP BY lot.store_id, lot.product_id, p.name, p.unit, lot.supplier_id, lot.supplier_name_snapshot;

GRANT SELECT ON public.consignment_settlement_balances TO authenticated;

CREATE OR REPLACE VIEW public.consignment_supplier_balances
WITH (security_invoker = true)
AS
WITH received_balances AS (
  SELECT
    lot.store_id,
    lot.supplier_id,
    MAX(lot.supplier_name_snapshot) AS supplier_name,
    SUM(lot.quantity_received) AS quantity_received,
    SUM(lot.quantity_remaining) AS quantity_on_hand,
    SUM(lot.quantity_sold) AS quantity_sold,
    round(SUM(lot.quantity_received * lot.unit_cost), 2) AS amount_due
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
FROM received_balances balance
LEFT JOIN payments payment
  ON payment.store_id = balance.store_id
 AND payment.supplier_id = balance.supplier_id;

REVOKE ALL ON public.consignment_supplier_balances FROM PUBLIC, anon;
GRANT SELECT ON public.consignment_supplier_balances TO authenticated;

-- Keep payment limits consistent with the receipt-based payable.
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

  SELECT COALESCE(SUM(lot.quantity_received * lot.unit_cost), 0)
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
