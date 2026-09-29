-- Use the inventory ledger as the source of truth for restock consumption.
-- This includes sales and recorded stock losses across the full tracking history.

CREATE INDEX IF NOT EXISTS inventory_movements_product_history_idx
  ON public.inventory_movements (store_id, product_id, created_at)
  WHERE stock_source = 'product';

CREATE OR REPLACE FUNCTION public.get_inventory_consumption_history(
  p_store_id uuid DEFAULT NULL
)
RETURNS TABLE (
  product_id uuid,
  units_consumed numeric,
  tracking_started_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    movement.product_id,
    COALESCE(SUM(
      CASE
        WHEN movement.movement_type IN ('sale', 'lost', 'damaged', 'expired', 'manual-count', 'other')
          AND movement.quantity_delta < 0
          THEN -movement.quantity_delta
        ELSE 0
      END
    ), 0)::numeric AS units_consumed,
    MIN(movement.created_at) AS tracking_started_at
  FROM public.inventory_movements AS movement
  WHERE movement.product_id IS NOT NULL
    AND movement.stock_source = 'product'
    AND (p_store_id IS NULL OR movement.store_id = p_store_id)
  GROUP BY movement.product_id;
$$;

REVOKE ALL ON FUNCTION public.get_inventory_consumption_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_consumption_history(uuid) TO authenticated;
