-- T24: logical terminal/drawer registry and immutable cashier-shift opening.
-- The drawer_shifts feature flag remains false by default; opening stays gated
-- until T25 can post the opening cash movement in the same transaction.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE public.pos_terminals (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(name)) BETWEEN 1 AND 100),
  display_identifier text,
  registered_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  device_public_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (pg_catalog.jsonb_typeof(device_public_metadata) = 'object'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT pos_terminals_store_id_unique UNIQUE (store_id, id),
  CONSTRAINT pos_terminals_display_identifier_length
    CHECK (display_identifier IS NULL OR pg_catalog.length(pg_catalog.btrim(display_identifier)) <= 120)
);

CREATE INDEX pos_terminals_store_active_idx
  ON public.pos_terminals (store_id, active, name);

CREATE TABLE public.cash_drawers (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(name)) BETWEEN 1 AND 100),
  terminal_id uuid,
  registered_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT cash_drawers_store_id_unique UNIQUE (store_id, id),
  CONSTRAINT cash_drawers_store_terminal_fkey
    FOREIGN KEY (store_id, terminal_id)
    REFERENCES public.pos_terminals (store_id, id) ON DELETE RESTRICT
);

CREATE INDEX cash_drawers_store_active_idx
  ON public.cash_drawers (store_id, active, name);
CREATE INDEX cash_drawers_store_terminal_idx
  ON public.cash_drawers (store_id, terminal_id)
  WHERE terminal_id IS NOT NULL;

