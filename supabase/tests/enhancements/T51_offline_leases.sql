DO $test$
DECLARE
  v_table regclass;
  v_signature regprocedure;
  v_public_functions regprocedure[] := ARRAY[
    'public.issue_offline_lease(jsonb)'::regprocedure,
    'public.revoke_offline_lease(jsonb)'::regprocedure,
    'public.get_offline_lease(uuid,uuid)'::regprocedure
  ];
  v_private_functions regprocedure[] := ARRAY[
    'private.guard_offline_authorization_lease()'::regprocedure,
    'private.prevent_offline_authorization_lease_event_mutation()'::regprocedure
  ];
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'public.terminal_sync_cursors'::regclass,
    'public.offline_authorization_leases'::regclass,
    'public.offline_authorization_lease_events'::regclass
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class AS relation
      WHERE relation.oid = v_table AND relation.relrowsecurity
    ) THEN
      RAISE EXCEPTION '% must have row-level security enabled', v_table;
    END IF;
    IF pg_catalog.has_table_privilege('anon', v_table, 'SELECT,INSERT,UPDATE,DELETE')
      OR pg_catalog.has_table_privilege('authenticated', v_table, 'SELECT,INSERT,UPDATE,DELETE')
      OR pg_catalog.has_table_privilege('service_role', v_table, 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION '% must not be directly accessible to API roles', v_table;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.offline_authorization_leases'::regclass
      AND conname = 'offline_authorization_leases_store_shift_fkey' AND contype = 'f'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.offline_authorization_leases'::regclass
      AND conname = 'offline_authorization_leases_issue_operation_fkey' AND contype = 'f'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.offline_authorization_leases'::regclass
      AND conname = 'offline_authorization_leases_times_check' AND contype = 'c'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.offline_authorization_leases'::regclass
      AND conname = 'offline_authorization_leases_snapshot_check' AND contype = 'c'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS index_name ON index_name.oid = index_row.indexrelid
    WHERE index_row.indrelid = 'public.offline_authorization_leases'::regclass
      AND index_name.relname = 'offline_authorization_leases_terminal_pending_active_uidx'
      AND index_row.indisunique AND index_row.indisvalid
  ) THEN
    RAISE EXCEPTION 'Offline lease scope, bound, lifecycle, or uniqueness constraints are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.offline_authorization_leases'::regclass
      AND trigger_row.tgname = 'offline_authorization_lease_lifecycle_guard'
      AND NOT trigger_row.tgisinternal AND trigger_row.tgenabled = 'O'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.offline_authorization_lease_events'::regclass
      AND trigger_row.tgname = 'offline_authorization_lease_events_append_only'
      AND NOT trigger_row.tgisinternal AND trigger_row.tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'Offline lease identity and event history must be protected by lifecycle triggers';
  END IF;

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
      RAISE EXCEPTION '% must remain private to database triggers', v_signature;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.store_settings AS settings
    WHERE COALESCE((settings.feature_flags->>'offline_escrow')::boolean, false)
  ) THEN
    RAISE EXCEPTION 'T51 must not enable offline escrow';
  END IF;
END
$test$;

SELECT 'T51 offline lease schema catalog checks OK' AS result;
