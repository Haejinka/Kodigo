-- Migration: Add created_by to invite_codes and scope super_admin correctly
-- Run this in your Supabase SQL Editor

-- 1. Add created_by column to invite_codes
ALTER TABLE public.invite_codes
ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Drop the overly permissive super_admin policy
DROP POLICY IF EXISTS "Super admins can manage invite codes" ON public.invite_codes;

-- 3. Replace it with a scoped policy so super_admins only see what they generated
CREATE POLICY "Super admins can manage own invite codes"
ON public.invite_codes
FOR ALL
USING (
  public.current_user_role() = 'super_admin'
  AND (created_by = auth.uid() OR created_by IS NULL)
)
WITH CHECK (
  public.current_user_role() = 'super_admin'
  AND (created_by = auth.uid())
);
