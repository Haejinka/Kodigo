-- T05: private, cutover-gated inventory mutation services.
-- These helpers do not replace legacy writers; T06 owns the guarded cutover.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION private.apply_inventory_movement(p_command jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_store_id uuid;
  v_product_id uuid;
  v_location_id uuid;
  v_operation_id uuid;
  v_source_line_key text;
  v_movement_type text;
  v_origin text;
  v_reason_code text;
  v_delta_raw numeric;
  v_delta numeric(12,3);
  v_expected_version bigint;
  v_slices jsonb;
  v_sale_id uuid;
  v_sale_item_id uuid;
  v_return_id uuid;
  v_return_item_id uuid;
  v_void_id uuid;
  v_adjustment_id uuid;
  v_compensates_movement_id uuid;
  v_transfer_group_id uuid;
  v_cutover_id uuid;
  v_approved_by uuid;
  v_approved_at timestamptz;
  v_terminal_id uuid;
  v_local_occurred_at timestamptz;
  v_unit_label text;
  v_product public.products%ROWTYPE;
  v_operation public.pos_operations%ROWTYPE;
  v_balance public.inventory_balances%ROWTYPE;
  v_location public.inventory_locations%ROWTYPE;
  v_existing public.inventory_movements%ROWTYPE;
  v_lot public.inventory_stock_lots%ROWTYPE;
  v_slice record;
  v_lock record;
  v_movement_id uuid;
  v_stock_after numeric(14,3);
  v_lot_after numeric(14,3);
  v_owned boolean := false;
  v_consigned boolean := false;
  v_source text;
  v_slice_count integer;
  v_expected_slice_total numeric(14,3);
  v_actual_slice_total numeric(14,3);
BEGIN
  IF p_command IS NULL OR pg_catalog.jsonb_typeof(p_command) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Inventory movement command must be a JSON object';
  END IF;

  v_store_id := NULLIF(p_command->>'store_id', '')::uuid;
  v_product_id := NULLIF(p_command->>'product_id', '')::uuid;
  v_location_id := NULLIF(p_command->>'location_id', '')::uuid;
  v_operation_id := NULLIF(p_command->>'operation_id', '')::uuid;
  v_source_line_key := NULLIF(p_command->>'source_line_key', '');
  v_movement_type := NULLIF(p_command->>'movement_type', '');
  v_origin := NULLIF(p_command->>'origin', '');
  v_reason_code := NULLIF(pg_catalog.btrim(p_command->>'reason_code'), '');
  v_delta_raw := NULLIF(p_command->>'quantity_delta', '')::numeric;
  v_expected_version := NULLIF(p_command->>'expected_balance_version', '')::bigint;
  v_slices := p_command->'slices';
  v_sale_id := NULLIF(p_command->>'sale_id', '')::uuid;
  v_sale_item_id := NULLIF(p_command->>'sale_item_id', '')::uuid;
  v_return_id := NULLIF(p_command->>'return_id', '')::uuid;
  v_return_item_id := NULLIF(p_command->>'return_item_id', '')::uuid;
  v_void_id := NULLIF(p_command->>'void_id', '')::uuid;
  v_adjustment_id := NULLIF(p_command->>'adjustment_id', '')::uuid;
  v_compensates_movement_id := NULLIF(p_command->>'compensates_movement_id', '')::uuid;
  v_transfer_group_id := NULLIF(p_command->>'transfer_group_id', '')::uuid;
  v_cutover_id := NULLIF(p_command->>'cutover_id', '')::uuid;
  v_approved_by := NULLIF(p_command->>'approved_by', '')::uuid;
  v_approved_at := NULLIF(p_command->>'approved_at', '')::timestamptz;
  v_terminal_id := NULLIF(p_command->>'terminal_id', '')::uuid;
  v_local_occurred_at := NULLIF(p_command->>'local_occurred_at', '')::timestamptz;
  v_unit_label := NULLIF(pg_catalog.btrim(p_command->>'unit_label'), '');

  IF v_store_id IS NULL OR v_product_id IS NULL OR v_location_id IS NULL
    OR v_operation_id IS NULL OR v_source_line_key IS NULL
    OR v_source_line_key !~ '^[A-Za-z0-9:_./-]{1,160}$'
    OR v_expected_version IS NULL OR v_expected_version < 1
    OR v_movement_type IS NULL OR v_movement_type NOT IN (
      'sale', 'offline_sale', 'return_restock', 'return_quarantine', 'void_restore',
      'transfer_in', 'transfer_out', 'manual_adjustment', 'restock', 'quarantine_disposal'
    )
    OR v_origin IS NULL OR v_origin NOT IN ('automatic', 'manual', 'offline')
    OR v_reason_code IS NULL OR v_unit_label IS NULL
    OR v_delta_raw IS NULL OR v_delta_raw = 0
    OR v_delta_raw <> pg_catalog.round(v_delta_raw, 3)
    OR pg_catalog.abs(v_delta_raw) <> pg_catalog.trunc(pg_catalog.abs(v_delta_raw))
    OR pg_catalog.abs(v_delta_raw) > 999999999.999
    OR pg_catalog.jsonb_typeof(v_slices) IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(v_slices) = 0 THEN
    RAISE EXCEPTION 'Inventory movement command has missing or invalid fields';
  END IF;
  v_delta := v_delta_raw::numeric(12,3);
  IF (v_movement_type IN ('sale', 'offline_sale', 'transfer_out', 'quarantine_disposal') AND v_delta >= 0)
    OR (v_movement_type IN ('return_restock', 'return_quarantine', 'void_restore', 'transfer_in', 'restock')
      AND v_delta <= 0)
    OR (v_movement_type IN ('transfer_in', 'transfer_out') AND v_transfer_group_id IS NULL)
    OR (v_origin = 'offline' AND (v_movement_type <> 'offline_sale' OR v_operation_id IS NULL)) THEN
    RAISE EXCEPTION 'Inventory movement type, sign, and source metadata disagree';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(v_slices)
      AS slice(lot_id uuid, quantity_delta numeric, source_allocation_id uuid, source_slice_key text)
    WHERE slice.lot_id IS NULL OR slice.quantity_delta IS NULL OR slice.quantity_delta = 0
      OR slice.quantity_delta <> pg_catalog.round(slice.quantity_delta, 3)
      OR pg_catalog.abs(slice.quantity_delta) <> pg_catalog.trunc(pg_catalog.abs(slice.quantity_delta))
      OR slice.source_slice_key IS NULL OR pg_catalog.btrim(slice.source_slice_key) = ''
      OR (v_delta < 0 AND slice.quantity_delta >= 0)
      OR (v_delta > 0 AND slice.quantity_delta <= 0)
  ) THEN
    RAISE EXCEPTION 'Inventory movement lot slices are invalid';
  END IF;

  SELECT count(*)::integer, COALESCE(sum(slice.quantity_delta), 0)::numeric(14,3)
  INTO v_slice_count, v_expected_slice_total
  FROM pg_catalog.jsonb_to_recordset(v_slices)
    AS slice(lot_id uuid, quantity_delta numeric, source_allocation_id uuid, source_slice_key text);
  IF v_slice_count = 0 OR v_expected_slice_total <> v_delta THEN
    RAISE EXCEPTION 'Inventory movement lot slices must equal the balance delta';
  END IF;
  IF v_slice_count <> (
    SELECT count(DISTINCT slice.source_slice_key)::integer
    FROM pg_catalog.jsonb_to_recordset(v_slices)
      AS slice(lot_id uuid, quantity_delta numeric, source_allocation_id uuid, source_slice_key text)
  ) THEN
    RAISE EXCEPTION 'Movement slices must have unique source keys';
  END IF;
  IF v_movement_type IN ('sale', 'offline_sale', 'return_restock', 'return_quarantine', 'void_restore')
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_to_recordset(v_slices)
        AS slice(lot_id uuid, quantity_delta numeric, source_allocation_id uuid, source_slice_key text)
      WHERE slice.source_allocation_id IS NULL
    ) THEN
    RAISE EXCEPTION 'Sale, return, and void movements require exact source allocations';
  END IF;
  IF (v_movement_type IN ('sale', 'offline_sale') AND (v_sale_id IS NULL OR v_sale_item_id IS NULL))
    OR (v_movement_type IN ('return_restock', 'return_quarantine')
      AND (v_sale_id IS NULL OR v_sale_item_id IS NULL OR v_return_id IS NULL OR v_return_item_id IS NULL))
    OR (v_movement_type = 'void_restore'
      AND (v_sale_id IS NULL OR v_sale_item_id IS NULL OR v_void_id IS NULL)) THEN
    RAISE EXCEPTION 'Inventory movement source aggregate is incomplete';
  END IF;

  SELECT operation.* INTO v_operation
  FROM public.pos_operations AS operation
  WHERE operation.id = v_operation_id AND operation.store_id = v_store_id
  FOR UPDATE;
  IF NOT FOUND OR v_operation.status <> 'processing'
    OR v_operation.actor_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'Inventory movement requires the active authenticated operation';
  END IF;
  IF (v_origin = 'offline') IS DISTINCT FROM (v_operation.source = 'offline')
    OR (v_movement_type = 'offline_sale' AND v_origin <> 'offline')
    OR (v_origin = 'offline' AND v_movement_type <> 'offline_sale') THEN
    RAISE EXCEPTION 'Offline inventory movement origin does not match its operation';
  END IF;

  SELECT movement.* INTO v_existing
  FROM public.inventory_movements AS movement
  WHERE movement.operation_id = v_operation_id
    AND movement.source_line_key = v_source_line_key
    AND movement.location_id = v_location_id
    AND movement.movement_type = v_movement_type;
  IF FOUND THEN
    IF v_existing.product_id IS DISTINCT FROM v_product_id
      OR v_existing.quantity_delta IS DISTINCT FROM v_delta
      OR v_existing.sale_id IS DISTINCT FROM v_sale_id
      OR v_existing.sale_item_id IS DISTINCT FROM v_sale_item_id THEN
      RAISE EXCEPTION 'Inventory movement operation key was reused with different facts';
    END IF;
    SELECT COALESCE(sum(slice.quantity_delta), 0)::numeric(14,3)
    INTO v_actual_slice_total
    FROM public.inventory_movement_lots AS slice
    WHERE slice.store_id = v_store_id AND slice.movement_id = v_existing.id;
    IF v_actual_slice_total <> v_delta OR (
      SELECT count(*) FROM public.inventory_movement_lots AS slice
      WHERE slice.store_id = v_store_id AND slice.movement_id = v_existing.id
    ) <> v_slice_count OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_to_recordset(v_slices)
        AS requested(lot_id uuid, quantity_delta numeric, source_allocation_id uuid, source_slice_key text)
      LEFT JOIN public.inventory_movement_lots AS stored
        ON stored.store_id = v_store_id AND stored.movement_id = v_existing.id
       AND stored.lot_id = requested.lot_id AND stored.source_slice_key = requested.source_slice_key
      WHERE stored.id IS NULL OR stored.quantity_delta <> requested.quantity_delta
        OR stored.source_allocation_id IS DISTINCT FROM requested.source_allocation_id
    ) THEN
      RAISE EXCEPTION 'Inventory movement replay changed its source lot slices';
    END IF;
    RETURN v_existing.id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_cutovers AS cutover
    WHERE cutover.store_id = v_store_id AND cutover.status = 'complete'
  ) THEN
    RAISE EXCEPTION 'Inventory writes are disabled until store cutover is complete';
  END IF;

  SELECT product.* INTO v_product
  FROM public.products AS product
  WHERE product.store_id = v_store_id AND product.id = v_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product is outside the operation store'; END IF;
  SELECT location.* INTO v_location
  FROM public.inventory_locations AS location
  WHERE location.store_id = v_store_id AND location.id = v_location_id
    AND location.is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inventory location is outside the operation store or inactive'; END IF;

  INSERT INTO public.inventory_balances (store_id, product_id, location_id, provenance)
  VALUES (v_store_id, v_product_id, v_location_id, 'live')
  ON CONFLICT (store_id, product_id, location_id) DO NOTHING;
  SELECT balance.* INTO v_balance
  FROM public.inventory_balances AS balance
  WHERE balance.store_id = v_store_id AND balance.product_id = v_product_id
    AND balance.location_id = v_location_id
  FOR UPDATE;
  IF NOT FOUND OR v_balance.provenance <> 'live' THEN
    RAISE EXCEPTION 'Inventory balance has not completed live cutover';
  END IF;
  IF v_balance.version <> v_expected_version THEN
    RAISE EXCEPTION 'Inventory balance version conflict: expected %, found %',
      v_expected_version, v_balance.version;
  END IF;
  IF v_delta < 0 AND v_balance.quantity_on_hand - v_balance.quantity_reserved_offline
      - v_balance.quantity_reserved_online < pg_catalog.abs(v_delta) THEN
    RAISE EXCEPTION 'Inventory movement exceeds unreserved on-hand stock';
  END IF;
  v_stock_after := v_balance.quantity_on_hand + v_delta;
  IF v_stock_after < 0 OR v_stock_after <> pg_catalog.trunc(v_stock_after)
    OR v_stock_after > 999999999.999 THEN
    RAISE EXCEPTION 'Inventory movement would create an invalid product projection';
  END IF;

  INSERT INTO public.inventory_lot_location_balances
    (store_id, lot_id, location_id, provenance)
  SELECT v_store_id, slice.lot_id, v_location_id, 'live'
  FROM pg_catalog.jsonb_to_recordset(v_slices)
    AS slice(lot_id uuid, quantity_delta numeric, source_allocation_id uuid, source_slice_key text)
  WHERE slice.quantity_delta > 0
  ON CONFLICT (store_id, lot_id, location_id) DO NOTHING;

  -- Balance rows are locked by lot id, then source lots by FIFO order, then
  -- source allocations by id, matching the documented A02 order.
  FOR v_lock IN
    SELECT lot_balance.id
    FROM public.inventory_lot_location_balances AS lot_balance
    JOIN pg_catalog.jsonb_to_recordset(v_slices)
      AS slice(lot_id uuid, quantity_delta numeric, source_allocation_id uuid, source_slice_key text)
      ON slice.lot_id = lot_balance.lot_id
    WHERE lot_balance.store_id = v_store_id AND lot_balance.location_id = v_location_id
    ORDER BY lot_balance.lot_id
    FOR UPDATE OF lot_balance
  LOOP
    NULL;
  END LOOP;
  FOR v_lock IN
    SELECT lot.id
    FROM public.inventory_stock_lots AS lot
    JOIN pg_catalog.jsonb_to_recordset(v_slices)
      AS slice(lot_id uuid, quantity_delta numeric, source_allocation_id uuid, source_slice_key text)
      ON slice.lot_id = lot.id
    WHERE lot.store_id = v_store_id AND lot.product_id = v_product_id
    ORDER BY lot.received_at, lot.id
    FOR UPDATE OF lot
  LOOP
    NULL;
  END LOOP;
  FOR v_lock IN
    SELECT allocation.id
    FROM public.sale_item_stock_allocations AS allocation
    JOIN pg_catalog.jsonb_to_recordset(v_slices)
      AS slice(lot_id uuid, quantity_delta numeric, source_allocation_id uuid, source_slice_key text)
      ON slice.source_allocation_id = allocation.id
    WHERE allocation.store_id = v_store_id
    ORDER BY allocation.id
    FOR UPDATE OF allocation
  LOOP
    NULL;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(v_slices)
      AS slice(lot_id uuid, quantity_delta numeric, source_allocation_id uuid, source_slice_key text)
    LEFT JOIN public.inventory_stock_lots AS lot
      ON lot.store_id = v_store_id AND lot.product_id = v_product_id AND lot.id = slice.lot_id
    LEFT JOIN public.inventory_lot_location_balances AS lot_balance
      ON lot_balance.store_id = v_store_id AND lot_balance.lot_id = slice.lot_id
     AND lot_balance.location_id = v_location_id
    WHERE lot.id IS NULL OR lot_balance.id IS NULL OR lot_balance.provenance <> 'live'
      OR (slice.quantity_delta < 0 AND lot_balance.quantity_on_hand
        - lot_balance.quantity_reserved_offline - lot_balance.quantity_reserved_online
        < pg_catalog.abs(slice.quantity_delta))
      OR (slice.source_allocation_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.sale_item_stock_allocations AS allocation
        WHERE allocation.store_id = v_store_id AND allocation.id = slice.source_allocation_id
          AND allocation.lot_id = slice.lot_id
      ))
  ) THEN
    RAISE EXCEPTION 'Inventory movement lot source is missing, unavailable, or outside scope';
  END IF;

  FOR v_slice IN
    SELECT slice.lot_id, slice.quantity_delta::numeric(14,3) AS quantity_delta,
      slice.source_allocation_id, slice.source_slice_key, lot.ownership,
      lot.supplier_id, lot.supplier_name_snapshot, lot.unit_cost
    FROM pg_catalog.jsonb_to_recordset(v_slices)
      AS slice(lot_id uuid, quantity_delta numeric, source_allocation_id uuid, source_slice_key text)
    JOIN public.inventory_stock_lots AS lot
      ON lot.store_id = v_store_id AND lot.product_id = v_product_id AND lot.id = slice.lot_id
    ORDER BY lot.received_at, lot.id
  LOOP
    UPDATE public.inventory_lot_location_balances AS lot_balance
    SET quantity_on_hand = lot_balance.quantity_on_hand + v_slice.quantity_delta,
        version = lot_balance.version + 1,
        provenance = 'live',
        observed_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    WHERE lot_balance.store_id = v_store_id AND lot_balance.lot_id = v_slice.lot_id
      AND lot_balance.location_id = v_location_id;

    SELECT COALESCE(lot_balance.quantity_on_hand, 0)::numeric(14,3)
    INTO v_lot_after
    FROM public.inventory_locations AS sellable
    LEFT JOIN public.inventory_lot_location_balances AS lot_balance
      ON lot_balance.store_id = v_store_id AND lot_balance.lot_id = v_slice.lot_id
     AND lot_balance.location_id = sellable.id
    WHERE sellable.store_id = v_store_id AND sellable.kind = 'sellable'
      AND sellable.is_default AND sellable.is_active;
    IF v_lot_after IS NULL THEN RAISE EXCEPTION 'Default sellable location is missing'; END IF;

    IF v_movement_type IN ('return_restock', 'return_quarantine', 'void_restore')
      AND (v_movement_type <> 'void_restore' OR v_void_id IS NOT NULL)
      AND (v_movement_type NOT IN ('return_restock', 'return_quarantine') OR v_return_id IS NOT NULL)
      AND v_slice.quantity_delta > 0
      AND v_slice.source_allocation_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.inventory_stock_lots AS lot
        WHERE lot.store_id = v_store_id AND lot.id = v_slice.lot_id
          AND lot.quantity_sold < v_slice.quantity_delta
      ) THEN
        RAISE EXCEPTION 'Return or void exceeds net sold quantity for source lot %', v_slice.lot_id;
      END IF;
    END IF;
    UPDATE public.inventory_stock_lots AS lot
    SET quantity_remaining = v_lot_after,
        quantity_sold = lot.quantity_sold + CASE
          WHEN v_movement_type IN ('sale', 'offline_sale') AND v_slice.quantity_delta < 0
            THEN pg_catalog.abs(v_slice.quantity_delta)
          WHEN v_slice.quantity_delta > 0 AND v_slice.source_allocation_id IS NOT NULL
            AND ((v_movement_type IN ('return_restock', 'return_quarantine') AND v_return_id IS NOT NULL)
              OR (v_movement_type = 'void_restore' AND v_void_id IS NOT NULL))
            THEN -v_slice.quantity_delta
          ELSE 0 END,
        version = lot.version + 1
    WHERE lot.store_id = v_store_id AND lot.product_id = v_product_id AND lot.id = v_slice.lot_id;

    v_owned := v_owned OR v_slice.ownership = 'store_owned';
    v_consigned := v_consigned OR v_slice.ownership = 'consigned';
  END LOOP;

  UPDATE public.inventory_balances AS balance
  SET quantity_on_hand = v_stock_after,
      version = balance.version + 1,
      provenance = 'live',
      observed_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  WHERE balance.id = v_balance.id;

  v_source := CASE
    WHEN v_owned AND v_consigned THEN 'mixed'
    WHEN v_consigned THEN 'consigned'
    ELSE 'product'
  END;
  INSERT INTO public.inventory_movements (
    store_id, product_id, product_name, selling_option_id, selling_option_label,
    unit_label, package_size, package_unit, movement_type, quantity_delta,
    stock_before, stock_after, stock_source, reference_type, reference_id, note,
    created_by, location_id, balance_id, operation_id, source_line_key,
    sale_id, sale_item_id, return_id, return_item_id, void_id, adjustment_id,
    compensates_movement_id, transfer_group_id, cutover_id, approved_by,
    approved_at, origin, reason_code, base_unit_quantity, selling_quantity,
    units_per_package_snapshot, local_occurred_at, terminal_id, sync_received_at,
    accounting_version, provenance
  ) VALUES (
    v_store_id, v_product_id, v_product.name,
    NULLIF(p_command->>'selling_option_id', '')::uuid,
    NULLIF(p_command->>'selling_option_label', ''), v_unit_label,
    NULLIF(p_command->>'package_size', '')::numeric(12,3),
    NULLIF(p_command->>'package_unit', ''), v_movement_type, v_delta,
    v_balance.quantity_on_hand, v_stock_after, v_source,
    NULLIF(p_command->>'reference_type', ''),
    NULLIF(p_command->>'reference_id', '')::uuid,
    COALESCE(p_command->>'note', ''), v_operation.actor_id,
    v_location_id, v_balance.id, v_operation_id, v_source_line_key,
    v_sale_id, v_sale_item_id, v_return_id, v_return_item_id, v_void_id,
    v_adjustment_id, v_compensates_movement_id, v_transfer_group_id,
    v_cutover_id, v_approved_by, v_approved_at, v_origin, v_reason_code,
    pg_catalog.abs(v_delta),
    NULLIF(p_command->>'selling_quantity', '')::numeric(14,3),
    NULLIF(p_command->>'units_per_package_snapshot', '')::numeric(14,3),
    COALESCE(v_local_occurred_at, v_operation.local_occurred_at, pg_catalog.clock_timestamp()),
    COALESCE(v_terminal_id, v_operation.terminal_id),
    CASE WHEN v_origin = 'offline' THEN pg_catalog.clock_timestamp() END,
    v_operation.contract_version, 'new'
  ) RETURNING id INTO v_movement_id;

  INSERT INTO public.inventory_movement_lots (
    store_id, movement_id, lot_id, source_allocation_id, source_slice_key,
    quantity_delta, ownership_snapshot, supplier_id_snapshot,
    supplier_name_snapshot, unit_cost_snapshot, cogs_recovery_amount
  )
  SELECT v_store_id, v_movement_id, slice.lot_id, slice.source_allocation_id,
    slice.source_slice_key, slice.quantity_delta::numeric(14,3), lot.ownership,
    lot.supplier_id, lot.supplier_name_snapshot, lot.unit_cost,
    CASE WHEN v_movement_type IN ('return_restock', 'void_restore')
      AND slice.quantity_delta > 0 AND slice.source_allocation_id IS NOT NULL
      THEN pg_catalog.round(slice.quantity_delta * lot.unit_cost, 2) ELSE 0 END
  FROM pg_catalog.jsonb_to_recordset(v_slices)
    AS slice(lot_id uuid, quantity_delta numeric, source_allocation_id uuid, source_slice_key text)
  JOIN public.inventory_stock_lots AS lot
    ON lot.store_id = v_store_id AND lot.product_id = v_product_id AND lot.id = slice.lot_id;

  IF v_location.kind = 'sellable' AND v_location.is_default THEN
    IF v_product.current_stock::numeric <> v_balance.quantity_on_hand THEN
      RAISE EXCEPTION 'Product stock projection disagrees with the live default balance';
    END IF;
    UPDATE public.products AS product
    SET current_stock = v_stock_after::integer, updated_at = pg_catalog.clock_timestamp()
    WHERE product.store_id = v_store_id AND product.id = v_product_id;
    PERFORM private.sync_shared_option_stock(v_product_id, v_stock_after);
  END IF;

  RETURN v_movement_id;
