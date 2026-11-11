-- T25: immutable shift-scoped cash ledger and reservation foundation.
-- No legacy closeouts are converted and no store flag is enabled here.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE public.cash_movements (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  ledger_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  drawer_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  source_key text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(source_key)) BETWEEN 1 AND 160),
  source_type text NOT NULL CHECK (source_type IN (
    'shift_open', 'sale', 'refund', 'void', 'digital_service', 'manual_cash', 'closeout'
  )),
  source_id uuid,
  movement_type text NOT NULL CHECK (movement_type IN (
    'opening', 'cash_sale', 'cash_refund', 'void_reversal', 'digital_cash_in',
    'digital_cash_out', 'add', 'remove', 'drop', 'adjustment', 'closing_count'
  )),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  cash_delta numeric(14,2) NOT NULL,
  balance_before numeric(14,2) NOT NULL CHECK (balance_before >= 0),
  balance_after numeric(14,2) NOT NULL CHECK (balance_after >= 0),
  reason text,
  occurred_at_local timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT cash_movements_store_id_unique UNIQUE (store_id, id),
  CONSTRAINT cash_movements_operation_source_unique
    UNIQUE (store_id, operation_id, source_key, movement_type),
  CONSTRAINT cash_movements_store_drawer_fkey
    FOREIGN KEY (store_id, drawer_id)
    REFERENCES public.cash_drawers (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT cash_movements_store_shift_fkey
    FOREIGN KEY (store_id, shift_id)
    REFERENCES public.cashier_shifts (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT cash_movements_store_operation_fkey
    FOREIGN KEY (store_id, operation_id)
    REFERENCES public.pos_operations (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT cash_movements_balance_arithmetic
    CHECK (balance_after = balance_before + cash_delta),
  CONSTRAINT cash_movements_amount_delta_shape CHECK (
    (movement_type = 'closing_count' AND cash_delta = 0)
    OR (movement_type = 'opening' AND amount > 0 AND cash_delta = amount)
    OR (movement_type IN ('cash_sale', 'digital_cash_in', 'add') AND amount > 0 AND cash_delta = amount)
    OR (movement_type IN ('cash_refund', 'void_reversal', 'digital_cash_out', 'remove', 'drop')
      AND amount > 0 AND cash_delta = -amount)
    OR (movement_type = 'adjustment' AND amount > 0 AND pg_catalog.abs(cash_delta) = amount AND cash_delta <> 0)
  ),
  CONSTRAINT cash_movements_reason_required CHECK (
    movement_type NOT IN ('add', 'remove', 'drop', 'adjustment')
    OR (reason IS NOT NULL AND pg_catalog.length(pg_catalog.btrim(reason)) BETWEEN 3 AND 500)
  ),
  CONSTRAINT cash_movements_source_identity CHECK (
    (source_type = 'shift_open' AND movement_type = 'opening')
    OR (source_type = 'sale' AND movement_type = 'cash_sale')
    OR (source_type = 'refund' AND movement_type = 'cash_refund')
    OR (source_type = 'void' AND movement_type = 'void_reversal')
    OR (source_type = 'digital_service' AND movement_type IN ('digital_cash_in', 'digital_cash_out'))
    OR (source_type = 'manual_cash' AND movement_type IN ('add', 'remove', 'drop', 'adjustment'))
    OR (source_type = 'closeout' AND movement_type = 'closing_count')
  )
);

CREATE INDEX cash_movements_shift_sequence_idx
  ON public.cash_movements (store_id, shift_id, ledger_sequence DESC);
CREATE INDEX cash_movements_drawer_created_idx
  ON public.cash_movements (store_id, drawer_id, created_at DESC, id DESC);

CREATE TABLE public.cash_reservations (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  drawer_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  source_key text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(source_key)) BETWEEN 1 AND 160),
  source_type text NOT NULL CHECK (source_type IN ('refund', 'digital_service', 'cash_out')),
  source_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  remaining_amount numeric(14,2) NOT NULL CHECK (remaining_amount >= 0 AND remaining_amount <= amount),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'consumed', 'released')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  reason text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(reason)) BETWEEN 3 AND 500),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT cash_reservations_store_id_unique UNIQUE (store_id, id),
  CONSTRAINT cash_reservations_operation_source_unique UNIQUE (store_id, operation_id, source_key),
  CONSTRAINT cash_reservations_state_remaining_check CHECK (
    (state = 'active' AND remaining_amount > 0)
    OR (state IN ('consumed', 'released') AND remaining_amount = 0)
  ),
  CONSTRAINT cash_reservations_store_drawer_fkey
    FOREIGN KEY (store_id, drawer_id)
    REFERENCES public.cash_drawers (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT cash_reservations_store_shift_fkey
    FOREIGN KEY (store_id, shift_id)
    REFERENCES public.cashier_shifts (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT cash_reservations_store_operation_fkey
    FOREIGN KEY (store_id, operation_id)
    REFERENCES public.pos_operations (store_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX cash_reservations_one_active_source_uidx
  ON public.cash_reservations (store_id, source_type, source_id)
  WHERE state = 'active';
CREATE INDEX cash_reservations_active_shift_idx
  ON public.cash_reservations (store_id, shift_id, created_at, id)
  WHERE state = 'active';

CREATE TABLE public.cash_reservation_events (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  store_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('reserved', 'consumed', 'released')),
  event_amount numeric(14,2) NOT NULL CHECK (event_amount > 0),
  remaining_after numeric(14,2) NOT NULL CHECK (remaining_after >= 0),
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT cash_reservation_events_operation_unique
    UNIQUE (store_id, reservation_id, operation_id, event_type),
  CONSTRAINT cash_reservation_events_reservation_fkey
    FOREIGN KEY (store_id, reservation_id)
    REFERENCES public.cash_reservations (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT cash_reservation_events_operation_fkey
    FOREIGN KEY (store_id, operation_id)
    REFERENCES public.pos_operations (store_id, id) ON DELETE RESTRICT
);

CREATE INDEX cash_reservation_events_history_idx
  ON public.cash_reservation_events (store_id, reservation_id, created_at, id);

CREATE TABLE public.payment_cash_links (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL REFERENCES public.sale_payments(id) ON DELETE RESTRICT,
  cash_movement_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  source_key text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(source_key)) BETWEEN 1 AND 160),
  allocation_kind text NOT NULL CHECK (allocation_kind IN ('tender', 'service_fee', 'service_principal')),
  allocated_amount numeric(14,2) NOT NULL CHECK (allocated_amount > 0),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT payment_cash_links_store_movement_fkey
    FOREIGN KEY (store_id, cash_movement_id)
    REFERENCES public.cash_movements (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT payment_cash_links_store_operation_fkey
    FOREIGN KEY (store_id, operation_id)
    REFERENCES public.pos_operations (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT payment_cash_links_payment_movement_unique
    UNIQUE (store_id, payment_id, cash_movement_id, allocation_kind),
  CONSTRAINT payment_cash_links_operation_source_unique
    UNIQUE (store_id, operation_id, source_key)
);

CREATE INDEX payment_cash_links_payment_idx
  ON public.payment_cash_links (store_id, payment_id, created_at, id);

CREATE TABLE public.payment_service_links (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL REFERENCES public.sale_payments(id) ON DELETE RESTRICT,
  service_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  source_key text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(source_key)) BETWEEN 1 AND 160),
  source_kind text NOT NULL CHECK (source_kind IN ('cash_movement', 'external_settlement', 'service_clearing')),
  source_id uuid NOT NULL,
  cash_movement_id uuid,
  allocated_amount numeric(14,2) NOT NULL CHECK (allocated_amount > 0),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT payment_service_links_cash_source_shape CHECK (
    (source_kind = 'cash_movement' AND cash_movement_id IS NOT NULL AND cash_movement_id = source_id)
    OR (source_kind <> 'cash_movement' AND cash_movement_id IS NULL)
  ),
  CONSTRAINT payment_service_links_store_movement_fkey
    FOREIGN KEY (store_id, cash_movement_id)
    REFERENCES public.cash_movements (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT payment_service_links_store_operation_fkey
    FOREIGN KEY (store_id, operation_id)
    REFERENCES public.pos_operations (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT payment_service_links_source_unique
    UNIQUE (store_id, payment_id, source_kind, source_id),
  CONSTRAINT payment_service_links_operation_source_unique
    UNIQUE (store_id, operation_id, source_key)
);

CREATE INDEX payment_service_links_payment_idx
  ON public.payment_service_links (store_id, payment_id, created_at, id);

ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_reservation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_cash_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_service_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY cash_movements_api_deny
  ON public.cash_movements FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY cash_reservations_api_deny
  ON public.cash_reservations FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY cash_reservation_events_api_deny
  ON public.cash_reservation_events FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY payment_cash_links_api_deny
  ON public.payment_cash_links FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY payment_service_links_api_deny
  ON public.payment_service_links FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE public.cash_movements, public.cash_reservations,
  public.cash_reservation_events, public.payment_cash_links, public.payment_service_links
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.cash_movements IS
  'Append-only physical cash effects scoped to the performing cashier shift; no legacy cash is reconstructed.';
COMMENT ON TABLE public.cash_reservations IS
  'Mutable active-hold projection; every reserve, consume, or release also appends a cash_reservation_events row.';
COMMENT ON TABLE public.cash_reservation_events IS
  'Append-only lifecycle evidence for physical cash holds, linked to their idempotent POS operations.';
COMMENT ON TABLE public.payment_cash_links IS
  'Append-only allocation of captured cash movement amounts to sale payments; aggregate bounds are checked by the T26 command helper.';
COMMENT ON TABLE public.payment_service_links IS
  'Append-only allocation of a payment to observed cash, external settlement, or service-clearing facts.';

CREATE OR REPLACE FUNCTION private.reject_cash_fact_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Cash ledger facts are append-only'
    USING ERRCODE = '55000';
END;
$function$;

CREATE OR REPLACE FUNCTION private.guard_cash_reservation_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Cash reservations are retained as hold history'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.store_id IS DISTINCT FROM OLD.store_id
    OR NEW.drawer_id IS DISTINCT FROM OLD.drawer_id
    OR NEW.shift_id IS DISTINCT FROM OLD.shift_id
    OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
    OR NEW.source_key IS DISTINCT FROM OLD.source_key
    OR NEW.source_type IS DISTINCT FROM OLD.source_type
    OR NEW.source_id IS DISTINCT FROM OLD.source_id
    OR NEW.amount IS DISTINCT FROM OLD.amount
    OR NEW.reason IS DISTINCT FROM OLD.reason
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.version <> OLD.version + 1
    OR OLD.state <> 'active'
    OR NEW.remaining_amount >= OLD.remaining_amount
    OR NEW.state NOT IN ('active', 'consumed', 'released')
    OR ((NEW.state = 'active') <> (NEW.remaining_amount > 0)) THEN
    RAISE EXCEPTION 'Cash reservation updates must reduce the active hold exactly once'
      USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.assert_cash_movement_command()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
  v_shift public.cashier_shifts%ROWTYPE;
BEGIN
  SELECT operation.* INTO v_operation
  FROM public.pos_operations AS operation
  WHERE operation.store_id = NEW.store_id AND operation.id = NEW.operation_id;
  IF NOT FOUND OR v_operation.status <> 'processing'
    OR v_operation.actor_id IS DISTINCT FROM NEW.actor_id
    OR (SELECT auth.uid()) IS DISTINCT FROM NEW.actor_id THEN
    RAISE EXCEPTION 'Cash movement must be posted by its active command actor'
      USING ERRCODE = '42501';
  END IF;

  SELECT shift.* INTO v_shift
  FROM public.cashier_shifts AS shift
  WHERE shift.store_id = NEW.store_id AND shift.id = NEW.shift_id;
  IF NOT FOUND OR v_shift.drawer_id IS DISTINCT FROM NEW.drawer_id THEN
    RAISE EXCEPTION 'Cash movement must reference the shift drawer'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.movement_type = 'opening' THEN
    IF v_operation.kind <> 'open_cashier_shift'
      OR v_operation.shift_id IS NOT NULL
      OR v_shift.open_operation_id IS DISTINCT FROM NEW.operation_id
      OR v_shift.opening_amount IS DISTINCT FROM NEW.amount THEN
      RAISE EXCEPTION 'Opening cash must match its shift-opening command and snapshot'
        USING ERRCODE = '23514';
    END IF;
  ELSIF v_operation.shift_id IS DISTINCT FROM NEW.shift_id
    OR v_operation.terminal_id IS DISTINCT FROM v_shift.terminal_id THEN
    RAISE EXCEPTION 'Cash movement command is not bound to the performing shift'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.guard_cash_reservation_event_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
BEGIN
  SELECT operation.* INTO v_operation
  FROM public.pos_operations AS operation
  WHERE operation.store_id = NEW.store_id AND operation.id = NEW.operation_id;
  IF NOT FOUND OR v_operation.status <> 'processing'
    OR v_operation.actor_id IS DISTINCT FROM NEW.actor_id
    OR (SELECT auth.uid()) IS DISTINCT FROM NEW.actor_id THEN
    RAISE EXCEPTION 'Cash reservation event must be posted by its active command actor'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.assert_payment_cash_link_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_payment_store uuid;
  v_payment_amount numeric(14,2);
  v_payment_method text;
  v_movement_delta numeric(14,2);
  v_allocated numeric(14,2);
  v_movement_allocated numeric(14,2);
BEGIN
  SELECT payment.store_id, payment.amount::numeric(14,2), payment.method::text
  INTO v_payment_store, v_payment_amount, v_payment_method
  FROM public.sale_payments AS payment
  WHERE payment.id = NEW.payment_id
  FOR UPDATE;
  IF NOT FOUND OR v_payment_store IS DISTINCT FROM NEW.store_id OR v_payment_method <> 'cash' THEN
    RAISE EXCEPTION 'Payment cash link must stay within the payment store'
      USING ERRCODE = '23514';
  END IF;
  SELECT movement.cash_delta INTO v_movement_delta
  FROM public.cash_movements AS movement
  WHERE movement.store_id = NEW.store_id AND movement.id = NEW.cash_movement_id
  FOR UPDATE;
  IF NOT FOUND OR v_movement_delta <= 0 THEN
    RAISE EXCEPTION 'Payment cash links require a positive cash collection'
      USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(pg_catalog.sum(link.allocated_amount), 0)::numeric(14,2)
  INTO v_allocated
  FROM public.payment_cash_links AS link
  WHERE link.store_id = NEW.store_id AND link.payment_id = NEW.payment_id;
  SELECT COALESCE(pg_catalog.sum(link.allocated_amount), 0)::numeric(14,2)
  INTO v_movement_allocated
  FROM public.payment_cash_links AS link
  WHERE link.store_id = NEW.store_id AND link.cash_movement_id = NEW.cash_movement_id;
  IF v_allocated + NEW.allocated_amount > v_payment_amount
    OR v_movement_allocated + NEW.allocated_amount > v_movement_delta THEN
    RAISE EXCEPTION 'Payment cash allocation exceeds payment or collected cash'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.assert_payment_service_link_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_payment_store uuid;
  v_payment_method text;
  v_movement_delta numeric(14,2);
BEGIN
  SELECT payment.store_id, payment.method::text INTO v_payment_store, v_payment_method
  FROM public.sale_payments AS payment
  WHERE payment.id = NEW.payment_id
  FOR UPDATE;
  IF NOT FOUND OR v_payment_store IS DISTINCT FROM NEW.store_id THEN
    RAISE EXCEPTION 'Payment service link must stay within the payment store'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.source_kind = 'cash_movement' THEN
    SELECT movement.cash_delta INTO v_movement_delta
    FROM public.cash_movements AS movement
    WHERE movement.store_id = NEW.store_id AND movement.id = NEW.cash_movement_id
    FOR UPDATE;
    IF NOT FOUND OR v_movement_delta <= 0 OR v_payment_method <> 'cash' THEN
      RAISE EXCEPTION 'Cash service payment links require a cash payment and positive collection'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER cash_movements_append_only
  BEFORE UPDATE OR DELETE ON public.cash_movements
  FOR EACH ROW EXECUTE FUNCTION private.reject_cash_fact_mutation();
CREATE TRIGGER cash_movements_command_guard
  BEFORE INSERT ON public.cash_movements
  FOR EACH ROW EXECUTE FUNCTION private.assert_cash_movement_command();
CREATE TRIGGER cash_reservations_lifecycle_guard
  BEFORE UPDATE OR DELETE ON public.cash_reservations
  FOR EACH ROW EXECUTE FUNCTION private.guard_cash_reservation_lifecycle();
CREATE TRIGGER cash_reservation_events_append_only
  BEFORE UPDATE OR DELETE ON public.cash_reservation_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_cash_fact_mutation();
CREATE TRIGGER cash_reservation_events_command_guard
  BEFORE INSERT ON public.cash_reservation_events
  FOR EACH ROW EXECUTE FUNCTION private.guard_cash_reservation_event_insert();
CREATE TRIGGER payment_cash_links_append_only
  BEFORE UPDATE OR DELETE ON public.payment_cash_links
  FOR EACH ROW EXECUTE FUNCTION private.reject_cash_fact_mutation();
CREATE TRIGGER payment_cash_links_scope_guard
  BEFORE INSERT ON public.payment_cash_links
  FOR EACH ROW EXECUTE FUNCTION private.assert_payment_cash_link_scope();
CREATE TRIGGER payment_service_links_append_only
  BEFORE UPDATE OR DELETE ON public.payment_service_links
  FOR EACH ROW EXECUTE FUNCTION private.reject_cash_fact_mutation();
CREATE TRIGGER payment_service_links_scope_guard
  BEFORE INSERT ON public.payment_service_links
  FOR EACH ROW EXECUTE FUNCTION private.assert_payment_service_link_scope();

REVOKE ALL ON FUNCTION private.reject_cash_fact_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_cash_reservation_lifecycle() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.assert_cash_movement_command() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_cash_reservation_event_insert() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.assert_payment_cash_link_scope() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.assert_payment_service_link_scope() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.cashier_shift_cash_position(
  p_store_id uuid,
  p_shift_id uuid
)
RETURNS TABLE (
  posted_balance numeric(14,2),
  reserved_balance numeric(14,2),
  available_balance numeric(14,2)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(movements.posted, 0)::numeric(14,2),
    COALESCE(reservations.reserved, 0)::numeric(14,2),
    (COALESCE(movements.posted, 0) - COALESCE(reservations.reserved, 0))::numeric(14,2)
  FROM (SELECT 1) AS seed
  LEFT JOIN LATERAL (
    SELECT pg_catalog.sum(movement.cash_delta) AS posted
    FROM public.cash_movements AS movement
    WHERE movement.store_id = p_store_id AND movement.shift_id = p_shift_id
  ) AS movements ON true
  LEFT JOIN LATERAL (
    SELECT pg_catalog.sum(reservation.remaining_amount) AS reserved
    FROM public.cash_reservations AS reservation
    WHERE reservation.store_id = p_store_id AND reservation.shift_id = p_shift_id
      AND reservation.state = 'active'
  ) AS reservations ON true
$function$;

CREATE OR REPLACE FUNCTION private.post_cash_movement(
  p_store_id uuid,
  p_drawer_id uuid,
  p_shift_id uuid,
  p_operation_id uuid,
  p_source_key text,
  p_source_type text,
  p_source_id uuid,
  p_movement_type text,
  p_amount numeric,
  p_cash_delta numeric,
  p_reason text,
  p_occurred_at_local timestamptz
)
RETURNS public.cash_movements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_actor_role text;
  v_operation public.pos_operations%ROWTYPE;
  v_shift public.cashier_shifts%ROWTYPE;
  v_position record;
  v_movement public.cash_movements%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR NOT private.mfa_session_is_valid() THEN
    PERFORM private.raise_pos_operation_error('MFA_REQUIRED', 'A valid signed-in MFA session is required.', '42501');
  END IF;
  PERFORM private.assert_store_feature_enabled(p_store_id, 'drawer_shifts');
  SELECT profile.role::text INTO v_actor_role FROM public.profiles AS profile WHERE profile.id = v_actor_id;
  IF v_actor_role NOT IN ('admin', 'cashier') THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'Only a cashier or assigned store administrator can post drawer cash.', '42501');
  END IF;
  IF p_amount IS NULL OR p_amount < 0 OR p_amount <> pg_catalog.round(p_amount, 2)
    OR p_amount >= 1000000000000::numeric
    OR p_cash_delta IS NULL OR p_cash_delta <> pg_catalog.round(p_cash_delta, 2)
    OR p_cash_delta >= 1000000000000::numeric OR p_cash_delta <= -1000000000000::numeric
    OR p_source_key IS NULL OR pg_catalog.length(pg_catalog.btrim(p_source_key)) NOT BETWEEN 1 AND 160 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Cash movement amount, delta, or source key is invalid.');
  END IF;

  SELECT operation.* INTO v_operation
  FROM public.pos_operations AS operation
  WHERE operation.store_id = p_store_id AND operation.id = p_operation_id;
  IF NOT FOUND OR v_operation.actor_id IS DISTINCT FROM v_actor_id OR v_operation.status <> 'processing' THEN
    PERFORM private.raise_pos_operation_error('IDEMPOTENCY_MISMATCH', 'Cash movement requires the current uncommitted command.');
  END IF;

  SELECT shift.* INTO v_shift
  FROM public.cashier_shifts AS shift
  WHERE shift.store_id = p_store_id AND shift.id = p_shift_id
  FOR UPDATE;
  IF NOT FOUND OR v_shift.drawer_id IS DISTINCT FROM p_drawer_id THEN
    PERFORM private.raise_pos_operation_error('SHIFT_NOT_FOUND', 'Cash movement shift and drawer do not match.', '23503');
  END IF;
  IF p_movement_type = 'opening' THEN
    IF v_shift.state <> 'active' OR v_shift.open_operation_id <> p_operation_id
      OR v_operation.kind <> 'open_cashier_shift' OR v_operation.shift_id IS NOT NULL
      OR v_shift.opening_amount IS DISTINCT FROM p_amount THEN
      PERFORM private.raise_pos_operation_error('OPENING_MISMATCH', 'Opening movement must match its new shift snapshot.');
    END IF;
  ELSE
    IF v_operation.shift_id IS DISTINCT FROM p_shift_id OR v_operation.terminal_id IS DISTINCT FROM v_shift.terminal_id THEN
      PERFORM private.raise_pos_operation_error('SHIFT_CONTEXT_MISMATCH', 'Cash movement command is not bound to this shift.');
    END IF;
    IF (p_movement_type = 'closing_count' AND v_shift.state NOT IN ('active', 'submitting'))
      OR (p_movement_type <> 'closing_count' AND v_shift.state <> 'active') THEN
      PERFORM private.raise_pos_operation_error('SHIFT_NOT_ACTIVE', 'This shift does not accept the requested cash movement.');
    END IF;
  END IF;

  SELECT position.* INTO v_position
  FROM private.cashier_shift_cash_position(p_store_id, p_shift_id) AS position;
  IF p_movement_type <> 'opening'
    AND v_position.posted_balance - v_position.reserved_balance + p_cash_delta < 0 THEN
    PERFORM private.raise_pos_operation_error('INSUFFICIENT_DRAWER_CASH', 'Available drawer cash is insufficient for this outflow.', '23514');
  END IF;
  IF p_movement_type = 'opening' AND v_position.posted_balance <> 0 THEN
    PERFORM private.raise_pos_operation_error('DUPLICATE_OPENING_MOVEMENT', 'This shift already has opening cash posted.', '23505');
  END IF;
  IF p_movement_type = 'closing_count' AND p_cash_delta <> 0 THEN
    PERFORM private.raise_pos_operation_error('COUNT_IS_OBSERVATION', 'A closing count cannot change drawer cash.');
  END IF;

  INSERT INTO public.cash_movements (
    store_id, drawer_id, shift_id, operation_id, actor_id, source_key, source_type, source_id,
    movement_type, amount, cash_delta, balance_before, balance_after, reason, occurred_at_local
  )
  VALUES (
    p_store_id, p_drawer_id, p_shift_id, p_operation_id, v_actor_id, p_source_key, p_source_type, p_source_id,
    p_movement_type, p_amount, p_cash_delta, v_position.posted_balance,
    v_position.posted_balance + p_cash_delta, NULLIF(pg_catalog.btrim(p_reason), ''), p_occurred_at_local
  )
  RETURNING * INTO v_movement;

  UPDATE public.cashier_shifts AS shift
  SET last_cash_sequence = v_movement.ledger_sequence,
      version = shift.version + 1
  WHERE shift.store_id = p_store_id AND shift.id = p_shift_id;
  RETURN v_movement;
END;
$function$;

CREATE OR REPLACE FUNCTION private.reserve_cash(
  p_store_id uuid,
  p_drawer_id uuid,
  p_shift_id uuid,
  p_operation_id uuid,
  p_source_key text,
  p_source_type text,
  p_source_id uuid,
  p_amount numeric,
  p_reason text
)
RETURNS public.cash_reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_actor_role text;
  v_operation public.pos_operations%ROWTYPE;
  v_shift public.cashier_shifts%ROWTYPE;
  v_position record;
  v_reservation public.cash_reservations%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR NOT private.mfa_session_is_valid() THEN
    PERFORM private.raise_pos_operation_error('MFA_REQUIRED', 'A valid signed-in MFA session is required.', '42501');
  END IF;
  PERFORM private.assert_store_feature_enabled(p_store_id, 'drawer_shifts');
  SELECT profile.role::text INTO v_actor_role FROM public.profiles AS profile WHERE profile.id = v_actor_id;
  IF v_actor_role NOT IN ('admin', 'cashier') THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'Only a cashier or assigned store administrator can reserve drawer cash.', '42501');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> pg_catalog.round(p_amount, 2)
    OR p_amount >= 1000000000000::numeric
    OR p_source_key IS NULL OR pg_catalog.length(pg_catalog.btrim(p_source_key)) NOT BETWEEN 1 AND 160
    OR p_source_type IS NULL OR p_source_type NOT IN ('refund', 'digital_service', 'cash_out')
    OR p_source_id IS NULL OR p_reason IS NULL
    OR pg_catalog.length(pg_catalog.btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Cash reservation fields are invalid.');
  END IF;
  SELECT operation.* INTO v_operation FROM public.pos_operations AS operation
  WHERE operation.store_id = p_store_id AND operation.id = p_operation_id;
  IF NOT FOUND OR v_operation.actor_id IS DISTINCT FROM v_actor_id
    OR v_operation.status <> 'processing' OR v_operation.shift_id IS DISTINCT FROM p_shift_id THEN
    PERFORM private.raise_pos_operation_error('IDEMPOTENCY_MISMATCH', 'Cash reservation requires the current shift command.');
  END IF;
  SELECT shift.* INTO v_shift FROM public.cashier_shifts AS shift
  WHERE shift.store_id = p_store_id AND shift.id = p_shift_id FOR UPDATE;
  IF NOT FOUND OR v_shift.drawer_id IS DISTINCT FROM p_drawer_id
    OR v_shift.terminal_id IS DISTINCT FROM v_operation.terminal_id OR v_shift.state <> 'active' THEN
    PERFORM private.raise_pos_operation_error('SHIFT_NOT_ACTIVE', 'Cash can only be reserved against its active shift.');
  END IF;
  SELECT position.* INTO v_position
  FROM private.cashier_shift_cash_position(p_store_id, p_shift_id) AS position;
  IF v_position.available_balance < p_amount THEN
    PERFORM private.raise_pos_operation_error('INSUFFICIENT_DRAWER_CASH', 'Available drawer cash is insufficient for this reservation.', '23514');
  END IF;
  INSERT INTO public.cash_reservations (
    store_id, drawer_id, shift_id, operation_id, source_key, source_type, source_id,
    amount, remaining_amount, state, reason, created_by
  ) VALUES (
    p_store_id, p_drawer_id, p_shift_id, p_operation_id, p_source_key, p_source_type, p_source_id,
    p_amount, p_amount, 'active', pg_catalog.btrim(p_reason), v_actor_id
  ) RETURNING * INTO v_reservation;
  INSERT INTO public.cash_reservation_events (
    store_id, reservation_id, operation_id, event_type, event_amount, remaining_after, actor_id
  ) VALUES (p_store_id, v_reservation.id, p_operation_id, 'reserved', p_amount, p_amount, v_actor_id);
  UPDATE public.cashier_shifts AS shift
  SET version = shift.version + 1
  WHERE shift.store_id = p_store_id AND shift.id = p_shift_id;
  RETURN v_reservation;
END;
$function$;

CREATE OR REPLACE FUNCTION private.consume_cash_reservation(
  p_store_id uuid,
  p_reservation_id uuid,
  p_operation_id uuid,
  p_amount numeric,
  p_source_key text,
  p_movement_type text,
  p_source_type text,
  p_source_id uuid,
  p_reason text,
  p_occurred_at_local timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_actor_role text;
  v_operation public.pos_operations%ROWTYPE;
  v_reservation public.cash_reservations%ROWTYPE;
  v_shift public.cashier_shifts%ROWTYPE;
  v_movement public.cash_movements%ROWTYPE;
BEGIN
  SELECT reservation.* INTO v_reservation
  FROM public.cash_reservations AS reservation
  WHERE reservation.store_id = p_store_id AND reservation.id = p_reservation_id;
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('RESERVATION_NOT_FOUND', 'Cash reservation was not found.', '23503');
  END IF;
  SELECT shift.* INTO v_shift FROM public.cashier_shifts AS shift
  WHERE shift.store_id = p_store_id AND shift.id = v_reservation.shift_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('SHIFT_NOT_FOUND', 'The reservation shift no longer exists.', '23503');
  END IF;
  SELECT reservation.* INTO v_reservation FROM public.cash_reservations AS reservation
  WHERE reservation.store_id = p_store_id AND reservation.id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('RESERVATION_NOT_FOUND', 'Cash reservation was not found.', '23503');
  END IF;
  SELECT operation.* INTO v_operation FROM public.pos_operations AS operation
  WHERE operation.store_id = p_store_id AND operation.id = p_operation_id;
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('IDEMPOTENCY_MISMATCH', 'Cash consumption command was not found.');
  END IF;
  SELECT profile.role::text INTO v_actor_role FROM public.profiles AS profile WHERE profile.id = v_actor_id;
  IF v_actor_id IS NULL OR NOT private.mfa_session_is_valid()
    OR v_actor_role NOT IN ('admin', 'cashier')
    OR v_operation.actor_id IS DISTINCT FROM v_actor_id
    OR v_operation.status <> 'processing' OR v_operation.shift_id IS DISTINCT FROM v_reservation.shift_id
    OR v_operation.terminal_id IS DISTINCT FROM v_shift.terminal_id
    OR v_shift.drawer_id IS DISTINCT FROM v_reservation.drawer_id
    OR v_shift.state <> 'active' OR v_reservation.state <> 'active' THEN
    PERFORM private.raise_pos_operation_error('RESERVATION_NOT_ACTIVE', 'The active shift, reservation, or command does not match.', '42501');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> pg_catalog.round(p_amount, 2)
    OR p_amount > v_reservation.remaining_amount
    OR p_movement_type IS NULL
    OR p_movement_type NOT IN ('cash_refund', 'void_reversal', 'digital_cash_out', 'remove', 'drop') THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Cash reservation consumption amount or type is invalid.');
  END IF;
  UPDATE public.cash_reservations AS reservation
  SET remaining_amount = reservation.remaining_amount - p_amount,
      state = CASE WHEN reservation.remaining_amount - p_amount = 0 THEN 'consumed' ELSE 'active' END,
      version = reservation.version + 1
  WHERE reservation.store_id = p_store_id AND reservation.id = p_reservation_id
  RETURNING * INTO v_reservation;
  INSERT INTO public.cash_reservation_events (
    store_id, reservation_id, operation_id, event_type, event_amount, remaining_after, actor_id
  ) VALUES (p_store_id, p_reservation_id, p_operation_id, 'consumed', p_amount, v_reservation.remaining_amount, v_actor_id);
  v_movement := private.post_cash_movement(
    p_store_id, v_reservation.drawer_id, v_reservation.shift_id, p_operation_id,
    p_source_key, p_source_type, p_source_id, p_movement_type, p_amount, -p_amount,
    p_reason, p_occurred_at_local
  );
  RETURN pg_catalog.jsonb_build_object(
    'reservation_id', v_reservation.id,
    'remaining_amount', v_reservation.remaining_amount::text,
    'movement_id', v_movement.id,
    'balance_before', v_movement.balance_before::text,
    'balance_after', v_movement.balance_after::text
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.release_cash_reservation(
  p_store_id uuid,
  p_reservation_id uuid,
  p_operation_id uuid,
  p_amount numeric
)
RETURNS public.cash_reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_actor_role text;
  v_operation public.pos_operations%ROWTYPE;
  v_reservation public.cash_reservations%ROWTYPE;
  v_shift public.cashier_shifts%ROWTYPE;
BEGIN
  SELECT reservation.* INTO v_reservation FROM public.cash_reservations AS reservation
  WHERE reservation.store_id = p_store_id AND reservation.id = p_reservation_id;
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('RESERVATION_NOT_FOUND', 'Cash reservation was not found.', '23503');
  END IF;
  SELECT shift.* INTO v_shift FROM public.cashier_shifts AS shift
  WHERE shift.store_id = p_store_id AND shift.id = v_reservation.shift_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('SHIFT_NOT_FOUND', 'The reservation shift no longer exists.', '23503');
  END IF;
  SELECT reservation.* INTO v_reservation FROM public.cash_reservations AS reservation
  WHERE reservation.store_id = p_store_id AND reservation.id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('RESERVATION_NOT_FOUND', 'Cash reservation was not found.', '23503');
  END IF;
  SELECT operation.* INTO v_operation FROM public.pos_operations AS operation
  WHERE operation.store_id = p_store_id AND operation.id = p_operation_id;
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('IDEMPOTENCY_MISMATCH', 'Cash release command was not found.');
  END IF;
  SELECT profile.role::text INTO v_actor_role FROM public.profiles AS profile WHERE profile.id = v_actor_id;
  IF v_actor_id IS NULL OR NOT private.mfa_session_is_valid()
    OR v_actor_role NOT IN ('admin', 'cashier')
    OR v_operation.actor_id IS DISTINCT FROM v_actor_id
    OR v_operation.status <> 'processing' OR v_operation.shift_id IS DISTINCT FROM v_reservation.shift_id
    OR v_operation.terminal_id IS DISTINCT FROM v_shift.terminal_id
    OR v_shift.drawer_id IS DISTINCT FROM v_reservation.drawer_id
    OR v_shift.state NOT IN ('active', 'submitting') OR v_reservation.state <> 'active' THEN
    PERFORM private.raise_pos_operation_error('RESERVATION_NOT_ACTIVE', 'The active reservation or command does not match.', '42501');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> pg_catalog.round(p_amount, 2)
    OR p_amount > v_reservation.remaining_amount THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Cash reservation release amount is invalid.');
  END IF;
  UPDATE public.cash_reservations AS reservation
  SET remaining_amount = reservation.remaining_amount - p_amount,
      state = CASE WHEN reservation.remaining_amount - p_amount = 0 THEN 'released' ELSE 'active' END,
      version = reservation.version + 1
  WHERE reservation.store_id = p_store_id AND reservation.id = p_reservation_id
  RETURNING * INTO v_reservation;
  INSERT INTO public.cash_reservation_events (
    store_id, reservation_id, operation_id, event_type, event_amount, remaining_after, actor_id
  ) VALUES (p_store_id, p_reservation_id, p_operation_id, 'released', p_amount, v_reservation.remaining_amount, v_actor_id);
  UPDATE public.cashier_shifts AS shift
  SET version = shift.version + 1
  WHERE shift.store_id = p_store_id AND shift.id = v_reservation.shift_id;
  RETURN v_reservation;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_cashier_shift_position(p_shift_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_actor_role text;
  v_shift public.cashier_shifts%ROWTYPE;
  v_position record;
  v_movement_count bigint;
BEGIN
  IF v_actor_id IS NULL OR NOT private.mfa_session_is_valid() THEN
    PERFORM private.raise_pos_operation_error('MFA_REQUIRED', 'A valid signed-in MFA session is required.', '42501');
  END IF;
  SELECT shift.* INTO v_shift FROM public.cashier_shifts AS shift WHERE shift.id = p_shift_id;
  IF NOT FOUND OR NOT public.user_belongs_to_store(v_shift.store_id) THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'This shift is not available to the authenticated user.', '42501');
  END IF;
  SELECT profile.role::text INTO v_actor_role
  FROM public.profiles AS profile WHERE profile.id = v_actor_id;
  IF v_actor_role = 'admin' THEN
    PERFORM private.assert_store_admin(v_shift.store_id);
  ELSIF v_actor_role = 'cashier' AND v_shift.cashier_id = v_actor_id THEN
    NULL;
  ELSE
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'Only the shift cashier or assigned store administrator can view this cash position.', '42501');
  END IF;
  SELECT position.* INTO v_position
  FROM private.cashier_shift_cash_position(v_shift.store_id, v_shift.id) AS position;
  SELECT pg_catalog.count(*) INTO v_movement_count
  FROM public.cash_movements AS movement
  WHERE movement.store_id = v_shift.store_id AND movement.shift_id = v_shift.id;
  RETURN pg_catalog.jsonb_build_object(
    'shift_id', v_shift.id,
    'state', v_shift.state,
    'version', v_shift.version,
    'last_cash_sequence', v_shift.last_cash_sequence::text,
    'posted_balance', v_position.posted_balance::text,
    'reserved_balance', v_position.reserved_balance::text,
    'available_balance', v_position.available_balance::text,
    'movement_count', v_movement_count
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.open_cashier_shift(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
  v_terminal public.pos_terminals%ROWTYPE;
  v_drawer public.cash_drawers%ROWTYPE;
  v_shift public.cashier_shifts%ROWTYPE;
  v_opening_movement public.cash_movements%ROWTYPE;
  v_actor_role text;
  v_cashier_name text;
  v_drawer_id uuid;
  v_opening_amount numeric(14,2);
BEGIN
  v_operation := private.begin_pos_operation('open_cashier_shift', p_command);
  IF v_operation.status = 'committed' THEN
    RETURN v_operation.response;
  END IF;
  IF v_operation.terminal_id IS NULL OR v_operation.shift_id IS NOT NULL
    OR v_operation.terminal_sequence IS NOT NULL OR v_operation.expected_version IS NOT NULL
    OR pg_catalog.jsonb_object_length(p_command->'payload') <> 2
    OR NOT ((p_command->'payload') ?& ARRAY['drawer_id', 'opening_cash']) THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Cashier shift opening payload is invalid.');
  END IF;
  PERFORM private.assert_store_feature_enabled(v_operation.store_id, 'drawer_shifts');
  IF pg_catalog.jsonb_typeof(p_command->'payload'->'drawer_id') IS DISTINCT FROM 'string'
    OR p_command->'payload'->>'drawer_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Drawer ID must be a UUID.');
  END IF;
  IF pg_catalog.jsonb_typeof(p_command->'payload'->'opening_cash') IS DISTINCT FROM 'string'
    OR p_command->'payload'->>'opening_cash' !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Opening cash must be a non-negative amount with at most two decimals.');
  END IF;
  v_drawer_id := (p_command->'payload'->>'drawer_id')::uuid;
  v_opening_amount := (p_command->'payload'->>'opening_cash')::numeric(14,2);

  SELECT profile.role::text, COALESCE(NULLIF(pg_catalog.btrim(profile.name), ''), 'Unknown user')
  INTO v_actor_role, v_cashier_name
  FROM public.profiles AS profile WHERE profile.id = v_operation.actor_id;
  IF v_actor_role NOT IN ('admin', 'cashier') OR NOT EXISTS (
    SELECT 1 FROM public.store_users AS membership
    WHERE membership.store_id = v_operation.store_id AND membership.profile_id = v_operation.actor_id
  ) THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'Only an assigned cashier or store administrator can open a cash shift.', '42501');
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'cashier-shift:' || v_operation.store_id::text || ':' || v_operation.actor_id::text, 0
  ));

  SELECT terminal.* INTO v_terminal FROM public.pos_terminals AS terminal
  WHERE terminal.store_id = v_operation.store_id AND terminal.id = v_operation.terminal_id FOR UPDATE;
  IF NOT FOUND OR NOT v_terminal.active THEN
    PERFORM private.raise_pos_operation_error('TERMINAL_INACTIVE', 'The registered POS terminal is missing or inactive.');
  END IF;
  SELECT drawer.* INTO v_drawer FROM public.cash_drawers AS drawer
  WHERE drawer.store_id = v_operation.store_id AND drawer.id = v_drawer_id FOR UPDATE;
  IF NOT FOUND OR NOT v_drawer.active THEN
    PERFORM private.raise_pos_operation_error('DRAWER_INACTIVE', 'The cash drawer is missing or inactive.');
  END IF;
  IF v_drawer.terminal_id IS NOT NULL AND v_drawer.terminal_id <> v_operation.terminal_id THEN
    PERFORM private.raise_pos_operation_error('DRAWER_TERMINAL_MISMATCH', 'This drawer is assigned to a different terminal.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cashier_shifts AS shift
    WHERE shift.store_id = v_operation.store_id AND shift.cashier_id = v_operation.actor_id
      AND shift.state IN ('active', 'submitting')
  ) THEN
    PERFORM private.raise_pos_operation_error('SHIFT_ALREADY_OPEN', 'This cashier already has an active shift in the store.', '23505');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cashier_shifts AS shift
    WHERE shift.store_id = v_operation.store_id AND shift.drawer_id = v_drawer.id
      AND shift.state IN ('active', 'submitting')
  ) THEN
    PERFORM private.raise_pos_operation_error('DRAWER_IN_CUSTODY', 'This drawer already has an active shift.', '23505');
  END IF;

  BEGIN
    INSERT INTO public.cashier_shifts (
      store_id, drawer_id, terminal_id, cashier_id, cashier_name_snapshot,
      opened_by, open_operation_id, opening_amount, occurred_at_local
    ) VALUES (
      v_operation.store_id, v_drawer.id, v_terminal.id, v_operation.actor_id,
      v_cashier_name, v_operation.actor_id, v_operation.id, v_opening_amount,
      v_operation.local_occurred_at
    ) RETURNING * INTO v_shift;
  EXCEPTION WHEN unique_violation THEN
    PERFORM private.raise_pos_operation_error('SHIFT_CUSTODY_CONFLICT', 'Another shift acquired this cashier or drawer first.', '23505');
  END;

  IF v_opening_amount > 0 THEN
    v_opening_movement := private.post_cash_movement(
      v_operation.store_id, v_drawer.id, v_shift.id, v_operation.id,
      'opening', 'shift_open', v_shift.id, 'opening', v_opening_amount, v_opening_amount,
      'Opening cash counted at shift start', v_operation.local_occurred_at
    );
    SELECT shift.* INTO v_shift FROM public.cashier_shifts AS shift
    WHERE shift.store_id = v_operation.store_id AND shift.id = v_shift.id;
  END IF;

  RETURN private.finish_pos_operation(
    v_operation.store_id, v_operation.id, 'open_cashier_shift', v_operation.request_hash,
    'confirmed', 'cashier_shift', v_shift.id::text, v_shift.version,
    pg_catalog.jsonb_build_object(
      'id', v_shift.id, 'store_id', v_shift.store_id, 'drawer_id', v_shift.drawer_id,
      'terminal_id', v_shift.terminal_id, 'cashier_id', v_shift.cashier_id,
      'cashier_name_snapshot', v_shift.cashier_name_snapshot, 'state', v_shift.state,
      'version', v_shift.version, 'opening_amount', v_shift.opening_amount::text,
      'opening_movement_id', v_opening_movement.id,
      'opened_at', v_shift.opened_at, 'occurred_at_local', v_shift.occurred_at_local
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.cashier_shift_cash_position(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.post_cash_movement(uuid, uuid, uuid, uuid, text, text, uuid, text, numeric, numeric, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.reserve_cash(uuid, uuid, uuid, uuid, text, text, uuid, numeric, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.consume_cash_reservation(uuid, uuid, uuid, numeric, text, text, text, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.release_cash_reservation(uuid, uuid, uuid, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_cashier_shift_position(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_cashier_shift_position(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.open_cashier_shift(jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.open_cashier_shift(jsonb) TO authenticated;
