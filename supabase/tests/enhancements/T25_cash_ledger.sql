-- T25 catalog assertions only. This script reads catalogs and does not create
-- shifts, movements, holds, payment links, or operation records.
DO $test$
DECLARE
  v_table text;
  v_missing text[];
  v_function record;
  v_open_shift_definition text;
BEGIN
  SELECT array_agg(expected.name ORDER BY expected.name)
  INTO v_missing
  FROM unnest(ARRAY[
    'cash_movements', 'cash_reservations', 'cash_reservation_events',
    'payment_cash_links', 'payment_service_links'
  ]) AS expected(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
    WHERE schema.nspname = 'public'
      AND relation.relname = expected.name
      AND relation.relkind = 'r'
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'T25 relations are missing: %', v_missing;
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'cash_movements', 'cash_reservations', 'cash_reservation_events',
    'payment_cash_links', 'payment_service_links'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
      WHERE schema.nspname = 'public' AND relation.relname = v_table AND relation.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS is disabled on public.%', v_table;
    END IF;
    IF pg_catalog.has_table_privilege('anon', 'public.' || v_table, 'SELECT')
      OR pg_catalog.has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
      OR pg_catalog.has_table_privilege('service_role', 'public.' || v_table, 'SELECT') THEN
      RAISE EXCEPTION 'An API role has direct read access to public.%', v_table;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_row.conrelid
    JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
    WHERE schema.nspname = 'public' AND relation.relname = 'cash_movements'
      AND constraint_row.conname = 'cash_movements_balance_arithmetic'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_row.conrelid
    JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
    WHERE schema.nspname = 'public' AND relation.relname = 'cash_movements'
      AND constraint_row.conname = 'cash_movements_operation_source_unique'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_row.indexrelid
    JOIN pg_catalog.pg_class AS relation ON relation.oid = index_row.indrelid
    JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
    WHERE schema.nspname = 'public' AND relation.relname = 'cash_reservations'
      AND index_relation.relname = 'cash_reservations_one_active_source_uidx'
      AND index_row.indisunique AND index_row.indisvalid AND index_row.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'T25 ledger arithmetic, idempotency, or active-source uniqueness constraint is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_row.tgrelid
    JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
    WHERE schema.nspname = 'public' AND relation.relname = 'cash_movements'
      AND trigger_row.tgname = 'cash_movements_append_only' AND NOT trigger_row.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_row.tgrelid
    JOIN pg_catalog.pg_namespace AS schema ON schema.oid = relation.relnamespace
    WHERE schema.nspname = 'public' AND relation.relname = 'cash_reservation_events'
      AND trigger_row.tgname = 'cash_reservation_events_append_only' AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'T25 append-only protection is missing';
  END IF;

  SELECT pg_catalog.pg_get_functiondef('public.open_cashier_shift(jsonb)'::regprocedure)
  INTO v_open_shift_definition;
  IF v_open_shift_definition NOT LIKE '%private.post_cash_movement%'
    OR v_open_shift_definition NOT LIKE '%opening_movement_id%' THEN
    RAISE EXCEPTION 'Shift opening does not post and return the positive opening movement';
  END IF;

  SELECT procedure_row.proname, procedure_row.prosecdef, procedure_row.proconfig,
    pg_catalog.has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE') AS authenticated_exec,
    pg_catalog.has_function_privilege('anon', procedure_row.oid, 'EXECUTE') AS anon_exec,
    pg_catalog.has_function_privilege('service_role', procedure_row.oid, 'EXECUTE') AS service_exec
  INTO v_function
  FROM pg_catalog.pg_proc AS procedure_row
  JOIN pg_catalog.pg_namespace AS schema ON schema.oid = procedure_row.pronamespace
  WHERE schema.nspname = 'public' AND procedure_row.proname = 'get_cashier_shift_position'
    AND procedure_row.proargtypes = '2950'::oidvector;
  IF NOT FOUND OR NOT v_function.prosecdef OR v_function.proconfig IS NULL
    OR NOT ('search_path=""' = ANY(v_function.proconfig))
    OR NOT v_function.authenticated_exec OR v_function.anon_exec OR v_function.service_exec THEN
    RAISE EXCEPTION 'Cash position read RPC is not a guarded blank-search-path authenticated definer';
  END IF;

  FOR v_function IN
    SELECT procedure_row.oid::regprocedure AS signature
    FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS schema ON schema.oid = procedure_row.pronamespace
    WHERE schema.nspname = 'private'
      AND procedure_row.proname IN (
        'cashier_shift_cash_position', 'post_cash_movement', 'reserve_cash',
        'consume_cash_reservation', 'release_cash_reservation'
      )
      AND (
        pg_catalog.has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('service_role', procedure_row.oid, 'EXECUTE')
      )
  LOOP
    RAISE EXCEPTION 'Private cash helper is exposed to an API role: %', v_function.signature;
  END LOOP;
END;
$test$;
