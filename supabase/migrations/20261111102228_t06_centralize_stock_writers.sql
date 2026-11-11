-- T06: persist a reviewable cutover baseline and route post-cutover writers
-- through the T05 inventory movement service. This migration defines the
-- guarded paths; the store remains in legacy mode until an explicit cutover.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE UNIQUE INDEX IF NOT EXISTS inventory_cutovers_store_id_id_uidx
  ON public.inventory_cutovers (store_id, id);

CREATE TABLE public.inventory_cutover_items (
  store_id uuid NOT NULL,
  cutover_id uuid NOT NULL,
  product_id uuid NOT NULL,
  product_stock numeric(14,3) NOT NULL CHECK (product_stock >= 0),
  shadow_balance_stock numeric(14,3) NOT NULL CHECK (shadow_balance_stock >= 0),
  source_lot_stock numeric(14,3) NOT NULL CHECK (source_lot_stock >= 0),
  sellable_lot_location_stock numeric(14,3) NOT NULL CHECK (sellable_lot_location_stock >= 0),
  quarantine_lot_location_stock numeric(14,3) NOT NULL CHECK (quarantine_lot_location_stock >= 0),
  reconciliation_reasons text[] NOT NULL DEFAULT ARRAY[]::text[],
  lot_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (pg_catalog.jsonb_typeof(lot_snapshot) = 'array'),
  snapshot_sha256 text NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  baseline_movement_id uuid,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT inventory_cutover_items_store_cutover_product_pk
    PRIMARY KEY (store_id, cutover_id, product_id),
  CONSTRAINT inventory_cutover_items_store_cutover_fkey
    FOREIGN KEY (store_id, cutover_id)
    REFERENCES public.inventory_cutovers (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_cutover_items_store_product_fkey
    FOREIGN KEY (store_id, product_id)
    REFERENCES public.products (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_cutover_items_store_movement_fkey
    FOREIGN KEY (store_id, baseline_movement_id)
    REFERENCES public.inventory_movements (store_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_cutover_items_zero_has_no_movement_check
    CHECK ((product_stock = 0) = (baseline_movement_id IS NULL))
);

CREATE INDEX inventory_cutover_items_product_idx
  ON public.inventory_cutover_items (store_id, product_id, cutover_id);
ALTER TABLE public.inventory_cutover_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inventory_cutover_items FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY inventory_cutover_items_api_deny
  ON public.inventory_cutover_items FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION private.reject_inventory_cutover_item_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Inventory cutover item snapshots are immutable'
    USING ERRCODE = '55000';
END;
$function$;

REVOKE ALL ON FUNCTION private.reject_inventory_cutover_item_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER inventory_cutover_items_immutable
  BEFORE UPDATE OR DELETE ON public.inventory_cutover_items
  FOR EACH ROW EXECUTE FUNCTION private.reject_inventory_cutover_item_mutation();

CREATE OR REPLACE FUNCTION private.build_inventory_cutover_snapshot(p_store_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH reconciliation AS (
    SELECT *
    FROM private.inventory_shadow_reconciliation(p_store_id)
  ),
  lot_snapshots AS (
    SELECT lot.product_id,
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'lot_id', lot.id,
          'ownership', lot.ownership,
          'supplier_id', lot.supplier_id,
          'supplier_name_snapshot', lot.supplier_name_snapshot,
          'unit_cost', lot.unit_cost::text,
          'quantity_received', lot.quantity_received::text,
          'quantity_remaining', lot.quantity_remaining::text,
          'received_purchase_quantity', lot.received_purchase_quantity::text,
          'purchase_unit_label', lot.purchase_unit_label,
          'pieces_per_purchase_unit', lot.pieces_per_purchase_unit::text,
          'location_id', lot.location_id,
          'locations', COALESCE((
            SELECT pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'location_id', balance.location_id,
                'quantity_on_hand', balance.quantity_on_hand::text,
                'quantity_reserved_offline', balance.quantity_reserved_offline::text,
                'quantity_reserved_online', balance.quantity_reserved_online::text,
                'version', balance.version,
                'provenance', balance.provenance
              ) ORDER BY balance.location_id
            )
            FROM public.inventory_lot_location_balances AS balance
            WHERE balance.store_id = lot.store_id AND balance.lot_id = lot.id
          ), '[]'::jsonb)
        ) ORDER BY lot.received_at, lot.id
      ) AS lots
    FROM public.inventory_stock_lots AS lot
    WHERE lot.store_id = p_store_id
    GROUP BY lot.product_id
  ),
  product_items AS (
    SELECT reconciliation.product_id,
      pg_catalog.jsonb_build_object(
        'product_id', reconciliation.product_id,
        'product_stock', reconciliation.product_stock::text,
        'shadow_balance_stock', reconciliation.shadow_balance_stock::text,
        'source_lot_stock', reconciliation.source_lot_stock::text,
        'sellable_lot_location_stock', reconciliation.sellable_lot_location_stock::text,
        'quarantine_lot_location_stock', COALESCE((
          SELECT pg_catalog.sum(balance.quantity_on_hand)
          FROM public.inventory_balances AS balance
          JOIN public.inventory_locations AS location
            ON location.store_id = balance.store_id AND location.id = balance.location_id
          WHERE balance.store_id = reconciliation.store_id
            AND balance.product_id = reconciliation.product_id
            AND location.kind = 'quarantine'
        ), 0)::text,
        'mismatch_reasons', pg_catalog.to_jsonb(reconciliation.mismatch_reasons),
        'lots', COALESCE(lot_snapshots.lots, '[]'::jsonb)
      ) AS snapshot
    FROM reconciliation
    LEFT JOIN lot_snapshots ON lot_snapshots.product_id = reconciliation.product_id
  ),
  aggregate_snapshot AS (
    SELECT COALESCE(
      pg_catalog.jsonb_agg(snapshot ORDER BY product_id), '[]'::jsonb
    ) AS items
    FROM product_items
  )
  SELECT pg_catalog.jsonb_build_object(
    'store_id', p_store_id,
    'product_count', pg_catalog.jsonb_array_length(aggregate_snapshot.items),
    'mismatch_count', (
      SELECT pg_catalog.count(*)
      FROM reconciliation
      WHERE pg_catalog.cardinality(reconciliation.mismatch_reasons) > 0
    ),
    'total_product_stock', COALESCE((SELECT pg_catalog.sum(product_stock) FROM reconciliation), 0)::text,
    'items', aggregate_snapshot.items,
    'sha256', pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(aggregate_snapshot.items::text, 'UTF8'), 'sha256'
    ), 'hex')
  )
  FROM aggregate_snapshot;
$function$;

