-- Migration 19: Transaction lifecycle, closeouts, operational logs, and auth-admin support

-- 1. Lifecycle enums.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sale_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.sale_status AS ENUM ('completed', 'voided', 'partially_refunded', 'refunded');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.payment_method AS ENUM ('cash', 'gcash', 'card', 'bank_transfer', 'other');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.payment_status AS ENUM ('captured', 'refunded', 'voided');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'return_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.return_status AS ENUM ('completed', 'cancelled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'closeout_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.closeout_status AS ENUM ('closed', 'reopened');
  END IF;
END $$;

-- 2. Extend sales with immutable tender, tax, discount, receipt, and void metadata.
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS status public.sale_status NOT NULL DEFAULT 'completed';
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payment_method public.payment_method NOT NULL DEFAULT 'cash';
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payment_reference text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS discount_type text NOT NULL DEFAULT 'amount';
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS discount_value numeric NOT NULL DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS tax_rate numeric NOT NULL DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS receipt_number text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS voided_at timestamptz;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS void_reason text;

ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_discount_type_valid;
ALTER TABLE public.sales
  ADD CONSTRAINT sales_discount_type_valid CHECK (discount_type IN ('amount', 'percent'));

ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_discount_value_nonnegative;
ALTER TABLE public.sales
  ADD CONSTRAINT sales_discount_value_nonnegative CHECK (discount_value >= 0);

ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_tax_rate_valid;
ALTER TABLE public.sales
  ADD CONSTRAINT sales_tax_rate_valid CHECK (tax_rate >= 0 AND tax_rate <= 100);

CREATE UNIQUE INDEX IF NOT EXISTS sales_receipt_number_uidx
  ON public.sales(receipt_number)
  WHERE receipt_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_status_store_created_idx
  ON public.sales(store_id, status, created_at DESC);

-- 3. Cashier closeouts and transaction artifacts.
CREATE TABLE IF NOT EXISTS public.cashier_closeouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  cashier_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL DEFAULT now(),
  opening_cash numeric NOT NULL DEFAULT 0 CHECK (opening_cash >= 0),
  cash_sales numeric NOT NULL DEFAULT 0 CHECK (cash_sales >= 0),
  cash_refunds numeric NOT NULL DEFAULT 0 CHECK (cash_refunds >= 0),
  expected_cash numeric NOT NULL DEFAULT 0,
  counted_cash numeric NOT NULL DEFAULT 0 CHECK (counted_cash >= 0),
  variance numeric NOT NULL DEFAULT 0,
  status public.closeout_status NOT NULL DEFAULT 'closed',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS closeout_id uuid REFERENCES public.cashier_closeouts(id);

