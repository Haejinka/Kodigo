-- Shared command identity and replay envelope. This migration is additive and
-- intentionally does not route any existing checkout through the new tables.

CREATE TABLE public.pos_operations (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  store_id uuid NOT NULL
    REFERENCES public.stores(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  actor_id uuid NOT NULL,
  actor_name_snapshot text NOT NULL,
  terminal_id uuid,
  shift_id uuid,
  contract_version smallint NOT NULL,
  request_hash text NOT NULL,
  canonical_request jsonb NOT NULL,
  response jsonb,
  outcome text,
  aggregate_type text,
  aggregate_id text,
  aggregate_version bigint,
  local_occurred_at timestamptz,
  confirmed_at timestamptz,
  terminal_sequence bigint,
  source text NOT NULL DEFAULT 'online',
  status text NOT NULL DEFAULT 'processing',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pos_operations_store_id_id_unique UNIQUE (store_id, id),
  CONSTRAINT pos_operations_kind_format CHECK (kind ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT pos_operations_contract_version_positive CHECK (contract_version > 0),
  CONSTRAINT pos_operations_request_hash_format CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT pos_operations_canonical_request_object CHECK (pg_catalog.jsonb_typeof(canonical_request) = 'object'),
  CONSTRAINT pos_operations_outcome_valid CHECK (outcome IS NULL OR outcome IN ('confirmed', 'pending_external')),
  CONSTRAINT pos_operations_aggregate_version_nonnegative CHECK (aggregate_version IS NULL OR aggregate_version >= 0),
  CONSTRAINT pos_operations_terminal_sequence_nonnegative CHECK (terminal_sequence IS NULL OR terminal_sequence >= 0),
  CONSTRAINT pos_operations_sequence_requires_terminal CHECK (terminal_sequence IS NULL OR terminal_id IS NOT NULL),
  CONSTRAINT pos_operations_source_valid CHECK (source IN ('online', 'offline', 'recovery')),
  CONSTRAINT pos_operations_status_result_consistent CHECK (
    (status = 'processing'
      AND response IS NULL
      AND outcome IS NULL
      AND aggregate_type IS NULL
      AND aggregate_id IS NULL
      AND aggregate_version IS NULL
      AND confirmed_at IS NULL)
    OR
    (status = 'committed'
      AND response IS NOT NULL
      AND pg_catalog.jsonb_typeof(response) = 'object'
      AND outcome IS NOT NULL
      AND outcome IN ('confirmed', 'pending_external')
      AND aggregate_type IS NOT NULL
      AND aggregate_id IS NOT NULL
      AND aggregate_version IS NOT NULL
      AND confirmed_at IS NOT NULL)
  ),
  CONSTRAINT pos_operations_status_valid CHECK (status IN ('processing', 'committed'))
);

CREATE UNIQUE INDEX pos_operations_terminal_sequence_unique
  ON public.pos_operations (terminal_id, terminal_sequence)
  WHERE terminal_sequence IS NOT NULL;

CREATE INDEX pos_operations_store_created_idx
  ON public.pos_operations (store_id, created_at DESC, id DESC);

CREATE TABLE public.pos_operation_events (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  store_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  event_type text NOT NULL,
  event_ordinal smallint NOT NULL,
  actor_id uuid NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT pos_operation_events_operation_store_fk
    FOREIGN KEY (store_id, operation_id)
    REFERENCES public.pos_operations (store_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT pos_operation_events_type_valid CHECK (event_type IN ('started', 'committed')),
  CONSTRAINT pos_operation_events_ordinal_positive CHECK (event_ordinal > 0),
  CONSTRAINT pos_operation_events_details_object CHECK (pg_catalog.jsonb_typeof(details) = 'object'),
  CONSTRAINT pos_operation_events_operation_type_ordinal_unique
    UNIQUE (operation_id, event_type, event_ordinal)
);

CREATE INDEX pos_operation_events_store_created_idx
  ON public.pos_operation_events (store_id, created_at DESC, id DESC);

ALTER TABLE public.pos_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_operation_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pos_operations, public.pos_operation_events
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.pos_operations IS
  'Private command identity and persisted response envelope; domain tables remain authoritative aggregates.';
COMMENT ON COLUMN public.pos_operations.canonical_request IS
  'Minimized validated semantic metadata and digest only; never stores the submitted payload.';
COMMENT ON TABLE public.pos_operation_events IS
  'Append-only, PII-minimized lifecycle events for POS command envelopes.';

CREATE OR REPLACE FUNCTION private.guard_pos_operation_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'POS operation identity and result history cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status <> 'processing'
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.store_id IS DISTINCT FROM OLD.store_id
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
    OR NEW.actor_name_snapshot IS DISTINCT FROM OLD.actor_name_snapshot
    OR NEW.terminal_id IS DISTINCT FROM OLD.terminal_id
    OR NEW.shift_id IS DISTINCT FROM OLD.shift_id
    OR NEW.contract_version IS DISTINCT FROM OLD.contract_version
    OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
    OR NEW.canonical_request IS DISTINCT FROM OLD.canonical_request
    OR NEW.local_occurred_at IS DISTINCT FROM OLD.local_occurred_at
    OR NEW.terminal_sequence IS DISTINCT FROM OLD.terminal_sequence
    OR NEW.source IS DISTINCT FROM OLD.source
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.status <> 'committed' THEN
    RAISE EXCEPTION 'Only a processing POS operation may be finalized once'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER pos_operations_identity_immutable
  BEFORE UPDATE OR DELETE ON public.pos_operations
  FOR EACH ROW EXECUTE FUNCTION private.guard_pos_operation_mutation();

CREATE OR REPLACE FUNCTION private.raise_pos_operation_error(
  p_business_code text,
  p_message text,
  p_sqlstate text DEFAULT 'P0001'
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = p_sqlstate,
    MESSAGE = p_message,
    DETAIL = pg_catalog.jsonb_build_object(
      'business_code', p_business_code,
      'message', p_message,
      'retryable', false
    )::text;
END;
$function$;

CREATE OR REPLACE FUNCTION private.reject_pos_operation_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'POS operation events are append-only'
    USING ERRCODE = '55000';
END;
$function$;

CREATE TRIGGER pos_operation_events_append_only
  BEFORE UPDATE OR DELETE ON public.pos_operation_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_pos_operation_event_mutation();

CREATE OR REPLACE FUNCTION private.assert_pos_operation_committed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_status text;
BEGIN
  SELECT operation.status
  INTO v_status
  FROM public.pos_operations AS operation
  WHERE operation.id = NEW.id;

  IF v_status IS DISTINCT FROM 'committed' THEN
    RAISE EXCEPTION 'A POS operation cannot commit before its response is persisted'
      USING ERRCODE = '23514',
        CONSTRAINT = 'pos_operations_must_commit_with_response';
  END IF;

  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER pos_operations_must_commit_with_response
  AFTER INSERT OR UPDATE ON public.pos_operations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.assert_pos_operation_committed();

CREATE OR REPLACE FUNCTION private.begin_pos_operation(
  p_kind text,
  p_command jsonb
)
RETURNS public.pos_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_actor_role text;
  v_actor_name text;
  v_operation_id uuid;
  v_store_id uuid;
  v_terminal_id uuid;
  v_shift_id uuid;
  v_occurred_at timestamptz;
  v_terminal_sequence bigint;
  v_expected_version bigint;
  v_occurred_at_canonical text;
  v_contract_version smallint;
  v_payload jsonb;
  v_envelope_key_count integer;
  v_semantic_request jsonb;
  v_request_hash text;
  v_existing public.pos_operations%ROWTYPE;
  v_created public.pos_operations%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL THEN
    PERFORM private.raise_pos_operation_error('AUTH_REQUIRED', 'Authentication is required.', '42501');
  END IF;

  IF NOT private.mfa_session_is_valid() THEN
    PERFORM private.raise_pos_operation_error('MFA_REQUIRED', 'A valid MFA session is required.', '42501');
  END IF;

  IF p_command IS NULL
    OR pg_catalog.jsonb_typeof(p_command) IS DISTINCT FROM 'object' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'The command envelope must be a JSON object.');
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO v_envelope_key_count
  FROM pg_catalog.jsonb_object_keys(p_command);
  IF v_envelope_key_count <> 9 OR NOT (p_command ?& ARRAY[
      'contract_version', 'operation_id', 'store_id', 'terminal_id', 'shift_id',
      'occurred_at_local', 'terminal_sequence', 'expected_version', 'payload'
    ]) THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'The command envelope has missing, extra, or invalid fields.');
  END IF;

  IF p_kind IS NULL OR p_kind !~ '^[a-z][a-z0-9_]{0,63}$' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Command kind is invalid.');
  END IF;

  IF pg_catalog.jsonb_typeof(p_command->'contract_version') IS DISTINCT FROM 'number'
    OR p_command->>'contract_version' <> '1' THEN
    PERFORM private.raise_pos_operation_error('UNSUPPORTED_CONTRACT', 'Command contract version is not supported.');
  END IF;
  v_contract_version := 1;

  IF pg_catalog.jsonb_typeof(p_command->'operation_id') IS DISTINCT FROM 'string'
    OR p_command->>'operation_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR pg_catalog.jsonb_typeof(p_command->'store_id') IS DISTINCT FROM 'string'
    OR p_command->>'store_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Operation and store identifiers must be UUIDs.');
  END IF;
  v_operation_id := (p_command->>'operation_id')::uuid;
  v_store_id := (p_command->>'store_id')::uuid;

  IF p_command->'terminal_id' <> 'null'::jsonb THEN
    IF pg_catalog.jsonb_typeof(p_command->'terminal_id') IS DISTINCT FROM 'string'
      OR p_command->>'terminal_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Terminal identifier must be a UUID or null.');
    END IF;
    v_terminal_id := (p_command->>'terminal_id')::uuid;
  END IF;

  IF p_command->'shift_id' <> 'null'::jsonb THEN
    IF pg_catalog.jsonb_typeof(p_command->'shift_id') IS DISTINCT FROM 'string'
      OR p_command->>'shift_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Shift identifier must be a UUID or null.');
    END IF;
    v_shift_id := (p_command->>'shift_id')::uuid;
  END IF;

  IF p_command->'occurred_at_local' <> 'null'::jsonb THEN
    IF pg_catalog.jsonb_typeof(p_command->'occurred_at_local') IS DISTINCT FROM 'string'
      OR p_command->>'occurred_at_local' !~* '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Local occurrence time must be an ISO timestamp with a timezone.');
    END IF;
    BEGIN
      v_occurred_at := (p_command->>'occurred_at_local')::timestamptz;
      v_occurred_at_canonical := pg_catalog.to_char(
        v_occurred_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      );
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format OR invalid_time_zone_displacement_value THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Local occurrence time is invalid.');
    END;
  END IF;

  IF p_command->'terminal_sequence' <> 'null'::jsonb THEN
    IF pg_catalog.jsonb_typeof(p_command->'terminal_sequence') IS DISTINCT FROM 'number'
      OR p_command->>'terminal_sequence' !~ '^(0|[1-9][0-9]*)$'
      OR pg_catalog.length(p_command->>'terminal_sequence') > 18 THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Terminal sequence must be a non-negative integer or null.');
    END IF;
    v_terminal_sequence := (p_command->>'terminal_sequence')::bigint;
  END IF;

  IF p_command->'expected_version' <> 'null'::jsonb THEN
    IF pg_catalog.jsonb_typeof(p_command->'expected_version') IS DISTINCT FROM 'number'
      OR p_command->>'expected_version' !~ '^(0|[1-9][0-9]*)$'
      OR pg_catalog.length(p_command->>'expected_version') > 18 THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Expected version must be a non-negative integer or null.');
    END IF;
    v_expected_version := (p_command->>'expected_version')::bigint;
  END IF;

  IF pg_catalog.jsonb_typeof(p_command->'payload') IS DISTINCT FROM 'object' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Command payload must be a JSON object.');
  END IF;
  v_payload := p_command->'payload';

  IF NOT public.user_belongs_to_store(v_store_id) THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'The authenticated user is not assigned to this store.', '42501');
  END IF;

  SELECT profile.role::text, profile.name
  INTO v_actor_role, v_actor_name
  FROM public.profiles AS profile
  WHERE profile.id = v_actor_id;

  IF v_actor_role IS NULL OR v_actor_role NOT IN ('admin', 'cashier', 'inventory') THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'This account has no operational command authority.', '42501');
  END IF;

  v_semantic_request := pg_catalog.jsonb_build_object(
    'kind', p_kind,
    'contract_version', v_contract_version,
    'store_id', v_store_id,
    'terminal_id', v_terminal_id,
    'shift_id', v_shift_id,
    'occurred_at_local', v_occurred_at_canonical,
    'terminal_sequence', v_terminal_sequence,
    'expected_version', v_expected_version,
    'payload', v_payload
  );
  v_request_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_semantic_request::text, 'UTF8'), 'sha256'),
    'hex'
  );

  -- Lock by operation ID first so UUID reuse across stores cannot race the
  -- global primary key; the second key retains the documented store scope.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pos-operation:' || v_operation_id::text, 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pos-store-operation:' || v_store_id::text || ':' || v_operation_id::text, 0)
  );

  SELECT operation.*
  INTO v_existing
  FROM public.pos_operations AS operation
  WHERE operation.id = v_operation_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.store_id IS DISTINCT FROM v_store_id
      OR v_existing.actor_id IS DISTINCT FROM v_actor_id
      OR v_existing.kind IS DISTINCT FROM p_kind
      OR v_existing.contract_version IS DISTINCT FROM v_contract_version
      OR v_existing.terminal_id IS DISTINCT FROM v_terminal_id
      OR v_existing.shift_id IS DISTINCT FROM v_shift_id
      OR v_existing.request_hash IS DISTINCT FROM v_request_hash THEN
      PERFORM private.raise_pos_operation_error('IDEMPOTENCY_MISMATCH', 'Operation ID was already used for a different actor, scope, kind, or request.');
    END IF;
    IF v_existing.status <> 'committed' THEN
      PERFORM private.raise_pos_operation_error('IDEMPOTENCY_MISMATCH', 'The existing operation has no committed response.');
    END IF;
    RETURN v_existing;
  END IF;

  INSERT INTO public.pos_operations (
    id, store_id, kind, actor_id, actor_name_snapshot, terminal_id, shift_id,
    contract_version, request_hash, canonical_request, local_occurred_at,
    terminal_sequence, source, status
  )
  VALUES (
    v_operation_id,
    v_store_id,
    p_kind,
    v_actor_id,
    coalesce(nullif(pg_catalog.btrim(v_actor_name), ''), 'Unknown user'),
    v_terminal_id,
    v_shift_id,
    v_contract_version,
    v_request_hash,
    pg_catalog.jsonb_build_object(
      'contract_version', v_contract_version,
      'terminal_id', v_terminal_id,
      'shift_id', v_shift_id,
      'occurred_at_local', v_occurred_at_canonical,
      'terminal_sequence', v_terminal_sequence,
      'expected_version', v_expected_version,
      'request_hash', v_request_hash
    ),
    v_occurred_at,
    v_terminal_sequence,
    'online',
    'processing'
  )
  RETURNING * INTO v_created;

  INSERT INTO public.pos_operation_events (
    store_id, operation_id, event_type, event_ordinal, actor_id, details
  )
  VALUES (
    v_store_id, v_operation_id, 'started', 1, v_actor_id,
    pg_catalog.jsonb_build_object('kind', p_kind, 'contract_version', v_contract_version)
  );

  RETURN v_created;