REVOKE ALL ON FUNCTION private.build_inventory_cutover_snapshot(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.refresh_inventory_cutover_shadow(p_store_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_location_id uuid;
BEGIN
  SELECT location.id INTO v_location_id
  FROM public.inventory_locations AS location
  WHERE location.store_id = p_store_id AND location.kind = 'sellable'
    AND location.is_default AND location.is_active;
  IF v_location_id IS NULL THEN
    PERFORM private.raise_pos_operation_error('INVENTORY_LOCATION_MISSING', 'The default sellable inventory location is missing.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.inventory_balances AS balance
    JOIN public.products AS product
      ON product.store_id = balance.store_id AND product.id = balance.product_id
    WHERE balance.store_id = p_store_id AND balance.location_id = v_location_id
      AND balance.provenance IS DISTINCT FROM 'shadow'
  ) THEN
    PERFORM private.raise_pos_operation_error('ALREADY_CUT_OVER', 'Live inventory balances cannot be refreshed as legacy shadows.');
  END IF;

  INSERT INTO public.inventory_balances (
    store_id, product_id, location_id, quantity_on_hand, provenance
  )
  SELECT product.store_id, product.id, v_location_id,
    product.current_stock::numeric, 'shadow'
  FROM public.products AS product
  WHERE product.store_id = p_store_id
  ON CONFLICT (store_id, product_id, location_id) DO UPDATE
  SET quantity_on_hand = EXCLUDED.quantity_on_hand,
      provenance = 'shadow',
      version = public.inventory_balances.version + CASE
        WHEN public.inventory_balances.quantity_on_hand IS DISTINCT FROM EXCLUDED.quantity_on_hand
          OR public.inventory_balances.provenance IS DISTINCT FROM 'shadow' THEN 1 ELSE 0 END,
      observed_at = CASE
        WHEN public.inventory_balances.quantity_on_hand IS DISTINCT FROM EXCLUDED.quantity_on_hand
          OR public.inventory_balances.provenance IS DISTINCT FROM 'shadow'
          THEN pg_catalog.clock_timestamp() ELSE public.inventory_balances.observed_at END,
      updated_at = CASE
        WHEN public.inventory_balances.quantity_on_hand IS DISTINCT FROM EXCLUDED.quantity_on_hand
          OR public.inventory_balances.provenance IS DISTINCT FROM 'shadow'
          THEN pg_catalog.clock_timestamp() ELSE public.inventory_balances.updated_at END
  WHERE public.inventory_balances.quantity_reserved_offline = 0
    AND public.inventory_balances.quantity_reserved_online = 0
    AND (public.inventory_balances.quantity_on_hand IS DISTINCT FROM EXCLUDED.quantity_on_hand
      OR public.inventory_balances.provenance IS DISTINCT FROM 'shadow');

  IF EXISTS (
    SELECT 1 FROM public.inventory_balances AS balance
    JOIN public.products AS product
      ON product.store_id = balance.store_id AND product.id = balance.product_id
    WHERE balance.store_id = p_store_id AND balance.location_id = v_location_id
      AND (balance.quantity_reserved_offline > 0 OR balance.quantity_reserved_online > 0
        OR balance.quantity_on_hand <> product.current_stock::numeric)
  ) THEN
    PERFORM private.raise_pos_operation_error('INVENTORY_RECONCILIATION_REQUIRED', 'Reserved or live balance facts prevent legacy shadow refresh.');
  END IF;

  UPDATE public.inventory_stock_lots AS lot
  SET location_id = v_location_id
  WHERE lot.store_id = p_store_id AND lot.location_id IS NULL;

  INSERT INTO public.inventory_lot_location_balances (
    store_id, lot_id, location_id, quantity_on_hand, provenance
  )
  SELECT lot.store_id, lot.id, v_location_id, lot.quantity_remaining, 'shadow'
  FROM public.inventory_stock_lots AS lot
  WHERE lot.store_id = p_store_id
  ON CONFLICT (store_id, lot_id, location_id) DO UPDATE
  SET quantity_on_hand = EXCLUDED.quantity_on_hand,
      provenance = 'shadow',
      version = public.inventory_lot_location_balances.version + CASE
        WHEN public.inventory_lot_location_balances.quantity_on_hand IS DISTINCT FROM EXCLUDED.quantity_on_hand
          OR public.inventory_lot_location_balances.provenance IS DISTINCT FROM 'shadow' THEN 1 ELSE 0 END,
      observed_at = CASE
        WHEN public.inventory_lot_location_balances.quantity_on_hand IS DISTINCT FROM EXCLUDED.quantity_on_hand
          OR public.inventory_lot_location_balances.provenance IS DISTINCT FROM 'shadow'
          THEN pg_catalog.clock_timestamp() ELSE public.inventory_lot_location_balances.observed_at END,
      updated_at = CASE
        WHEN public.inventory_lot_location_balances.quantity_on_hand IS DISTINCT FROM EXCLUDED.quantity_on_hand
          OR public.inventory_lot_location_balances.provenance IS DISTINCT FROM 'shadow'
          THEN pg_catalog.clock_timestamp() ELSE public.inventory_lot_location_balances.updated_at END
  WHERE public.inventory_lot_location_balances.quantity_reserved_offline = 0
    AND public.inventory_lot_location_balances.quantity_reserved_online = 0
    AND (public.inventory_lot_location_balances.quantity_on_hand IS DISTINCT FROM EXCLUDED.quantity_on_hand
      OR public.inventory_lot_location_balances.provenance IS DISTINCT FROM 'shadow');

  IF EXISTS (
    SELECT 1 FROM public.inventory_lot_location_balances AS balance
    JOIN public.inventory_stock_lots AS lot
      ON lot.store_id = balance.store_id AND lot.id = balance.lot_id
    WHERE balance.store_id = p_store_id AND balance.location_id = v_location_id
      AND (balance.quantity_reserved_offline > 0 OR balance.quantity_reserved_online > 0
        OR balance.quantity_on_hand <> lot.quantity_remaining)
  ) THEN
    PERFORM private.raise_pos_operation_error('INVENTORY_RECONCILIATION_REQUIRED', 'Reserved lot balances prevent legacy shadow refresh.');
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION private.refresh_inventory_cutover_shadow(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prepare_inventory_cutover(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
  v_lock record;
  v_snapshot jsonb;
BEGIN
  v_operation := private.begin_pos_operation('inventory_cutover_prepare', p_command);
  IF v_operation.status = 'committed' THEN RETURN v_operation.response; END IF;
  PERFORM private.assert_store_admin(v_operation.store_id);
  IF private.jsonb_object_key_count(p_command->'payload') <> 0 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Cutover preparation does not accept payload fields.');
  END IF;
  IF private.store_feature_enabled(v_operation.store_id, 'inventory_ledger_v2')
    OR EXISTS (SELECT 1 FROM public.inventory_cutovers AS cutover WHERE cutover.store_id = v_operation.store_id) THEN
    PERFORM private.raise_pos_operation_error('ALREADY_CUT_OVER', 'Inventory cutover has already started.');
  END IF;
  PERFORM 1 FROM public.stores AS store WHERE store.id = v_operation.store_id FOR UPDATE;
  FOR v_lock IN
    SELECT product.id FROM public.products AS product
    WHERE product.store_id = v_operation.store_id ORDER BY product.id FOR UPDATE
  LOOP NULL; END LOOP;
  FOR v_lock IN
    SELECT balance.id FROM public.inventory_balances AS balance
    WHERE balance.store_id = v_operation.store_id
    ORDER BY balance.product_id, balance.location_id FOR UPDATE
  LOOP NULL; END LOOP;
  FOR v_lock IN
    SELECT lot.id FROM public.inventory_stock_lots AS lot
    WHERE lot.store_id = v_operation.store_id ORDER BY lot.id FOR UPDATE
  LOOP NULL; END LOOP;
  FOR v_lock IN
    SELECT balance.id FROM public.inventory_lot_location_balances AS balance
    WHERE balance.store_id = v_operation.store_id
    ORDER BY balance.lot_id, balance.location_id FOR UPDATE
  LOOP NULL; END LOOP;

  PERFORM private.refresh_inventory_cutover_shadow(v_operation.store_id);
  v_snapshot := private.build_inventory_cutover_snapshot(v_operation.store_id);
  RETURN private.finish_pos_operation(
    v_operation.store_id, v_operation.id, v_operation.kind,
    v_operation.request_hash, 'confirmed', 'inventory_cutover_preview',
    v_operation.store_id::text, 1, v_snapshot
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.prepare_inventory_cutover(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_inventory_cutover(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_inventory_cutover_preview(p_store_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM private.assert_store_admin(p_store_id);
  RETURN private.build_inventory_cutover_snapshot(p_store_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_inventory_ledger_status(p_store_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_cutover public.inventory_cutovers%ROWTYPE;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.user_belongs_to_store(p_store_id) THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'The authenticated user is not assigned to this store.', '42501');
  END IF;
  SELECT cutover.* INTO v_cutover
  FROM public.inventory_cutovers AS cutover
  WHERE cutover.store_id = p_store_id;
  RETURN pg_catalog.jsonb_build_object(
    'enabled', COALESCE(private.store_feature_enabled(p_store_id, 'inventory_ledger_v2'), false),
    'status', COALESCE(v_cutover.status, 'not_started'),
    'cutover_id', v_cutover.id,
    'completed_at', v_cutover.completed_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_inventory_cutover_preview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_cutover_preview(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_inventory_ledger_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_ledger_status(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_inventory_cutover(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
  v_payload jsonb;
  v_store public.stores%ROWTYPE;
  v_location public.inventory_locations%ROWTYPE;
  v_balance public.inventory_balances%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_item jsonb;
  v_lot record;
  v_snapshot jsonb;
  v_snapshot_sha256 text;
  v_expected_sha256 text;
  v_expected_product_count integer;
  v_cutover_id uuid := pg_catalog.gen_random_uuid();
  v_movement_id uuid;
  v_watermark_movement_id uuid;
  v_watermark_created_at timestamptz;
  v_product_id uuid;
  v_stock numeric(14,3);
  v_quarantine numeric(14,3);
  v_movement_count integer := 0;
  v_item_count integer := 0;
  v_result jsonb;
BEGIN
  v_operation := private.begin_pos_operation('inventory_cutover', p_command);
  IF v_operation.status = 'committed' THEN
    RETURN v_operation.response;
  END IF;
  PERFORM private.assert_store_admin(v_operation.store_id);

  v_payload := p_command->'payload';
  IF private.jsonb_object_key_count(v_payload) <> 2
    OR NOT (v_payload ?& ARRAY['expected_snapshot_sha256', 'expected_product_count'])
    OR pg_catalog.jsonb_typeof(v_payload->'expected_snapshot_sha256') IS DISTINCT FROM 'string'
    OR v_payload->>'expected_snapshot_sha256' !~ '^[0-9a-f]{64}$'
    OR pg_catalog.jsonb_typeof(v_payload->'expected_product_count') IS DISTINCT FROM 'number'
    OR v_payload->>'expected_product_count' !~ '^(0|[1-9][0-9]*)$' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'A reviewed inventory snapshot hash and product count are required.');
  END IF;
  v_expected_sha256 := v_payload->>'expected_snapshot_sha256';
  v_expected_product_count := (v_payload->>'expected_product_count')::integer;

  -- The store row also blocks new product inserts through their store FK while
  -- the current products, balances, lots and lot-location balances are locked.
  SELECT store.* INTO v_store
  FROM public.stores AS store
  WHERE store.id = v_operation.store_id
  FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'Store was not found.', '42501');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory_cutovers AS cutover
    WHERE cutover.store_id = v_operation.store_id
  ) OR private.store_feature_enabled(v_operation.store_id, 'inventory_ledger_v2') THEN
    PERFORM private.raise_pos_operation_error('ALREADY_CUT_OVER', 'Inventory ledger cutover has already started.');
  END IF;

  FOR v_product IN
    SELECT product.* FROM public.products AS product
    WHERE product.store_id = v_operation.store_id
    ORDER BY product.id FOR UPDATE
  LOOP NULL; END LOOP;
  FOR v_balance IN
    SELECT balance.* FROM public.inventory_balances AS balance
    WHERE balance.store_id = v_operation.store_id
    ORDER BY balance.product_id, balance.location_id FOR UPDATE
  LOOP NULL; END LOOP;
  FOR v_lot IN
    SELECT lot.id FROM public.inventory_stock_lots AS lot
    WHERE lot.store_id = v_operation.store_id
    ORDER BY lot.id FOR UPDATE
  LOOP NULL; END LOOP;
  FOR v_lot IN
    SELECT balance.id
    FROM public.inventory_lot_location_balances AS balance
    WHERE balance.store_id = v_operation.store_id
    ORDER BY balance.lot_id, balance.location_id FOR UPDATE
  LOOP NULL; END LOOP;

  PERFORM private.refresh_inventory_cutover_shadow(v_operation.store_id);
  v_snapshot := private.build_inventory_cutover_snapshot(v_operation.store_id);
  v_snapshot_sha256 := v_snapshot->>'sha256';
  IF v_snapshot_sha256 IS DISTINCT FROM v_expected_sha256
    OR (v_snapshot->>'product_count')::integer IS DISTINCT FROM v_expected_product_count THEN
    PERFORM private.raise_pos_operation_error('VERSION_CONFLICT', 'Inventory changed after the cutover snapshot was reviewed.', '40001');
  END IF;
  IF (v_snapshot->>'mismatch_count')::integer <> 0 THEN
    PERFORM private.raise_pos_operation_error('INVENTORY_RECONCILIATION_REQUIRED', 'Inventory cutover is blocked by product or source-lot mismatches.');
  END IF;

  SELECT location.* INTO v_location
  FROM public.inventory_locations AS location
  WHERE location.store_id = v_operation.store_id
    AND location.kind = 'sellable' AND location.is_default AND location.is_active;
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('INVENTORY_LOCATION_MISSING', 'The default sellable inventory location is missing.');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.inventory_balances AS balance
    JOIN public.inventory_locations AS location
      ON location.store_id = balance.store_id AND location.id = balance.location_id
    WHERE balance.store_id = v_operation.store_id AND location.kind = 'quarantine'
      AND balance.quantity_on_hand <> 0
  ) OR EXISTS (
    SELECT 1
    FROM public.inventory_lot_location_balances AS balance
    JOIN public.inventory_stock_lots AS lot
      ON lot.store_id = balance.store_id AND lot.id = balance.lot_id
    JOIN public.inventory_locations AS location
      ON location.store_id = balance.store_id AND location.id = balance.location_id
    WHERE balance.store_id = v_operation.store_id AND location.kind = 'quarantine'
      AND balance.quantity_on_hand <> 0
  ) THEN
    PERFORM private.raise_pos_operation_error('QUARANTINE_RECONCILIATION_REQUIRED', 'Quarantine stock must be reconciled before the first sellable-ledger cutover.');
  END IF;

  INSERT INTO public.inventory_cutovers (id, store_id, status, boundary_at)
  VALUES (v_cutover_id, v_operation.store_id, 'preparing', pg_catalog.clock_timestamp());

  FOR v_item IN
    SELECT value FROM pg_catalog.jsonb_array_elements(v_snapshot->'items') AS items(value)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_stock := (v_item->>'product_stock')::numeric(14,3);
    v_quarantine := (v_item->>'quarantine_lot_location_stock')::numeric(14,3);
    IF v_quarantine <> 0 THEN
      PERFORM private.raise_pos_operation_error('QUARANTINE_RECONCILIATION_REQUIRED', 'Quarantine stock must be zero before cutover.');
    END IF;

    SELECT product.* INTO v_product
    FROM public.products AS product
    WHERE product.store_id = v_operation.store_id AND product.id = v_product_id;
    SELECT balance.* INTO v_balance
    FROM public.inventory_balances AS balance
    WHERE balance.store_id = v_operation.store_id
      AND balance.product_id = v_product_id AND balance.location_id = v_location.id
    FOR UPDATE;
    IF NOT FOUND OR v_balance.provenance <> 'shadow'
      OR v_balance.quantity_on_hand <> v_stock
      OR v_product.current_stock::numeric <> v_stock THEN
      PERFORM private.raise_pos_operation_error('INVENTORY_RECONCILIATION_REQUIRED', 'A product no longer matches its locked shadow balance.');
    END IF;

    IF v_stock > 0 THEN
      INSERT INTO public.inventory_movements (
        store_id, product_id, product_name, selling_option_id,
        selling_option_label, unit_label, movement_type, quantity_delta,
        stock_before, stock_after, stock_source, reference_type, reference_id,
        note, created_by, location_id, balance_id, operation_id,
        source_line_key, cutover_id, origin, reason_code, base_unit_quantity,
        local_occurred_at, accounting_version, provenance
      ) VALUES (
        v_operation.store_id, v_product.id, v_product.name, NULL,
        NULL, COALESCE(NULLIF(v_product.unit, ''), 'unit'), 'opening_baseline',
        v_stock, 0, v_stock, 'product', 'inventory_cutover', v_cutover_id,
        'Opening baseline at inventory ledger cutover', v_operation.actor_id,
        v_location.id, v_balance.id, v_operation.id,
        'baseline/' || v_product.id::text, v_cutover_id, 'automatic',
        'inventory_cutover_baseline', v_stock,
        COALESCE(v_operation.local_occurred_at, pg_catalog.clock_timestamp()),
        v_operation.contract_version, 'baseline'
      ) RETURNING id INTO v_movement_id;
      v_movement_count := v_movement_count + 1;
      v_watermark_movement_id := v_movement_id;

      INSERT INTO public.inventory_movement_lots (
        store_id, movement_id, lot_id, source_allocation_id, source_slice_key,
        quantity_delta, ownership_snapshot, supplier_id_snapshot,
        supplier_name_snapshot, unit_cost_snapshot, cogs_recovery_amount
      )
      SELECT v_operation.store_id, v_movement_id, lot.id, NULL,
        'baseline/' || lot.id::text, lot_balance.quantity_on_hand,
        lot.ownership, lot.supplier_id, lot.supplier_name_snapshot,
        lot.unit_cost, 0
      FROM public.inventory_stock_lots AS lot
      JOIN public.inventory_lot_location_balances AS lot_balance
        ON lot_balance.store_id = lot.store_id AND lot_balance.lot_id = lot.id
       AND lot_balance.location_id = v_location.id
      WHERE lot.store_id = v_operation.store_id AND lot.product_id = v_product_id
        AND lot_balance.quantity_on_hand > 0
      ORDER BY lot.received_at, lot.id;
      SELECT movement.created_at INTO v_watermark_created_at
      FROM public.inventory_movements AS movement
      WHERE movement.store_id = v_operation.store_id AND movement.id = v_movement_id;
    ELSE
      v_movement_id := NULL;
    END IF;

    UPDATE public.inventory_balances AS balance
    SET provenance = 'live', observed_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    WHERE balance.store_id = v_operation.store_id AND balance.product_id = v_product_id;
    UPDATE public.inventory_lot_location_balances AS balance
    SET provenance = 'live', observed_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    WHERE balance.store_id = v_operation.store_id AND EXISTS (
      SELECT 1 FROM public.inventory_stock_lots AS lot
      WHERE lot.store_id = balance.store_id AND lot.id = balance.lot_id
        AND lot.product_id = v_product_id
    );

    INSERT INTO public.inventory_cutover_items (
      store_id, cutover_id, product_id, product_stock,
      shadow_balance_stock, source_lot_stock, sellable_lot_location_stock,
      quarantine_lot_location_stock, reconciliation_reasons, lot_snapshot,
      snapshot_sha256, baseline_movement_id
    ) VALUES (
      v_operation.store_id, v_cutover_id, v_product_id, v_stock,
      (v_item->>'shadow_balance_stock')::numeric(14,3),
      (v_item->>'source_lot_stock')::numeric(14,3),
      (v_item->>'sellable_lot_location_stock')::numeric(14,3),
      v_quarantine,
      ARRAY(SELECT jsonb_array_elements_text(v_item->'mismatch_reasons')),
      COALESCE(v_item->'lots', '[]'::jsonb),
      pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_item::text, 'UTF8'), 'sha256'), 'hex'),
      v_movement_id
    );
    v_item_count := v_item_count + 1;
  END LOOP;

  UPDATE public.inventory_cutovers AS cutover
  SET status = 'complete',
      watermark_movement_id = v_watermark_movement_id,
      watermark_movement_created_at = v_watermark_created_at,
      reconciliation_artifact_sha256 = v_snapshot_sha256,
      baseline_operation_id = v_operation.id,
      completed_at = pg_catalog.clock_timestamp(),
      completed_by = v_operation.actor_id
  WHERE cutover.id = v_cutover_id AND cutover.store_id = v_operation.store_id;

  INSERT INTO public.store_settings (store_id, feature_flags, updated_by, updated_at)
  VALUES (
    v_operation.store_id,
    '{"operations_v2":false,"inventory_ledger_v2":true,"approval_workflows":false,"drawer_shifts":false,"digital_services":false,"customer_reporting":false,"offline_escrow":false,"partial_voids":false}'::jsonb,
    v_operation.actor_id, pg_catalog.clock_timestamp()
  )
  ON CONFLICT (store_id) DO UPDATE
  SET feature_flags = public.store_settings.feature_flags ||
        '{"inventory_ledger_v2":true}'::jsonb,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at;

  v_result := pg_catalog.jsonb_build_object(
    'cutover_id', v_cutover_id,
    'status', 'complete',
    'product_count', v_item_count,
    'baseline_movement_count', v_movement_count,
    'snapshot_sha256', v_snapshot_sha256,
    'completed_at', pg_catalog.clock_timestamp()
  );
  RETURN private.finish_pos_operation(
    v_operation.store_id, v_operation.id, v_operation.kind,
    v_operation.request_hash, 'confirmed', 'inventory_cutover',
    v_cutover_id::text, 1, v_result
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_inventory_cutover(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_inventory_cutover(jsonb) TO authenticated;

-- Keep the legacy trigger behavior for stores that have not crossed the
-- boundary. After cutover, only a command carrying the active operation ID may
-- pass; sales route into the T05 allocator and legacy entry points fail closed.
CREATE OR REPLACE FUNCTION private.create_opening_stock_lot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.inventory_cutovers AS cutover
    WHERE cutover.store_id = NEW.store_id AND cutover.status = 'complete'
  ) THEN
    IF COALESCE(NEW.current_stock, 0) <> 0 THEN
      RAISE EXCEPTION 'Create the product with zero stock, then record its opening stock through the inventory command'
        USING ERRCODE = '55000', DETAIL = '{"business_code":"UPGRADE_REQUIRED","retryable":false}';
    END IF;
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.current_stock, 0) > 0 THEN
    INSERT INTO public.inventory_stock_lots (
      store_id, product_id, ownership, quantity_received, quantity_remaining,
      unit_cost, received_at
    ) VALUES (
      NEW.store_id, NEW.id, 'store_owned', NEW.current_stock, NEW.current_stock,
      COALESCE(NEW.cost_price, 0), COALESCE(NEW.created_at, pg_catalog.now())
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.ensure_live_product_inventory_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_location_id uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.inventory_cutovers AS cutover
    WHERE cutover.store_id = NEW.store_id AND cutover.status = 'complete'
  ) THEN
    SELECT location.id INTO v_location_id
    FROM public.inventory_locations AS location
    WHERE location.store_id = NEW.store_id AND location.kind = 'sellable'
      AND location.is_default AND location.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Store has no active default sellable inventory location';
    END IF;
    INSERT INTO public.inventory_balances (
      store_id, product_id, location_id, quantity_on_hand, provenance
    ) VALUES (NEW.store_id, NEW.id, v_location_id, 0, 'live')
    ON CONFLICT (store_id, product_id, location_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.ensure_live_product_inventory_balance()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS ensure_live_product_inventory_balance_trigger ON public.products;
CREATE TRIGGER ensure_live_product_inventory_balance_trigger
  AFTER INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION private.ensure_live_product_inventory_balance();

CREATE OR REPLACE FUNCTION private.allocate_sale_item_stock_lots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_store_id uuid;
  v_lot public.inventory_stock_lots%ROWTYPE;
  v_remaining numeric := COALESCE(NEW.base_unit_quantity, NEW.quantity, 0);
  v_take numeric;
  v_total_cost numeric := 0;
  v_has_owned boolean := false;
  v_has_consigned boolean := false;
BEGIN
  SELECT sale.store_id INTO v_store_id
  FROM public.sales AS sale WHERE sale.id = NEW.sale_id;
  IF v_store_id IS NULL THEN RAISE EXCEPTION 'Sale % does not exist', NEW.sale_id; END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory_cutovers AS cutover
    WHERE cutover.store_id = v_store_id AND cutover.status = 'complete'
  ) THEN
    IF NULLIF(pg_catalog.current_setting('kodigo.pos_operation_id', true), '') IS NULL THEN
      RAISE EXCEPTION 'This client must be upgraded to the ledger checkout command'
        USING ERRCODE = '55000', DETAIL = '{"business_code":"UPGRADE_REQUIRED","retryable":false}';
    END IF;
    RETURN NEW;
  END IF;

  IF v_remaining <= 0 THEN RAISE EXCEPTION 'Sale line has no base-unit quantity'; END IF;
  FOR v_lot IN
    SELECT lot.* FROM public.inventory_stock_lots AS lot
    WHERE lot.store_id = v_store_id AND lot.product_id = NEW.product_id
      AND lot.quantity_remaining > 0
    ORDER BY lot.received_at, lot.id
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_lot.quantity_remaining, v_remaining);
    UPDATE public.inventory_stock_lots AS lot
    SET quantity_remaining = lot.quantity_remaining - v_take,
        quantity_sold = lot.quantity_sold + v_take
    WHERE lot.store_id = v_store_id AND lot.id = v_lot.id;
    INSERT INTO public.sale_item_stock_allocations (
      store_id, sale_item_id, lot_id, quantity_base_units, unit_cost,
      ownership, supplier_id
    ) VALUES (
      v_store_id, NEW.id, v_lot.id, v_take, v_lot.unit_cost,
      v_lot.ownership, v_lot.supplier_id
    );
    v_total_cost := v_total_cost + (v_take * v_lot.unit_cost);
    v_has_owned := v_has_owned OR v_lot.ownership = 'store_owned';
    v_has_consigned := v_has_consigned OR v_lot.ownership = 'consigned';
    v_remaining := v_remaining - v_take;
  END LOOP;
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Inventory ownership lots are short by % base units for product %', v_remaining, NEW.product_id;
  END IF;
  NEW.cost_per_base_unit := CASE WHEN COALESCE(NEW.base_unit_quantity, 0) > 0
    THEN v_total_cost / NEW.base_unit_quantity ELSE 0 END;
  NEW.cogs := v_total_cost;
  NEW.cost_price := CASE WHEN COALESCE(NEW.quantity, 0) > 0
    THEN v_total_cost / NEW.quantity ELSE 0 END;
  NEW.gross_profit := NEW.line_total - v_total_cost;
  NEW.gross_margin := CASE WHEN NEW.line_total > 0
    THEN (NEW.line_total - v_total_cost) / NEW.line_total ELSE 0 END;
  NEW.stock_source := CASE WHEN v_has_owned AND v_has_consigned THEN 'mixed'
    WHEN v_has_consigned THEN 'consigned' ELSE 'product' END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_deduct_stock_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale_store uuid;
  v_product public.products%ROWTYPE;
  v_option public.product_selling_options%ROWTYPE;
  v_balance public.inventory_balances%ROWTYPE;
  v_location_id uuid;
  v_operation_id uuid;
  v_multiplier numeric := 1;
  v_required_base numeric;
  v_before numeric;
  v_after numeric;
  v_expected_version bigint;
BEGIN
  SELECT sale.store_id INTO v_sale_store
  FROM public.sales AS sale WHERE sale.id = NEW.sale_id;
  IF v_sale_store IS NULL THEN RAISE EXCEPTION 'Sale % does not exist', NEW.sale_id; END IF;

  IF EXISTS (
    SELECT 1 FROM public.inventory_cutovers AS cutover
    WHERE cutover.store_id = v_sale_store AND cutover.status = 'complete'
  ) THEN
    v_operation_id := NULLIF(pg_catalog.current_setting('kodigo.pos_operation_id', true), '')::uuid;
    IF v_operation_id IS NULL THEN
      RAISE EXCEPTION 'This client must be upgraded to the ledger checkout command'
        USING ERRCODE = '55000', DETAIL = '{"business_code":"UPGRADE_REQUIRED","retryable":false}';
    END IF;
    SELECT location.id INTO v_location_id
    FROM public.inventory_locations AS location
    WHERE location.store_id = v_sale_store AND location.kind = 'sellable'
      AND location.is_default AND location.is_active;
    SELECT balance.* INTO v_balance
    FROM public.inventory_balances AS balance
    WHERE balance.store_id = v_sale_store AND balance.product_id = NEW.product_id
      AND balance.location_id = v_location_id AND balance.provenance = 'live'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A live product balance is missing for sale item %', NEW.id
        USING ERRCODE = '55000', DETAIL = '{"business_code":"INVENTORY_RECONCILIATION_REQUIRED","retryable":false}';
    END IF;
    v_expected_version := v_balance.version;
    PERFORM private.allocate_sale_lots(pg_catalog.jsonb_build_object(
      'store_id', v_sale_store,
      'sale_id', NEW.sale_id,
      'sale_item_id', NEW.id,
      'operation_id', v_operation_id,
      'location_id', v_location_id,
      'source_line_key', NEW.id::text,
      'expected_balance_version', v_expected_version
    ));
    RETURN NEW;
  END IF;

  SELECT product.* INTO v_product
  FROM public.products AS product
  WHERE product.id = NEW.product_id
  FOR UPDATE;
  IF NOT FOUND OR v_product.store_id <> v_sale_store THEN
    RAISE EXCEPTION 'Product does not belong to sale store';
  END IF;
  IF NEW.selling_option_id IS NOT NULL THEN
    SELECT option_row.* INTO v_option
    FROM public.product_selling_options AS option_row
    WHERE option_row.id = NEW.selling_option_id
    FOR UPDATE;
    IF NOT FOUND OR v_option.product_id <> NEW.product_id
      OR v_option.store_id <> v_sale_store OR NOT v_option.is_active THEN
      RAISE EXCEPTION 'Selling option does not belong to an active sale product/store';
    END IF;
    v_multiplier := CASE WHEN v_option.is_bulk
      THEN GREATEST(COALESCE(v_option.inventory_multiplier, v_option.quantity_value, 1), 2)
      ELSE 1 END;
  END IF;
  v_required_base := NEW.quantity * v_multiplier;
  IF v_product.current_stock < v_required_base THEN
    RAISE EXCEPTION 'Insufficient base stock for %. Available base units %, required base units %',
      v_product.name, v_product.current_stock, v_required_base;
  END IF;
  v_before := v_product.current_stock;
  v_after := round(v_before - v_required_base);
  UPDATE public.products AS product
  SET current_stock = v_after, updated_at = pg_catalog.now()
  WHERE product.id = NEW.product_id;
  PERFORM private.sync_shared_option_stock(NEW.product_id, v_after);
  NEW.stock_source := 'product';
  INSERT INTO public.inventory_movements (
    store_id, product_id, product_name, selling_option_id,
    selling_option_label, unit_label, package_size, package_unit,
    movement_type, quantity_delta, stock_before, stock_after,
    stock_source, reference_type, reference_id, note, created_by
  ) VALUES (
    v_sale_store, NEW.product_id, NEW.product_name, NEW.selling_option_id,
    COALESCE(NEW.selling_option_label, v_option.label, v_product.unit),
    COALESCE(NEW.unit_label, v_product.unit, 'unit'),
    CASE WHEN v_multiplier > 1 THEN v_multiplier ELSE NULL END,
    CASE WHEN v_multiplier > 1 THEN COALESCE(v_product.unit, 'unit') ELSE NULL END,
    'sale', -v_required_base, v_before, v_after, 'product', 'sale', NEW.sale_id,
    'POS sale ' || NEW.sale_id::text, (SELECT auth.uid())
  );
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.allocate_sale_item_stock_lots() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.trg_deduct_stock_on_sale() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.sync_stock_lots_from_adjustment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_owner text := COALESCE(NULLIF(pg_catalog.current_setting('kodigo.stock_ownership', true), ''), 'store_owned');
  v_supplier_id uuid := NULLIF(pg_catalog.current_setting('kodigo.stock_supplier_id', true), '')::uuid;
  v_supplier_name text;
  v_unit_cost numeric := NULLIF(pg_catalog.current_setting('kodigo.stock_unit_cost', true), '')::numeric;
  v_remaining numeric := abs(NEW.quantity_delta);
  v_lot public.inventory_stock_lots%ROWTYPE;
  v_take numeric;
  v_operation_id uuid := NULLIF(pg_catalog.current_setting('kodigo.pos_operation_id', true), '')::uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.inventory_cutovers AS cutover
    WHERE cutover.store_id = NEW.store_id AND cutover.status = 'complete'
  ) THEN
    IF v_operation_id IS NULL
      OR NULLIF(pg_catalog.current_setting('kodigo.inventory_adjustment_writer', true), '')
        IS DISTINCT FROM v_operation_id::text
      OR NOT EXISTS (
        SELECT 1 FROM public.pos_operations AS operation
        WHERE operation.id = v_operation_id AND operation.store_id = NEW.store_id
          AND operation.status = 'processing' AND operation.actor_id = (SELECT auth.uid())
      ) THEN
      RAISE EXCEPTION 'This client must use the approved inventory command'
        USING ERRCODE = '55000', DETAIL = '{"business_code":"UPGRADE_REQUIRED","retryable":false}';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.quantity_delta > 0 THEN
    IF NEW.note LIKE 'Returned sale %' THEN RETURN NEW; END IF;
    IF v_owner NOT IN ('store_owned', 'consigned') THEN
      RAISE EXCEPTION 'Invalid inventory ownership type';
    END IF;
    IF v_owner = 'consigned' AND v_supplier_id IS NULL THEN
      RAISE EXCEPTION 'A supplier is required for consigned stock';
    END IF;
    IF v_supplier_id IS NOT NULL THEN
      SELECT supplier.name INTO v_supplier_name
      FROM public.suppliers AS supplier WHERE supplier.id = v_supplier_id;
    END IF;
    INSERT INTO public.inventory_stock_lots (
      store_id, product_id, ownership, supplier_id, supplier_name_snapshot,
      quantity_received, quantity_remaining, unit_cost, created_by
    ) VALUES (
      NEW.store_id, NEW.product_id, v_owner, v_supplier_id, v_supplier_name,
      NEW.quantity_delta, NEW.quantity_delta,
      COALESCE(v_unit_cost, (SELECT product.cost_price FROM public.products AS product WHERE product.id = NEW.product_id), 0),
      NEW.created_by
    );
  ELSIF NEW.quantity_delta < 0 THEN
    FOR v_lot IN
      SELECT lot.* FROM public.inventory_stock_lots AS lot
      WHERE lot.store_id = NEW.store_id AND lot.product_id = NEW.product_id
        AND lot.quantity_remaining > 0
      ORDER BY lot.received_at, lot.id
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(v_lot.quantity_remaining, v_remaining);
      UPDATE public.inventory_stock_lots AS lot
      SET quantity_remaining = lot.quantity_remaining - v_take
      WHERE lot.store_id = NEW.store_id AND lot.id = v_lot.id;
      v_remaining := v_remaining - v_take;
    END LOOP;
    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'Inventory ownership lots do not match product stock for product %', NEW.product_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.restore_sale_item_stock_lots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_allocation public.sale_item_stock_allocations%ROWTYPE;
  v_needed numeric;
  v_take numeric;
  v_base_per_item numeric;
  v_supplier_id uuid;
  v_store_id uuid;
  v_cost numeric;
  v_operation_id uuid := NULLIF(pg_catalog.current_setting('kodigo.pos_operation_id', true), '')::uuid;
BEGIN
  SELECT sale.store_id INTO v_store_id
  FROM public.sale_items AS item
  JOIN public.sales AS sale ON sale.id = item.sale_id
  WHERE item.id = NEW.sale_item_id;
  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'Return item has no source sale';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory_cutovers AS cutover
    WHERE cutover.store_id = v_store_id AND cutover.status = 'complete'
  ) THEN
    IF v_operation_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.pos_operations AS operation
      WHERE operation.id = v_operation_id AND operation.store_id = v_store_id
        AND operation.status = 'processing' AND operation.actor_id = (SELECT auth.uid())
    ) THEN
      RAISE EXCEPTION 'This client must use the approved return inventory command'
        USING ERRCODE = '55000', DETAIL = '{"business_code":"UPGRADE_REQUIRED","retryable":false}';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT NEW.restocked OR NEW.product_id IS NULL THEN RETURN NEW; END IF;

  SELECT item.base_unit_quantity / NULLIF(item.quantity, 0), sale.store_id,
    item.cost_per_base_unit INTO v_base_per_item, v_store_id, v_cost
  FROM public.sale_items AS item
  JOIN public.sales AS sale ON sale.id = item.sale_id
  WHERE item.id = NEW.sale_item_id;
  v_needed := NEW.quantity * COALESCE(v_base_per_item, 1);

  FOR v_allocation IN
    SELECT allocation.* FROM public.sale_item_stock_allocations AS allocation
    WHERE allocation.sale_item_id = NEW.sale_item_id
      AND allocation.quantity_returned < allocation.quantity_base_units
    ORDER BY allocation.allocation_sequence DESC
    FOR UPDATE
  LOOP
    EXIT WHEN v_needed <= 0;
    v_take := LEAST(v_allocation.quantity_base_units - v_allocation.quantity_returned, v_needed);
    UPDATE public.sale_item_stock_allocations AS allocation
    SET quantity_returned = allocation.quantity_returned + v_take
    WHERE allocation.id = v_allocation.id;
    UPDATE public.inventory_stock_lots AS lot
    SET quantity_remaining = lot.quantity_remaining + v_take,
        quantity_sold = GREATEST(0, lot.quantity_sold - v_take)
    WHERE lot.id = v_allocation.lot_id;
    v_needed := v_needed - v_take;
  END LOOP;

  IF v_needed > 0 THEN
    INSERT INTO public.inventory_stock_lots (
      store_id, product_id, ownership, quantity_received, quantity_remaining,
      unit_cost, created_by
    ) VALUES (
      v_store_id, NEW.product_id, 'store_owned', v_needed, v_needed,
      COALESCE(v_cost, 0), (SELECT auth.uid())
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.restore_sale_stock_lots_after_void()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_allocation public.sale_item_stock_allocations%ROWTYPE;
  v_restore numeric;
  v_operation_id uuid := NULLIF(pg_catalog.current_setting('kodigo.pos_operation_id', true), '')::uuid;
BEGIN
  IF OLD.status <> 'completed' OR NEW.status <> 'voided' THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory_cutovers AS cutover
    WHERE cutover.store_id = NEW.store_id AND cutover.status = 'complete'
  ) THEN
    IF v_operation_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.pos_operations AS operation
      WHERE operation.id = v_operation_id AND operation.store_id = NEW.store_id
        AND operation.status = 'processing' AND operation.actor_id = (SELECT auth.uid())
    ) THEN
      RAISE EXCEPTION 'This client must use the approved void inventory command'
        USING ERRCODE = '55000', DETAIL = '{"business_code":"UPGRADE_REQUIRED","retryable":false}';
    END IF;
    RETURN NEW;
  END IF;

  FOR v_allocation IN
    SELECT allocation.* FROM public.sale_item_stock_allocations AS allocation
    JOIN public.sale_items AS item ON item.id = allocation.sale_item_id
    WHERE item.sale_id = NEW.id
      AND allocation.quantity_returned < allocation.quantity_base_units
    ORDER BY allocation.allocation_sequence DESC
    FOR UPDATE OF allocation
  LOOP
    v_restore := v_allocation.quantity_base_units - v_allocation.quantity_returned;
    UPDATE public.inventory_stock_lots AS lot
    SET quantity_remaining = lot.quantity_remaining + v_restore,
        quantity_sold = CASE WHEN v_allocation.ownership = 'consigned'
          THEN GREATEST(0, lot.quantity_sold - v_restore)
          ELSE lot.quantity_sold END
    WHERE lot.id = v_allocation.lot_id;
    UPDATE public.sale_item_stock_allocations AS allocation
    SET quantity_returned = allocation.quantity_base_units
    WHERE allocation.id = v_allocation.id;
  END LOOP;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.restore_sale_item_stock_lots() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.restore_sale_stock_lots_after_void() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_log_stock_adjustment_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_product_name text;
  v_operation_id uuid := NULLIF(pg_catalog.current_setting('kodigo.pos_operation_id', true), '')::uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.inventory_cutovers AS cutover
    WHERE cutover.store_id = NEW.store_id AND cutover.status = 'complete'
  ) THEN
    IF v_operation_id IS NULL
      OR NULLIF(pg_catalog.current_setting('kodigo.inventory_adjustment_writer', true), '')
        IS DISTINCT FROM v_operation_id::text
      OR NOT EXISTS (
        SELECT 1 FROM public.pos_operations AS operation
        WHERE operation.id = v_operation_id AND operation.store_id = NEW.store_id
          AND operation.status = 'processing' AND operation.actor_id = (SELECT auth.uid())
      ) THEN
      RAISE EXCEPTION 'Direct stock adjustment inserts are disabled after inventory cutover'
        USING ERRCODE = '55000', DETAIL = '{"business_code":"UPGRADE_REQUIRED","retryable":false}';
    END IF;
    RETURN NEW;
  END IF;
  SELECT product.name INTO v_product_name
  FROM public.products AS product WHERE product.id = NEW.product_id;
  INSERT INTO public.inventory_movements (
    store_id, product_id, product_name, selling_option_id,
    selling_option_label, unit_label, package_size, package_unit,
    movement_type, quantity_delta, stock_before, stock_after,
    stock_source, reference_type, reference_id, note, created_by
  ) VALUES (
    NEW.store_id, NEW.product_id, COALESCE(v_product_name, 'Unknown product'),
    NEW.selling_option_id, NEW.selling_option_label,
    COALESCE(NEW.unit_label, 'unit'), NEW.package_size, NEW.package_unit,
    CASE WHEN NEW.stock_source = 'conversion' AND NEW.quantity_delta < 0 THEN 'conversion_out'
      WHEN NEW.stock_source = 'conversion' AND NEW.quantity_delta > 0 THEN 'conversion_in'
      ELSE NEW.reason::text END,
    NEW.quantity_delta, NEW.stock_before, NEW.stock_after,
    COALESCE(NEW.stock_source, CASE WHEN NEW.selling_option_id IS NULL THEN 'product' ELSE 'selling_option' END),
    'stock_adjustment', NEW.id, COALESCE(NEW.note, ''), NEW.created_by
  );
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.create_opening_stock_lot() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.sync_stock_lots_from_adjustment() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.trg_log_stock_adjustment_movement() FROM PUBLIC, anon, authenticated, service_role;

