-- Migration 14: Fix Store Update RLS

-- Fix the stores table update policy to use public.user_belongs_to_store
-- and public.current_user_role() which properly handles both USING and WITH CHECK
-- conditions for row level security.

DROP POLICY IF EXISTS "Admins can update assigned stores" ON public.stores;

CREATE POLICY "Admins can update assigned stores" ON public.stores
FOR UPDATE USING (
    public.user_belongs_to_store(id) AND public.current_user_role() = 'admin'
) WITH CHECK (
    public.user_belongs_to_store(id) AND public.current_user_role() = 'admin'
);

-- Fix store insertion policy to avoid role casting issues
DROP POLICY IF EXISTS "Admins can insert stores" ON public.stores;

CREATE POLICY "Admins can insert stores" ON public.stores
FOR INSERT WITH CHECK (
    public.current_user_role() = 'admin'
);