CREATE TABLE public.cashier_shifts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  drawer_id uuid NOT NULL,
  terminal_id uuid NOT NULL,
  cashier_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  cashier_name_snapshot text NOT NULL
    CHECK (pg_catalog.length(pg_catalog.btrim(cashier_name_snapshot)) BETWEEN 1 AND 200),
  opened_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  open_operation_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'submitting', 'closed')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  opening_amount numeric(14,2) NOT NULL CHECK (opening_amount >= 0),
  opened_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  occurred_at_local timestamptz,
  closing_at timestamptz,
  closed_at timestamptz,
  last_cash_sequence bigint NOT NULL DEFAULT 0 CHECK (last_cash_sequence >= 0),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT cashier_shifts_store_id_unique UNIQUE (store_id, id),
  CONSTRAINT cashier_shifts_open_operation_unique UNIQUE (store_id, open_operation_id),
  CONSTRAINT cashier_shifts_store_drawer_fkey
    FOREIGN KEY (store_id, drawer_id)
    REFERENCES public.cash_drawers (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT cashier_shifts_store_terminal_fkey
    FOREIGN KEY (store_id, terminal_id)
    REFERENCES public.pos_terminals (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT cashier_shifts_store_operation_fkey
    FOREIGN KEY (store_id, open_operation_id)
    REFERENCES public.pos_operations (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT cashier_shifts_state_times_check CHECK (
    (state = 'active' AND closing_at IS NULL AND closed_at IS NULL)
    OR (state = 'submitting' AND closing_at IS NOT NULL AND closed_at IS NULL)
    OR (state = 'closed' AND closing_at IS NOT NULL AND closed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX cashier_shifts_one_active_drawer_uidx
  ON public.cashier_shifts (store_id, drawer_id)
  WHERE state IN ('active', 'submitting');
CREATE UNIQUE INDEX cashier_shifts_one_active_cashier_uidx
  ON public.cashier_shifts (store_id, cashier_id)
  WHERE state IN ('active', 'submitting');
CREATE INDEX cashier_shifts_store_cashier_opened_idx
  ON public.cashier_shifts (store_id, cashier_id, opened_at DESC, id DESC);
CREATE INDEX cashier_shifts_store_drawer_opened_idx
  ON public.cashier_shifts (store_id, drawer_id, opened_at DESC, id DESC);

ALTER TABLE public.pos_operations
  ADD CONSTRAINT pos_operations_store_terminal_fkey
    FOREIGN KEY (store_id, terminal_id)
    REFERENCES public.pos_terminals (store_id, id) ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT pos_operations_store_shift_fkey
    FOREIGN KEY (store_id, shift_id)
    REFERENCES public.cashier_shifts (store_id, id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE public.pos_operations
  VALIDATE CONSTRAINT pos_operations_store_terminal_fkey,
  VALIDATE CONSTRAINT pos_operations_store_shift_fkey;

CREATE OR REPLACE FUNCTION private.guard_cashier_shift_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Cashier shifts are retained as custody history';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.store_id IS DISTINCT FROM OLD.store_id
    OR NEW.drawer_id IS DISTINCT FROM OLD.drawer_id
    OR NEW.terminal_id IS DISTINCT FROM OLD.terminal_id
    OR NEW.cashier_id IS DISTINCT FROM OLD.cashier_id
    OR NEW.cashier_name_snapshot IS DISTINCT FROM OLD.cashier_name_snapshot
    OR NEW.opened_by IS DISTINCT FROM OLD.opened_by
    OR NEW.open_operation_id IS DISTINCT FROM OLD.open_operation_id
    OR NEW.opening_amount IS DISTINCT FROM OLD.opening_amount
    OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
    OR NEW.occurred_at_local IS DISTINCT FROM OLD.occurred_at_local
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Cashier shift opening identity and opening amount are immutable';
  END IF;

  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Cashier shift updates must advance the version exactly once';
  END IF;
  IF OLD.state = 'closed' THEN
    RAISE EXCEPTION 'Closed cashier shifts are immutable';
  END IF;
  IF OLD.state = 'active' AND NEW.state NOT IN ('active', 'submitting', 'closed') THEN
    RAISE EXCEPTION 'Cashier shift state transition is invalid';
  END IF;
  IF OLD.state = 'submitting' AND NEW.state NOT IN ('submitting', 'closed') THEN
    RAISE EXCEPTION 'Submitting cashier shifts can only remain submitting or close';
  END IF;

  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.guard_cash_custody_archive()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Cash custody registry rows are archived, not deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.store_id IS DISTINCT FROM OLD.store_id
    OR NEW.registered_by IS DISTINCT FROM OLD.registered_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Cash custody registry identity is immutable';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Cash custody registry updates must advance the version exactly once';
  END IF;
  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.assert_cashier_shift_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.store_users AS membership
    WHERE membership.store_id = NEW.store_id AND membership.profile_id = NEW.cashier_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.store_users AS membership
    WHERE membership.store_id = NEW.store_id AND membership.profile_id = NEW.opened_by
  ) THEN
    RAISE EXCEPTION 'Cashier and opener must belong to the shift store';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.guard_cashier_shift_lifecycle() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_cash_custody_archive() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.assert_cashier_shift_membership() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER cashier_shifts_membership_guard
  BEFORE INSERT ON public.cashier_shifts
  FOR EACH ROW EXECUTE FUNCTION private.assert_cashier_shift_membership();
CREATE TRIGGER cashier_shifts_lifecycle_guard
  BEFORE UPDATE OR DELETE ON public.cashier_shifts
  FOR EACH ROW EXECUTE FUNCTION private.guard_cashier_shift_lifecycle();
CREATE TRIGGER pos_terminals_archive_guard
  BEFORE UPDATE OR DELETE ON public.pos_terminals
  FOR EACH ROW EXECUTE FUNCTION private.guard_cash_custody_archive();
CREATE TRIGGER cash_drawers_archive_guard
  BEFORE UPDATE OR DELETE ON public.cash_drawers
  FOR EACH ROW EXECUTE FUNCTION private.guard_cash_custody_archive();

ALTER TABLE public.pos_terminals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_drawers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashier_shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY pos_terminals_api_deny
  ON public.pos_terminals FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY cash_drawers_api_deny
  ON public.cash_drawers FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY cashier_shifts_api_deny
  ON public.cashier_shifts FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE public.pos_terminals FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.cash_drawers FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.cashier_shifts FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.register_pos_terminal(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
  v_store_id uuid;
  v_terminal public.pos_terminals%ROWTYPE;
  v_name text;
  v_display_identifier text;
BEGIN
  v_operation := private.begin_pos_operation('register_pos_terminal', p_command);
  IF v_operation.status = 'committed' THEN
    RETURN v_operation.response;
  END IF;
  PERFORM private.assert_store_admin(v_operation.store_id);

  IF v_operation.terminal_id IS NOT NULL OR v_operation.shift_id IS NOT NULL
    OR pg_catalog.jsonb_object_length(p_command->'payload') <> 2
    OR NOT ((p_command->'payload') ?& ARRAY['name', 'display_identifier']) THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Terminal registration payload is invalid.');
  END IF;
  IF pg_catalog.jsonb_typeof(p_command->'payload'->'name') IS DISTINCT FROM 'string'
    OR pg_catalog.length(pg_catalog.btrim(p_command->'payload'->>'name')) NOT BETWEEN 1 AND 100 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Terminal name must contain 1 to 100 characters.');
  END IF;
  IF pg_catalog.jsonb_typeof(p_command->'payload'->'display_identifier') NOT IN ('string', 'null') THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Terminal display identifier must be text or null.');
  END IF;
  v_name := pg_catalog.btrim(p_command->'payload'->>'name');
  v_display_identifier := NULLIF(
    pg_catalog.left(pg_catalog.btrim(p_command->'payload'->>'display_identifier'), 120), ''
  );
  IF pg_catalog.length(pg_catalog.btrim(p_command->'payload'->>'display_identifier')) > 120 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Terminal display identifier cannot exceed 120 characters.');
  END IF;

  INSERT INTO public.pos_terminals (store_id, name, display_identifier, registered_by)
  VALUES (v_operation.store_id, v_name, v_display_identifier, v_operation.actor_id)
  RETURNING * INTO v_terminal;

  RETURN private.finish_pos_operation(
    v_operation.store_id,
    v_operation.id,
    'register_pos_terminal',
    v_operation.request_hash,
    'confirmed',
    'pos_terminal',
    v_terminal.id::text,
    v_terminal.version,
    pg_catalog.jsonb_build_object(
      'id', v_terminal.id,
      'store_id', v_terminal.store_id,
      'name', v_terminal.name,
      'display_identifier', v_terminal.display_identifier,
      'active', v_terminal.active,
      'version', v_terminal.version,
      'created_at', v_terminal.created_at
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_cash_drawer(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
  v_drawer public.cash_drawers%ROWTYPE;
  v_name text;
  v_terminal_id uuid;
BEGIN
  v_operation := private.begin_pos_operation('register_cash_drawer', p_command);
  IF v_operation.status = 'committed' THEN
    RETURN v_operation.response;
  END IF;
  PERFORM private.assert_store_admin(v_operation.store_id);

  IF v_operation.shift_id IS NOT NULL
    OR pg_catalog.jsonb_object_length(p_command->'payload') <> 2
    OR NOT ((p_command->'payload') ?& ARRAY['name', 'terminal_id']) THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Cash drawer registration payload is invalid.');
  END IF;
  IF pg_catalog.jsonb_typeof(p_command->'payload'->'name') IS DISTINCT FROM 'string'
    OR pg_catalog.length(pg_catalog.btrim(p_command->'payload'->>'name')) NOT BETWEEN 1 AND 100 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Cash drawer name must contain 1 to 100 characters.');
  END IF;
  IF pg_catalog.jsonb_typeof(p_command->'payload'->'terminal_id') NOT IN ('string', 'null') THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Cash drawer terminal must be a UUID or null.');
  END IF;
  IF pg_catalog.jsonb_typeof(p_command->'payload'->'terminal_id') = 'string' THEN
    IF p_command->'payload'->>'terminal_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Cash drawer terminal must be a UUID or null.');
    END IF;
    v_terminal_id := (p_command->'payload'->>'terminal_id')::uuid;
  END IF;
  IF v_operation.terminal_id IS DISTINCT FROM v_terminal_id THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Terminal context does not match the drawer association.');
  END IF;
  IF v_terminal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.pos_terminals AS terminal
    WHERE terminal.store_id = v_operation.store_id
      AND terminal.id = v_terminal_id AND terminal.active
  ) THEN
    PERFORM private.raise_pos_operation_error('TERMINAL_INACTIVE', 'Cash drawer terminal is not active in this store.');
  END IF;

  v_name := pg_catalog.btrim(p_command->'payload'->>'name');
  INSERT INTO public.cash_drawers (store_id, name, terminal_id, registered_by)
  VALUES (v_operation.store_id, v_name, v_terminal_id, v_operation.actor_id)
  RETURNING * INTO v_drawer;

  RETURN private.finish_pos_operation(
    v_operation.store_id,
    v_operation.id,
    'register_cash_drawer',
    v_operation.request_hash,
    'confirmed',
    'cash_drawer',
    v_drawer.id::text,
    v_drawer.version,
    pg_catalog.jsonb_build_object(
      'id', v_drawer.id,
      'store_id', v_drawer.store_id,
      'name', v_drawer.name,
      'terminal_id', v_drawer.terminal_id,
      'active', v_drawer.active,
      'version', v_drawer.version,
      'created_at', v_drawer.created_at
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_store_cash_custody(p_store_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_terminals jsonb;
  v_drawers jsonb;
BEGIN
  PERFORM private.assert_store_admin(p_store_id);

  SELECT COALESCE(
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', terminal.id,
      'store_id', terminal.store_id,
      'name', terminal.name,
      'display_identifier', terminal.display_identifier,
      'active', terminal.active,
      'version', terminal.version,
      'created_at', terminal.created_at
    ) ORDER BY terminal.name, terminal.id), '[]'::jsonb
  ) INTO v_terminals
  FROM public.pos_terminals AS terminal
  WHERE terminal.store_id = p_store_id;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', drawer.id,
      'store_id', drawer.store_id,
      'name', drawer.name,
      'terminal_id', drawer.terminal_id,
      'active', drawer.active,
      'version', drawer.version,
      'created_at', drawer.created_at
    ) ORDER BY drawer.name, drawer.id), '[]'::jsonb
  ) INTO v_drawers
  FROM public.cash_drawers AS drawer
  WHERE drawer.store_id = p_store_id;

  RETURN pg_catalog.jsonb_build_object('terminals', v_terminals, 'drawers', v_drawers);
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
  FROM public.profiles AS profile
  WHERE profile.id = v_operation.actor_id;
  IF v_actor_role NOT IN ('admin', 'cashier') THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'Only an assigned cashier or store administrator can open a cash shift.', '42501');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.store_users AS membership
    WHERE membership.store_id = v_operation.store_id
      AND membership.profile_id = v_operation.actor_id
  ) THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'The cashier is not assigned to this store.', '42501');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'cashier-shift:' || v_operation.store_id::text || ':' || v_operation.actor_id::text,
      0
    )
  );

  SELECT terminal.* INTO v_terminal
  FROM public.pos_terminals AS terminal
  WHERE terminal.store_id = v_operation.store_id
    AND terminal.id = v_operation.terminal_id
  FOR UPDATE;
  IF NOT FOUND OR NOT v_terminal.active THEN
    PERFORM private.raise_pos_operation_error('TERMINAL_INACTIVE', 'The registered POS terminal is missing or inactive.');
  END IF;

  SELECT drawer.* INTO v_drawer
  FROM public.cash_drawers AS drawer
  WHERE drawer.store_id = v_operation.store_id
    AND drawer.id = v_drawer_id
  FOR UPDATE;
  IF NOT FOUND OR NOT v_drawer.active THEN
    PERFORM private.raise_pos_operation_error('DRAWER_INACTIVE', 'The cash drawer is missing or inactive.');
  END IF;
  IF v_drawer.terminal_id IS NOT NULL AND v_drawer.terminal_id <> v_operation.terminal_id THEN
    PERFORM private.raise_pos_operation_error('DRAWER_TERMINAL_MISMATCH', 'This drawer is assigned to a different terminal.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cashier_shifts AS shift
    WHERE shift.store_id = v_operation.store_id
      AND shift.cashier_id = v_operation.actor_id
      AND shift.state IN ('active', 'submitting')
  ) THEN
    PERFORM private.raise_pos_operation_error('SHIFT_ALREADY_OPEN', 'This cashier already has an active shift in the store.', '23505');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cashier_shifts AS shift
    WHERE shift.store_id = v_operation.store_id
      AND shift.drawer_id = v_drawer.id
      AND shift.state IN ('active', 'submitting')
  ) THEN
    PERFORM private.raise_pos_operation_error('DRAWER_IN_CUSTODY', 'This drawer already has an active shift.', '23505');
  END IF;

  BEGIN
    INSERT INTO public.cashier_shifts (
      store_id, drawer_id, terminal_id, cashier_id, cashier_name_snapshot,
      opened_by, open_operation_id, opening_amount, occurred_at_local
    )
    VALUES (
      v_operation.store_id, v_drawer.id, v_terminal.id, v_operation.actor_id,
      v_cashier_name, v_operation.actor_id, v_operation.id, v_opening_amount,
      v_operation.local_occurred_at
    )
    RETURNING * INTO v_shift;
  EXCEPTION WHEN unique_violation THEN
    PERFORM private.raise_pos_operation_error('SHIFT_CUSTODY_CONFLICT', 'Another shift acquired this cashier or drawer first.', '23505');
  END;

  RETURN private.finish_pos_operation(
    v_operation.store_id,
    v_operation.id,
    'open_cashier_shift',
    v_operation.request_hash,
    'confirmed',
    'cashier_shift',
    v_shift.id::text,
    v_shift.version,
    pg_catalog.jsonb_build_object(
      'id', v_shift.id,
      'store_id', v_shift.store_id,
      'drawer_id', v_shift.drawer_id,
      'terminal_id', v_shift.terminal_id,
      'cashier_id', v_shift.cashier_id,
      'cashier_name_snapshot', v_shift.cashier_name_snapshot,
      'state', v_shift.state,
      'version', v_shift.version,
      'opening_amount', v_shift.opening_amount::text,
      'opened_at', v_shift.opened_at,
      'occurred_at_local', v_shift.occurred_at_local
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.register_pos_terminal(jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.register_cash_drawer(jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.list_store_cash_custody(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.open_cashier_shift(jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.register_pos_terminal(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_cash_drawer(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_store_cash_custody(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_cashier_shift(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION private.guard_cashier_shift_lifecycle() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_cash_custody_archive() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.assert_cashier_shift_membership() FROM PUBLIC, anon, authenticated, service_role;
