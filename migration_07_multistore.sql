-- Migration 07: Multi-Store Support & Tenant Isolation

-- 1. Create stores table (replacing store_settings singleton)
CREATE TABLE IF NOT EXISTS public.stores (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text        NOT NULL,
    address       text        NOT NULL DEFAULT '',
    tax_rate      numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Migrating existing default store setting to the new stores table
INSERT INTO public.stores (name, address, tax_rate)
SELECT COALESCE(store_name, 'Main Store'), COALESCE(store_address, ''), COALESCE(tax_rate, 0)
FROM public.store_settings LIMIT 1;
DROP TABLE IF EXISTS public.store_settings;

-- 2. Create store_users to map profiles -> stores
-- An owner/admin can have multiple records here. A cashier should have one.
CREATE TABLE IF NOT EXISTS public.store_users (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id      uuid        NOT NULL REFERENCES public.stores (id) ON DELETE CASCADE,
    profile_id    uuid        NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE(store_id, profile_id)
);

-- Automatically assign existing users to the first store
INSERT INTO public.store_users (store_id, profile_id)
SELECT (SELECT id FROM public.stores LIMIT 1), id
FROM public.profiles;

-- 3. Add store_id to all operational tables
-- Products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores (id) ON DELETE CASCADE;
UPDATE public.products SET store_id = (SELECT id FROM public.stores LIMIT 1) WHERE store_id IS NULL;
ALTER TABLE public.products ALTER COLUMN store_id SET NOT NULL;

-- Sales
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores (id) ON DELETE CASCADE;
UPDATE public.sales SET store_id = (SELECT id FROM public.stores LIMIT 1) WHERE store_id IS NULL;
ALTER TABLE public.sales ALTER COLUMN store_id SET NOT NULL;

-- Stock Adjustments
ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores (id) ON DELETE CASCADE;
UPDATE public.stock_adjustments SET store_id = (SELECT id FROM public.stores LIMIT 1) WHERE store_id IS NULL;
ALTER TABLE public.stock_adjustments ALTER COLUMN store_id SET NOT NULL;

-- Purchase Orders
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores (id) ON DELETE CASCADE;
UPDATE public.purchase_orders SET store_id = (SELECT id FROM public.stores LIMIT 1) WHERE store_id IS NULL;
ALTER TABLE public.purchase_orders ALTER COLUMN store_id SET NOT NULL;

-- Stock Alerts
ALTER TABLE public.stock_alerts ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores (id) ON DELETE CASCADE;
UPDATE public.stock_alerts SET store_id = (SELECT id FROM public.stores LIMIT 1) WHERE store_id IS NULL;
ALTER TABLE public.stock_alerts ALTER COLUMN store_id SET NOT NULL;

-- Note: Categories and Suppliers are left as global for now, assuming suppliers and categories are shared across branches. 
-- Alternatively, they could also have a store_id if they should be strictly isolated per tenant. For a typical business, owners share suppliers across branches.

-- 4. Set RLS on stores and store_users
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_users ENABLE ROW LEVEL SECURITY;

-- Allow users to see the stores they are assigned to, or all if super_admin
CREATE POLICY "Users view assigned stores" ON public.stores
FOR SELECT USING (
    (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')) OR
    (EXISTS (SELECT 1 FROM public.store_users WHERE store_users.store_id = stores.id AND store_users.profile_id = auth.uid()))
);

CREATE POLICY "Users view assigned store mappings" ON public.store_users
FOR SELECT USING (
    (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')) OR
    (profile_id = auth.uid()) OR
    (EXISTS (SELECT 1 FROM public.store_users su2 JOIN public.profiles p ON p.id = su2.profile_id WHERE su2.store_id = store_users.store_id AND su2.profile_id = auth.uid() AND (p.role = 'admin' OR p.role = 'super_admin')))
);

-- Note: Frontend will need extensive updates to pass store_id on all inserts and to filter by store_id on updates/deletes!
