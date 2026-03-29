-- Migration 16: Final Admin-Only Store CRUD and Cascade-Safe Policies
--
-- Goal:
-- 1) Store create/update/delete must work for admin users.
-- 2) super_admin must not manage stores.
-- 3) Cascading deletes from stores must not fail due to RLS order-of-deletion issues.

-- 1) Reset store policies to admin-only (no super_admin involvement)
DROP POLICY IF EXISTS "Users view assigned stores" ON public.stores;
DROP POLICY IF EXISTS "Admins can insert stores" ON public.stores;
DROP POLICY IF EXISTS "Admins can update assigned stores" ON public.stores;
DROP POLICY IF EXISTS "Admins can delete assigned stores" ON public.stores;
DROP POLICY IF EXISTS "Super admins can delete stores" ON public.stores;

CREATE POLICY "Users view assigned stores" ON public.stores
FOR SELECT USING (
    public.user_belongs_to_store(id)
);

CREATE POLICY "Admins can insert stores" ON public.stores
FOR INSERT WITH CHECK (
    public.current_user_role()::text = 'admin'
);

CREATE POLICY "Admins can update assigned stores" ON public.stores
FOR UPDATE USING (
    public.user_belongs_to_store(id)
    AND public.current_user_role()::text = 'admin'
) WITH CHECK (
    public.user_belongs_to_store(id)
    AND public.current_user_role()::text = 'admin'
);

CREATE POLICY "Admins can delete assigned stores" ON public.stores
FOR DELETE USING (
    public.user_belongs_to_store(id)
    AND public.current_user_role()::text = 'admin'
);

-- 2) Reset store_users policies and helper without super_admin shortcuts
DROP POLICY IF EXISTS "Users view assigned store mappings" ON public.store_users;
DROP POLICY IF EXISTS "Users view scoped mappings" ON public.store_users;
DROP POLICY IF EXISTS "Admins map users" ON public.store_users;
DROP POLICY IF EXISTS "Admins unmap users" ON public.store_users;

CREATE OR REPLACE FUNCTION public.can_view_store_users(target_store_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.store_users su
        WHERE su.store_id = target_store_id
          AND su.profile_id = auth.uid()
    );
$$;

CREATE POLICY "Users view scoped mappings" ON public.store_users
FOR SELECT USING (
    public.can_view_store_users(store_id)
);

CREATE POLICY "Admins map users" ON public.store_users
FOR INSERT WITH CHECK (
    public.current_user_role()::text = 'admin'
    AND (
        profile_id = auth.uid()
        OR public.user_belongs_to_store(store_id)
    )
);

CREATE POLICY "Admins unmap users" ON public.store_users
FOR DELETE USING (
    public.current_user_role()::text = 'admin'
);

-- 2.5) Fully reset supplier CRUD policies for admin-only store scope.
DROP POLICY IF EXISTS "suppliers: authenticated read" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers: admin write" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers: scoped read" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers: scoped write" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers: scoped insert" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers: scoped update" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers: scoped delete" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers: admin delete cascade-safe" ON public.suppliers;

CREATE POLICY "suppliers: scoped read" ON public.suppliers
FOR SELECT USING (
    public.user_belongs_to_store(store_id)
);

CREATE POLICY "suppliers: scoped insert" ON public.suppliers
FOR INSERT WITH CHECK (
    public.user_belongs_to_store(store_id)
    AND public.current_user_role()::text = 'admin'
);

CREATE POLICY "suppliers: scoped update" ON public.suppliers
FOR UPDATE USING (
    public.user_belongs_to_store(store_id)
    AND public.current_user_role()::text = 'admin'
) WITH CHECK (
    public.user_belongs_to_store(store_id)
    AND public.current_user_role()::text = 'admin'
);

CREATE POLICY "suppliers: scoped delete" ON public.suppliers
FOR DELETE USING (
    public.current_user_role()::text = 'admin'
    AND (
        pg_trigger_depth() > 0
        OR public.user_belongs_to_store(store_id)
    )
);

-- 2.6) Fully reset product CRUD policies for admin-only store scope.
DROP POLICY IF EXISTS "products: authenticated read" ON public.products;
DROP POLICY IF EXISTS "products: admin write" ON public.products;
DROP POLICY IF EXISTS "products: scoped read" ON public.products;
DROP POLICY IF EXISTS "products: scoped write" ON public.products;
DROP POLICY IF EXISTS "products: scoped insert" ON public.products;
DROP POLICY IF EXISTS "products: scoped update" ON public.products;
DROP POLICY IF EXISTS "products: scoped delete" ON public.products;
DROP POLICY IF EXISTS "products: admin delete cascade-safe" ON public.products;

CREATE POLICY "products: scoped read" ON public.products
FOR SELECT USING (
    public.user_belongs_to_store(store_id)
);

