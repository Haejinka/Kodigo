-- Migration: Add Super Admin role and RLS for Invite Codes

-- ==========================================
-- STEP 1: RUN THIS LINE BY ITSELF FIRST
-- Highlight just this line and click "Run", 
-- or run it, then delete it.
-- ==========================================
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'super_admin';

-- ==========================================
-- STEP 2: RUN THE REST AFTER STEP 1
-- ==========================================

-- Enable Row Level Security on the invite_codes table
ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;

-- Policy: Public can READ invite codes (needed during signup to verify the code)
CREATE POLICY "Public can read invite codes"
ON public.invite_codes
FOR SELECT
USING (true);

-- Policy: ONLY a 'super_admin' can INSERT/UPDATE/DELETE invite codes 
CREATE POLICY "Super admins can manage invite codes"
ON public.invite_codes
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role::text = 'super_admin'
  )
);
