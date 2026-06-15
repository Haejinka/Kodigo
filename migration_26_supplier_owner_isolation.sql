-- Migration 26: Keep shared suppliers private to the owner who created them

-- 1) Track supplier ownership explicitly.
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS owner_profile_id uuid REFERENCES public.profiles (id) ON DELETE RESTRICT;

UPDATE public.suppliers s
SET owner_profile_id = owner_map.profile_id
FROM (
  SELECT DISTINCT ON (ss.supplier_id)
    ss.supplier_id,
    su.profile_id
  FROM public.supplier_stores ss
  JOIN public.store_users su
    ON su.store_id = ss.store_id
  JOIN public.profiles p
    ON p.id = su.profile_id
  WHERE p.role = 'admin'
  ORDER BY ss.supplier_id, su.profile_id
) AS owner_map
WHERE s.id = owner_map.supplier_id
  AND s.owner_profile_id IS NULL;

UPDATE public.suppliers
SET owner_profile_id = auth.uid()
WHERE owner_profile_id IS NULL
  AND auth.uid() IS NOT NULL;

ALTER TABLE public.suppliers
  ALTER COLUMN owner_profile_id SET DEFAULT auth.uid();

ALTER TABLE public.suppliers
  ALTER COLUMN owner_profile_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS suppliers_owner_profile_id_idx
  ON public.suppliers (owner_profile_id);

-- 2) Helper to ensure only the owning admin can manage or view their supplier graph.
CREATE OR REPLACE FUNCTION public.user_owns_supplier(p_supplier_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.suppliers s
    WHERE s.id = p_supplier_id
      AND s.owner_profile_id = auth.uid()
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
    JOIN public.suppliers s
      ON s.id = ss.supplier_id
    WHERE ss.supplier_id = p_supplier_id
      AND s.owner_profile_id = auth.uid()
      AND public.user_belongs_to_store(ss.store_id)
  );
$$;

-- 3) Rebuild policies so supplier visibility and linking are owner-scoped.
DROP POLICY IF EXISTS "suppliers: scoped read" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers: scoped insert" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers: scoped update" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers: scoped delete" ON public.suppliers;

CREATE POLICY "suppliers: scoped read" ON public.suppliers
FOR SELECT USING (
  public.user_can_access_supplier(id)
);

CREATE POLICY "suppliers: scoped insert" ON public.suppliers
FOR INSERT WITH CHECK (
  public.current_user_role()::text = 'admin'
  AND owner_profile_id = auth.uid()
);

CREATE POLICY "suppliers: scoped update" ON public.suppliers
FOR UPDATE USING (
  public.current_user_role()::text = 'admin'
  AND public.user_owns_supplier(id)
) WITH CHECK (
  public.current_user_role()::text = 'admin'
  AND owner_profile_id = auth.uid()
);

CREATE POLICY "suppliers: scoped delete" ON public.suppliers
FOR DELETE USING (
  public.current_user_role()::text = 'admin'
  AND (
    pg_trigger_depth() > 0
    OR public.user_owns_supplier(id)
  )
);

DROP POLICY IF EXISTS "supplier_stores: scoped read" ON public.supplier_stores;
DROP POLICY IF EXISTS "supplier_stores: scoped insert" ON public.supplier_stores;
DROP POLICY IF EXISTS "supplier_stores: scoped delete" ON public.supplier_stores;

CREATE POLICY "supplier_stores: scoped read" ON public.supplier_stores
FOR SELECT USING (
  public.user_belongs_to_store(store_id)
  AND public.user_owns_supplier(supplier_id)
);

CREATE POLICY "supplier_stores: scoped insert" ON public.supplier_stores
FOR INSERT WITH CHECK (
  public.current_user_role()::text = 'admin'
  AND public.user_belongs_to_store(store_id)
  AND public.user_owns_supplier(supplier_id)
);

CREATE POLICY "supplier_stores: scoped delete" ON public.supplier_stores
FOR DELETE USING (
  public.current_user_role()::text = 'admin'
  AND (
    pg_trigger_depth() > 0
    OR (
      public.user_belongs_to_store(store_id)
      AND public.user_owns_supplier(supplier_id)
    )
  )
);
