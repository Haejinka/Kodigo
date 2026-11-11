-- T51: online-only cashier lease envelopes. `pending_stock` never grants checkout.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE public.terminal_sync_cursors (
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  terminal_id uuid NOT NULL,
  last_confirmed_sequence bigint NOT NULL DEFAULT 0 CHECK (last_confirmed_sequence >= 0),
  last_reserved_sequence bigint NOT NULL DEFAULT 0 CHECK (last_reserved_sequence >= last_confirmed_sequence),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT terminal_sync_cursors_pkey PRIMARY KEY (store_id, terminal_id),
  CONSTRAINT terminal_sync_cursors_store_terminal_fkey
    FOREIGN KEY (store_id, terminal_id)
    REFERENCES public.pos_terminals (store_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.offline_authorization_leases (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  terminal_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  cashier_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  issue_operation_id uuid NOT NULL,
  prepared_at timestamptz NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  last_mfa_at timestamptz,
  activated_at timestamptz,
  state text NOT NULL DEFAULT 'pending_stock'
    CHECK (state IN ('pending_stock', 'active', 'revoked', 'expired', 'reconciled')),
  catalog_version text,
  price_policy_hash text,
  sequence_start bigint NOT NULL CHECK (sequence_start > 0),
  sequence_end bigint NOT NULL CHECK (sequence_end >= sequence_start AND sequence_end - sequence_start < 100),
  contract_version smallint NOT NULL DEFAULT 1 CHECK (contract_version = 1),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT offline_authorization_leases_store_id_unique UNIQUE (store_id, id),
  CONSTRAINT offline_authorization_leases_operation_unique UNIQUE (store_id, issue_operation_id),
  CONSTRAINT offline_authorization_leases_store_terminal_fkey
    FOREIGN KEY (store_id, terminal_id)
    REFERENCES public.pos_terminals (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT offline_authorization_leases_store_shift_fkey
    FOREIGN KEY (store_id, shift_id)
    REFERENCES public.cashier_shifts (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT offline_authorization_leases_issue_operation_fkey
    FOREIGN KEY (store_id, issue_operation_id)
    REFERENCES public.pos_operations (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT offline_authorization_leases_times_check
    CHECK (expires_at > issued_at AND prepared_at <= issued_at),
  CONSTRAINT offline_authorization_leases_snapshot_check
    CHECK ((catalog_version IS NULL AND price_policy_hash IS NULL)
      OR (catalog_version IS NOT NULL AND price_policy_hash IS NOT NULL
        AND price_policy_hash ~ '^[0-9a-f]{64}$'))
);

CREATE INDEX offline_authorization_leases_store_cashier_idx
  ON public.offline_authorization_leases (store_id, cashier_id, issued_at DESC, id DESC);
CREATE INDEX offline_authorization_leases_store_shift_idx
  ON public.offline_authorization_leases (store_id, shift_id, issued_at DESC, id DESC);
CREATE UNIQUE INDEX offline_authorization_leases_terminal_pending_active_uidx
  ON public.offline_authorization_leases (store_id, terminal_id)
  WHERE state IN ('pending_stock', 'active');

CREATE TABLE public.offline_authorization_lease_events (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  store_id uuid NOT NULL,
  lease_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('issued', 'revoked', 'expired', 'activated', 'reconciled')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_catalog.jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT offline_authorization_lease_events_operation_unique
    UNIQUE (store_id, operation_id, event_type),
  CONSTRAINT offline_authorization_lease_events_store_lease_fkey
    FOREIGN KEY (store_id, lease_id)
    REFERENCES public.offline_authorization_leases (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT offline_authorization_lease_events_store_operation_fkey
    FOREIGN KEY (store_id, operation_id)
    REFERENCES public.pos_operations (store_id, id) ON DELETE RESTRICT
);

CREATE INDEX offline_authorization_lease_events_lease_created_idx
  ON public.offline_authorization_lease_events (store_id, lease_id, created_at, id);

ALTER TABLE public.terminal_sync_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_authorization_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offline_authorization_lease_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY terminal_sync_cursors_api_deny
  ON public.terminal_sync_cursors FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY offline_authorization_leases_api_deny
  ON public.offline_authorization_leases FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY offline_authorization_lease_events_api_deny
  ON public.offline_authorization_lease_events FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE public.terminal_sync_cursors, public.offline_authorization_leases,
  public.offline_authorization_lease_events FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.guard_offline_authorization_lease()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Offline authorization lease history is retained';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.store_id IS DISTINCT FROM OLD.store_id
    OR NEW.terminal_id IS DISTINCT FROM OLD.terminal_id
    OR NEW.shift_id IS DISTINCT FROM OLD.shift_id
    OR NEW.cashier_id IS DISTINCT FROM OLD.cashier_id
    OR NEW.issue_operation_id IS DISTINCT FROM OLD.issue_operation_id
    OR NEW.prepared_at IS DISTINCT FROM OLD.prepared_at
    OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.last_mfa_at IS DISTINCT FROM OLD.last_mfa_at
    OR NEW.sequence_start IS DISTINCT FROM OLD.sequence_start
    OR NEW.sequence_end IS DISTINCT FROM OLD.sequence_end
    OR NEW.contract_version IS DISTINCT FROM OLD.contract_version
    OR NEW.version IS DISTINCT FROM OLD.version + 1
    OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Offline authorization lease identity and sequence bounds are immutable';
  END IF;

  IF OLD.state = 'pending_stock' AND NEW.state = 'active' THEN
    IF OLD.catalog_version IS NOT NULL OR OLD.price_policy_hash IS NOT NULL
      OR NEW.catalog_version IS NULL OR NEW.price_policy_hash IS NULL
      OR NEW.price_policy_hash !~ '^[0-9a-f]{64}$'
      OR OLD.activated_at IS NOT NULL OR NEW.activated_at IS NULL
      OR NEW.activated_at < OLD.issued_at OR NEW.activated_at > OLD.expires_at THEN
      RAISE EXCEPTION 'Offline lease activation requires server snapshots';
    END IF;
  ELSIF OLD.state IN ('pending_stock', 'active') AND NEW.state IN ('revoked', 'expired') THEN
    IF NEW.activated_at IS DISTINCT FROM OLD.activated_at
      OR NEW.catalog_version IS DISTINCT FROM OLD.catalog_version
      OR NEW.price_policy_hash IS DISTINCT FROM OLD.price_policy_hash THEN
      RAISE EXCEPTION 'Lease revocation cannot change authorization snapshots';
    END IF;
  ELSIF OLD.state IN ('active', 'revoked', 'expired') AND NEW.state = 'reconciled' THEN
    IF NEW.activated_at IS DISTINCT FROM OLD.activated_at
      OR NEW.catalog_version IS DISTINCT FROM OLD.catalog_version
      OR NEW.price_policy_hash IS DISTINCT FROM OLD.price_policy_hash THEN
      RAISE EXCEPTION 'Lease reconciliation cannot change authorization snapshots';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid offline authorization lease state transition';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER offline_authorization_lease_lifecycle_guard
  BEFORE UPDATE OR DELETE ON public.offline_authorization_leases
  FOR EACH ROW EXECUTE FUNCTION private.guard_offline_authorization_lease();

CREATE OR REPLACE FUNCTION private.prevent_offline_authorization_lease_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Offline authorization lease events are append-only';
END;
$function$;

CREATE TRIGGER offline_authorization_lease_events_append_only
  BEFORE UPDATE OR DELETE ON public.offline_authorization_lease_events
  FOR EACH ROW EXECUTE FUNCTION private.prevent_offline_authorization_lease_event_mutation();

REVOKE ALL ON FUNCTION private.guard_offline_authorization_lease() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.prevent_offline_authorization_lease_event_mutation() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_offline_lease(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
  v_actor_id uuid := (SELECT auth.uid());
  v_actor_role text;
  v_shift public.cashier_shifts%ROWTYPE;
  v_terminal public.pos_terminals%ROWTYPE;
  v_cursor public.terminal_sync_cursors%ROWTYPE;
  v_lease public.offline_authorization_leases%ROWTYPE;
  v_issued_at timestamptz := pg_catalog.clock_timestamp();
  v_last_mfa_at timestamptz;
  v_sequence_start bigint;
  v_sequence_end bigint;
  v_expired_id uuid;
BEGIN
  v_operation := private.begin_pos_operation('issue_offline_lease', p_command);
  IF v_operation.status = 'committed' THEN
    RETURN v_operation.response;
  END IF;

  IF v_actor_id IS NULL OR NOT private.mfa_session_is_valid() THEN
    PERFORM private.raise_pos_operation_error('MFA_REQUIRED', 'A valid authenticated session is required.', '42501');
  END IF;
  IF v_operation.terminal_id IS NULL OR v_operation.shift_id IS NULL
    OR v_operation.terminal_sequence IS NOT NULL OR v_operation.expected_version IS NOT NULL
    OR pg_catalog.jsonb_object_length(p_command->'payload') <> 0 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Offline lease issue command is invalid.');
  END IF;

  SELECT profile.role::text INTO v_actor_role
  FROM public.profiles AS profile
  WHERE profile.id = v_actor_id;
  IF v_actor_role IS DISTINCT FROM 'cashier' THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'Only a cashier can prepare an offline lease for their own shift.', '42501');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.store_users AS membership
    WHERE membership.store_id = v_operation.store_id AND membership.profile_id = v_actor_id
  ) THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'The cashier is not assigned to this store.', '42501');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'offline-lease:' || v_operation.store_id::text || ':' || v_operation.terminal_id::text, 0
  ));

  SELECT shift.* INTO v_shift
  FROM public.cashier_shifts AS shift
  WHERE shift.store_id = v_operation.store_id
    AND shift.id = v_operation.shift_id
    AND shift.terminal_id = v_operation.terminal_id
    AND shift.cashier_id = v_actor_id
    AND shift.state = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('SHIFT_FORBIDDEN', 'A cashier can prepare an offline lease only for their own active shift.', '42501');
  END IF;

  SELECT terminal.* INTO v_terminal
  FROM public.pos_terminals AS terminal
  WHERE terminal.store_id = v_operation.store_id AND terminal.id = v_operation.terminal_id
  FOR UPDATE;
  IF NOT FOUND OR NOT v_terminal.active THEN
    PERFORM private.raise_pos_operation_error('TERMINAL_INACTIVE', 'The registered POS terminal is missing or inactive.');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.cash_drawers AS drawer
    WHERE drawer.store_id = v_operation.store_id
      AND drawer.id = v_shift.drawer_id
      AND drawer.active
  ) THEN
    PERFORM private.raise_pos_operation_error('DRAWER_INACTIVE', 'The shift drawer is missing or inactive.');
  END IF;

  SELECT pg_catalog.max(pg_catalog.to_timestamp((amr.value->>'timestamp')::double precision))
  INTO v_last_mfa_at
  FROM pg_catalog.jsonb_array_elements(CASE
    WHEN pg_catalog.jsonb_typeof((SELECT auth.jwt())->'amr') = 'array' THEN (SELECT auth.jwt())->'amr'
    ELSE '[]'::jsonb
  END) AS amr(value)
  WHERE amr.value->>'method' IN ('totp', 'otp')
    AND amr.value->>'timestamp' ~ '^[0-9]+(\.[0-9]+)?$';

  IF EXISTS (
    SELECT 1 FROM auth.mfa_factors AS factor
    WHERE factor.user_id = v_actor_id AND factor.status = 'verified'
  ) AND v_last_mfa_at IS NULL THEN
    PERFORM private.raise_pos_operation_error('MFA_REQUIRED', 'A verified second-factor timestamp is required for offline authorization.', '42501');
  END IF;

  FOR v_expired_id IN
    UPDATE public.offline_authorization_leases AS lease
    SET state = 'expired', version = lease.version + 1, updated_at = v_issued_at
    WHERE lease.store_id = v_operation.store_id
      AND lease.terminal_id = v_operation.terminal_id
      AND lease.state = 'pending_stock'
      AND lease.expires_at <= v_issued_at
    RETURNING lease.id
  LOOP
    INSERT INTO public.offline_authorization_lease_events (
      store_id, lease_id, operation_id, actor_id, event_type, details
    ) VALUES (
      v_operation.store_id, v_expired_id, v_operation.id, v_actor_id, 'expired',
      pg_catalog.jsonb_build_object('source', 'next_online_issue')
    );
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.offline_authorization_leases AS lease
    WHERE lease.store_id = v_operation.store_id
      AND lease.terminal_id = v_operation.terminal_id
      AND (lease.state = 'active' OR (lease.state = 'pending_stock' AND lease.expires_at > v_issued_at))
  ) THEN
    PERFORM private.raise_pos_operation_error('LEASE_ALREADY_OPEN', 'This terminal already has a pending or active offline lease.', '23505');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.offline_authorization_leases AS lease
    WHERE lease.store_id = v_operation.store_id
      AND lease.terminal_id = v_operation.terminal_id
      AND lease.activated_at IS NOT NULL
      AND lease.state <> 'reconciled'
  ) THEN
    PERFORM private.raise_pos_operation_error('LEASE_RECONCILIATION_REQUIRED', 'Prior offline work must be reconciled before this terminal receives another lease.', '23514');
  END IF;

  INSERT INTO public.terminal_sync_cursors (store_id, terminal_id)
  VALUES (v_operation.store_id, v_operation.terminal_id)
  ON CONFLICT (store_id, terminal_id) DO NOTHING;

  SELECT cursor.* INTO v_cursor
  FROM public.terminal_sync_cursors AS cursor
  WHERE cursor.store_id = v_operation.store_id AND cursor.terminal_id = v_operation.terminal_id
  FOR UPDATE;

  -- Only an activated, unresolved range blocks reuse. Pending-stock ranges cannot sell.
  v_sequence_start := v_cursor.last_confirmed_sequence + 1;
  v_sequence_end := v_sequence_start + 99;
  UPDATE public.terminal_sync_cursors AS cursor
  SET last_reserved_sequence = v_sequence_end,
      version = cursor.version + 1,
      updated_at = v_issued_at
  WHERE cursor.store_id = v_operation.store_id AND cursor.terminal_id = v_operation.terminal_id;

  INSERT INTO public.offline_authorization_leases (
    store_id, terminal_id, shift_id, cashier_id, issue_operation_id,
    prepared_at, issued_at, expires_at, last_mfa_at,
    sequence_start, sequence_end
  ) VALUES (
    v_operation.store_id, v_operation.terminal_id, v_operation.shift_id, v_actor_id, v_operation.id,
    v_issued_at, v_issued_at, v_issued_at + interval '8 hours', v_last_mfa_at,
    v_sequence_start, v_sequence_end
  )
  RETURNING * INTO v_lease;

  INSERT INTO public.offline_authorization_lease_events (
    store_id, lease_id, operation_id, actor_id, event_type, details
  ) VALUES (
    v_lease.store_id, v_lease.id, v_operation.id, v_actor_id, 'issued',
    pg_catalog.jsonb_build_object('state', v_lease.state, 'sequence_start', v_sequence_start, 'sequence_end', v_sequence_end)
  );

  RETURN private.finish_pos_operation(
    v_operation.store_id, v_operation.id, 'issue_offline_lease', v_operation.request_hash,
    'confirmed', 'offline_authorization_lease', v_lease.id::text, v_lease.version,
    pg_catalog.jsonb_build_object(
      'id', v_lease.id,
      'store_id', v_lease.store_id,
      'terminal_id', v_lease.terminal_id,
      'shift_id', v_lease.shift_id,
      'cashier_id', v_lease.cashier_id,
      'prepared_at', v_lease.prepared_at,
      'issued_at', v_lease.issued_at,
      'expires_at', v_lease.expires_at,
      'last_mfa_at', v_lease.last_mfa_at,
      'activated_at', v_lease.activated_at,
      'state', v_lease.state,
      'catalog_version', v_lease.catalog_version,
      'price_policy_hash', v_lease.price_policy_hash,
      'sequence_start', v_lease.sequence_start,
      'sequence_end', v_lease.sequence_end,
      'contract_version', v_lease.contract_version,
      'version', v_lease.version
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_offline_lease(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
  v_actor_id uuid := (SELECT auth.uid());
  v_actor_role text;
  v_lease public.offline_authorization_leases%ROWTYPE;
  v_lease_id uuid;
  v_reason text;
  v_state text;
  v_version bigint;
BEGIN
  v_operation := private.begin_pos_operation('revoke_offline_lease', p_command);
  IF v_operation.status = 'committed' THEN
    RETURN v_operation.response;
  END IF;
  IF v_actor_id IS NULL OR NOT private.mfa_session_is_valid() THEN
    PERFORM private.raise_pos_operation_error('MFA_REQUIRED', 'A valid authenticated session is required.', '42501');
  END IF;
  IF v_operation.terminal_id IS NULL OR v_operation.shift_id IS NULL
    OR v_operation.terminal_sequence IS NOT NULL OR v_operation.expected_version IS NULL
    OR pg_catalog.jsonb_object_length(p_command->'payload') <> 2
    OR NOT ((p_command->'payload') ?& ARRAY['lease_id', 'reason'])
    OR pg_catalog.jsonb_typeof(p_command->'payload'->'lease_id') IS DISTINCT FROM 'string'
    OR p_command->'payload'->>'lease_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR pg_catalog.jsonb_typeof(p_command->'payload'->'reason') IS DISTINCT FROM 'string' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Offline lease revocation command is invalid.');
  END IF;
  v_lease_id := (p_command->'payload'->>'lease_id')::uuid;
  v_reason := pg_catalog.btrim(p_command->'payload'->>'reason');
  IF pg_catalog.length(v_reason) < 1 OR pg_catalog.length(v_reason) > 500 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'A revocation reason of 1 to 500 characters is required.');
  END IF;

  SELECT profile.role::text INTO v_actor_role
  FROM public.profiles AS profile WHERE profile.id = v_actor_id;
  SELECT lease.* INTO v_lease
  FROM public.offline_authorization_leases AS lease
  WHERE lease.store_id = v_operation.store_id AND lease.id = v_lease_id
  FOR UPDATE;
  IF NOT FOUND OR v_lease.terminal_id <> v_operation.terminal_id
    OR v_lease.shift_id <> v_operation.shift_id
    OR v_lease.version <> v_operation.expected_version THEN
    PERFORM private.raise_pos_operation_error('LEASE_VERSION_CONFLICT', 'The offline lease is missing or has changed.', '40001');
  END IF;
  IF v_actor_role = 'cashier' THEN
    IF v_lease.cashier_id <> v_actor_id
      OR NOT EXISTS (SELECT 1 FROM public.store_users AS membership
        WHERE membership.store_id = v_lease.store_id AND membership.profile_id = v_actor_id) THEN
      PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'Cashiers can revoke only their own store lease.', '42501');
    END IF;
  ELSIF v_actor_role = 'admin' THEN
    IF NOT EXISTS (SELECT 1 FROM public.store_users AS membership
      WHERE membership.store_id = v_lease.store_id AND membership.profile_id = v_actor_id) THEN
      PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'The administrator is not assigned to this store.', '42501');
    END IF;
  ELSE
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'A cashier or assigned store administrator is required.', '42501');
  END IF;
  IF v_lease.state NOT IN ('pending_stock', 'active') THEN
    PERFORM private.raise_pos_operation_error('LEASE_NOT_REVOCABLE', 'This offline lease is already closed.', '23514');
  END IF;

  v_state := CASE WHEN v_lease.state = 'pending_stock' AND v_lease.expires_at <= pg_catalog.clock_timestamp()
    THEN 'expired' ELSE 'revoked' END;
  UPDATE public.offline_authorization_leases AS lease
  SET state = v_state, version = lease.version + 1, updated_at = pg_catalog.clock_timestamp()
  WHERE lease.store_id = v_lease.store_id AND lease.id = v_lease.id
  RETURNING lease.version INTO v_version;
  IF v_lease.state = 'pending_stock' THEN
    UPDATE public.terminal_sync_cursors AS cursor
    SET last_reserved_sequence = cursor.last_confirmed_sequence,
        version = cursor.version + 1,
        updated_at = pg_catalog.clock_timestamp()
    WHERE cursor.store_id = v_lease.store_id AND cursor.terminal_id = v_lease.terminal_id;
  END IF;
  INSERT INTO public.offline_authorization_lease_events (
    store_id, lease_id, operation_id, actor_id, event_type, details
  ) VALUES (
    v_lease.store_id, v_lease.id, v_operation.id, v_actor_id, v_state,
    pg_catalog.jsonb_build_object('reason', v_reason, 'grants_released', false)
  );

  RETURN private.finish_pos_operation(
    v_operation.store_id, v_operation.id, 'revoke_offline_lease', v_operation.request_hash,
    'confirmed', 'offline_authorization_lease', v_lease.id::text, v_version,
    pg_catalog.jsonb_build_object(
      'id', v_lease.id, 'store_id', v_lease.store_id,
      'terminal_id', v_lease.terminal_id, 'shift_id', v_lease.shift_id,
      'cashier_id', v_lease.cashier_id, 'prepared_at', v_lease.prepared_at,
      'issued_at', v_lease.issued_at, 'expires_at', v_lease.expires_at,
      'last_mfa_at', v_lease.last_mfa_at, 'activated_at', v_lease.activated_at,
      'state', v_state,
      'catalog_version', v_lease.catalog_version,
      'price_policy_hash', v_lease.price_policy_hash,
      'sequence_start', v_lease.sequence_start, 'sequence_end', v_lease.sequence_end,
      'contract_version', v_lease.contract_version, 'version', v_version
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_offline_lease(p_store_id uuid, p_lease_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_actor_role text;
  v_lease public.offline_authorization_leases%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR NOT private.mfa_session_is_valid() THEN
    PERFORM private.raise_pos_operation_error('AUTH_REQUIRED', 'Authentication is required.', '42501');
  END IF;
  SELECT profile.role::text INTO v_actor_role
  FROM public.profiles AS profile WHERE profile.id = v_actor_id;
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('admin', 'cashier')
    OR NOT EXISTS (SELECT 1 FROM public.store_users AS membership
      WHERE membership.store_id = p_store_id AND membership.profile_id = v_actor_id) THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'The authenticated user is not assigned to this store.', '42501');
  END IF;

  SELECT lease.* INTO v_lease
  FROM public.offline_authorization_leases AS lease
  WHERE lease.store_id = p_store_id AND lease.id = p_lease_id
    AND (v_actor_role = 'admin' OR lease.cashier_id = v_actor_id);
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('LEASE_NOT_FOUND', 'The offline lease was not found for this account and store.', 'P0002');
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'id', v_lease.id, 'store_id', v_lease.store_id,
    'terminal_id', v_lease.terminal_id, 'shift_id', v_lease.shift_id,
    'cashier_id', v_lease.cashier_id, 'prepared_at', v_lease.prepared_at,
    'issued_at', v_lease.issued_at, 'expires_at', v_lease.expires_at,
    'last_mfa_at', v_lease.last_mfa_at, 'activated_at', v_lease.activated_at,
    'state', v_lease.state,
    'catalog_version', v_lease.catalog_version,
    'price_policy_hash', v_lease.price_policy_hash,
    'sequence_start', v_lease.sequence_start, 'sequence_end', v_lease.sequence_end,
    'contract_version', v_lease.contract_version, 'version', v_lease.version
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_offline_lease(jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.revoke_offline_lease(jsonb) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_offline_lease(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.issue_offline_lease(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_offline_lease(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_offline_lease(uuid, uuid) TO authenticated;