END;
$function$;

CREATE OR REPLACE FUNCTION private.finish_pos_operation(
  p_store_id uuid,
  p_operation_id uuid,
  p_kind text,
  p_request_hash text,
  p_outcome text,
  p_aggregate_type text,
  p_aggregate_id text,
  p_aggregate_version bigint,
  p_result jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_operation public.pos_operations%ROWTYPE;
  v_confirmed_at timestamptz := pg_catalog.clock_timestamp();
  v_response jsonb;
BEGIN
  IF v_actor_id IS NULL THEN
    PERFORM private.raise_pos_operation_error('AUTH_REQUIRED', 'Authentication is required.', '42501');
  END IF;
  IF NOT private.mfa_session_is_valid() THEN
    PERFORM private.raise_pos_operation_error('MFA_REQUIRED', 'A valid MFA session is required.', '42501');
  END IF;
  IF p_store_id IS NULL OR p_operation_id IS NULL OR NOT public.user_belongs_to_store(p_store_id) THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'The authenticated user is not assigned to this store.', '42501');
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('confirmed', 'pending_external')
    OR p_aggregate_type IS NULL OR p_aggregate_type !~ '^[a-z][a-z0-9_]{0,63}$'
    OR p_aggregate_id IS NULL OR pg_catalog.btrim(p_aggregate_id) = ''
    OR p_aggregate_version IS NULL OR p_aggregate_version < 0
    OR p_result IS NULL OR pg_catalog.jsonb_typeof(p_result) IS DISTINCT FROM 'object'
    OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Command result is invalid.');
  END IF;

  SELECT operation.*
  INTO v_operation
  FROM public.pos_operations AS operation
  WHERE operation.id = p_operation_id
    AND operation.store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_operation.actor_id IS DISTINCT FROM v_actor_id
    OR v_operation.kind IS DISTINCT FROM p_kind
    OR v_operation.request_hash IS DISTINCT FROM p_request_hash THEN
    PERFORM private.raise_pos_operation_error('IDEMPOTENCY_MISMATCH', 'Operation identity does not match the command being completed.');
  END IF;

  IF v_operation.status = 'committed' THEN
    v_response := pg_catalog.jsonb_build_object(
      'contract_version', v_operation.contract_version,
      'operation_id', v_operation.id,
      'outcome', v_operation.outcome,
      'aggregate_type', v_operation.aggregate_type,
      'aggregate_id', v_operation.aggregate_id,
      'aggregate_version', v_operation.aggregate_version,
      'confirmed_at', v_operation.confirmed_at,
      'result', v_operation.response->'result'
    );
    RETURN v_response;
  END IF;

  v_response := pg_catalog.jsonb_build_object(
    'contract_version', v_operation.contract_version,
    'operation_id', v_operation.id,
    'outcome', p_outcome,
    'aggregate_type', p_aggregate_type,
    'aggregate_id', p_aggregate_id,
    'aggregate_version', p_aggregate_version,
    'confirmed_at', v_confirmed_at,
    'result', p_result
  );

  UPDATE public.pos_operations AS operation
  SET response = v_response,
      outcome = p_outcome,
      aggregate_type = p_aggregate_type,
      aggregate_id = p_aggregate_id,
      aggregate_version = p_aggregate_version,
      confirmed_at = v_confirmed_at,
      status = 'committed'
  WHERE operation.id = p_operation_id;

  INSERT INTO public.pos_operation_events (
    store_id, operation_id, event_type, event_ordinal, actor_id, details
  )
  VALUES (
    p_store_id,
    p_operation_id,
    'committed',
    2,
    v_actor_id,
    pg_catalog.jsonb_build_object(
      'outcome', p_outcome,
      'aggregate_type', p_aggregate_type,
      'aggregate_id', p_aggregate_id,
      'aggregate_version', p_aggregate_version
    )
  );

  RETURN v_response;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_pos_operation(
  p_store_id uuid,
  p_operation_id uuid
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
BEGIN
  IF v_actor_id IS NULL THEN
    PERFORM private.raise_pos_operation_error('AUTH_REQUIRED', 'Authentication is required.', '42501');
  END IF;
  IF NOT private.mfa_session_is_valid() THEN
    PERFORM private.raise_pos_operation_error('MFA_REQUIRED', 'A valid MFA session is required.', '42501');
  END IF;
  IF p_store_id IS NULL OR p_operation_id IS NULL OR NOT public.user_belongs_to_store(p_store_id) THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'The authenticated user is not assigned to this store.', '42501');
  END IF;

  SELECT profile.role::text
  INTO v_actor_role
  FROM public.profiles AS profile
  WHERE profile.id = v_actor_id;
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('admin', 'cashier', 'inventory') THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'This account has no operational command authority.', '42501');
  END IF;

  SELECT operation.*
  INTO v_operation
  FROM public.pos_operations AS operation
  WHERE operation.store_id = p_store_id
    AND operation.id = p_operation_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_operation.actor_id IS DISTINCT FROM v_actor_id THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'Only the original actor can read this operation result.', '42501');
  END IF;
  IF v_operation.status <> 'committed' THEN
    RETURN NULL;
  END IF;

  RETURN v_operation.response;
END;
$function$;

REVOKE ALL ON FUNCTION private.raise_pos_operation_error(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_pos_operation_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.reject_pos_operation_event_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.assert_pos_operation_committed()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.begin_pos_operation(text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.finish_pos_operation(uuid, uuid, text, text, text, text, text, bigint, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_pos_operation(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_pos_operation(uuid, uuid) TO authenticated;
