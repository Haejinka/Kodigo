-- Migration 27: inventory-only RBAC, white-label branding, and immutable BIR-ready receipts.
-- This migration is additive and preserves existing stores, sales, and receipt numbers.

-- 1. Inventory-only user role.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'inventory';

-- Keep profile authorization server controlled while allowing store admins to assign inventory users.
DROP POLICY IF EXISTS "profiles: scoped read" ON public.profiles;
CREATE POLICY "profiles: scoped read" ON public.profiles
FOR SELECT TO authenticated
USING (
  id = (SELECT auth.uid())
  OR public.current_user_role()::text = 'super_admin'
  OR (
    public.current_user_role()::text IN ('admin', 'cashier')
    AND EXISTS (
      SELECT 1
      FROM public.store_users target_mapping
      JOIN public.store_users actor_mapping
        ON actor_mapping.store_id = target_mapping.store_id
      WHERE target_mapping.profile_id = profiles.id
        AND actor_mapping.profile_id = (SELECT auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "profiles: admin update" ON public.profiles;
CREATE POLICY "profiles: admin update" ON public.profiles
FOR UPDATE TO authenticated
USING (
  public.current_user_role()::text = 'admin'
  AND EXISTS (
    SELECT 1
    FROM public.store_users target_mapping
    JOIN public.store_users actor_mapping
      ON actor_mapping.store_id = target_mapping.store_id
    WHERE target_mapping.profile_id = profiles.id
      AND actor_mapping.profile_id = (SELECT auth.uid())
  )
)
WITH CHECK (
  public.current_user_role()::text = 'admin'
  AND role::text IN ('admin', 'cashier', 'inventory')
);

DROP POLICY IF EXISTS "Users view scoped mappings" ON public.store_users;
CREATE POLICY "Users view scoped mappings" ON public.store_users
FOR SELECT TO authenticated
USING (
  profile_id = (SELECT auth.uid())
  OR (
    public.current_user_role()::text IN ('admin', 'cashier', 'super_admin')
    AND public.can_view_store_users(store_id)
  )
);

-- Product and selling-option writes are available to admins and inventory users only.
DROP POLICY IF EXISTS "products: scoped insert" ON public.products;
CREATE POLICY "products: scoped insert" ON public.products
FOR INSERT TO authenticated
WITH CHECK (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text IN ('admin', 'inventory')
);

DROP POLICY IF EXISTS "products: scoped update" ON public.products;
CREATE POLICY "products: scoped update" ON public.products
FOR UPDATE TO authenticated
USING (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text IN ('admin', 'inventory')
)
WITH CHECK (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text IN ('admin', 'inventory')
);

DROP POLICY IF EXISTS "products: scoped delete" ON public.products;
CREATE POLICY "products: scoped delete" ON public.products
FOR DELETE TO authenticated
USING (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text = 'admin'
);

DROP POLICY IF EXISTS "categories: scoped insert" ON public.categories;
CREATE POLICY "categories: scoped insert" ON public.categories
FOR INSERT TO authenticated
WITH CHECK (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text IN ('admin', 'inventory')
);

DROP POLICY IF EXISTS "categories: scoped update" ON public.categories;
CREATE POLICY "categories: scoped update" ON public.categories
FOR UPDATE TO authenticated
USING (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text IN ('admin', 'inventory')
)
WITH CHECK (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text IN ('admin', 'inventory')
);

DROP POLICY IF EXISTS "categories: scoped delete" ON public.categories;
DROP POLICY IF EXISTS "categories: admin delete cascade-safe" ON public.categories;
CREATE POLICY "categories: scoped delete" ON public.categories
FOR DELETE TO authenticated
USING (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text = 'admin'
);

DROP POLICY IF EXISTS "product_selling_options: scoped write" ON public.product_selling_options;
DROP POLICY IF EXISTS "product_selling_options: scoped insert" ON public.product_selling_options;
CREATE POLICY "product_selling_options: scoped insert" ON public.product_selling_options
FOR INSERT TO authenticated
WITH CHECK (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text IN ('admin', 'inventory')
);

DROP POLICY IF EXISTS "product_selling_options: scoped update" ON public.product_selling_options;
CREATE POLICY "product_selling_options: scoped update" ON public.product_selling_options
FOR UPDATE TO authenticated
USING (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text IN ('admin', 'inventory')
)
WITH CHECK (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text IN ('admin', 'inventory')
);

DROP POLICY IF EXISTS "product_selling_options: scoped delete" ON public.product_selling_options;
CREATE POLICY "product_selling_options: scoped delete" ON public.product_selling_options
FOR DELETE TO authenticated
USING (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text = 'admin'
);

-- Inventory history is store-scoped. Manual adjustments may be recorded by inventory users.
DROP POLICY IF EXISTS "stock_adj: authenticated read" ON public.stock_adjustments;
DROP POLICY IF EXISTS "stock_adj: scoped read" ON public.stock_adjustments;
CREATE POLICY "stock_adj: scoped read" ON public.stock_adjustments
FOR SELECT TO authenticated
USING (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text IN ('admin', 'inventory')
);

DROP POLICY IF EXISTS "stock_adj: authenticated insert" ON public.stock_adjustments;
DROP POLICY IF EXISTS "stock_adj: scoped insert" ON public.stock_adjustments;
-- Adjustments are inserted only by the atomic adjust_inventory_stock RPC below.

DROP POLICY IF EXISTS "inventory_movements: scoped read" ON public.inventory_movements;
CREATE POLICY "inventory_movements: scoped read" ON public.inventory_movements
FOR SELECT TO authenticated
USING (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text IN ('admin', 'inventory')
);

-- Inventory users must not be able to read or mutate sales/financial artifacts by direct API calls.
DROP POLICY IF EXISTS "sales: scoped read" ON public.sales;
CREATE POLICY "sales: scoped read" ON public.sales
FOR SELECT TO authenticated
USING (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text IN ('admin', 'cashier')
);

DROP POLICY IF EXISTS "sales: scoped delete" ON public.sales;

DROP POLICY IF EXISTS "sale_items: scoped read" ON public.sale_items;
CREATE POLICY "sale_items: scoped read" ON public.sale_items
FOR SELECT TO authenticated
USING (
  public.current_user_role()::text IN ('admin', 'cashier')
  AND EXISTS (
    SELECT 1
    FROM public.sales s
    WHERE s.id = sale_items.sale_id
      AND public.user_belongs_to_store(s.store_id)
  )
);

DROP POLICY IF EXISTS "sale_payments: scoped read" ON public.sale_payments;
CREATE POLICY "sale_payments: scoped read" ON public.sale_payments
FOR SELECT TO authenticated
USING (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text IN ('admin', 'cashier')
);

DROP POLICY IF EXISTS "receipts: scoped read" ON public.receipts;
CREATE POLICY "receipts: scoped read" ON public.receipts
FOR SELECT TO authenticated
USING (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text IN ('admin', 'cashier')
);

DROP POLICY IF EXISTS "sale_events: scoped read" ON public.sale_events;
CREATE POLICY "sale_events: scoped read" ON public.sale_events
FOR SELECT TO authenticated
USING (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text IN ('admin', 'cashier')
);

DROP POLICY IF EXISTS "sale_returns: scoped read" ON public.sale_returns;
CREATE POLICY "sale_returns: scoped read" ON public.sale_returns
FOR SELECT TO authenticated
USING (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text IN ('admin', 'cashier')
);

DROP POLICY IF EXISTS "po: authenticated read" ON public.purchase_orders;
DROP POLICY IF EXISTS "po: scoped read" ON public.purchase_orders;
CREATE POLICY "po: scoped read" ON public.purchase_orders
FOR SELECT TO authenticated
USING (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text = 'admin'
);

-- 2. Store branding and Philippine business/tax configuration.
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS registered_name text,
  ADD COLUMN IF NOT EXISTS business_name text,
  ADD COLUMN IF NOT EXISTS tin text,
  ADD COLUMN IF NOT EXISTS branch_code text,
  ADD COLUMN IF NOT EXISTS vat_status text NOT NULL DEFAULT 'non_vat',
  ADD COLUMN IF NOT EXISTS document_label text NOT NULL DEFAULT 'Sales Invoice',
  ADD COLUMN IF NOT EXISTS terminal_identifier text,
  ADD COLUMN IF NOT EXISTS bir_registration_info text,
  ADD COLUMN IF NOT EXISTS accreditation_info text,
  ADD COLUMN IF NOT EXISTS permit_info text,
  ADD COLUMN IF NOT EXISTS invoice_prefix text NOT NULL DEFAULT 'INV',
  ADD COLUMN IF NOT EXISTS logo_path text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE public.stores DROP CONSTRAINT IF EXISTS stores_vat_status_check;
ALTER TABLE public.stores
  ADD CONSTRAINT stores_vat_status_check CHECK (vat_status IN ('vat', 'non_vat'));
ALTER TABLE public.stores DROP CONSTRAINT IF EXISTS stores_document_label_nonempty;
ALTER TABLE public.stores
  ADD CONSTRAINT stores_document_label_nonempty CHECK (length(trim(document_label)) > 0);
ALTER TABLE public.stores DROP CONSTRAINT IF EXISTS stores_invoice_prefix_valid;
ALTER TABLE public.stores
  ADD CONSTRAINT stores_invoice_prefix_valid
  CHECK (invoice_prefix ~ '^[A-Za-z0-9-]{1,12}$');

CREATE OR REPLACE FUNCTION public.enforce_store_tax_configuration()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.name := trim(NEW.name);
  NEW.registered_name := NULLIF(trim(COALESCE(NEW.registered_name, '')), '');
  NEW.business_name := NULLIF(trim(COALESCE(NEW.business_name, '')), '');
  NEW.invoice_prefix := upper(trim(NEW.invoice_prefix));
  IF NEW.logo_path IS NOT NULL
    AND NEW.logo_path !~ ('^' || NEW.id::text || '/logo/[^/]+\.(png|jpg|jpeg|webp)$') THEN
    RAISE EXCEPTION 'Invalid store logo path';
  END IF;
  IF NEW.vat_status = 'non_vat' THEN
    NEW.tax_rate := 0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_store_tax_configuration ON public.stores;
CREATE TRIGGER trg_enforce_store_tax_configuration
BEFORE INSERT OR UPDATE ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.enforce_store_tax_configuration();

-- Branding files are public display assets, but only mapped store admins can write them.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'store-branding',
  'store-branding',
  true,
  2097152,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "store branding admin insert" ON storage.objects;
CREATE POLICY "store branding admin insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'store-branding'
  AND public.current_user_role()::text = 'admin'
  AND public.user_belongs_to_store(((storage.foldername(name))[1])::uuid)
  AND (storage.foldername(name))[2] = 'logo'
);

DROP POLICY IF EXISTS "store branding admin select" ON storage.objects;
CREATE POLICY "store branding admin select" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'store-branding'
  AND public.current_user_role()::text = 'admin'
  AND public.user_belongs_to_store(((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "store branding admin update" ON storage.objects;
CREATE POLICY "store branding admin update" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'store-branding'
  AND public.current_user_role()::text = 'admin'
  AND public.user_belongs_to_store(((storage.foldername(name))[1])::uuid)
)
WITH CHECK (
  bucket_id = 'store-branding'
  AND public.current_user_role()::text = 'admin'
  AND public.user_belongs_to_store(((storage.foldername(name))[1])::uuid)
  AND (storage.foldername(name))[2] = 'logo'
);

DROP POLICY IF EXISTS "store branding admin delete" ON storage.objects;
CREATE POLICY "store branding admin delete" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'store-branding'
  AND public.current_user_role()::text = 'admin'
  AND public.user_belongs_to_store(((storage.foldername(name))[1])::uuid)
);

-- 3. Receipt numbering, customer details, immutable snapshots, and reprint audit.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS customer_tin text,
  ADD COLUMN IF NOT EXISTS customer_address text,
  ADD COLUMN IF NOT EXISTS terminal_identifier text,
  ADD COLUMN IF NOT EXISTS discount_category text NOT NULL DEFAULT 'regular';

ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_discount_category_check;
ALTER TABLE public.sales
  ADD CONSTRAINT sales_discount_category_check
  CHECK (discount_category IN ('regular', 'senior', 'pwd', 'other'));

CREATE TABLE IF NOT EXISTS public.invoice_counters (
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  series_year integer NOT NULL CHECK (series_year BETWEEN 2000 AND 9999),
  next_number bigint NOT NULL DEFAULT 1 CHECK (next_number > 0),
  PRIMARY KEY (store_id, series_year)
);

CREATE TABLE IF NOT EXISTS public.receipt_reprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.receipts(id) ON DELETE RESTRICT,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  reprinted_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  output_type text NOT NULL DEFAULT 'print'
    CHECK (output_type IN ('preview', 'print', 'pdf')),
  reason text,
  reprinted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS receipt_reprints_receipt_created_idx
  ON public.receipt_reprints(receipt_id, reprinted_at DESC);
CREATE INDEX IF NOT EXISTS receipt_reprints_store_created_idx
  ON public.receipt_reprints(store_id, reprinted_at DESC);

ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_reprints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "receipt reprints: scoped read" ON public.receipt_reprints
FOR SELECT TO authenticated
USING (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role()::text IN ('admin', 'cashier')
);

REVOKE ALL ON public.invoice_counters FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.receipts FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.receipt_reprints FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.sales FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.sale_items FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.sale_payments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.sale_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.sale_returns FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.sale_return_items FROM authenticated;
GRANT SELECT ON public.receipts, public.receipt_reprints TO authenticated;

CREATE OR REPLACE FUNCTION public.generate_receipt_number(p_store_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year integer := extract(year FROM clock_timestamp())::integer;
  v_number bigint;
  v_prefix text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.stores WHERE id = p_store_id) THEN
    RAISE EXCEPTION 'Store does not exist';
  END IF;

  INSERT INTO public.invoice_counters(store_id, series_year, next_number)
  VALUES (p_store_id, v_year, 2)
  ON CONFLICT (store_id, series_year)
  DO UPDATE SET next_number = public.invoice_counters.next_number + 1
  RETURNING next_number - 1 INTO v_number;

  SELECT COALESCE(NULLIF(upper(trim(invoice_prefix)), ''), 'INV')
    || '-' || upper(substr(replace(id::text, '-', ''), 1, 6))
  INTO v_prefix
  FROM public.stores
  WHERE id = p_store_id;

  RETURN v_prefix || '-' || v_year::text || '-' || lpad(v_number::text, 8, '0');
END;
$$;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.build_receipt_snapshot(p_sale_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT jsonb_build_object(
    'version', 2,
    'sale', to_jsonb(s),
    'store', jsonb_build_object(
      'id', st.id,
      'name', st.name,
      'registeredName', COALESCE(st.registered_name, st.name),
      'businessName', COALESCE(st.business_name, st.name),
      'address', st.address,
      'tin', st.tin,
      'branchCode', st.branch_code,
      'vatStatus', st.vat_status,
      'taxRate', st.tax_rate,
      'documentLabel', st.document_label,
      'terminalIdentifier', COALESCE(s.terminal_identifier, st.terminal_identifier),
      'birRegistrationInfo', st.bir_registration_info,
      'accreditationInfo', st.accreditation_info,
      'permitInfo', st.permit_info,
      'logoPath', st.logo_path,
      'phone', st.phone,
      'email', st.email
    ),
    'cashier', jsonb_build_object(
      'id', p.id,
      'name', COALESCE(p.name, 'Unknown Cashier')
    ),
    'customer', jsonb_build_object(
      'name', s.customer_name,
      'tin', s.customer_tin,
      'address', s.customer_address
    ),
    'items', COALESCE((
      SELECT jsonb_agg(to_jsonb(si) ORDER BY si.id)
      FROM public.sale_items si
      WHERE si.sale_id = s.id
    ), '[]'::jsonb),
    'payment', COALESCE((
      SELECT to_jsonb(sp)
      FROM public.sale_payments sp
      WHERE sp.sale_id = s.id
      ORDER BY sp.created_at
      LIMIT 1
    ), '{}'::jsonb),
    'totals', jsonb_build_object(
      'subtotal', s.subtotal,
      'discount', s.discount,
      'discountType', s.discount_type,
      'discountValue', s.discount_value,
      'discountCategory', s.discount_category,
      'vatableSales', CASE WHEN st.vat_status = 'vat' AND s.discount_category NOT IN ('senior', 'pwd') THEN greatest(s.subtotal - s.discount, 0) ELSE 0 END,
      'vatAmount', CASE WHEN st.vat_status = 'vat' AND s.discount_category NOT IN ('senior', 'pwd') THEN s.tax ELSE 0 END,
      'vatExemptSales', CASE WHEN s.discount_category IN ('senior', 'pwd') THEN greatest(s.subtotal - s.discount, 0) ELSE 0 END,
      'zeroRatedSales', 0,
      'nonVatSales', CASE WHEN st.vat_status = 'non_vat' THEN greatest(s.subtotal - s.discount, 0) ELSE 0 END,
      'total', s.total,
      'amountTendered', s.cash_received,
      'change', s.change
    )
  )
  FROM public.sales s
  JOIN public.stores st ON st.id = s.store_id
  LEFT JOIN public.profiles p ON p.id = s.cashier_id
  WHERE s.id = p_sale_id;
$$;

CREATE OR REPLACE FUNCTION public.process_pos_sale_v3(
  p_id uuid,
  p_store_id uuid,
  p_cashier_id uuid,
  p_subtotal numeric,
  p_tax numeric,
  p_discount numeric,
  p_total numeric,
  p_cash_received numeric,
  p_change numeric,
  p_items jsonb,
  p_payment_method public.payment_method DEFAULT 'cash',
  p_payment_reference text DEFAULT NULL,
  p_discount_type text DEFAULT 'amount',
  p_discount_value numeric DEFAULT NULL,
  p_tax_rate numeric DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_customer_tin text DEFAULT NULL,
  p_customer_address text DEFAULT NULL,
  p_terminal_identifier text DEFAULT NULL,
  p_discount_category text DEFAULT 'regular'
)
RETURNS public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
BEGIN
  IF COALESCE(p_discount_category, 'regular') NOT IN ('regular', 'senior', 'pwd', 'other') THEN
    RAISE EXCEPTION 'Invalid discount category';
  END IF;

  v_sale := public.process_pos_sale_v2(
    p_id, p_store_id, p_cashier_id, p_subtotal, p_tax, p_discount, p_total,
    p_cash_received, p_change, p_items, p_payment_method, p_payment_reference,
    p_discount_type, p_discount_value,
    CASE WHEN p_discount_category IN ('senior', 'pwd') THEN 0 ELSE NULL END
  );

  UPDATE public.sales
  SET customer_name = NULLIF(trim(COALESCE(p_customer_name, '')), ''),
      customer_tin = NULLIF(trim(COALESCE(p_customer_tin, '')), ''),
      customer_address = NULLIF(trim(COALESCE(p_customer_address, '')), ''),
      terminal_identifier = NULLIF(trim(COALESCE(p_terminal_identifier, '')), ''),
      discount_category = COALESCE(p_discount_category, 'regular')
  WHERE id = v_sale.id
  RETURNING * INTO v_sale;

  UPDATE public.receipts
  SET payload = private.build_receipt_snapshot(v_sale.id)
  WHERE sale_id = v_sale.id;

  RETURN v_sale;
END;
$$;

-- Upgrade legacy receipt payloads once, before immutability protection is installed.
UPDATE public.receipts
SET payload = private.build_receipt_snapshot(sale_id)
WHERE COALESCE(payload->>'version', '') <> '2';

CREATE OR REPLACE FUNCTION public.record_receipt_reprint(
  p_sale_id uuid,
  p_output_type text DEFAULT 'print',
  p_reason text DEFAULT NULL
)
RETURNS public.receipts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt public.receipts%ROWTYPE;
BEGIN
  IF p_output_type NOT IN ('preview', 'print', 'pdf') THEN
    RAISE EXCEPTION 'Invalid receipt output type';
  END IF;

  SELECT * INTO v_receipt
  FROM public.receipts
  WHERE sale_id = p_sale_id;

  IF NOT FOUND
    OR NOT public.user_belongs_to_store(v_receipt.store_id)
    OR public.current_user_role()::text NOT IN ('admin', 'cashier') THEN
    RAISE EXCEPTION 'Receipt not found or access denied';
  END IF;

  INSERT INTO public.receipt_reprints(
    receipt_id, store_id, reprinted_by, output_type, reason
  )
  VALUES (
    v_receipt.id, v_receipt.store_id, (SELECT auth.uid()), p_output_type,
    NULLIF(trim(COALESCE(p_reason, '')), '')
  );

  RETURN v_receipt;
END;
$$;

CREATE OR REPLACE FUNCTION private.protect_completed_sale()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Sales are permanent records; void the transaction instead of deleting it';
  END IF;

  IF OLD.store_id IS DISTINCT FROM NEW.store_id
    OR OLD.cashier_id IS DISTINCT FROM NEW.cashier_id
    OR OLD.subtotal IS DISTINCT FROM NEW.subtotal
    OR OLD.tax IS DISTINCT FROM NEW.tax
    OR OLD.discount IS DISTINCT FROM NEW.discount
    OR OLD.total IS DISTINCT FROM NEW.total
    OR OLD.cash_received IS DISTINCT FROM NEW.cash_received
    OR OLD.change IS DISTINCT FROM NEW.change
    OR OLD.payment_method IS DISTINCT FROM NEW.payment_method
    OR OLD.payment_reference IS DISTINCT FROM NEW.payment_reference
    OR OLD.discount_type IS DISTINCT FROM NEW.discount_type
    OR OLD.discount_value IS DISTINCT FROM NEW.discount_value
    OR OLD.tax_rate IS DISTINCT FROM NEW.tax_rate
    OR OLD.receipt_number IS DISTINCT FROM NEW.receipt_number
    OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'Completed sale financial details are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_completed_sale ON public.sales;
CREATE TRIGGER trg_protect_completed_sale
BEFORE UPDATE OR DELETE ON public.sales
FOR EACH ROW EXECUTE FUNCTION private.protect_completed_sale();

CREATE OR REPLACE FUNCTION private.protect_receipt()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Issued receipts cannot be deleted';
  END IF;
  IF OLD.sale_id IS DISTINCT FROM NEW.sale_id
    OR OLD.store_id IS DISTINCT FROM NEW.store_id
    OR OLD.receipt_number IS DISTINCT FROM NEW.receipt_number
    OR OLD.issued_by IS DISTINCT FROM NEW.issued_by
    OR (
      OLD.payload IS DISTINCT FROM NEW.payload
      AND NOT (
        COALESCE(OLD.payload->>'version', '') = ''
        AND NEW.payload->>'version' = '2'
      )
    )
    OR OLD.issued_at IS DISTINCT FROM NEW.issued_at THEN
    RAISE EXCEPTION 'Issued receipt details are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_receipt ON public.receipts;
CREATE TRIGGER trg_protect_receipt
BEFORE UPDATE OR DELETE ON public.receipts
FOR EACH ROW EXECUTE FUNCTION private.protect_receipt();

CREATE OR REPLACE FUNCTION private.protect_direct_stock_edits()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'products'
    AND OLD.current_stock IS DISTINCT FROM NEW.current_stock
    AND current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Use adjust_inventory_stock to change product stock';
  END IF;

  IF TG_TABLE_NAME = 'product_selling_options'
    AND OLD.stock_quantity IS DISTINCT FROM NEW.stock_quantity
    AND current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Use adjust_inventory_stock to change selling-option stock';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_direct_product_stock ON public.products;
CREATE TRIGGER trg_protect_direct_product_stock
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION private.protect_direct_stock_edits();

DROP TRIGGER IF EXISTS trg_protect_direct_option_stock ON public.product_selling_options;
CREATE TRIGGER trg_protect_direct_option_stock
BEFORE UPDATE ON public.product_selling_options
FOR EACH ROW EXECUTE FUNCTION private.protect_direct_stock_edits();

CREATE OR REPLACE FUNCTION public.adjust_inventory_stock(
  p_product_id uuid,
  p_selling_option_id uuid,
  p_quantity_delta numeric,
  p_reason text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_option public.product_selling_options%ROWTYPE;
  v_before numeric;
  v_after numeric;
  v_adjustment_id uuid := gen_random_uuid();
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF public.current_user_role()::text NOT IN ('admin', 'inventory') THEN
    RAISE EXCEPTION 'Only admins or inventory users can adjust stock';
  END IF;
  IF p_quantity_delta IS NULL OR p_quantity_delta = 0 THEN
    RAISE EXCEPTION 'Quantity change cannot be zero';
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.user_belongs_to_store(v_product.store_id) THEN
    RAISE EXCEPTION 'Product not found or access denied';
  END IF;

  IF p_selling_option_id IS NOT NULL THEN
    SELECT * INTO v_option
    FROM public.product_selling_options
    WHERE id = p_selling_option_id
      AND product_id = p_product_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selling option not found';
    END IF;

    v_before := v_option.stock_quantity;
    v_after := round(v_before + p_quantity_delta, 3);
    IF v_after < 0 THEN
      RAISE EXCEPTION 'Stock cannot be negative';
    END IF;

    UPDATE public.product_selling_options
    SET stock_quantity = v_after, updated_at = now()
    WHERE id = v_option.id;

    IF v_option.is_default THEN
      UPDATE public.products
      SET current_stock = round(v_after), updated_at = now()
      WHERE id = v_product.id;
    END IF;
  ELSE
    v_before := v_product.current_stock;
    v_after := round(v_before + p_quantity_delta, 3);
    IF v_after < 0 THEN
      RAISE EXCEPTION 'Stock cannot be negative';
    END IF;

    UPDATE public.products
    SET current_stock = round(v_after), updated_at = now()
    WHERE id = v_product.id;
  END IF;

  INSERT INTO public.stock_adjustments(
    id, store_id, product_id, selling_option_id, selling_option_label,
    unit_label, package_size, package_unit, stock_source, reason,
    quantity_delta, stock_before, stock_after, note, created_by
  )
  VALUES (
    v_adjustment_id,
    v_product.store_id,
    v_product.id,
    CASE WHEN p_selling_option_id IS NULL THEN NULL ELSE v_option.id END,
    CASE WHEN p_selling_option_id IS NULL THEN NULL ELSE v_option.label END,
    CASE WHEN p_selling_option_id IS NULL THEN v_product.unit ELSE v_option.unit_label END,
    CASE WHEN p_selling_option_id IS NULL THEN NULL ELSE v_option.quantity_value END,
    CASE WHEN p_selling_option_id IS NULL THEN NULL ELSE v_option.quantity_unit END,
    CASE WHEN p_selling_option_id IS NULL THEN 'product' ELSE 'selling_option' END,
    p_reason::public.adjustment_reason,
    v_after - v_before,
    v_before,
    v_after,
    COALESCE(p_note, ''),
    (SELECT auth.uid())
  );

  RETURN jsonb_build_object(
    'adjustmentId', v_adjustment_id,
    'productId', v_product.id,
    'sellingOptionId', p_selling_option_id,
    'stockBefore', v_before,
    'stockAfter', v_after,
    'quantityDelta', v_after - v_before
  );
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON public.stock_adjustments FROM authenticated;
GRANT SELECT ON public.stock_adjustments TO authenticated;

REVOKE ALL ON FUNCTION public.generate_receipt_number(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_pos_sale_v2(
  uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, jsonb,
  public.payment_method, text, text, numeric, numeric
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_pos_sale(
  uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_pos_sale_v3(
  uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, jsonb,
  public.payment_method, text, text, numeric, numeric, text, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_pos_sale_v3(
  uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, jsonb,
  public.payment_method, text, text, numeric, numeric, text, text, text, text, text
) TO authenticated;
REVOKE ALL ON FUNCTION public.record_receipt_reprint(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_receipt_reprint(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.adjust_inventory_stock(uuid, uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_inventory_stock(uuid, uuid, numeric, text, text) TO authenticated;

-- Exposed tables remain protected by RLS even though authenticated has Data API privileges.
GRANT SELECT, INSERT, UPDATE ON public.products TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.categories TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.product_selling_options TO authenticated;
GRANT SELECT ON public.inventory_movements TO authenticated;

-- Existing reporting views must evaluate underlying RLS as the calling user.
ALTER VIEW public.v_product_stock_status SET (security_invoker = true);
ALTER VIEW public.v_daily_sales_summary SET (security_invoker = true);
ALTER VIEW public.v_category_sales SET (security_invoker = true);
ALTER VIEW public.v_product_rankings SET (security_invoker = true);
