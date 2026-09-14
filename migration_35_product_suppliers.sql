-- Migration 35: allow a product to be sourced from multiple suppliers.
--
-- products.supplier_id remains as the primary/legacy supplier reference for
-- existing purchasing and reporting flows. product_suppliers is the source of
-- truth for the complete set of supplier assignments.

CREATE TABLE IF NOT EXISTS public.product_suppliers (
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.suppliers (id) ON DELETE RESTRICT,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS product_suppliers_supplier_id_idx
  ON public.product_suppliers (supplier_id);

CREATE UNIQUE INDEX IF NOT EXISTS product_suppliers_one_primary_idx
  ON public.product_suppliers (product_id)
  WHERE is_primary;

ALTER TABLE public.product_suppliers ENABLE ROW LEVEL SECURITY;

-- Preserve all existing single-supplier assignments.
INSERT INTO public.product_suppliers (product_id, supplier_id, is_primary)
SELECT p.id, p.supplier_id, true
FROM public.products p
WHERE p.supplier_id IS NOT NULL
ON CONFLICT (product_id, supplier_id) DO UPDATE
SET is_primary = true;

CREATE OR REPLACE FUNCTION public.assert_product_supplier_store_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id uuid;
BEGIN
  SELECT p.store_id
  INTO v_store_id
  FROM public.products p
  WHERE p.id = NEW.product_id;

  IF v_store_id IS NULL
    OR NOT public.supplier_serves_store(NEW.supplier_id, v_store_id) THEN
    RAISE EXCEPTION 'Supplier % is not assigned to the product store', NEW.supplier_id
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_product_supplier_store_assignment() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_product_suppliers_validate_store ON public.product_suppliers;
CREATE TRIGGER trg_product_suppliers_validate_store
  BEFORE INSERT OR UPDATE OF product_id, supplier_id ON public.product_suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_product_supplier_store_assignment();

-- Replace a product's supplier assignments in one transaction. The first
-- supplier in the submitted array is retained as products.supplier_id so the
-- existing restocking and purchase-order flows continue to work.
CREATE OR REPLACE FUNCTION public.replace_product_suppliers(
  p_product_id uuid,
  p_supplier_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id uuid;
  v_supplier_ids uuid[];
BEGIN
  IF (SELECT auth.uid()) IS NULL
    OR COALESCE(public.current_user_role()::text, '') NOT IN ('admin', 'inventory') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT p.store_id
  INTO v_store_id
  FROM public.products p
  WHERE p.id = p_product_id;

  IF v_store_id IS NULL OR NOT public.user_belongs_to_store(v_store_id) THEN
    RAISE EXCEPTION 'Product not found or access denied';
  END IF;

  SELECT COALESCE(
    array_agg(supplier_id ORDER BY first_position),
    ARRAY[]::uuid[]
  )
  INTO v_supplier_ids
  FROM (
    SELECT supplied.supplier_id, MIN(supplied.position) AS first_position
    FROM unnest(COALESCE(p_supplier_ids, ARRAY[]::uuid[]))
      WITH ORDINALITY AS supplied(supplier_id, position)
    WHERE supplied.supplier_id IS NOT NULL
    GROUP BY supplied.supplier_id
  ) normalized;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_supplier_ids) selected(supplier_id)
    WHERE NOT public.supplier_serves_store(selected.supplier_id, v_store_id)
  ) THEN
    RAISE EXCEPTION 'Every product supplier must be assigned to the product store'
      USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.product_suppliers
  WHERE product_id = p_product_id;

  INSERT INTO public.product_suppliers (product_id, supplier_id, is_primary)
  SELECT p_product_id, selected.supplier_id, selected.position = 1
  FROM unnest(v_supplier_ids) WITH ORDINALITY AS selected(supplier_id, position);

  UPDATE public.products
  SET supplier_id = CASE
        WHEN cardinality(v_supplier_ids) > 0 THEN v_supplier_ids[1]
        ELSE NULL
      END,
      updated_at = now()
  WHERE id = p_product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_product_suppliers(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_product_suppliers(uuid, uuid[]) TO authenticated;

DROP POLICY IF EXISTS "product_suppliers: scoped read" ON public.product_suppliers;
CREATE POLICY "product_suppliers: scoped read" ON public.product_suppliers
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = product_suppliers.product_id
      AND public.user_belongs_to_store(p.store_id)
  )
  AND public.user_can_access_supplier(product_suppliers.supplier_id)
);

DROP POLICY IF EXISTS "product_suppliers: scoped write" ON public.product_suppliers;
CREATE POLICY "product_suppliers: scoped write" ON public.product_suppliers
FOR ALL TO authenticated
USING (
  public.current_user_role()::text IN ('admin', 'inventory')
  AND EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = product_suppliers.product_id
      AND public.user_belongs_to_store(p.store_id)
  )
  AND public.user_can_access_supplier(product_suppliers.supplier_id)
)
WITH CHECK (
  public.current_user_role()::text IN ('admin', 'inventory')
  AND EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = product_suppliers.product_id
      AND public.user_belongs_to_store(p.store_id)
  )
  AND public.user_can_access_supplier(product_suppliers.supplier_id)
);

-- A supplier cannot be unlinked from a store while it is used by a product as
-- either its primary supplier or an additional supplier.
CREATE OR REPLACE FUNCTION public.guard_supplier_store_unlink()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.store_id = OLD.store_id
      AND p.supplier_id = OLD.supplier_id
  ) OR EXISTS (
    SELECT 1
    FROM public.product_suppliers ps
    JOIN public.products p ON p.id = ps.product_id
    WHERE p.store_id = OLD.store_id
      AND ps.supplier_id = OLD.supplier_id
  ) THEN
    RAISE EXCEPTION 'Cannot unlink supplier from store while products still reference it.'
      USING ERRCODE = '23503';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.purchase_orders po
    WHERE po.store_id = OLD.store_id
      AND po.supplier_id = OLD.supplier_id
  ) THEN
    RAISE EXCEPTION 'Cannot unlink supplier from store while purchase orders still reference it.'
      USING ERRCODE = '23503';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_supplier_stores_guard_delete ON public.supplier_stores;
CREATE TRIGGER trg_supplier_stores_guard_delete
  BEFORE DELETE ON public.supplier_stores
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_supplier_store_unlink();
