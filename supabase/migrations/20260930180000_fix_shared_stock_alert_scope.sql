-- Shared-stock selling options (such as cases derived from cans) must not emit
-- product stock alerts from their own package count. Use the product's base
-- inventory for those alerts instead.

CREATE OR REPLACE FUNCTION public.evaluate_product_stock_notification(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_category_name text;
  v_dedupe_key text;
  v_type text;
  v_severity text;
  v_title text;
  v_message text;
BEGIN
  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = p_product_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Product-level stock is authoritative for products with shared-base-stock
  -- options. Keep the legacy behavior for products that only have independently
  -- tracked option balances.
  IF EXISTS (
    SELECT 1
    FROM public.product_selling_options pso
    WHERE pso.product_id = p_product_id
      AND pso.is_active
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.product_selling_options pso
    WHERE pso.product_id = p_product_id
      AND pso.is_active
      AND pso.shares_base_stock
  ) THEN
    RETURN;
  END IF;

  v_dedupe_key := 'stock:' || v_product.id::text || ':product';

  IF v_product.current_stock > 0
    AND (v_product.min_stock_level <= 0 OR v_product.current_stock > v_product.min_stock_level) THEN
    PERFORM public.resolve_stock_notification(v_product.store_id, v_dedupe_key);
    RETURN;
  END IF;

  SELECT c.name
  INTO v_category_name
  FROM public.categories c
  WHERE c.id = v_product.category_id;

  IF v_product.current_stock <= 0 THEN
    v_type := 'out_of_stock';
    v_severity := 'critical';
    v_title := v_product.name || ' is out of stock';
    v_message := v_product.name || ' has no stock remaining.';
  ELSE
    v_type := 'low_stock';
    v_severity := 'warning';
    v_title := 'Low stock: ' || v_product.name;
    v_message := v_product.name || ' has ' || v_product.current_stock::text ||
      ' left; threshold is ' || v_product.min_stock_level::text || '.';
  END IF;

  PERFORM public.create_notification(
    v_product.store_id,
    v_type,
    v_severity,
    v_title,
    v_message,
    ARRAY['admin']::text[],
    'products',
    v_product.id,
    'product',
    v_product.id,
    v_product.id,
    NULL,
    'product',
    v_product.current_stock,
    v_product.min_stock_level,
    jsonb_build_object(
      'productName', v_product.name,
      'categoryName', COALESCE(v_category_name, 'Uncategorized'),
      'sellingOptionLabel', COALESCE(NULLIF(v_product.unit, ''), 'unit'),
      'unitLabel', COALESCE(NULLIF(v_product.unit, ''), 'unit')
    ),
    v_dedupe_key
  );
END;
$$;

-- Preserve the existing behavior for options with their own stock balance, but
-- route options that share base stock through product-level alert evaluation.
ALTER FUNCTION public.evaluate_selling_option_stock_notification(uuid)
  RENAME TO evaluate_independent_selling_option_stock_notification;

CREATE OR REPLACE FUNCTION public.evaluate_selling_option_stock_notification(p_option_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_option public.product_selling_options%ROWTYPE;
  v_dedupe_key text;
BEGIN
  SELECT *
  INTO v_option
  FROM public.product_selling_options
  WHERE id = p_option_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_option.shares_base_stock THEN
    v_dedupe_key := 'stock:' || v_option.product_id::text || ':' || v_option.id::text;
    PERFORM public.resolve_stock_notification(v_option.store_id, v_dedupe_key);
    PERFORM public.evaluate_product_stock_notification(v_option.product_id);
    RETURN;
  END IF;

  PERFORM public.evaluate_independent_selling_option_stock_notification(p_option_id);
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_selling_option_stock_notification(uuid) FROM PUBLIC;

-- Clear existing package-level false positives and rebuild current alerts using
-- the correct source of stock for each product/option.
UPDATE public.notifications n
SET resolved_at = now()
FROM public.product_selling_options pso
WHERE n.selling_option_id = pso.id
  AND pso.shares_base_stock
  AND n.type IN ('low_stock', 'out_of_stock')
  AND n.resolved_at IS NULL;

SELECT public.evaluate_product_stock_notification(p.id)
FROM public.products p
WHERE NOT EXISTS (
  SELECT 1
  FROM public.product_selling_options pso
  WHERE pso.product_id = p.id
    AND pso.is_active
)
OR EXISTS (
  SELECT 1
  FROM public.product_selling_options pso
  WHERE pso.product_id = p.id
    AND pso.is_active
    AND pso.shares_base_stock
);

SELECT public.evaluate_selling_option_stock_notification(pso.id)
FROM public.product_selling_options pso
WHERE pso.is_active
  AND NOT pso.shares_base_stock;
