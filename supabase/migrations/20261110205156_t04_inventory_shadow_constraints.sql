-- T04 completion after the idempotent shadow backfill batches have committed.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $t04_preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.inventory_stock_lots
    WHERE location_id IS NULL OR status IS NULL
  ) THEN
    RAISE EXCEPTION 'T04 lot location/status backfill is incomplete';
  END IF;

  IF EXISTS (
    SELECT store.id
    FROM public.stores AS store
    LEFT JOIN public.inventory_locations AS location
      ON location.store_id = store.id
     AND location.is_default
     AND location.is_active
    GROUP BY store.id
    HAVING count(DISTINCT location.kind) <> 2
  ) THEN
    RAISE EXCEPTION 'T04 requires one active default sellable and quarantine location per store';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.products AS product
    JOIN public.inventory_locations AS location
      ON location.store_id = product.store_id
     AND location.is_default
     AND location.is_active
    LEFT JOIN public.inventory_balances AS balance
      ON balance.store_id = product.store_id
     AND balance.product_id = product.id
     AND balance.location_id = location.id
    WHERE balance.id IS NULL
  ) THEN
    RAISE EXCEPTION 'T04 product balance shadow backfill is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.inventory_stock_lots AS lot
    JOIN public.inventory_locations AS location
      ON location.store_id = lot.store_id
     AND location.is_default
     AND location.is_active
    LEFT JOIN public.inventory_lot_location_balances AS balance
      ON balance.store_id = lot.store_id
     AND balance.lot_id = lot.id
     AND balance.location_id = location.id
    WHERE balance.id IS NULL
  ) THEN
    RAISE EXCEPTION 'T04 lot-location shadow backfill is incomplete';
  END IF;
END;
$t04_preflight$;

ALTER TABLE public.inventory_stock_lots
  ALTER COLUMN location_id SET NOT NULL,
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.inventory_stock_lots
  VALIDATE CONSTRAINT inventory_stock_lots_status_check,
  VALIDATE CONSTRAINT inventory_stock_lots_store_product_fkey,
  VALIDATE CONSTRAINT inventory_stock_lots_store_source_operation_fkey,
  VALIDATE CONSTRAINT inventory_stock_lots_store_location_fkey;

ALTER TABLE public.sale_item_stock_allocations
  VALIDATE CONSTRAINT sale_item_stock_allocations_counter_provenance_check,
  VALIDATE CONSTRAINT sale_item_stock_allocations_new_counter_bounds_check,
  VALIDATE CONSTRAINT sale_item_stock_allocations_store_lot_fkey,
  VALIDATE CONSTRAINT sale_item_stock_allocations_store_source_operation_fkey;

ALTER TABLE public.inventory_movements
  VALIDATE CONSTRAINT inventory_movements_store_operation_fkey,
  VALIDATE CONSTRAINT inventory_movements_store_product_fkey,
  VALIDATE CONSTRAINT inventory_movements_store_location_fkey,
  VALIDATE CONSTRAINT inventory_movements_store_product_location_balance_fkey,
  VALIDATE CONSTRAINT inventory_movements_provenance_check,
  VALIDATE CONSTRAINT inventory_movements_new_structure_check;
