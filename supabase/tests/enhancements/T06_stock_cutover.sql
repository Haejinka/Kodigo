-- Read-only catalog and release-gate assertions for the deployed T06 schema.
-- Write-path, rollback, replay, and lock-order checks require an isolated DB.
DO $t06$
DECLARE
  v_signature regprocedure;
  v_source text;
  v_table regclass := pg_catalog.to_regclass('public.inventory_cutover_items');
  v_public_functions regprocedure[] := ARRAY[
    'public.prepare_inventory_cutover(jsonb)'::regprocedure,
    'public.get_inventory_cutover_preview(uuid)'::regprocedure,
    'public.get_inventory_ledger_status(uuid)'::regprocedure,
    'public.complete_inventory_cutover(jsonb)'::regprocedure,
    'public.get_inventory_product_balance(uuid,uuid)'::regprocedure,
    'public.process_pos_sale_v5(jsonb)'::regprocedure,
    'public.receive_product_stock_v2(jsonb)'::regprocedure,
    'public.create_product_v2(jsonb)'::regprocedure,
    'public.request_inventory_adjustment(jsonb)'::regprocedure,
    'public.apply_inventory_adjustment(jsonb)'::regprocedure,
    'public.adjust_inventory_stock(uuid,uuid,numeric,text,text)'::regprocedure,
    'public.receive_product_stock(uuid,uuid,numeric,text,numeric,numeric,text,uuid,text)'::regprocedure,
    'public.restock_product_inventory_v2(uuid,uuid,numeric,text,numeric,numeric,text)'::regprocedure,
    'public.restock_product_inventory(uuid,numeric,text,numeric,numeric,text)'::regprocedure,
    'public.void_pos_sale(uuid,text)'::regprocedure,
    'public.return_sale_items(uuid,jsonb,text,public.payment_method,text)'::regprocedure
  ];
  v_private_functions regprocedure[] := ARRAY[
    'private.build_inventory_cutover_snapshot(uuid)'::regprocedure,
    'private.refresh_inventory_cutover_shadow(uuid)'::regprocedure,
    'private.apply_manual_inventory_adjustment(public.pos_operations,uuid,uuid,numeric,public.adjustment_reason,text,bigint,uuid,timestamp with time zone)'::regprocedure,
    'private.assert_inventory_movement_source_scope()'::regprocedure,
    'private.assert_operational_approval_applicable(uuid,uuid,uuid,text,bigint)'::regprocedure
  ];
BEGIN
  IF v_table IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = v_table AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'T06 immutable cutover item relation must exist with RLS enabled';
  END IF;
  IF pg_catalog.has_table_privilege('anon', v_table, 'SELECT,INSERT,UPDATE,DELETE')
    OR pg_catalog.has_table_privilege('authenticated', v_table, 'SELECT,INSERT,UPDATE,DELETE')
    OR pg_catalog.has_table_privilege('service_role', v_table, 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'Cutover item snapshots must not be directly accessible to API roles';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = v_table AND conname = 'inventory_cutover_items_zero_has_no_movement_check'
  ) THEN
    RAISE EXCEPTION 'Zero-stock cutover items must not create fake baseline movements';
  END IF;

  FOREACH v_signature IN ARRAY v_public_functions LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS procedure
      WHERE procedure.oid = v_signature AND procedure.prosecdef
        AND procedure.proconfig @> ARRAY['search_path=""']::text[]
    ) OR NOT pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'T06 API % must be a blank-search-path definer available only to authenticated clients', v_signature;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY v_private_functions LOOP
    IF pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
      OR pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'T06 helper % must remain private to database functions', v_signature;
    END IF;
  END LOOP;

  SELECT pg_catalog.pg_get_functiondef('public.complete_inventory_cutover(jsonb)'::regprocedure)
  INTO v_source;
  IF pg_catalog.strpos(v_source, 'inventory_ledger_v2') = 0
    OR pg_catalog.strpos(v_source, '"approval_workflows":true') <> 0
    OR pg_catalog.strpos(v_source, 'inventory_cutover_items') = 0 THEN
    RAISE EXCEPTION 'Cutover must persist the baseline, enable inventory only, and leave shared approval workflows closed';
  END IF;
  SELECT pg_catalog.pg_get_functiondef('public.request_operational_approval(jsonb)'::regprocedure)
  INTO v_source;
  IF pg_catalog.strpos(v_source, 'inventory_ledger_v2') = 0
    OR pg_catalog.strpos(v_source, 'approval_workflows') = 0 THEN
    RAISE EXCEPTION 'Inventory and shared approval kinds must use their distinct feature gates';
  END IF;
  SELECT pg_catalog.pg_get_functiondef('public.receive_product_stock_v2(jsonb)'::regprocedure)
  INTO v_source;
  IF pg_catalog.strpos(v_source, 'COALESCE((SELECT profile.role::text') = 0
    OR pg_catalog.strpos(v_source, 'purchase_total') = 0
    OR pg_catalog.strpos(v_source, 'jsonb_typeof') = 0 THEN
    RAISE EXCEPTION 'Stock receipt must fail closed for missing roles and validate its purchase cost as JSON';
  END IF;

  SELECT pg_catalog.pg_get_functiondef('private.restore_sale_stock_lots_after_void()'::regprocedure)
  INTO v_source;
  IF pg_catalog.strpos(v_source, 'kodigo.pos_operation_id') = 0
    OR pg_catalog.strpos(v_source, 'status = ''processing''') = 0 THEN
    RAISE EXCEPTION 'Post-cutover legacy void restoration must fail closed outside a current command';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.inventory_cutovers AS cutover
    WHERE cutover.status = 'complete'
  ) OR EXISTS (
    SELECT 1 FROM public.store_settings AS setting
    WHERE COALESCE((setting.feature_flags->>'inventory_ledger_v2')::boolean, false)
  ) THEN
    RAISE EXCEPTION 'Schema-only T06 deployment must not perform production inventory cutover';
  END IF;
END;
$t06$;

SELECT 'T06 catalog and release-gate checks passed' AS result;
