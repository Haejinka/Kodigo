-- Migration 12: Revert super_admin permissions
-- The super_admin role is strictly for creating invite tickets, not for managing store data.

-- 1. Revert user_belongs_to_store to only check store_users
CREATE OR REPLACE FUNCTION public.user_belongs_to_store(target_store_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.store_users su
    WHERE su.store_id = target_store_id AND su.profile_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Revert the Write Policies to allow ONLY 'admin' (not 'super_admin')

-- Categories Policy
DROP POLICY IF EXISTS "categories: scoped write" ON public.categories;
CREATE POLICY "categories: scoped write" ON public.categories
FOR ALL USING (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role() = 'admin'
) WITH CHECK (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role() = 'admin'
);

-- Suppliers Policy
DROP POLICY IF EXISTS "suppliers: scoped write" ON public.suppliers;
CREATE POLICY "suppliers: scoped write" ON public.suppliers
FOR ALL USING (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role() = 'admin'
) WITH CHECK (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role() = 'admin'
);

-- Products Policy
DROP POLICY IF EXISTS "products: scoped write" ON public.products;
CREATE POLICY "products: scoped write" ON public.products
FOR ALL USING (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role() = 'admin'
) WITH CHECK (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role() = 'admin'
);

-- Sales Delete Policy
DROP POLICY IF EXISTS "sales: scoped delete" ON public.sales;
CREATE POLICY "sales: scoped delete" ON public.sales
FOR DELETE USING (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role() = 'admin'
);

-- Purchase Orders Write Policy
DROP POLICY IF EXISTS "po: scoped write" ON public.purchase_orders;
CREATE POLICY "po: scoped write" ON public.purchase_orders
FOR ALL USING (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role() = 'admin'
) WITH CHECK (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role() = 'admin'
);

-- Stock Alerts Write Policy
DROP POLICY IF EXISTS "stock_alerts: scoped write" ON public.stock_alerts;
CREATE POLICY "stock_alerts: scoped write" ON public.stock_alerts
FOR ALL USING (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role() = 'admin'
) WITH CHECK (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role() = 'admin'
);

-- Purchase Order Items Write Policy
DROP POLICY IF EXISTS "poi: scoped write" ON public.purchase_order_items;
CREATE POLICY "poi: scoped write" ON public.purchase_order_items
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.purchase_orders po 
    WHERE po.id = purchase_order_items.purchase_order_id AND public.user_belongs_to_store(po.store_id)
  )
  AND public.current_user_role() = 'admin'
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.purchase_orders po 
    WHERE po.id = purchase_order_items.purchase_order_id AND public.user_belongs_to_store(po.store_id)
  )
  AND public.current_user_role() = 'admin'
);
