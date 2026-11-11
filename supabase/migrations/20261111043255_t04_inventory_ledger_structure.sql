-- T04: additive inventory structure and legacy-safe shadow reconciliation.
-- No existing stock quantity is changed and no baseline movement is fabricated.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- Composite keys allow new facts to enforce store scope in the database.
CREATE UNIQUE INDEX IF NOT EXISTS products_store_id_id_uidx
  ON public.products (store_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_stock_lots_store_id_id_uidx
  ON public.inventory_stock_lots (store_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS sale_item_stock_allocations_store_id_id_lot_uidx
  ON public.sale_item_stock_allocations (store_id, id, lot_id);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_movements_store_id_id_uidx
  ON public.inventory_movements (store_id, id);

CREATE TABLE public.inventory_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_-]*$'),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  kind text NOT NULL CHECK (kind IN ('sellable', 'quarantine')),
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT inventory_locations_store_code_key UNIQUE (store_id, code),
  CONSTRAINT inventory_locations_store_id_key UNIQUE (store_id, id)
);

CREATE UNIQUE INDEX inventory_locations_one_default_kind_uidx
  ON public.inventory_locations (store_id, kind)
  WHERE is_default;
CREATE INDEX inventory_locations_store_active_idx
  ON public.inventory_locations (store_id, is_active, kind);

INSERT INTO public.inventory_locations (store_id, code, name, kind, is_default)
SELECT store.id, defaults.code, defaults.name, defaults.kind, true
FROM public.stores AS store
CROSS JOIN (VALUES
  ('default-sellable', 'Sellable', 'sellable'),
  ('default-quarantine', 'Quarantine', 'quarantine')
) AS defaults(code, name, kind)
ON CONFLICT (store_id, code) DO NOTHING;

CREATE OR REPLACE FUNCTION private.ensure_store_inventory_locations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.inventory_locations (store_id, code, name, kind, is_default)
  VALUES
    (NEW.id, 'default-sellable', 'Sellable', 'sellable', true),
    (NEW.id, 'default-quarantine', 'Quarantine', 'quarantine', true)
  ON CONFLICT (store_id, code) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.ensure_store_inventory_locations() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS ensure_store_inventory_locations_trigger ON public.stores;
CREATE TRIGGER ensure_store_inventory_locations_trigger
  AFTER INSERT ON public.stores
  FOR EACH ROW EXECUTE FUNCTION private.ensure_store_inventory_locations();

CREATE TABLE public.inventory_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL,
  location_id uuid NOT NULL,
  quantity_on_hand numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  quantity_reserved_offline numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity_reserved_offline >= 0),
  quantity_reserved_online numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity_reserved_online >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  provenance text NOT NULL DEFAULT 'shadow' CHECK (provenance IN ('shadow', 'baseline', 'live')),
  observed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_balances_reserved_bound
    CHECK (quantity_on_hand >= quantity_reserved_offline + quantity_reserved_online),
  CONSTRAINT inventory_balances_store_product_location_key
    UNIQUE (store_id, product_id, location_id),
  CONSTRAINT inventory_balances_store_product_location_id_key
    UNIQUE (store_id, product_id, location_id, id),
  CONSTRAINT inventory_balances_store_product_fkey
    FOREIGN KEY (store_id, product_id)
    REFERENCES public.products(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_balances_store_location_fkey
    FOREIGN KEY (store_id, location_id)
    REFERENCES public.inventory_locations(store_id, id) ON DELETE RESTRICT
);

CREATE INDEX inventory_balances_location_idx
  ON public.inventory_balances (store_id, location_id, product_id);

CREATE TABLE public.inventory_lot_location_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  lot_id uuid NOT NULL,
  location_id uuid NOT NULL,
  quantity_on_hand numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  quantity_reserved_offline numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity_reserved_offline >= 0),
  quantity_reserved_online numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity_reserved_online >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  provenance text NOT NULL DEFAULT 'shadow' CHECK (provenance IN ('shadow', 'baseline', 'live')),
  observed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_lot_location_balances_reserved_bound
    CHECK (quantity_on_hand >= quantity_reserved_offline + quantity_reserved_online),
  CONSTRAINT inventory_lot_location_balances_store_lot_location_key
    UNIQUE (store_id, lot_id, location_id),
  CONSTRAINT inventory_lot_location_balances_store_location_fkey
    FOREIGN KEY (store_id, location_id)
    REFERENCES public.inventory_locations(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_lot_location_balances_store_lot_fkey
    FOREIGN KEY (store_id, lot_id)
    REFERENCES public.inventory_stock_lots(store_id, id) ON DELETE RESTRICT
);

