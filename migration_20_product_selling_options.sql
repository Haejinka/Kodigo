-- Migration 20: product selling options with separate stock and pricing

-- Allow explicit inventory conversion entries after this migration is applied.
DO $$
BEGIN
  ALTER TYPE public.adjustment_reason ADD VALUE IF NOT EXISTS 'conversion';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.product_selling_options (
  id                  uuid primary key default gen_random_uuid(),
  store_id            uuid not null references public.stores (id) on delete cascade,
  product_id          uuid not null references public.products (id) on delete cascade,
  kind                text not null default 'unit'
                        check (kind in ('unit', 'kilo', 'sack', 'custom')),
  label               text not null,
  unit_label          text not null,
  quantity_value      numeric(12,3) check (quantity_value is null or quantity_value > 0),
  quantity_unit       text,
  stock_quantity      numeric(12,3) not null default 0 check (stock_quantity >= 0),
  selling_price       numeric(10,2) not null default 0 check (selling_price >= 0),
  low_stock_threshold numeric(12,3) not null default 0 check (low_stock_threshold >= 0),
  is_default          boolean not null default false,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint product_selling_options_label_nonempty check (length(trim(label)) > 0),
  constraint product_selling_options_unit_nonempty check (length(trim(unit_label)) > 0)
);

CREATE INDEX IF NOT EXISTS product_selling_options_store_idx
  ON public.product_selling_options (store_id);

CREATE INDEX IF NOT EXISTS product_selling_options_product_idx
  ON public.product_selling_options (product_id);

CREATE UNIQUE INDEX IF NOT EXISTS product_selling_options_one_default_idx
  ON public.product_selling_options (product_id)
  WHERE is_default AND is_active;

CREATE UNIQUE INDEX IF NOT EXISTS product_selling_options_product_label_idx
  ON public.product_selling_options (product_id, lower(label))
  WHERE is_active;

CREATE OR REPLACE FUNCTION public.trg_product_selling_options_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_selling_options_updated_at ON public.product_selling_options;
CREATE TRIGGER trg_product_selling_options_updated_at
  BEFORE UPDATE ON public.product_selling_options
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_product_selling_options_updated_at();

INSERT INTO public.product_selling_options (
  store_id,
  product_id,
  kind,
  label,
  unit_label,
  quantity_value,
  quantity_unit,
  stock_quantity,
  selling_price,
  low_stock_threshold,
  is_default,
  is_active
)
SELECT
  p.store_id,
  p.id,
  CASE WHEN lower(COALESCE(p.unit, 'unit')) IN ('kg', 'kilo', 'kilogram') THEN 'kilo' ELSE 'unit' END,
  COALESCE(NULLIF(p.unit, ''), 'unit'),
  COALESCE(NULLIF(p.unit, ''), 'unit'),
  CASE WHEN lower(COALESCE(p.unit, 'unit')) IN ('kg', 'kilo', 'kilogram') THEN 1 ELSE NULL END,
  CASE WHEN lower(COALESCE(p.unit, 'unit')) IN ('kg', 'kilo', 'kilogram') THEN 'kg' ELSE NULL END,
  p.current_stock::numeric,
  p.selling_price,
  p.min_stock_level::numeric,
  true,
  true
FROM public.products p
WHERE NOT EXISTS (
  SELECT 1
  FROM public.product_selling_options pso
  WHERE pso.product_id = p.id
);

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS selling_option_id uuid references public.product_selling_options (id) on delete set null,
  ADD COLUMN IF NOT EXISTS selling_option_label text,
  ADD COLUMN IF NOT EXISTS unit_label text,
  ADD COLUMN IF NOT EXISTS package_size numeric(12,3),
  ADD COLUMN IF NOT EXISTS package_unit text,
  ADD COLUMN IF NOT EXISTS stock_source text;

UPDATE public.sale_items si
SET
  selling_option_label = COALESCE(si.selling_option_label, p.unit, 'unit'),
  unit_label = COALESCE(si.unit_label, p.unit, 'unit'),
  stock_source = COALESCE(si.stock_source, 'product')
FROM public.products p
WHERE p.id = si.product_id
  AND (si.unit_label IS NULL OR si.selling_option_label IS NULL OR si.stock_source IS NULL);

