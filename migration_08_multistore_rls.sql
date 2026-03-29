-- Migration 08: Multi-Store RLS Policies

-- Helper function to check if a user belongs to a store
CREATE OR REPLACE FUNCTION public.user_belongs_to_store(target_store_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.store_users su
    WHERE su.store_id = target_store_id AND su.profile_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'super_admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- PRODUCTS
DROP POLICY IF EXISTS "products: authenticated read" ON public.products;
DROP POLICY IF EXISTS "products: admin write" ON public.products;

CREATE POLICY "products: scoped read" ON public.products
FOR SELECT USING (public.user_belongs_to_store(store_id));

CREATE POLICY "products: scoped write" ON public.products
FOR ALL USING (
  public.user_belongs_to_store(store_id)
  AND (public.current_user_role() IN ('admin', 'super_admin'))
);


-- SALES
DROP POLICY IF EXISTS "sales: authenticated read" ON public.sales;
DROP POLICY IF EXISTS "sales: authenticated insert" ON public.sales;
DROP POLICY IF EXISTS "sales: admin delete" ON public.sales;

CREATE POLICY "sales: scoped read" ON public.sales
FOR SELECT USING (public.user_belongs_to_store(store_id));

CREATE POLICY "sales: scoped insert" ON public.sales
FOR INSERT WITH CHECK (public.user_belongs_to_store(store_id));

CREATE POLICY "sales: scoped delete" ON public.sales
FOR DELETE USING (
  public.user_belongs_to_store(store_id)
  AND (public.current_user_role() IN ('admin', 'super_admin'))
);


-- STOCK ADJUSTMENTS
DROP POLICY IF EXISTS "stock_adj: authenticated read" ON public.stock_adjustments;
DROP POLICY IF EXISTS "stock_adj: authenticated insert" ON public.stock_adjustments;

CREATE POLICY "stock_adj: scoped read" ON public.stock_adjustments
FOR SELECT USING (public.user_belongs_to_store(store_id));

CREATE POLICY "stock_adj: scoped insert" ON public.stock_adjustments
FOR INSERT WITH CHECK (public.user_belongs_to_store(store_id));


-- PURCHASE ORDERS
DROP POLICY IF EXISTS "po: authenticated read" ON public.purchase_orders;
DROP POLICY IF EXISTS "po: admin write" ON public.purchase_orders;

CREATE POLICY "po: scoped read" ON public.purchase_orders
FOR SELECT USING (public.user_belongs_to_store(store_id));

CREATE POLICY "po: scoped write" ON public.purchase_orders
FOR ALL USING (
  public.user_belongs_to_store(store_id)
  AND (public.current_user_role() IN ('admin', 'super_admin'))
);


-- STOCK ALERTS
DROP POLICY IF EXISTS "stock_alerts: authenticated read" ON public.stock_alerts;
DROP POLICY IF EXISTS "stock_alerts: authenticated update" ON public.stock_alerts;
DROP POLICY IF EXISTS "stock_alerts: admin insert/delete" ON public.stock_alerts;

CREATE POLICY "stock_alerts: scoped read" ON public.stock_alerts
FOR SELECT USING (public.user_belongs_to_store(store_id));

CREATE POLICY "stock_alerts: scoped update" ON public.stock_alerts
FOR UPDATE USING (public.user_belongs_to_store(store_id));

CREATE POLICY "stock_alerts: scoped write" ON public.stock_alerts
FOR ALL USING (
  public.user_belongs_to_store(store_id)
  AND (public.current_user_role() IN ('admin', 'super_admin'))
);

-- NOTE: sale_items and purchase_order_items do not have store_id, 
-- but they generally cascade delete or rely on their parent. Let's make sure 
-- read access implies checking the parent.
