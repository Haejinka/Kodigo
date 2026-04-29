-- Migration 21: reporting snapshots and historical-safe report views

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category_name text,
  ADD COLUMN IF NOT EXISTS cost_price numeric(10,2);

UPDATE public.sale_items si
SET
  category_id = COALESCE(si.category_id, p.category_id),
  category_name = COALESCE(si.category_name, c.name, 'Uncategorized'),
  cost_price = COALESCE(si.cost_price, p.cost_price, 0)
FROM public.products p
LEFT JOIN public.categories c ON c.id = p.category_id
WHERE p.id = si.product_id
  AND (si.category_id IS NULL OR si.category_name IS NULL OR si.cost_price IS NULL);

UPDATE public.sale_items
SET
  category_name = COALESCE(category_name, 'Uncategorized'),
  cost_price = COALESCE(cost_price, 0)
WHERE category_name IS NULL
   OR cost_price IS NULL;

ALTER TABLE public.sale_items
  ALTER COLUMN category_name SET DEFAULT 'Uncategorized',
  ALTER COLUMN category_name SET NOT NULL,
  ALTER COLUMN cost_price SET DEFAULT 0,
  ALTER COLUMN cost_price SET NOT NULL;

COMMENT ON COLUMN public.sale_items.product_name IS
  'Immutable product name snapshot captured at the time of sale.';
COMMENT ON COLUMN public.sale_items.category_name IS
  'Immutable category name snapshot captured at the time of sale.';
COMMENT ON COLUMN public.sale_items.unit_price IS
  'Immutable selling price snapshot captured at the time of sale.';
COMMENT ON COLUMN public.sale_items.cost_price IS
  'Immutable cost price snapshot captured at the time of sale for profit reporting.';
COMMENT ON COLUMN public.sale_items.selling_option_label IS
  'Immutable selling option label snapshot captured at the time of sale.';
COMMENT ON COLUMN public.sale_items.unit_label IS
  'Immutable selling unit label snapshot captured at the time of sale.';
COMMENT ON COLUMN public.sale_items.package_size IS
  'Immutable sack or package size snapshot captured at the time of sale.';

CREATE INDEX IF NOT EXISTS sale_items_category_name_idx
  ON public.sale_items (category_name);

CREATE INDEX IF NOT EXISTS sale_items_reporting_sale_product_idx
  ON public.sale_items (sale_id, product_id, selling_option_id);

CREATE OR REPLACE FUNCTION public.trg_capture_sale_item_snapshots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_product record;
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    SELECT
      p.name,
      p.category_id,
      p.cost_price,
      c.name AS category_name
    INTO v_product
    FROM public.products p
    LEFT JOIN public.categories c ON c.id = p.category_id
    WHERE p.id = NEW.product_id;

    IF FOUND THEN
      NEW.product_name := COALESCE(NULLIF(NEW.product_name, ''), v_product.name);
      NEW.category_id := COALESCE(NEW.category_id, v_product.category_id);
      NEW.category_name := COALESCE(NULLIF(NEW.category_name, ''), v_product.category_name, 'Uncategorized');
      NEW.cost_price := COALESCE(NEW.cost_price, v_product.cost_price, 0);
    END IF;
  END IF;

  NEW.category_name := COALESCE(NULLIF(NEW.category_name, ''), 'Uncategorized');
  NEW.cost_price := COALESCE(NEW.cost_price, 0);
  NEW.unit_label := COALESCE(NULLIF(NEW.unit_label, ''), 'unit');
  NEW.selling_option_label := COALESCE(NULLIF(NEW.selling_option_label, ''), NEW.unit_label, 'unit');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capture_sale_item_snapshots_trigger ON public.sale_items;
CREATE TRIGGER capture_sale_item_snapshots_trigger
  BEFORE INSERT ON public.sale_items
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_capture_sale_item_snapshots();

-- Historical-safe daily report. Profit uses cost snapshots, not current product cost.
CREATE OR REPLACE VIEW public.v_daily_sales_summary
WITH (security_invoker = true)
AS
WITH line_costs AS (
  SELECT
    sale_id,
    COALESCE(SUM(quantity * cost_price), 0) AS total_cost
  FROM public.sale_items
  GROUP BY sale_id
),
refunds AS (
  SELECT
    sale_id,
    COALESCE(SUM(abs(amount)) FILTER (WHERE amount < 0 OR status = 'refunded'), 0) AS refund_total
  FROM public.sale_payments
  GROUP BY sale_id
)
SELECT
  date_trunc('day', s.created_at)::date AS sale_date,
  COUNT(*) FILTER (WHERE s.status <> 'voided') AS transactions,
  COALESCE(SUM(s.total - COALESCE(r.refund_total, 0)) FILTER (WHERE s.status <> 'voided'), 0) AS revenue,
  COALESCE(
    SUM(s.subtotal - s.discount - COALESCE(r.refund_total, 0) - COALESCE(lc.total_cost, 0))
      FILTER (WHERE s.status <> 'voided'),
    0
  ) AS gross_profit,
  ROUND(
    COALESCE(SUM(s.total - COALESCE(r.refund_total, 0)) FILTER (WHERE s.status <> 'voided'), 0) /
    NULLIF(COUNT(*) FILTER (WHERE s.status <> 'voided'), 0),
    2
  ) AS avg_order_value,
  COALESCE(SUM(s.discount) FILTER (WHERE s.status <> 'voided'), 0) AS discounts,
  COALESCE(SUM(COALESCE(r.refund_total, 0)) FILTER (WHERE s.status <> 'voided'), 0) AS refunds,
  COALESCE(SUM(s.total) FILTER (WHERE s.status = 'voided'), 0) AS voided_sales