ALTER TABLE public.sale_items
  ALTER COLUMN unit_label SET DEFAULT 'unit',
  ALTER COLUMN unit_label SET NOT NULL,
  ALTER COLUMN stock_source SET DEFAULT 'product',
  ALTER COLUMN stock_source SET NOT NULL;

CREATE INDEX IF NOT EXISTS sale_items_selling_option_idx
  ON public.sale_items (selling_option_id);

ALTER TABLE public.stock_adjustments DROP CONSTRAINT IF EXISTS stock_adjustments_quantity_delta_check;
ALTER TABLE public.stock_adjustments DROP CONSTRAINT IF EXISTS stock_adjustments_stock_before_check;
ALTER TABLE public.stock_adjustments DROP CONSTRAINT IF EXISTS stock_adjustments_stock_after_check;

ALTER TABLE public.stock_adjustments
  ALTER COLUMN quantity_delta TYPE numeric(12,3) USING quantity_delta::numeric,
  ALTER COLUMN stock_before TYPE numeric(12,3) USING stock_before::numeric,
  ALTER COLUMN stock_after TYPE numeric(12,3) USING stock_after::numeric,
  ADD COLUMN IF NOT EXISTS selling_option_id uuid references public.product_selling_options (id) on delete set null,
  ADD COLUMN IF NOT EXISTS selling_option_label text,
  ADD COLUMN IF NOT EXISTS unit_label text,
  ADD COLUMN IF NOT EXISTS package_size numeric(12,3),
  ADD COLUMN IF NOT EXISTS package_unit text,
  ADD COLUMN IF NOT EXISTS stock_source text;

ALTER TABLE public.stock_adjustments
  ADD CONSTRAINT stock_adjustments_quantity_delta_check check (quantity_delta <> 0),
  ADD CONSTRAINT stock_adjustments_stock_before_check check (stock_before >= 0),
  ADD CONSTRAINT stock_adjustments_stock_after_check check (stock_after >= 0);

UPDATE public.stock_adjustments sa
SET
  unit_label = COALESCE(sa.unit_label, p.unit, 'unit'),
  stock_source = COALESCE(sa.stock_source, 'product')
FROM public.products p
WHERE p.id = sa.product_id
  AND (sa.unit_label IS NULL OR sa.stock_source IS NULL);

CREATE INDEX IF NOT EXISTS stock_adjustments_selling_option_idx
  ON public.stock_adjustments (selling_option_id);

ALTER TABLE public.stock_alerts
  ADD COLUMN IF NOT EXISTS selling_option_id uuid references public.product_selling_options (id) on delete set null,
  ADD COLUMN IF NOT EXISTS selling_option_label text,
  ADD COLUMN IF NOT EXISTS unit_label text,
  ADD COLUMN IF NOT EXISTS package_size numeric(12,3),
  ADD COLUMN IF NOT EXISTS package_unit text;

CREATE INDEX IF NOT EXISTS stock_alerts_selling_option_idx
  ON public.stock_alerts (selling_option_id);

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id                    uuid primary key default gen_random_uuid(),
  store_id              uuid not null references public.stores (id) on delete cascade,
  product_id            uuid references public.products (id) on delete set null,
  product_name          text not null,
  selling_option_id     uuid references public.product_selling_options (id) on delete set null,
  selling_option_label  text,
  unit_label            text not null,
  package_size          numeric(12,3),
  package_unit          text,
  movement_type         text not null,
  quantity_delta        numeric(12,3) not null check (quantity_delta <> 0),
  stock_before          numeric(12,3) not null check (stock_before >= 0),
  stock_after           numeric(12,3) not null check (stock_after >= 0),
  stock_source          text not null,
  reference_type        text,
  reference_id          uuid,
  note                  text not null default '',
  created_by            uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS inventory_movements_store_created_idx
  ON public.inventory_movements (store_id, created_at desc);

CREATE INDEX IF NOT EXISTS inventory_movements_product_option_idx
  ON public.inventory_movements (product_id, selling_option_id);

