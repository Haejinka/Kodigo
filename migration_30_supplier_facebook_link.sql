-- Migration 30: Add optional Facebook link for suppliers.

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS facebook_link text;
