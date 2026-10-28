-- Run as the database owner after the security hardening migration.
-- All synthetic identities, stores, sales, and audit events are rolled back.
-- AAL values below are simulated JWT claims, not Auth-issued MFA sessions.
BEGIN;

DO $test$
DECLARE
  v_tag text := 'SECURITY_FIX_' || replace(gen_random_uuid()::text, '-', '');
  v_admin uuid := gen_random_uuid();
  v_other_admin uuid := gen_random_uuid();
  v_cashier uuid := gen_random_uuid();
  v_inventory uuid := gen_random_uuid();
  v_other_cashier uuid := gen_random_uuid();
  v_mfa_admin uuid := gen_random_uuid();
  v_store_a uuid := gen_random_uuid();
  v_store_b uuid := gen_random_uuid();
  v_category uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_sale uuid := gen_random_uuid();
  v_aal1_name text := v_tag || '_mfa_aal1';
  v_aal2_name text := v_tag || '_mfa_aal2';
  v_plain_admin_name text := v_tag || '_unenrolled_admin';
  v_new_store_id uuid;
  v_attempt record;
  v_rejected boolean;
  v_error text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES
    (v_admin, lower(v_tag) || '_admin@example.invalid', jsonb_build_object('name', v_tag || ' Admin')),
    (v_other_admin, lower(v_tag) || '_other_admin@example.invalid', jsonb_build_object('name', v_tag || ' Other Admin')),
    (v_cashier, lower(v_tag) || '_cashier@example.invalid', jsonb_build_object('name', v_tag || ' Cashier')),
    (v_inventory, lower(v_tag) || '_inventory@example.invalid', jsonb_build_object('name', v_tag || ' Inventory')),
    (v_other_cashier, lower(v_tag) || '_other_cashier@example.invalid', jsonb_build_object('name', v_tag || ' Other Cashier')),
    (v_mfa_admin, lower(v_tag) || '_mfa_admin@example.invalid', jsonb_build_object('name', v_tag || ' MFA Admin'));

  UPDATE public.profiles SET role = 'admin' WHERE id IN (v_admin, v_other_admin, v_mfa_admin);
  UPDATE public.profiles SET role = 'cashier' WHERE id IN (v_cashier, v_other_cashier);
  UPDATE public.profiles SET role = 'inventory' WHERE id = v_inventory;

  INSERT INTO public.stores (id, name, address, tax_rate, owner_id)
  VALUES
    (v_store_a, v_tag || '_Store_A', '', 0, v_admin),
    (v_store_b, v_tag || '_Store_B', '', 0, v_other_admin);

  INSERT INTO public.store_users (store_id, profile_id)
  VALUES
    (v_store_a, v_admin),
    (v_store_a, v_cashier),
    (v_store_a, v_inventory),
    (v_store_a, v_mfa_admin),
    (v_store_b, v_other_admin),
    (v_store_b, v_other_cashier);

  INSERT INTO public.categories (id, name, store_id, owner_id)
  VALUES (v_category, v_tag || '_Category', v_store_a, v_admin);

  INSERT INTO public.products (id, name, sku, category_id, store_id, cost_price, selling_price, current_stock)
  VALUES (v_product, v_tag || '_Product', v_tag || '_SKU', v_category, v_store_a, 5, 10, 10);

  INSERT INTO auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at, secret)
  VALUES (gen_random_uuid(), v_mfa_admin, 'totp', 'verified', now(), now(), 'synthetic-test-factor-not-a-real-secret');

  -- DB16: the existing shared store authorization helper rejects an enrolled
  -- account while its simulated JWT remains at AAL1.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_mfa_admin, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF public.user_belongs_to_store(v_store_a) THEN
    RAISE EXCEPTION 'DB16 failed: enrolled AAL1 account passed store authorization';
  END IF;

  -- DB17: the database RPC itself must reject the same session and leave no
  -- store or membership behind.
  v_rejected := false;
  BEGIN
    PERFORM public.create_store_with_owner(v_aal1_name, 'synthetic', 0);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := SQLSTATE = '42501';
    v_error := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'DB17 failed: enrolled AAL1 store creation was accepted (error: %)', v_error;
  END IF;
  IF EXISTS (SELECT 1 FROM public.stores WHERE name = v_aal1_name)
     OR EXISTS (
       SELECT 1 FROM public.store_users su
       JOIN public.stores s ON s.id = su.store_id
       WHERE s.name = v_aal1_name OR (su.profile_id = v_mfa_admin AND s.owner_id = v_mfa_admin AND s.name = v_aal1_name)
     ) THEN
    RAISE EXCEPTION 'DB17 failed: rejected AAL1 request left store or ownership rows';
  END IF;

  -- DB18: the same enrolled admin succeeds at AAL2 and becomes the owner and
  -- member of exactly the newly created store.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_mfa_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF NOT public.user_belongs_to_store(v_store_a) THEN
    RAISE EXCEPTION 'DB18 failed: enrolled AAL2 account did not pass store authorization';
  END IF;
  PERFORM public.create_store_with_owner(v_aal2_name, 'synthetic', 0);
  EXECUTE 'RESET ROLE';
  SELECT s.id INTO v_new_store_id
  FROM public.stores s
  WHERE s.name = v_aal2_name AND s.owner_id = v_mfa_admin;
  IF v_new_store_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.store_users su
    WHERE su.store_id = v_new_store_id AND su.profile_id = v_mfa_admin
  ) THEN
    RAISE EXCEPTION 'DB18 failed: AAL2 store was not atomically owned by its admin';
  END IF;

  -- The policy still allows an admin without an enrolled factor at AAL1.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.create_store_with_owner(v_plain_admin_name, 'synthetic', 0);
  EXECUTE 'RESET ROLE';
  IF NOT EXISTS (
    SELECT 1 FROM public.stores s
    JOIN public.store_users su ON su.store_id = s.id AND su.profile_id = v_admin
    WHERE s.name = v_plain_admin_name AND s.owner_id = v_admin
  ) THEN
    RAISE EXCEPTION 'Store creation failed for an admin without enrolled MFA';
  END IF;

  -- Unprivileged business roles remain unable to create stores.
  FOR v_attempt IN
    SELECT * FROM (VALUES
      (v_cashier, 'cashier'::text, 'cashier'),
      (v_inventory, 'inventory'::text, 'inventory')
    ) AS attempts(user_id, role_name, suffix)
  LOOP
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_attempt.user_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_rejected := false;
    BEGIN
      PERFORM public.create_store_with_owner(v_tag || '_unauthorized_' || v_attempt.suffix, 'synthetic', 0);
    EXCEPTION WHEN OTHERS THEN
      v_rejected := SQLSTATE = '42501';
    END;
    EXECUTE 'RESET ROLE';
    IF NOT v_rejected OR EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.name = v_tag || '_unauthorized_' || v_attempt.suffix
    ) THEN
      RAISE EXCEPTION 'Unauthorized % role created a store', v_attempt.role_name;
    END IF;
  END LOOP;

  -- DB20: anonymous callers have no RPC execution grant, and no event is
  -- written when the direct call is rejected.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  v_rejected := false;
  BEGIN
    PERFORM public.log_audit_event(NULL, 'validation.anonymous', 'security_regression', NULL,
      jsonb_build_object('validation_id', v_tag, 'case', 'anonymous'));
  EXCEPTION WHEN OTHERS THEN
    v_rejected := SQLSTATE = '42501';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_rejected OR EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE details ->> 'validation_id' = v_tag AND details ->> 'case' = 'anonymous'
  ) THEN
    RAISE EXCEPTION 'DB20 failed: anonymous audit call was accepted or left a record';
  END IF;

  -- Authenticated clients cannot forge arbitrary audit events either, even
  -- when the caller belongs to the store.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_cashier, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_rejected := false;
  BEGIN
    PERFORM public.log_audit_event(v_store_a, 'validation.direct', 'security_regression', NULL,
      jsonb_build_object('validation_id', v_tag, 'case', 'authenticated_direct'));
  EXCEPTION WHEN OTHERS THEN
    v_rejected := SQLSTATE = '42501';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_rejected OR EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE details ->> 'validation_id' = v_tag AND details ->> 'case' = 'authenticated_direct'
  ) THEN
    RAISE EXCEPTION 'Authenticated caller directly inserted an audit event';
  END IF;

  -- Defense in depth: even when run as the function owner, the function body
  -- rejects an authenticated identity recording an event for another store.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_other_cashier, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  v_rejected := false;
  BEGIN
    PERFORM public.log_audit_event(v_store_a, 'validation.cross_store', 'security_regression', NULL,
      jsonb_build_object('validation_id', v_tag, 'case', 'cross_store'));
  EXCEPTION WHEN OTHERS THEN
    v_rejected := SQLSTATE = '42501';
    v_error := SQLERRM;
  END;
  IF NOT v_rejected OR EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE details ->> 'validation_id' = v_tag AND details ->> 'case' = 'cross_store'
  ) THEN
    RAISE EXCEPTION 'Audit function accepted an out-of-scope actor (error: %)', v_error;
  END IF;

  -- A normal POS business operation still writes an accurate audit event from
  -- its SECURITY DEFINER call path, with the authenticated cashier as actor.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_cashier, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.process_pos_sale_v4(
    v_sale, v_store_a, v_cashier, 20, 0, 0, 20, 50, 30,
    jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 2)), 'cash'
  );
  EXECUTE 'RESET ROLE';
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs al
    WHERE al.store_id = v_store_a
      AND al.actor_id = v_cashier
      AND al.action = 'sale.completed'
      AND al.entity_type = 'sale'
      AND al.entity_id = v_sale
  ) THEN
    RAISE EXCEPTION 'Nested POS operation did not write an accurate audit event';
  END IF;

  -- Trusted server-side callers keep their explicit service_role grant and
  -- may create system events without an end-user actor.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM public.log_audit_event(v_store_a, 'validation.server', 'security_regression', NULL,
    jsonb_build_object('validation_id', v_tag, 'case', 'service_role'));
  EXECUTE 'RESET ROLE';
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs al
    WHERE al.store_id = v_store_a
      AND al.actor_id IS NULL
      AND al.action = 'validation.server'
      AND al.details ->> 'validation_id' = v_tag
      AND al.details ->> 'case' = 'service_role'
  ) THEN
    RAISE EXCEPTION 'Trusted service-role audit event was not recorded';
  END IF;

  IF has_function_privilege('anon', 'public.log_audit_event(uuid,text,text,uuid,jsonb)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.log_audit_event(uuid,text,text,uuid,jsonb)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.log_audit_event(uuid,text,text,uuid,jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'Audit function execution grants do not match the intended trust boundary';
  END IF;

  IF has_function_privilege('anon', 'public.create_store_with_owner(text,text,numeric)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous callers can still execute store creation';
  END IF;
END;
$test$;

ROLLBACK;
SELECT 'PASS: store MFA assurance, store-create authorization, audit scope, grants, and nested logging' AS result;
