DO $test$
DECLARE
  v_table text;
  v_relation regclass;
  v_signature regprocedure;
  v_tables text[] := ARRAY[
    'public.store_settings',
    'public.store_capability_grants',
    'public.operational_approval_requests',
    'public.operational_approval_decisions',
    'public.operational_approval_applications'
  ];
  v_public_functions regprocedure[] := ARRAY[
    'public.list_store_capability_grants(uuid)'::regprocedure,
    'public.grant_store_capability(uuid,uuid,text,text)'::regprocedure,
    'public.revoke_store_capability(uuid,uuid,text)'::regprocedure,
    'public.request_operational_approval(jsonb)'::regprocedure,
    'public.decide_operational_approval(jsonb)'::regprocedure
  ];
  v_private_functions regprocedure[] := ARRAY[
    'private.assert_store_capability(uuid,text)'::regprocedure,
    'private.assert_store_admin(uuid)'::regprocedure,
    'private.assert_store_feature_enabled(uuid,text)'::regprocedure,
    'private.profile_has_store_capability(uuid,uuid,text)'::regprocedure,
    'private.jsonb_object_key_count(jsonb)'::regprocedure,
    'private.approval_proposal_is_valid(text,uuid,jsonb)'::regprocedure,
    'private.assert_operational_approval_applicable(uuid,uuid,uuid,text,bigint)'::regprocedure,
    'private.record_operational_approval_application(uuid,uuid,uuid,uuid,text,bigint,bigint)'::regprocedure
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    v_relation := pg_catalog.to_regclass(v_table);
    IF v_relation IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class AS relation
      WHERE relation.oid = v_relation AND relation.relrowsecurity
    ) THEN
      RAISE EXCEPTION '% must exist with row-level security enabled', v_table;
    END IF;
    IF pg_catalog.has_table_privilege('anon', v_relation, 'SELECT')
      OR pg_catalog.has_table_privilege('authenticated', v_relation, 'SELECT')
      OR pg_catalog.has_table_privilege('service_role', v_relation, 'SELECT')
      OR pg_catalog.has_table_privilege('authenticated', v_relation, 'INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION '% must not be directly accessible to API roles', v_table;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY v_public_functions LOOP
    IF NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
      OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc AS procedure
        WHERE procedure.oid = v_signature
          AND procedure.prosecdef
          AND procedure.proconfig @> ARRAY['search_path=""']::text[]
      ) THEN
      RAISE EXCEPTION '% must be a blank-search-path definer available only to authenticated clients', v_signature;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY v_private_functions LOOP
    IF pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION '% must remain private to database functions', v_signature;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_row.indexrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = index_relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND index_relation.relname = 'store_capability_grants_active_unique'
      AND index_row.indisunique AND index_row.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Active store capability uniqueness must be enforced by a partial unique index';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.store_capability_grants'::regclass
      AND conname = 'store_capability_grants_membership_fk'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.operational_approval_requests'::regclass
      AND conname = 'operational_approval_requests_proposal_typed'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.operational_approval_decisions'::regclass
      AND conname = 'operational_approval_decisions_request_unique'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.operational_approval_applications'::regclass
      AND conname = 'operational_approval_applications_request_unique'
  ) THEN
    RAISE EXCEPTION 'Capability membership or approval integrity constraints are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.store_users'::regclass
      AND trigger_row.tgname = 'store_users_revoke_capabilities_before_delete'
      AND NOT trigger_row.tgisinternal AND trigger_row.tgenabled = 'O'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.operational_approval_requests'::regclass
      AND trigger_row.tgname = 'operational_approval_requests_consistent'
      AND trigger_row.tgdeferrable AND trigger_row.tginitdeferred
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.operational_approval_decisions'::regclass
      AND trigger_row.tgname = 'operational_approval_decisions_immutable'
      AND NOT trigger_row.tgisinternal AND trigger_row.tgenabled = 'O'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.operational_approval_applications'::regclass
      AND trigger_row.tgname = 'operational_approval_applications_immutable'
      AND NOT trigger_row.tgisinternal AND trigger_row.tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'Membership revocation or immutable approval history triggers are missing';
  END IF;

  IF private.store_feature_flags_valid('{"operations_v2":false,"approval_workflows":false}'::jsonb) IS DISTINCT FROM true
    OR private.store_feature_flags_valid('{"approval_workflows":"true"}'::jsonb) IS DISTINCT FROM false
    OR private.store_feature_flags_valid('{"unchecked_privilege":true}'::jsonb) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Store feature flag validator must accept supported booleans and reject invalid keys or types';
  END IF;
END
$test$;

SELECT 'T03 capability and approval catalog checks OK' AS result;
