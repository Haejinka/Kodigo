-- Read-only T24 catalog assertions. Mutation and two-connection custody tests
-- must run only on an explicitly identified isolated database.
DO $t24$
DECLARE
  v_table_name text;
  v_relation regclass;
  v_signature regprocedure;
  v_tables text[] := ARRAY[
    'public.pos_terminals',
    'public.cash_drawers',
    'public.cashier_shifts'
  ];
  v_public_functions regprocedure[] := ARRAY[
    'public.register_pos_terminal(jsonb)'::regprocedure,
    'public.register_cash_drawer(jsonb)'::regprocedure,
    'public.list_store_cash_custody(uuid)'::regprocedure,
    'public.open_cashier_shift(jsonb)'::regprocedure
  ];
  v_indexes text[] := ARRAY[
    'cashier_shifts_one_active_drawer_uidx',
    'cashier_shifts_one_active_cashier_uidx'
  ];
  v_index_name text;
BEGIN
  FOREACH v_table_name IN ARRAY v_tables LOOP
    v_relation := pg_catalog.to_regclass(v_table_name);
    IF v_relation IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class AS relation
      WHERE relation.oid = v_relation AND relation.relrowsecurity
    ) THEN
      RAISE EXCEPTION '% must exist with row-level security enabled', v_table_name;
    END IF;
    IF pg_catalog.has_table_privilege('anon', v_relation, 'SELECT,INSERT,UPDATE,DELETE')
      OR pg_catalog.has_table_privilege('authenticated', v_relation, 'SELECT,INSERT,UPDATE,DELETE')
      OR pg_catalog.has_table_privilege('service_role', v_relation, 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION '% must not be directly accessible to API roles', v_table_name;
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
      RAISE EXCEPTION '% must be a blank-search-path definer available only to authenticated callers', v_signature;
    END IF;
  END LOOP;

  FOREACH v_index_name IN ARRAY v_indexes LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_index AS index_row
      JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_row.indexrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = index_relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND index_relation.relname = v_index_name
        AND index_row.indisunique
        AND index_row.indpred IS NOT NULL
        AND index_row.indisvalid
    ) THEN
      RAISE EXCEPTION 'Partial active-custody uniqueness index % is missing or invalid', v_index_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.pos_operations'::regclass
      AND conname = 'pos_operations_store_terminal_fkey'
      AND convalidated
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.pos_operations'::regclass
      AND conname = 'pos_operations_store_shift_fkey'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'Operation terminal and shift references must enforce same-store custody';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.cashier_shifts'::regclass
      AND trigger_row.tgname = 'cashier_shifts_lifecycle_guard'
      AND NOT trigger_row.tgisinternal AND trigger_row.tgenabled = 'O'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.cashier_shifts'::regclass
      AND trigger_row.tgname = 'cashier_shifts_membership_guard'
      AND NOT trigger_row.tgisinternal AND trigger_row.tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'Shift identity/lifecycle and store-membership guards must be enabled';
  END IF;

  IF private.store_feature_flags_valid('{"drawer_shifts":false}'::jsonb) IS DISTINCT FROM true
    OR private.store_feature_flags_valid('{"unreviewed_cash_feature":true}'::jsonb) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'T24 must use the existing typed drawer_shifts feature flag allowlist';
  END IF;
END;
$t24$;

SELECT 'T24 drawer, terminal, and shift catalog checks OK' AS result;
