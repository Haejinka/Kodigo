-- Drawer sessions with cash tracking, supervisor-approved sale adjustments,
-- optional customer sale linking, customer history and rankings.
-- All access goes through SECURITY DEFINER RPCs; tables have RLS enabled with no policies.

CREATE TABLE IF NOT EXISTS public.drawer_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  cashier_id uuid NOT NULL REFERENCES public.profiles(id),
  opening_cash numeric(12,2) NOT NULL CHECK (opening_cash >= 0),
  opened_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid REFERENCES public.profiles(id),
  counted_cash numeric(12,2) CHECK (counted_cash IS NULL OR counted_cash >= 0),
  expected_cash numeric(12,2),
  variance numeric(12,2),
  totals jsonb,
  close_notes text,
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'flagged')),
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  review_note text
);
CREATE UNIQUE INDEX IF NOT EXISTS drawer_sessions_one_open_per_store ON public.drawer_sessions(store_id) WHERE state = 'open';
CREATE INDEX IF NOT EXISTS drawer_sessions_store_opened_idx ON public.drawer_sessions(store_id, opened_at DESC);

CREATE TABLE IF NOT EXISTS public.drawer_cash_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.drawer_sessions(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  entry_type text NOT NULL CHECK (entry_type IN ('pay_in', 'pay_out', 'drop')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS drawer_cash_entries_session_idx ON public.drawer_cash_entries(session_id);

CREATE TABLE IF NOT EXISTS public.sale_adjustment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.sales(id),
  kind text NOT NULL CHECK (kind IN ('void', 'refund', 'return')),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  amount numeric(12,2),
  method text,
  items jsonb,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'rejected')),
  requested_by uuid NOT NULL REFERENCES public.profiles(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES public.profiles(id),
  decided_at timestamptz,
  decision_note text
);
CREATE INDEX IF NOT EXISTS sale_adjustment_requests_store_idx ON public.sale_adjustment_requests(store_id, state, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS sale_adjustment_requests_one_pending ON public.sale_adjustment_requests(sale_id) WHERE state = 'pending';

ALTER TABLE public.drawer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drawer_cash_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_adjustment_requests ENABLE ROW LEVEL SECURITY;

-- Internal: caller must be an admin/cashier of the store. Returns role.
CREATE OR REPLACE FUNCTION public.pos_assert_staff(p_store_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT role::text INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'cashier') THEN RAISE EXCEPTION 'Only store admins or cashiers can do this'; END IF;
  IF NOT public.user_belongs_to_store(p_store_id) THEN RAISE EXCEPTION 'User is not assigned to this store'; END IF;
  RETURN v_role;
END $$;

-- Internal: cash position of a session (physical sales, refunds, digital cash legs, manual entries).
CREATE OR REPLACE FUNCTION public.drawer_session_totals(p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.drawer_sessions%ROWTYPE;
  v_end timestamptz;
  v_sales numeric; v_refunds numeric; v_din numeric; v_dout numeric; v_in numeric; v_out numeric;
BEGIN
  SELECT * INTO s FROM public.drawer_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Drawer session not found'; END IF;
  v_end := COALESCE(s.closed_at, now());

  SELECT COALESCE(SUM(sp.amount) FILTER (WHERE sp.amount > 0), 0),
         COALESCE(-SUM(sp.amount) FILTER (WHERE sp.amount < 0), 0)
  INTO v_sales, v_refunds
  FROM public.sale_payments sp JOIN public.sales sa ON sa.id = sp.sale_id
  WHERE sp.store_id = s.store_id AND sp.method::text = 'cash' AND sp.status::text <> 'voided'
    AND sa.status::text <> 'voided' AND sp.created_at >= s.opened_at AND sp.created_at <= v_end;

  SELECT COALESCE(SUM(CASE WHEN service_kind = 'gcash_cash_in' THEN face_amount + fee_amount
                           WHEN service_kind IN ('eload', 'digital_product') THEN retail_amount ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN service_kind = 'gcash_cash_out' THEN face_amount ELSE 0 END), 0)
  INTO v_din, v_dout
  FROM public.digital_service_transactions
  WHERE store_id = s.store_id AND state = 'completed' AND cash_leg_state = 'confirmed'
    AND created_at >= s.opened_at AND created_at <= v_end;

  SELECT COALESCE(SUM(amount) FILTER (WHERE entry_type = 'pay_in'), 0),
         COALESCE(SUM(amount) FILTER (WHERE entry_type IN ('pay_out', 'drop')), 0)
  INTO v_in, v_out FROM public.drawer_cash_entries WHERE session_id = s.id;

  RETURN jsonb_build_object(
    'opening_cash', s.opening_cash, 'cash_sales', v_sales, 'cash_refunds', v_refunds,
    'digital_cash_in', v_din, 'digital_cash_out', v_dout, 'pay_in', v_in, 'pay_out', v_out,
    'expected_cash', round(s.opening_cash + v_sales - v_refunds + v_din - v_dout + v_in - v_out, 2));
END $$;

CREATE OR REPLACE FUNCTION public.session_json(p_session_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT to_jsonb(s) - 'totals'
    || jsonb_build_object(
         'cashier_name', (SELECT name FROM public.profiles WHERE id = s.cashier_id),
         'totals', CASE WHEN s.state = 'closed' THEN s.totals ELSE public.drawer_session_totals(s.id) END,
         'entries', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at) FROM public.drawer_cash_entries e WHERE e.session_id = s.id), '[]'::jsonb))
  FROM public.drawer_sessions s WHERE s.id = p_session_id
