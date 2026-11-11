DO $test$
DECLARE
  v_table regclass;
  v_signature regprocedure;
  v_public_functions regprocedure[] := ARRAY[
    'public.create_customer(jsonb)'::regprocedure,
    'public.update_customer(jsonb)'::regprocedure,
    'public.archive_customer(jsonb)'::regprocedure,
    'public.associate_sale_customer(jsonb)'::regprocedure,
    'public.search_customers(uuid,text,integer)'::regprocedure,
    'public.get_customer(uuid,uuid)'::regprocedure
  ];
  v_private_functions regprocedure[] := ARRAY[
    'private.apply_customer_command(text,jsonb)'::regprocedure,
    'private.reject_customer_sale_link_mutation()'::regprocedure
  ];
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'public.customers'::regclass,
    'public.customer_sale_links'::regclass
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
    WHERE conrelid = 'public.customers'::regclass
      AND conname = 'customers_store_id_id_unique' AND contype = 'u'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.sales'::regclass
      AND conname = 'sales_customer_same_store_fk' AND contype = 'f'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.customer_sale_links'::regclass
      AND conname = 'customer_sale_links_sale_store_fk' AND contype = 'f'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.customer_sale_links'::regclass
      AND conname = 'customer_sale_links_customer_store_fk' AND contype = 'f'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.customer_sale_links'::regclass
      AND conname = 'customer_sale_links_operation_store_fk' AND contype = 'f'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.customer_sale_links'::regclass
      AND conname = 'customer_sale_links_one_effective_customer' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'Customer store scope, sale link, operation, or uniqueness constraints are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.customer_sale_links'::regclass
      AND trigger_row.tgname = 'customer_sale_links_immutable'
      AND NOT trigger_row.tgisinternal AND trigger_row.tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'Customer sale link history must reject update, delete, and truncate';
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
      RAISE EXCEPTION '% must remain private to database functions', v_signature;
    END IF;
  END LOOP;
END
$test$;

SELECT 'T43 customer schema catalog checks OK' AS result;
