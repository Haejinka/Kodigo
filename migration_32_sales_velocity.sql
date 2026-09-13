-- Migration 32: store-scoped, base-unit sales velocity aggregation.
--
-- Inventory users are intentionally blocked from reading raw sales and
-- payment rows. This function exposes only the aggregate needed by the
-- inventory decision screen and validates the caller before returning it.

CREATE OR REPLACE FUNCTION public.get_sales_velocity(
  p_store_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz
)
RETURNS TABLE (
  product_id uuid,
  units_sold numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
    OR COALESCE(public.current_user_role()::text, '') NOT IN ('admin', 'inventory') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at < p_start_at THEN
    RAISE EXCEPTION 'Invalid sales velocity date range';
  END IF;

  RETURN QUERY
  WITH returned AS (
    SELECT
      sri.sale_item_id,
      SUM(sri.quantity)::numeric AS returned_quantity
    FROM public.sale_return_items sri
    JOIN public.sale_returns sr ON sr.id = sri.return_id
    WHERE sr.status = 'completed'
    GROUP BY sri.sale_item_id
  )
  SELECT
    si.product_id,
    SUM(
      GREATEST(si.quantity::numeric - COALESCE(returned.returned_quantity, 0), 0)
      * CASE
          WHEN pso.shares_base_stock THEN GREATEST(COALESCE(pso.inventory_multiplier, 1), 1)
          WHEN si.stock_source = 'product'
            AND si.selling_option_id IS NULL
            AND si.package_size IS NOT NULL
            AND lower(trim(COALESCE(si.package_unit, ''))) = lower(trim(COALESCE(product.unit, '')))
            THEN GREATEST(si.package_size, 1)
          WHEN si.stock_source = 'selling_option' THEN 0
          ELSE 1
        END
    )::numeric AS units_sold
  FROM public.sales sale
  JOIN public.sale_items si ON si.sale_id = sale.id
  LEFT JOIN returned ON returned.sale_item_id = si.id
  LEFT JOIN public.product_selling_options pso ON pso.id = si.selling_option_id
  LEFT JOIN public.products product ON product.id = si.product_id
  WHERE sale.status = 'completed'
    AND sale.created_at >= p_start_at
    AND sale.created_at <= p_end_at
    AND (p_store_id IS NULL OR sale.store_id = p_store_id)
    AND public.user_belongs_to_store(sale.store_id)
    AND si.product_id IS NOT NULL
    AND (
      pso.shares_base_stock
      OR si.stock_source = 'product'
      OR (si.selling_option_id IS NULL AND si.stock_source IS DISTINCT FROM 'selling_option')
    )
  GROUP BY si.product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_sales_velocity(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_velocity(uuid, timestamptz, timestamptz) TO authenticated;
