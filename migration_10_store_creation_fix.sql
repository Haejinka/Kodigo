-- Migration 10: Store Creation Fixes

-- 1. Create a SECURITY DEFINER function to handle store creation atomically
-- This avoids the chicken-and-egg problem with RLS where a user cannot select
-- a newly inserted store until the store_users mapping exists.
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
BEGIN
    -- Only allow admin or super_admin to create stores
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    ) THEN
        RAISE EXCEPTION 'Only admins can create stores';
    END IF;

    -- Insert the new store
    INSERT INTO public.stores (name, address, tax_rate)
    VALUES (p_name, p_address, p_tax_rate)
    RETURNING * INTO new_store;

    -- Map the current user to the new store automatically
    INSERT INTO public.store_users (store_id, profile_id)
    VALUES (new_store.id, auth.uid());

    RETURN new_store;
END;
$$;

-- 2. Add full policies for stores
-- Drop existing select policy just in case we need to recreate
DROP POLICY IF EXISTS "Users view assigned stores" ON public.stores;

CREATE POLICY "Users view assigned stores" ON public.stores
FOR SELECT USING (
    (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')) OR
    (EXISTS (SELECT 1 FROM public.store_users WHERE store_users.store_id = stores.id AND store_users.profile_id = auth.uid()))
);

CREATE POLICY "Admins can update assigned stores" ON public.stores
FOR UPDATE USING (
    (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')) OR
    (EXISTS (SELECT 1 FROM public.store_users su JOIN public.profiles p ON p.id = su.profile_id WHERE su.store_id = stores.id AND su.profile_id = auth.uid() AND p.role = 'admin'))
);

CREATE POLICY "Admins can insert stores" ON public.stores
FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
);

CREATE POLICY "Super admins can delete stores" ON public.stores
FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
);


-- 3. Fix the infinite recursion in store_users policy
DROP POLICY IF EXISTS "Users view assigned store mappings" ON public.store_users;

-- We simplify the policy: super_admin sees all, admins/cashiers see mappings for stores they belong to.
-- Using a security definer helper to avoid self-joins in policies.
CREATE OR REPLACE FUNCTION public.can_view_store_users(target_store_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER stable
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin'
    ) OR EXISTS (
        SELECT 1 FROM public.store_users WHERE store_id = target_store_id AND profile_id = auth.uid()
    );
$$;

CREATE POLICY "Users view scoped mappings" ON public.store_users
FOR SELECT USING (
    public.can_view_store_users(store_id)
);

CREATE POLICY "Admins map users" ON public.store_users
FOR INSERT WITH CHECK (
    public.can_view_store_users(store_id) AND
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
);

CREATE POLICY "Admins unmap users" ON public.store_users
FOR DELETE USING (
    public.can_view_store_users(store_id) AND
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
);