END;
$function$;

CREATE OR REPLACE FUNCTION private.allocate_sale_lots(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_store_id uuid := NULLIF(p_command->>'store_id', '')::uuid;
  v_sale_id uuid := NULLIF(p_command->>'sale_id', '')::uuid;
  v_sale_item_id uuid := NULLIF(p_command->>'sale_item_id', '')::uuid;
  v_operation_id uuid := NULLIF(p_command->>'operation_id', '')::uuid;
  v_location_id uuid := NULLIF(p_command->>'location_id', '')::uuid;
  v_source_line_key text := NULLIF(p_command->>'source_line_key', '');
  v_expected_balance_version bigint := NULLIF(p_command->>'expected_balance_version', '')::bigint;
  v_sale public.sales%ROWTYPE;
  v_item public.sale_items%ROWTYPE;
  v_operation public.pos_operations%ROWTYPE;
  v_location public.inventory_locations%ROWTYPE;
  v_balance public.inventory_balances%ROWTYPE;
  v_lot record;
  v_movement public.inventory_movements%ROWTYPE;
  v_lock record;
  v_allocation_id uuid;
  v_movement_id uuid;
  v_needed numeric(14,3) := 0;
  v_take numeric(14,3);
  v_total_cost numeric(16,6) := 0;
  v_owned boolean := false;
  v_consigned boolean := false;
  v_slices jsonb := '[]'::jsonb;
  v_cost_price numeric;
  v_unit_label text;
BEGIN
  IF p_command IS NULL OR pg_catalog.jsonb_typeof(p_command) IS DISTINCT FROM 'object'
    OR v_store_id IS NULL OR v_sale_id IS NULL OR v_sale_item_id IS NULL
    OR v_operation_id IS NULL OR v_location_id IS NULL OR v_expected_balance_version IS NULL
    OR v_source_line_key IS NULL OR v_source_line_key !~ '^[A-Za-z0-9:_./-]{1,160}$' THEN
    RAISE EXCEPTION 'Sale lot allocation command has missing or invalid fields';
  END IF;

  SELECT operation.* INTO v_operation
  FROM public.pos_operations AS operation
  WHERE operation.id = v_operation_id AND operation.store_id = v_store_id
  FOR UPDATE;
  IF NOT FOUND OR v_operation.status <> 'processing'
    OR v_operation.actor_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'Sale allocation requires the active authenticated operation';
  END IF;
  SELECT sale.* INTO v_sale
  FROM public.sales AS sale
  WHERE sale.id = v_sale_id AND sale.store_id = v_store_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale is outside the operation store'; END IF;
  SELECT item.* INTO v_item
  FROM public.sale_items AS item
  WHERE item.id = v_sale_item_id AND item.sale_id = v_sale_id
  FOR UPDATE;
  IF NOT FOUND OR v_item.product_id IS NULL OR v_item.base_unit_quantity <= 0
    OR v_item.base_unit_quantity <> pg_catalog.trunc(v_item.base_unit_quantity) THEN
    RAISE EXCEPTION 'Sale item has invalid base-unit quantity or scope';
  END IF;

  SELECT movement.* INTO v_movement
  FROM public.inventory_movements AS movement
  WHERE movement.operation_id = v_operation_id
    AND movement.source_line_key = v_source_line_key
    AND movement.location_id = v_location_id
    AND movement.movement_type IN ('sale', 'offline_sale');
  IF FOUND THEN
    IF v_movement.sale_id IS DISTINCT FROM v_sale_id
      OR v_movement.sale_item_id IS DISTINCT FROM v_sale_item_id
      OR v_movement.quantity_delta <> -v_item.base_unit_quantity THEN
      RAISE EXCEPTION 'Sale allocation operation key was reused with different facts';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'movement_id', v_movement.id,
      'sale_item_id', v_sale_item_id,
      'replayed', true
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_cutovers AS cutover
    WHERE cutover.store_id = v_store_id AND cutover.status = 'complete'
  ) THEN
    RAISE EXCEPTION 'Inventory writes are disabled until store cutover is complete';
  END IF;
  SELECT location.* INTO v_location
  FROM public.inventory_locations AS location
  WHERE location.store_id = v_store_id AND location.id = v_location_id
    AND location.kind = 'sellable' AND location.is_default AND location.is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sales require the active default sellable location'; END IF;
  SELECT balance.* INTO v_balance
  FROM public.inventory_balances AS balance
  WHERE balance.store_id = v_store_id AND balance.product_id = v_item.product_id
    AND balance.location_id = v_location_id
  FOR UPDATE;
  IF NOT FOUND OR v_balance.provenance <> 'live'
    OR v_balance.version <> v_expected_balance_version THEN
    RAISE EXCEPTION 'Sale inventory balance is missing, not live, or stale';
  END IF;
  v_needed := v_item.base_unit_quantity;
  IF v_balance.quantity_on_hand - v_balance.quantity_reserved_offline
      - v_balance.quantity_reserved_online < v_needed THEN
    RAISE EXCEPTION 'Sale exceeds unreserved inventory';
  END IF;

  FOR v_lock IN
    SELECT lot_balance.id
    FROM public.inventory_lot_location_balances AS lot_balance
    JOIN public.inventory_stock_lots AS lot
      ON lot.store_id = lot_balance.store_id AND lot.id = lot_balance.lot_id
    WHERE lot_balance.store_id = v_store_id AND lot.product_id = v_item.product_id
      AND lot_balance.location_id = v_location_id
      AND lot_balance.quantity_on_hand > lot_balance.quantity_reserved_offline
        + lot_balance.quantity_reserved_online
    ORDER BY lot_balance.lot_id
    FOR UPDATE OF lot_balance
  LOOP NULL; END LOOP;

  FOR v_lot IN
    SELECT lot.id, lot.ownership, lot.supplier_id, lot.unit_cost,
      lot_balance.quantity_on_hand - lot_balance.quantity_reserved_offline
        - lot_balance.quantity_reserved_online AS available
    FROM public.inventory_stock_lots AS lot
    JOIN public.inventory_lot_location_balances AS lot_balance
      ON lot_balance.store_id = lot.store_id AND lot_balance.lot_id = lot.id
     AND lot_balance.location_id = v_location_id
    WHERE lot.store_id = v_store_id AND lot.product_id = v_item.product_id
      AND lot.status = 'active'
      AND lot_balance.quantity_on_hand > lot_balance.quantity_reserved_offline
        + lot_balance.quantity_reserved_online
    ORDER BY lot.received_at, lot.id
    FOR UPDATE OF lot
  LOOP
    EXIT WHEN v_needed <= 0;
    v_take := LEAST(v_lot.available, v_needed);
    v_allocation_id := gen_random_uuid();
    INSERT INTO public.sale_item_stock_allocations (
      id, store_id, sale_item_id, lot_id, quantity_base_units, unit_cost,
      ownership, supplier_id, counter_provenance, source_operation_id, source_line_key
    ) VALUES (
      v_allocation_id, v_store_id, v_sale_item_id, v_lot.id, v_take, v_lot.unit_cost,
      v_lot.ownership, v_lot.supplier_id, 'new', v_operation_id,
      v_source_line_key || '/lot/' || v_lot.id::text
    );
    v_slices := v_slices || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'lot_id', v_lot.id,
      'quantity_delta', -v_take,
      'source_allocation_id', v_allocation_id,
      'source_slice_key', v_allocation_id::text
    ));
    v_total_cost := v_total_cost + (v_take * v_lot.unit_cost);
    v_owned := v_owned OR v_lot.ownership = 'store_owned';
    v_consigned := v_consigned OR v_lot.ownership = 'consigned';
    v_needed := v_needed - v_take;
  END LOOP;
  IF v_needed > 0 THEN
    RAISE EXCEPTION 'Inventory ownership lots are short by % base units for product %',
      v_needed, v_item.product_id;
  END IF;

  v_unit_label := COALESCE(NULLIF(v_item.base_unit_label, ''),
    NULLIF(v_item.unit_label, ''), 'unit');
  v_movement_id := private.apply_inventory_movement(pg_catalog.jsonb_build_object(
    'store_id', v_store_id,
    'product_id', v_item.product_id,
    'location_id', v_location_id,
    'operation_id', v_operation_id,
    'source_line_key', v_source_line_key,
    'movement_type', CASE WHEN v_operation.source = 'offline' THEN 'offline_sale' ELSE 'sale' END,
    'origin', CASE WHEN v_operation.source = 'offline' THEN 'offline' ELSE 'automatic' END,
    'reason_code', 'sale',
    'quantity_delta', -v_item.base_unit_quantity,
    'expected_balance_version', v_expected_balance_version,
    'unit_label', v_unit_label,
    'selling_option_id', v_item.selling_option_id,
    'selling_option_label', v_item.selling_option_label,
    'package_size', v_item.package_size,
    'package_unit', v_item.package_unit,
    'selling_quantity', v_item.quantity,
    'units_per_package_snapshot', v_item.units_per_package,
    'sale_id', v_sale_id,
    'sale_item_id', v_sale_item_id,
    'local_occurred_at', COALESCE(v_operation.local_occurred_at, pg_catalog.clock_timestamp()),
    'terminal_id', v_operation.terminal_id,
    'accounting_version', v_operation.contract_version,
    'note', '',
    'slices', v_slices
  ));

  UPDATE public.sale_items AS item
  SET cost_per_base_unit = v_total_cost / NULLIF(item.base_unit_quantity, 0),
      cogs = v_total_cost,
      cost_price = v_total_cost / NULLIF(item.quantity, 0),
      gross_profit = item.line_total - v_total_cost,
      gross_margin = CASE WHEN item.line_total > 0
        THEN (item.line_total - v_total_cost) / item.line_total ELSE 0 END,
      stock_source = CASE WHEN v_owned AND v_consigned THEN 'mixed'
        WHEN v_consigned THEN 'consigned' ELSE 'product' END
  WHERE item.id = v_sale_item_id;

  RETURN pg_catalog.jsonb_build_object(
    'movement_id', v_movement_id,
    'sale_item_id', v_sale_item_id,
    'base_unit_quantity', v_item.base_unit_quantity,
    'cogs', pg_catalog.round(v_total_cost, 2),
    'replayed', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.restore_allocation_slices(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_store_id uuid := NULLIF(p_command->>'store_id', '')::uuid;
  v_sale_id uuid := NULLIF(p_command->>'sale_id', '')::uuid;
  v_sale_item_id uuid := NULLIF(p_command->>'sale_item_id', '')::uuid;
  v_operation_id uuid := NULLIF(p_command->>'operation_id', '')::uuid;
  v_location_id uuid := NULLIF(p_command->>'location_id', '')::uuid;
  v_source_line_key text := NULLIF(p_command->>'source_line_key', '');
  v_disposition text := NULLIF(p_command->>'disposition', '');
  v_quantity_raw numeric := NULLIF(p_command->>'quantity_base', '')::numeric;
  v_expected_balance_version bigint := NULLIF(p_command->>'expected_balance_version', '')::bigint;
  v_return_id uuid := NULLIF(p_command->>'return_id', '')::uuid;
  v_return_item_id uuid := NULLIF(p_command->>'return_item_id', '')::uuid;
  v_void_id uuid := NULLIF(p_command->>'void_id', '')::uuid;
  v_sale public.sales%ROWTYPE;
  v_item public.sale_items%ROWTYPE;
  v_operation public.pos_operations%ROWTYPE;
  v_location public.inventory_locations%ROWTYPE;
  v_balance public.inventory_balances%ROWTYPE;
  v_allocation public.sale_item_stock_allocations%ROWTYPE;
  v_lot_id uuid;
  v_movement public.inventory_movements%ROWTYPE;
  v_movement_id uuid;
  v_quantity numeric(14,3);
  v_needed numeric(14,3);
  v_take numeric(14,3);
  v_available numeric(14,3);
  v_slices jsonb := '[]'::jsonb;
  v_movement_type text;
  v_lock record;
BEGIN
  IF p_command IS NULL OR pg_catalog.jsonb_typeof(p_command) IS DISTINCT FROM 'object'
    OR v_store_id IS NULL OR v_sale_id IS NULL OR v_sale_item_id IS NULL
    OR v_operation_id IS NULL OR v_location_id IS NULL OR v_source_line_key IS NULL
    OR v_source_line_key !~ '^[A-Za-z0-9:_./-]{1,150}$'
    OR v_disposition IS NULL OR v_disposition NOT IN ('return_restock', 'return_quarantine', 'void_restore')
    OR v_quantity_raw IS NULL OR v_quantity_raw <= 0
    OR v_quantity_raw <> pg_catalog.round(v_quantity_raw, 3)
    OR v_quantity_raw <> pg_catalog.trunc(v_quantity_raw)
    OR v_expected_balance_version IS NULL OR v_expected_balance_version < 1 THEN
    RAISE EXCEPTION 'Allocation restoration command has missing or invalid fields';
  END IF;
  IF v_disposition IN ('return_restock', 'return_quarantine')
    AND (v_return_id IS NULL OR v_return_item_id IS NULL) THEN
    RAISE EXCEPTION 'Physical return restoration requires its return and return-item records';
  END IF;
  IF v_disposition = 'void_restore' AND v_void_id IS NULL THEN
    RAISE EXCEPTION 'Void restoration requires its approved void record';
  END IF;
  v_quantity := v_quantity_raw::numeric(14,3);
  v_movement_type := v_disposition;

  SELECT operation.* INTO v_operation
  FROM public.pos_operations AS operation
  WHERE operation.id = v_operation_id AND operation.store_id = v_store_id
  FOR UPDATE;
  IF NOT FOUND OR v_operation.status <> 'processing'
    OR v_operation.actor_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'Allocation restoration requires the active authenticated operation';
  END IF;
  SELECT sale.* INTO v_sale
  FROM public.sales AS sale
  WHERE sale.id = v_sale_id AND sale.store_id = v_store_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source sale is outside the operation store'; END IF;
  SELECT item.* INTO v_item
  FROM public.sale_items AS item
  WHERE item.id = v_sale_item_id AND item.sale_id = v_sale_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source sale item is outside the source sale'; END IF;

  SELECT movement.* INTO v_movement
  FROM public.inventory_movements AS movement
  WHERE movement.operation_id = v_operation_id
    AND movement.source_line_key = v_source_line_key
    AND movement.location_id = v_location_id
    AND movement.movement_type = v_movement_type;
  IF FOUND THEN
    IF v_movement.sale_id IS DISTINCT FROM v_sale_id
      OR v_movement.sale_item_id IS DISTINCT FROM v_sale_item_id
      OR v_movement.quantity_delta <> v_quantity
      OR v_movement.return_id IS DISTINCT FROM v_return_id
      OR v_movement.return_item_id IS DISTINCT FROM v_return_item_id
      OR v_movement.void_id IS DISTINCT FROM v_void_id THEN
      RAISE EXCEPTION 'Restoration operation key was reused with different facts';
    END IF;
    RETURN pg_catalog.jsonb_build_object('movement_id', v_movement.id, 'replayed', true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_cutovers AS cutover
    WHERE cutover.store_id = v_store_id AND cutover.status = 'complete'
  ) THEN
    RAISE EXCEPTION 'Inventory writes are disabled until store cutover is complete';
  END IF;
  SELECT location.* INTO v_location
  FROM public.inventory_locations AS location
  WHERE location.store_id = v_store_id AND location.id = v_location_id
    AND location.is_active
    AND ((v_disposition IN ('return_restock', 'void_restore') AND location.kind = 'sellable' AND location.is_default)
      OR (v_disposition = 'return_quarantine' AND location.kind = 'quarantine'));
  IF NOT FOUND THEN RAISE EXCEPTION 'Restoration destination has the wrong location kind or scope'; END IF;

  INSERT INTO public.inventory_balances (store_id, product_id, location_id, provenance)
  VALUES (v_store_id, v_item.product_id, v_location_id, 'live')
  ON CONFLICT (store_id, product_id, location_id) DO NOTHING;
  SELECT balance.* INTO v_balance
  FROM public.inventory_balances AS balance
  WHERE balance.store_id = v_store_id AND balance.product_id = v_item.product_id
    AND balance.location_id = v_location_id
  FOR UPDATE;
  IF NOT FOUND OR v_balance.provenance <> 'live'
    OR v_balance.version <> v_expected_balance_version THEN
    RAISE EXCEPTION 'Restoration destination balance is missing, not live, or stale';
  END IF;

  -- Precreate and lock destination lot balances before FIFO lot and allocation locks.
  INSERT INTO public.inventory_lot_location_balances (store_id, lot_id, location_id, provenance)
  SELECT v_store_id, allocation.lot_id, v_location_id, 'live'
  FROM public.sale_item_stock_allocations AS allocation
  WHERE allocation.store_id = v_store_id AND allocation.sale_item_id = v_sale_item_id
  ON CONFLICT (store_id, lot_id, location_id) DO NOTHING;
  FOR v_lock IN
    SELECT lot_balance.id
    FROM public.inventory_lot_location_balances AS lot_balance
    JOIN public.sale_item_stock_allocations AS allocation
      ON allocation.store_id = lot_balance.store_id AND allocation.lot_id = lot_balance.lot_id
    WHERE allocation.store_id = v_store_id AND allocation.sale_item_id = v_sale_item_id
      AND lot_balance.location_id = v_location_id
    ORDER BY lot_balance.lot_id
    FOR UPDATE OF lot_balance
  LOOP NULL; END LOOP;
  FOR v_lock IN
    SELECT lot.id
    FROM public.inventory_stock_lots AS lot
    JOIN public.sale_item_stock_allocations AS allocation
      ON allocation.store_id = lot.store_id AND allocation.lot_id = lot.id
    WHERE allocation.store_id = v_store_id AND allocation.sale_item_id = v_sale_item_id
    ORDER BY lot.received_at, lot.id
    FOR UPDATE OF lot
  LOOP NULL; END LOOP;
  FOR v_lock IN
    SELECT allocation.id
    FROM public.sale_item_stock_allocations AS allocation
    WHERE allocation.store_id = v_store_id AND allocation.sale_item_id = v_sale_item_id
    ORDER BY allocation.id
    FOR UPDATE OF allocation
  LOOP NULL; END LOOP;

  v_needed := v_quantity;
  FOR v_allocation IN
    SELECT allocation.*
    FROM public.sale_item_stock_allocations AS allocation
    JOIN public.inventory_stock_lots AS lot
      ON lot.store_id = allocation.store_id AND lot.id = allocation.lot_id
    WHERE allocation.store_id = v_store_id AND allocation.sale_item_id = v_sale_item_id
    ORDER BY allocation.allocation_sequence, allocation.id
  LOOP
    EXIT WHEN v_needed <= 0;
    v_available := CASE WHEN v_allocation.counter_provenance = 'new'
      THEN v_allocation.quantity_base_units - v_allocation.physical_returned_quantity
        - v_allocation.void_restored_quantity
      ELSE v_allocation.quantity_base_units - v_allocation.quantity_returned END;
    v_take := LEAST(v_available, v_needed);
    IF v_take <= 0 THEN CONTINUE; END IF;

    SELECT lot.id INTO v_lot_id
    FROM public.inventory_stock_lots AS lot
    WHERE lot.store_id = v_store_id AND lot.id = v_allocation.lot_id
      AND lot.product_id = v_item.product_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Source allocation lot does not match the sale item'; END IF;

    UPDATE public.sale_item_stock_allocations AS allocation
    SET quantity_returned = allocation.quantity_returned + v_take,
        physical_returned_quantity = allocation.physical_returned_quantity
          + CASE WHEN allocation.counter_provenance = 'new'
              AND v_disposition IN ('return_restock', 'return_quarantine') THEN v_take ELSE 0 END,
        restocked_quantity = allocation.restocked_quantity
          + CASE WHEN allocation.counter_provenance = 'new'
              AND v_disposition = 'return_restock' THEN v_take ELSE 0 END,
        quarantined_quantity = allocation.quarantined_quantity
          + CASE WHEN allocation.counter_provenance = 'new'
              AND v_disposition = 'return_quarantine' THEN v_take ELSE 0 END,
        void_restored_quantity = allocation.void_restored_quantity
          + CASE WHEN allocation.counter_provenance = 'new'
              AND v_disposition = 'void_restore' THEN v_take ELSE 0 END
    WHERE allocation.id = v_allocation.id;

    v_slices := v_slices || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'lot_id', v_lot_id,
      'quantity_delta', v_take,
      'source_allocation_id', v_allocation.id,
      'source_slice_key', v_allocation.id::text
    ));
    v_needed := v_needed - v_take;
  END LOOP;
  IF v_needed > 0 THEN
    RAISE EXCEPTION 'Source allocations are short by % base units for requested restoration', v_needed;
  END IF;

  v_movement_id := private.apply_inventory_movement(pg_catalog.jsonb_build_object(
    'store_id', v_store_id,
    'product_id', v_item.product_id,
    'location_id', v_location_id,
    'operation_id', v_operation_id,
    'source_line_key', v_source_line_key,
    'movement_type', v_movement_type,
    'origin', 'automatic',
    'reason_code', CASE WHEN v_disposition = 'return_restock' THEN 'return_restock'
      WHEN v_disposition = 'return_quarantine' THEN 'return_quarantine' ELSE 'void_restore' END,
    'quantity_delta', v_quantity,
    'expected_balance_version', v_expected_balance_version,
    'unit_label', COALESCE(NULLIF(v_item.base_unit_label, ''), NULLIF(v_item.unit_label, ''), 'unit'),
    'selling_option_id', v_item.selling_option_id,
    'selling_option_label', v_item.selling_option_label,
    'package_size', v_item.package_size,
    'package_unit', v_item.package_unit,
    'selling_quantity', v_quantity,
    'units_per_package_snapshot', v_item.units_per_package,
    'sale_id', v_sale_id,
    'sale_item_id', v_sale_item_id,
    'return_id', v_return_id,
    'return_item_id', v_return_item_id,
    'void_id', v_void_id,
    'local_occurred_at', COALESCE(v_operation.local_occurred_at, pg_catalog.clock_timestamp()),
    'terminal_id', v_operation.terminal_id,
    'note', '',
    'slices', v_slices
  ));

  RETURN pg_catalog.jsonb_build_object('movement_id', v_movement_id, 'replayed', false);