CREATE TABLE IF NOT EXISTS public.sale_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  method public.payment_method NOT NULL,
  status public.payment_status NOT NULL DEFAULT 'captured',
  amount numeric NOT NULL,
  amount_tendered numeric NOT NULL DEFAULT 0,
  change_amount numeric NOT NULL DEFAULT 0,
  reference_number text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  receipt_number text NOT NULL UNIQUE,
  issued_by uuid REFERENCES public.profiles(id),
  printed_count integer NOT NULL DEFAULT 0 CHECK (printed_count >= 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  issued_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sale_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  reason text,
  amount numeric,
  actor_id uuid REFERENCES public.profiles(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sale_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  return_number text NOT NULL UNIQUE,
  status public.return_status NOT NULL DEFAULT 'completed',
  reason text NOT NULL DEFAULT '',
  refund_amount numeric NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  refund_method public.payment_method NOT NULL DEFAULT 'cash',
  reference_number text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sale_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.sale_returns(id) ON DELETE CASCADE,
  sale_item_id uuid NOT NULL REFERENCES public.sale_items(id) ON DELETE RESTRICT,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric NOT NULL CHECK (unit_price >= 0),
  line_total numeric NOT NULL CHECK (line_total >= 0),
  restocked boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  source text NOT NULL,
  message text NOT NULL,
  stack text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cashier_closeouts_store_cashier_period_idx
  ON public.cashier_closeouts(store_id, cashier_id, period_end DESC);
CREATE INDEX IF NOT EXISTS sale_payments_sale_idx ON public.sale_payments(sale_id);
CREATE INDEX IF NOT EXISTS sale_payments_store_created_idx ON public.sale_payments(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS receipts_store_issued_idx ON public.receipts(store_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS sale_events_store_created_idx ON public.sale_events(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sale_returns_sale_idx ON public.sale_returns(sale_id);
CREATE INDEX IF NOT EXISTS sale_return_items_sale_item_idx ON public.sale_return_items(sale_item_id);
CREATE INDEX IF NOT EXISTS audit_logs_store_created_idx ON public.audit_logs(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS error_logs_store_created_idx ON public.error_logs(store_id, created_at DESC);

-- 3.5 Harden direct profile and store-user writes now that user lifecycle uses Edge Functions.
DROP POLICY IF EXISTS "profiles: authenticated read" ON public.profiles;
DROP POLICY IF EXISTS "profiles: scoped read" ON public.profiles;
CREATE POLICY "profiles: scoped read" ON public.profiles
FOR SELECT TO authenticated
USING (
  id = auth.uid()
  OR public.current_user_role()::text = 'super_admin'
  OR EXISTS (
    SELECT 1
    FROM public.store_users target_mapping
    JOIN public.store_users actor_mapping
      ON actor_mapping.store_id = target_mapping.store_id
    WHERE target_mapping.profile_id = profiles.id
      AND actor_mapping.profile_id = auth.uid()
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
      AND actor_mapping.profile_id = auth.uid()
  )
)
WITH CHECK (
  public.current_user_role()::text = 'admin'
  AND role::text IN ('admin', 'cashier')
);

DROP POLICY IF EXISTS "Admins map users" ON public.store_users;
DROP POLICY IF EXISTS "Admins unmap users" ON public.store_users;

-- 4. Helper routines.
CREATE OR REPLACE FUNCTION public.generate_receipt_number(p_store_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN 'KDG-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
END;
$$;

CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_store_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.audit_logs(store_id, actor_id, action, entity_type, entity_id, details)
  VALUES (p_store_id, auth.uid(), p_action, p_entity_type, p_entity_id, COALESCE(p_details, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Client-callable error logging. It intentionally records only authenticated users.
CREATE OR REPLACE FUNCTION public.log_client_error(
  p_source text,
  p_message text,
  p_stack text DEFAULT NULL,
  p_context jsonb DEFAULT '{}'::jsonb,
  p_store_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_store_id IS NOT NULL AND NOT public.user_belongs_to_store(p_store_id) THEN
    RAISE EXCEPTION 'User is not assigned to this store';
  END IF;

  INSERT INTO public.error_logs(store_id, actor_id, source, message, stack, context)
  VALUES (p_store_id, auth.uid(), p_source, p_message, p_stack, COALESCE(p_context, '{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 5. Lifecycle-aware checkout. The old process_pos_sale signature remains as a wrapper below.
CREATE OR REPLACE FUNCTION public.process_pos_sale_v2(
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
  p_tax_rate numeric DEFAULT NULL
)
RETURNS public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_role text;
  v_item jsonb;
  v_product public.products%ROWTYPE;
  v_product_id uuid;
  v_qty integer;
  v_subtotal numeric := 0;
  v_discount_type text := COALESCE(NULLIF(p_discount_type, ''), 'amount');
  v_discount_value numeric := COALESCE(p_discount_value, p_discount, 0);
  v_discount numeric := 0;
  v_tax_rate numeric;
  v_tax numeric;
  v_total numeric;
  v_tendered numeric;
  v_change numeric;
  v_receipt_number text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_cashier_id IS NOT NULL AND p_cashier_id <> auth.uid() THEN
    RAISE EXCEPTION 'Cashier id does not match authenticated user';
  END IF;

  SELECT role::text INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'cashier') THEN
    RAISE EXCEPTION 'Only store admins or cashiers can process sales';
  END IF;

  IF NOT public.user_belongs_to_store(p_store_id) THEN
    RAISE EXCEPTION 'User is not assigned to this store';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Sale must contain at least one item';
  END IF;

  FOR v_product_id, v_qty IN
    SELECT
      (value->>'productId')::uuid,
      SUM((value->>'quantity')::integer)::integer
    FROM jsonb_array_elements(p_items) AS line(value)
    GROUP BY (value->>'productId')::uuid
  LOOP
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Sale item quantity must be greater than zero';
    END IF;

    SELECT *
    INTO v_product
    FROM public.products
    WHERE id = v_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % does not exist', v_product_id;
    END IF;

    IF v_product.store_id <> p_store_id THEN
      RAISE EXCEPTION 'Product % does not belong to sale store %', v_product_id, p_store_id;
    END IF;

    IF v_product.current_stock < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for %. Available %, requested %',
        v_product.name, v_product.current_stock, v_qty;
    END IF;

    v_subtotal := v_subtotal + round(v_product.selling_price * v_qty, 2);
  END LOOP;

  IF v_discount_type NOT IN ('amount', 'percent') THEN
    RAISE EXCEPTION 'Discount type must be amount or percent';
  END IF;

  IF v_discount_value < 0 OR COALESCE(p_cash_received, 0) < 0 THEN
    RAISE EXCEPTION 'Sale totals cannot be negative';
  END IF;

  IF v_discount_type = 'percent' THEN
    IF v_discount_value > 100 THEN
      RAISE EXCEPTION 'Percent discount cannot exceed 100';
    END IF;
    v_discount := round(v_subtotal * v_discount_value / 100, 2);
  ELSE
    v_discount := round(v_discount_value, 2);
  END IF;

  IF v_discount > v_subtotal THEN
    RAISE EXCEPTION 'Discount cannot exceed subtotal';
  END IF;

  SELECT COALESCE(p_tax_rate, tax_rate, 0)
  INTO v_tax_rate
  FROM public.stores
  WHERE id = p_store_id;

  IF v_tax_rate IS NULL OR v_tax_rate < 0 OR v_tax_rate > 100 THEN
    RAISE EXCEPTION 'Tax rate must be between 0 and 100';
  END IF;

  v_tax := round((v_subtotal - v_discount) * v_tax_rate / 100, 2);
  v_total := round(v_subtotal - v_discount + v_tax, 2);

  IF p_payment_method = 'cash' THEN
    v_tendered := COALESCE(p_cash_received, 0);
    v_change := round(v_tendered - v_total, 2);
    IF v_change < 0 THEN
      RAISE EXCEPTION 'Cash received is less than sale total';
    END IF;
  ELSE
    v_tendered := v_total;
    v_change := 0;
  END IF;

  IF abs(COALESCE(p_subtotal, 0) - v_subtotal) > 0.01
    OR abs(COALESCE(p_tax, 0) - v_tax) > 0.01
    OR abs(COALESCE(p_discount, 0) - v_discount) > 0.01
    OR abs(COALESCE(p_total, 0) - v_total) > 0.01
    OR abs(COALESCE(p_change, 0) - v_change) > 0.01 THEN
    RAISE EXCEPTION 'Submitted sale totals do not match current product prices, discount, or tax';
  END IF;

  v_receipt_number := public.generate_receipt_number(p_store_id);

  INSERT INTO public.sales (
    id,
    store_id,
    cashier_id,
    subtotal,
    tax,
    discount,
    total,
    cash_received,
    change,
    status,
    payment_method,
    payment_reference,
    discount_type,
    discount_value,
    tax_rate,
    receipt_number
  )
  VALUES (
    p_id,
    p_store_id,
    auth.uid(),
    v_subtotal,
    v_tax,
    v_discount,
    v_total,
    v_tendered,
    v_change,
    'completed',
    p_payment_method,
    p_payment_reference,
    v_discount_type,
    v_discount_value,
    v_tax_rate,
    v_receipt_number
  )
  RETURNING * INTO v_sale;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS line(value)
  LOOP
    v_product_id := (v_item->>'productId')::uuid;
    v_qty := (v_item->>'quantity')::integer;

    SELECT *
    INTO v_product
    FROM public.products
    WHERE id = v_product_id;

    INSERT INTO public.sale_items (
      sale_id, product_id, product_name, quantity, unit_price, line_total
    )
    VALUES (
      v_sale.id,
      v_product.id,
      v_product.name,
      v_qty,
      v_product.selling_price,
      round(v_product.selling_price * v_qty, 2)
    );
  END LOOP;

  INSERT INTO public.sale_payments (
    sale_id, store_id, method, status, amount, amount_tendered, change_amount, reference_number, created_by
  )
  VALUES (
    v_sale.id, p_store_id, p_payment_method, 'captured', v_total, v_tendered, v_change, p_payment_reference, auth.uid()
  );

  INSERT INTO public.receipts(sale_id, store_id, receipt_number, issued_by, payload)
  VALUES (
    v_sale.id,
    p_store_id,
    v_receipt_number,
    auth.uid(),
    jsonb_build_object(
      'sale', to_jsonb(v_sale),
      'items', p_items,
      'totals', jsonb_build_object(
        'subtotal', v_subtotal,
        'discount', v_discount,
        'tax', v_tax,
        'total', v_total,
        'amountTendered', v_tendered,
        'change', v_change
      )
    )
  );

  INSERT INTO public.sale_events(sale_id, store_id, event_type, amount, actor_id, metadata)
  VALUES (v_sale.id, p_store_id, 'completed', v_total, auth.uid(), jsonb_build_object('receiptNumber', v_receipt_number));

  PERFORM public.log_audit_event(
    p_store_id,
    'sale.completed',
    'sale',
    v_sale.id,
    jsonb_build_object('total', v_total, 'paymentMethod', p_payment_method, 'receiptNumber', v_receipt_number)
  );

  RETURN v_sale;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_pos_sale(
  p_id uuid,
  p_store_id uuid,
  p_cashier_id uuid,
  p_subtotal numeric,
  p_tax numeric,
  p_discount numeric,
  p_total numeric,
  p_cash_received numeric,
  p_change numeric,
  p_items jsonb
)
RETURNS public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.process_pos_sale_v2(
    p_id,
    p_store_id,
    p_cashier_id,
    p_subtotal,
    p_tax,
    p_discount,
    p_total,
    p_cash_received,
    p_change,
    p_items,
    'cash',
    NULL,
    'amount',
    p_discount,
    0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.void_pos_sale(
  p_sale_id uuid,
  p_reason text
)
RETURNS public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_item record;
  v_before integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
  INTO v_sale
  FROM public.sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale % does not exist', p_sale_id;
  END IF;

  IF public.current_user_role()::text <> 'admin' THEN
    RAISE EXCEPTION 'Only store admins can void sales';
  END IF;

  IF NOT public.user_belongs_to_store(v_sale.store_id) THEN
    RAISE EXCEPTION 'User is not assigned to this store';
  END IF;

  IF v_sale.status <> 'completed' THEN
    RAISE EXCEPTION 'Only completed sales can be voided';
  END IF;

  IF v_sale.closeout_id IS NOT NULL THEN
    RAISE EXCEPTION 'Closed-out sales cannot be voided';
  END IF;

  FOR v_item IN
    SELECT product_id, quantity
    FROM public.sale_items
    WHERE sale_id = p_sale_id
      AND product_id IS NOT NULL
  LOOP
    SELECT current_stock
    INTO v_before
    FROM public.products
    WHERE id = v_item.product_id
    FOR UPDATE;

    UPDATE public.products
    SET current_stock = current_stock + v_item.quantity,
        updated_at = now()
    WHERE id = v_item.product_id;

    INSERT INTO public.stock_adjustments(
      store_id, product_id, reason, quantity_delta, stock_before, stock_after, note, created_by
    )
    VALUES (
      v_sale.store_id,
      v_item.product_id,
      'other',
      v_item.quantity,
      v_before,
      v_before + v_item.quantity,
      'Voided sale ' || p_sale_id::text,
      auth.uid()
    );
  END LOOP;

  UPDATE public.sales
  SET status = 'voided',
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = COALESCE(NULLIF(p_reason, ''), 'No reason provided')
  WHERE id = p_sale_id
  RETURNING * INTO v_sale;

  UPDATE public.sale_payments
  SET status = 'voided'
  WHERE sale_id = p_sale_id
    AND status = 'captured';

  INSERT INTO public.sale_events(sale_id, store_id, event_type, reason, amount, actor_id)
  VALUES (p_sale_id, v_sale.store_id, 'voided', p_reason, v_sale.total, auth.uid());

  PERFORM public.log_audit_event(
    v_sale.store_id,
    'sale.voided',
    'sale',
    p_sale_id,
    jsonb_build_object('reason', p_reason, 'total', v_sale.total)
  );

  RETURN v_sale;
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_pos_sale(
  p_sale_id uuid,
  p_amount numeric,
  p_method public.payment_method DEFAULT 'cash',
  p_reason text DEFAULT NULL,
  p_reference text DEFAULT NULL
)
RETURNS public.sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_refunded numeric;
  v_new_refunded numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
  INTO v_sale
  FROM public.sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale % does not exist', p_sale_id;
  END IF;

  IF public.current_user_role()::text <> 'admin' THEN
    RAISE EXCEPTION 'Only store admins can refund sales';
  END IF;

  IF NOT public.user_belongs_to_store(v_sale.store_id) THEN
    RAISE EXCEPTION 'User is not assigned to this store';
  END IF;

  IF v_sale.status IN ('voided', 'refunded') THEN
    RAISE EXCEPTION 'Sale is not refundable in its current status';
  END IF;

  IF v_sale.closeout_id IS NOT NULL THEN
    RAISE EXCEPTION 'Closed-out sales require an accounting adjustment instead of an inline refund';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Refund amount must be greater than zero';
  END IF;

  SELECT COALESCE(abs(SUM(amount)) FILTER (WHERE amount < 0), 0)
  INTO v_refunded
  FROM public.sale_payments
  WHERE sale_id = p_sale_id;

  v_new_refunded := v_refunded + p_amount;
  IF v_new_refunded > v_sale.total + 0.01 THEN
    RAISE EXCEPTION 'Refund cannot exceed remaining paid total';
  END IF;

  INSERT INTO public.sale_payments(
    sale_id, store_id, method, status, amount, amount_tendered, change_amount, reference_number, created_by
  )
  VALUES (
    p_sale_id, v_sale.store_id, p_method, 'refunded', -round(p_amount, 2), round(p_amount, 2), 0, p_reference, auth.uid()
  );

  UPDATE public.sales
  SET status = CASE
    WHEN v_new_refunded >= total - 0.01 THEN 'refunded'::public.sale_status
    ELSE 'partially_refunded'::public.sale_status
  END
  WHERE id = p_sale_id
  RETURNING * INTO v_sale;

  INSERT INTO public.sale_events(sale_id, store_id, event_type, reason, amount, actor_id, metadata)
  VALUES (
    p_sale_id,
    v_sale.store_id,
    'refunded',
    p_reason,
    p_amount,
    auth.uid(),
    jsonb_build_object('method', p_method, 'reference', p_reference)
  );

  PERFORM public.log_audit_event(
    v_sale.store_id,
    'sale.refunded',
    'sale',
    p_sale_id,
    jsonb_build_object('amount', p_amount, 'method', p_method, 'reason', p_reason)
  );

  RETURN v_sale;
END;
$$;

CREATE OR REPLACE FUNCTION public.return_sale_items(
  p_sale_id uuid,
  p_items jsonb,
  p_reason text,
  p_refund_method public.payment_method DEFAULT 'cash',
  p_reference text DEFAULT NULL
)
RETURNS public.sale_returns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_return public.sale_returns%ROWTYPE;
  v_item jsonb;
  v_sale_item public.sale_items%ROWTYPE;
  v_qty integer;
  v_previously_returned integer;
  v_line_total numeric;
  v_refund_total numeric := 0;
  v_before integer;
  v_refunded numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
  INTO v_sale
  FROM public.sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale % does not exist', p_sale_id;
  END IF;

  IF public.current_user_role()::text <> 'admin' THEN
    RAISE EXCEPTION 'Only store admins can process returns';
  END IF;

  IF NOT public.user_belongs_to_store(v_sale.store_id) THEN
    RAISE EXCEPTION 'User is not assigned to this store';
  END IF;

  IF v_sale.status IN ('voided', 'refunded') THEN
    RAISE EXCEPTION 'Sale is not returnable in its current status';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Return must contain at least one item';
  END IF;

  INSERT INTO public.sale_returns(
    sale_id, store_id, return_number, reason, refund_method, reference_number, created_by
  )
  VALUES (
    p_sale_id,
    v_sale.store_id,
    'RET-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' ||
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
    COALESCE(NULLIF(p_reason, ''), 'No reason provided'),
    p_refund_method,
    p_reference,
    auth.uid()
  )
  RETURNING * INTO v_return;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS line(value)
  LOOP
    SELECT *
    INTO v_sale_item
    FROM public.sale_items
    WHERE id = COALESCE((v_item->>'saleItemId')::uuid, (v_item->>'id')::uuid)
      AND sale_id = p_sale_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sale item does not exist for this sale';
    END IF;

    v_qty := COALESCE((v_item->>'quantity')::integer, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Return item quantity must be greater than zero';
    END IF;

    SELECT COALESCE(SUM(quantity), 0)
    INTO v_previously_returned
    FROM public.sale_return_items sri
    JOIN public.sale_returns sr ON sr.id = sri.return_id
    WHERE sr.sale_id = p_sale_id
      AND sri.sale_item_id = v_sale_item.id
      AND sr.status = 'completed';

    IF v_previously_returned + v_qty > v_sale_item.quantity THEN
      RAISE EXCEPTION 'Return quantity exceeds purchased quantity';
    END IF;

    v_line_total := round(v_sale_item.unit_price * v_qty, 2);
    v_refund_total := v_refund_total + v_line_total;

    IF COALESCE((v_item->>'restock')::boolean, true) AND v_sale_item.product_id IS NOT NULL THEN
      SELECT current_stock
      INTO v_before
      FROM public.products
      WHERE id = v_sale_item.product_id
      FOR UPDATE;

      UPDATE public.products
      SET current_stock = current_stock + v_qty,
          updated_at = now()
      WHERE id = v_sale_item.product_id;

      INSERT INTO public.stock_adjustments(
        store_id, product_id, reason, quantity_delta, stock_before, stock_after, note, created_by
      )
      VALUES (
        v_sale.store_id,
        v_sale_item.product_id,
        'other',
        v_qty,
        v_before,
        v_before + v_qty,
        'Returned sale ' || p_sale_id::text,
        auth.uid()
      );
    END IF;

    INSERT INTO public.sale_return_items(
      return_id, sale_item_id, product_id, quantity, unit_price, line_total, restocked
    )
    VALUES (
      v_return.id,
      v_sale_item.id,
      v_sale_item.product_id,
      v_qty,
      v_sale_item.unit_price,
      v_line_total,
      COALESCE((v_item->>'restock')::boolean, true)
    );
  END LOOP;

  SELECT COALESCE(abs(SUM(amount)) FILTER (WHERE amount < 0), 0)
  INTO v_refunded
  FROM public.sale_payments
  WHERE sale_id = p_sale_id;

  IF v_refunded + v_refund_total > v_sale.total + 0.01 THEN
    RAISE EXCEPTION 'Return refund cannot exceed remaining paid total';
  END IF;

  UPDATE public.sale_returns
  SET refund_amount = v_refund_total
  WHERE id = v_return.id
  RETURNING * INTO v_return;

  INSERT INTO public.sale_payments(
    sale_id, store_id, method, status, amount, amount_tendered, change_amount, reference_number, created_by
  )
  VALUES (
    p_sale_id, v_sale.store_id, p_refund_method, 'refunded', -round(v_refund_total, 2), round(v_refund_total, 2), 0, p_reference, auth.uid()
  );

  UPDATE public.sales
  SET status = CASE
    WHEN v_refunded + v_refund_total >= total - 0.01 THEN 'refunded'::public.sale_status
    ELSE 'partially_refunded'::public.sale_status
  END
  WHERE id = p_sale_id;

  INSERT INTO public.sale_events(sale_id, store_id, event_type, reason, amount, actor_id, metadata)
  VALUES (
    p_sale_id,
    v_sale.store_id,
    'returned',
    p_reason,
    v_refund_total,
    auth.uid(),
    jsonb_build_object('returnId', v_return.id, 'method', p_refund_method, 'reference', p_reference)
  );

  PERFORM public.log_audit_event(
    v_sale.store_id,
    'sale.returned',
    'sale',
    p_sale_id,
    jsonb_build_object('returnId', v_return.id, 'amount', v_refund_total, 'reason', p_reason)
  );

  RETURN v_return;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_cashier_shift(
  p_store_id uuid,
  p_counted_cash numeric,
  p_opening_cash numeric DEFAULT 0,
  p_notes text DEFAULT NULL,
  p_period_start timestamptz DEFAULT NULL,
  p_period_end timestamptz DEFAULT now()
)
RETURNS public.cashier_closeouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closeout public.cashier_closeouts%ROWTYPE;
  v_role text;
  v_period_start timestamptz;
  v_cash_sales numeric;
  v_cash_refunds numeric;
  v_expected numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT role::text INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'cashier') THEN
    RAISE EXCEPTION 'Only store admins or cashiers can close a cashier shift';
  END IF;

  IF NOT public.user_belongs_to_store(p_store_id) THEN
    RAISE EXCEPTION 'User is not assigned to this store';
  END IF;

  IF p_counted_cash IS NULL OR p_counted_cash < 0 OR COALESCE(p_opening_cash, 0) < 0 THEN
    RAISE EXCEPTION 'Cash amounts cannot be negative';
  END IF;

  SELECT COALESCE(
    p_period_start,
    MAX(period_end),
    date_trunc('day', p_period_end)
  )
  INTO v_period_start
  FROM public.cashier_closeouts
  WHERE store_id = p_store_id
    AND cashier_id = auth.uid()
    AND status = 'closed';

  SELECT
    COALESCE(SUM(sp.amount) FILTER (WHERE sp.amount > 0), 0),
    COALESCE(abs(SUM(sp.amount) FILTER (WHERE sp.amount < 0)), 0)
  INTO v_cash_sales, v_cash_refunds
  FROM public.sale_payments sp
  JOIN public.sales s ON s.id = sp.sale_id
  WHERE sp.store_id = p_store_id
    AND sp.method = 'cash'
    AND sp.created_by = auth.uid()
    AND sp.created_at >= v_period_start
    AND sp.created_at <= p_period_end
    AND s.status <> 'voided';

  v_expected := round(COALESCE(p_opening_cash, 0) + v_cash_sales - v_cash_refunds, 2);

  INSERT INTO public.cashier_closeouts(
    store_id,
    cashier_id,
    period_start,
    period_end,
    opening_cash,
    cash_sales,
    cash_refunds,
    expected_cash,
    counted_cash,
    variance,
    notes
  )
  VALUES (
    p_store_id,
    auth.uid(),
    v_period_start,
    p_period_end,
    COALESCE(p_opening_cash, 0),
    v_cash_sales,
    v_cash_refunds,
    v_expected,
    p_counted_cash,
    round(p_counted_cash - v_expected, 2),
    COALESCE(p_notes, '')
  )
  RETURNING * INTO v_closeout;

  UPDATE public.sales
  SET closeout_id = v_closeout.id
  WHERE store_id = p_store_id
    AND cashier_id = auth.uid()
    AND closeout_id IS NULL
    AND created_at >= v_period_start
    AND created_at <= p_period_end;

  PERFORM public.log_audit_event(
    p_store_id,
    'cashier.closeout',
    'cashier_closeout',
    v_closeout.id,
    jsonb_build_object(
      'cashSales', v_cash_sales,
      'cashRefunds', v_cash_refunds,
      'expectedCash', v_expected,
      'countedCash', p_counted_cash,
      'variance', v_closeout.variance
    )
  );

  RETURN v_closeout;
END;
$$;

-- 6. RLS for new operational tables.
ALTER TABLE public.cashier_closeouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cashier_closeouts: scoped read" ON public.cashier_closeouts;
CREATE POLICY "cashier_closeouts: scoped read" ON public.cashier_closeouts
FOR SELECT TO authenticated
USING (
  public.user_belongs_to_store(store_id)
  AND (cashier_id = auth.uid() OR public.current_user_role()::text = 'admin')
);

DROP POLICY IF EXISTS "sale_payments: scoped read" ON public.sale_payments;
CREATE POLICY "sale_payments: scoped read" ON public.sale_payments
FOR SELECT TO authenticated
USING (public.user_belongs_to_store(store_id));

DROP POLICY IF EXISTS "receipts: scoped read" ON public.receipts;
CREATE POLICY "receipts: scoped read" ON public.receipts
FOR SELECT TO authenticated
USING (public.user_belongs_to_store(store_id));

DROP POLICY IF EXISTS "sale_events: scoped read" ON public.sale_events;
CREATE POLICY "sale_events: scoped read" ON public.sale_events
FOR SELECT TO authenticated
USING (public.user_belongs_to_store(store_id));

DROP POLICY IF EXISTS "sale_returns: scoped read" ON public.sale_returns;
CREATE POLICY "sale_returns: scoped read" ON public.sale_returns
FOR SELECT TO authenticated
USING (public.user_belongs_to_store(store_id));

DROP POLICY IF EXISTS "sale_return_items: scoped read" ON public.sale_return_items;
CREATE POLICY "sale_return_items: scoped read" ON public.sale_return_items
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.sale_returns sr
    WHERE sr.id = sale_return_items.return_id
      AND public.user_belongs_to_store(sr.store_id)
  )
);

DROP POLICY IF EXISTS "audit_logs: scoped read" ON public.audit_logs;
CREATE POLICY "audit_logs: scoped read" ON public.audit_logs
FOR SELECT TO authenticated
USING (
  actor_id = auth.uid()
  OR (
    store_id IS NOT NULL
    AND public.user_belongs_to_store(store_id)
    AND public.current_user_role()::text = 'admin'
  )
  OR public.current_user_role()::text = 'super_admin'
);

DROP POLICY IF EXISTS "error_logs: scoped read" ON public.error_logs;
CREATE POLICY "error_logs: scoped read" ON public.error_logs
FOR SELECT TO authenticated
USING (
  actor_id = auth.uid()
  OR (
    store_id IS NOT NULL
    AND public.user_belongs_to_store(store_id)
    AND public.current_user_role()::text = 'admin'
  )
  OR public.current_user_role()::text = 'super_admin'
);

DROP POLICY IF EXISTS "error_logs: own insert" ON public.error_logs;
CREATE POLICY "error_logs: own insert" ON public.error_logs
FOR INSERT TO authenticated
WITH CHECK (
  actor_id = auth.uid()
  AND (store_id IS NULL OR public.user_belongs_to_store(store_id))
);

-- Analytics should not count voided sales as revenue.
CREATE OR REPLACE VIEW public.v_daily_sales_summary AS
SELECT
  date_trunc('day', s.created_at)::date AS sale_date,
  COUNT(*) AS transactions,
  COALESCE(SUM(s.total), 0) AS revenue,
  COALESCE(SUM(s.total - line_cost.total_cost), 0) AS gross_profit,
  round(COALESCE(SUM(s.total), 0) / NULLIF(COUNT(*), 0), 2) AS avg_order_value
FROM public.sales s
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(si.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cost
  FROM public.sale_items si
  LEFT JOIN public.products p ON p.id = si.product_id
  WHERE si.sale_id = s.id
) line_cost ON true
WHERE s.status <> 'voided'
GROUP BY date_trunc('day', s.created_at)::date;

CREATE OR REPLACE VIEW public.v_category_sales AS
SELECT
  c.id AS category_id,
  c.name AS category,
  COALESCE(SUM(si.line_total), 0) AS revenue,
  round(
    100.0 * COALESCE(SUM(si.line_total), 0) /
    NULLIF(SUM(SUM(si.line_total)) OVER (), 0),
    1
  ) AS percentage
FROM public.sale_items si
JOIN public.sales s ON s.id = si.sale_id
JOIN public.products p ON p.id = si.product_id
JOIN public.categories c ON c.id = p.category_id
WHERE s.status <> 'voided'
GROUP BY c.id, c.name;

CREATE OR REPLACE VIEW public.v_product_rankings AS
SELECT
  rank() OVER (ORDER BY SUM(si.line_total) DESC) AS rank,
  p.id AS product_id,
  p.name AS product_name,
  c.name AS category_name,
  SUM(si.quantity) AS units_sold,
  SUM(si.line_total) AS revenue,
  round(
    100.0 * SUM(si.line_total) /
    NULLIF(SUM(SUM(si.line_total)) OVER (), 0),
    1
  ) AS percentage_of_total
FROM public.sale_items si
JOIN public.sales s ON s.id = si.sale_id
JOIN public.products p ON p.id = si.product_id
JOIN public.categories c ON c.id = p.category_id
WHERE s.status <> 'voided'
GROUP BY p.id, p.name, c.name;

-- 7. Privileges. Direct writes stay constrained by RLS; lifecycle changes go through RPCs.
REVOKE ALL ON FUNCTION public.generate_receipt_number(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_audit_event(uuid, text, text, uuid, jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.log_client_error(text, text, text, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_client_error(text, text, text, jsonb, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.process_pos_sale_v2(uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, jsonb, public.payment_method, text, text, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_pos_sale_v2(uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, jsonb, public.payment_method, text, text, numeric, numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.process_pos_sale(uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_pos_sale(uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.void_pos_sale(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_pos_sale(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.refund_pos_sale(uuid, numeric, public.payment_method, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refund_pos_sale(uuid, numeric, public.payment_method, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.return_sale_items(uuid, jsonb, text, public.payment_method, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.return_sale_items(uuid, jsonb, text, public.payment_method, text) TO authenticated;

REVOKE ALL ON FUNCTION public.close_cashier_shift(uuid, numeric, numeric, text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_cashier_shift(uuid, numeric, numeric, text, timestamptz, timestamptz) TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
