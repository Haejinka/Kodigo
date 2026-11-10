-- Read-only assertions for the T04 schema and live shadow snapshot.
DO $t04$
DECLARE
  v_table_name text;
  v_rls_enabled boolean;
  v_column_type text;
  v_invalid_reconciliation_count bigint;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'inventory_locations',
    'inventory_balances',
    'inventory_lot_location_balances',
    'inventory_movement_lots',
    'inventory_cutovers'
  ] LOOP
    SELECT relation.relrowsecurity
    INTO v_rls_enabled
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = v_table_name;

    IF v_rls_enabled IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'T04 table public.% must have row-level security enabled', v_table_name;
    END IF;

    IF pg_catalog.has_table_privilege('anon', 'public.' || v_table_name, 'SELECT')
      OR pg_catalog.has_table_privilege('anon', 'public.' || v_table_name, 'INSERT')
      OR pg_catalog.has_table_privilege('authenticated', 'public.' || v_table_name, 'SELECT')
      OR pg_catalog.has_table_privilege('authenticated', 'public.' || v_table_name, 'INSERT')
      OR pg_catalog.has_table_privilege('authenticated', 'public.' || v_table_name, 'UPDATE')
      OR pg_catalog.has_table_privilege('authenticated', 'public.' || v_table_name, 'DELETE')
      OR pg_catalog.has_table_privilege('service_role', 'public.' || v_table_name, 'SELECT')
      OR pg_catalog.has_table_privilege('service_role', 'public.' || v_table_name, 'INSERT') THEN
      RAISE EXCEPTION 'T04 table public.% must not be directly accessible to API roles', v_table_name;
    END IF;
  END LOOP;

  IF pg_catalog.has_function_privilege('anon', 'private.inventory_shadow_reconciliation(uuid)', 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', 'private.inventory_shadow_reconciliation(uuid)', 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', 'private.inventory_shadow_reconciliation(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T04 reconciliation helper must remain private to trusted database execution';
  END IF;

  SELECT pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
  INTO v_column_type
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.inventory_stock_lots'::regclass
    AND attribute.attname = 'unit_cost'
    AND NOT attribute.attisdropped;
  IF v_column_type IS DISTINCT FROM 'numeric(14,6)' THEN
    RAISE EXCEPTION 'T04 must preserve six-decimal receipt-lot costs, found %', v_column_type;
  END IF;

  SELECT pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
  INTO v_column_type
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.sale_items'::regclass
    AND attribute.attname = 'cost_per_base_unit'
    AND NOT attribute.attisdropped;
  IF v_column_type IS DISTINCT FROM 'numeric(12,4)' THEN
    RAISE EXCEPTION 'T04 must preserve legacy sale-line cost precision, found %', v_column_type;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.stores AS store
    LEFT JOIN public.inventory_locations AS location
      ON location.store_id = store.id
     AND location.is_default
     AND location.is_active
    GROUP BY store.id
    HAVING count(DISTINCT location.kind) <> 2
  ) THEN
    RAISE EXCEPTION 'Each store must have active default sellable and quarantine locations';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.inventory_stock_lots AS lot
    WHERE lot.location_id IS NULL OR lot.status IS NULL
  ) THEN
    RAISE EXCEPTION 'Every source lot must retain its location and legacy status label';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.inventory_movements AS movement
    WHERE movement.provenance IS DISTINCT FROM 'legacy'
  ) THEN
    RAISE EXCEPTION 'T04 must not rewrite or synthesize legacy movement provenance';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sale_item_stock_allocations AS allocation
    WHERE allocation.counter_provenance IS DISTINCT FROM 'legacy'
  ) THEN
    RAISE EXCEPTION 'T04 must leave legacy allocation counters classified as legacy';
  END IF;

  IF EXISTS (SELECT 1 FROM public.inventory_cutovers)
    OR EXISTS (
      SELECT 1 FROM public.inventory_movements AS movement
      WHERE movement.provenance = 'baseline'
    ) THEN
    RAISE EXCEPTION 'T04 must not enable cutover or fabricate opening movements';
  END IF;

  SELECT count(*)
  INTO v_invalid_reconciliation_count
  FROM private.inventory_shadow_reconciliation(NULL) AS reconciliation
  WHERE reconciliation.mismatch_reasons IS NULL
     OR EXISTS (
       SELECT 1
       FROM unnest(reconciliation.mismatch_reasons) AS reason(value)
       WHERE reason.value NOT IN (
         'shadow_balance_missing',
         'product_vs_shadow_balance',
         'product_vs_source_lots',
         'source_lots_vs_lot_location_balances',
         'source_lot_count_vs_location_balance_count'
       )
     );
  IF v_invalid_reconciliation_count <> 0 THEN
    RAISE EXCEPTION 'T04 reconciliation must report every discrepancy with a typed reason';
  END IF;
END;
$t04$;

SELECT count(*) AS products_checked,
       count(*) FILTER (WHERE cardinality(reconciliation.mismatch_reasons) > 0) AS products_with_reported_mismatches,
       count(*) FILTER (WHERE reconciliation.shadow_balance_missing) AS products_missing_shadow_balances,
       sum(reconciliation.source_lot_count) AS source_lots_checked,
       sum(reconciliation.lot_location_count) AS lots_with_location_balances
FROM private.inventory_shadow_reconciliation(NULL) AS reconciliation;

SELECT provenance, count(*) AS movement_rows
FROM public.inventory_movements
GROUP BY provenance
ORDER BY provenance;

SELECT counter_provenance, count(*) AS allocation_rows
FROM public.sale_item_stock_allocations
GROUP BY counter_provenance
ORDER BY counter_provenance;
