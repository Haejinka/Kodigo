-- Migration 09: Full Audit Fixes & Strict Tenant Isolation

-- =============================================================================
-- 1. Sales triggers: Deduct stock when a sale is completed
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trg_deduct_stock_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Deduct the purchased quantity from the product's current stock
  UPDATE public.products
  SET 
    current_stock = GREATEST(0, current_stock - NEW.quantity),
    updated_at = now()
  WHERE id = NEW.product_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deduct_stock_on_sale_trigger ON public.sale_items;

CREATE TRIGGER deduct_stock_on_sale_trigger
  AFTER INSERT ON public.sale_items
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_deduct_stock_on_sale();


-- =============================================================================
-- 2. Complete Tenant Isolation: Add store_id to Categories and Suppliers
-- =============================================================================

-- Categories
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores (id) ON DELETE CASCADE;
UPDATE public.categories SET store_id = (SELECT id FROM public.stores LIMIT 1) WHERE store_id IS NULL;
ALTER TABLE public.categories ALTER COLUMN store_id SET NOT NULL;

-- Suppliers
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores (id) ON DELETE CASCADE;
UPDATE public.suppliers SET store_id = (SELECT id FROM public.stores LIMIT 1) WHERE store_id IS NULL;
ALTER TABLE public.suppliers ALTER COLUMN store_id SET NOT NULL;

-- RLS Updates for completely scoped reading/writing

-- Categories Policy
DROP POLICY IF EXISTS "categories: authenticated read" ON public.categories;
DROP POLICY IF EXISTS "categories: admin write" ON public.categories;

CREATE POLICY "categories: scoped read" ON public.categories
FOR SELECT USING (public.user_belongs_to_store(store_id));

CREATE POLICY "categories: scoped write" ON public.categories
FOR ALL USING (
  public.user_belongs_to_store(store_id)
  AND (public.current_user_role() = 'admin')
);

-- Suppliers Policy
DROP POLICY IF EXISTS "suppliers: authenticated read" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers: admin write" ON public.suppliers;

CREATE POLICY "suppliers: scoped read" ON public.suppliers
FOR SELECT USING (public.user_belongs_to_store(store_id));

CREATE POLICY "suppliers: scoped write" ON public.suppliers
FOR ALL USING (
  public.user_belongs_to_store(store_id)
  AND (public.current_user_role() = 'admin')
);


-- =============================================================================
-- 3. Restrict Super Admin Access (Strict Role Enforcement)
-- =============================================================================
-- Overwrite `user_belongs_to_store` to PREVENT super_admin from acting on store data.
-- The super_admin only manages invite_codes, NOT inventory, NOT sales.

CREATE OR REPLACE FUNCTION public.user_belongs_to_store(target_store_id uuid)
RETURNS boolean AS $$
BEGIN
  -- We ONLY check `store_users` for the exact mapping.
  -- super_admin is explicitly REMOVED from seeing all stores to enforce isolation.
  RETURN EXISTS (
    SELECT 1 FROM public.store_users su
    WHERE su.store_id = target_store_id AND su.profile_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Remove super_admin from product scoping write policy
DROP POLICY IF EXISTS "products: scoped write" ON public.products;
CREATE POLICY "products: scoped write" ON public.products
FOR ALL USING (
  public.user_belongs_to_store(store_id)
  AND (public.current_user_role() = 'admin')
);

-- Remove super_admin from sales delete policy
DROP POLICY IF EXISTS "sales: scoped delete" ON public.sales;
CREATE POLICY "sales: scoped delete" ON public.sales
FOR DELETE USING (
  public.user_belongs_to_store(store_id)
  AND (public.current_user_role() = 'admin')
);

-- Remove super_admin from PO scoping write policy
DROP POLICY IF EXISTS "po: scoped write" ON public.purchase_orders;
CREATE POLICY "po: scoped write" ON public.purchase_orders
FOR ALL USING (
  public.user_belongs_to_store(store_id)
  AND (public.current_user_role() = 'admin')
);

-- Remove super_admin from Alerts scoping write policy
DROP POLICY IF EXISTS "stock_alerts: scoped write" ON public.stock_alerts;
CREATE POLICY "stock_alerts: scoped write" ON public.stock_alerts
FOR ALL USING (
  public.user_belongs_to_store(store_id)
  AND (public.current_user_role() = 'admin')
);

-- =============================================================================
-- END OF MIGRATION 09
-- =============================================================================
