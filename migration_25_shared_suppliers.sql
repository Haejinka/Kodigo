-- Migration 25: Shared suppliers across multiple stores

-- 1) Replace single-store supplier ownership with an explicit join table.
CREATE TABLE IF NOT EXISTS public.supplier_stores (
  supplier_id uuid NOT NULL REFERENCES public.suppliers (id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (supplier_id, store_id)
);

CREATE INDEX IF NOT EXISTS supplier_stores_store_id_idx
  ON public.supplier_stores (store_id);

CREATE INDEX IF NOT EXISTS supplier_stores_supplier_id_idx
  ON public.supplier_stores (supplier_id);

INSERT INTO public.supplier_stores (supplier_id, store_id)
SELECT s.id, s.store_id
FROM public.suppliers s
WHERE s.store_id IS NOT NULL
ON CONFLICT (supplier_id, store_id) DO NOTHING;

ALTER TABLE public.supplier_stores ENABLE ROW LEVEL SECURITY;

-- 2) Supplier/store helper functions.
CREATE OR REPLACE FUNCTION public.supplier_serves_store(p_supplier_id uuid, p_store_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.supplier_stores ss
    WHERE ss.supplier_id = p_supplier_id
      AND ss.store_id = p_store_id
  );
$$;

CREATE OR REPLACE FUNCTION public.user_can_access_supplier(p_supplier_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.supplier_stores ss
    WHERE ss.supplier_id = p_supplier_id
      AND public.user_belongs_to_store(ss.store_id)
  );
$$;

-- 3) Enforce that products and purchase orders only reference suppliers linked to the same store.
CREATE OR REPLACE FUNCTION public.assert_supplier_store_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.supplier_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.supplier_serves_store(NEW.supplier_id, NEW.store_id) THEN
    RAISE EXCEPTION 'Supplier % is not assigned to store %', NEW.supplier_id, NEW.store_id
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_validate_supplier_store ON public.products;
CREATE TRIGGER trg_products_validate_supplier_store
  BEFORE INSERT OR UPDATE OF supplier_id, store_id ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_supplier_store_assignment();

DROP TRIGGER IF EXISTS trg_purchase_orders_validate_supplier_store ON public.purchase_orders;
CREATE TRIGGER trg_purchase_orders_validate_supplier_store
  BEFORE INSERT OR UPDATE OF supplier_id, store_id ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_supplier_store_assignment();

-- 4) Prevent unlinking a supplier from a store while that store still uses it.
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

-- 5) Clean up orphan supplier records after the last store link is removed.
CREATE OR REPLACE FUNCTION public.delete_orphan_supplier_after_unlink()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.supplier_stores ss
    WHERE ss.supplier_id = OLD.supplier_id
  ) THEN
    DELETE FROM public.suppliers
    WHERE id = OLD.supplier_id;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_supplier_stores_cleanup_orphan ON public.supplier_stores;
CREATE TRIGGER trg_supplier_stores_cleanup_orphan
  AFTER DELETE ON public.supplier_stores
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_orphan_supplier_after_unlink();

-- 6) Rebuild supplier and supplier-store policies around the join table.
DROP POLICY IF EXISTS "suppliers: authenticated read" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers: admin write" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers: scoped read" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers: scoped write" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers: scoped insert" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers: scoped update" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers: scoped delete" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers: admin delete cascade-safe" ON public.suppliers;

CREATE POLICY "suppliers: scoped read" ON public.suppliers
FOR SELECT USING (
  public.user_can_access_supplier(id)
);

CREATE POLICY "suppliers: scoped insert" ON public.suppliers
FOR INSERT WITH CHECK (
  public.current_user_role()::text = 'admin'
);

CREATE POLICY "suppliers: scoped update" ON public.suppliers
FOR UPDATE USING (
  public.current_user_role()::text = 'admin'
  AND public.user_can_access_supplier(id)
) WITH CHECK (
  public.current_user_role()::text = 'admin'
);

CREATE POLICY "suppliers: scoped delete" ON public.suppliers
FOR DELETE USING (
  public.current_user_role()::text = 'admin'
  AND (
    pg_trigger_depth() > 0
    OR public.user_can_access_supplier(id)
  )
);

DROP POLICY IF EXISTS "supplier_stores: scoped read" ON public.supplier_stores;
DROP POLICY IF EXISTS "supplier_stores: scoped insert" ON public.supplier_stores;
DROP POLICY IF EXISTS "supplier_stores: scoped delete" ON public.supplier_stores;

CREATE POLICY "supplier_stores: scoped read" ON public.supplier_stores
FOR SELECT USING (
  public.user_belongs_to_store(store_id)
);

CREATE POLICY "supplier_stores: scoped insert" ON public.supplier_stores
FOR INSERT WITH CHECK (
  public.current_user_role()::text = 'admin'
  AND public.user_belongs_to_store(store_id)
);

CREATE POLICY "supplier_stores: scoped delete" ON public.supplier_stores
FOR DELETE USING (
  public.current_user_role()::text = 'admin'
  AND (
    pg_trigger_depth() > 0
    OR public.user_belongs_to_store(store_id)
  )
);

-- 7) Drop the old single-store supplier column after backfill and policy migration.
ALTER TABLE public.suppliers DROP COLUMN IF EXISTS store_id;
