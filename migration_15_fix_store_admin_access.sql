-- Migration 15: Fix Admin Store Access
-- Explicitly addresses the issue where an admin/owner cannot add or edit stores.
-- Provides robust policies taking into account the 'admin' role directly.

-- 1. Fix Stores table policies for admin

-- Drop any conflicting policies
DROP POLICY IF EXISTS "Admins can update assigned stores" ON public.stores;
DROP POLICY IF EXISTS "Admins can insert stores" ON public.stores;
DROP POLICY IF EXISTS "Users view assigned stores" ON public.stores;

-- Admin can view stores they are assigned to
CREATE POLICY "Users view assigned stores" ON public.stores
FOR SELECT USING (
    (public.current_user_role() = 'super_admin') OR
    public.user_belongs_to_store(id)
);

-- Admin can insert a new store (this allows the direct insert if bypassrls fails)
CREATE POLICY "Admins can insert stores" ON public.stores
FOR INSERT WITH CHECK (
    public.current_user_role() = 'admin'
);

-- Admin can update a store they belong to
CREATE POLICY "Admins can update assigned stores" ON public.stores
FOR UPDATE USING (
    public.user_belongs_to_store(id) AND public.current_user_role() = 'admin'
) WITH CHECK (
    public.user_belongs_to_store(id) AND public.current_user_role() = 'admin'
);

-- Admin can delete a store they belong to
DROP POLICY IF EXISTS "Admins can delete assigned stores" ON public.stores;
CREATE POLICY "Admins can delete assigned stores" ON public.stores
FOR DELETE USING (
    public.user_belongs_to_store(id) AND public.current_user_role() = 'admin'
);

-- 2. Ensure store_users allows admins to map users, including themselves for new stores
DROP POLICY IF EXISTS "Admins map users" ON public.store_users;

-- Admin can insert into store_users if they are an admin.
-- The previous policy required can_view_store_users(store_id), which failed for brand new stores 
-- because the admin wasn't mapped yet!
CREATE POLICY "Admins map users" ON public.store_users
FOR INSERT WITH CHECK (
    public.current_user_role() = 'admin' AND
    -- Only allow them to map themselves OR if they already belong to the store
    (profile_id = auth.uid() OR public.user_belongs_to_store(store_id))
);

-- Ensure the function create_store_with_owner accurately works and doesn't get blocked
CREATE OR REPLACE FUNCTION public.create_store_with_owner(
    p_name text,
    p_address text,
    p_tax_rate numeric
)
RETURNS public.stores
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    new_store public.stores;
    v_role public.user_role;
BEGIN
    -- Look up the exact role of the acting user
    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    
    -- Restrict explicitly to admins (super_admins only manage invites)
    IF v_role IS NULL OR v_role != 'admin' THEN
        RAISE EXCEPTION 'Only admins can create stores';
    END IF;

    -- Insert the new store
    INSERT INTO public.stores (name, address, tax_rate)
    VALUES (p_name, p_address, p_tax_rate)
    RETURNING * INTO new_store;

    -- Map the current admin to the new store automatically
    INSERT INTO public.store_users (store_id, profile_id)
    VALUES (new_store.id, auth.uid());

    RETURN new_store;
END;
$$;
