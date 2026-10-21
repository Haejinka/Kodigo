-- Run as the database owner against a migrated test/linked database.
-- All fixtures and checkout effects are rolled back; existing sales are untouched.
BEGIN;
DO $test$
DECLARE
  v_user uuid;
  v_store uuid := gen_random_uuid();
  v_category uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_id uuid;
  v_sale public.sales%ROWTYPE;
  v_line public.sale_items%ROWTYPE;
  v_receipt jsonb;
  v_case record;
  v_stock numeric;
  v_before numeric;
  v_count integer;
  v_error text;
BEGIN
  SELECT id INTO STRICT v_user FROM public.profiles WHERE role::text = 'admin' LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  INSERT INTO public.stores(id, name, owner_id, tax_rate, vat_status)
  VALUES(v_store, 'Snapshot regression fixture', v_user, 0, 'non_vat');
  INSERT INTO public.store_users(store_id, profile_id) VALUES(v_store, v_user);
  INSERT INTO public.categories(id, store_id, owner_id, name)
  VALUES(v_category, v_store, v_user, 'Snapshot regression ' || v_category);
  INSERT INTO public.products(id, store_id, category_id, name, sku, unit, cost_price, selling_price, current_stock)
  VALUES(v_product, v_store, v_category, 'Snapshot regression', v_product::text, 'piece', 40, 95, 50);

  FOR v_case IN SELECT * FROM (VALUES
    (1, 0::numeric, 0::numeric, 'non_vat'::text, 'cash'::public.payment_method),
    (2, 5::numeric, 0::numeric, 'non_vat'::text, 'cash'::public.payment_method),
    (1, 95::numeric, 0::numeric, 'non_vat'::text, 'cash'::public.payment_method),
    (2, 5::numeric, 12::numeric, 'vat'::text, 'gcash'::public.payment_method)
  ) AS cases(qty, discount_per_unit, rate, vat_status, method)
  LOOP
    UPDATE public.stores SET tax_rate = v_case.rate, vat_status = v_case.vat_status WHERE id = v_store;
    SELECT current_stock INTO v_before FROM public.products WHERE id = v_product;
    v_id := gen_random_uuid();
    v_sale := public.process_pos_sale_v4(
      p_id => v_id, p_store_id => v_store, p_cashier_id => v_user,
      p_subtotal => 95 * v_case.qty,
      p_tax => CASE WHEN v_case.rate > 0 THEN round((95 - v_case.discount_per_unit) * v_case.qty * v_case.rate / (100 + v_case.rate), 2) ELSE 0 END,
      p_discount => v_case.discount_per_unit * v_case.qty,
      p_total => (95 - v_case.discount_per_unit) * v_case.qty,
      p_cash_received => 200,
      p_change => CASE WHEN v_case.method = 'cash' THEN 200 - (95 - v_case.discount_per_unit) * v_case.qty ELSE 0 END,
      p_items => jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', v_case.qty, 'itemDiscountPerUnit', v_case.discount_per_unit)),
      p_payment_method => v_case.method, p_tax_rate => v_case.rate
    );
    SELECT * INTO STRICT v_line FROM public.sale_items WHERE sale_id = v_id;
    IF v_line.unit_price <> 95 - v_case.discount_per_unit
      OR v_line.final_selling_price <> v_line.unit_price
      OR v_line.item_discount_amount <> v_case.discount_per_unit * v_case.qty
      OR v_line.line_total <> v_sale.total
      OR v_line.cogs <> 40 * v_case.qty
      OR v_line.gross_profit <> v_line.line_total - v_line.cogs
      OR v_line.gross_margin <> (CASE WHEN v_line.line_total > 0 THEN round((v_line.line_total - v_line.cogs) / v_line.line_total, 6) ELSE 0 END) THEN
      RAISE EXCEPTION 'Incorrect immutable price/cost/margin snapshot';
    END IF;
    SELECT payload INTO STRICT v_receipt FROM public.receipts WHERE sale_id = v_id;
    IF (v_receipt #>> '{items,0,line_total}')::numeric <> v_line.line_total
      OR (v_receipt #>> '{items,0,item_discount_amount}')::numeric <> v_line.item_discount_amount THEN
      RAISE EXCEPTION 'Receipt did not capture final item values';
    END IF;
    SELECT current_stock INTO v_stock FROM public.products WHERE id = v_product;
    IF v_stock <> v_before - v_case.qty THEN RAISE EXCEPTION 'Wrong stock deduction'; END IF;
    IF (SELECT SUM(quantity_base_units) FROM public.sale_item_stock_allocations WHERE sale_item_id = v_line.id) <> v_case.qty THEN
      RAISE EXCEPTION 'Wrong stock allocation';
    END IF;
    -- Retry must return the same result without another stock deduction or receipt.
    PERFORM public.process_pos_sale_v4(
      v_id, v_store, v_user, 0, 0, 0, 0, 0, 0,
      jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 1))
    );
    IF (SELECT current_stock FROM public.products WHERE id = v_product) <> v_stock
      OR (SELECT count(*) FROM public.receipts WHERE sale_id = v_id) <> 1
      OR (SELECT count(*) FROM public.sale_payments WHERE sale_id = v_id) <> 1 THEN
      RAISE EXCEPTION 'Retry duplicated sale effects';
    END IF;
    BEGIN
      UPDATE public.sale_items SET line_total = 1 WHERE id = v_line.id;
      RAISE EXCEPTION 'Snapshot update unexpectedly allowed';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
      IF v_error <> 'Completed sale item snapshots are immutable' THEN RAISE; END IF;
    END;
  END LOOP;

  SELECT current_stock INTO v_before FROM public.products WHERE id = v_product;
  SELECT count(*) INTO v_count FROM public.sales WHERE store_id = v_store;
  FOR v_case IN SELECT * FROM (VALUES
    (jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 1, 'itemDiscountPerUnit', -1)), 'discount'),
    (jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 1, 'itemDiscountPerUnit', 96)), 'discount'),
    (jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 1, 'itemDiscountPerUnit', 0.001)), 'discount'),
    (jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 1, 'itemDiscountPerUnit', 5)), 'total'),
    (jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 1), jsonb_build_object('productId', v_product, 'quantity', 1)), 'once'),
    (jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 1000)), 'stock')
  ) AS cases(items, expected)
  LOOP
    v_id := gen_random_uuid();
    BEGIN
      PERFORM public.process_pos_sale_v4(v_id, v_store, v_user, 95, 0, 0, 95, 100, 5, v_case.items);
      RAISE EXCEPTION 'Invalid input unexpectedly accepted';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
      IF position(v_case.expected in lower(v_error)) = 0 THEN RAISE; END IF;
    END;
    IF (SELECT current_stock FROM public.products WHERE id = v_product) <> v_before
      OR (SELECT count(*) FROM public.sales WHERE store_id = v_store) <> v_count THEN
      RAISE EXCEPTION 'Failed checkout left partial changes';
    END IF;
  END LOOP;
END;
$test$;
ROLLBACK;
SELECT 'PASS: checkout snapshots, discounts, VAT, retries, immutability, and rollback' AS result;
