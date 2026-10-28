-- Rollback-only regression coverage for storeless error notification isolation.
-- JWT claims are simulated database context; this is not an HTTP or Auth sign-in test.
BEGIN;

DO $test$
DECLARE
  v_tag text := 'ERROR_SCOPE_' || replace(gen_random_uuid()::text, '-', '');
  v_admin uuid := gen_random_uuid();
  v_other_admin uuid := gen_random_uuid();
  v_store uuid := gen_random_uuid();
  v_global_error_id uuid;
  v_scoped_error_id uuid;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES
    (v_admin, lower(v_tag) || '_admin@example.invalid', jsonb_build_object('name', v_tag || ' Admin')),
    (v_other_admin, lower(v_tag) || '_other@example.invalid', jsonb_build_object('name', v_tag || ' Other Admin'));

  UPDATE public.profiles SET role = 'admin' WHERE id IN (v_admin, v_other_admin);

  INSERT INTO public.stores (id, name, address, tax_rate, owner_id)
  VALUES (v_store, v_tag || '_Store', '', 0, v_admin);

  INSERT INTO public.store_users (store_id, profile_id)
  VALUES (v_store, v_admin);

  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_admin, 'role', 'authenticated', 'aal', 'aal1'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  IF public.notification_visible_to_user(NULL, ARRAY['admin']::text[], 'system_error') THEN
    RAISE EXCEPTION 'Unscoped system errors must not be visible to tenant admins';
  END IF;

  IF NOT public.notification_visible_to_user(NULL, ARRAY['admin']::text[], 'report_export_completed') THEN
    RAISE EXCEPTION 'Non-error global notifications should retain their existing role visibility';
  END IF;

  IF NOT public.notification_visible_to_user(v_store, ARRAY['admin']::text[], 'system_error') THEN
    RAISE EXCEPTION 'A store admin should retain visibility of errors scoped to their store';
  END IF;

  v_global_error_id := public.log_client_error(
    'test', v_tag || '_global', NULL, '{}'::jsonb, NULL
  );
  IF EXISTS (
    SELECT 1 FROM public.notifications
    WHERE source_table = 'error_logs' AND source_id = v_global_error_id
  ) THEN
    RAISE EXCEPTION 'A storeless error log created a broadcast notification';
  END IF;

  v_scoped_error_id := public.log_client_error(
    'test', v_tag || '_scoped', NULL, '{}'::jsonb, v_store
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE source_table = 'error_logs'
      AND source_id = v_scoped_error_id
      AND store_id = v_store
      AND target_roles = ARRAY['admin']::text[]
  ) THEN
    RAISE EXCEPTION 'A store-scoped error should still create a notification for that store';
  END IF;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_other_admin, 'role', 'authenticated', 'aal', 'aal1'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  IF public.notification_visible_to_user(v_store, ARRAY['admin']::text[], 'system_error') THEN
    RAISE EXCEPTION 'A tenant admin outside the store must not see its error notification';
  END IF;

  EXECUTE 'RESET ROLE';
END;
$test$;

ROLLBACK;
