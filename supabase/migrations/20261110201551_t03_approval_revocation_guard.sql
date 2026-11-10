-- Revalidate the request and approver's current store authority at apply time.
-- Approval workflows remain disabled until their domain release gates pass.

CREATE OR REPLACE FUNCTION private.profile_has_store_capability(
  p_store_id uuid,
  p_profile_id uuid,
  p_capability text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_store_id IS NULL OR p_profile_id IS NULL OR p_capability IS NULL
      OR p_capability <> ALL (ARRAY[
      'approve_void', 'approve_return', 'approve_refund', 'approve_cash_adjustment',
      'approve_inventory_adjustment', 'operate_digital_services',
      'view_customer_history', 'manage_customers'
    ]::text[]) THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      JOIN public.store_users AS membership
        ON membership.profile_id = profile.id
      WHERE profile.id = p_profile_id
        AND membership.store_id = p_store_id
        AND (
          profile.role::text = 'admin'
          OR (
            profile.role::text IN ('cashier', 'inventory')
            AND NOT (profile.role::text = 'inventory' AND p_capability <> 'approve_inventory_adjustment')
            AND NOT (profile.role::text = 'cashier' AND p_capability = 'approve_inventory_adjustment')
            AND EXISTS (
              SELECT 1
              FROM public.store_capability_grants AS grant_row
              WHERE grant_row.store_id = p_store_id
                AND grant_row.profile_id = p_profile_id
                AND grant_row.target_profile_id = p_profile_id
                AND grant_row.capability = p_capability
                AND grant_row.revoked_at IS NULL
            )
          )
        )
    )
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
  v_requester_role text;
  v_request public.operational_approval_requests%ROWTYPE;
  v_decision public.operational_approval_decisions%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL THEN
    PERFORM private.raise_pos_operation_error('AUTH_REQUIRED', 'Authentication is required.', '42501');
  END IF;
  IF NOT private.mfa_session_is_valid() THEN
    PERFORM private.raise_pos_operation_error('MFA_REQUIRED', 'A valid MFA session is required.', '42501');
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

  SELECT profile.role::text INTO v_requester_role
  FROM public.profiles AS profile
  JOIN public.store_users AS membership ON membership.profile_id = profile.id
  WHERE membership.store_id = p_store_id AND profile.id = v_request.requester_id;
  IF NOT FOUND
    OR (v_request.kind = 'inventory_adjustment' AND v_requester_role NOT IN ('admin', 'inventory'))
    OR (v_request.kind = 'cash_movement' AND v_requester_role NOT IN ('admin', 'cashier'))
    OR (v_request.kind = 'wallet_adjustment' AND v_requester_role IS DISTINCT FROM 'admin') THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'The requester no longer has authority for this store operation.', '42501');
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

  IF v_request.kind = 'inventory_adjustment'
    AND NOT private.profile_has_store_capability(
      p_store_id, v_decision.actor_id, 'approve_inventory_adjustment'
    ) THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'The approver no longer has the active inventory approval capability.', '42501');
  ELSIF v_request.kind = 'cash_movement'
    AND NOT private.profile_has_store_capability(
      p_store_id, v_decision.actor_id, 'approve_cash_adjustment'
    ) THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'The approver no longer has the active cash approval capability.', '42501');
  ELSIF v_request.kind = 'wallet_adjustment'
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles AS approver
      JOIN public.store_users AS membership ON membership.profile_id = approver.id
      WHERE membership.store_id = p_store_id
        AND approver.id = v_decision.actor_id
        AND approver.role::text = 'admin'
    ) THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'Wallet adjustment approval is restricted to a current store administrator.', '42501');
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

REVOKE ALL ON FUNCTION private.profile_has_store_capability(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.assert_operational_approval_applicable(uuid, uuid, uuid, text, bigint)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.profile_has_store_capability(uuid, uuid, text) IS
  'Checks current profile role, live store membership, and active capability without trusting a client-supplied actor.';
COMMENT ON FUNCTION private.assert_operational_approval_applicable(uuid, uuid, uuid, text, bigint) IS
  'Apply-time guard revalidates the requester and approver membership, active capability, approved proposal, and expected resource version.';