FROM public.sales s
LEFT JOIN line_costs lc ON lc.sale_id = s.id
LEFT JOIN refunds r ON r.sale_id = s.id
GROUP BY date_trunc('day', s.created_at)::date;

CREATE OR REPLACE VIEW public.v_category_sales
WITH (security_invoker = true)
AS
SELECT
  MIN(si.category_id) AS category_id,
  COALESCE(si.category_name, 'Uncategorized') AS category,
  COALESCE(SUM(si.line_total), 0) AS revenue,
  ROUND(
    100.0 * COALESCE(SUM(si.line_total), 0) /
    NULLIF(SUM(SUM(si.line_total)) OVER (), 0),
    1
  ) AS percentage
FROM public.sale_items si
JOIN public.sales s ON s.id = si.sale_id
WHERE s.status <> 'voided'
GROUP BY COALESCE(si.category_name, 'Uncategorized');

DROP VIEW IF EXISTS public.v_product_rankings;
CREATE VIEW public.v_product_rankings
WITH (security_invoker = true)
AS
SELECT
  rank() OVER (ORDER BY SUM(si.line_total) DESC) AS rank,
  si.product_id,
  si.product_name,
  COALESCE(si.category_name, 'Uncategorized') AS category_name,
  si.selling_option_id,
  COALESCE(si.selling_option_label, si.unit_label, 'unit') AS selling_option_label,
  COALESCE(si.unit_label, 'unit') AS unit_label,
  si.package_size,
  si.package_unit,
  SUM(si.quantity) AS units_sold,
  SUM(si.line_total) AS revenue,
  SUM(si.quantity * si.cost_price) AS cost,
  SUM(si.line_total - (si.quantity * si.cost_price)) AS gross_profit,
  ROUND(
    100.0 * SUM(si.line_total) /
    NULLIF(SUM(SUM(si.line_total)) OVER (), 0),
    1
  ) AS percentage_of_total
FROM public.sale_items si
JOIN public.sales s ON s.id = si.sale_id
WHERE s.status <> 'voided'
GROUP BY
  si.product_id,
  si.product_name,
  COALESCE(si.category_name, 'Uncategorized'),
  si.selling_option_id,
  COALESCE(si.selling_option_label, si.unit_label, 'unit'),
  COALESCE(si.unit_label, 'unit'),
  si.package_size,
  si.package_unit;

DROP VIEW IF EXISTS public.v_sales_by_selling_option;
CREATE VIEW public.v_sales_by_selling_option
WITH (security_invoker = true)
AS
SELECT
  s.store_id,
  si.product_id,
  si.product_name,
  COALESCE(si.category_name, 'Uncategorized') AS category_name,
  si.selling_option_id,
  COALESCE(si.selling_option_label, si.unit_label, 'unit') AS selling_option_label,
  COALESCE(si.unit_label, 'unit') AS unit_label,
  si.package_size,
  si.package_unit,
  SUM(si.quantity) AS quantity_sold,
  SUM(si.line_total) AS revenue,
  SUM(si.quantity * si.cost_price) AS cost,
  SUM(si.line_total - (si.quantity * si.cost_price)) AS gross_profit
FROM public.sale_items si
JOIN public.sales s ON s.id = si.sale_id
WHERE s.status <> 'voided'
GROUP BY
  s.store_id,
  si.product_id,
  si.product_name,
  COALESCE(si.category_name, 'Uncategorized'),
  si.selling_option_id,
  COALESCE(si.selling_option_label, si.unit_label, 'unit'),
  COALESCE(si.unit_label, 'unit'),
  si.package_size,
  si.package_unit;

CREATE OR REPLACE VIEW public.v_sales_report_lines
WITH (security_invoker = true)
AS
SELECT
  s.store_id,
  s.id AS sale_id,
  s.receipt_number,
  s.cashier_id,
  s.payment_method,
  s.status,
  s.created_at AS transaction_at,
  si.id AS sale_item_id,
  si.product_id,
  si.product_name,
  COALESCE(si.category_name, 'Uncategorized') AS category_name,
  si.selling_option_id,
  COALESCE(si.selling_option_label, si.unit_label, 'unit') AS selling_option_label,
  COALESCE(si.unit_label, 'unit') AS unit_label,
  si.package_size,
  si.package_unit,
  si.quantity,
  si.unit_price,
  si.cost_price,
  si.line_total
FROM public.sales s
JOIN public.sale_items si ON si.sale_id = s.id;

GRANT SELECT ON public.v_daily_sales_summary TO authenticated;
GRANT SELECT ON public.v_category_sales TO authenticated;
GRANT SELECT ON public.v_product_rankings TO authenticated;
GRANT SELECT ON public.v_sales_by_selling_option TO authenticated;
GRANT SELECT ON public.v_sales_report_lines TO authenticated;
