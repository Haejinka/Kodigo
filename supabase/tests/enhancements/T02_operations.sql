DO $test$
DECLARE
  v_operations_rls boolean;
  v_events_rls boolean;
  v_finish_signature regprocedure;
  v_begin_signature regprocedure;
  v_get_signature regprocedure;
  v_assert_signature regprocedure;
BEGIN
  SELECT relation.relrowsecurity
  INTO v_operations_rls
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public' AND relation.relname = 'pos_operations';
  IF v_operations_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'pos_operations must exist with row-level security enabled';
  END IF;

  SELECT relation.relrowsecurity
  INTO v_events_rls
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public' AND relation.relname = 'pos_operation_events';
  IF v_events_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'pos_operation_events must exist with row-level security enabled';
  END IF;

  IF pg_catalog.has_table_privilege('anon', 'public.pos_operations', 'SELECT')
    OR pg_catalog.has_table_privilege('authenticated', 'public.pos_operations', 'SELECT')
    OR pg_catalog.has_table_privilege('service_role', 'public.pos_operations', 'SELECT')
    OR pg_catalog.has_table_privilege('authenticated', 'public.pos_operations', 'INSERT')
    OR pg_catalog.has_table_privilege('authenticated', 'public.pos_operations', 'UPDATE')
    OR pg_catalog.has_table_privilege('authenticated', 'public.pos_operations', 'DELETE')
    OR pg_catalog.has_table_privilege('anon', 'public.pos_operation_events', 'SELECT')
    OR pg_catalog.has_table_privilege('authenticated', 'public.pos_operation_events', 'SELECT')
    OR pg_catalog.has_table_privilege('service_role', 'public.pos_operation_events', 'SELECT')
    OR pg_catalog.has_table_privilege('authenticated', 'public.pos_operation_events', 'INSERT')
    OR pg_catalog.has_table_privilege('authenticated', 'public.pos_operation_events', 'UPDATE')
    OR pg_catalog.has_table_privilege('authenticated', 'public.pos_operation_events', 'DELETE') THEN
    RAISE EXCEPTION 'Operation tables must not be directly readable by API roles';
  END IF;

  v_begin_signature := 'private.begin_pos_operation(text,jsonb)'::regprocedure;
  v_finish_signature := 'private.finish_pos_operation(uuid,uuid,text,text,text,text,text,bigint,jsonb)'::regprocedure;
  v_get_signature := 'public.get_pos_operation(uuid,uuid)'::regprocedure;
  v_assert_signature := 'private.assert_pos_operation_committed()'::regprocedure;
  IF pg_catalog.has_function_privilege('authenticated', v_begin_signature, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_finish_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'Private operation helpers must not be executable by authenticated clients';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', v_get_signature, 'EXECUTE')
    OR pg_catalog.has_function_privilege('anon', v_get_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'get_pos_operation must be granted only to authenticated clients';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid = v_get_signature
      AND proc.prosecdef
      AND proc.proconfig @> ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'get_pos_operation must be a blank-search-path security definer';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid = v_assert_signature
      AND proc.prosecdef
      AND proc.proconfig @> ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'Deferred operation integrity trigger must read through a blank-search-path security definer';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_assert_signature, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_assert_signature, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', v_assert_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'Deferred operation integrity trigger must not be directly executable by API roles';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trg
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trg.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'pos_operation_events'
      AND trg.tgname = 'pos_operation_events_append_only'
      AND NOT trg.tgisinternal
      AND trg.tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'Operation lifecycle events must be protected by the append-only trigger';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trg
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trg.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'pos_operations'
      AND trg.tgname = 'pos_operations_identity_immutable'
      AND NOT trg.tgisinternal
      AND trg.tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'Operation identity and committed results must be immutable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trg
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trg.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'pos_operations'
      AND trg.tgname = 'pos_operations_must_commit_with_response'
      AND NOT trg.tgisinternal
      AND trg.tgdeferrable
      AND trg.tginitdeferred
  ) THEN
    RAISE EXCEPTION 'A processing operation must not be allowed to commit without its response';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS idx
    JOIN pg_catalog.pg_class AS relation ON relation.oid = idx.indexrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'pos_operations_terminal_sequence_unique'
      AND idx.indisunique
      AND idx.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Terminal sequence uniqueness must be partial and unique';
  END IF;
END
$test$;

SELECT 'T02 operation schema and grants catalog check OK' AS result;
