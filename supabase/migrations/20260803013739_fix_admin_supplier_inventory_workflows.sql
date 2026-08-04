-- Fix supplier creation, inventory adjustment auditing, and invite-code access.

-- A newly inserted supplier has no supplier_stores rows yet. Allow its owner to
-- read it during the short interval before the selected store links are added.
DROP POLICY IF EXISTS "suppliers: scoped read" ON public.suppliers;
CREATE POLICY "suppliers: scoped read" ON public.suppliers
FOR SELECT TO authenticated
USING (
  owner_profile_id = (SELECT auth.uid())
);

-- The same protection function is attached to tables with different stock
-- column names. Branch before accessing OLD/NEW so PostgreSQL never resolves a
-- field that does not exist on the trigger's current row type.
CREATE OR REPLACE FUNCTION private.protect_direct_stock_edits()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'products' THEN
    IF OLD.current_stock IS DISTINCT FROM NEW.current_stock
      AND current_user NOT IN ('postgres', 'service_role') THEN
      RAISE EXCEPTION 'Use adjust_inventory_stock to change product stock';
    END IF;
  ELSIF TG_TABLE_NAME = 'product_selling_options' THEN
    IF OLD.stock_quantity IS DISTINCT FROM NEW.stock_quantity
      AND current_user NOT IN ('postgres', 'service_role') THEN
      RAISE EXCEPTION 'Use adjust_inventory_stock to change selling-option stock';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Keep invite-code reads explicitly scoped to the super admin who generated
-- them. The Edge Function performs inserts with the service-role client only
-- after independently authenticating and authorizing the caller.
DROP POLICY IF EXISTS "Super admins can manage own invite codes" ON public.invite_codes;
CREATE POLICY "Super admins can manage own invite codes"
ON public.invite_codes
FOR ALL TO authenticated
USING (
  public.current_user_role()::text = 'super_admin'
  AND (created_by = (SELECT auth.uid()) OR created_by IS NULL)
)
WITH CHECK (
  public.current_user_role()::text = 'super_admin'
  AND created_by = (SELECT auth.uid())
);