CREATE POLICY "products: scoped insert" ON public.products
FOR INSERT WITH CHECK (
    public.user_belongs_to_store(store_id)
    AND public.current_user_role()::text = 'admin'
);

CREATE POLICY "products: scoped update" ON public.products
FOR UPDATE USING (
    public.user_belongs_to_store(store_id)
    AND public.current_user_role()::text = 'admin'
) WITH CHECK (
    public.user_belongs_to_store(store_id)
    AND public.current_user_role()::text = 'admin'
);

CREATE POLICY "products: scoped delete" ON public.products
FOR DELETE USING (
    public.current_user_role()::text = 'admin'
    AND (
        pg_trigger_depth() > 0
        OR public.user_belongs_to_store(store_id)
    )
);

-- 3) Add cascade-safe DELETE policies for store-related tables.
-- pg_trigger_depth() > 0 means the delete is being executed from a trigger context
-- such as FK ON DELETE CASCADE. This avoids intermittent failures when store_users
-- rows are deleted before other children that still evaluate membership checks.

DROP POLICY IF EXISTS "categories: admin delete cascade-safe" ON public.categories;
CREATE POLICY "categories: admin delete cascade-safe" ON public.categories
FOR DELETE USING (
    public.current_user_role()::text = 'admin'
    AND (
        pg_trigger_depth() > 0
        OR public.user_belongs_to_store(store_id)
    )
);

DROP POLICY IF EXISTS "suppliers: admin delete cascade-safe" ON public.suppliers;

DROP POLICY IF EXISTS "products: admin delete cascade-safe" ON public.products;

DROP POLICY IF EXISTS "sales: admin delete cascade-safe" ON public.sales;
CREATE POLICY "sales: admin delete cascade-safe" ON public.sales
FOR DELETE USING (
    public.current_user_role()::text = 'admin'
    AND (
        pg_trigger_depth() > 0
        OR public.user_belongs_to_store(store_id)
    )
);

DROP POLICY IF EXISTS "stock_adj: admin delete" ON public.stock_adjustments;
CREATE POLICY "stock_adj: admin delete" ON public.stock_adjustments
FOR DELETE USING (
    public.current_user_role()::text = 'admin'
    AND (
        pg_trigger_depth() > 0
        OR public.user_belongs_to_store(store_id)
    )
);

DROP POLICY IF EXISTS "po: admin delete cascade-safe" ON public.purchase_orders;
CREATE POLICY "po: admin delete cascade-safe" ON public.purchase_orders
FOR DELETE USING (
    public.current_user_role()::text = 'admin'
    AND (
        pg_trigger_depth() > 0
        OR public.user_belongs_to_store(store_id)
    )
);

DROP POLICY IF EXISTS "stock_alerts: admin delete cascade-safe" ON public.stock_alerts;
CREATE POLICY "stock_alerts: admin delete cascade-safe" ON public.stock_alerts
FOR DELETE USING (
    public.current_user_role()::text = 'admin'
    AND (
        pg_trigger_depth() > 0
        OR public.user_belongs_to_store(store_id)
    )
);

DROP POLICY IF EXISTS "sale_items: admin delete" ON public.sale_items;
CREATE POLICY "sale_items: admin delete" ON public.sale_items
FOR DELETE USING (
    public.current_user_role()::text = 'admin'
    AND (
        pg_trigger_depth() > 0
        OR EXISTS (
            SELECT 1
            FROM public.sales s
            WHERE s.id = sale_items.sale_id
              AND public.user_belongs_to_store(s.store_id)
        )
    )
);

DROP POLICY IF EXISTS "poi: admin delete cascade-safe" ON public.purchase_order_items;
CREATE POLICY "poi: admin delete cascade-safe" ON public.purchase_order_items
FOR DELETE USING (
    public.current_user_role()::text = 'admin'
    AND (
        pg_trigger_depth() > 0
        OR EXISTS (
            SELECT 1
            FROM public.purchase_orders po
            WHERE po.id = purchase_order_items.purchase_order_id
              AND public.user_belongs_to_store(po.store_id)
        )
    )
);

-- 4) Fortify RPC store creation function for admin-only flow
CREATE OR REPLACE FUNCTION public.create_store_with_owner(
    p_name text,
    p_address text,
    p_tax_rate numeric
)
RETURNS public.stores
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_store public.stores;
    v_role text;
BEGIN
    SELECT role::text
    INTO v_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_role IS NULL OR v_role <> 'admin' THEN
        RAISE EXCEPTION 'Only admins can create stores (Detected profile role: %)', COALESCE(v_role, 'none');
    END IF;

    INSERT INTO public.stores (name, address, tax_rate)
    VALUES (p_name, p_address, p_tax_rate)
    RETURNING * INTO new_store;

    INSERT INTO public.store_users (store_id, profile_id)
    VALUES (new_store.id, auth.uid());

    RETURN new_store;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_store_with_owner(text, text, numeric) TO authenticated;