CREATE INDEX inventory_lot_location_balances_lot_idx
  ON public.inventory_lot_location_balances (store_id, lot_id);
CREATE INDEX inventory_lot_location_balances_location_idx
  ON public.inventory_lot_location_balances (store_id, location_id, lot_id);

CREATE TABLE public.inventory_cutovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL UNIQUE REFERENCES public.stores(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'preparing'
    CHECK (status IN ('preparing', 'blocked', 'complete')),
  boundary_at timestamptz NOT NULL DEFAULT now(),
  watermark_movement_id uuid,
  watermark_movement_created_at timestamptz,
  reconciliation_artifact_sha256 text
    CHECK (reconciliation_artifact_sha256 IS NULL OR reconciliation_artifact_sha256 ~ '^[0-9a-f]{64}$'),
  baseline_operation_id uuid,
  completed_at timestamptz,
  completed_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_cutovers_store_watermark_fkey
    FOREIGN KEY (store_id, watermark_movement_id)
    REFERENCES public.inventory_movements(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_cutovers_store_baseline_operation_fkey
    FOREIGN KEY (store_id, baseline_operation_id)
    REFERENCES public.pos_operations(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_cutovers_complete_metadata_check
    CHECK (status <> 'complete' OR (
      completed_at IS NOT NULL
      AND reconciliation_artifact_sha256 IS NOT NULL
      AND baseline_operation_id IS NOT NULL
    ))
);

CREATE UNIQUE INDEX inventory_cutovers_baseline_operation_uidx
  ON public.inventory_cutovers (baseline_operation_id)
  WHERE baseline_operation_id IS NOT NULL;
CREATE INDEX inventory_cutovers_store_watermark_idx
  ON public.inventory_cutovers (store_id, watermark_movement_id)
  WHERE watermark_movement_id IS NOT NULL;

ALTER TABLE public.inventory_stock_lots
  ADD COLUMN location_id uuid,
  ADD COLUMN source_operation_id uuid,
  ADD COLUMN source_receiving_id uuid,
  ADD COLUMN status text DEFAULT 'active',
  ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0);

ALTER TABLE public.inventory_stock_lots
  ADD CONSTRAINT inventory_stock_lots_status_check
    CHECK (status IS NULL OR status IN ('active', 'quarantine', 'exhausted')) NOT VALID,
  ADD CONSTRAINT inventory_stock_lots_store_product_fkey
    FOREIGN KEY (store_id, product_id)
    REFERENCES public.products(store_id, id) ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT inventory_stock_lots_store_source_operation_fkey
    FOREIGN KEY (store_id, source_operation_id)
    REFERENCES public.pos_operations(store_id, id) ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT inventory_stock_lots_store_location_fkey
    FOREIGN KEY (store_id, location_id)
    REFERENCES public.inventory_locations(store_id, id) ON DELETE RESTRICT NOT VALID;

CREATE INDEX inventory_stock_lots_location_idx
  ON public.inventory_stock_lots (store_id, location_id, quantity_remaining);
CREATE INDEX inventory_stock_lots_store_product_idx
  ON public.inventory_stock_lots (store_id, product_id);
CREATE INDEX inventory_stock_lots_store_idx
  ON public.inventory_stock_lots (store_id);
CREATE INDEX inventory_stock_lots_source_operation_idx
  ON public.inventory_stock_lots (source_operation_id)
  WHERE source_operation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.apply_inventory_stock_lot_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_location_id uuid;
BEGIN
  IF NEW.location_id IS NULL THEN
    SELECT location.id INTO v_location_id
    FROM public.inventory_locations AS location
    WHERE location.store_id = NEW.store_id
      AND location.kind = 'sellable'
      AND location.is_default
      AND location.is_active;
    IF v_location_id IS NULL THEN
      RAISE EXCEPTION 'Store % has no active default sellable inventory location', NEW.store_id;
    END IF;
    NEW.location_id := v_location_id;
  END IF;

  IF NEW.status IS DISTINCT FROM 'quarantine' THEN
    NEW.status := CASE WHEN NEW.quantity_remaining = 0 THEN 'exhausted' ELSE 'active' END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.sync_inventory_stock_lot_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'quarantine' THEN
    NEW.status := CASE WHEN NEW.quantity_remaining = 0 THEN 'exhausted' ELSE 'active' END;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.apply_inventory_stock_lot_defaults() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.sync_inventory_stock_lot_status() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS apply_inventory_stock_lot_defaults_trigger ON public.inventory_stock_lots;
CREATE TRIGGER apply_inventory_stock_lot_defaults_trigger
  BEFORE INSERT ON public.inventory_stock_lots
  FOR EACH ROW EXECUTE FUNCTION private.apply_inventory_stock_lot_defaults();
DROP TRIGGER IF EXISTS sync_inventory_stock_lot_status_trigger ON public.inventory_stock_lots;
CREATE TRIGGER sync_inventory_stock_lot_status_trigger
  BEFORE UPDATE OF quantity_remaining ON public.inventory_stock_lots
  FOR EACH ROW EXECUTE FUNCTION private.sync_inventory_stock_lot_status();

ALTER TABLE public.sale_item_stock_allocations
  ADD COLUMN physical_returned_quantity numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN restocked_quantity numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN void_restored_quantity numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN quarantined_quantity numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN counter_provenance text NOT NULL DEFAULT 'legacy',
  ADD COLUMN source_operation_id uuid,
  ADD COLUMN source_line_key text;

ALTER TABLE public.sale_item_stock_allocations
  ADD CONSTRAINT sale_item_stock_allocations_counter_provenance_check
    CHECK (counter_provenance IN ('legacy', 'new')) NOT VALID,
  ADD CONSTRAINT sale_item_stock_allocations_store_lot_fkey
    FOREIGN KEY (store_id, lot_id)
    REFERENCES public.inventory_stock_lots(store_id, id) ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT sale_item_stock_allocations_store_source_operation_fkey
    FOREIGN KEY (store_id, source_operation_id)
    REFERENCES public.pos_operations(store_id, id) ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT sale_item_stock_allocations_new_counter_bounds_check
    CHECK (counter_provenance = 'legacy' OR (
      source_operation_id IS NOT NULL
      AND source_line_key IS NOT NULL
      AND length(btrim(source_line_key)) > 0
      AND physical_returned_quantity >= 0
      AND restocked_quantity >= 0
      AND void_restored_quantity >= 0
      AND quarantined_quantity >= 0
      AND physical_returned_quantity <= quantity_base_units
      AND restocked_quantity <= physical_returned_quantity
      AND quarantined_quantity <= physical_returned_quantity
      AND restocked_quantity + quarantined_quantity <= physical_returned_quantity
      AND restocked_quantity + void_restored_quantity <= quantity_base_units
      AND physical_returned_quantity + void_restored_quantity <= quantity_base_units
    )) NOT VALID;

CREATE INDEX sale_item_stock_allocations_source_operation_idx
  ON public.sale_item_stock_allocations (source_operation_id)
  WHERE source_operation_id IS NOT NULL;
CREATE INDEX sale_item_stock_allocations_store_lot_idx
  ON public.sale_item_stock_allocations (store_id, lot_id);
CREATE UNIQUE INDEX sale_item_stock_allocations_operation_source_uidx
  ON public.sale_item_stock_allocations (store_id, source_operation_id, source_line_key)
  WHERE counter_provenance = 'new';

ALTER TABLE public.inventory_movements
  ADD COLUMN location_id uuid,
  ADD COLUMN balance_id uuid,
  ADD COLUMN operation_id uuid,
  ADD COLUMN source_line_key text,
  ADD COLUMN sale_id uuid REFERENCES public.sales(id) ON DELETE RESTRICT,
  ADD COLUMN sale_item_id uuid REFERENCES public.sale_items(id) ON DELETE RESTRICT,
  ADD COLUMN return_id uuid,
  ADD COLUMN return_item_id uuid,
  ADD COLUMN void_id uuid,
  ADD COLUMN adjustment_id uuid REFERENCES public.stock_adjustments(id) ON DELETE RESTRICT,
  ADD COLUMN compensates_movement_id uuid REFERENCES public.inventory_movements(id) ON DELETE RESTRICT,
  ADD COLUMN transfer_group_id uuid,
  ADD COLUMN cutover_id uuid REFERENCES public.inventory_cutovers(id) ON DELETE RESTRICT,
  ADD COLUMN approved_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN origin text,
  ADD COLUMN reason_code text,
  ADD COLUMN base_unit_quantity numeric(14,3),
  ADD COLUMN selling_quantity numeric(14,3),
  ADD COLUMN units_per_package_snapshot numeric(14,3),
  ADD COLUMN local_occurred_at timestamptz,
  ADD COLUMN terminal_id uuid,
  ADD COLUMN sync_received_at timestamptz,
  ADD COLUMN accounting_version smallint,
  ADD COLUMN provenance text NOT NULL DEFAULT 'legacy';

ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_store_operation_fkey
    FOREIGN KEY (store_id, operation_id)
    REFERENCES public.pos_operations(store_id, id) ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT inventory_movements_store_product_fkey
    FOREIGN KEY (store_id, product_id)
    REFERENCES public.products(store_id, id) ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT inventory_movements_store_location_fkey
    FOREIGN KEY (store_id, location_id)
    REFERENCES public.inventory_locations(store_id, id) ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT inventory_movements_store_product_location_balance_fkey
    FOREIGN KEY (store_id, product_id, location_id, balance_id)
    REFERENCES public.inventory_balances(store_id, product_id, location_id, id) ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT inventory_movements_provenance_check
    CHECK (provenance IN ('legacy', 'new', 'baseline')) NOT VALID,
  ADD CONSTRAINT inventory_movements_new_structure_check
    CHECK (provenance = 'legacy' OR (
      product_id IS NOT NULL
      AND location_id IS NOT NULL
      AND balance_id IS NOT NULL
      AND operation_id IS NOT NULL
      AND source_line_key IS NOT NULL
      AND length(btrim(source_line_key)) > 0
      AND origin IN ('automatic', 'manual', 'offline')
      AND reason_code IS DISTINCT FROM ''
      AND base_unit_quantity > 0
      AND abs(quantity_delta) = base_unit_quantity
      AND (selling_quantity IS NULL OR selling_quantity >= 0)
      AND (units_per_package_snapshot IS NULL OR units_per_package_snapshot > 0)
      AND local_occurred_at IS NOT NULL
      AND accounting_version >= 1
      AND stock_after = stock_before + quantity_delta
      AND ((approved_by IS NULL) = (approved_at IS NULL))
      AND (quantity_delta >= 0 OR origin <> 'manual' OR (reason_code IS NOT NULL AND approved_by IS NOT NULL))
      AND (provenance <> 'baseline' OR (cutover_id IS NOT NULL AND movement_type = 'opening_baseline'))
    )) NOT VALID;

CREATE UNIQUE INDEX inventory_movements_operation_source_uidx
  ON public.inventory_movements (operation_id, source_line_key, location_id, movement_type)
  WHERE provenance IN ('new', 'baseline');
CREATE INDEX inventory_movements_balance_idx
  ON public.inventory_movements (store_id, product_id, location_id, created_at DESC)
  WHERE balance_id IS NOT NULL;
CREATE INDEX inventory_movements_balance_id_fk_idx
  ON public.inventory_movements (store_id, product_id, location_id, balance_id)
  WHERE balance_id IS NOT NULL;
CREATE INDEX inventory_movements_store_product_idx
  ON public.inventory_movements (store_id, product_id);
CREATE INDEX inventory_movements_operation_idx
  ON public.inventory_movements (operation_id)
  WHERE operation_id IS NOT NULL;
CREATE INDEX inventory_movements_cutover_idx
  ON public.inventory_movements (cutover_id)
  WHERE cutover_id IS NOT NULL;
CREATE INDEX inventory_movements_sale_idx
  ON public.inventory_movements (sale_id)
  WHERE sale_id IS NOT NULL;
CREATE INDEX inventory_movements_sale_item_idx
  ON public.inventory_movements (sale_item_id)
  WHERE sale_item_id IS NOT NULL;
CREATE INDEX inventory_movements_adjustment_idx
  ON public.inventory_movements (adjustment_id)
  WHERE adjustment_id IS NOT NULL;
CREATE INDEX inventory_movements_compensates_idx
  ON public.inventory_movements (compensates_movement_id)
  WHERE compensates_movement_id IS NOT NULL;
CREATE INDEX inventory_movements_approved_by_idx
  ON public.inventory_movements (approved_by)
  WHERE approved_by IS NOT NULL;

CREATE OR REPLACE FUNCTION private.assert_inventory_movement_source_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source_store uuid;
  v_source_product uuid;
  v_source_sale uuid;
  v_operation_actor uuid;
BEGIN
  IF NEW.provenance = 'legacy' THEN
    RETURN NEW;
  END IF;

  IF NEW.sale_item_id IS NOT NULL AND NEW.sale_id IS NULL THEN
    RAISE EXCEPTION 'An inventory movement sale item requires its source sale';
  END IF;
  IF NEW.sale_id IS NOT NULL THEN
    SELECT sale.store_id INTO v_source_store
    FROM public.sales AS sale WHERE sale.id = NEW.sale_id;
    IF NOT FOUND OR v_source_store IS DISTINCT FROM NEW.store_id THEN
      RAISE EXCEPTION 'Inventory movement sale must belong to the movement store';
    END IF;
  END IF;
  IF NEW.sale_item_id IS NOT NULL THEN
    SELECT item.product_id, item.sale_id
    INTO v_source_product, v_source_sale
    FROM public.sale_items AS item WHERE item.id = NEW.sale_item_id;
    IF NOT FOUND OR v_source_sale IS DISTINCT FROM NEW.sale_id
      OR v_source_product IS DISTINCT FROM NEW.product_id THEN
      RAISE EXCEPTION 'Inventory movement sale item must match its sale and product';
    END IF;
  END IF;

  IF NEW.adjustment_id IS NOT NULL THEN
    SELECT adjustment.store_id, adjustment.product_id
    INTO v_source_store, v_source_product
    FROM public.stock_adjustments AS adjustment WHERE adjustment.id = NEW.adjustment_id;
    IF NOT FOUND OR v_source_store IS DISTINCT FROM NEW.store_id
      OR v_source_product IS DISTINCT FROM NEW.product_id THEN
      RAISE EXCEPTION 'Inventory movement adjustment must match its store and product';
    END IF;
  END IF;

  IF NEW.compensates_movement_id IS NOT NULL THEN
    SELECT movement.store_id, movement.product_id
    INTO v_source_store, v_source_product
    FROM public.inventory_movements AS movement WHERE movement.id = NEW.compensates_movement_id;
    IF NOT FOUND OR v_source_store IS DISTINCT FROM NEW.store_id
      OR v_source_product IS DISTINCT FROM NEW.product_id THEN
      RAISE EXCEPTION 'Compensated inventory movement must match its store and product';
    END IF;
  END IF;

  IF NEW.cutover_id IS NOT NULL THEN
    SELECT cutover.store_id INTO v_source_store
    FROM public.inventory_cutovers AS cutover WHERE cutover.id = NEW.cutover_id;
    IF NOT FOUND OR v_source_store IS DISTINCT FROM NEW.store_id THEN
      RAISE EXCEPTION 'Inventory movement cutover must belong to the movement store';
    END IF;
  END IF;

  IF NEW.origin = 'manual' AND NEW.quantity_delta < 0 THEN
    SELECT operation.actor_id INTO v_operation_actor
    FROM public.pos_operations AS operation WHERE operation.id = NEW.operation_id;
    IF NEW.approved_by IS NOT NULL AND NEW.approved_by = v_operation_actor THEN
      RAISE EXCEPTION 'Inventory adjustment requester cannot approve their own decrease';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_inventory_movement_source_scope() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER inventory_movements_source_scope_guard
  BEFORE INSERT OR UPDATE ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION private.assert_inventory_movement_source_scope();

CREATE TABLE public.inventory_movement_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  movement_id uuid NOT NULL,
  lot_id uuid NOT NULL,
  source_allocation_id uuid,
  source_slice_key text NOT NULL CHECK (length(btrim(source_slice_key)) > 0),
  quantity_delta numeric(14,3) NOT NULL CHECK (quantity_delta <> 0),
  ownership_snapshot text NOT NULL CHECK (ownership_snapshot IN ('store_owned', 'consigned')),
  supplier_id_snapshot uuid REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  supplier_name_snapshot text,
  unit_cost_snapshot numeric(14,6) NOT NULL CHECK (unit_cost_snapshot >= 0),
  cogs_recovery_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (cogs_recovery_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_movement_lots_store_movement_fkey
    FOREIGN KEY (store_id, movement_id)
    REFERENCES public.inventory_movements(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_movement_lots_store_lot_fkey
    FOREIGN KEY (store_id, lot_id)
    REFERENCES public.inventory_stock_lots(store_id, id) ON DELETE RESTRICT,
  CONSTRAINT inventory_movement_lots_store_allocation_lot_fkey
    FOREIGN KEY (store_id, source_allocation_id, lot_id)
    REFERENCES public.sale_item_stock_allocations(store_id, id, lot_id) ON DELETE RESTRICT,
  CONSTRAINT inventory_movement_lots_movement_lot_slice_key
    UNIQUE (movement_id, lot_id, source_slice_key)
);

CREATE INDEX inventory_movement_lots_store_lot_idx
  ON public.inventory_movement_lots (store_id, lot_id, created_at DESC);
CREATE INDEX inventory_movement_lots_store_movement_idx
  ON public.inventory_movement_lots (store_id, movement_id);
CREATE INDEX inventory_movement_lots_source_allocation_idx
  ON public.inventory_movement_lots (store_id, source_allocation_id, lot_id)
  WHERE source_allocation_id IS NOT NULL;
CREATE INDEX inventory_movement_lots_supplier_snapshot_idx
  ON public.inventory_movement_lots (supplier_id_snapshot)
  WHERE supplier_id_snapshot IS NOT NULL;

CREATE OR REPLACE FUNCTION private.assert_inventory_movement_lot_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_store_id uuid;
  v_movement_id uuid;
  v_expected numeric(12,3);
  v_provenance text;
  v_actual numeric(14,3);
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'inventory_movements' THEN
      v_store_id := OLD.store_id;
      v_movement_id := OLD.id;
    ELSE
      v_store_id := OLD.store_id;
      v_movement_id := OLD.movement_id;
    END IF;
  ELSE
    IF TG_TABLE_NAME = 'inventory_movements' THEN
      v_store_id := NEW.store_id;
      v_movement_id := NEW.id;
    ELSE
      v_store_id := NEW.store_id;
      v_movement_id := NEW.movement_id;
    END IF;
  END IF;

  SELECT movement.quantity_delta, movement.provenance
  INTO v_expected, v_provenance
  FROM public.inventory_movements AS movement
  WHERE movement.store_id = v_store_id AND movement.id = v_movement_id;

  IF NOT FOUND OR v_provenance = 'legacy' THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(sum(slice.quantity_delta), 0)
  INTO v_actual
  FROM public.inventory_movement_lots AS slice
  WHERE slice.store_id = v_store_id AND slice.movement_id = v_movement_id;

  IF v_actual <> v_expected THEN
    RAISE EXCEPTION 'Inventory movement % lot slices total %, expected %', v_movement_id, v_actual, v_expected;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.protect_inventory_movement_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.provenance <> 'legacy' THEN
      RAISE EXCEPTION 'New inventory movements are append-only';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.provenance <> 'legacy' OR NEW.provenance IS DISTINCT FROM OLD.provenance THEN
    RAISE EXCEPTION 'New inventory movements are append-only';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.protect_inventory_movement_lot_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Inventory movement lot slices are append-only';
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_inventory_movement_lot_total() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.protect_inventory_movement_append_only() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.protect_inventory_movement_lot_append_only() FROM PUBLIC, anon, authenticated, service_role;

CREATE CONSTRAINT TRIGGER inventory_movements_lot_total_guard
  AFTER INSERT OR UPDATE ON public.inventory_movements
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.assert_inventory_movement_lot_total();
CREATE CONSTRAINT TRIGGER inventory_movement_lots_total_guard
  AFTER INSERT OR UPDATE OR DELETE ON public.inventory_movement_lots
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.assert_inventory_movement_lot_total();
CREATE TRIGGER inventory_movements_append_only_guard
  BEFORE UPDATE OR DELETE ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION private.protect_inventory_movement_append_only();
CREATE TRIGGER inventory_movement_lots_append_only_guard
  BEFORE UPDATE OR DELETE ON public.inventory_movement_lots
  FOR EACH ROW EXECUTE FUNCTION private.protect_inventory_movement_lot_append_only();

CREATE OR REPLACE FUNCTION private.protect_inventory_location_archive_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Inventory locations are archived, not deleted';
  END IF;
  IF NEW.store_id IS DISTINCT FROM OLD.store_id
    OR NEW.code IS DISTINCT FROM OLD.code
    OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'Inventory location identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.protect_inventory_cutover_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'complete' THEN
    RAISE EXCEPTION 'Completed inventory cutovers are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_inventory_location_archive_only() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.protect_inventory_cutover_completion() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER inventory_locations_archive_only_guard
  BEFORE UPDATE OR DELETE ON public.inventory_locations
  FOR EACH ROW EXECUTE FUNCTION private.protect_inventory_location_archive_only();
CREATE TRIGGER inventory_cutovers_completion_guard
  BEFORE UPDATE OR DELETE ON public.inventory_cutovers
  FOR EACH ROW EXECUTE FUNCTION private.protect_inventory_cutover_completion();

CREATE OR REPLACE FUNCTION private.assign_inventory_lot_location_batch(
  p_after_id uuid DEFAULT NULL,
  p_batch_size integer DEFAULT 500
)
RETURNS TABLE (last_id uuid, changed_rows bigint)
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_batch_size < 1 OR p_batch_size > 1000 THEN
    RAISE EXCEPTION 'Inventory backfill batch size must be between 1 and 1000';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT lot.id, lot.store_id, location.id AS default_location_id, lot.quantity_remaining
    FROM public.inventory_stock_lots AS lot
    JOIN public.inventory_locations AS location
      ON location.store_id = lot.store_id
     AND location.kind = 'sellable'
     AND location.is_default
     AND location.is_active
    WHERE lot.location_id IS NULL
      AND (p_after_id IS NULL OR lot.id > p_after_id)
    ORDER BY lot.id
    LIMIT p_batch_size
    FOR UPDATE OF lot
  ), updated AS (
    UPDATE public.inventory_stock_lots AS lot
    SET location_id = candidates.default_location_id,
        status = CASE WHEN candidates.quantity_remaining = 0 THEN 'exhausted' ELSE 'active' END
    FROM candidates
    WHERE lot.id = candidates.id
    RETURNING lot.id
  )
  SELECT max(candidates.id), count(updated.id)
  FROM candidates
  LEFT JOIN updated ON updated.id = candidates.id;
END;
$$;

CREATE OR REPLACE FUNCTION private.seed_inventory_balance_batch(
  p_store_id uuid,
  p_after_product_id uuid DEFAULT NULL,
  p_batch_size integer DEFAULT 500
)
RETURNS TABLE (last_product_id uuid, inserted_rows bigint)
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_batch_size < 1 OR p_batch_size > 1000 THEN
    RAISE EXCEPTION 'Inventory backfill batch size must be between 1 and 1000';
  END IF;
  RETURN QUERY
  WITH product_batch AS (
    SELECT product.id, product.store_id, product.current_stock
    FROM public.products AS product
    WHERE product.store_id = p_store_id
      AND (p_after_product_id IS NULL OR product.id > p_after_product_id)
    ORDER BY product.id
    LIMIT p_batch_size
  ), candidates AS (
    SELECT product.id, product.store_id, product.current_stock,
           location.id AS default_location_id, location.kind
    FROM product_batch AS product
    JOIN public.inventory_locations AS location
      ON location.store_id = product.store_id
     AND location.kind IN ('sellable', 'quarantine')
     AND location.is_default
     AND location.is_active
  ), inserted AS (
    INSERT INTO public.inventory_balances (store_id, product_id, location_id, quantity_on_hand, provenance)
    SELECT candidates.store_id,
           candidates.id,
           candidates.default_location_id,
           CASE WHEN candidates.kind = 'sellable' THEN candidates.current_stock ELSE 0 END,
           'shadow'
    FROM candidates
    ON CONFLICT (store_id, product_id, location_id) DO NOTHING
    RETURNING product_id
  )
  SELECT (SELECT max(product_batch.id) FROM product_batch), (SELECT count(*) FROM inserted);
END;
$$;

CREATE OR REPLACE FUNCTION private.seed_inventory_lot_location_batch(
  p_after_lot_id uuid DEFAULT NULL,
  p_batch_size integer DEFAULT 500
)
RETURNS TABLE (last_lot_id uuid, inserted_rows bigint)
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_batch_size < 1 OR p_batch_size > 1000 THEN
    RAISE EXCEPTION 'Inventory backfill batch size must be between 1 and 1000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_stock_lots AS lot WHERE lot.location_id IS NULL) THEN
    RAISE EXCEPTION 'Assign legacy lot locations before seeding lot-location balances';
  END IF;
  RETURN QUERY
  WITH lot_batch AS (
    SELECT lot.id, lot.store_id, lot.quantity_remaining
    FROM public.inventory_stock_lots AS lot
    WHERE p_after_lot_id IS NULL OR lot.id > p_after_lot_id
    ORDER BY lot.id
    LIMIT p_batch_size
  ), candidates AS (
    SELECT lot.id, lot.store_id, location.id AS balance_location_id,
           CASE WHEN location.kind = 'sellable' THEN lot.quantity_remaining ELSE 0 END AS quantity_on_hand
    FROM lot_batch AS lot
    JOIN public.inventory_locations AS location
      ON location.store_id = lot.store_id
     AND location.kind IN ('sellable', 'quarantine')
     AND location.is_default
     AND location.is_active
  ), inserted AS (
    INSERT INTO public.inventory_lot_location_balances (
      store_id, lot_id, location_id, quantity_on_hand, provenance
    )
    SELECT candidates.store_id, candidates.id, candidates.balance_location_id, candidates.quantity_on_hand, 'shadow'
    FROM candidates
    ON CONFLICT (store_id, lot_id, location_id) DO NOTHING
    RETURNING lot_id
  )
  SELECT (SELECT max(lot_batch.id) FROM lot_batch), (SELECT count(*) FROM inserted);
END;
$$;

CREATE OR REPLACE FUNCTION private.inventory_shadow_reconciliation(p_store_id uuid DEFAULT NULL)
RETURNS TABLE (
  store_id uuid,
  product_id uuid,
  product_stock numeric,
  shadow_balance_stock numeric,
  source_lot_stock numeric,
  sellable_lot_location_stock numeric,
  source_lot_count bigint,
  lot_location_count bigint,
  shadow_balance_missing boolean,
  mismatch_reasons text[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH source_lots AS (
    SELECT lot.store_id, lot.product_id,
           sum(lot.quantity_remaining)::numeric AS quantity,
           count(*)::bigint AS lot_count
    FROM public.inventory_stock_lots AS lot
    GROUP BY lot.store_id, lot.product_id
  ), sellable_balances AS (
    SELECT balance.store_id, balance.product_id, balance.id, balance.quantity_on_hand
    FROM public.inventory_balances AS balance
    JOIN public.inventory_locations AS location
      ON location.store_id = balance.store_id
     AND location.id = balance.location_id
    WHERE location.kind = 'sellable' AND location.is_default
  ), sellable_lot_locations AS (
    SELECT lot.store_id, lot.product_id,
           sum(CASE WHEN location.kind = 'sellable' AND location.is_default
             THEN balance.quantity_on_hand ELSE 0 END)::numeric AS sellable_quantity,
           count(DISTINCT lot.id)::bigint AS lot_count
    FROM public.inventory_lot_location_balances AS balance
    JOIN public.inventory_locations AS location
      ON location.store_id = balance.store_id
     AND location.id = balance.location_id
    JOIN public.inventory_stock_lots AS lot
      ON lot.store_id = balance.store_id
     AND lot.id = balance.lot_id
    GROUP BY lot.store_id, lot.product_id
  )
  SELECT product.store_id,
         product.id,
         product.current_stock::numeric,
         shadow.quantity_on_hand,
         COALESCE(source.quantity, 0),
         COALESCE(lot_location.sellable_quantity, 0),
         COALESCE(source.lot_count, 0),
         COALESCE(lot_location.lot_count, 0),
         shadow.id IS NULL,
         array_remove(ARRAY[
           CASE WHEN shadow.id IS NULL THEN 'shadow_balance_missing' END,
           CASE WHEN shadow.id IS NOT NULL AND shadow.quantity_on_hand <> product.current_stock
             THEN 'product_vs_shadow_balance' END,
           CASE WHEN COALESCE(source.quantity, 0) <> product.current_stock
             THEN 'product_vs_source_lots' END,
           CASE WHEN COALESCE(lot_location.sellable_quantity, 0) <> COALESCE(source.quantity, 0)
             THEN 'source_lots_vs_lot_location_balances' END,
           CASE WHEN COALESCE(lot_location.lot_count, 0) <> COALESCE(source.lot_count, 0)
             THEN 'source_lot_count_vs_location_balance_count' END
         ]::text[], NULL)
  FROM public.products AS product
  LEFT JOIN sellable_balances AS shadow
    ON shadow.store_id = product.store_id AND shadow.product_id = product.id
  LEFT JOIN source_lots AS source
    ON source.store_id = product.store_id AND source.product_id = product.id
  LEFT JOIN sellable_lot_locations AS lot_location
    ON lot_location.store_id = product.store_id AND lot_location.product_id = product.id
  WHERE p_store_id IS NULL OR product.store_id = p_store_id;
$$;

REVOKE ALL ON FUNCTION private.assign_inventory_lot_location_batch(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.seed_inventory_balance_batch(uuid, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.seed_inventory_lot_location_batch(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.inventory_shadow_reconciliation(uuid) FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_lot_location_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movement_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_cutovers ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_locations_store_read
  ON public.inventory_locations FOR SELECT TO authenticated
  USING ((SELECT public.user_belongs_to_store(store_id)));
CREATE POLICY inventory_balances_store_read
  ON public.inventory_balances FOR SELECT TO authenticated
  USING ((SELECT public.user_belongs_to_store(store_id)));
CREATE POLICY inventory_lot_location_balances_store_read
  ON public.inventory_lot_location_balances FOR SELECT TO authenticated
  USING ((SELECT public.user_belongs_to_store(store_id)));
CREATE POLICY inventory_movement_lots_store_read
  ON public.inventory_movement_lots FOR SELECT TO authenticated
  USING ((SELECT public.user_belongs_to_store(store_id)));
CREATE POLICY inventory_cutovers_store_read
  ON public.inventory_cutovers FOR SELECT TO authenticated
  USING ((SELECT public.user_belongs_to_store(store_id)));

REVOKE ALL ON TABLE public.inventory_locations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.inventory_balances FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.inventory_lot_location_balances FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.inventory_movement_lots FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.inventory_cutovers FROM PUBLIC, anon, authenticated, service_role;
