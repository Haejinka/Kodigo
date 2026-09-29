-- Treat displayed VAT-registered selling prices as VAT-inclusive.
-- The configured VAT portion is extracted from the gross amount; it is never added on top.

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
  v_role text;
  v_item jsonb;
  v_product public.products%ROWTYPE;
  v_option public.product_selling_options%ROWTYPE;
  v_product_id uuid;
  v_option_id uuid;
  v_qty integer;
  v_multiplier numeric;
  v_required_base numeric;
  v_unit_price numeric;
  v_line_total numeric;
  v_regular_unit_price numeric;
  v_regular_value numeric;
  v_bulk_discount_type text;
  v_bulk_discount_value numeric;
  v_bulk_discount_amount numeric;
  v_category_name text;
  v_option_label text;
  v_unit_label text;
  v_package_size numeric;
  v_package_unit text;
  v_purchase_mode text;
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

  SELECT role::text INTO v_role
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_role NOT IN ('admin', 'cashier') THEN
    RAISE EXCEPTION 'Only store admins or cashiers can process sales';
  END IF;

  IF NOT public.user_belongs_to_store(p_store_id) THEN
    RAISE EXCEPTION 'User is not assigned to this store';
  END IF;

  IF COALESCE(p_discount_category, 'regular') NOT IN ('regular', 'senior', 'pwd', 'other') THEN
    RAISE EXCEPTION 'Invalid discount category';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Sale must contain at least one item';
  END IF;

  -- Lock each product once and reserve the combined base-unit requirement so
  -- two purchase modes for the same product cannot oversell one another.
  FOR v_product_id IN
    SELECT DISTINCT (line.value->>'productId')::uuid
    FROM jsonb_array_elements(p_items) AS line(value)
    ORDER BY 1
  LOOP
    SELECT * INTO v_product
    FROM public.products
    WHERE id = v_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % does not exist', v_product_id;
    END IF;
    IF v_product.store_id <> p_store_id THEN
      RAISE EXCEPTION 'Product % does not belong to sale store %', v_product_id, p_store_id;
    END IF;

    SELECT COALESCE(SUM(
      (line.value->>'quantity')::numeric * CASE
        WHEN COALESCE(opt.is_bulk, false)
          THEN GREATEST(COALESCE(opt.inventory_multiplier, opt.quantity_value, 1), 2)
        ELSE 1
      END
    ), 0)
    INTO v_required_base
    FROM jsonb_array_elements(p_items) AS line(value)
    LEFT JOIN public.product_selling_options opt
      ON opt.id = NULLIF(line.value->>'sellingOptionId', '')::uuid
    WHERE (line.value->>'productId')::uuid = v_product_id;

    IF v_required_base <= 0 THEN
      RAISE EXCEPTION 'Sale item quantity must be greater than zero';
    END IF;
    IF v_product.current_stock < v_required_base THEN
      RAISE EXCEPTION 'Insufficient base stock for %. Available base units %, required base units %',
        v_product.name, v_product.current_stock, v_required_base;
    END IF;
  END LOOP;

  -- Validate every option and calculate the subtotal from server-side prices.
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

    SELECT * INTO v_product
    FROM public.products
    WHERE id = v_product_id;

    v_option := NULL;
    v_multiplier := 1;
    v_purchase_mode := 'unit';
    v_unit_price := v_product.selling_price;

    IF v_option_id IS NOT NULL THEN
      SELECT * INTO v_option
      FROM public.product_selling_options
      WHERE id = v_option_id
      FOR UPDATE;

      IF NOT FOUND
        OR v_option.product_id <> v_product_id
        OR v_option.store_id <> p_store_id THEN
        RAISE EXCEPTION 'Selling option % does not belong to sale product/store', v_option_id;
      END IF;
      IF NOT v_option.is_active THEN
        RAISE EXCEPTION 'Selling option % is disabled', v_option.label;
      END IF;

      IF v_option.is_bulk THEN
        IF NOT v_product.bulk_purchase_enabled THEN
          RAISE EXCEPTION 'Bulk purchasing is disabled for %', v_product.name;
        END IF;

        v_purchase_mode := 'bulk';
        v_multiplier := GREATEST(COALESCE(v_option.inventory_multiplier, v_option.quantity_value, 1), 2);
        v_bulk_discount_type := COALESCE(NULLIF(v_option.discount_type, ''), 'percent');
        v_bulk_discount_value := GREATEST(COALESCE(v_option.discount_value, 0), 0);
        v_regular_unit_price := v_product.selling_price;
        v_regular_value := round(v_regular_unit_price * v_multiplier, 2);

        IF v_bulk_discount_type = 'percent' THEN
          IF v_bulk_discount_value > 100 THEN
            RAISE EXCEPTION 'Bulk percentage discount cannot exceed 100';
          END IF;
          v_unit_price := round(
            v_regular_value * (1 - v_bulk_discount_value / 100),
            2
          );
        ELSE
          v_unit_price := round(
            GREATEST(v_regular_value - v_bulk_discount_value, 0),
            2
          );
        END IF;
      ELSE
        v_regular_unit_price := v_product.selling_price;
        v_regular_value := v_regular_unit_price;
        v_bulk_discount_type := NULL;
        v_bulk_discount_value := NULL;
        v_unit_price := v_product.selling_price;
      END IF;
    ELSE
      v_regular_unit_price := v_product.selling_price;
      v_regular_value := v_regular_unit_price;
      v_bulk_discount_type := NULL;
      v_bulk_discount_value := NULL;
    END IF;

    v_line_total := round(v_unit_price * v_qty, 2);
    v_subtotal := v_subtotal + v_line_total;
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

  SELECT CASE
    WHEN COALESCE(p_discount_category, 'regular') IN ('senior', 'pwd') THEN 0
    WHEN COALESCE(vat_status, 'non_vat') <> 'vat' THEN 0
    ELSE COALESCE(p_tax_rate, tax_rate, 0)
  END
  INTO v_tax_rate
  FROM public.stores
  WHERE id = p_store_id;

  IF v_tax_rate IS NULL OR v_tax_rate < 0 OR v_tax_rate > 100 THEN
    RAISE EXCEPTION 'Tax rate must be between 0 and 100';
  END IF;

  v_tax := CASE
    WHEN v_tax_rate > 0 THEN round((v_subtotal - v_discount) * v_tax_rate / (100 + v_tax_rate), 2)
    ELSE 0
  END;
  v_total := round(v_subtotal - v_discount, 2);

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
    receipt_number,
    customer_name,
    customer_tin,
    customer_address,
    terminal_identifier,
    discount_category
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
    v_receipt_number,
    NULLIF(trim(COALESCE(p_customer_name, '')), ''),
    NULLIF(trim(COALESCE(p_customer_tin, '')), ''),
    NULLIF(trim(COALESCE(p_customer_address, '')), ''),
    NULLIF(trim(COALESCE(p_terminal_identifier, '')), ''),
    COALESCE(p_discount_category, 'regular')
  )
  RETURNING * INTO v_sale;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS line(value)
  LOOP
    v_product_id := (v_item->>'productId')::uuid;
    v_option_id := NULLIF(v_item->>'sellingOptionId', '')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    v_option := NULL;
    v_multiplier := 1;
    v_purchase_mode := 'unit';
    v_unit_price := NULL;
    v_regular_unit_price := v_product.selling_price;
    v_regular_value := NULL;
    v_bulk_discount_type := NULL;
    v_bulk_discount_value := NULL;
    v_bulk_discount_amount := NULL;
    v_option_label := NULL;
    v_unit_label := NULL;
    v_package_size := NULL;
    v_package_unit := NULL;

    SELECT * INTO v_product
    FROM public.products
    WHERE id = v_product_id;

    SELECT c.name INTO v_category_name
    FROM public.categories c
    WHERE c.id = v_product.category_id;

    IF v_option_id IS NOT NULL THEN
      SELECT * INTO v_option
      FROM public.product_selling_options
      WHERE id = v_option_id;

      v_option_label := v_option.label;
      v_unit_label := COALESCE(v_product.unit, v_option.unit_label, 'unit');

      IF v_option.is_bulk THEN
        v_purchase_mode := 'bulk';
        v_multiplier := GREATEST(COALESCE(v_option.inventory_multiplier, v_option.quantity_value, 1), 2);
        v_regular_unit_price := v_product.selling_price;
        v_regular_value := round(v_regular_unit_price * v_qty * v_multiplier, 2);
        v_bulk_discount_type := COALESCE(NULLIF(v_option.discount_type, ''), 'percent');
        v_bulk_discount_value := GREATEST(COALESCE(v_option.discount_value, 0), 0);
        IF v_bulk_discount_type = 'percent' THEN
          v_unit_price := round(
            round(v_regular_unit_price * v_multiplier, 2)
            * (1 - v_bulk_discount_value / 100),
            2
          );
        ELSE
          v_unit_price := round(
            GREATEST(round(v_regular_unit_price * v_multiplier, 2) - v_bulk_discount_value, 0),
            2
          );
        END IF;
        v_bulk_discount_amount := GREATEST(v_regular_value - round(v_unit_price * v_qty, 2), 0);
        v_package_size := v_multiplier;
        v_package_unit := COALESCE(v_product.unit, 'unit');
      ELSE
        v_unit_price := v_product.selling_price;
        v_regular_unit_price := v_product.selling_price;
        v_regular_value := round(v_regular_unit_price * v_qty, 2);
      END IF;
    ELSE
      v_option_label := COALESCE(v_product.unit, 'unit');
      v_unit_label := COALESCE(v_product.unit, 'unit');
      v_unit_price := v_product.selling_price;
      v_regular_unit_price := v_product.selling_price;
      v_regular_value := round(v_regular_unit_price * v_qty, 2);
    END IF;

    v_line_total := round(v_unit_price * v_qty, 2);

    INSERT INTO public.sale_items (
      sale_id,
      product_id,
      product_name,
      category_id,
      category_name,
      selling_option_id,
      selling_option_label,
      unit_label,
      package_size,
      package_unit,
      stock_source,
      quantity,
      unit_price,
      cost_price,
      line_total,
      purchase_mode,
      bulk_option_id,
      bulk_option_label,
      bulk_quantity,
      units_per_package,
      base_unit_quantity,
      regular_unit_price,
      regular_value,
      bulk_discount_type,
      bulk_discount_value,
      bulk_discount_amount,
      final_selling_price
    )
    VALUES (
      v_sale.id,
      v_product.id,
      v_product.name,
      v_product.category_id,
      COALESCE(v_category_name, 'Uncategorized'),
      v_option_id,
      COALESCE(v_option_label, v_item->>'sellingOptionLabel', v_unit_label, 'unit'),
      COALESCE(v_unit_label, v_item->>'unitLabel', 'unit'),
      v_package_size,
      v_package_unit,
      'product',
      v_qty,
      v_unit_price,
      v_product.cost_price * v_multiplier,
      v_line_total,
      v_purchase_mode,
      CASE WHEN v_purchase_mode = 'bulk' THEN v_option_id ELSE NULL END,
      CASE WHEN v_purchase_mode = 'bulk' THEN v_option_label ELSE NULL END,
      CASE WHEN v_purchase_mode = 'bulk' THEN v_qty ELSE NULL END,
      v_multiplier,
      v_qty * v_multiplier,
      v_regular_unit_price,
      v_regular_value,
      v_bulk_discount_type,
      v_bulk_discount_value,
      v_bulk_discount_amount,
      v_unit_price
    );
  END LOOP;

  INSERT INTO public.sale_payments (
    sale_id, store_id, method, status, amount, amount_tendered,
    change_amount, reference_number, created_by
  )
  VALUES (
    v_sale.id, p_store_id, p_payment_method, 'captured', v_total,
    v_tendered, v_change, p_payment_reference, auth.uid()
  );

  INSERT INTO public.receipts(sale_id, store_id, receipt_number, issued_by, payload)
  VALUES (
    v_sale.id,
    p_store_id,
    v_receipt_number,
    auth.uid(),
    private.build_receipt_snapshot(v_sale.id)
  );

  INSERT INTO public.sale_events(sale_id, store_id, event_type, amount, actor_id, metadata)
  VALUES (
    v_sale.id,
    p_store_id,
    'completed',
    v_total,
    auth.uid(),
    jsonb_build_object('receiptNumber', v_receipt_number)
  );

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

REVOKE ALL ON FUNCTION public.process_pos_sale_v3(
  uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, jsonb,
  public.payment_method, text, text, numeric, numeric, text, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_pos_sale_v3(
  uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, jsonb,
  public.payment_method, text, text, numeric, numeric, text, text, text, text, text
) TO authenticated;


