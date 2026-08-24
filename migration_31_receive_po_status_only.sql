-- Migration 31: Receiving a purchase order records supplier delivery status only.
-- Inventory changes must be made through explicit stock adjustment/restock flows.

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

REVOKE ALL ON FUNCTION public.receive_purchase_order(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, boolean) TO authenticated;
