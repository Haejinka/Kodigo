-- Enforce opt-in MFA at the database authorization boundary. Accounts without
-- a verified factor may use AAL1 or AAL2; enrolled accounts must present AAL2.

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.mfa_session_is_valid()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (SELECT auth.uid()) IS NOT NULL
    AND (
      COALESCE((SELECT auth.jwt()->>'aal'), 'aal1') = 'aal2'
      OR NOT EXISTS (
        SELECT 1
        FROM auth.mfa_factors factor
        WHERE factor.user_id = (SELECT auth.uid())
          AND factor.status = 'verified'
      )
    );
$$;

REVOKE ALL ON FUNCTION private.mfa_session_is_valid() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.mfa_session_is_valid() TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT profile.role
  FROM public.profiles profile
  WHERE profile.id = (SELECT auth.uid())
    AND private.mfa_session_is_valid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.mfa_session_is_valid()
    AND EXISTS (
      SELECT 1
      FROM public.profiles profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.role::text IN ('admin', 'super_admin')
    );
$$;

CREATE OR REPLACE FUNCTION public.user_belongs_to_store(target_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.mfa_session_is_valid()
    AND EXISTS (
      SELECT 1
      FROM public.store_users store_user
      WHERE store_user.store_id = target_store_id
        AND store_user.profile_id = (SELECT auth.uid())
    );
$$;

CREATE OR REPLACE FUNCTION public.can_view_store_users(target_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.mfa_session_is_valid()
    AND EXISTS (
      SELECT 1
      FROM public.store_users store_user
      WHERE store_user.store_id = target_store_id
        AND store_user.profile_id = (SELECT auth.uid())
    );
$$;