-- Retain each legacy implementation privately for stores that have not yet
-- crossed the cutover. The public signatures remain stable and fail closed
-- after cutover so old clients cannot bypass the T05 writer.
ALTER FUNCTION public.adjust_inventory_stock(uuid, uuid, numeric, text, text) SET SCHEMA private;
ALTER FUNCTION private.adjust_inventory_stock(uuid, uuid, numeric, text, text)
  RENAME TO legacy_adjust_inventory_stock_t06;
ALTER FUNCTION public.receive_product_stock(uuid, uuid, numeric, text, numeric, numeric, text, uuid, text) SET SCHEMA private;
ALTER FUNCTION private.receive_product_stock(uuid, uuid, numeric, text, numeric, numeric, text, uuid, text)
  RENAME TO legacy_receive_product_stock_t06;
ALTER FUNCTION public.restock_product_inventory_v2(uuid, uuid, numeric, text, numeric, numeric, text) SET SCHEMA private;
ALTER FUNCTION private.restock_product_inventory_v2(uuid, uuid, numeric, text, numeric, numeric, text)
  RENAME TO legacy_restock_product_inventory_v2_t06;
ALTER FUNCTION public.restock_product_inventory(uuid, numeric, text, numeric, numeric, text) SET SCHEMA private;
ALTER FUNCTION private.restock_product_inventory(uuid, numeric, text, numeric, numeric, text)
  RENAME TO legacy_restock_product_inventory_t06;
