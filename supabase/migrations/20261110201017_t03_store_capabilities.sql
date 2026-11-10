-- Scoped store capabilities and shared operational approval records.
-- All feature flags start false. No legacy migration is replayed here.

CREATE OR REPLACE FUNCTION private.store_feature_flags_valid(p_flags jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN pg_catalog.jsonb_typeof(p_flags) IS DISTINCT FROM 'object' THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_each(p_flags) AS item(key, value)
      WHERE item.key <> ALL (ARRAY[
        'operations_v2', 'inventory_ledger_v2', 'approval_workflows',
        'drawer_shifts', 'digital_services', 'customer_reporting',
        'offline_escrow', 'partial_voids'
      ]::text[])
      OR pg_catalog.jsonb_typeof(item.value) IS DISTINCT FROM 'boolean'
    )
  END;
$function$;

CREATE TABLE public.store_settings (
  store_id uuid PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
  feature_flags jsonb NOT NULL DEFAULT '{
    "operations_v2": false,
    "inventory_ledger_v2": false,
    "approval_workflows": false,
    "drawer_shifts": false,
    "digital_services": false,
    "customer_reporting": false,
    "offline_escrow": false,
    "partial_voids": false
  }'::jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT store_settings_feature_flags_valid
    CHECK (private.store_feature_flags_valid(feature_flags))
);

ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.store_settings FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY store_settings_api_deny
  ON public.store_settings FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION private.store_feature_enabled(p_store_id uuid, p_flag text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_store_id IS NULL OR p_flag <> ALL (ARRAY[
      'operations_v2', 'inventory_ledger_v2', 'approval_workflows',
      'drawer_shifts', 'digital_services', 'customer_reporting',
      'offline_escrow', 'partial_voids'
    ]::text[]) THEN false
    ELSE COALESCE((
      SELECT (settings.feature_flags ->> p_flag)::boolean
      FROM public.store_settings AS settings
      WHERE settings.store_id = p_store_id
    ), false)
  END;
$function$;

CREATE OR REPLACE FUNCTION private.assert_store_feature_enabled(p_store_id uuid, p_flag text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT private.store_feature_enabled(p_store_id, p_flag) THEN
    PERFORM private.raise_pos_operation_error(
      'FEATURE_DISABLED', 'This store feature is not enabled.', '42501'
    );
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION private.assert_store_admin(p_store_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_actor_role text;
BEGIN
  IF v_actor_id IS NULL THEN
    PERFORM private.raise_pos_operation_error('AUTH_REQUIRED', 'Authentication is required.', '42501');
  END IF;
  IF NOT private.mfa_session_is_valid() THEN
    PERFORM private.raise_pos_operation_error('MFA_REQUIRED', 'A valid MFA session is required.', '42501');
  END IF;
  IF p_store_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.store_users AS membership
    WHERE membership.store_id = p_store_id AND membership.profile_id = v_actor_id
  ) THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'The authenticated user is not assigned to this store.', '42501');
  END IF;
  SELECT profile.role::text INTO v_actor_role
  FROM public.profiles AS profile
  WHERE profile.id = v_actor_id;
  IF v_actor_role IS DISTINCT FROM 'admin' THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'Store administrator authority is required.', '42501');
  END IF;
  RETURN v_actor_id;
END;
$function$;

