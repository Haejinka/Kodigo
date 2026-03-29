-- Migration 17: Add suppliers.updated_at and auto-maintain it
--
-- This migration is idempotent and safe to run multiple times.

-- 1) Add column if missing
ALTER TABLE public.suppliers
ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- 2) Backfill existing rows
UPDATE public.suppliers
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;

-- 3) Enforce default and not-null
ALTER TABLE public.suppliers
ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE public.suppliers
ALTER COLUMN updated_at SET NOT NULL;

-- 4) Trigger function dedicated to suppliers
CREATE OR REPLACE FUNCTION public.set_suppliers_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- 5) Trigger to keep updated_at in sync on UPDATE
DROP TRIGGER IF EXISTS trg_suppliers_updated_at ON public.suppliers;
CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_suppliers_updated_at();