$$;

CREATE OR REPLACE FUNCTION public.open_drawer_session(p_store_id uuid, p_opening_cash numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.pos_assert_staff(p_store_id);
  IF p_opening_cash IS NULL OR p_opening_cash < 0 THEN RAISE EXCEPTION 'Opening cash cannot be negative'; END IF;
  IF EXISTS (SELECT 1 FROM public.drawer_sessions WHERE store_id = p_store_id AND state = 'open') THEN
    RAISE EXCEPTION 'A drawer session is already open for this store';
  END IF;
  INSERT INTO public.drawer_sessions(store_id, cashier_id, opening_cash)
  VALUES (p_store_id, auth.uid(), round(p_opening_cash, 2)) RETURNING id INTO v_id;
  RETURN public.session_json(v_id);
END $$;

CREATE OR REPLACE FUNCTION public.get_open_drawer_session(p_store_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.pos_assert_staff(p_store_id);
  SELECT id INTO v_id FROM public.drawer_sessions WHERE store_id = p_store_id AND state = 'open';
  IF v_id IS NULL THEN RETURN NULL; END IF;
  RETURN public.session_json(v_id);
END $$;

CREATE OR REPLACE FUNCTION public.record_drawer_entry(p_session_id uuid, p_type text, p_amount numeric, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.drawer_sessions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.drawer_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Drawer session not found'; END IF;
  PERFORM public.pos_assert_staff(s.store_id);
  IF s.state <> 'open' THEN RAISE EXCEPTION 'Drawer session is closed'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be greater than zero'; END IF;
  INSERT INTO public.drawer_cash_entries(session_id, store_id, entry_type, amount, reason, created_by)
  VALUES (s.id, s.store_id, p_type, round(p_amount, 2), p_reason, auth.uid());
  RETURN public.session_json(s.id);
END $$;

CREATE OR REPLACE FUNCTION public.close_drawer_session(p_session_id uuid, p_counted_cash numeric, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.drawer_sessions%ROWTYPE; v_tot jsonb; v_exp numeric;
BEGIN
  SELECT * INTO s FROM public.drawer_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Drawer session not found'; END IF;
  PERFORM public.pos_assert_staff(s.store_id);
  IF s.state <> 'open' THEN RAISE EXCEPTION 'Drawer session is already closed'; END IF;
  IF p_counted_cash IS NULL OR p_counted_cash < 0 THEN RAISE EXCEPTION 'Counted cash cannot be negative'; END IF;
  v_tot := public.drawer_session_totals(s.id);
  v_exp := (v_tot->>'expected_cash')::numeric;
  UPDATE public.drawer_sessions SET state = 'closed', closed_at = now(), closed_by = auth.uid(),
    counted_cash = round(p_counted_cash, 2), expected_cash = v_exp, variance = round(p_counted_cash - v_exp, 2),
    totals = v_tot, close_notes = NULLIF(btrim(p_notes), '')
  WHERE id = s.id;
  RETURN public.session_json(s.id);
END $$;

CREATE OR REPLACE FUNCTION public.list_drawer_sessions(p_store_id uuid, p_review_status text DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.pos_assert_staff(p_store_id) <> 'admin' THEN RAISE EXCEPTION 'Only store admins can review closeouts'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(public.session_json(x.id) ORDER BY x.opened_at DESC) FROM (
    SELECT id, opened_at FROM public.drawer_sessions
    WHERE store_id = p_store_id AND (p_review_status IS NULL OR (state = 'closed' AND review_status = p_review_status))
    ORDER BY opened_at DESC LIMIT LEAST(GREATEST(p_limit, 1), 200)) x), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.review_drawer_session(p_session_id uuid, p_status text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.drawer_sessions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.drawer_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Drawer session not found'; END IF;
  IF public.pos_assert_staff(s.store_id) <> 'admin' THEN RAISE EXCEPTION 'Only store admins can review closeouts'; END IF;
  IF s.state <> 'closed' THEN RAISE EXCEPTION 'Only closed sessions can be reviewed'; END IF;
  IF p_status NOT IN ('approved', 'flagged') THEN RAISE EXCEPTION 'Invalid review status'; END IF;
  IF p_status = 'flagged' AND COALESCE(btrim(p_note), '') = '' THEN RAISE EXCEPTION 'A note is required when flagging a closeout'; END IF;
  UPDATE public.drawer_sessions SET review_status = p_status, reviewed_by = auth.uid(), reviewed_at = now(),
    review_note = NULLIF(btrim(p_note), '') WHERE id = s.id;
  RETURN public.session_json(s.id);
END $$;

-- ===== Supervisor-approved void / refund / return =====
CREATE OR REPLACE FUNCTION public.request_sale_adjustment(
  p_sale_id uuid, p_kind text, p_reason text, p_amount numeric DEFAULT NULL,
  p_method text DEFAULT 'cash', p_items jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sale public.sales%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
  PERFORM public.pos_assert_staff(v_sale.store_id);
  IF p_kind NOT IN ('void', 'refund', 'return') THEN RAISE EXCEPTION 'Invalid request type'; END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'Reason is required'; END IF;
  IF v_sale.status::text NOT IN ('completed', 'partially_refunded') THEN RAISE EXCEPTION 'This sale can no longer be adjusted'; END IF;
  IF p_kind = 'void' AND v_sale.status::text <> 'completed' THEN RAISE EXCEPTION 'Only completed sales can be voided'; END IF;
  IF p_kind = 'refund' AND (p_amount IS NULL OR p_amount <= 0 OR p_amount > v_sale.total) THEN RAISE EXCEPTION 'Invalid refund amount'; END IF;
  IF p_kind = 'return' AND (p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0) THEN
    RAISE EXCEPTION 'Choose at least one returned item'; END IF;
  IF p_method NOT IN ('cash', 'gcash', 'card', 'bank_transfer', 'other') THEN RAISE EXCEPTION 'Invalid refund method'; END IF;
  IF EXISTS (SELECT 1 FROM public.sale_adjustment_requests WHERE sale_id = p_sale_id AND state = 'pending') THEN
    RAISE EXCEPTION 'This sale already has a pending request'; END IF;
  INSERT INTO public.sale_adjustment_requests(store_id, sale_id, kind, reason, amount, method, items, requested_by)
  VALUES (v_sale.store_id, p_sale_id, p_kind, btrim(p_reason), round(p_amount, 2), p_method, p_items, auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'state', 'pending');
END $$;

CREATE OR REPLACE FUNCTION public.list_sale_adjustment_requests(p_store_id uuid, p_state text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text;
BEGIN
  v_role := public.pos_assert_staff(p_store_id);
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(r) || jsonb_build_object(
      'receipt_number', sa.receipt_number, 'sale_total', sa.total,
      'requester_name', (SELECT name FROM public.profiles WHERE id = r.requested_by),
      'decider_name', (SELECT name FROM public.profiles WHERE id = r.decided_by)) ORDER BY r.requested_at DESC)
    FROM public.sale_adjustment_requests r JOIN public.sales sa ON sa.id = r.sale_id
    WHERE r.store_id = p_store_id AND (p_state IS NULL OR r.state = p_state)
      AND (v_role = 'admin' OR r.requested_by = auth.uid())), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.decide_sale_adjustment(p_request_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.sale_adjustment_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.sale_adjustment_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF public.pos_assert_staff(r.store_id) <> 'admin' THEN RAISE EXCEPTION 'Only store admins can decide requests'; END IF;
  IF r.state <> 'pending' THEN RAISE EXCEPTION 'Request was already decided'; END IF;
  IF r.requested_by = auth.uid() THEN RAISE EXCEPTION 'You cannot approve your own request'; END IF;
  IF p_approve THEN
    -- Existing admin-only lifecycle functions do the stock/payment work; the caller is the approving admin.
    IF r.kind = 'void' THEN
      PERFORM public.void_pos_sale(r.sale_id, r.reason);
    ELSIF r.kind = 'refund' THEN
      PERFORM public.refund_pos_sale(r.sale_id, r.amount, r.method::public.payment_method, r.reason, NULL);
    ELSE
      PERFORM public.return_sale_items(r.sale_id, r.items, r.reason, r.method::public.payment_method, NULL);
    END IF;
  END IF;
  UPDATE public.sale_adjustment_requests SET state = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    decided_by = auth.uid(), decided_at = now(), decision_note = NULLIF(btrim(p_note), '') WHERE id = r.id;
  RETURN jsonb_build_object('id', r.id, 'state', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END);
END $$;

-- ===== Optional customer tracking =====
CREATE OR REPLACE FUNCTION public.link_sale_customer(p_sale_id uuid, p_customer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sale public.sales%ROWTYPE;
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
  PERFORM public.pos_assert_staff(v_sale.store_id);
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id AND store_id = v_sale.store_id AND active) THEN
    RAISE EXCEPTION 'Customer not found in this store'; END IF;
  IF v_sale.customer_id IS NOT NULL THEN RETURN; END IF;
  UPDATE public.sales SET customer_id = p_customer_id WHERE id = p_sale_id;
END $$;

CREATE OR REPLACE FUNCTION public.get_customer_history(p_customer_id uuid, p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_store uuid;
BEGIN
  SELECT store_id INTO v_store FROM public.customers WHERE id = p_customer_id;
  IF v_store IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;
  IF public.pos_assert_staff(v_store) <> 'admin' THEN RAISE EXCEPTION 'Only store admins can view customer history'; END IF;
  RETURN jsonb_build_object(
    'visits', (SELECT count(*) FROM public.sales WHERE customer_id = p_customer_id AND status::text <> 'voided'),
    'total_spent', (SELECT COALESCE(sum(total), 0) FROM public.sales WHERE customer_id = p_customer_id AND status::text <> 'voided'),
    'last_purchase_at', (SELECT max(created_at) FROM public.sales WHERE customer_id = p_customer_id AND status::text <> 'voided'),
    'sales', COALESCE((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
      SELECT sa.id, sa.created_at, sa.total, sa.status, sa.payment_method, sa.receipt_number,
        (SELECT string_agg(si.product_name || ' x' || si.quantity::text, ', ') FROM public.sale_items si WHERE si.sale_id = sa.id) AS items
      FROM public.sales sa WHERE sa.customer_id = p_customer_id
      ORDER BY sa.created_at DESC LIMIT LEAST(GREATEST(p_limit, 1), 200)) x), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.customer_rankings(p_store_id uuid, p_from timestamptz, p_to timestamptz, p_by text DEFAULT 'spend', p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.pos_assert_staff(p_store_id) <> 'admin' THEN RAISE EXCEPTION 'Only store admins can view rankings'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT c.id AS customer_id, c.display_name, count(*) AS visits, sum(sa.total) AS total_spent, max(sa.created_at) AS last_purchase_at
    FROM public.sales sa JOIN public.customers c ON c.id = sa.customer_id
    WHERE sa.store_id = p_store_id AND sa.status::text <> 'voided' AND sa.created_at >= p_from AND sa.created_at < p_to
    GROUP BY c.id, c.display_name
    ORDER BY CASE WHEN p_by = 'visits' THEN count(*) ELSE sum(sa.total) END DESC LIMIT LEAST(GREATEST(p_limit, 1), 100)) x), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.pos_assert_staff(uuid), public.drawer_session_totals(uuid), public.session_json(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.open_drawer_session(uuid, numeric), public.get_open_drawer_session(uuid),
  public.record_drawer_entry(uuid, text, numeric, text), public.close_drawer_session(uuid, numeric, text),
  public.list_drawer_sessions(uuid, text, integer), public.review_drawer_session(uuid, text, text),
  public.request_sale_adjustment(uuid, text, text, numeric, text, jsonb), public.list_sale_adjustment_requests(uuid, text),
  public.decide_sale_adjustment(uuid, boolean, text), public.link_sale_customer(uuid, uuid),
  public.get_customer_history(uuid, integer), public.customer_rankings(uuid, timestamptz, timestamptz, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_drawer_session(uuid, numeric), public.get_open_drawer_session(uuid),
  public.record_drawer_entry(uuid, text, numeric, text), public.close_drawer_session(uuid, numeric, text),
  public.list_drawer_sessions(uuid, text, integer), public.review_drawer_session(uuid, text, text),
  public.request_sale_adjustment(uuid, text, text, numeric, text, jsonb), public.list_sale_adjustment_requests(uuid, text),
  public.decide_sale_adjustment(uuid, boolean, text), public.link_sale_customer(uuid, uuid),
  public.get_customer_history(uuid, integer), public.customer_rankings(uuid, timestamptz, timestamptz, text, integer)
  TO authenticated;