END;
$function$;

CREATE OR REPLACE FUNCTION private.transfer_inventory(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_store_id uuid := NULLIF(p_command->>'store_id', '')::uuid;
  v_product_id uuid := NULLIF(p_command->>'product_id', '')::uuid;
  v_operation_id uuid := NULLIF(p_command->>'operation_id', '')::uuid;
  v_from_location_id uuid := NULLIF(p_command->>'from_location_id', '')::uuid;
  v_to_location_id uuid := NULLIF(p_command->>'to_location_id', '')::uuid;
  v_source_line_key text := NULLIF(p_command->>'source_line_key', '');
  v_quantity_raw numeric := NULLIF(p_command->>'quantity_base', '')::numeric;
  v_from_version bigint := NULLIF(p_command->>'expected_from_balance_version', '')::bigint;
  v_to_version bigint := NULLIF(p_command->>'expected_to_balance_version', '')::bigint;
  v_source_allocations jsonb := p_command->'source_allocations';
  v_sale public.sales%ROWTYPE;
  v_operation public.pos_operations%ROWTYPE;
  v_from public.inventory_locations%ROWTYPE;
  v_to public.inventory_locations%ROWTYPE;
  v_balance public.inventory_balances%ROWTYPE;
  v_existing_out public.inventory_movements%ROWTYPE;
  v_existing_in public.inventory_movements%ROWTYPE;
  v_has_existing_out boolean := false;
  v_has_existing_in boolean := false;
  v_lot record;
  v_allocation public.sale_item_stock_allocations%ROWTYPE;
  v_transfer_group_id uuid := COALESCE(NULLIF(p_command->>'transfer_group_id', '')::uuid, gen_random_uuid());
  v_source_slices jsonb := '[]'::jsonb;
  v_target_slices jsonb := '[]'::jsonb;
  v_quantity numeric(14,3);
  v_needed numeric(14,3) := 0;
  v_take numeric(14,3);
  v_locked_count integer := 0;
  v_movement_out uuid;
  v_movement_in uuid;
  v_in_type text := 'transfer_in';
  v_is_restock_release boolean := false;
  v_lock record;
BEGIN
  IF p_command IS NULL OR pg_catalog.jsonb_typeof(p_command) IS DISTINCT FROM 'object'
    OR v_store_id IS NULL OR v_product_id IS NULL OR v_operation_id IS NULL
    OR v_from_location_id IS NULL OR v_to_location_id IS NULL
    OR v_from_location_id = v_to_location_id OR v_source_line_key IS NULL
    OR v_source_line_key !~ '^[A-Za-z0-9:_./-]{1,150}$'
    OR v_quantity_raw IS NULL OR v_quantity_raw <= 0
    OR v_quantity_raw <> pg_catalog.round(v_quantity_raw, 3)
    OR v_quantity_raw <> pg_catalog.trunc(v_quantity_raw)
    OR v_from_version IS NULL OR v_from_version < 1
    OR v_to_version IS NULL OR v_to_version < 1 THEN
    RAISE EXCEPTION 'Inventory transfer command has missing or invalid fields';
  END IF;
  v_quantity := v_quantity_raw::numeric(14,3);
  IF v_source_allocations IS NOT NULL
    AND pg_catalog.jsonb_typeof(v_source_allocations) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Transfer source allocations must be an array';
  END IF;

  SELECT operation.* INTO v_operation
  FROM public.pos_operations AS operation
  WHERE operation.id = v_operation_id AND operation.store_id = v_store_id
  FOR UPDATE;
  IF NOT FOUND OR v_operation.status <> 'processing'
    OR v_operation.actor_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'Inventory transfer requires the active authenticated operation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_cutovers AS cutover
    WHERE cutover.store_id = v_store_id AND cutover.status = 'complete'
  ) THEN
    RAISE EXCEPTION 'Inventory writes are disabled until store cutover is complete';
  END IF;
  SELECT location.* INTO v_from
  FROM public.inventory_locations AS location
  WHERE location.store_id = v_store_id AND location.id = v_from_location_id AND location.is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer source location is outside scope or inactive'; END IF;
  SELECT location.* INTO v_to
  FROM public.inventory_locations AS location
  WHERE location.store_id = v_store_id AND location.id = v_to_location_id AND location.is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer destination location is outside scope or inactive'; END IF;

  SELECT movement.* INTO v_existing_out
  FROM public.inventory_movements AS movement
  WHERE movement.operation_id = v_operation_id
    AND movement.source_line_key = v_source_line_key || '/out'
    AND movement.location_id = v_from_location_id
    AND movement.movement_type = 'transfer_out';
  v_has_existing_out := FOUND;
  SELECT movement.* INTO v_existing_in
  FROM public.inventory_movements AS movement
  WHERE movement.operation_id = v_operation_id
    AND movement.source_line_key = v_source_line_key || '/in'
    AND movement.location_id = v_to_location_id
    AND movement.movement_type IN ('transfer_in', 'return_restock');
  v_has_existing_in := FOUND;
  IF v_has_existing_out OR v_has_existing_in THEN
    IF NOT v_has_existing_out OR NOT v_has_existing_in
      OR v_existing_out.product_id IS DISTINCT FROM v_product_id
      OR v_existing_in.product_id IS DISTINCT FROM v_product_id
      OR v_existing_out.quantity_delta <> -v_quantity_raw
      OR v_existing_in.quantity_delta <> v_quantity_raw
      OR v_existing_out.transfer_group_id IS NULL
      OR v_existing_out.transfer_group_id IS DISTINCT FROM v_existing_in.transfer_group_id
      OR (NULLIF(p_command->>'transfer_group_id', '') IS NOT NULL
        AND v_existing_out.transfer_group_id IS DISTINCT FROM NULLIF(p_command->>'transfer_group_id', '')::uuid)
      OR (v_source_allocations IS NOT NULL AND pg_catalog.jsonb_array_length(v_source_allocations) > 0
        AND v_existing_in.movement_type <> 'return_restock')
      OR ((v_source_allocations IS NULL OR pg_catalog.jsonb_array_length(v_source_allocations) = 0)
        AND v_existing_in.movement_type <> 'transfer_in') THEN
      RAISE EXCEPTION 'Transfer operation key was reused with different or incomplete facts';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'transfer_group_id', v_existing_out.transfer_group_id,
      'source_movement_id', v_existing_out.id,
      'destination_movement_id', v_existing_in.id,
      'quantity_base', v_quantity_raw,
      'replayed', true
    );
  END IF;

  IF v_source_allocations IS NOT NULL AND pg_catalog.jsonb_array_length(v_source_allocations) > 0 THEN
    IF v_from.kind <> 'quarantine' OR v_to.kind <> 'sellable'
      OR (SELECT COALESCE(sum(slice.quantity), 0)
        FROM pg_catalog.jsonb_to_recordset(v_source_allocations)
          AS slice(allocation_id uuid, quantity numeric)) <> v_quantity
      OR EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_to_recordset(v_source_allocations)
          AS slice(allocation_id uuid, quantity numeric)
        WHERE slice.allocation_id IS NULL OR slice.quantity IS NULL OR slice.quantity <= 0
          OR slice.quantity <> pg_catalog.trunc(slice.quantity)
      ) THEN
      RAISE EXCEPTION 'Allocation-linked transfer must release exact quarantined return slices';
    END IF;
    v_is_restock_release := true;
    v_in_type := 'return_restock';
  END IF;

  -- Create missing location balances after cutover and lock both aggregates by
  -- location UUID before any lot or source-allocation row is touched.
  INSERT INTO public.inventory_balances (store_id, product_id, location_id, provenance)
  SELECT v_store_id, v_product_id, location_id, 'live'
  FROM (VALUES (v_from_location_id), (v_to_location_id)) AS locations(location_id)
  ON CONFLICT (store_id, product_id, location_id) DO NOTHING;
  FOR v_balance IN
    SELECT balance.*
    FROM public.inventory_balances AS balance
    WHERE balance.store_id = v_store_id AND balance.product_id = v_product_id
      AND balance.location_id IN (v_from_location_id, v_to_location_id)
    ORDER BY balance.location_id
    FOR UPDATE OF balance
  LOOP
    v_locked_count := v_locked_count + 1;
    IF v_balance.provenance <> 'live' THEN RAISE EXCEPTION 'Transfer balance is not live'; END IF;
    IF v_balance.location_id = v_from_location_id AND v_balance.version <> v_from_version THEN
      RAISE EXCEPTION 'Transfer source balance version conflict';
    END IF;
    IF v_balance.location_id = v_to_location_id AND v_balance.version <> v_to_version THEN
      RAISE EXCEPTION 'Transfer destination balance version conflict';
    END IF;
    IF v_balance.location_id = v_from_location_id
      AND v_balance.quantity_on_hand - v_balance.quantity_reserved_offline
        - v_balance.quantity_reserved_online < v_quantity THEN
      RAISE EXCEPTION 'Transfer exceeds unreserved source stock';
    END IF;
  END LOOP;
  IF v_locked_count <> 2 THEN RAISE EXCEPTION 'Transfer balances are incomplete'; END IF;

  IF v_is_restock_release THEN
    INSERT INTO public.inventory_lot_location_balances (store_id, lot_id, location_id, provenance)
    SELECT v_store_id, allocation.lot_id, v_from_location_id, 'live'
    FROM pg_catalog.jsonb_to_recordset(v_source_allocations)
      AS requested(allocation_id uuid, quantity numeric)
    JOIN public.sale_item_stock_allocations AS allocation
      ON allocation.store_id = v_store_id AND allocation.id = requested.allocation_id
    ON CONFLICT (store_id, lot_id, location_id) DO NOTHING;
    INSERT INTO public.inventory_lot_location_balances (store_id, lot_id, location_id, provenance)
    SELECT v_store_id, allocation.lot_id, v_to_location_id, 'live'
    FROM pg_catalog.jsonb_to_recordset(v_source_allocations)
      AS requested(allocation_id uuid, quantity numeric)
    JOIN public.sale_item_stock_allocations AS allocation
      ON allocation.store_id = v_store_id AND allocation.id = requested.allocation_id
    ON CONFLICT (store_id, lot_id, location_id) DO NOTHING;
    FOR v_lock IN
      SELECT lot_balance.id
      FROM public.inventory_lot_location_balances AS lot_balance
      JOIN pg_catalog.jsonb_to_recordset(v_source_allocations)
        AS requested(allocation_id uuid, quantity numeric)
        ON true
      JOIN public.sale_item_stock_allocations AS allocation
        ON allocation.store_id = v_store_id AND allocation.id = requested.allocation_id
       AND allocation.lot_id = lot_balance.lot_id
      WHERE lot_balance.store_id = v_store_id
        AND lot_balance.location_id IN (v_from_location_id, v_to_location_id)
      ORDER BY lot_balance.lot_id, lot_balance.location_id
      FOR UPDATE OF lot_balance
    LOOP NULL; END LOOP;
    FOR v_lock IN
      SELECT lot.id
      FROM public.inventory_stock_lots AS lot
      JOIN public.sale_item_stock_allocations AS allocation
        ON allocation.store_id = lot.store_id AND allocation.lot_id = lot.id
      JOIN pg_catalog.jsonb_to_recordset(v_source_allocations)
        AS requested(allocation_id uuid, quantity numeric)
        ON requested.allocation_id = allocation.id
      WHERE lot.store_id = v_store_id AND lot.product_id = v_product_id
      ORDER BY lot.received_at, lot.id
      FOR UPDATE OF lot
    LOOP NULL; END LOOP;
    FOR v_lock IN
      SELECT allocation.id
      FROM public.sale_item_stock_allocations AS allocation
      JOIN pg_catalog.jsonb_to_recordset(v_source_allocations)
        AS requested(allocation_id uuid, quantity numeric)
        ON requested.allocation_id = allocation.id
      WHERE allocation.store_id = v_store_id
      ORDER BY allocation.id
      FOR UPDATE OF allocation
    LOOP NULL; END LOOP;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_to_recordset(v_source_allocations)
        AS requested(allocation_id uuid, quantity numeric)
      LEFT JOIN public.sale_item_stock_allocations AS allocation
        ON allocation.store_id = v_store_id AND allocation.id = requested.allocation_id
      LEFT JOIN public.inventory_lot_location_balances AS lot_balance
        ON lot_balance.store_id = v_store_id AND lot_balance.lot_id = allocation.lot_id
       AND lot_balance.location_id = v_from_location_id
      WHERE allocation.id IS NULL OR allocation.lot_id IS NULL
        OR lot_balance.id IS NULL OR lot_balance.provenance <> 'live'
        OR lot_balance.quantity_on_hand - lot_balance.quantity_reserved_offline
          - lot_balance.quantity_reserved_online < requested.quantity
        OR allocation.quarantined_quantity < requested.quantity
        OR allocation.counter_provenance <> 'new'
        OR NOT EXISTS (
          SELECT 1
          FROM public.sale_items AS item
          JOIN public.sales AS sale ON sale.id = item.sale_id
          WHERE item.id = allocation.sale_item_id
            AND item.product_id = v_product_id
            AND sale.store_id = v_store_id
        )
    ) THEN
      RAISE EXCEPTION 'Quarantined return allocation is missing, legacy, or exceeds its source quantity';
    END IF;

    FOR v_lot IN
      SELECT requested.allocation_id, allocation.lot_id, requested.quantity::numeric(14,3) AS quantity
      FROM pg_catalog.jsonb_to_recordset(v_source_allocations)
        AS requested(allocation_id uuid, quantity numeric)
      JOIN public.sale_item_stock_allocations AS allocation
        ON allocation.store_id = v_store_id AND allocation.id = requested.allocation_id
      ORDER BY allocation.id
    LOOP
      UPDATE public.sale_item_stock_allocations AS allocation
      SET quarantined_quantity = allocation.quarantined_quantity - v_lot.quantity,
          restocked_quantity = allocation.restocked_quantity + v_lot.quantity
      WHERE allocation.store_id = v_store_id AND allocation.id = v_lot.allocation_id;
      v_source_slices := v_source_slices || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'lot_id', v_lot.lot_id,
        'quantity_delta', -v_lot.quantity,
        'source_allocation_id', v_lot.allocation_id,
        'source_slice_key', v_lot.allocation_id::text
      ));
      v_target_slices := v_target_slices || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'lot_id', v_lot.lot_id,
        'quantity_delta', v_lot.quantity,
        'source_allocation_id', v_lot.allocation_id,
        'source_slice_key', v_lot.allocation_id::text
      ));
    END LOOP;
  ELSE
    FOR v_lot IN
      SELECT lot_balance.id, lot_balance.lot_id,
        lot_balance.quantity_on_hand - lot_balance.quantity_reserved_offline
          - lot_balance.quantity_reserved_online AS available
      FROM public.inventory_lot_location_balances AS lot_balance
      JOIN public.inventory_stock_lots AS lot
        ON lot.store_id = lot_balance.store_id AND lot.id = lot_balance.lot_id
      WHERE lot_balance.store_id = v_store_id AND lot.product_id = v_product_id
        AND lot_balance.location_id = v_from_location_id
        AND lot_balance.quantity_on_hand > lot_balance.quantity_reserved_offline
          + lot_balance.quantity_reserved_online
      ORDER BY lot.received_at, lot.id
      FOR UPDATE OF lot_balance
    LOOP
      EXIT WHEN v_needed >= v_quantity;
      v_take := LEAST(v_lot.available, v_quantity - v_needed);
      v_needed := v_needed + v_take;
      v_source_slices := v_source_slices || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'lot_id', v_lot.lot_id,
        'quantity_delta', -v_take,
        'source_allocation_id', NULL,
        'source_slice_key', v_lot.lot_id::text
      ));
      v_target_slices := v_target_slices || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'lot_id', v_lot.lot_id,
        'quantity_delta', v_take,
        'source_allocation_id', NULL,
        'source_slice_key', v_lot.lot_id::text
      ));
    END LOOP;
    IF v_needed < v_quantity THEN RAISE EXCEPTION 'Transfer source lots are short'; END IF;

    FOR v_lock IN
      SELECT lot.id
      FROM public.inventory_stock_lots AS lot
      JOIN public.inventory_lot_location_balances AS lot_balance
        ON lot_balance.store_id = lot.store_id AND lot_balance.lot_id = lot.id
      JOIN pg_catalog.jsonb_to_recordset(v_source_slices)
        AS slice(lot_id uuid, quantity_delta numeric, source_allocation_id uuid, source_slice_key text)
        ON slice.lot_id = lot.id
      WHERE lot.store_id = v_store_id AND lot.product_id = v_product_id
        AND lot_balance.location_id = v_from_location_id
      ORDER BY lot.received_at, lot.id
      FOR UPDATE OF lot
    LOOP NULL; END LOOP;
  END IF;

  v_movement_out := private.apply_inventory_movement(pg_catalog.jsonb_build_object(
    'store_id', v_store_id, 'product_id', v_product_id, 'location_id', v_from_location_id,
    'operation_id', v_operation_id, 'source_line_key', v_source_line_key || '/out',
    'movement_type', 'transfer_out', 'origin', 'automatic',
    'reason_code', COALESCE(NULLIF(pg_catalog.btrim(p_command->>'reason_code'), ''), 'location_transfer'),
    'quantity_delta', -v_quantity, 'expected_balance_version', v_from_version,
    'unit_label', COALESCE(NULLIF(p_command->>'unit_label', ''), 'unit'),
    'transfer_group_id', v_transfer_group_id,
    'local_occurred_at', COALESCE(v_operation.local_occurred_at, pg_catalog.clock_timestamp()),
    'terminal_id', v_operation.terminal_id, 'note', '', 'slices', v_source_slices
  ));
  v_movement_in := private.apply_inventory_movement(pg_catalog.jsonb_build_object(
    'store_id', v_store_id, 'product_id', v_product_id, 'location_id', v_to_location_id,
    'operation_id', v_operation_id, 'source_line_key', v_source_line_key || '/in',
    'movement_type', v_in_type, 'origin', 'automatic',
    'reason_code', COALESCE(NULLIF(pg_catalog.btrim(p_command->>'reason_code'), ''), 'location_transfer'),
    'quantity_delta', v_quantity, 'expected_balance_version', v_to_version,
    'unit_label', COALESCE(NULLIF(p_command->>'unit_label', ''), 'unit'),
    'transfer_group_id', v_transfer_group_id,
    'local_occurred_at', COALESCE(v_operation.local_occurred_at, pg_catalog.clock_timestamp()),
    'terminal_id', v_operation.terminal_id, 'note', '', 'slices', v_target_slices
  ));

  RETURN pg_catalog.jsonb_build_object(
    'transfer_group_id', v_transfer_group_id,
    'source_movement_id', v_movement_out,
    'destination_movement_id', v_movement_in,
    'quantity_base', v_quantity,
    'replayed', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.dispose_quarantined_stock(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_store_id uuid := NULLIF(p_command->>'store_id', '')::uuid;
  v_product_id uuid := NULLIF(p_command->>'product_id', '')::uuid;
  v_operation_id uuid := NULLIF(p_command->>'operation_id', '')::uuid;
  v_location_id uuid := NULLIF(p_command->>'location_id', '')::uuid;
  v_source_line_key text := NULLIF(p_command->>'source_line_key', '');
  v_quantity_raw numeric := NULLIF(p_command->>'quantity_base', '')::numeric;
  v_expected_balance_version bigint := NULLIF(p_command->>'expected_balance_version', '')::bigint;
  v_approved_by uuid := NULLIF(p_command->>'approved_by', '')::uuid;
  v_approved_at timestamptz := NULLIF(p_command->>'approved_at', '')::timestamptz;
  v_operation public.pos_operations%ROWTYPE;
  v_location public.inventory_locations%ROWTYPE;
  v_slices_in jsonb := p_command->'slices';
  v_slices jsonb := '[]'::jsonb;
  v_slice record;
  v_quantity numeric(14,3);
  v_total numeric(14,3) := 0;
  v_movement_id uuid;
  v_existing public.inventory_movements%ROWTYPE;
  v_allocation public.sale_item_stock_allocations%ROWTYPE;
  v_lock record;
BEGIN
  IF p_command IS NULL OR pg_catalog.jsonb_typeof(p_command) IS DISTINCT FROM 'object'
    OR v_store_id IS NULL OR v_product_id IS NULL OR v_operation_id IS NULL
    OR v_location_id IS NULL OR v_source_line_key IS NULL
    OR v_source_line_key !~ '^[A-Za-z0-9:_./-]{1,160}$'
    OR v_quantity_raw IS NULL OR v_quantity_raw <= 0
    OR v_quantity_raw <> pg_catalog.round(v_quantity_raw, 3)
    OR v_quantity_raw <> pg_catalog.trunc(v_quantity_raw)
    OR v_expected_balance_version IS NULL OR v_expected_balance_version < 1
    OR v_approved_by IS NULL OR v_approved_at IS NULL
    OR pg_catalog.jsonb_typeof(v_slices_in) IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(v_slices_in) = 0 THEN
    RAISE EXCEPTION 'Quarantine disposal command has missing or invalid fields';
  END IF;
  v_quantity := v_quantity_raw::numeric(14,3);
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_to_recordset(v_slices_in)
      AS slice(lot_id uuid, quantity numeric, source_allocation_id uuid)
    WHERE slice.lot_id IS NULL OR slice.quantity IS NULL OR slice.quantity <= 0
      OR slice.quantity <> pg_catalog.trunc(slice.quantity)
  ) THEN RAISE EXCEPTION 'Quarantine disposal slices are invalid'; END IF;
  SELECT COALESCE(sum(slice.quantity), 0)::numeric(14,3) INTO v_total
  FROM pg_catalog.jsonb_to_recordset(v_slices_in)
    AS slice(lot_id uuid, quantity numeric, source_allocation_id uuid);
  IF v_total <> v_quantity THEN RAISE EXCEPTION 'Quarantine disposal slices do not equal the requested quantity'; END IF;

  SELECT operation.* INTO v_operation
  FROM public.pos_operations AS operation
  WHERE operation.id = v_operation_id AND operation.store_id = v_store_id
  FOR UPDATE;
  IF NOT FOUND OR v_operation.status <> 'processing'
    OR v_operation.actor_id IS DISTINCT FROM (SELECT auth.uid())
    OR v_approved_by = v_operation.actor_id THEN
    RAISE EXCEPTION 'Quarantine disposal requires a separate active approver';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_cutovers AS cutover
    WHERE cutover.store_id = v_store_id AND cutover.status = 'complete'
  ) THEN RAISE EXCEPTION 'Inventory writes are disabled until store cutover is complete'; END IF;
  SELECT location.* INTO v_location
  FROM public.inventory_locations AS location
  WHERE location.store_id = v_store_id AND location.id = v_location_id
    AND location.kind = 'quarantine' AND location.is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Disposal is restricted to an active quarantine location'; END IF;

  SELECT movement.* INTO v_existing
  FROM public.inventory_movements AS movement
  WHERE movement.operation_id = v_operation_id
    AND movement.source_line_key = v_source_line_key
    AND movement.location_id = v_location_id
    AND movement.movement_type = 'quarantine_disposal';
  IF FOUND THEN
    IF v_existing.product_id IS DISTINCT FROM v_product_id
      OR v_existing.quantity_delta <> -v_quantity
      OR v_existing.approved_by IS DISTINCT FROM v_approved_by THEN
      RAISE EXCEPTION 'Disposal operation key was reused with different facts';
    END IF;
    RETURN pg_catalog.jsonb_build_object('movement_id', v_existing.id, 'replayed', true);
  END IF;

  FOR v_slice IN
    SELECT slice.lot_id, slice.quantity::numeric(14,3) AS quantity, slice.source_allocation_id
    FROM pg_catalog.jsonb_to_recordset(v_slices_in)
      AS slice(lot_id uuid, quantity numeric, source_allocation_id uuid)
    ORDER BY slice.lot_id
  LOOP
    v_slices := v_slices || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'lot_id', v_slice.lot_id,
      'quantity_delta', -v_slice.quantity,
      'source_allocation_id', v_slice.source_allocation_id,
      'source_slice_key', COALESCE(v_slice.source_allocation_id::text, v_slice.lot_id::text)
    ));
  END LOOP;

  v_movement_id := private.apply_inventory_movement(pg_catalog.jsonb_build_object(
    'store_id', v_store_id, 'product_id', v_product_id, 'location_id', v_location_id,
    'operation_id', v_operation_id, 'source_line_key', v_source_line_key,
    'movement_type', 'quarantine_disposal', 'origin', 'manual',
    'reason_code', COALESCE(NULLIF(pg_catalog.btrim(p_command->>'reason_code'), ''), 'quarantine_disposal'),
    'quantity_delta', -v_quantity,
    'expected_balance_version', v_expected_balance_version,
    'unit_label', COALESCE(NULLIF(p_command->>'unit_label', ''), 'unit'),
    'approved_by', v_approved_by, 'approved_at', v_approved_at,
    'local_occurred_at', COALESCE(v_operation.local_occurred_at, pg_catalog.clock_timestamp()),
    'terminal_id', v_operation.terminal_id, 'note', COALESCE(p_command->>'note', ''),
    'slices', v_slices
  ));

  FOR v_lock IN
    SELECT allocation.id, slice.quantity::numeric(14,3) AS quantity
    FROM public.sale_item_stock_allocations AS allocation
    JOIN pg_catalog.jsonb_to_recordset(v_slices_in)
      AS slice(lot_id uuid, quantity numeric, source_allocation_id uuid)
      ON slice.source_allocation_id = allocation.id AND slice.lot_id = allocation.lot_id
    WHERE allocation.store_id = v_store_id
    ORDER BY allocation.id
    FOR UPDATE OF allocation
  LOOP
    SELECT allocation.* INTO v_allocation
    FROM public.sale_item_stock_allocations AS allocation
    WHERE allocation.id = v_lock.id;
    IF v_allocation.quarantined_quantity < v_lock.quantity
      OR v_allocation.counter_provenance <> 'new' THEN
      RAISE EXCEPTION 'Disposal exceeds the source allocation quarantine balance';
    END IF;
    UPDATE public.sale_item_stock_allocations AS allocation
    SET quarantined_quantity = allocation.quarantined_quantity - v_lock.quantity
    WHERE allocation.id = v_lock.id;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object('movement_id', v_movement_id, 'replayed', false);
END;
$function$;

REVOKE ALL ON FUNCTION private.apply_inventory_movement(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.allocate_sale_lots(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.restore_allocation_slices(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.transfer_inventory(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.dispose_quarantined_stock(jsonb) FROM PUBLIC, anon, authenticated, service_role;
