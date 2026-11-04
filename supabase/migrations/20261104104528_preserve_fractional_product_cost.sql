-- Base-unit costs can contain fractional centavos after converting a package
-- purchase cost (for example PHP 650 / 6 bottles = PHP 108.333333).
-- Keep enough precision on the product snapshot so lot creation does not
-- round that cost to PHP 108.33 before the sale is recorded.
-- PostgreSQL requires dependent views to be dropped and recreated for column type changes.
DROP TRIGGER record_product_price_history_trigger ON public.products;
DROP VIEW public.v_daily_sales_summary;

ALTER TABLE public.products
  ALTER COLUMN cost_price TYPE numeric(14, 6)
  USING cost_price::numeric(14, 6);

ALTER TABLE public.product_price_history
  ALTER COLUMN previous_value TYPE numeric(14, 6)
    USING previous_value::numeric(14, 6),
  ALTER COLUMN new_value TYPE numeric(14, 6)
    USING new_value::numeric(14, 6);

CREATE TRIGGER record_product_price_history_trigger
AFTER UPDATE OF cost_price, selling_price ON public.products
FOR EACH ROW EXECUTE FUNCTION private.record_product_price_history();

CREATE VIEW public.v_daily_sales_summary
WITH (security_invoker = true)
AS
SELECT date_trunc('day'::text, s.created_at)::date AS sale_date,
  count(*) AS transactions,
  COALESCE(sum(s.total), 0::numeric) AS revenue,
  COALESCE(sum(s.total - line_cost.total_cost), 0::numeric) AS gross_profit,
  round(COALESCE(sum(s.total), 0::numeric) / NULLIF(count(*), 0)::numeric, 2) AS avg_order_value
FROM public.sales s
LEFT JOIN LATERAL (
  SELECT COALESCE(sum(si.quantity::numeric * COALESCE(p.cost_price, 0::numeric)), 0::numeric) AS total_cost
  FROM public.sale_items si
  LEFT JOIN public.products p ON p.id = si.product_id
  WHERE si.sale_id = s.id
) line_cost ON true
WHERE s.status <> 'voided'::public.sale_status
GROUP BY date_trunc('day'::text, s.created_at)::date;

COMMENT ON VIEW public.v_daily_sales_summary IS
  'Aggregated daily revenue, transaction count, and avg order value for analytics.';

GRANT ALL ON TABLE public.v_daily_sales_summary TO authenticated, service_role;
