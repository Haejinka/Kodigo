-- T09: publish a tenant-scoped report projection over the canonical T08 facts.
-- No historical rows are classified or rewritten by this migration.

CREATE OR REPLACE FUNCTION public.get_sale_financial_facts(p_sale_id uuid)
RETURNS TABLE (
  sale_id uuid,
  store_id uuid,
  accounting_version smallint,
  line_amount_basis text,
  financial_complete boolean,
  unclassified_count integer,
  gross_billed numeric(14,2),
  sale_discount numeric(14,2),
  net_billed numeric(14,2),
  posted_credits numeric(14,2),
  captured_payments numeric(14,2),
  confirmed_refunds numeric(14,2),
  net_paid numeric(14,2),
  refund_due numeric(14,2),
  settlement_unknown boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;
  IF NOT private.mfa_session_is_valid() THEN
    RAISE EXCEPTION 'A valid MFA session is required.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT facts.sale_id, facts.store_id, facts.accounting_version,
    facts.line_amount_basis, facts.financial_complete, facts.unclassified_count,
    facts.gross_billed, facts.sale_discount,
    CASE WHEN sale.status = 'voided' AND facts.posted_credits = 0
      THEN 0::numeric(14,2) ELSE facts.net_billed END,
    facts.posted_credits, facts.captured_payments, facts.confirmed_refunds,
    facts.net_paid, facts.refund_due, facts.settlement_unknown
  FROM private.sale_financial_facts(p_sale_id) AS facts
  JOIN public.sales AS sale ON sale.id = facts.sale_id
  WHERE EXISTS (
    SELECT 1 FROM public.store_users AS membership
    WHERE membership.store_id = sale.store_id
      AND membership.profile_id = (SELECT auth.uid())
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_sales_report_facts(p_sale_ids uuid[] DEFAULT NULL)
RETURNS TABLE (
  sale_id uuid,
  store_id uuid,
  accounting_version smallint,
  line_amount_basis text,
  financial_complete boolean,
  unclassified_count integer,
  gross_billed numeric(14,2),
  sale_discount numeric(14,2),
  net_billed numeric(14,2),
  posted_credits numeric(14,2),
  captured_payments numeric(14,2),
  confirmed_refunds numeric(14,2),
  net_paid numeric(14,2),
  refund_due numeric(14,2),
  settlement_unknown boolean,
  sale_status text,
  created_at timestamptz,
  tax numeric(14,2),
  line_facts jsonb,
  unallocated_billed numeric(14,2),
  attribution_complete boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;
  IF NOT private.mfa_session_is_valid() THEN
    RAISE EXCEPTION 'A valid MFA session is required.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(pg_catalog.cardinality(p_sale_ids), 0) > 5000 THEN
    RAISE EXCEPTION 'At most 5000 sale IDs may be requested.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(public.current_user_role()::text, '') NOT IN ('admin', 'cashier') THEN
    RAISE EXCEPTION 'Access denied.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH requested_sales AS (
    SELECT DISTINCT sale.id, sale.store_id, sale.status::text AS sale_status,
      sale.created_at, sale.tax
    FROM public.sales AS sale
    WHERE (p_sale_ids IS NULL OR sale.id = ANY(p_sale_ids))
      AND public.user_belongs_to_store(sale.store_id)
      AND EXISTS (
        SELECT 1 FROM public.store_users AS membership
        WHERE membership.store_id = sale.store_id
          AND membership.profile_id = (SELECT auth.uid())
      )
  ), financial AS (
    SELECT sale.id AS sale_id, sale.store_id, sale.sale_status, sale.created_at, sale.tax,
      facts.accounting_version, facts.line_amount_basis, facts.financial_complete,
      facts.unclassified_count, facts.gross_billed, facts.sale_discount,
      CASE WHEN sale.sale_status = 'voided' AND facts.posted_credits = 0
        THEN 0::numeric(14,2) ELSE facts.net_billed END AS net_billed,
      facts.posted_credits, facts.captured_payments, facts.confirmed_refunds,
      facts.net_paid, facts.refund_due, facts.settlement_unknown
    FROM requested_sales AS sale
    CROSS JOIN LATERAL private.sale_financial_facts(sale.id) AS facts
  ), adjustment_line_totals AS (
    SELECT item.sale_id, item.sale_item_id,
      COALESCE(sum(item.amount), 0)::numeric(14,2) AS amount_credited,
      COALESCE(sum(item.quantity_credited) FILTER (WHERE item.source_type = 'return_item'), 0)::numeric AS quantity_returned,
      COALESCE(sum(item.base_quantity_credited) FILTER (WHERE item.source_type = 'return_item'), 0)::numeric(14,6) AS base_quantity_returned,
      COALESCE(sum(item.cogs_recovered), 0)::numeric(14,2) AS recorded_cogs_recovered
    FROM public.sale_adjustment_items AS item
    JOIN public.sale_adjustments AS adjustment
      ON adjustment.store_id = item.store_id
     AND adjustment.id = item.adjustment_id
     AND adjustment.sale_id = item.sale_id
     AND adjustment.status = 'posted'
    JOIN financial ON financial.sale_id = item.sale_id
    WHERE item.sale_item_id IS NOT NULL
    GROUP BY item.sale_id, item.sale_item_id
  ), legacy_return_line_totals AS (
    SELECT return_header.sale_id, returned.sale_item_id,
      COALESCE(sum(returned.line_total), 0)::numeric(14,2) AS amount_credited,
      COALESCE(sum(returned.quantity), 0)::numeric AS quantity_returned,
      COALESCE(sum(returned.quantity * COALESCE(line.units_per_package, 1)), 0)::numeric(14,6) AS base_quantity_returned
    FROM public.sale_return_items AS returned
    JOIN public.sale_returns AS return_header
      ON return_header.id = returned.return_id
     AND return_header.status = 'completed'
    JOIN public.sale_items AS line
      ON line.sale_id = return_header.sale_id
     AND line.id = returned.sale_item_id
    JOIN financial ON financial.sale_id = return_header.sale_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.sale_adjustments AS linked
      WHERE linked.store_id = financial.store_id
        AND linked.sale_id = return_header.sale_id
        AND linked.source_type = 'return'
        AND linked.source_id = return_header.id
    )
    GROUP BY return_header.sale_id, returned.sale_item_id
  ), allocation_costs AS (
    SELECT allocation.sale_item_id,
      COALESCE(sum(allocation.quantity_base_units * allocation.unit_cost), 0)::numeric AS allocated_cogs,
      COALESCE(sum(allocation.restocked_quantity * allocation.unit_cost), 0)::numeric(14,2) AS restocked_cogs
    FROM public.sale_item_stock_allocations AS allocation
    GROUP BY allocation.sale_item_id
  ), source_lines AS (
    SELECT financial.sale_id, financial.line_amount_basis,
      line.id AS sale_item_id, line.product_id, line.product_name,
      COALESCE(line.category_name, 'Uncategorized') AS category_name,
      line.selling_option_id,
      COALESCE(line.selling_option_label, line.unit_label, 'unit') AS selling_option_label,
      COALESCE(line.unit_label, 'unit') AS unit_label,
      line.package_size, line.package_unit, line.purchase_mode,
      line.quantity::numeric AS quantity,
      COALESCE(line.base_unit_quantity, line.quantity::numeric) AS base_unit_quantity,
      COALESCE(line.units_per_package, 1)::numeric AS units_per_package,
      line.line_total, COALESCE(line.item_discount_amount, 0)::numeric(14,2) AS item_discount_amount,
      COALESCE(adjustment.amount_credited, 0) + COALESCE(legacy.amount_credited, 0) AS amount_credited,
      COALESCE(adjustment.quantity_returned, 0) + COALESCE(legacy.quantity_returned, 0) AS quantity_returned,
      COALESCE(adjustment.base_quantity_returned, 0) + COALESCE(legacy.base_quantity_returned, 0) AS base_quantity_returned,
      COALESCE(adjustment.recorded_cogs_recovered, 0) AS recorded_cogs_recovered,
      COALESCE(cost.allocated_cogs, line.cogs, line.cost_price * line.quantity, 0) AS allocated_cogs,
      COALESCE(cost.restocked_cogs, 0) AS restocked_cogs,
      financial.sale_discount, financial.sale_status
    FROM financial
    JOIN public.sale_items AS line ON line.sale_id = financial.sale_id
    LEFT JOIN adjustment_line_totals AS adjustment
      ON adjustment.sale_id = line.sale_id AND adjustment.sale_item_id = line.id
    LEFT JOIN legacy_return_line_totals AS legacy
      ON legacy.sale_id = line.sale_id AND legacy.sale_item_id = line.id
    LEFT JOIN allocation_costs AS cost ON cost.sale_item_id = line.id
  ), weighted_lines AS (
    SELECT line.*,
      GREATEST(pg_catalog.round(line.line_total * 100)::bigint, 0) AS weight_cents,
      sum(GREATEST(pg_catalog.round(line.line_total * 100)::bigint, 0))
        OVER (PARTITION BY line.sale_id) AS total_weight_cents
    FROM source_lines AS line
  ), discount_shares AS (
    SELECT line.*,
      LEAST(
        GREATEST(pg_catalog.round(COALESCE(line.sale_discount, 0) * 100)::bigint, 0),
        line.total_weight_cents
      ) AS discount_total_cents,
      CASE WHEN line.line_amount_basis = 'legacy_gross' AND line.total_weight_cents > 0
        THEN LEAST(
          GREATEST(pg_catalog.round(COALESCE(line.sale_discount, 0) * 100)::bigint, 0),
          line.total_weight_cents
        )::numeric * line.weight_cents / line.total_weight_cents
        ELSE 0::numeric END AS exact_discount_cents
    FROM weighted_lines AS line
  ), discount_floors AS (
    SELECT line.*,
      pg_catalog.floor(line.exact_discount_cents)::bigint AS base_discount_cents,
      line.exact_discount_cents - pg_catalog.floor(line.exact_discount_cents) AS discount_remainder
    FROM discount_shares AS line
  ), ranked_discount_remainders AS (
    SELECT line.*,
      GREATEST(line.discount_total_cents - sum(line.base_discount_cents) OVER (PARTITION BY line.sale_id), 0) AS cents_remaining,
      row_number() OVER (
        PARTITION BY line.sale_id
        ORDER BY line.discount_remainder DESC, line.sale_item_id ASC
      ) AS remainder_rank
    FROM discount_floors AS line
  ), allocated_lines AS (
    SELECT line.*,
      CASE line.line_amount_basis
        WHEN 'net_item_discounted' THEN line.item_discount_amount
        WHEN 'legacy_gross' THEN (
          line.base_discount_cents + CASE WHEN line.remainder_rank <= line.cents_remaining THEN 1 ELSE 0 END
        )::numeric / 100
        ELSE NULL::numeric
      END AS discount_allocated,
      CASE line.line_amount_basis
        WHEN 'net_item_discounted' THEN line.line_total + line.item_discount_amount
        WHEN 'legacy_gross' THEN line.line_total
        ELSE NULL::numeric
      END AS gross_revenue,
      GREATEST(line.recorded_cogs_recovered, line.restocked_cogs) AS cogs_recovered
    FROM ranked_discount_remainders AS line
  ), normalized_lines AS (
    SELECT line.*,
      CASE
        WHEN line.sale_status = 'voided' THEN 0::numeric
        WHEN line.line_amount_basis = 'net_item_discounted'
          THEN line.line_total - line.amount_credited
        WHEN line.line_amount_basis = 'legacy_gross'
          THEN line.line_total - line.discount_allocated - line.amount_credited
        ELSE NULL::numeric
      END AS net_revenue,
      GREATEST(line.allocated_cogs - line.cogs_recovered, 0) AS line_cost
    FROM allocated_lines AS line
  ), line_summaries AS (
    SELECT line.sale_id,
      sum(line.net_revenue) FILTER (WHERE line.net_revenue IS NOT NULL) AS attributed_billed,
      COALESCE(jsonb_agg(jsonb_build_object(
        'sale_item_id', line.sale_item_id,
        'product_id', line.product_id,
        'product_name', line.product_name,
        'category_name', line.category_name,
        'selling_option_id', line.selling_option_id,
        'selling_option_label', line.selling_option_label,
        'unit_label', line.unit_label,
        'package_size', line.package_size,
        'package_unit', line.package_unit,
        'purchase_mode', line.purchase_mode,
        'quantity', line.quantity,
        'base_unit_quantity', line.base_unit_quantity,
        'units_per_package', line.units_per_package,
        'line_amount_basis', line.line_amount_basis,
        'gross_revenue', line.gross_revenue,
        'discount_allocated', line.discount_allocated,
        'credit_allocated', line.amount_credited,
        'net_revenue', line.net_revenue,
        'returned_quantity', line.quantity_returned,
        'returned_base_quantity', line.base_quantity_returned,
        'cogs_recovered', line.cogs_recovered,
        'line_cost', line.line_cost,
        'financial_attribution_complete', line.net_revenue IS NOT NULL
      ) ORDER BY line.sale_item_id), '[]'::jsonb) AS line_facts
    FROM normalized_lines AS line
    GROUP BY line.sale_id
  )
  SELECT financial.sale_id, financial.store_id, financial.accounting_version,
    financial.line_amount_basis, financial.financial_complete, financial.unclassified_count,
    financial.gross_billed, financial.sale_discount, financial.net_billed,
    financial.posted_credits, financial.captured_payments, financial.confirmed_refunds,
    financial.net_paid, financial.refund_due, financial.settlement_unknown,
    financial.sale_status, financial.created_at, financial.tax,
    COALESCE(lines.line_facts, '[]'::jsonb),
    CASE WHEN NOT financial.financial_complete THEN financial.net_billed
      ELSE financial.net_billed - COALESCE(lines.attributed_billed, 0)::numeric(14,2) END::numeric(14,2),
    (financial.financial_complete AND abs(
      financial.net_billed - COALESCE(lines.attributed_billed, 0)::numeric(14,2)
    ) < 0.01)
  FROM financial
  LEFT JOIN line_summaries AS lines ON lines.sale_id = financial.sale_id;
END;
$function$;

CREATE OR REPLACE VIEW public.v_product_rankings
WITH (security_invoker = true)
AS
WITH report_lines AS (
  SELECT facts.store_id, facts.sale_status, facts.attribution_complete,
    line.product_id, line.product_name, line.category_name,
    line.unit_label, line.quantity, line.base_unit_quantity,
    line.returned_quantity, line.returned_base_quantity,
    line.gross_revenue, line.discount_allocated, line.credit_allocated,
    line.net_revenue, line.line_cost, line.financial_attribution_complete
  FROM public.get_sales_report_facts(NULL) AS facts
  CROSS JOIN LATERAL jsonb_to_recordset(facts.line_facts) AS line(
    product_id uuid, product_name text, category_name text, unit_label text,
    quantity numeric, base_unit_quantity numeric, returned_quantity numeric,
    returned_base_quantity numeric, gross_revenue numeric,
    discount_allocated numeric, credit_allocated numeric, net_revenue numeric,
    line_cost numeric, financial_attribution_complete boolean
  )
  WHERE facts.sale_status IN ('completed', 'partially_refunded', 'refunded')
    AND line.product_id IS NOT NULL
)
SELECT
  rank() OVER (ORDER BY sum(line.net_revenue) DESC NULLS LAST,
    sum(GREATEST(line.base_unit_quantity - line.returned_base_quantity, 0)) DESC,
    max(line.product_name)) AS rank,
  line.product_id,
  max(line.product_name) AS product_name,
  max(COALESCE(line.category_name, 'Uncategorized')) AS category_name,
  NULL::uuid AS selling_option_id,
  'Multiple purchase modes'::text AS selling_option_label,
  max(COALESCE(line.unit_label, 'unit')) AS unit_label,
  NULL::numeric AS package_size,
  NULL::text AS package_unit,
  sum(GREATEST(line.base_unit_quantity - line.returned_base_quantity, 0)) AS units_sold,
  sum(GREATEST(line.quantity - line.returned_quantity, 0))::bigint AS packages_sold,
  sum(line.net_revenue) AS revenue,
  sum(line.line_cost) FILTER (WHERE line.net_revenue IS NOT NULL) AS cost,
  sum(line.net_revenue - line.line_cost) FILTER (WHERE line.net_revenue IS NOT NULL) AS gross_profit,
  round(100.0 * sum(line.net_revenue) / NULLIF(sum(sum(line.net_revenue)) OVER (), 0), 1) AS percentage_of_total,
  bool_and(line.financial_attribution_complete AND line.attribution_complete) AS financial_complete
FROM report_lines AS line
GROUP BY line.product_id;

CREATE OR REPLACE VIEW public.v_sales_by_selling_option
WITH (security_invoker = true)
AS
WITH report_lines AS (
  SELECT facts.store_id, facts.sale_status, facts.attribution_complete,
    line.product_id, line.product_name, line.category_name,
    line.selling_option_id, line.selling_option_label, line.unit_label,
    line.package_size, line.package_unit, line.purchase_mode,
    line.quantity, line.base_unit_quantity, line.returned_quantity,
    line.returned_base_quantity, line.net_revenue, line.line_cost,
    line.financial_attribution_complete
  FROM public.get_sales_report_facts(NULL) AS facts
  CROSS JOIN LATERAL jsonb_to_recordset(facts.line_facts) AS line(
    product_id uuid, product_name text, category_name text,
    selling_option_id uuid, selling_option_label text, unit_label text,
    package_size numeric, package_unit text, purchase_mode text,
    quantity numeric, base_unit_quantity numeric, returned_quantity numeric,
    returned_base_quantity numeric, net_revenue numeric, line_cost numeric,
    financial_attribution_complete boolean
  )
  WHERE facts.sale_status IN ('completed', 'partially_refunded', 'refunded')
    AND line.product_id IS NOT NULL
)
SELECT line.store_id, line.product_id, line.product_name,
  COALESCE(line.category_name, 'Uncategorized') AS category_name,
  line.selling_option_id, COALESCE(line.selling_option_label, line.unit_label, 'unit') AS selling_option_label,
  COALESCE(line.unit_label, 'unit') AS unit_label, line.package_size, line.package_unit,
  line.purchase_mode,
  sum(GREATEST(line.quantity - line.returned_quantity, 0))::bigint AS quantity_sold,
  sum(GREATEST(line.base_unit_quantity - line.returned_base_quantity, 0)) AS base_units_sold,
  sum(line.net_revenue) AS revenue,
  sum(line.line_cost) FILTER (WHERE line.net_revenue IS NOT NULL) AS cost,
  sum(line.net_revenue - line.line_cost) FILTER (WHERE line.net_revenue IS NOT NULL) AS gross_profit,
  bool_and(line.financial_attribution_complete AND line.attribution_complete) AS financial_complete
FROM report_lines AS line
GROUP BY line.store_id, line.product_id, line.product_name,
  COALESCE(line.category_name, 'Uncategorized'), line.selling_option_id,
  COALESCE(line.selling_option_label, line.unit_label, 'unit'),
  COALESCE(line.unit_label, 'unit'), line.package_size, line.package_unit, line.purchase_mode;

REVOKE ALL ON FUNCTION public.get_sale_financial_facts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sale_financial_facts(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_sales_report_facts(uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_sales_report_facts(uuid[]) TO authenticated;
REVOKE ALL ON public.v_product_rankings, public.v_sales_by_selling_option FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_product_rankings, public.v_sales_by_selling_option TO authenticated;

CREATE OR REPLACE FUNCTION public.get_inventory_consumption_history(p_store_id uuid DEFAULT NULL)
RETURNS TABLE (
  product_id uuid,
  units_consumed numeric,
  tracking_started_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT movement.product_id,
    COALESCE(sum(CASE
      WHEN movement.movement_type IN ('sale', 'offline_sale', 'lost', 'damaged', 'expired', 'manual-count', 'manual_adjustment', 'quarantine_disposal', 'other')
        AND movement.quantity_delta < 0
        THEN -movement.quantity_delta
      ELSE 0
    END), 0)::numeric AS units_consumed,
    min(movement.created_at) AS tracking_started_at
  FROM public.inventory_movements AS movement
  WHERE movement.product_id IS NOT NULL
    AND movement.stock_source = 'product'
    AND (p_store_id IS NULL OR movement.store_id = p_store_id)
  GROUP BY movement.product_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_sales_velocity(
  p_store_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz
)
RETURNS TABLE (product_id uuid, units_sold numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL
    OR COALESCE(public.current_user_role()::text, '') NOT IN ('admin', 'inventory') THEN
    RAISE EXCEPTION 'Access denied.' USING ERRCODE = '42501';
  END IF;
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at < p_start_at THEN
    RAISE EXCEPTION 'Invalid sales velocity date range.' USING ERRCODE = '22023';
  END IF;
  IF p_store_id IS NOT NULL AND NOT public.user_belongs_to_store(p_store_id) THEN
    RAISE EXCEPTION 'Store access denied.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH returned AS (
    SELECT return_line.sale_item_id, sum(return_line.quantity)::numeric AS returned_quantity
    FROM (
      SELECT legacy_line.sale_item_id, legacy_line.quantity
      FROM public.sale_return_items AS legacy_line
      JOIN public.sale_returns AS return_header
        ON return_header.id = legacy_line.return_id
       AND return_header.status = 'completed'
      WHERE NOT EXISTS (
        SELECT 1 FROM public.sale_adjustments AS linked
        WHERE linked.sale_id = return_header.sale_id
          AND linked.source_type = 'return'
          AND linked.source_id = return_header.id
      )
      UNION ALL
      SELECT adjustment_line.sale_item_id, adjustment_line.quantity_credited
      FROM public.sale_adjustment_items AS adjustment_line
      JOIN public.sale_adjustments AS adjustment
        ON adjustment.store_id = adjustment_line.store_id
       AND adjustment.id = adjustment_line.adjustment_id
       AND adjustment.sale_id = adjustment_line.sale_id
       AND adjustment.source_type = 'return'
       AND adjustment.status = 'posted'
      WHERE adjustment_line.source_type = 'return_item'
        AND adjustment_line.sale_item_id IS NOT NULL
    ) AS return_line
    GROUP BY return_line.sale_item_id
  )
  SELECT line.product_id,
    sum(GREATEST(COALESCE(line.base_unit_quantity, line.quantity::numeric)
      - COALESCE(returned.returned_quantity, 0) * COALESCE(line.units_per_package, 1), 0))::numeric AS units_sold
  FROM public.sales AS sale
  JOIN public.sale_items AS line ON line.sale_id = sale.id
  LEFT JOIN returned ON returned.sale_item_id = line.id
  WHERE sale.status IN ('completed', 'partially_refunded', 'refunded')
    AND sale.created_at >= p_start_at
    AND sale.created_at <= p_end_at
    AND (p_store_id IS NULL OR sale.store_id = p_store_id)
    AND public.user_belongs_to_store(sale.store_id)
    AND line.product_id IS NOT NULL
    AND line.stock_source = 'product'
  GROUP BY line.product_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_inventory_consumption_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_consumption_history(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_sales_velocity(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_velocity(uuid, timestamptz, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.get_sales_report_facts(uuid[]) IS
  'Read-only, MFA-gated, store-scoped projection of T08 financial facts and per-line attributed amounts; legacy_unknown amounts remain unallocated.';
COMMENT ON VIEW public.v_product_rankings IS
  'Product-only ranking over versioned T08 net billed line facts; unknown legacy revenue remains NULL and quantity remains rankable.';
COMMENT ON FUNCTION public.get_inventory_consumption_history(uuid) IS
  'Maps legacy loss types and normalized sale/offline-sale/disposal movements to product consumption; transfers, returns, void restores, baselines and restocks are excluded.';
