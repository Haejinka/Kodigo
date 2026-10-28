-- Apply after the root migration_40 chain. Migration 36 historically defines
-- create_store_with_owner before the MFA assurance helpers were added.

CREATE OR REPLACE FUNCTION public.create_store_with_owner(
  p_name text,
  p_address text,
  p_tax_rate numeric
)
RETURNS public.stores
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_new_store public.stores%ROWTYPE;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = '42501';
  END IF;

  -- current_user_role applies private.mfa_session_is_valid(), preserving the
  -- existing admin-only store-creation permission and opt-in MFA policy.
  IF public.current_user_role() IS DISTINCT FROM 'admin'::public.user_role THEN
    RAISE EXCEPTION 'Only admins can create stores'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.stores (name, address, tax_rate, owner_id)
  VALUES (p_name, p_address, p_tax_rate, (SELECT auth.uid()))
  RETURNING * INTO v_new_store;

  INSERT INTO public.store_users (store_id, profile_id)
  VALUES (v_new_store.id, (SELECT auth.uid()));

  RETURN v_new_store;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_store_with_owner(text, text, numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_store_with_owner(text, text, numeric)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_store_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
  v_actor_id uuid;
  v_jwt_role text;
BEGIN
  v_actor_id := (SELECT auth.uid());

  IF v_actor_id IS NULL THEN
    v_jwt_role := (SELECT auth.jwt() ->> 'role');
    IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Authentication required'
        USING ERRCODE = '42501';
    END IF;
  ELSIF p_store_id IS NULL OR NOT public.user_belongs_to_store(p_store_id) THEN
    RAISE EXCEPTION 'User is not assigned to this store'
      USING ERRCODE = '42501';
  END IF;

  -- actor_id is always taken from the verified request identity. Only trusted
  -- service-role calls may create system events without an end-user actor.
  INSERT INTO public.audit_logs (store_id, actor_id, action, entity_type, entity_id, details)
  VALUES (
    p_store_id,
    v_actor_id,
    p_action,
    p_entity_type,
    p_entity_id,
    COALESCE(p_details, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- Business RPCs that call this helper are SECURITY DEFINER and run as the
-- owner. Browser roles cannot create arbitrary audit entries through the RPC.
REVOKE ALL ON FUNCTION public.log_audit_event(uuid, text, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_audit_event(uuid, text, text, uuid, jsonb)
  TO service_role;
