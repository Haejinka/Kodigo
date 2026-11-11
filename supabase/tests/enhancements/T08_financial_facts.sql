DO $test$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'sale_adjustments',
    'sale_adjustment_items',
    'sale_payment_allocations',
    'legacy_financial_classifications'
  ];
  v_signature regprocedure;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = v_table
        AND relation.relkind = 'r'
        AND relation.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'T08 table % must exist with RLS enabled.', v_table;
    END IF;
    IF pg_catalog.has_table_privilege('anon', 'public.' || v_table, 'SELECT')
      OR pg_catalog.has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
      OR pg_catalog.has_table_privilege('service_role', 'public.' || v_table, 'SELECT')
      OR pg_catalog.has_table_privilege('anon', 'public.' || v_table, 'INSERT')
      OR pg_catalog.has_table_privilege('anon', 'public.' || v_table, 'UPDATE')
      OR pg_catalog.has_table_privilege('anon', 'public.' || v_table, 'DELETE')
      OR pg_catalog.has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
      OR pg_catalog.has_table_privilege('authenticated', 'public.' || v_table, 'UPDATE')
      OR pg_catalog.has_table_privilege('authenticated', 'public.' || v_table, 'DELETE')
      OR pg_catalog.has_table_privilege('service_role', 'public.' || v_table, 'INSERT')
      OR pg_catalog.has_table_privilege('service_role', 'public.' || v_table, 'UPDATE')
      OR pg_catalog.has_table_privilege('service_role', 'public.' || v_table, 'DELETE') THEN
      RAISE EXCEPTION 'T08 table % must not be directly accessible to API roles.', v_table;
    END IF;
  END LOOP;

  v_signature := 'public.get_sale_financial_facts(uuid)'::regprocedure;
  IF NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
    OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'Sale financial facts must be callable by authenticated users only.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid = v_signature
      AND proc.prosecdef
      AND proc.proconfig @> ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'Public financial fact reader must use a blank-search-path definer.';
  END IF;

  v_signature := 'private.create_sale_credit(uuid,uuid,uuid,text,text,uuid,text,uuid,jsonb)'::regprocedure;
  IF pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'Sale credit writer must remain private to future guarded workflows.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_row.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'sale_adjustments'
      AND trigger_row.tgname = 'sale_adjustments_total_matches_lines'
      AND trigger_row.tgdeferrable
      AND trigger_row.tginitdeferred
      AND trigger_row.tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'Sale adjustment header/line reconciliation trigger is missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.sale_payments'::regclass
      AND conname = 'sale_payments_new_event_shape'
      AND contype = 'c'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.sale_adjustment_items'::regclass
      AND conname = 'sale_adjustment_items_sale_line_fk'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'T08 payment sign or same-sale source constraints are missing.';
  END IF;
END;
$test$;

SELECT 'T08 financial facts schema and grants catalog check OK' AS result;
