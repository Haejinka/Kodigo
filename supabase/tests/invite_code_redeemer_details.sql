-- Rollback-only coverage for the RPC's privileged identity lookup.
BEGIN;
DO $test$
DECLARE
  v_tag text := 'REDEEMER_' || replace(gen_random_uuid()::text, '-', '');
  v_actor uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_used uuid := gen_random_uuid();
  v_active uuid := gen_random_uuid();
  v_missing uuid := gen_random_uuid();
  v_foreign uuid := gen_random_uuid();
  v_legacy uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (v_actor, lower(v_tag) || '_actor@example.invalid', jsonb_build_object('name', v_tag)),
    (v_other, lower(v_tag) || '_other@example.invalid', jsonb_build_object('name', v_tag)),
    (v_admin, lower(v_tag) || '_admin@example.invalid', jsonb_build_object('name', v_tag || ' Admin'));
  UPDATE public.profiles SET role = 'super_admin' WHERE id IN (v_actor, v_other);
  UPDATE public.profiles SET role = 'admin' WHERE id = v_admin;

  INSERT INTO public.invite_codes (id, code, created_by, is_used, used_by, used_at) VALUES
    (v_used, v_tag || '_used', v_actor, true, v_admin, now()),
    (v_active, v_tag || '_active', v_actor, false, NULL, NULL),
    (v_missing, v_tag || '_missing', v_actor, true, NULL, now()),
    (v_foreign, v_tag || '_foreign', v_other, true, v_admin, now()),
    (v_legacy, v_tag || '_legacy', NULL, true, v_admin, now());

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_actor, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF NOT EXISTS (
    SELECT 1 FROM public.list_invite_codes_with_redeemers()
    WHERE id = v_used AND redeemer_name = v_tag || ' Admin'
      AND redeemer_email = lower(v_tag) || '_admin@example.invalid' AND used_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Own used code must include redeemer name, email and time';
  END IF;
  IF EXISTS (SELECT 1 FROM public.list_invite_codes_with_redeemers() WHERE id = v_foreign) THEN
    RAISE EXCEPTION 'Another super admin code leaked';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.list_invite_codes_with_redeemers() WHERE id = v_legacy) THEN
    RAISE EXCEPTION 'Legacy visibility changed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.list_invite_codes_with_redeemers()
    WHERE id = v_missing AND is_used AND redeemer_name IS NULL AND redeemer_email IS NULL
  ) THEN
    RAISE EXCEPTION 'Used code without an account link must remain visible';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.list_invite_codes_with_redeemers()
    WHERE id = v_active AND NOT is_used AND redeemer_name IS NULL AND redeemer_email IS NULL
  ) THEN
    RAISE EXCEPTION 'Active code must remain visible without a redeemer';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_admin) THEN
    RAISE EXCEPTION 'RPC must not broaden direct profile access';
  END IF;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM * FROM public.list_invite_codes_with_redeemers();
    RAISE EXCEPTION 'Regular admin was allowed to read redemption identities';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '{}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM * FROM public.list_invite_codes_with_redeemers();
    RAISE EXCEPTION 'Missing user identity was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  EXECUTE 'RESET ROLE';
  IF has_function_privilege('anon', 'public.list_invite_codes_with_redeemers()', 'EXECUTE')
    OR has_function_privilege('anon', 'private.list_invite_codes_with_redeemers()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous execution must be revoked';
  END IF;
END;
$test$;
ROLLBACK;
