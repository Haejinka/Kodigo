-- T04 forward fix: PostgreSQL does not provide max(uuid).
-- Batch helpers return the highest UUID through ORDER BY/LIMIT, preserving
-- the original cursor contract without rewriting inventory quantities.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

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
  SELECT (
           SELECT candidate.id
           FROM candidates AS candidate
           ORDER BY candidate.id DESC
           LIMIT 1
         ),
         count(updated.id)
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
  SELECT (
           SELECT product_batch.id
           FROM product_batch
           ORDER BY product_batch.id DESC
           LIMIT 1
         ),
         (SELECT count(*) FROM inserted);
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
  SELECT (
           SELECT lot_batch.id
           FROM lot_batch
           ORDER BY lot_batch.id DESC
           LIMIT 1
         ),
         (SELECT count(*) FROM inserted);
END;
$$;

REVOKE ALL ON FUNCTION private.assign_inventory_lot_location_batch(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.seed_inventory_balance_batch(uuid, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.seed_inventory_lot_location_batch(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