CREATE OR REPLACE FUNCTION public.trg_log_stock_adjustment_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_name text;
BEGIN
  SELECT name INTO v_product_name
  FROM public.products
  WHERE id = NEW.product_id;

  INSERT INTO public.inventory_movements(
    store_id,
    product_id,
    product_name,
    selling_option_id,
    selling_option_label,
    unit_label,
    package_size,
    package_unit,
    movement_type,
    quantity_delta,
    stock_before,
    stock_after,
    stock_source,
    reference_type,
    reference_id,
    note,
    created_by
  )
  VALUES (
    NEW.store_id,
    NEW.product_id,
    COALESCE(v_product_name, 'Unknown product'),
    NEW.selling_option_id,
    NEW.selling_option_label,
    COALESCE(NEW.unit_label, 'unit'),
    NEW.package_size,
    NEW.package_unit,
    CASE
      WHEN NEW.stock_source = 'conversion' AND NEW.quantity_delta < 0 THEN 'conversion_out'
      WHEN NEW.stock_source = 'conversion' AND NEW.quantity_delta > 0 THEN 'conversion_in'
      ELSE NEW.reason::text
    END,
    NEW.quantity_delta,
    NEW.stock_before,
    NEW.stock_after,
    COALESCE(NEW.stock_source, CASE WHEN NEW.selling_option_id IS NULL THEN 'product' ELSE 'selling_option' END),
    'stock_adjustment',
    NEW.id,
    COALESCE(NEW.note, ''),
    NEW.created_by
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS log_stock_adjustment_movement_trigger ON public.stock_adjustments;
CREATE TRIGGER log_stock_adjustment_movement_trigger
  AFTER INSERT ON public.stock_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_log_stock_adjustment_movement();

CREATE OR REPLACE FUNCTION public.trg_deduct_stock_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_store uuid;
  v_product public.products%ROWTYPE;
  v_option public.product_selling_options%ROWTYPE;
  v_before numeric;
  v_after numeric;
BEGIN
  IF NEW.product_id IS NULL THEN
    RAISE EXCEPTION 'Sale item must reference a product';
  END IF;

  SELECT store_id
  INTO v_sale_store
  FROM public.sales
  WHERE id = NEW.sale_id;

  IF v_sale_store IS NULL THEN
    RAISE EXCEPTION 'Sale % does not exist', NEW.sale_id;
  END IF;

  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = NEW.product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % does not exist', NEW.product_id;
  END IF;

  IF v_product.store_id <> v_sale_store THEN
    RAISE EXCEPTION 'Product % does not belong to sale store %', NEW.product_id, v_sale_store;
  END IF;

  IF NEW.selling_option_id IS NOT NULL THEN
    SELECT *
    INTO v_option
    FROM public.product_selling_options
    WHERE id = NEW.selling_option_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selling option % does not exist', NEW.selling_option_id;
    END IF;

    IF v_option.product_id <> NEW.product_id OR v_option.store_id <> v_sale_store THEN
      RAISE EXCEPTION 'Selling option % does not belong to sale product/store', NEW.selling_option_id;
    END IF;

    IF v_option.stock_quantity < NEW.quantity THEN
      RAISE EXCEPTION 'Insufficient stock for %. Available %, requested %',
        COALESCE(NEW.selling_option_label, v_option.label), v_option.stock_quantity, NEW.quantity;
    END IF;

    v_before := v_option.stock_quantity;
    v_after := v_before - NEW.quantity;

    UPDATE public.product_selling_options
    SET stock_quantity = v_after,
        updated_at = now()
    WHERE id = v_option.id;

    INSERT INTO public.inventory_movements(
      store_id, product_id, product_name, selling_option_id, selling_option_label,
      unit_label, package_size, package_unit, movement_type, quantity_delta,
      stock_before, stock_after, stock_source, reference_type, reference_id, note, created_by
    )
    VALUES (
      v_sale_store,
      NEW.product_id,
      NEW.product_name,
      NEW.selling_option_id,
      COALESCE(NEW.selling_option_label, v_option.label),
      COALESCE(NEW.unit_label, v_option.unit_label),
      COALESCE(NEW.package_size, v_option.quantity_value),
      COALESCE(NEW.package_unit, v_option.quantity_unit),
      'sale',
      -NEW.quantity,
      v_before,
      v_after,
      'selling_option',
      'sale',
      NEW.sale_id,
      'POS sale ' || NEW.sale_id::text,
      auth.uid()
    );
  ELSE
    IF v_product.current_stock < NEW.quantity THEN
      RAISE EXCEPTION 'Insufficient stock for product %. Available %, requested %',
        NEW.product_id, v_product.current_stock, NEW.quantity;
    END IF;

    v_before := v_product.current_stock;
    v_after := v_before - NEW.quantity;

    UPDATE public.products
    SET current_stock = v_after::integer,
        updated_at = now()
    WHERE id = NEW.product_id;

    INSERT INTO public.inventory_movements(
      store_id, product_id, product_name, unit_label, movement_type, quantity_delta,
      stock_before, stock_after, stock_source, reference_type, reference_id, note, created_by
    )
    VALUES (
      v_sale_store,
      NEW.product_id,
      NEW.product_name,
      COALESCE(NEW.unit_label, v_product.unit, 'unit'),
      'sale',
      -NEW.quantity,
      v_before,
      v_after,
      'product',
      'sale',
      NEW.sale_id,
      'POS sale ' || NEW.sale_id::text,
      auth.uid()
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deduct_stock_on_sale_trigger ON public.sale_items;
CREATE TRIGGER deduct_stock_on_sale_trigger
  AFTER INSERT ON public.sale_items
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_deduct_stock_on_sale();

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
  v_option public.product_selling_options%ROWTYPE;
  v_product_id uuid;
  v_option_id uuid;
  v_qty integer;
  v_unit_price numeric;
  v_option_label text;
  v_unit_label text;
  v_package_size numeric;
  v_package_unit text;
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

  FOR v_product_id, v_option_id, v_qty IN
    SELECT
      (value->>'productId')::uuid,
      NULLIF(value->>'sellingOptionId', '')::uuid,
      SUM((value->>'quantity')::integer)::integer
    FROM jsonb_array_elements(p_items) AS line(value)
    GROUP BY (value->>'productId')::uuid, NULLIF(value->>'sellingOptionId', '')::uuid
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

    IF v_option_id IS NOT NULL THEN
      SELECT *
      INTO v_option
      FROM public.product_selling_options
      WHERE id = v_option_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Selling option % does not exist', v_option_id;
      END IF;

      IF v_option.product_id <> v_product_id OR v_option.store_id <> p_store_id THEN
        RAISE EXCEPTION 'Selling option % does not belong to sale product/store', v_option_id;
      END IF;

      IF NOT v_option.is_active THEN
        RAISE EXCEPTION 'Selling option % is disabled', v_option.label;
      END IF;

      IF v_option.stock_quantity < v_qty THEN
        RAISE EXCEPTION 'Insufficient stock for %. Available %, requested %',
          v_option.label, v_option.stock_quantity, v_qty;
      END IF;

      v_subtotal := v_subtotal + round(v_option.selling_price * v_qty, 2);
    ELSE
      IF v_product.current_stock < v_qty THEN
        RAISE EXCEPTION 'Insufficient stock for %. Available %, requested %',
          v_product.name, v_product.current_stock, v_qty;
      END IF;

      v_subtotal := v_subtotal + round(v_product.selling_price * v_qty, 2);
    END IF;
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
    v_option_id := NULLIF(v_item->>'sellingOptionId', '')::uuid;
    v_qty := (v_item->>'quantity')::integer;

    SELECT *
    INTO v_product
    FROM public.products
    WHERE id = v_product_id;

    IF v_option_id IS NOT NULL THEN
      SELECT *
      INTO v_option
      FROM public.product_selling_options
      WHERE id = v_option_id;

      v_unit_price := v_option.selling_price;
      v_option_label := v_option.label;
      v_unit_label := v_option.unit_label;
      v_package_size := v_option.quantity_value;
      v_package_unit := v_option.quantity_unit;
    ELSE
      v_unit_price := v_product.selling_price;
      v_option_label := COALESCE(NULLIF(v_product.unit, ''), 'unit');
      v_unit_label := COALESCE(NULLIF(v_product.unit, ''), 'unit');
      v_package_size := NULL;
      v_package_unit := NULL;
    END IF;

    INSERT INTO public.sale_items (
      sale_id,
      product_id,
      product_name,
      selling_option_id,
      selling_option_label,
      unit_label,
      package_size,
      package_unit,
      stock_source,
      quantity,
      unit_price,
      line_total
    )
    VALUES (
      v_sale.id,
      v_product.id,
      v_product.name,
      v_option_id,
      COALESCE(v_option_label, v_item->>'sellingOptionLabel', v_unit_label),
      COALESCE(v_unit_label, v_item->>'unitLabel', 'unit'),
      v_package_size,
      v_package_unit,
      CASE WHEN v_option_id IS NULL THEN 'product' ELSE 'selling_option' END,
      v_qty,
      v_unit_price,
      round(v_unit_price * v_qty, 2)
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
      'items', (
        SELECT jsonb_agg(to_jsonb(si) ORDER BY si.product_name)
        FROM public.sale_items si
        WHERE si.sale_id = v_sale.id
      ),
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
  v_before numeric;
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
    SELECT
      product_id,
      selling_option_id,
      selling_option_label,
      unit_label,
      package_size,
      package_unit,
      quantity
    FROM public.sale_items
    WHERE sale_id = p_sale_id
      AND product_id IS NOT NULL
  LOOP
    IF v_item.selling_option_id IS NOT NULL THEN
      SELECT stock_quantity
      INTO v_before
      FROM public.product_selling_options
      WHERE id = v_item.selling_option_id
      FOR UPDATE;

      UPDATE public.product_selling_options
      SET stock_quantity = stock_quantity + v_item.quantity,
          updated_at = now()
      WHERE id = v_item.selling_option_id;
    ELSE
      SELECT current_stock
      INTO v_before
      FROM public.products
      WHERE id = v_item.product_id
      FOR UPDATE;

      UPDATE public.products
      SET current_stock = current_stock + v_item.quantity,
          updated_at = now()
      WHERE id = v_item.product_id;
    END IF;

    INSERT INTO public.stock_adjustments(
      store_id,
      product_id,
      selling_option_id,
      selling_option_label,
      unit_label,
      package_size,
      package_unit,
      stock_source,
      reason,
      quantity_delta,
      stock_before,
      stock_after,
      note,
      created_by
    )
    VALUES (
      v_sale.store_id,
      v_item.product_id,
      v_item.selling_option_id,
      v_item.selling_option_label,
      COALESCE(v_item.unit_label, 'unit'),
      v_item.package_size,
      v_item.package_unit,
      CASE WHEN v_item.selling_option_id IS NULL THEN 'product' ELSE 'selling_option' END,
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
  v_before numeric;
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
      IF v_sale_item.selling_option_id IS NOT NULL THEN
        SELECT stock_quantity
        INTO v_before
        FROM public.product_selling_options
        WHERE id = v_sale_item.selling_option_id
        FOR UPDATE;

        UPDATE public.product_selling_options
        SET stock_quantity = stock_quantity + v_qty,
            updated_at = now()
        WHERE id = v_sale_item.selling_option_id;
      ELSE
        SELECT current_stock
        INTO v_before
        FROM public.products
        WHERE id = v_sale_item.product_id
        FOR UPDATE;

        UPDATE public.products
        SET current_stock = current_stock + v_qty,
            updated_at = now()
        WHERE id = v_sale_item.product_id;
      END IF;

      INSERT INTO public.stock_adjustments(
        store_id,
        product_id,
        selling_option_id,
        selling_option_label,
        unit_label,
        package_size,
        package_unit,
        stock_source,
        reason,
        quantity_delta,
        stock_before,
        stock_after,
        note,
        created_by
      )
      VALUES (
        v_sale.store_id,
        v_sale_item.product_id,
        v_sale_item.selling_option_id,
        v_sale_item.selling_option_label,
        COALESCE(v_sale_item.unit_label, 'unit'),
        v_sale_item.package_size,
        v_sale_item.package_unit,
        CASE WHEN v_sale_item.selling_option_id IS NULL THEN 'product' ELSE 'selling_option' END,
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

  SELECT COALESCE(SUM(abs(amount)), 0)
  INTO v_refunded
  FROM public.sale_payments
  WHERE sale_id = p_sale_id
    AND status = 'refunded';

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
    p_sale_id, v_sale.store_id, p_refund_method, 'refunded', -round(v_refund_total, 2),
    round(v_refund_total, 2), 0, p_reference, auth.uid()
  );

  UPDATE public.sales
  SET status = CASE
    WHEN v_refunded + v_refund_total >= total - 0.01 THEN 'refunded'::public.sale_status
    ELSE 'partially_refunded'::public.sale_status
  END
  WHERE id = p_sale_id
  RETURNING * INTO v_sale;

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

CREATE OR REPLACE FUNCTION public.open_sack_to_kilo(
  p_sack_option_id uuid,
  p_kilo_option_id uuid,
  p_sack_quantity integer DEFAULT 1,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sack public.product_selling_options%ROWTYPE;
  v_kilo public.product_selling_options%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_sack_before numeric;
  v_sack_after numeric;
  v_kilo_before numeric;
  v_kilo_after numeric;
  v_kilo_delta numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_sack_quantity IS NULL OR p_sack_quantity <= 0 THEN
    RAISE EXCEPTION 'Sack quantity must be greater than zero';
  END IF;

  SELECT *
  INTO v_sack
  FROM public.product_selling_options
  WHERE id = p_sack_option_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sack selling option does not exist';
  END IF;

  SELECT *
  INTO v_kilo
  FROM public.product_selling_options
  WHERE id = p_kilo_option_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kilo selling option does not exist';
  END IF;

  IF v_sack.product_id <> v_kilo.product_id OR v_sack.store_id <> v_kilo.store_id THEN
    RAISE EXCEPTION 'Both selling options must belong to the same product and store';
  END IF;

  IF NOT public.user_belongs_to_store(v_sack.store_id) THEN
    RAISE EXCEPTION 'User is not assigned to this store';
  END IF;

  IF v_sack.kind <> 'sack' OR v_sack.quantity_value IS NULL THEN
    RAISE EXCEPTION 'Source option must be a sack with a configured quantity value';
  END IF;

  IF v_kilo.kind <> 'kilo' THEN
    RAISE EXCEPTION 'Destination option must be a kilo selling option';
  END IF;

  IF NOT v_sack.is_active OR NOT v_kilo.is_active THEN
    RAISE EXCEPTION 'Both selling options must be active';
  END IF;

  IF v_sack.stock_quantity < p_sack_quantity THEN
    RAISE EXCEPTION 'Insufficient sack stock. Available %, requested %',
      v_sack.stock_quantity, p_sack_quantity;
  END IF;

  SELECT *
  INTO v_product
  FROM public.products
  WHERE id = v_sack.product_id;

  v_kilo_delta := v_sack.quantity_value * p_sack_quantity;
  v_sack_before := v_sack.stock_quantity;
  v_sack_after := v_sack_before - p_sack_quantity;
  v_kilo_before := v_kilo.stock_quantity;
  v_kilo_after := v_kilo_before + v_kilo_delta;

  UPDATE public.product_selling_options
  SET stock_quantity = v_sack_after,
      updated_at = now()
  WHERE id = v_sack.id;

  UPDATE public.product_selling_options
  SET stock_quantity = v_kilo_after,
      updated_at = now()
  WHERE id = v_kilo.id;

  INSERT INTO public.stock_adjustments(
    store_id, product_id, selling_option_id, selling_option_label, unit_label,
    package_size, package_unit, stock_source, reason, quantity_delta, stock_before,
    stock_after, note, created_by
  )
  VALUES
  (
    v_sack.store_id,
    v_sack.product_id,
    v_sack.id,
    v_sack.label,
    v_sack.unit_label,
    v_sack.quantity_value,
    v_sack.quantity_unit,
    'conversion',
    'other',
    -p_sack_quantity,
    v_sack_before,
    v_sack_after,
    COALESCE(NULLIF(p_note, ''), 'Opened sack stock into kilo stock'),
    auth.uid()
  ),
  (
    v_kilo.store_id,
    v_kilo.product_id,
    v_kilo.id,
    v_kilo.label,
    v_kilo.unit_label,
    v_kilo.quantity_value,
    v_kilo.quantity_unit,
    'conversion',
    'other',
    v_kilo_delta,
    v_kilo_before,
    v_kilo_after,
    COALESCE(NULLIF(p_note, ''), 'Opened sack stock into kilo stock'),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'productId', v_sack.product_id,
    'sackOptionId', v_sack.id,
    'kiloOptionId', v_kilo.id,
    'sacksOpened', p_sack_quantity,
    'kiloQuantityAdded', v_kilo_delta,
    'sackStockAfter', v_sack_after,
    'kiloStockAfter', v_kilo_after
  );
END;
$$;

ALTER TABLE public.product_selling_options enable row level security;
ALTER TABLE public.inventory_movements enable row level security;

DROP POLICY IF EXISTS "product_selling_options: scoped read" ON public.product_selling_options;
CREATE POLICY "product_selling_options: scoped read" ON public.product_selling_options
FOR SELECT TO authenticated
USING (public.user_belongs_to_store(store_id));

DROP POLICY IF EXISTS "product_selling_options: scoped write" ON public.product_selling_options;
CREATE POLICY "product_selling_options: scoped write" ON public.product_selling_options
FOR ALL TO authenticated
USING (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role() IN ('admin', 'cashier')
)
WITH CHECK (
  public.user_belongs_to_store(store_id)
  AND public.current_user_role() IN ('admin', 'cashier')
);

DROP POLICY IF EXISTS "inventory_movements: scoped read" ON public.inventory_movements;
CREATE POLICY "inventory_movements: scoped read" ON public.inventory_movements
FOR SELECT TO authenticated
USING (public.user_belongs_to_store(store_id));

CREATE OR REPLACE VIEW public.v_sales_by_selling_option
WITH (security_invoker = true)
AS
SELECT
  s.store_id,
  si.product_id,
  si.product_name,
  si.selling_option_id,
  COALESCE(si.selling_option_label, si.unit_label, 'unit') AS selling_option_label,
  COALESCE(si.unit_label, 'unit') AS unit_label,
  si.package_size,
  si.package_unit,
  SUM(si.quantity) AS quantity_sold,
  SUM(si.line_total) AS revenue
FROM public.sale_items si
JOIN public.sales s ON s.id = si.sale_id
WHERE s.status <> 'voided'
GROUP BY
  s.store_id,
  si.product_id,
  si.product_name,
  si.selling_option_id,
  COALESCE(si.selling_option_label, si.unit_label, 'unit'),
  COALESCE(si.unit_label, 'unit'),
  si.package_size,
  si.package_unit;

CREATE OR REPLACE VIEW public.v_inventory_movements_by_option
WITH (security_invoker = true)
AS
SELECT
  store_id,
  product_id,
  product_name,
  selling_option_id,
  COALESCE(selling_option_label, unit_label, 'unit') AS selling_option_label,
  unit_label,
  package_size,
  package_unit,
  movement_type,
  SUM(quantity_delta) AS net_quantity_delta,
  COUNT(*) AS movement_count,
  MAX(created_at) AS last_movement_at
FROM public.inventory_movements
GROUP BY
  store_id,
  product_id,
  product_name,
  selling_option_id,
  COALESCE(selling_option_label, unit_label, 'unit'),
  unit_label,
  package_size,
  package_unit,
  movement_type;

GRANT SELECT, INSERT, UPDATE ON public.product_selling_options TO authenticated;
GRANT SELECT ON public.inventory_movements TO authenticated;
GRANT SELECT ON public.v_sales_by_selling_option TO authenticated;
GRANT SELECT ON public.v_inventory_movements_by_option TO authenticated;

REVOKE ALL ON FUNCTION public.open_sack_to_kilo(uuid, uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_sack_to_kilo(uuid, uuid, integer, text) TO authenticated;

REVOKE ALL ON FUNCTION public.process_pos_sale_v2(uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, jsonb, public.payment_method, text, text, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_pos_sale_v2(uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, jsonb, public.payment_method, text, text, numeric, numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.void_pos_sale(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_pos_sale(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.return_sale_items(uuid, jsonb, text, public.payment_method, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.return_sale_items(uuid, jsonb, text, public.payment_method, text) TO authenticated;
