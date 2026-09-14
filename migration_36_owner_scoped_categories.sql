-- Migration 36: share product categories across stores owned by the same owner.
-- Existing stores are assigned to their first mapped admin.

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT;

UPDATE public.stores s
SET owner_id = (
  SELECT su.profile_id
  FROM public.store_users su
  JOIN public.profiles p ON p.id = su.profile_id
  WHERE su.store_id = s.id
  ORDER BY (p.role::text = 'admin') DESC, su.created_at, su.profile_id
  LIMIT 1
)
WHERE s.owner_id IS NULL;

ALTER TABLE public.stores ALTER COLUMN owner_id SET NOT NULL;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT;

UPDATE public.categories c
SET owner_id = s.owner_id
FROM public.stores s
WHERE s.id = c.store_id
  AND c.owner_id IS NULL;

ALTER TABLE public.categories ALTER COLUMN owner_id SET NOT NULL;

ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_name_key;
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_store_id_name_key;

-- Preserve product references when old data contains duplicate names within one owner.
WITH ranked AS (
  SELECT id,
         FIRST_VALUE(id) OVER (PARTITION BY owner_id, lower(trim(name)) ORDER BY created_at, id) AS keep_id,
         ROW_NUMBER() OVER (PARTITION BY owner_id, lower(trim(name)) ORDER BY created_at, id) AS row_num
  FROM public.categories
)
UPDATE public.products p
SET category_id = r.keep_id
FROM ranked r
WHERE p.category_id = r.id AND r.row_num > 1;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY owner_id, lower(trim(name)) ORDER BY created_at, id) AS row_num
  FROM public.categories
)
DELETE FROM public.categories c
USING ranked r
WHERE c.id = r.id AND r.row_num > 1;

CREATE UNIQUE INDEX IF NOT EXISTS categories_owner_name_key
  ON public.categories (owner_id, lower(trim(name)));

CREATE OR REPLACE FUNCTION public.user_belongs_to_category_owner(target_owner_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.store_users su
    JOIN public.stores s ON s.id = su.store_id
    WHERE su.profile_id = auth.uid() AND s.owner_id = target_owner_id
  );
$$;

REVOKE ALL ON FUNCTION public.user_belongs_to_category_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_belongs_to_category_owner(uuid) TO authenticated;

DROP POLICY IF EXISTS "categories: scoped read" ON public.categories;
DROP POLICY IF EXISTS "categories: scoped write" ON public.categories;
DROP POLICY IF EXISTS "categories: scoped insert" ON public.categories;
DROP POLICY IF EXISTS "categories: scoped update" ON public.categories;
DROP POLICY IF EXISTS "categories: scoped delete" ON public.categories;
DROP POLICY IF EXISTS "categories: admin delete cascade-safe" ON public.categories;

CREATE POLICY "categories: owner scoped read" ON public.categories
FOR SELECT TO authenticated
USING (public.user_belongs_to_category_owner(owner_id));

CREATE POLICY "categories: owner scoped insert" ON public.categories
FOR INSERT TO authenticated
WITH CHECK (
  public.user_belongs_to_category_owner(owner_id)
  AND public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text IN ('admin', 'inventory')
);

CREATE POLICY "categories: owner scoped update" ON public.categories
FOR UPDATE TO authenticated
USING (public.user_belongs_to_category_owner(owner_id) AND public.current_user_role()::text IN ('admin', 'inventory'))
WITH CHECK (public.user_belongs_to_category_owner(owner_id) AND public.current_user_role()::text IN ('admin', 'inventory'));

CREATE POLICY "categories: owner scoped delete" ON public.categories
FOR DELETE TO authenticated
USING (public.user_belongs_to_category_owner(owner_id) AND public.current_user_role()::text = 'admin');

CREATE OR REPLACE FUNCTION public.create_store_with_owner(p_name text, p_address text, p_tax_rate numeric)
RETURNS public.stores LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE new_store public.stores; v_role text;
BEGIN
  SELECT role::text INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role <> 'admin' THEN RAISE EXCEPTION 'Only admins can create stores'; END IF;
  INSERT INTO public.stores (name, address, tax_rate, owner_id)
  VALUES (p_name, p_address, p_tax_rate, auth.uid()) RETURNING * INTO new_store;
  INSERT INTO public.store_users (store_id, profile_id) VALUES (new_store.id, auth.uid());
  RETURN new_store;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_store_with_owner(text, text, numeric) TO authenticated;