CREATE OR REPLACE FUNCTION private.jsonb_object_key_count(p_value jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN pg_catalog.jsonb_typeof(p_value) IS DISTINCT FROM 'object' THEN -1
    ELSE (SELECT pg_catalog.count(*)::integer FROM pg_catalog.jsonb_object_keys(p_value))
  END;
$function$;

CREATE TABLE public.store_capability_grants (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  -- target_profile_id is an immutable audit identifier. profile_id is the live
  -- membership link and becomes NULL when that store assignment is removed.
  target_profile_id uuid NOT NULL,
  profile_id uuid,
  capability text NOT NULL,
  granted_by uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  grant_reason text NOT NULL,
  revoked_by uuid,
  revoked_at timestamptz,
  revoke_reason text,
  CONSTRAINT store_capability_grants_membership_fk
    FOREIGN KEY (store_id, profile_id)
    REFERENCES public.store_users (store_id, profile_id)
    ON DELETE SET NULL (profile_id),
  CONSTRAINT store_capability_grants_supported_capability CHECK (capability IN (
    'approve_void', 'approve_return', 'approve_refund', 'approve_cash_adjustment',
    'approve_inventory_adjustment', 'operate_digital_services',
    'view_customer_history', 'manage_customers'
  )),
  CONSTRAINT store_capability_grants_profile_link_consistent
    CHECK (profile_id IS NULL OR profile_id = target_profile_id),
  CONSTRAINT store_capability_grants_active_requires_membership
    CHECK (revoked_at IS NOT NULL OR profile_id IS NOT NULL),
  CONSTRAINT store_capability_grants_reason_length
    CHECK (pg_catalog.length(pg_catalog.btrim(grant_reason)) BETWEEN 3 AND 500),
  CONSTRAINT store_capability_grants_revoke_consistent
    CHECK ((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
      OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL
        AND pg_catalog.length(pg_catalog.btrim(revoke_reason)) BETWEEN 3 AND 500))
);

CREATE UNIQUE INDEX store_capability_grants_active_unique
  ON public.store_capability_grants (store_id, target_profile_id, capability)
  WHERE revoked_at IS NULL;
CREATE INDEX store_capability_grants_profile_active_idx
  ON public.store_capability_grants (store_id, profile_id, capability)
  WHERE revoked_at IS NULL;

ALTER TABLE public.store_capability_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.store_capability_grants FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY store_capability_grants_api_deny
  ON public.store_capability_grants FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION private.guard_store_capability_grant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Capability grant history cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.profile_id IS NULL OR NEW.profile_id IS DISTINCT FROM NEW.target_profile_id
      OR NEW.granted_by IS DISTINCT FROM (SELECT auth.uid())
      OR NEW.revoked_at IS NOT NULL OR NEW.revoked_by IS NOT NULL OR NEW.revoke_reason IS NOT NULL THEN
      RAISE EXCEPTION 'A new capability grant must be active and assigned' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.revoked_at IS NOT NULL THEN
    IF OLD.profile_id IS NOT NULL
      AND NEW.profile_id IS NULL
      AND NEW.id IS NOT DISTINCT FROM OLD.id
      AND NEW.store_id IS NOT DISTINCT FROM OLD.store_id
      AND NEW.target_profile_id IS NOT DISTINCT FROM OLD.target_profile_id
      AND NEW.capability IS NOT DISTINCT FROM OLD.capability
      AND NEW.granted_by IS NOT DISTINCT FROM OLD.granted_by
      AND NEW.granted_at IS NOT DISTINCT FROM OLD.granted_at
      AND NEW.grant_reason IS NOT DISTINCT FROM OLD.grant_reason
      AND NEW.revoked_by IS NOT DISTINCT FROM OLD.revoked_by
      AND NEW.revoked_at IS NOT DISTINCT FROM OLD.revoked_at
      AND NEW.revoke_reason IS NOT DISTINCT FROM OLD.revoke_reason THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Capability grant history cannot be changed after revocation' USING ERRCODE = '55000';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.store_id IS DISTINCT FROM OLD.store_id
    OR NEW.target_profile_id IS DISTINCT FROM OLD.target_profile_id
    OR NEW.capability IS DISTINCT FROM OLD.capability
    OR NEW.granted_by IS DISTINCT FROM OLD.granted_by
    OR NEW.granted_at IS DISTINCT FROM OLD.granted_at
    OR NEW.grant_reason IS DISTINCT FROM OLD.grant_reason
    OR NEW.revoked_at IS NULL
    OR (NEW.profile_id IS DISTINCT FROM OLD.profile_id AND NEW.profile_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Capability grant can only be revoked once' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER store_capability_grants_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.store_capability_grants
  FOR EACH ROW EXECUTE FUNCTION private.guard_store_capability_grant();

CREATE OR REPLACE FUNCTION private.revoke_capabilities_on_membership_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  UPDATE public.store_capability_grants AS grant_row
  SET revoked_by = (SELECT auth.uid()),
      revoked_at = pg_catalog.clock_timestamp(),
      revoke_reason = 'Store assignment removed'
  WHERE grant_row.store_id = OLD.store_id
    AND grant_row.profile_id = OLD.profile_id
    AND grant_row.revoked_at IS NULL;
  RETURN OLD;
END;
$function$;

CREATE TRIGGER store_users_revoke_capabilities_before_delete
  BEFORE DELETE ON public.store_users
  FOR EACH ROW EXECUTE FUNCTION private.revoke_capabilities_on_membership_delete();

CREATE OR REPLACE FUNCTION private.assert_store_capability(p_store_id uuid, p_capability text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_actor_role text;
BEGIN
  IF v_actor_id IS NULL THEN
    PERFORM private.raise_pos_operation_error('AUTH_REQUIRED', 'Authentication is required.', '42501');
  END IF;
  IF NOT private.mfa_session_is_valid() THEN
    PERFORM private.raise_pos_operation_error('MFA_REQUIRED', 'A valid MFA session is required.', '42501');
  END IF;
  IF p_store_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.store_users AS membership
    WHERE membership.store_id = p_store_id AND membership.profile_id = v_actor_id
  ) THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'The authenticated user is not assigned to this store.', '42501');
  END IF;
  IF p_capability IS NULL OR p_capability <> ALL (ARRAY[
    'approve_void', 'approve_return', 'approve_refund', 'approve_cash_adjustment',
    'approve_inventory_adjustment', 'operate_digital_services',
    'view_customer_history', 'manage_customers'
  ]::text[]) THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Capability code is unsupported.');
  END IF;

  SELECT profile.role::text INTO v_actor_role
  FROM public.profiles AS profile
  WHERE profile.id = v_actor_id;
  IF v_actor_role = 'admin' THEN
    RETURN v_actor_id;
  END IF;
  IF v_actor_role IN ('cashier', 'inventory') AND EXISTS (
    SELECT 1
    FROM public.store_capability_grants AS grant_row
    WHERE grant_row.store_id = p_store_id
      AND grant_row.profile_id = v_actor_id
      AND grant_row.target_profile_id = v_actor_id
      AND grant_row.capability = p_capability
      AND grant_row.revoked_at IS NULL
      AND NOT (v_actor_role = 'inventory' AND p_capability <> 'approve_inventory_adjustment')
      AND NOT (v_actor_role = 'cashier' AND p_capability = 'approve_inventory_adjustment')
  ) THEN
    RETURN v_actor_id;
  END IF;
  PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'The required store capability is not active.', '42501');
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_store_capability_grants(p_store_id uuid)
RETURNS TABLE (
  grant_id uuid,
  profile_id uuid,
  capability text,
  granted_by uuid,
  granted_at timestamptz,
  grant_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM private.assert_store_admin(p_store_id);
  RETURN QUERY
    SELECT grant_row.id, grant_row.profile_id, grant_row.capability,
      grant_row.granted_by, grant_row.granted_at, grant_row.grant_reason
    FROM public.store_capability_grants AS grant_row
    JOIN public.profiles AS target ON target.id = grant_row.profile_id
    JOIN public.store_users AS membership
      ON membership.store_id = grant_row.store_id AND membership.profile_id = grant_row.profile_id
    WHERE grant_row.store_id = p_store_id
      AND grant_row.revoked_at IS NULL
      AND target.role::text IN ('cashier', 'inventory')
    ORDER BY grant_row.profile_id, grant_row.capability, grant_row.granted_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.grant_store_capability(
  p_store_id uuid,
  p_profile_id uuid,
  p_capability text,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid;
  v_target_role text;
  v_grant_id uuid;
  v_reason text := pg_catalog.btrim(COALESCE(p_reason, ''));
BEGIN
  v_actor_id := private.assert_store_admin(p_store_id);
  IF p_profile_id IS NULL OR p_capability IS NULL OR p_capability <> ALL (ARRAY[
    'approve_void', 'approve_return', 'approve_refund', 'approve_cash_adjustment',
    'approve_inventory_adjustment', 'operate_digital_services',
    'view_customer_history', 'manage_customers'
  ]::text[]) THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Target profile and supported capability are required.');
  END IF;
  IF p_profile_id = v_actor_id THEN
    PERFORM private.raise_pos_operation_error('SELF_GRANT', 'Administrators cannot grant capabilities to themselves.', '42501');
  END IF;
  IF pg_catalog.length(v_reason) NOT BETWEEN 3 AND 500 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Grant reason must contain 3 to 500 characters.');
  END IF;

  SELECT profile.role::text INTO v_target_role
  FROM public.profiles AS profile
  JOIN public.store_users AS membership ON membership.profile_id = profile.id
  WHERE profile.id = p_profile_id AND membership.store_id = p_store_id
  FOR UPDATE OF profile, membership;
  IF v_target_role IS NULL THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'Target profile is not assigned to this store.', '42501');
  END IF;
  IF v_target_role NOT IN ('cashier', 'inventory') THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'Capabilities can only be granted to assigned cashier or inventory staff.', '42501');
  END IF;
  IF v_target_role = 'inventory' AND p_capability <> 'approve_inventory_adjustment' THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'Inventory staff may only receive inventory adjustment approval.', '42501');
  END IF;
  IF v_target_role = 'cashier' AND p_capability = 'approve_inventory_adjustment' THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'Inventory adjustment approval is scoped to inventory staff.', '42501');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.store_capability_grants AS existing
    WHERE existing.store_id = p_store_id
      AND existing.target_profile_id = p_profile_id
      AND existing.capability = p_capability
      AND existing.revoked_at IS NULL
  ) THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'This capability is already active for the selected user.');
  END IF;

  INSERT INTO public.store_capability_grants (
    store_id, target_profile_id, profile_id, capability, granted_by, grant_reason
  ) VALUES (
    p_store_id, p_profile_id, p_profile_id, p_capability, v_actor_id, v_reason
  ) RETURNING id INTO v_grant_id;
  RETURN v_grant_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_store_capability(
  p_store_id uuid,
  p_grant_id uuid,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid;
  v_reason text := pg_catalog.btrim(COALESCE(p_reason, ''));
  v_grant public.store_capability_grants%ROWTYPE;
BEGIN
  v_actor_id := private.assert_store_admin(p_store_id);
  IF p_grant_id IS NULL OR pg_catalog.length(v_reason) NOT BETWEEN 3 AND 500 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'A grant ID and a 3 to 500 character reason are required.');
  END IF;

  SELECT grant_row.* INTO v_grant
  FROM public.store_capability_grants AS grant_row
  WHERE grant_row.store_id = p_store_id AND grant_row.id = p_grant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'Capability grant was not found in this store.', '42501');
  END IF;
  IF v_grant.revoked_at IS NOT NULL THEN
    RETURN false;
  END IF;

  UPDATE public.store_capability_grants AS grant_row
  SET revoked_by = v_actor_id,
      revoked_at = pg_catalog.clock_timestamp(),
      revoke_reason = v_reason
  WHERE grant_row.store_id = p_store_id AND grant_row.id = p_grant_id;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION private.approval_proposal_is_valid(
  p_kind text,
  p_resource_id uuid,
  p_proposal jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  v_amount_text text;
  v_quantity_text text;
BEGIN
  IF p_resource_id IS NULL OR pg_catalog.jsonb_typeof(p_proposal) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;

  IF p_kind = 'inventory_adjustment' THEN
    IF private.jsonb_object_key_count(p_proposal) <> 4
      OR NOT (p_proposal ?& ARRAY['product_id', 'location_id', 'mode', 'quantity'])
      OR pg_catalog.jsonb_typeof(p_proposal->'product_id') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(p_proposal->'location_id') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(p_proposal->'mode') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(p_proposal->'quantity') IS DISTINCT FROM 'number'
      OR p_proposal->>'product_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR p_proposal->>'location_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN false;
    END IF;
    IF pg_catalog.lower(p_proposal->>'product_id') IS DISTINCT FROM p_resource_id::text
      OR p_proposal->>'mode' NOT IN ('remove', 'count') THEN
      RETURN false;
    END IF;
    v_quantity_text := p_proposal->>'quantity';
    IF pg_catalog.length(v_quantity_text) > 32
      OR v_quantity_text !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$' THEN
      RETURN false;
    END IF;
    RETURN (v_quantity_text)::numeric > 0 OR p_proposal->>'mode' = 'count';
  ELSIF p_kind = 'cash_movement' THEN
    IF private.jsonb_object_key_count(p_proposal) <> 4
      OR NOT (p_proposal ?& ARRAY['shift_id', 'type', 'direction', 'amount'])
      OR pg_catalog.jsonb_typeof(p_proposal->'shift_id') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(p_proposal->'type') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(p_proposal->'direction') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(p_proposal->'amount') IS DISTINCT FROM 'number'
      OR p_proposal->>'shift_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR p_proposal->>'type' <> 'adjustment'
      OR p_proposal->>'direction' NOT IN ('add', 'remove') THEN
      RETURN false;
    END IF;
    IF pg_catalog.lower(p_proposal->>'shift_id') IS DISTINCT FROM p_resource_id::text THEN
      RETURN false;
    END IF;
    v_amount_text := p_proposal->>'amount';
    IF pg_catalog.length(v_amount_text) > 32
      OR v_amount_text !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' THEN
      RETURN false;
    END IF;
    RETURN (v_amount_text)::numeric > 0;
  ELSIF p_kind = 'wallet_adjustment' THEN
    IF private.jsonb_object_key_count(p_proposal) <> 4
      OR NOT (p_proposal ?& ARRAY['wallet_id', 'kind', 'amount', 'funding_source'])
      OR pg_catalog.jsonb_typeof(p_proposal->'wallet_id') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(p_proposal->'kind') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(p_proposal->'amount') IS DISTINCT FROM 'number'
      OR pg_catalog.jsonb_typeof(p_proposal->'funding_source') IS DISTINCT FROM 'string'
      OR p_proposal->>'wallet_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR p_proposal->>'kind' NOT IN ('opening', 'topup', 'withdraw', 'correction')
      OR p_proposal->>'funding_source' NOT IN ('cash', 'external', 'opening_balance') THEN
      RETURN false;
    END IF;
    IF pg_catalog.lower(p_proposal->>'wallet_id') IS DISTINCT FROM p_resource_id::text THEN
      RETURN false;
    END IF;
    v_amount_text := p_proposal->>'amount';
    IF pg_catalog.length(v_amount_text) > 32
      OR v_amount_text !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' THEN
      RETURN false;
    END IF;
    RETURN (v_amount_text)::numeric > 0;
  END IF;
  RETURN false;
END;
$function$;

CREATE TABLE public.operational_approval_requests (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL,
  kind text NOT NULL,
  resource_id uuid NOT NULL,
  requester_id uuid NOT NULL,
  expected_resource_version bigint NOT NULL,
  proposed_payload jsonb NOT NULL,
  proposal_hash text NOT NULL,
  reason text NOT NULL,
  state text NOT NULL DEFAULT 'requested',
  request_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT operational_approval_requests_store_id_id_unique UNIQUE (store_id, id),
  CONSTRAINT operational_approval_requests_operation_fk
    FOREIGN KEY (store_id, operation_id)
    REFERENCES public.pos_operations (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT operational_approval_requests_operation_unique UNIQUE (store_id, operation_id),
  CONSTRAINT operational_approval_requests_kind_valid CHECK (kind IN (
    'inventory_adjustment', 'cash_movement', 'wallet_adjustment'
  )),
  CONSTRAINT operational_approval_requests_expected_version_nonnegative
    CHECK (expected_resource_version >= 0),
  CONSTRAINT operational_approval_requests_payload_object
    CHECK (pg_catalog.jsonb_typeof(proposed_payload) = 'object'),
  CONSTRAINT operational_approval_requests_proposal_hash_format
    CHECK (proposal_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT operational_approval_requests_reason_length
    CHECK (pg_catalog.length(pg_catalog.btrim(reason)) BETWEEN 3 AND 500),
  CONSTRAINT operational_approval_requests_state_valid
    CHECK (state IN ('requested', 'approved', 'rejected', 'applied')),
  CONSTRAINT operational_approval_requests_version_positive
    CHECK (request_version > 0),
  CONSTRAINT operational_approval_requests_proposal_typed
    CHECK (private.approval_proposal_is_valid(kind, resource_id, proposed_payload))
);

CREATE INDEX operational_approval_requests_store_state_idx
  ON public.operational_approval_requests (store_id, state, created_at DESC, id DESC);
CREATE INDEX operational_approval_requests_requester_idx
  ON public.operational_approval_requests (store_id, requester_id, created_at DESC, id DESC);

CREATE TABLE public.operational_approval_decisions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  store_id uuid NOT NULL,
  request_id uuid NOT NULL,
  request_version bigint NOT NULL,
  decision text NOT NULL,
  actor_id uuid NOT NULL,
  reason text NOT NULL,
  operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT operational_approval_decisions_store_id_id_unique UNIQUE (store_id, id),
  CONSTRAINT operational_approval_decisions_request_fk
    FOREIGN KEY (store_id, request_id)
    REFERENCES public.operational_approval_requests (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT operational_approval_decisions_request_unique UNIQUE (request_id),
  CONSTRAINT operational_approval_decisions_operation_fk
    FOREIGN KEY (store_id, operation_id)
    REFERENCES public.pos_operations (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT operational_approval_decisions_operation_unique UNIQUE (store_id, operation_id),
  CONSTRAINT operational_approval_decisions_version_positive CHECK (request_version > 0),
  CONSTRAINT operational_approval_decisions_choice_valid CHECK (decision IN ('approve', 'reject')),
  CONSTRAINT operational_approval_decisions_reason_length
    CHECK (pg_catalog.length(pg_catalog.btrim(reason)) BETWEEN 3 AND 500)
);

CREATE INDEX operational_approval_decisions_actor_idx
  ON public.operational_approval_decisions (store_id, actor_id, created_at DESC, id DESC);

CREATE TABLE public.operational_approval_applications (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  store_id uuid NOT NULL,
  request_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  applied_by uuid NOT NULL,
  applied_resource_version bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT operational_approval_applications_store_id_id_unique UNIQUE (store_id, id),
  CONSTRAINT operational_approval_applications_request_fk
    FOREIGN KEY (store_id, request_id)
    REFERENCES public.operational_approval_requests (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT operational_approval_applications_decision_fk
    FOREIGN KEY (store_id, decision_id)
    REFERENCES public.operational_approval_decisions (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT operational_approval_applications_operation_fk
    FOREIGN KEY (store_id, operation_id)
    REFERENCES public.pos_operations (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT operational_approval_applications_request_unique UNIQUE (request_id),
  CONSTRAINT operational_approval_applications_operation_unique UNIQUE (store_id, operation_id),
  CONSTRAINT operational_approval_applications_version_nonnegative CHECK (applied_resource_version >= 0)
);

CREATE INDEX operational_approval_applications_store_created_idx
  ON public.operational_approval_applications (store_id, created_at DESC, id DESC);

ALTER TABLE public.operational_approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_approval_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_approval_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.operational_approval_requests,
  public.operational_approval_decisions,
  public.operational_approval_applications
  FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY operational_approval_requests_api_deny
  ON public.operational_approval_requests FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY operational_approval_decisions_api_deny
  ON public.operational_approval_decisions FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY operational_approval_applications_api_deny
  ON public.operational_approval_applications FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION private.guard_operational_approval_request()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Operational approval requests cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'requested' OR NEW.request_version <> 1 THEN
      RAISE EXCEPTION 'Operational approval request must begin in requested state' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.pos_operations AS operation
      WHERE operation.store_id = NEW.store_id
        AND operation.id = NEW.operation_id
        AND operation.actor_id = NEW.requester_id
        AND NEW.requester_id = (SELECT auth.uid())
        AND operation.kind = 'operational_approval_request'
        AND operation.status = 'processing'
    ) THEN
      RAISE EXCEPTION 'Approval request must belong to its pending actor operation' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.store_id IS DISTINCT FROM OLD.store_id
    OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
    OR NEW.requester_id IS DISTINCT FROM OLD.requester_id
    OR NEW.expected_resource_version IS DISTINCT FROM OLD.expected_resource_version
    OR NEW.proposed_payload IS DISTINCT FROM OLD.proposed_payload
    OR NEW.proposal_hash IS DISTINCT FROM OLD.proposal_hash
    OR NEW.reason IS DISTINCT FROM OLD.reason
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.request_version <> OLD.request_version + 1
    OR NOT ((OLD.state = 'requested' AND NEW.state IN ('approved', 'rejected'))
      OR (OLD.state = 'approved' AND NEW.state = 'applied')) THEN
    RAISE EXCEPTION 'Operational approval proposal is immutable and state transitions are one-way' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER operational_approval_requests_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.operational_approval_requests
  FOR EACH ROW EXECUTE FUNCTION private.guard_operational_approval_request();

CREATE OR REPLACE FUNCTION private.guard_operational_approval_decision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_request public.operational_approval_requests%ROWTYPE;
BEGIN
  SELECT request.* INTO v_request
  FROM public.operational_approval_requests AS request
  WHERE request.store_id = NEW.store_id AND request.id = NEW.request_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.state <> 'requested'
    OR v_request.request_version IS DISTINCT FROM NEW.request_version
    OR v_request.requester_id = NEW.actor_id
    OR NEW.actor_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'Decision must be independent and match the current request version' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.pos_operations AS operation
    WHERE operation.store_id = NEW.store_id
      AND operation.id = NEW.operation_id
      AND operation.actor_id = NEW.actor_id
      AND operation.kind = 'operational_approval_decision'
      AND operation.status = 'processing'
  ) THEN
    RAISE EXCEPTION 'Approval decision must belong to its pending actor operation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER operational_approval_decisions_guard
  BEFORE INSERT ON public.operational_approval_decisions
  FOR EACH ROW EXECUTE FUNCTION private.guard_operational_approval_decision();

CREATE OR REPLACE FUNCTION private.reject_approval_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Operational approval history is immutable' USING ERRCODE = '55000';
END;
$function$;

CREATE OR REPLACE FUNCTION private.guard_operational_approval_application()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_request public.operational_approval_requests%ROWTYPE;
  v_decision public.operational_approval_decisions%ROWTYPE;
  v_operation public.pos_operations%ROWTYPE;
  v_expected_kind text;
BEGIN
  SELECT request.* INTO v_request
  FROM public.operational_approval_requests AS request
  WHERE request.store_id = NEW.store_id AND request.id = NEW.request_id
  FOR UPDATE;
  SELECT decision.* INTO v_decision
  FROM public.operational_approval_decisions AS decision
  WHERE decision.store_id = NEW.store_id
    AND decision.id = NEW.decision_id AND decision.request_id = NEW.request_id;
  SELECT operation.* INTO v_operation
  FROM public.pos_operations AS operation
  WHERE operation.store_id = NEW.store_id AND operation.id = NEW.operation_id;
  v_expected_kind := CASE v_request.kind
    WHEN 'inventory_adjustment' THEN 'apply_inventory_adjustment'
    WHEN 'cash_movement' THEN 'record_cash_movement'
    WHEN 'wallet_adjustment' THEN 'apply_wallet_adjustment'
    ELSE NULL
  END;
  IF NOT FOUND OR v_request.state <> 'approved'
    OR v_decision.decision IS DISTINCT FROM 'approve'
    OR v_decision.actor_id = v_request.requester_id
    OR NEW.applied_by IS DISTINCT FROM (SELECT auth.uid())
    OR v_operation.actor_id IS DISTINCT FROM NEW.applied_by
    OR v_operation.status <> 'processing'
    OR v_expected_kind IS NULL OR v_operation.kind IS DISTINCT FROM v_expected_kind
    OR NEW.applied_resource_version <> v_request.expected_resource_version + 1 THEN
    RAISE EXCEPTION 'Application must match an independently approved request and current domain operation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER operational_approval_applications_guard
  BEFORE INSERT ON public.operational_approval_applications
  FOR EACH ROW EXECUTE FUNCTION private.guard_operational_approval_application();

CREATE TRIGGER operational_approval_decisions_immutable
  BEFORE UPDATE OR DELETE ON public.operational_approval_decisions
  FOR EACH ROW EXECUTE FUNCTION private.reject_approval_history_mutation();
CREATE TRIGGER operational_approval_applications_immutable
  BEFORE UPDATE OR DELETE ON public.operational_approval_applications
  FOR EACH ROW EXECUTE FUNCTION private.reject_approval_history_mutation();

CREATE OR REPLACE FUNCTION private.assert_operational_approval_consistent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_request_id uuid;
  v_store_id uuid;
  v_state text;
  v_decision text;
  v_application_exists boolean;
BEGIN
  IF TG_TABLE_NAME = 'operational_approval_requests' THEN
    v_request_id := COALESCE(NEW.id, OLD.id);
    v_store_id := COALESCE(NEW.store_id, OLD.store_id);
  ELSE
    v_request_id := COALESCE(NEW.request_id, OLD.request_id);
    v_store_id := COALESCE(NEW.store_id, OLD.store_id);
  END IF;

  SELECT request.state INTO v_state
  FROM public.operational_approval_requests AS request
  WHERE request.store_id = v_store_id AND request.id = v_request_id;
  SELECT decision.decision INTO v_decision
  FROM public.operational_approval_decisions AS decision
  WHERE decision.store_id = v_store_id AND decision.request_id = v_request_id;
  SELECT EXISTS (
    SELECT 1 FROM public.operational_approval_applications AS application
    WHERE application.store_id = v_store_id AND application.request_id = v_request_id
  ) INTO v_application_exists;

  IF v_state IS NULL
    OR (v_state = 'requested' AND (v_decision IS NOT NULL OR v_application_exists))
    OR (v_state = 'approved' AND (v_decision IS DISTINCT FROM 'approve' OR v_application_exists))
    OR (v_state = 'rejected' AND (v_decision IS DISTINCT FROM 'reject' OR v_application_exists))
    OR (v_state = 'applied' AND (v_decision IS DISTINCT FROM 'approve' OR NOT v_application_exists)) THEN
    RAISE EXCEPTION 'Operational approval state does not match its immutable decision and application history'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER operational_approval_requests_consistent
  AFTER INSERT OR UPDATE ON public.operational_approval_requests
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.assert_operational_approval_consistent();
CREATE CONSTRAINT TRIGGER operational_approval_decisions_consistent
  AFTER INSERT ON public.operational_approval_decisions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.assert_operational_approval_consistent();
CREATE CONSTRAINT TRIGGER operational_approval_applications_consistent
  AFTER INSERT ON public.operational_approval_applications
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.assert_operational_approval_consistent();

CREATE OR REPLACE FUNCTION public.request_operational_approval(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
  v_actor_id uuid := (SELECT auth.uid());
  v_actor_role text;
  v_payload jsonb;
  v_kind text;
  v_resource_id uuid;
  v_expected_version bigint;
  v_proposal jsonb;
  v_reason text;
  v_request_id uuid;
  v_proposal_hash text;
  v_result jsonb;
BEGIN
  v_operation := private.begin_pos_operation('operational_approval_request', p_command);
  IF v_operation.status = 'committed' THEN
    RETURN v_operation.response;
  END IF;
  PERFORM private.assert_store_feature_enabled(v_operation.store_id, 'approval_workflows');

  v_payload := p_command->'payload';
  IF private.jsonb_object_key_count(v_payload) <> 5
    OR NOT (v_payload ?& ARRAY['kind', 'resource_id', 'expected_resource_version', 'proposal', 'reason'])
    OR pg_catalog.jsonb_typeof(v_payload->'kind') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'resource_id') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'expected_resource_version') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(v_payload->'proposal') IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(v_payload->'reason') IS DISTINCT FROM 'string'
    OR v_payload->>'resource_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR v_payload->>'expected_resource_version' !~ '^(0|[1-9][0-9]*)$'
    OR pg_catalog.length(v_payload->>'expected_resource_version') > 18 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Approval request payload is incomplete or malformed.');
  END IF;

  v_kind := v_payload->>'kind';
  v_resource_id := (v_payload->>'resource_id')::uuid;
  v_expected_version := (v_payload->>'expected_resource_version')::bigint;
  v_proposal := v_payload->'proposal';
  v_reason := pg_catalog.btrim(v_payload->>'reason');
  IF pg_catalog.length(v_reason) NOT BETWEEN 3 AND 500
    OR NOT private.approval_proposal_is_valid(v_kind, v_resource_id, v_proposal) THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Approval proposal or reason is invalid.');
  END IF;

  SELECT profile.role::text INTO v_actor_role
  FROM public.profiles AS profile
  WHERE profile.id = v_actor_id;
  IF (v_kind = 'inventory_adjustment' AND v_actor_role NOT IN ('admin', 'inventory'))
    OR (v_kind = 'cash_movement' AND v_actor_role NOT IN ('admin', 'cashier'))
    OR (v_kind = 'wallet_adjustment' AND v_actor_role IS DISTINCT FROM 'admin')
    OR v_kind NOT IN ('inventory_adjustment', 'cash_movement', 'wallet_adjustment') THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'This account cannot request this operational approval.', '42501');
  END IF;

  v_proposal_hash := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'kind', v_kind,
      'resource_id', v_resource_id,
      'expected_resource_version', v_expected_version,
      'proposal', v_proposal,
      'reason', v_reason
    )::text, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.operational_approval_requests (
    store_id, operation_id, kind, resource_id, requester_id,
    expected_resource_version, proposed_payload, proposal_hash, reason
  ) VALUES (
    v_operation.store_id, v_operation.id, v_kind, v_resource_id, v_actor_id,
    v_expected_version, v_proposal, v_proposal_hash, v_reason
  ) RETURNING id INTO v_request_id;

  v_result := pg_catalog.jsonb_build_object(
    'workflow_state', 'requested',
    'request_id', v_request_id,
    'request_version', 1,
    'kind', v_kind,
    'proposal_hash', v_proposal_hash
  );
  RETURN private.finish_pos_operation(
    v_operation.store_id, v_operation.id, v_operation.kind, v_operation.request_hash,
    'confirmed', 'operational_approval', v_request_id::text, 1, v_result
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.decide_operational_approval(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
  v_actor_id uuid := (SELECT auth.uid());
  v_payload jsonb;
  v_request public.operational_approval_requests%ROWTYPE;
  v_decision_id uuid;
  v_request_id uuid;
  v_expected_request_version bigint;
  v_choice text;
  v_reason text;
  v_result jsonb;
BEGIN
  v_operation := private.begin_pos_operation('operational_approval_decision', p_command);
  IF v_operation.status = 'committed' THEN
    RETURN v_operation.response;
  END IF;
  PERFORM private.assert_store_feature_enabled(v_operation.store_id, 'approval_workflows');

  v_payload := p_command->'payload';
  IF private.jsonb_object_key_count(v_payload) <> 3
    OR NOT (v_payload ?& ARRAY['request_id', 'decision', 'reason'])
    OR pg_catalog.jsonb_typeof(v_payload->'request_id') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'decision') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'reason') IS DISTINCT FROM 'string'
    OR v_payload->>'request_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR pg_catalog.jsonb_typeof(p_command->'expected_version') IS DISTINCT FROM 'number'
    OR p_command->>'expected_version' !~ '^(1|[1-9][0-9]*)$' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Approval decision payload or request version is invalid.');
  END IF;
  v_request_id := (v_payload->>'request_id')::uuid;
  v_expected_request_version := (p_command->>'expected_version')::bigint;
  v_choice := v_payload->>'decision';
  v_reason := pg_catalog.btrim(v_payload->>'reason');
  IF v_choice NOT IN ('approve', 'reject') OR pg_catalog.length(v_reason) NOT BETWEEN 3 AND 500 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Decision and reason are invalid.');
  END IF;

  SELECT request.* INTO v_request
  FROM public.operational_approval_requests AS request
  WHERE request.store_id = v_operation.store_id AND request.id = v_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'Approval request was not found in this store.', '42501');
  END IF;
  IF v_request.request_version IS DISTINCT FROM v_expected_request_version
    OR v_request.state <> 'requested' THEN
    PERFORM private.raise_pos_operation_error('VERSION_CONFLICT', 'Approval request has already changed.', '40001');
  END IF;
  IF v_request.requester_id = v_actor_id THEN
    PERFORM private.raise_pos_operation_error('SELF_APPROVAL', 'A requester cannot approve or reject their own request.', '42501');
  END IF;

  IF v_request.kind = 'inventory_adjustment' THEN
    PERFORM private.assert_store_capability(v_request.store_id, 'approve_inventory_adjustment');
  ELSIF v_request.kind = 'cash_movement' THEN
    PERFORM private.assert_store_capability(v_request.store_id, 'approve_cash_adjustment');
  ELSIF v_request.kind = 'wallet_adjustment' THEN
    -- There is deliberately no wallet approval capability. Wallet adjustments
    -- remain admin-only until a future business rule defines a separate code.
    PERFORM private.assert_store_admin(v_request.store_id);
  ELSE
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Approval kind is unsupported.');
  END IF;

  INSERT INTO public.operational_approval_decisions (
    store_id, request_id, request_version, decision, actor_id, reason, operation_id
  ) VALUES (
    v_request.store_id, v_request.id, v_request.request_version, v_choice,
    v_actor_id, v_reason, v_operation.id
  ) RETURNING id INTO v_decision_id;

  UPDATE public.operational_approval_requests AS request
  SET state = CASE WHEN v_choice = 'approve' THEN 'approved' ELSE 'rejected' END,
      request_version = request.request_version + 1,
      updated_at = pg_catalog.clock_timestamp()
  WHERE request.store_id = v_request.store_id AND request.id = v_request.id;

  v_result := pg_catalog.jsonb_build_object(
    'workflow_state', CASE WHEN v_choice = 'approve' THEN 'approved' ELSE 'rejected' END,
    'request_id', v_request.id,
    'request_version', v_expected_request_version + 1,
    'decision_id', v_decision_id,
    'decision', v_choice
  );
  RETURN private.finish_pos_operation(
    v_operation.store_id, v_operation.id, v_operation.kind, v_operation.request_hash,
    'confirmed', 'operational_approval', v_request.id::text,
    v_expected_request_version + 1, v_result
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.assert_operational_approval_applicable(
  p_store_id uuid,
  p_request_id uuid,
  p_decision_id uuid,
  p_kind text,
  p_expected_resource_version bigint
)
RETURNS public.operational_approval_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_actor_role text;
  v_request public.operational_approval_requests%ROWTYPE;
  v_decision public.operational_approval_decisions%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR NOT private.mfa_session_is_valid() THEN
    PERFORM private.raise_pos_operation_error('MFA_REQUIRED', 'A valid authenticated MFA session is required.', '42501');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.store_users AS membership
    WHERE membership.store_id = p_store_id AND membership.profile_id = v_actor_id
  ) THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'The authenticated user is not assigned to this store.', '42501');
  END IF;
  PERFORM private.assert_store_feature_enabled(p_store_id, 'approval_workflows');

  SELECT request.* INTO v_request
  FROM public.operational_approval_requests AS request
  WHERE request.store_id = p_store_id AND request.id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'Approval request was not found in this store.', '42501');
  END IF;
  SELECT decision.* INTO v_decision
  FROM public.operational_approval_decisions AS decision
  WHERE decision.store_id = p_store_id
    AND decision.id = p_decision_id
    AND decision.request_id = p_request_id;
  IF NOT FOUND OR v_decision.decision <> 'approve'
    OR v_decision.actor_id = v_request.requester_id
    OR v_request.state <> 'approved'
    OR v_request.kind IS DISTINCT FROM p_kind
    OR v_request.expected_resource_version IS DISTINCT FROM p_expected_resource_version THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'A matching approved request is required to apply this change.', '42501');
  END IF;

  SELECT profile.role::text INTO v_actor_role
  FROM public.profiles AS profile WHERE profile.id = v_actor_id;
  IF (p_kind = 'inventory_adjustment' AND v_actor_role NOT IN ('admin', 'inventory'))
    OR (p_kind = 'cash_movement' AND v_actor_role NOT IN ('admin', 'cashier'))
    OR (p_kind = 'wallet_adjustment' AND v_actor_role IS DISTINCT FROM 'admin') THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'This account cannot apply this operational change.', '42501');
  END IF;
  RETURN v_request;
