-- Migration 28: restrict member-directory visibility to store admins.
-- Passwords remain exclusively in Supabase Auth and are never stored in public tables.

DROP POLICY IF EXISTS "profiles: scoped read" ON public.profiles;
CREATE POLICY "profiles: scoped read" ON public.profiles
FOR SELECT TO authenticated
USING (
  id = (SELECT auth.uid())
  OR (
    public.current_user_role()::text = 'admin'
    AND EXISTS (
      SELECT 1
      FROM public.store_users target_mapping
      JOIN public.store_users actor_mapping
        ON actor_mapping.store_id = target_mapping.store_id
      WHERE target_mapping.profile_id = profiles.id
        AND actor_mapping.profile_id = (SELECT auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "Users view scoped mappings" ON public.store_users;
CREATE POLICY "Users view scoped mappings" ON public.store_users
FOR SELECT TO authenticated
USING (
  profile_id = (SELECT auth.uid())
  OR (
    public.current_user_role()::text = 'admin'
    AND public.can_view_store_users(store_id)
  )
);

-- Store admins may edit only members who share one of their assigned stores.
DROP POLICY IF EXISTS "profiles: admin update" ON public.profiles;
CREATE POLICY "profiles: admin update" ON public.profiles
FOR UPDATE TO authenticated
USING (
  public.current_user_role()::text = 'admin'
  AND EXISTS (
    SELECT 1
    FROM public.store_users target_mapping
    JOIN public.store_users actor_mapping
      ON actor_mapping.store_id = target_mapping.store_id
    WHERE target_mapping.profile_id = profiles.id
      AND actor_mapping.profile_id = (SELECT auth.uid())
  )
)
WITH CHECK (
  public.current_user_role()::text = 'admin'
  AND role::text IN ('admin', 'cashier', 'inventory')
);
