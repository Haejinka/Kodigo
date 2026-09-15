-- Migration 38: archive products without breaking completed-sale history.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.products.is_active IS
  'Whether the product is available in active inventory and POS workflows. Archived products remain in history.';

CREATE INDEX IF NOT EXISTS products_active_store_idx
  ON public.products (store_id)
  WHERE is_active;

-- Hard deletion is reserved for products that have never appeared in a sale.
-- Products with history must be archived so reporting and audit records stay intact.
CREATE OR REPLACE FUNCTION private.prevent_product_delete_with_sales()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, private
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.sale_items
    WHERE product_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Product has sales history and cannot be deleted. Archive it instead.';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_product_delete_with_sales() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS prevent_product_delete_with_sales_trigger ON public.products;
CREATE TRIGGER prevent_product_delete_with_sales_trigger
BEFORE DELETE ON public.products
FOR EACH ROW EXECUTE FUNCTION private.prevent_product_delete_with_sales();