END;
$function$;

CREATE OR REPLACE FUNCTION private.record_operational_approval_application(
  p_store_id uuid,
  p_request_id uuid,
  p_decision_id uuid,
  p_operation_id uuid,
  p_kind text,
  p_expected_resource_version bigint,
  p_applied_resource_version bigint
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_request public.operational_approval_requests%ROWTYPE;
  v_operation public.pos_operations%ROWTYPE;
  v_application_id uuid;
BEGIN
  v_request := private.assert_operational_approval_applicable(
    p_store_id, p_request_id, p_decision_id, p_kind, p_expected_resource_version
  );
  IF p_applied_resource_version <> v_request.expected_resource_version + 1 THEN
    PERFORM private.raise_pos_operation_error('VERSION_CONFLICT', 'Applied resource version must advance the approved version once.', '40001');
  END IF;
  SELECT operation.* INTO v_operation
  FROM public.pos_operations AS operation
  WHERE operation.store_id = p_store_id AND operation.id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND OR v_operation.actor_id IS DISTINCT FROM v_actor_id
    OR v_operation.status <> 'processing' THEN
    PERFORM private.raise_pos_operation_error('IDEMPOTENCY_MISMATCH', 'Apply operation is not the current actor’s pending operation.', '42501');
  END IF;

  INSERT INTO public.operational_approval_applications (
    store_id, request_id, decision_id, operation_id, applied_by, applied_resource_version
  ) VALUES (
    p_store_id, p_request_id, p_decision_id, p_operation_id, v_actor_id, p_applied_resource_version
  ) RETURNING id INTO v_application_id;
  UPDATE public.operational_approval_requests AS request
  SET state = 'applied', request_version = request.request_version + 1,
      updated_at = pg_catalog.clock_timestamp()
  WHERE request.store_id = p_store_id AND request.id = p_request_id;
  RETURN v_application_id;
END;
$function$;

REVOKE ALL ON FUNCTION private.store_feature_flags_valid(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.store_feature_enabled(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.assert_store_feature_enabled(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.assert_store_admin(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.assert_store_capability(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.jsonb_object_key_count(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_store_capability_grant()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.revoke_capabilities_on_membership_delete()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.approval_proposal_is_valid(text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_operational_approval_request()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_operational_approval_decision()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.reject_approval_history_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_operational_approval_application()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.assert_operational_approval_consistent()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.assert_operational_approval_applicable(uuid, uuid, uuid, text, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.record_operational_approval_application(uuid, uuid, uuid, uuid, text, bigint, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_store_capability_grants(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.grant_store_capability(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.revoke_store_capability(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.request_operational_approval(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.decide_operational_approval(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_store_capability_grants(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_store_capability(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_store_capability(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_operational_approval(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_operational_approval(jsonb) TO authenticated;

COMMENT ON TABLE public.store_capability_grants IS
  'Store-scoped explicit capabilities for assigned cashier or inventory staff; revocation history is retained.';
COMMENT ON TABLE public.operational_approval_requests IS
  'Immutable typed proposal and version for manual inventory, cash, or wallet adjustments.';
COMMENT ON TABLE public.operational_approval_decisions IS
  'One immutable independent approval or rejection per operational request.';
COMMENT ON TABLE public.operational_approval_applications IS
  'Immutable proof that an approved request was applied by one linked domain operation.';
COMMENT ON TABLE public.store_settings IS
  'Typed store feature flags; absent rows and omitted supported keys are false.';
COMMENT ON FUNCTION private.assert_store_capability(uuid, text) IS
  'Fail-closed active membership, MFA, role, and explicit store capability check; super_admin never receives operational authority.';
