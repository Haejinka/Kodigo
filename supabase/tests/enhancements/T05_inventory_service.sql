-- Read-only assertions for the private T05 writer layer on a deployed schema.
-- Write-path, rollback and concurrency behavior require an isolated database.
DO $t05$
DECLARE
  v_name text;
  v_signature text;
  v_function_count integer;
  v_security_definer boolean;
  v_source text;
  v_empty_search_path boolean;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'apply_inventory_movement',
    'allocate_sale_lots',
    'restore_allocation_slices',
    'transfer_inventory',
    'dispose_quarantined_stock'
  ] LOOP
    v_signature := 'private.' || v_name || '(jsonb)';
    SELECT count(*)::integer, bool_and(routine.prosecdef),
           bool_and(routine.proconfig @> ARRAY['search_path=""'])
    INTO v_function_count, v_security_definer, v_empty_search_path
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'private'
      AND routine.proname = v_name
      AND pg_catalog.pg_get_function_identity_arguments(routine.oid) = 'p_command jsonb';

    IF v_function_count <> 1 OR v_security_definer IS DISTINCT FROM true
      OR v_empty_search_path IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'T05 helper % must be a single SECURITY DEFINER function with an empty search path', v_signature;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'T05 helper % must not be directly executable by API roles', v_signature;
    END IF;

    SELECT pg_catalog.pg_get_functiondef(routine.oid)
    INTO v_source
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'private' AND routine.proname = v_name
      AND pg_catalog.pg_get_function_identity_arguments(routine.oid) = 'p_command jsonb';
    IF pg_catalog.strpos(v_source, 'status = ''complete''') = 0 THEN
      RAISE EXCEPTION 'T05 helper % must remain gated until inventory cutover is complete', v_signature;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'sale_item_stock_allocations_operation_source_uidx'
      AND indexdef LIKE '%(store_id, source_operation_id, source_line_key)%'
  ) THEN
    RAISE EXCEPTION 'T05 sale allocation idempotency index is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'inventory_movements_operation_source_uidx'
      AND indexdef LIKE '%(operation_id, source_line_key, location_id, movement_type)%'
  ) THEN
    RAISE EXCEPTION 'T05 movement idempotency index is missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname IN ('sale_items', 'sales', 'stock_adjustments')
      AND NOT trigger.tgisinternal
      AND pg_catalog.pg_get_triggerdef(trigger.oid) ILIKE '%private.apply_inventory_movement%'
  ) THEN
    RAISE EXCEPTION 'T05 helpers must remain disconnected until the T06 writer cutover';
  END IF;

END;
$t05$;

SELECT proname, prosecdef, proconfig
FROM pg_catalog.pg_proc AS routine
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
WHERE namespace.nspname = 'private'
  AND routine.proname IN (
    'apply_inventory_movement', 'allocate_sale_lots', 'restore_allocation_slices',
    'transfer_inventory', 'dispose_quarantined_stock'
  )
ORDER BY proname;
