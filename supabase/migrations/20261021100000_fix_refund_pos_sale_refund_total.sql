-- Fix refund total aggregation so refund_pos_sale can process refunds.
CREATE OR REPLACE FUNCTION public.refund_pos_sale(
  p_sale_id uuid,
  p_amount numeric,
  p_method public.payment_method DEFAULT 'cash',
  p_reason text DEFAULT NULL,
  p_reference text DEFAULT NULL
)
RETURNS public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_refunded numeric;
  v_new_refunded numeric;
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
    RAISE EXCEPTION 'Only store admins can refund sales';
  END IF;

  IF NOT public.user_belongs_to_store(v_sale.store_id) THEN
    RAISE EXCEPTION 'User is not assigned to this store';
  END IF;

  IF v_sale.status IN ('voided', 'refunded') THEN
    RAISE EXCEPTION 'Sale is not refundable in its current status';
  END IF;

  IF v_sale.closeout_id IS NOT NULL THEN
    RAISE EXCEPTION 'Closed-out sales require an accounting adjustment instead of an inline refund';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Refund amount must be greater than zero';
  END IF;

  SELECT COALESCE(ABS(SUM(amount) FILTER (WHERE amount < 0)), 0)
  INTO v_refunded
  FROM public.sale_payments
  WHERE sale_id = p_sale_id;

  v_new_refunded := v_refunded + p_amount;
  IF v_new_refunded > v_sale.total + 0.01 THEN
    RAISE EXCEPTION 'Refund cannot exceed remaining paid total';
  END IF;

  INSERT INTO public.sale_payments(
    sale_id, store_id, method, status, amount, amount_tendered, change_amount, reference_number, created_by
  )
  VALUES (
    p_sale_id, v_sale.store_id, p_method, 'refunded', -round(p_amount, 2), round(p_amount, 2), 0, p_reference, auth.uid()
  );

  UPDATE public.sales
  SET status = CASE
    WHEN v_new_refunded >= total - 0.01 THEN 'refunded'::public.sale_status
    ELSE 'partially_refunded'::public.sale_status
  END
  WHERE id = p_sale_id
  RETURNING * INTO v_sale;

  INSERT INTO public.sale_events(sale_id, store_id, event_type, reason, amount, actor_id, metadata)
  VALUES (
    p_sale_id,
    v_sale.store_id,
    'refunded',
    p_reason,
    p_amount,
    auth.uid(),
    jsonb_build_object('method', p_method, 'reference', p_reference)
  );

  PERFORM public.log_audit_event(
    v_sale.store_id,
    'sale.refunded',
    'sale',
    p_sale_id,
    jsonb_build_object('amount', p_amount, 'method', p_method, 'reason', p_reason)
  );

  RETURN v_sale;
END;
$function$;

REVOKE ALL ON FUNCTION public.refund_pos_sale(uuid, numeric, public.payment_method, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refund_pos_sale(uuid, numeric, public.payment_method, text, text) TO authenticated;
