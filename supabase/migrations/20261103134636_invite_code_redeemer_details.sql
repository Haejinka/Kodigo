-- Expose only redemption details for codes visible to the calling super admin.
-- Keep privileged access to Auth email addresses outside the exposed schema.
CREATE OR REPLACE FUNCTION private.list_invite_codes_with_redeemers()
RETURNS TABLE (
  id uuid, code text, created_at timestamptz, is_used boolean,
  used_by uuid, used_at timestamptz, redeemer_name text, redeemer_email text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_actor AND p.role::text = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Only super admins can view invite code redemptions'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT i.id, i.code, i.created_at, i.is_used, i.used_by, i.used_at,
         nullif(btrim(p.name), ''), u.email::text
  FROM public.invite_codes i
  LEFT JOIN public.profiles p ON p.id = i.used_by AND i.is_used
  LEFT JOIN auth.users u ON u.id = i.used_by AND i.is_used
  -- Preserve existing visibility for legacy codes without a recorded creator.
  WHERE i.created_by = v_actor OR i.created_by IS NULL
  ORDER BY i.created_at DESC, i.id;
END;
$$;

REVOKE ALL ON FUNCTION private.list_invite_codes_with_redeemers() FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.list_invite_codes_with_redeemers() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_invite_codes_with_redeemers()
RETURNS TABLE (
  id uuid, code text, created_at timestamptz, is_used boolean,
  used_by uuid, used_at timestamptz, redeemer_name text, redeemer_email text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT * FROM private.list_invite_codes_with_redeemers();
$$;

REVOKE ALL ON FUNCTION public.list_invite_codes_with_redeemers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_invite_codes_with_redeemers() TO authenticated;