ALTER FUNCTION public.void_pos_sale(uuid, text) SET SCHEMA private;
ALTER FUNCTION private.void_pos_sale(uuid, text) RENAME TO legacy_void_pos_sale_t06;
ALTER FUNCTION public.return_sale_items(uuid, jsonb, text, public.payment_method, text) SET SCHEMA private;
ALTER FUNCTION private.return_sale_items(uuid, jsonb, text, public.payment_method, text)
  RENAME TO legacy_return_sale_items_t06;

REVOKE ALL ON FUNCTION private.legacy_adjust_inventory_stock_t06(uuid, uuid, numeric, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.legacy_receive_product_stock_t06(uuid, uuid, numeric, text, numeric, numeric, text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.legacy_restock_product_inventory_v2_t06(uuid, uuid, numeric, text, numeric, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.legacy_restock_product_inventory_t06(uuid, numeric, text, numeric, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.legacy_void_pos_sale_t06(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.legacy_return_sale_items_t06(uuid, jsonb, text, public.payment_method, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.assert_legacy_stock_path_open(p_store_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.inventory_cutovers AS cutover
    WHERE cutover.store_id = p_store_id AND cutover.status = 'complete'
  ) THEN
    PERFORM private.raise_pos_operation_error(
      'UPGRADE_REQUIRED', 'This client must be upgraded to the centralized inventory command.', '55000'
    );
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION private.assert_legacy_stock_path_open(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.adjust_inventory_stock(
  p_product_id uuid, p_selling_option_id uuid, p_quantity_delta numeric,
  p_reason text, p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_store_id uuid;
BEGIN
  SELECT product.store_id INTO v_store_id
  FROM public.products AS product WHERE product.id = p_product_id;
  IF v_store_id IS NULL OR NOT public.user_belongs_to_store(v_store_id) THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'Product is unavailable in this store.', '42501');
  END IF;
  PERFORM private.assert_legacy_stock_path_open(v_store_id);
  RETURN private.legacy_adjust_inventory_stock_t06(
    p_product_id, p_selling_option_id, p_quantity_delta, p_reason, p_note
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.adjust_inventory_stock(uuid, uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_inventory_stock(uuid, uuid, numeric, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.receive_product_stock(
  p_product_id uuid, p_restocking_option_id uuid,
  p_quantity_in_purchase_units numeric, p_purchase_unit text,
  p_pieces_per_purchase_unit numeric, p_total_supplier_cost numeric,
  p_ownership text DEFAULT 'store_owned', p_supplier_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_store_id uuid;
BEGIN
  SELECT product.store_id INTO v_store_id
  FROM public.products AS product WHERE product.id = p_product_id;
  IF v_store_id IS NULL OR NOT public.user_belongs_to_store(v_store_id) THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'Product is unavailable in this store.', '42501');
  END IF;
  PERFORM private.assert_legacy_stock_path_open(v_store_id);
  RETURN private.legacy_receive_product_stock_t06(
    p_product_id, p_restocking_option_id, p_quantity_in_purchase_units,
    p_purchase_unit, p_pieces_per_purchase_unit, p_total_supplier_cost,
    p_ownership, p_supplier_id, p_note
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.receive_product_stock(uuid, uuid, numeric, text, numeric, numeric, text, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_product_stock(uuid, uuid, numeric, text, numeric, numeric, text, uuid, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.restock_product_inventory_v2(
  p_product_id uuid, p_restocking_option_id uuid DEFAULT NULL,
  p_quantity_in_purchase_units numeric DEFAULT NULL, p_purchase_unit text DEFAULT NULL,
  p_pieces_per_purchase_unit numeric DEFAULT NULL, p_total_supplier_cost numeric DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_store_id uuid;
BEGIN
  SELECT product.store_id INTO v_store_id
  FROM public.products AS product WHERE product.id = p_product_id;
  IF v_store_id IS NULL OR NOT public.user_belongs_to_store(v_store_id) THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'Product is unavailable in this store.', '42501');
  END IF;
  PERFORM private.assert_legacy_stock_path_open(v_store_id);
  RETURN private.legacy_restock_product_inventory_v2_t06(
    p_product_id, p_restocking_option_id, p_quantity_in_purchase_units,
    p_purchase_unit, p_pieces_per_purchase_unit, p_total_supplier_cost, p_note
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.restock_product_inventory_v2(uuid, uuid, numeric, text, numeric, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restock_product_inventory_v2(uuid, uuid, numeric, text, numeric, numeric, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.restock_product_inventory(
  p_product_id uuid, p_quantity_in_purchase_units numeric,
  p_purchase_unit text, p_pieces_per_purchase_unit numeric,
  p_purchase_price_per_unit numeric, p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_store_id uuid;
BEGIN
  SELECT product.store_id INTO v_store_id
  FROM public.products AS product WHERE product.id = p_product_id;
  IF v_store_id IS NULL OR NOT public.user_belongs_to_store(v_store_id) THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'Product is unavailable in this store.', '42501');
  END IF;
  PERFORM private.assert_legacy_stock_path_open(v_store_id);
  RETURN private.legacy_restock_product_inventory_t06(
    p_product_id, p_quantity_in_purchase_units, p_purchase_unit,
    p_pieces_per_purchase_unit, p_purchase_price_per_unit, p_note
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.restock_product_inventory(uuid, numeric, text, numeric, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restock_product_inventory(uuid, numeric, text, numeric, numeric, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.void_pos_sale(p_sale_id uuid, p_reason text)
RETURNS public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_store_id uuid;
BEGIN
  SELECT sale.store_id INTO v_store_id FROM public.sales AS sale WHERE sale.id = p_sale_id;
  IF v_store_id IS NULL OR NOT public.user_belongs_to_store(v_store_id) THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'Sale is unavailable in this store.', '42501');
  END IF;
  PERFORM private.assert_legacy_stock_path_open(v_store_id);
  RETURN private.legacy_void_pos_sale_t06(p_sale_id, p_reason);
END;
$function$;
REVOKE ALL ON FUNCTION public.void_pos_sale(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_pos_sale(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.return_sale_items(
  p_sale_id uuid, p_items jsonb, p_reason text,
  p_refund_method public.payment_method, p_reference text
)
RETURNS public.sale_returns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_store_id uuid;
BEGIN
  SELECT sale.store_id INTO v_store_id FROM public.sales AS sale WHERE sale.id = p_sale_id;
  IF v_store_id IS NULL OR NOT public.user_belongs_to_store(v_store_id) THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'Sale is unavailable in this store.', '42501');
  END IF;
  PERFORM private.assert_legacy_stock_path_open(v_store_id);
  RETURN private.legacy_return_sale_items_t06(
    p_sale_id, p_items, p_reason, p_refund_method, p_reference
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.return_sale_items(uuid, jsonb, text, public.payment_method, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_sale_items(uuid, jsonb, text, public.payment_method, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.process_pos_sale_v5(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
  v_payload jsonb;
  v_line jsonb;
  v_item jsonb;
  v_items_v4 jsonb := '[]'::jsonb;
  v_sale public.sales%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_location_id uuid;
  v_lock record;
  v_product_ids uuid[];
  v_expected_balance_count integer;
  v_actual_balance_count integer;
  v_movement_ids jsonb;
  v_item_count integer;
  v_customer_id uuid;
  v_sale_id uuid;
  v_result jsonb;
BEGIN
  v_operation := private.begin_pos_operation('pos_sale', p_command);
  IF v_operation.status = 'committed' THEN
    RETURN v_operation.response;
  END IF;
  PERFORM private.assert_store_feature_enabled(v_operation.store_id, 'inventory_ledger_v2');
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_cutovers AS cutover
    WHERE cutover.store_id = v_operation.store_id AND cutover.status = 'complete'
  ) THEN
    PERFORM private.raise_pos_operation_error('FEATURE_DISABLED', 'Inventory ledger cutover is not complete.', '42501');
  END IF;
  IF private.store_feature_enabled(v_operation.store_id, 'drawer_shifts')
    AND (v_operation.shift_id IS NULL OR v_operation.terminal_id IS NULL) THEN
    PERFORM private.raise_pos_operation_error('SHIFT_REQUIRED', 'A registered terminal and open shift are required for checkout.', '42501');
  END IF;

  v_payload := p_command->'payload';
  IF private.jsonb_object_key_count(v_payload) <> 19
    OR NOT (v_payload ?& ARRAY[
      'id', 'subtotal', 'tax', 'discount', 'total', 'amount_tendered', 'change',
      'payment_method', 'payment_reference', 'discount_type', 'discount_value',
      'tax_rate', 'customer_name', 'customer_tin', 'customer_address',
      'terminal_identifier', 'discount_category', 'customer_id', 'items'
    ])
    OR pg_catalog.jsonb_typeof(v_payload->'id') IS DISTINCT FROM 'string'
    OR v_payload->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR pg_catalog.jsonb_typeof(v_payload->'items') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(v_payload->'items') = 0
    OR pg_catalog.jsonb_typeof(v_payload->'payment_method') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'discount_type') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'discount_category') IS DISTINCT FROM 'string' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Sale command payload is incomplete or malformed.');
  END IF;
  v_sale_id := (v_payload->>'id')::uuid;
  IF jsonb_typeof(v_payload->'customer_id') = 'string' THEN
    IF v_payload->>'customer_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Customer identifier must be a UUID or null.');
    END IF;
    v_customer_id := (v_payload->>'customer_id')::uuid;
  ELSIF v_payload->'customer_id' <> 'null'::jsonb THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Customer identifier must be a UUID or null.');
  END IF;

  SELECT location.id INTO v_location_id
  FROM public.inventory_locations AS location
  WHERE location.store_id = v_operation.store_id AND location.kind = 'sellable'
    AND location.is_default AND location.is_active;
  IF v_location_id IS NULL THEN
    PERFORM private.raise_pos_operation_error('INVENTORY_LOCATION_MISSING', 'The default sellable inventory location is missing.');
  END IF;

  FOR v_line IN
    SELECT value FROM pg_catalog.jsonb_array_elements(v_payload->'items') AS items(value)
  LOOP
    IF pg_catalog.jsonb_typeof(v_line) IS DISTINCT FROM 'object'
      OR private.jsonb_object_key_count(v_line) <> 4
      OR NOT (v_line ?& ARRAY['product_id', 'selling_option_id', 'quantity', 'discount_per_unit'])
      OR pg_catalog.jsonb_typeof(v_line->'product_id') IS DISTINCT FROM 'string'
      OR v_line->>'product_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR (v_line->'selling_option_id' <> 'null'::jsonb AND (
        pg_catalog.jsonb_typeof(v_line->'selling_option_id') IS DISTINCT FROM 'string'
        OR v_line->>'selling_option_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ))
      OR pg_catalog.jsonb_typeof(v_line->'quantity') IS DISTINCT FROM 'number'
      OR v_line->>'quantity' !~ '^[1-9][0-9]*$'
      OR pg_catalog.jsonb_typeof(v_line->'discount_per_unit') IS DISTINCT FROM 'number'
      OR v_line->>'discount_per_unit' !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Sale item fields are invalid.');
    END IF;
    v_items_v4 := v_items_v4 || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'productId', v_line->'product_id',
      'sellingOptionId', v_line->'selling_option_id',
      'quantity', v_line->'quantity',
      'itemDiscountPerUnit', v_line->'discount_per_unit'
    ));
  END LOOP;

  SELECT pg_catalog.array_agg(DISTINCT (line.value->>'product_id')::uuid ORDER BY (line.value->>'product_id')::uuid)
  INTO v_product_ids
  FROM pg_catalog.jsonb_array_elements(v_payload->'items') AS line(value);
  SELECT pg_catalog.cardinality(v_product_ids)::integer INTO v_expected_balance_count;

  -- Lock all touched balances and lots in deterministic order before the v4
  -- pricing/snapshot routine inserts lines. Its stock trigger then invokes the
  -- same T05 FIFO allocator for each persisted line.
  FOR v_lock IN
    SELECT balance.id
    FROM public.inventory_balances AS balance
    WHERE balance.store_id = v_operation.store_id
      AND balance.location_id = v_location_id
      AND balance.product_id = ANY (v_product_ids)
    ORDER BY balance.product_id, balance.location_id
    FOR UPDATE OF balance
  LOOP NULL; END LOOP;
  SELECT pg_catalog.count(*)::integer INTO v_actual_balance_count
  FROM public.inventory_balances AS balance
  WHERE balance.store_id = v_operation.store_id
    AND balance.location_id = v_location_id
    AND balance.product_id = ANY (v_product_ids)
    AND balance.provenance = 'live';
  IF v_actual_balance_count <> v_expected_balance_count THEN
    PERFORM private.raise_pos_operation_error('INVENTORY_RECONCILIATION_REQUIRED', 'One or more sale products have no live inventory balance.');
  END IF;
  FOR v_lock IN
    SELECT lot_balance.id
    FROM public.inventory_lot_location_balances AS lot_balance
    JOIN public.inventory_stock_lots AS lot
      ON lot.store_id = lot_balance.store_id AND lot.id = lot_balance.lot_id
    WHERE lot_balance.store_id = v_operation.store_id
      AND lot_balance.location_id = v_location_id
      AND lot.product_id = ANY (v_product_ids)
    ORDER BY lot_balance.lot_id
    FOR UPDATE OF lot_balance
  LOOP NULL; END LOOP;
  FOR v_lock IN
    SELECT lot.id
    FROM public.inventory_stock_lots AS lot
    WHERE lot.store_id = v_operation.store_id AND lot.product_id = ANY (v_product_ids)
    ORDER BY lot.received_at, lot.id
    FOR UPDATE OF lot
  LOOP NULL; END LOOP;

  PERFORM pg_catalog.set_config('kodigo.pos_operation_id', v_operation.id::text, true);
  v_sale := public.process_pos_sale_v4(
    v_sale_id,
    v_operation.store_id,
    v_operation.actor_id,
    COALESCE((v_payload->>'subtotal')::numeric, 0),
    COALESCE((v_payload->>'tax')::numeric, 0),
    COALESCE((v_payload->>'discount')::numeric, 0),
    COALESCE((v_payload->>'total')::numeric, 0),
    COALESCE((v_payload->>'amount_tendered')::numeric, 0),
    COALESCE((v_payload->>'change')::numeric, 0),
    v_items_v4,
    (v_payload->>'payment_method')::public.payment_method,
    NULLIF(v_payload->>'payment_reference', ''),
    COALESCE(NULLIF(v_payload->>'discount_type', ''), 'amount'),
    NULLIF(v_payload->>'discount_value', '')::numeric,
    NULLIF(v_payload->>'tax_rate', '')::numeric,
    NULLIF(v_payload->>'customer_name', ''),
    NULLIF(v_payload->>'customer_tin', ''),
    NULLIF(v_payload->>'customer_address', ''),
    NULLIF(v_payload->>'terminal_identifier', ''),
    COALESCE(NULLIF(v_payload->>'discount_category', ''), 'regular')
  );

  IF v_customer_id IS NOT NULL THEN
    SELECT customer.* INTO v_customer
    FROM public.customers AS customer
    WHERE customer.store_id = v_operation.store_id
      AND customer.id = v_customer_id AND customer.active
    FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM private.raise_pos_operation_error('CUSTOMER_NOT_FOUND', 'The selected customer is not active in this store.');
    END IF;
    UPDATE public.sales AS sale
    SET customer_id = v_customer.id
    WHERE sale.store_id = v_operation.store_id AND sale.id = v_sale.id
      AND sale.customer_id IS NULL;
    IF NOT FOUND THEN
      PERFORM private.raise_pos_operation_error('SALE_CUSTOMER_ALREADY_LINKED', 'Sale already has a customer association.');
    END IF;
    INSERT INTO public.customer_sale_links (
      store_id, sale_id, customer_id, operation_id, link_type, linked_by, reason
    ) VALUES (
      v_operation.store_id, v_sale.id, v_customer.id, v_operation.id,
      'checkout', v_operation.actor_id, NULL
    );
    v_sale.customer_id := v_customer.id;
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_item_count
  FROM public.sale_items AS item WHERE item.sale_id = v_sale.id;
  SELECT pg_catalog.jsonb_agg(movement.id ORDER BY movement.product_id, movement.id)
  INTO v_movement_ids
  FROM public.inventory_movements AS movement
  WHERE movement.store_id = v_operation.store_id
    AND movement.operation_id = v_operation.id
    AND movement.sale_id = v_sale.id
    AND movement.movement_type = 'sale'
    AND movement.provenance = 'new';
  IF v_item_count <> pg_catalog.jsonb_array_length(v_payload->'items')
    OR COALESCE(pg_catalog.jsonb_array_length(v_movement_ids), 0) <> v_item_count THEN
    PERFORM private.raise_pos_operation_error('INVENTORY_RECONCILIATION_REQUIRED', 'Sale did not produce exactly one ledger movement for each line.');
  END IF;

  v_result := pg_catalog.jsonb_build_object(
    'sale', pg_catalog.to_jsonb(v_sale),
    'movement_ids', v_movement_ids,
    'customer_id', v_customer_id
  );
  RETURN private.finish_pos_operation(
    v_operation.store_id, v_operation.id, v_operation.kind,
    v_operation.request_hash, 'confirmed', 'sale', v_sale.id::text,
    1, v_result
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.process_pos_sale_v5(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_pos_sale_v5(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.receive_product_stock_v2(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
  v_payload jsonb;
  v_product public.products%ROWTYPE;
  v_option public.product_restocking_options%ROWTYPE;
  v_location_id uuid;
  v_balance public.inventory_balances%ROWTYPE;
  v_lot_id uuid := pg_catalog.gen_random_uuid();
  v_restock_id uuid := pg_catalog.gen_random_uuid();
  v_adjustment_id uuid := pg_catalog.gen_random_uuid();
  v_movement_id uuid;
  v_product_id uuid;
  v_option_id uuid;
  v_supplier_id uuid;
  v_store_id uuid;
  v_actor_id uuid;
  v_quantity numeric;
  v_factor numeric;
  v_base_units numeric(14,3);
  v_purchase_unit text;
  v_ownership text;
  v_total_cost numeric;
  v_unit_cost numeric(14,6);
  v_old_cost numeric;
  v_new_cost numeric;
  v_cost_change_percent numeric;
  v_previous_gross_margin numeric;
  v_new_gross_margin numeric;
  v_raw_suggested_price numeric;
  v_suggested_price numeric;
  v_rounding numeric;
  v_stock_before numeric(14,3);
  v_stock_after numeric(14,3);
  v_expected_version bigint;
  v_reason text;
  v_note text;
  v_supplier_name text;
  v_result jsonb;
BEGIN
  v_operation := private.begin_pos_operation('stock_receipt', p_command);
  IF v_operation.status = 'committed' THEN RETURN v_operation.response; END IF;
  PERFORM private.assert_store_feature_enabled(v_operation.store_id, 'inventory_ledger_v2');
  v_actor_id := v_operation.actor_id;
  IF COALESCE((SELECT profile.role::text FROM public.profiles AS profile WHERE profile.id = v_actor_id), '')
      NOT IN ('admin', 'inventory') THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'Only store admins or inventory staff can receive stock.', '42501');
  END IF;

  v_payload := p_command->'payload';
  IF private.jsonb_object_key_count(v_payload) <> 10
    OR NOT (v_payload ?& ARRAY[
      'product_id', 'restocking_option_id', 'receiving_quantity', 'purchase_unit',
      'pieces_per_purchase_unit', 'purchase_total', 'ownership', 'supplier_id', 'reason', 'note'
    ])
    OR pg_catalog.jsonb_typeof(v_payload->'product_id') IS DISTINCT FROM 'string'
    OR v_payload->>'product_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR (v_payload->'restocking_option_id' <> 'null'::jsonb AND (
      pg_catalog.jsonb_typeof(v_payload->'restocking_option_id') IS DISTINCT FROM 'string'
      OR v_payload->>'restocking_option_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ))
    OR (v_payload->'supplier_id' <> 'null'::jsonb AND (
      pg_catalog.jsonb_typeof(v_payload->'supplier_id') IS DISTINCT FROM 'string'
      OR v_payload->>'supplier_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ))
    OR pg_catalog.jsonb_typeof(v_payload->'receiving_quantity') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(v_payload->'pieces_per_purchase_unit') IS DISTINCT FROM 'number'
    OR (v_payload->'purchase_total' <> 'null'::jsonb AND pg_catalog.jsonb_typeof(v_payload->'purchase_total') IS DISTINCT FROM 'number')
    OR pg_catalog.jsonb_typeof(v_payload->'purchase_unit') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'ownership') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'reason') IS DISTINCT FROM 'string'
    OR (v_payload->'note' <> 'null'::jsonb AND pg_catalog.jsonb_typeof(v_payload->'note') IS DISTINCT FROM 'string')
    OR pg_catalog.jsonb_typeof(p_command->'expected_version') IS DISTINCT FROM 'number'
    OR p_command->>'expected_version' !~ '^[1-9][0-9]*$' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Stock receipt command is incomplete or malformed.');
  END IF;
  v_product_id := (v_payload->>'product_id')::uuid;
  v_option_id := NULLIF(v_payload->>'restocking_option_id', '')::uuid;
  v_supplier_id := NULLIF(v_payload->>'supplier_id', '')::uuid;
  v_quantity := (v_payload->>'receiving_quantity')::numeric;
  v_factor := (v_payload->>'pieces_per_purchase_unit')::numeric;
  v_total_cost := NULLIF(v_payload->>'purchase_total', '')::numeric;
  v_ownership := v_payload->>'ownership';
  v_reason := pg_catalog.btrim(v_payload->>'reason');
  v_note := NULLIF(v_payload->>'note', 'null');
  v_expected_version := (p_command->>'expected_version')::bigint;
  IF v_quantity <= 0 OR v_factor < 1 OR pg_catalog.round(v_quantity * v_factor, 3) <= 0
    OR pg_catalog.round(v_quantity * v_factor, 3) <> pg_catalog.trunc(pg_catalog.round(v_quantity * v_factor, 3))
    OR pg_catalog.length(v_reason) NOT BETWEEN 3 AND 500
    OR v_ownership NOT IN ('store_owned', 'consigned')
    OR (v_total_cost IS NOT NULL AND (v_total_cost < 0 OR v_total_cost <> pg_catalog.round(v_total_cost, 2)))
    OR (v_ownership = 'consigned' AND (v_supplier_id IS NULL OR v_total_cost IS NULL)) THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Receipt quantity, cost, ownership, or reason is invalid.');
  END IF;

  SELECT location.id INTO v_location_id
  FROM public.inventory_locations AS location
  WHERE location.store_id = v_operation.store_id AND location.kind = 'sellable'
    AND location.is_default AND location.is_active;
  IF v_location_id IS NULL THEN
    PERFORM private.raise_pos_operation_error('INVENTORY_LOCATION_MISSING', 'The default sellable inventory location is missing.');
  END IF;
  SELECT product.store_id INTO v_store_id
  FROM public.products AS product
  WHERE product.store_id = v_operation.store_id AND product.id = v_product_id;
  IF v_store_id IS NULL THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'Product is unavailable in this store.', '42501');
  END IF;
  INSERT INTO public.inventory_balances (store_id, product_id, location_id, provenance)
  VALUES (v_operation.store_id, v_product_id, v_location_id, 'live')
  ON CONFLICT (store_id, product_id, location_id) DO NOTHING;
  SELECT balance.* INTO v_balance
  FROM public.inventory_balances AS balance
  WHERE balance.store_id = v_operation.store_id AND balance.product_id = v_product_id
    AND balance.location_id = v_location_id
  FOR UPDATE;
  IF NOT FOUND OR v_balance.provenance <> 'live' OR v_balance.version <> v_expected_version THEN
    PERFORM private.raise_pos_operation_error('VERSION_CONFLICT', 'Inventory changed; refresh stock before receiving.', '40001');
  END IF;
  SELECT product.* INTO v_product
  FROM public.products AS product
  WHERE product.store_id = v_operation.store_id AND product.id = v_product_id
  FOR UPDATE;
  IF v_product.current_stock::numeric <> v_balance.quantity_on_hand THEN
    PERFORM private.raise_pos_operation_error('INVENTORY_RECONCILIATION_REQUIRED', 'Product projection does not match the live inventory balance.');
  END IF;

  IF v_option_id IS NOT NULL THEN
    SELECT option_row.* INTO v_option
    FROM public.product_restocking_options AS option_row
    WHERE option_row.id = v_option_id AND option_row.store_id = v_operation.store_id
      AND option_row.product_id = v_product_id AND option_row.is_active
    FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Restocking option is unavailable.');
    END IF;
    v_factor := v_option.conversion_factor;
    v_purchase_unit := v_option.label;
  ELSE
    v_purchase_unit := COALESCE(NULLIF(pg_catalog.btrim(v_payload->>'purchase_unit'), ''), v_product.purchase_unit, v_product.unit, 'unit');
  END IF;
  v_base_units := pg_catalog.round(v_quantity * v_factor, 3)::numeric(14,3);
  v_stock_before := v_balance.quantity_on_hand;
  v_stock_after := v_stock_before + v_base_units;
  v_old_cost := COALESCE(v_product.cost_price, 0);
  v_new_cost := CASE
    WHEN v_ownership = 'consigned' OR v_total_cost IS NULL THEN v_old_cost
    ELSE pg_catalog.round(v_total_cost / v_base_units, 4)
  END;
  v_unit_cost := CASE
    WHEN v_total_cost IS NOT NULL THEN pg_catalog.round(v_total_cost / v_base_units, 6)::numeric(14,6)
    ELSE pg_catalog.round(v_old_cost, 6)::numeric(14,6)
  END;
  IF v_old_cost > 0 THEN
    v_cost_change_percent := pg_catalog.round((v_new_cost - v_old_cost) / v_old_cost * 100, 4);
  ELSIF v_new_cost > 0 THEN
    v_cost_change_percent := 100;
  ELSE v_cost_change_percent := 0; END IF;
  v_raw_suggested_price := CASE
    WHEN v_new_cost > 0 AND v_product.margin_percentage IS NOT NULL
      THEN v_new_cost / GREATEST(1 - v_product.margin_percentage / 100, 0.0001)
    WHEN v_new_cost > 0 AND v_old_cost > 0
      THEN COALESCE(v_product.selling_price, 0) * v_new_cost / v_old_cost
    ELSE COALESCE(v_product.selling_price, 0) END;
  v_rounding := GREATEST(COALESCE(v_product.price_rounding, 1), 0.01);
  v_previous_gross_margin := CASE WHEN COALESCE(v_product.selling_price, 0) > 0
    THEN (v_product.selling_price - v_old_cost) / v_product.selling_price ELSE 0 END;
  v_new_gross_margin := CASE WHEN COALESCE(v_product.selling_price, 0) > 0
    THEN (v_product.selling_price - v_new_cost) / v_product.selling_price ELSE 0 END;
  v_suggested_price := CASE WHEN v_raw_suggested_price > 0
    THEN pg_catalog.ceil(v_raw_suggested_price / v_rounding) * v_rounding ELSE 0 END;
  IF v_supplier_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.supplier_stores AS supplier_store
      WHERE supplier_store.store_id = v_operation.store_id
        AND supplier_store.supplier_id = v_supplier_id
    ) THEN
      PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'Supplier is not assigned to this store.', '42501');
    END IF;
    SELECT supplier.name INTO v_supplier_name
    FROM public.suppliers AS supplier WHERE supplier.id = v_supplier_id;
  END IF;

  PERFORM pg_catalog.set_config('kodigo.pos_operation_id', v_operation.id::text, true);
  PERFORM pg_catalog.set_config('kodigo.inventory_adjustment_writer', v_operation.id::text, true);
  INSERT INTO public.restock_history (
    id, store_id, product_id, restocking_option_id,
    quantity_in_purchase_units, purchase_unit, pieces_per_purchase_unit,
    pieces_added, purchase_price_per_unit, purchase_price_per_piece,
    total_supplier_cost, cost_before, cost_after, cost_change_percent,
    suggested_selling_price, raw_suggested_selling_price, price_rounding,
    stock_before, stock_after, restocked_by, note
  ) VALUES (
    v_restock_id, v_operation.store_id, v_product_id, v_option_id,
    v_quantity, v_purchase_unit, v_factor, v_base_units,
    CASE WHEN v_total_cost IS NULL THEN 0 ELSE pg_catalog.round(v_total_cost / GREATEST(v_quantity, 1), 2) END,
    v_new_cost, CASE WHEN v_ownership = 'consigned' THEN NULL ELSE v_total_cost END,
    v_old_cost, v_new_cost, v_cost_change_percent, v_suggested_price,
    v_raw_suggested_price, v_rounding, v_stock_before, v_stock_after,
    v_actor_id, COALESCE(v_note, v_reason)
  );
  INSERT INTO public.stock_adjustments (
    id, store_id, product_id, unit_label, package_size, package_unit,
    stock_source, reason, quantity_delta, stock_before, stock_after,
    note, created_by
  ) VALUES (
    v_adjustment_id, v_operation.store_id, v_product_id, v_product.unit,
    v_factor, v_purchase_unit, 'product', 'restock'::public.adjustment_reason,
    v_base_units, v_stock_before, v_stock_after, COALESCE(v_note, v_reason), v_actor_id
  );
  INSERT INTO public.inventory_stock_lots (
    id, store_id, product_id, ownership, supplier_id, supplier_name_snapshot,
    quantity_received, quantity_remaining, unit_cost, created_by, received_at,
    location_id, source_operation_id, source_receiving_id, status,
    received_purchase_quantity, purchase_unit_label, pieces_per_purchase_unit
  ) VALUES (
    v_lot_id, v_operation.store_id, v_product_id, v_ownership, v_supplier_id, v_supplier_name,
    v_base_units, 0, v_unit_cost, v_actor_id, pg_catalog.clock_timestamp(),
    v_location_id, v_operation.id, v_restock_id, 'exhausted',
    v_quantity, v_purchase_unit, v_factor
  );
  v_movement_id := private.apply_inventory_movement(pg_catalog.jsonb_build_object(
    'store_id', v_operation.store_id,
    'product_id', v_product_id,
    'location_id', v_location_id,
    'operation_id', v_operation.id,
    'source_line_key', 'receipt/' || v_restock_id::text,
    'movement_type', 'restock',
    'origin', 'automatic',
    'reason_code', 'supplier_restocking',
    'quantity_delta', v_base_units,
    'expected_balance_version', v_balance.version,
    'unit_label', COALESCE(v_product.unit, 'unit'),
    'adjustment_id', v_adjustment_id,
    'local_occurred_at', COALESCE(v_operation.local_occurred_at, pg_catalog.clock_timestamp()),
    'terminal_id', v_operation.terminal_id,
    'accounting_version', v_operation.contract_version,
    'note', COALESCE(v_note, v_reason),
    'slices', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'lot_id', v_lot_id,
      'quantity_delta', v_base_units,
      'source_allocation_id', NULL,
      'source_slice_key', 'receipt/' || v_restock_id::text
    ))
  ));
  IF v_total_cost IS NOT NULL OR v_ownership = 'consigned' THEN
    UPDATE public.products AS product
    SET cost_price = CASE WHEN v_ownership = 'consigned' OR v_total_cost IS NULL THEN product.cost_price ELSE v_new_cost END,
        purchase_unit = v_purchase_unit,
        conversion_factor = pg_catalog.round(v_factor),
        bulk_purchase_price = CASE WHEN v_total_cost IS NULL THEN product.bulk_purchase_price
          ELSE pg_catalog.round(v_total_cost / GREATEST(v_quantity, 1), 2) END,
        updated_at = pg_catalog.clock_timestamp()
    WHERE product.store_id = v_operation.store_id AND product.id = v_product_id;
  ELSE
    UPDATE public.products AS product
    SET purchase_unit = v_purchase_unit,
        conversion_factor = pg_catalog.round(v_factor),
        updated_at = pg_catalog.clock_timestamp()
    WHERE product.store_id = v_operation.store_id AND product.id = v_product_id;
  END IF;

  v_result := pg_catalog.jsonb_build_object(
    'restockId', v_restock_id,
    'productId', v_product_id,
    'purchaseUnit', v_purchase_unit,
    'quantityReceived', v_quantity,
    'conversionFactor', v_factor,
    'baseUnitsAdded', v_base_units,
    'stockBefore', v_stock_before,
    'stockAfter', v_stock_after,
    'totalSupplierCost', v_total_cost,
    'previousCostPerBaseUnit', v_old_cost,
    'newCostPerBaseUnit', v_new_cost,
    'costChangePercent', v_cost_change_percent,
    'previousGrossMargin', v_previous_gross_margin,
    'newGrossMargin', v_new_gross_margin,
    'currentSellingPrice', COALESCE(v_product.selling_price, 0),
    'suggestedSellingPrice', v_suggested_price,
    'rawSuggestedSellingPrice', v_raw_suggested_price,
    'priceRounding', v_rounding,
    'ownership', v_ownership,
    'supplierId', v_supplier_id,
    'stockLotId', v_lot_id,
    'movementId', v_movement_id
  );
  RETURN private.finish_pos_operation(
    v_operation.store_id, v_operation.id, v_operation.kind,
    v_operation.request_hash, 'confirmed', 'stock_receipt',
    v_restock_id::text, 1, v_result
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.receive_product_stock_v2(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_product_stock_v2(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_inventory_product_balance(
  p_store_id uuid,
  p_product_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_location_id uuid;
  v_balance public.inventory_balances%ROWTYPE;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.user_belongs_to_store(p_store_id) THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'The authenticated user is not assigned to this store.', '42501');
  END IF;
  IF NOT private.store_feature_enabled(p_store_id, 'inventory_ledger_v2') THEN
    PERFORM private.raise_pos_operation_error('FEATURE_DISABLED', 'Inventory ledger cutover is not complete.', '42501');
  END IF;
  SELECT location.id INTO v_location_id
  FROM public.inventory_locations AS location
  WHERE location.store_id = p_store_id AND location.kind = 'sellable'
    AND location.is_default AND location.is_active;
  SELECT balance.* INTO v_balance
  FROM public.inventory_balances AS balance
  WHERE balance.store_id = p_store_id AND balance.product_id = p_product_id
    AND balance.location_id = v_location_id AND balance.provenance = 'live';
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('INVENTORY_RECONCILIATION_REQUIRED', 'A live product balance is missing.');
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'store_id', p_store_id,
    'product_id', p_product_id,
    'location_id', v_location_id,
    'quantity_on_hand', v_balance.quantity_on_hand,
    'version', v_balance.version
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_inventory_product_balance(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_product_balance(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.apply_manual_inventory_adjustment(
  p_operation public.pos_operations,
  p_product_id uuid,
  p_location_id uuid,
  p_delta numeric,
  p_reason public.adjustment_reason,
  p_note text,
  p_expected_version bigint,
  p_approved_by uuid DEFAULT NULL,
  p_approved_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_location public.inventory_locations%ROWTYPE;
  v_balance public.inventory_balances%ROWTYPE;
  v_lot record;
  v_lock record;
  v_lot_id uuid;
  v_adjustment_id uuid := pg_catalog.gen_random_uuid();
  v_movement_id uuid;
  v_before numeric(14,3);
  v_after numeric(14,3);
  v_remaining numeric(14,3);
  v_take numeric(14,3);
  v_slices jsonb := '[]'::jsonb;
  v_reason_code text;
BEGIN
  IF p_delta = 0 OR p_delta <> pg_catalog.round(p_delta, 3)
    OR pg_catalog.abs(p_delta) <> pg_catalog.trunc(pg_catalog.abs(p_delta))
    OR (p_delta < 0 AND (p_approved_by IS NULL OR p_approved_at IS NULL)) THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Manual stock adjustment quantity or approval is invalid.');
  END IF;
  SELECT product.* INTO v_product
  FROM public.products AS product
  WHERE product.store_id = p_operation.store_id AND product.id = p_product_id
  FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'Product is unavailable in this store.', '42501');
  END IF;
  SELECT location.* INTO v_location
  FROM public.inventory_locations AS location
  WHERE location.store_id = p_operation.store_id AND location.id = p_location_id
    AND location.kind = 'sellable' AND location.is_default AND location.is_active;
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('INVENTORY_LOCATION_MISSING', 'Manual stock adjustments require the default sellable location.');
  END IF;
  SELECT balance.* INTO v_balance
  FROM public.inventory_balances AS balance
  WHERE balance.store_id = p_operation.store_id AND balance.product_id = p_product_id
    AND balance.location_id = p_location_id
  FOR UPDATE;
  IF NOT FOUND OR v_balance.provenance <> 'live'
    OR v_balance.version <> p_expected_version
    OR v_product.current_stock::numeric <> v_balance.quantity_on_hand THEN
    PERFORM private.raise_pos_operation_error('VERSION_CONFLICT', 'Inventory changed or needs reconciliation; refresh stock before retrying.', '40001');
  END IF;
  v_before := v_balance.quantity_on_hand;
  v_after := v_before + p_delta;
  IF v_after < 0 OR v_after > 999999999.999 THEN
    PERFORM private.raise_pos_operation_error('INSUFFICIENT_STOCK', 'Adjustment would create negative or out-of-range stock.');
  END IF;
  v_reason_code := CASE WHEN p_delta > 0 THEN 'manual_add' ELSE 'manual_correction' END;

  IF p_delta > 0 THEN
    v_lot_id := pg_catalog.gen_random_uuid();
    INSERT INTO public.inventory_stock_lots (
      id, store_id, product_id, ownership, quantity_received,
      quantity_remaining, unit_cost, created_by, received_at, location_id,
      source_operation_id, status
    ) VALUES (
      v_lot_id, p_operation.store_id, p_product_id, 'store_owned', p_delta,
      0, COALESCE(v_product.cost_price, 0), p_operation.actor_id,
      pg_catalog.clock_timestamp(),
      p_location_id, p_operation.id, 'exhausted'
    );
    v_slices := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'lot_id', v_lot_id, 'quantity_delta', p_delta,
      'source_allocation_id', NULL, 'source_slice_key', 'adjustment/' || v_adjustment_id::text
    ));
  ELSE
    v_remaining := pg_catalog.abs(p_delta);
    FOR v_lock IN
      SELECT lot_balance.id
      FROM public.inventory_lot_location_balances AS lot_balance
      JOIN public.inventory_stock_lots AS lot
        ON lot.store_id = lot_balance.store_id AND lot.id = lot_balance.lot_id
      WHERE lot_balance.store_id = p_operation.store_id AND lot.product_id = p_product_id
        AND lot_balance.location_id = p_location_id
      ORDER BY lot_balance.lot_id
      FOR UPDATE OF lot_balance
    LOOP NULL; END LOOP;
    FOR v_lot IN
      SELECT lot.id, lot_balance.quantity_on_hand
        - lot_balance.quantity_reserved_offline - lot_balance.quantity_reserved_online AS available
      FROM public.inventory_stock_lots AS lot
      JOIN public.inventory_lot_location_balances AS lot_balance
        ON lot_balance.store_id = lot.store_id AND lot_balance.lot_id = lot.id
       AND lot_balance.location_id = p_location_id
      WHERE lot.store_id = p_operation.store_id AND lot.product_id = p_product_id
        AND lot.status = 'active'
        AND lot_balance.quantity_on_hand > lot_balance.quantity_reserved_offline
          + lot_balance.quantity_reserved_online
      ORDER BY lot.received_at, lot.id
      FOR UPDATE OF lot
    LOOP
      EXIT WHEN v_remaining = 0;
      v_take := LEAST(v_lot.available, v_remaining);
      v_slices := v_slices || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'lot_id', v_lot.id, 'quantity_delta', -v_take,
        'source_allocation_id', NULL,
        'source_slice_key', 'adjustment/' || v_adjustment_id::text || '/' || v_lot.id::text
      ));
      v_remaining := v_remaining - v_take;
    END LOOP;
    IF v_remaining > 0 THEN
      PERFORM private.raise_pos_operation_error('INVENTORY_RECONCILIATION_REQUIRED', 'Sellable source lots do not cover the requested stock decrease.');
    END IF;
  END IF;

  PERFORM pg_catalog.set_config('kodigo.pos_operation_id', p_operation.id::text, true);
  PERFORM pg_catalog.set_config('kodigo.inventory_adjustment_writer', p_operation.id::text, true);
  INSERT INTO public.stock_adjustments (
    id, store_id, product_id, unit_label, stock_source, reason,
    quantity_delta, stock_before, stock_after, note, created_by
  ) VALUES (
    v_adjustment_id, p_operation.store_id, p_product_id,
    COALESCE(NULLIF(v_product.unit, ''), 'unit'), 'product', p_reason,
    p_delta, v_before, v_after, COALESCE(NULLIF(pg_catalog.btrim(p_note), ''), p_reason::text),
    p_operation.actor_id
  );
  v_movement_id := private.apply_inventory_movement(pg_catalog.jsonb_build_object(
    'store_id', p_operation.store_id,
    'product_id', p_product_id,
    'location_id', p_location_id,
    'operation_id', p_operation.id,
    'source_line_key', 'adjustment/' || v_adjustment_id::text,
    'movement_type', 'manual_adjustment',
    'origin', 'manual',
    'reason_code', v_reason_code,
    'quantity_delta', p_delta,
    'expected_balance_version', p_expected_version,
    'unit_label', COALESCE(NULLIF(v_product.unit, ''), 'unit'),
    'adjustment_id', v_adjustment_id,
    'approved_by', p_approved_by,
    'approved_at', p_approved_at,
    'local_occurred_at', COALESCE(p_operation.local_occurred_at, pg_catalog.clock_timestamp()),
    'terminal_id', p_operation.terminal_id,
    'accounting_version', p_operation.contract_version,
    'note', COALESCE(NULLIF(pg_catalog.btrim(p_note), ''), p_reason::text),
    'slices', v_slices
  ));
  RETURN pg_catalog.jsonb_build_object(
    'adjustment_id', v_adjustment_id,
    'movement_id', v_movement_id,
    'stock_before', v_before,
    'stock_after', v_after,
    'quantity_delta', p_delta
  );
END;
$function$;
REVOKE ALL ON FUNCTION private.apply_manual_inventory_adjustment(
  public.pos_operations, uuid, uuid, numeric, public.adjustment_reason,
  text, bigint, uuid, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.assert_inventory_movement_source_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_source_store uuid;
  v_source_product uuid;
  v_source_sale uuid;
  v_operation_actor uuid;
  v_matching_application boolean;
BEGIN
  IF NEW.provenance = 'legacy' THEN RETURN NEW; END IF;
  IF NEW.sale_item_id IS NOT NULL AND NEW.sale_id IS NULL THEN
    RAISE EXCEPTION 'An inventory movement sale item requires its source sale';
  END IF;
  IF NEW.sale_id IS NOT NULL THEN
    SELECT sale.store_id INTO v_source_store FROM public.sales AS sale WHERE sale.id = NEW.sale_id;
    IF NOT FOUND OR v_source_store IS DISTINCT FROM NEW.store_id THEN
      RAISE EXCEPTION 'Inventory movement sale must belong to the movement store';
    END IF;
  END IF;
  IF NEW.sale_item_id IS NOT NULL THEN
    SELECT item.product_id, item.sale_id INTO v_source_product, v_source_sale
    FROM public.sale_items AS item WHERE item.id = NEW.sale_item_id;
    IF NOT FOUND OR v_source_sale IS DISTINCT FROM NEW.sale_id
      OR v_source_product IS DISTINCT FROM NEW.product_id THEN
      RAISE EXCEPTION 'Inventory movement sale item must match its sale and product';
    END IF;
  END IF;
  IF NEW.adjustment_id IS NOT NULL THEN
    SELECT adjustment.store_id, adjustment.product_id INTO v_source_store, v_source_product
    FROM public.stock_adjustments AS adjustment WHERE adjustment.id = NEW.adjustment_id;
    IF NOT FOUND OR v_source_store IS DISTINCT FROM NEW.store_id
      OR v_source_product IS DISTINCT FROM NEW.product_id THEN
      RAISE EXCEPTION 'Inventory movement adjustment must match its store and product';
    END IF;
  END IF;
  IF NEW.compensates_movement_id IS NOT NULL THEN
    SELECT movement.store_id, movement.product_id INTO v_source_store, v_source_product
    FROM public.inventory_movements AS movement WHERE movement.id = NEW.compensates_movement_id;
    IF NOT FOUND OR v_source_store IS DISTINCT FROM NEW.store_id
      OR v_source_product IS DISTINCT FROM NEW.product_id THEN
      RAISE EXCEPTION 'Compensated inventory movement must match its store and product';
    END IF;
  END IF;
  IF NEW.cutover_id IS NOT NULL THEN
    SELECT cutover.store_id INTO v_source_store FROM public.inventory_cutovers AS cutover WHERE cutover.id = NEW.cutover_id;
    IF NOT FOUND OR v_source_store IS DISTINCT FROM NEW.store_id THEN
      RAISE EXCEPTION 'Inventory movement cutover must belong to the movement store';
    END IF;
  END IF;
  IF NEW.origin = 'manual' AND NEW.quantity_delta < 0 THEN
    SELECT operation.actor_id INTO v_operation_actor
    FROM public.pos_operations AS operation
    WHERE operation.id = NEW.operation_id AND operation.store_id = NEW.store_id;
    IF v_operation_actor IS NULL THEN
      RAISE EXCEPTION 'Manual inventory decrease requires its active command';
    END IF;
    IF NEW.approved_by = v_operation_actor THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.operational_approval_applications AS application
        JOIN public.operational_approval_decisions AS decision
          ON decision.store_id = application.store_id AND decision.id = application.decision_id
        JOIN public.operational_approval_requests AS request
          ON request.store_id = application.store_id AND request.id = application.request_id
        WHERE application.store_id = NEW.store_id
          AND application.operation_id = NEW.operation_id
          AND application.applied_by = v_operation_actor
          AND decision.actor_id = NEW.approved_by
          AND request.kind = 'inventory_adjustment'
          AND request.resource_id = NEW.product_id
          AND request.requester_id <> decision.actor_id
          AND request.state = 'applied'
      ) INTO v_matching_application;
      IF NOT COALESCE(v_matching_application, false) THEN
        RAISE EXCEPTION 'Inventory adjustment requester cannot approve their own decrease';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.assert_inventory_movement_source_scope()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_product_v2(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
  v_payload jsonb;
  v_product_json jsonb;
  v_product public.products%ROWTYPE;
  v_product_id uuid;
  v_option_json jsonb;
  v_restocking_json jsonb;
  v_supplier_json jsonb;
  v_supplier_ids uuid[] := ARRAY[]::uuid[];
  v_initial_stock numeric(14,3);
  v_location_id uuid;
  v_balance_version bigint;
  v_adjustment jsonb;
  v_result jsonb;
BEGIN
  v_operation := private.begin_pos_operation('create_product', p_command);
  IF v_operation.status = 'committed' THEN RETURN v_operation.response; END IF;
  PERFORM private.assert_store_feature_enabled(v_operation.store_id, 'inventory_ledger_v2');
  IF COALESCE((SELECT profile.role::text FROM public.profiles AS profile WHERE profile.id = v_operation.actor_id), '')
      NOT IN ('admin', 'inventory') THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'Only store admins or inventory staff can create products.', '42501');
  END IF;
  v_payload := p_command->'payload';
  IF private.jsonb_object_key_count(v_payload) <> 5
    OR NOT (v_payload ?& ARRAY['product', 'selling_options', 'restocking_options', 'supplier_ids', 'initial_stock'])
    OR pg_catalog.jsonb_typeof(v_payload->'product') IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(v_payload->'selling_options') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_typeof(v_payload->'restocking_options') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_typeof(v_payload->'supplier_ids') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_typeof(v_payload->'initial_stock') IS DISTINCT FROM 'number'
    OR v_payload->>'initial_stock' !~ '^(0|[1-9][0-9]*)$' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Product creation payload is incomplete or malformed.');
  END IF;
  v_product_json := v_payload->'product';
  IF private.jsonb_object_key_count(v_product_json) <> 24
    OR NOT (v_product_json ?& ARRAY[
      'id', 'store_id', 'name', 'sku', 'barcode', 'category_id', 'cost_price',
      'selling_price', 'current_stock', 'min_stock_level', 'safety_stock',
      'reorder_level', 'lead_time_days', 'unit', 'purchase_unit', 'conversion_factor',
      'bulk_purchase_price', 'bulk_purchase_enabled', 'auto_pricing_enabled',
      'margin_percentage', 'price_rounding', 'supplier_id', 'image_url', 'is_active'
    ]) THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Product fields are incomplete or contain unsupported values.');
  END IF;
  v_product := pg_catalog.jsonb_populate_record(NULL::public.products, v_product_json);
  v_product_id := v_product.id;
  v_initial_stock := (v_payload->>'initial_stock')::numeric(14,3);
  IF v_product_id IS NULL OR v_product.store_id IS DISTINCT FROM v_operation.store_id
    OR v_product.category_id IS NULL OR v_product.current_stock IS DISTINCT FROM 0 OR v_initial_stock < 0
    OR v_initial_stock <> pg_catalog.trunc(v_initial_stock)
    OR pg_catalog.length(pg_catalog.btrim(v_product.name)) NOT BETWEEN 1 AND 200
    OR pg_catalog.length(pg_catalog.btrim(v_product.sku)) NOT BETWEEN 1 AND 100
    OR pg_catalog.jsonb_array_length(v_payload->'selling_options') < 1 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Product identity, opening quantity, or selling options are invalid.');
  END IF;

  FOR v_option_json IN
    SELECT item.value FROM pg_catalog.jsonb_array_elements(v_payload->'selling_options') AS item(value)
  LOOP
    IF private.jsonb_object_key_count(v_option_json) <> 21
      OR NOT (v_option_json ?& ARRAY[
        'id', 'barcode', 'store_id', 'product_id', 'kind', 'label', 'unit_label',
        'quantity_value', 'quantity_unit', 'stock_quantity', 'selling_price',
        'low_stock_threshold', 'inventory_multiplier', 'shares_base_stock', 'is_bulk',
        'discount_type', 'discount_value', 'pricing_method', 'manual_selling_price',
        'is_default', 'is_active'
      ])
      OR v_option_json->>'store_id' IS DISTINCT FROM v_operation.store_id::text
      OR v_option_json->>'product_id' IS DISTINCT FROM v_product_id::text
      OR v_option_json->>'stock_quantity' IS DISTINCT FROM '0'
      OR v_option_json->>'shares_base_stock' IS DISTINCT FROM 'true' THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Selling option scope or initial stock is invalid.');
    END IF;
  END LOOP;
  FOR v_restocking_json IN
    SELECT item.value FROM pg_catalog.jsonb_array_elements(v_payload->'restocking_options') AS item(value)
  LOOP
    IF private.jsonb_object_key_count(v_restocking_json) <> 8
      OR NOT (v_restocking_json ?& ARRAY[
        'id', 'store_id', 'product_id', 'label', 'conversion_factor',
        'last_purchase_price', 'is_default', 'is_active'
      ])
      OR v_restocking_json->>'store_id' IS DISTINCT FROM v_operation.store_id::text
      OR v_restocking_json->>'product_id' IS DISTINCT FROM v_product_id::text THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Restocking option scope or fields are invalid.');
    END IF;
  END LOOP;
  FOR v_supplier_json IN
    SELECT item.value FROM pg_catalog.jsonb_array_elements(v_payload->'supplier_ids') AS item(value)
  LOOP
    IF pg_catalog.jsonb_typeof(v_supplier_json) IS DISTINCT FROM 'string'
      OR v_supplier_json #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Supplier identifiers must be UUIDs.');
    END IF;
    v_supplier_ids := pg_catalog.array_append(v_supplier_ids, (v_supplier_json #>> '{}')::uuid);
  END LOOP;
  IF v_product.supplier_id IS DISTINCT FROM v_supplier_ids[1] THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Primary supplier must match the first selected supplier.');
  END IF;

  INSERT INTO public.products (
    id, store_id, name, sku, barcode, category_id, cost_price, selling_price,
    current_stock, min_stock_level, safety_stock, reorder_level, lead_time_days,
    unit, purchase_unit, conversion_factor, bulk_purchase_price,
    bulk_purchase_enabled, auto_pricing_enabled, margin_percentage,
    price_rounding, supplier_id, image_url, is_active
  ) VALUES (
    v_product.id, v_product.store_id, v_product.name, v_product.sku, v_product.barcode,
    v_product.category_id, v_product.cost_price, v_product.selling_price, 0,
    v_product.min_stock_level, v_product.safety_stock, v_product.reorder_level,
    v_product.lead_time_days, v_product.unit, v_product.purchase_unit,
    v_product.conversion_factor, v_product.bulk_purchase_price,
    v_product.bulk_purchase_enabled, v_product.auto_pricing_enabled,
    v_product.margin_percentage, v_product.price_rounding, v_product.supplier_id,
    v_product.image_url, v_product.is_active
  );
  INSERT INTO public.product_selling_options (
    id, barcode, store_id, product_id, kind, label, unit_label,
    quantity_value, quantity_unit, stock_quantity, selling_price,
    low_stock_threshold, inventory_multiplier, shares_base_stock, is_bulk,
    discount_type, discount_value, pricing_method, manual_selling_price,
    is_default, is_active
  )
  SELECT option_row.id, option_row.barcode, option_row.store_id, option_row.product_id,
    option_row.kind, option_row.label, option_row.unit_label, option_row.quantity_value,
    option_row.quantity_unit, 0, option_row.selling_price,
    option_row.low_stock_threshold, option_row.inventory_multiplier,
    option_row.shares_base_stock, option_row.is_bulk, option_row.discount_type,
    option_row.discount_value, option_row.pricing_method, option_row.manual_selling_price,
    option_row.is_default, option_row.is_active
  FROM pg_catalog.jsonb_to_recordset(v_payload->'selling_options') AS option_row(
    id uuid, barcode text, store_id uuid, product_id uuid, kind text, label text,
    unit_label text, quantity_value numeric, quantity_unit text, stock_quantity numeric,
    selling_price numeric, low_stock_threshold numeric, inventory_multiplier numeric,
    shares_base_stock boolean, is_bulk boolean, discount_type text, discount_value numeric,
    pricing_method text, manual_selling_price numeric, is_default boolean, is_active boolean
  );
  INSERT INTO public.product_restocking_options (
    id, store_id, product_id, label, conversion_factor, last_purchase_price,
    is_default, is_active
  )
  SELECT option_row.id, option_row.store_id, option_row.product_id, option_row.label,
    option_row.conversion_factor, option_row.last_purchase_price,
    option_row.is_default, option_row.is_active
  FROM pg_catalog.jsonb_to_recordset(v_payload->'restocking_options') AS option_row(
    id uuid, store_id uuid, product_id uuid, label text, conversion_factor numeric,
    last_purchase_price numeric, is_default boolean, is_active boolean
  );
  PERFORM public.replace_product_suppliers(v_product.id, v_supplier_ids);

  IF v_initial_stock > 0 THEN
    SELECT location.id INTO v_location_id
    FROM public.inventory_locations AS location
    WHERE location.store_id = v_operation.store_id AND location.kind = 'sellable'
      AND location.is_default AND location.is_active;
    SELECT balance.version INTO v_balance_version
    FROM public.inventory_balances AS balance
    WHERE balance.store_id = v_operation.store_id AND balance.product_id = v_product.id
      AND balance.location_id = v_location_id AND balance.provenance = 'live';
    IF NOT FOUND THEN
      PERFORM private.raise_pos_operation_error('INVENTORY_RECONCILIATION_REQUIRED', 'New product did not receive its live zero-stock balance.');
    END IF;
    v_adjustment := private.apply_manual_inventory_adjustment(
      v_operation, v_product.id, v_location_id, v_initial_stock,
      'other'::public.adjustment_reason, 'Opening stock recorded with product creation',
      v_balance_version, NULL, NULL
    );
  END IF;
  v_result := pg_catalog.jsonb_build_object(
    'product_id', v_product.id, 'initial_stock', v_initial_stock,
    'inventory_adjustment', v_adjustment
  );
  RETURN private.finish_pos_operation(
    v_operation.store_id, v_operation.id, v_operation.kind,
    v_operation.request_hash, 'confirmed', 'product', v_product.id::text, 1, v_result
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.create_product_v2(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_product_v2(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_inventory_adjustment(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
  v_payload jsonb;
  v_product_id uuid;
  v_location_id uuid;
  v_mode text;
  v_quantity numeric(14,3);
  v_reason public.adjustment_reason;
  v_note text;
  v_balance public.inventory_balances%ROWTYPE;
  v_store_id uuid;
  v_nested_command jsonb;
  v_result jsonb;
  v_adjustment jsonb;
  v_expected_version bigint;
BEGIN
  IF p_command IS NULL OR pg_catalog.jsonb_typeof(p_command) IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(p_command->'store_id') IS DISTINCT FROM 'string'
    OR p_command->>'store_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Inventory adjustment command envelope is invalid.');
  END IF;
  v_store_id := (p_command->>'store_id')::uuid;
  IF NOT private.store_feature_enabled(v_store_id, 'inventory_ledger_v2') THEN
    PERFORM private.raise_pos_operation_error('FEATURE_DISABLED', 'Inventory ledger cutover is not complete.', '42501');
  END IF;
  v_payload := p_command->'payload';
  IF private.jsonb_object_key_count(v_payload) <> 6
    OR NOT (v_payload ?& ARRAY['product_id', 'location_id', 'mode', 'quantity', 'reason', 'note'])
    OR pg_catalog.jsonb_typeof(v_payload->'product_id') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'location_id') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'mode') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'quantity') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(v_payload->'reason') IS DISTINCT FROM 'string'
    OR (v_payload->'note' <> 'null'::jsonb AND pg_catalog.jsonb_typeof(v_payload->'note') IS DISTINCT FROM 'string')
    OR v_payload->>'product_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR v_payload->>'location_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR pg_catalog.jsonb_typeof(p_command->'expected_version') IS DISTINCT FROM 'number'
    OR p_command->>'expected_version' !~ '^[1-9][0-9]*$' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Inventory adjustment payload is incomplete or malformed.');
  END IF;
  v_product_id := (v_payload->>'product_id')::uuid;
  v_location_id := (v_payload->>'location_id')::uuid;
  v_mode := v_payload->>'mode';
  v_quantity := (v_payload->>'quantity')::numeric;
  v_expected_version := (p_command->>'expected_version')::bigint;
  v_reason := (v_payload->>'reason')::public.adjustment_reason;
  v_note := NULLIF(pg_catalog.btrim(v_payload->>'note'), '');
  IF v_mode NOT IN ('add', 'remove', 'count') OR v_quantity < 0
    OR v_quantity <> pg_catalog.trunc(v_quantity)
    OR (v_mode IN ('add', 'remove') AND v_quantity = 0) THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Adjustment mode and base-unit quantity are invalid.');
  END IF;
  IF (SELECT auth.uid()) IS NULL OR NOT public.user_belongs_to_store(v_store_id) THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'The authenticated user is not assigned to this store.', '42501');
  END IF;
  IF v_note IS NOT NULL AND pg_catalog.length(v_note) > 500 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Adjustment note cannot exceed 500 characters.');
  END IF;
  IF v_mode = 'add' AND v_reason IN ('restock'::public.adjustment_reason, 'conversion'::public.adjustment_reason) THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Supplier receipts and package conversions must use their dedicated inventory workflow.');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_locations AS location
    WHERE location.store_id = v_store_id AND location.id = v_location_id
      AND location.kind = 'sellable' AND location.is_default AND location.is_active
  ) THEN
    PERFORM private.raise_pos_operation_error('INVENTORY_LOCATION_MISSING', 'Manual stock adjustments require the default sellable location.');
  END IF;

  IF v_mode <> 'add' THEN
    SELECT balance.* INTO v_balance
    FROM public.inventory_balances AS balance
    WHERE balance.store_id = v_store_id AND balance.product_id = v_product_id
      AND balance.location_id = v_location_id AND balance.provenance = 'live';
    IF NOT FOUND OR v_balance.version <> v_expected_version THEN
      PERFORM private.raise_pos_operation_error('VERSION_CONFLICT', 'Inventory changed; refresh stock before requesting approval.', '40001');
    END IF;
    IF v_mode = 'remove' AND v_quantity > v_balance.quantity_on_hand THEN
      PERFORM private.raise_pos_operation_error('INSUFFICIENT_STOCK', 'Removal exceeds current sellable stock.');
    ELSIF v_mode = 'count' AND v_quantity = v_balance.quantity_on_hand THEN
      PERFORM private.raise_pos_operation_error('NO_CHANGE', 'The counted stock already matches the current stock.');
    END IF;
    v_nested_command := pg_catalog.jsonb_build_object(
      'contract_version', 1,
      'operation_id', p_command->'operation_id',
      'store_id', p_command->'store_id',
      'terminal_id', p_command->'terminal_id',
      'shift_id', p_command->'shift_id',
      'occurred_at_local', p_command->'occurred_at_local',
      'terminal_sequence', p_command->'terminal_sequence',
      'expected_version', NULL,
      'payload', pg_catalog.jsonb_build_object(
        'kind', 'inventory_adjustment',
        'resource_id', v_product_id,
        'expected_resource_version', v_balance.version,
        'proposal', pg_catalog.jsonb_build_object(
          'product_id', v_product_id,
          'location_id', v_location_id,
          'mode', v_mode,
          'quantity', v_quantity
        ),
        'reason', COALESCE(v_note, v_reason::text)
      )
    );
    RETURN public.request_operational_approval(v_nested_command);
  END IF;

  v_operation := private.begin_pos_operation('inventory_adjustment', p_command);
  IF v_operation.status = 'committed' THEN RETURN v_operation.response; END IF;
  IF COALESCE((SELECT profile.role::text FROM public.profiles AS profile WHERE profile.id = v_operation.actor_id), '')
      NOT IN ('admin', 'inventory') THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'Only store admins or inventory staff can add manual stock.', '42501');
  END IF;
  v_adjustment := private.apply_manual_inventory_adjustment(
    v_operation, v_product_id, v_location_id, v_quantity, v_reason, v_note,
    v_expected_version, NULL, NULL
  );
  v_result := v_adjustment || pg_catalog.jsonb_build_object('workflow_state', 'applied');
  RETURN private.finish_pos_operation(
    v_operation.store_id, v_operation.id, v_operation.kind,
    v_operation.request_hash, 'confirmed', 'inventory_adjustment',
    v_adjustment->>'adjustment_id', 1, v_result
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.request_inventory_adjustment(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_inventory_adjustment(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_inventory_adjustment(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
  v_payload jsonb;
  v_request public.operational_approval_requests%ROWTYPE;
  v_proposal jsonb;
  v_product_id uuid;
  v_location_id uuid;
  v_request_id uuid;
  v_decision_id uuid;
  v_decision public.operational_approval_decisions%ROWTYPE;
  v_mode text;
  v_quantity numeric(14,3);
  v_delta numeric(14,3);
  v_reason public.adjustment_reason;
  v_balance public.inventory_balances%ROWTYPE;
  v_adjustment jsonb;
  v_application_id uuid;
  v_result jsonb;
  v_expected_version bigint;
BEGIN
  v_operation := private.begin_pos_operation('apply_inventory_adjustment', p_command);
  IF v_operation.status = 'committed' THEN RETURN v_operation.response; END IF;
  PERFORM private.assert_store_feature_enabled(v_operation.store_id, 'inventory_ledger_v2');
  v_payload := p_command->'payload';
  IF private.jsonb_object_key_count(v_payload) <> 2
    OR NOT (v_payload ?& ARRAY['request_id', 'decision_id'])
    OR pg_catalog.jsonb_typeof(v_payload->'request_id') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'decision_id') IS DISTINCT FROM 'string'
    OR v_payload->>'request_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR v_payload->>'decision_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR pg_catalog.jsonb_typeof(p_command->'expected_version') IS DISTINCT FROM 'number'
    OR p_command->>'expected_version' !~ '^[1-9][0-9]*$' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Approved inventory application command is incomplete or malformed.');
  END IF;
  v_request_id := (v_payload->>'request_id')::uuid;
  v_decision_id := (v_payload->>'decision_id')::uuid;
  v_expected_version := (p_command->>'expected_version')::bigint;
  SELECT request.* INTO v_request
  FROM public.operational_approval_requests AS request
  WHERE request.store_id = v_operation.store_id AND request.id = v_request_id;
  IF NOT FOUND OR v_request.kind <> 'inventory_adjustment' THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'Approved inventory request was not found in this store.', '42501');
  END IF;
  v_proposal := v_request.proposed_payload;
  v_product_id := (v_proposal->>'product_id')::uuid;
  v_location_id := (v_proposal->>'location_id')::uuid;
  v_mode := v_proposal->>'mode';
  v_quantity := (v_proposal->>'quantity')::numeric(14,3);
  SELECT balance.* INTO v_balance
  FROM public.inventory_balances AS balance
  WHERE balance.store_id = v_operation.store_id AND balance.product_id = v_product_id
    AND balance.location_id = v_location_id AND balance.provenance = 'live'
  FOR UPDATE;
  IF NOT FOUND OR v_balance.version <> v_expected_version
    OR v_request.expected_resource_version <> v_expected_version THEN
    PERFORM private.raise_pos_operation_error('VERSION_CONFLICT', 'Stock changed after approval; request a new review.', '40001');
  END IF;
  PERFORM private.assert_operational_approval_applicable(
    v_operation.store_id, v_request_id, v_decision_id,
    'inventory_adjustment', v_expected_version
  );
  SELECT decision.* INTO v_decision
  FROM public.operational_approval_decisions AS decision
  WHERE decision.store_id = v_operation.store_id
    AND decision.request_id = v_request_id AND decision.id = v_decision_id;
  IF NOT FOUND OR v_decision.decision <> 'approve' THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'An approved decision is required to apply this inventory request.', '42501');
  END IF;
  IF v_mode = 'remove' THEN
    v_delta := -v_quantity;
    v_reason := 'other'::public.adjustment_reason;
  ELSIF v_mode = 'count' THEN
    v_delta := v_quantity - v_balance.quantity_on_hand;
    v_reason := 'manual-count'::public.adjustment_reason;
  ELSE
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Only approved decrease or count requests can be applied.');
  END IF;
  IF v_delta = 0 THEN
    PERFORM private.raise_pos_operation_error('NO_CHANGE', 'Approved count has no stock difference to apply.');
  END IF;
  v_application_id := private.record_operational_approval_application(
    v_operation.store_id, v_request_id, v_decision_id, v_operation.id,
    'inventory_adjustment', v_expected_version, v_expected_version + 1
  );
  v_adjustment := private.apply_manual_inventory_adjustment(
    v_operation, v_product_id, v_location_id, v_delta, v_reason,
    v_request.reason, v_expected_version, v_decision.actor_id, v_decision.created_at
  );
  v_result := v_adjustment || pg_catalog.jsonb_build_object(
    'workflow_state', 'applied', 'request_id', v_request_id,
    'application_id', v_application_id, 'decision_id', v_decision_id
  );
  RETURN private.finish_pos_operation(
    v_operation.store_id, v_operation.id, v_operation.kind,
    v_operation.request_hash, 'confirmed', 'inventory_adjustment',
    v_adjustment->>'adjustment_id', v_expected_version + 1, v_result
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.apply_inventory_adjustment(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_inventory_adjustment(jsonb) TO authenticated;

-- Inventory approvals are released with the inventory ledger. Keep the shared
-- cash and wallet workflows disabled until their domain writers are complete.
CREATE OR REPLACE FUNCTION public.request_operational_approval(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
  v_actor_id uuid := (SELECT auth.uid());
  v_actor_role text;
  v_payload jsonb;
  v_kind text;
  v_resource_id uuid;
  v_expected_version bigint;
  v_proposal jsonb;
  v_reason text;
  v_request_id uuid;
  v_proposal_hash text;
  v_result jsonb;
BEGIN
  v_operation := private.begin_pos_operation('operational_approval_request', p_command);
  IF v_operation.status = 'committed' THEN RETURN v_operation.response; END IF;
  v_payload := p_command->'payload';
  IF private.jsonb_object_key_count(v_payload) <> 5
    OR NOT (v_payload ?& ARRAY['kind', 'resource_id', 'expected_resource_version', 'proposal', 'reason'])
    OR pg_catalog.jsonb_typeof(v_payload->'kind') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'resource_id') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'expected_resource_version') IS DISTINCT FROM 'number'
    OR pg_catalog.jsonb_typeof(v_payload->'proposal') IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(v_payload->'reason') IS DISTINCT FROM 'string'
    OR v_payload->>'resource_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR v_payload->>'expected_resource_version' !~ '^(0|[1-9][0-9]*)$'
    OR pg_catalog.length(v_payload->>'expected_resource_version') > 18 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Approval request payload is incomplete or malformed.');
  END IF;
  v_kind := v_payload->>'kind';
  v_resource_id := (v_payload->>'resource_id')::uuid;
  v_expected_version := (v_payload->>'expected_resource_version')::bigint;
  v_proposal := v_payload->'proposal';
  v_reason := pg_catalog.btrim(v_payload->>'reason');
  IF pg_catalog.length(v_reason) NOT BETWEEN 3 AND 500
    OR NOT private.approval_proposal_is_valid(v_kind, v_resource_id, v_proposal) THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Approval proposal or reason is invalid.');
  END IF;

  IF v_kind = 'inventory_adjustment' THEN
    PERFORM private.assert_store_feature_enabled(v_operation.store_id, 'inventory_ledger_v2');
  ELSIF v_kind IN ('cash_movement', 'wallet_adjustment') THEN
    PERFORM private.assert_store_feature_enabled(v_operation.store_id, 'approval_workflows');
  ELSE
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Approval kind is unsupported.');
  END IF;

  SELECT profile.role::text INTO v_actor_role
  FROM public.profiles AS profile WHERE profile.id = v_actor_id;
  IF (v_kind = 'inventory_adjustment' AND COALESCE(v_actor_role, '') NOT IN ('admin', 'inventory'))
    OR (v_kind = 'cash_movement' AND COALESCE(v_actor_role, '') NOT IN ('admin', 'cashier'))
    OR (v_kind = 'wallet_adjustment' AND v_actor_role IS DISTINCT FROM 'admin') THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'This account cannot request this operational approval.', '42501');
  END IF;

  v_proposal_hash := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'kind', v_kind, 'resource_id', v_resource_id,
      'expected_resource_version', v_expected_version,
      'proposal', v_proposal, 'reason', v_reason
    )::text, 'UTF8'), 'sha256'), 'hex');
  INSERT INTO public.operational_approval_requests (
    store_id, operation_id, kind, resource_id, requester_id,
    expected_resource_version, proposed_payload, proposal_hash, reason
  ) VALUES (
    v_operation.store_id, v_operation.id, v_kind, v_resource_id, v_actor_id,
    v_expected_version, v_proposal, v_proposal_hash, v_reason
  ) RETURNING id INTO v_request_id;
  v_result := pg_catalog.jsonb_build_object(
    'workflow_state', 'requested', 'request_id', v_request_id,
    'request_version', 1, 'kind', v_kind, 'proposal_hash', v_proposal_hash
  );
  RETURN private.finish_pos_operation(
    v_operation.store_id, v_operation.id, v_operation.kind, v_operation.request_hash,
    'confirmed', 'operational_approval', v_request_id::text, 1, v_result
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.decide_operational_approval(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.pos_operations%ROWTYPE;
  v_actor_id uuid := (SELECT auth.uid());
  v_payload jsonb;
  v_request public.operational_approval_requests%ROWTYPE;
  v_decision_id uuid;
  v_request_id uuid;
  v_expected_request_version bigint;
  v_choice text;
  v_reason text;
  v_result jsonb;
BEGIN
  v_operation := private.begin_pos_operation('operational_approval_decision', p_command);
  IF v_operation.status = 'committed' THEN RETURN v_operation.response; END IF;
  v_payload := p_command->'payload';
  IF private.jsonb_object_key_count(v_payload) <> 3
    OR NOT (v_payload ?& ARRAY['request_id', 'decision', 'reason'])
    OR pg_catalog.jsonb_typeof(v_payload->'request_id') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'decision') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(v_payload->'reason') IS DISTINCT FROM 'string'
    OR v_payload->>'request_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR pg_catalog.jsonb_typeof(p_command->'expected_version') IS DISTINCT FROM 'number'
    OR p_command->>'expected_version' !~ '^(1|[1-9][0-9]*)$' THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Approval decision payload or request version is invalid.');
  END IF;
  v_request_id := (v_payload->>'request_id')::uuid;
  v_expected_request_version := (p_command->>'expected_version')::bigint;
  v_choice := v_payload->>'decision';
  v_reason := pg_catalog.btrim(v_payload->>'reason');
  IF v_choice NOT IN ('approve', 'reject') OR pg_catalog.length(v_reason) NOT BETWEEN 3 AND 500 THEN
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Decision and reason are invalid.');
  END IF;
  SELECT request.* INTO v_request
  FROM public.operational_approval_requests AS request
  WHERE request.store_id = v_operation.store_id AND request.id = v_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'Approval request was not found in this store.', '42501');
  END IF;
  IF v_request.request_version IS DISTINCT FROM v_expected_request_version
    OR v_request.state <> 'requested' THEN
    PERFORM private.raise_pos_operation_error('VERSION_CONFLICT', 'Approval request has already changed.', '40001');
  END IF;
  IF v_request.requester_id = v_actor_id THEN
    PERFORM private.raise_pos_operation_error('SELF_APPROVAL', 'A requester cannot approve or reject their own request.', '42501');
  END IF;

  IF v_request.kind = 'inventory_adjustment' THEN
    PERFORM private.assert_store_feature_enabled(v_request.store_id, 'inventory_ledger_v2');
  ELSIF v_request.kind IN ('cash_movement', 'wallet_adjustment') THEN
    PERFORM private.assert_store_feature_enabled(v_request.store_id, 'approval_workflows');
  ELSE
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Approval kind is unsupported.');
  END IF;
  IF v_request.kind = 'inventory_adjustment' THEN
    PERFORM private.assert_store_capability(v_request.store_id, 'approve_inventory_adjustment');
  ELSIF v_request.kind = 'cash_movement' THEN
    PERFORM private.assert_store_capability(v_request.store_id, 'approve_cash_adjustment');
  ELSE
    PERFORM private.assert_store_admin(v_request.store_id);
  END IF;

  INSERT INTO public.operational_approval_decisions (
    store_id, request_id, request_version, decision, actor_id, reason, operation_id
  ) VALUES (
    v_request.store_id, v_request.id, v_request.request_version, v_choice,
    v_actor_id, v_reason, v_operation.id
  ) RETURNING id INTO v_decision_id;
  UPDATE public.operational_approval_requests AS request
  SET state = CASE WHEN v_choice = 'approve' THEN 'approved' ELSE 'rejected' END,
      request_version = request.request_version + 1,
      updated_at = pg_catalog.clock_timestamp()
  WHERE request.store_id = v_request.store_id AND request.id = v_request.id;
  v_result := pg_catalog.jsonb_build_object(
    'workflow_state', CASE WHEN v_choice = 'approve' THEN 'approved' ELSE 'rejected' END,
    'request_id', v_request.id,
    'request_version', v_expected_request_version + 1,
    'decision_id', v_decision_id, 'decision', v_choice
  );
  RETURN private.finish_pos_operation(
    v_operation.store_id, v_operation.id, v_operation.kind, v_operation.request_hash,
    'confirmed', 'operational_approval', v_request.id::text,
    v_expected_request_version + 1, v_result
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.assert_operational_approval_applicable(
  p_store_id uuid,
  p_request_id uuid,
  p_decision_id uuid,
  p_kind text,
  p_expected_resource_version bigint
)
RETURNS public.operational_approval_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_actor_role text;
  v_request public.operational_approval_requests%ROWTYPE;
  v_decision public.operational_approval_decisions%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL OR NOT private.mfa_session_is_valid() THEN
    PERFORM private.raise_pos_operation_error('MFA_REQUIRED', 'A valid authenticated MFA session is required.', '42501');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.store_users AS membership
    WHERE membership.store_id = p_store_id AND membership.profile_id = v_actor_id
  ) THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'The authenticated user is not assigned to this store.', '42501');
  END IF;
  IF p_kind = 'inventory_adjustment' THEN
    PERFORM private.assert_store_feature_enabled(p_store_id, 'inventory_ledger_v2');
  ELSIF p_kind IN ('cash_movement', 'wallet_adjustment') THEN
    PERFORM private.assert_store_feature_enabled(p_store_id, 'approval_workflows');
  ELSE
    PERFORM private.raise_pos_operation_error('INVALID_INPUT', 'Approval kind is unsupported.');
  END IF;
  SELECT request.* INTO v_request
  FROM public.operational_approval_requests AS request
  WHERE request.store_id = p_store_id AND request.id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM private.raise_pos_operation_error('STORE_FORBIDDEN', 'Approval request was not found in this store.', '42501');
  END IF;
  SELECT decision.* INTO v_decision
  FROM public.operational_approval_decisions AS decision
  WHERE decision.store_id = p_store_id
    AND decision.id = p_decision_id AND decision.request_id = p_request_id;
  IF NOT FOUND OR v_decision.decision <> 'approve'
    OR v_decision.actor_id = v_request.requester_id
    OR v_request.state <> 'approved'
    OR v_request.kind IS DISTINCT FROM p_kind
    OR v_request.expected_resource_version IS DISTINCT FROM p_expected_resource_version THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'A matching approved request is required to apply this change.', '42501');
  END IF;
  SELECT profile.role::text INTO v_actor_role
  FROM public.profiles AS profile WHERE profile.id = v_actor_id;
  IF (p_kind = 'inventory_adjustment' AND COALESCE(v_actor_role, '') NOT IN ('admin', 'inventory'))
    OR (p_kind = 'cash_movement' AND COALESCE(v_actor_role, '') NOT IN ('admin', 'cashier'))
    OR (p_kind = 'wallet_adjustment' AND v_actor_role IS DISTINCT FROM 'admin') THEN
    PERFORM private.raise_pos_operation_error('CAPABILITY_REQUIRED', 'This account cannot apply this operational change.', '42501');
  END IF;
  RETURN v_request;
END;
$function$;
