-- All fixtures, sales and inventory effects are rolled back.
BEGIN;
DO $test$
DECLARE
  v_user uuid;
  v_store uuid := gen_random_uuid();
  v_store2 uuid := gen_random_uuid();
  v_category uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_product2 uuid := gen_random_uuid();
  v_base uuid := gen_random_uuid();
  v_case uuid := gen_random_uuid();
  v_pack uuid := gen_random_uuid();
  v_sale public.sales%ROWTYPE;
  v_code text := '00' || gen_random_uuid()::text;
  v_main text := '00' || gen_random_uuid()::text;
BEGIN
  SELECT id INTO STRICT v_user FROM public.profiles WHERE role::text = 'admin' LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  INSERT INTO public.stores(id, name, owner_id, tax_rate, vat_status)
  VALUES (v_store, 'Barcode regression fixture', v_user, 0, 'non_vat'),
    (v_store2, 'Barcode regression second store', v_user, 0, 'non_vat');
  INSERT INTO public.store_users(store_id, profile_id) VALUES (v_store, v_user), (v_store2, v_user);
  INSERT INTO public.categories(id, store_id, owner_id, name)
  VALUES (v_category, v_store, v_user, 'Barcode regression ' || v_category);
  INSERT INTO public.products(id, store_id, category_id, name, sku, barcode, unit, cost_price, selling_price, current_stock, bulk_purchase_enabled)
  VALUES (v_product, v_store, v_category, 'Barcode regression', v_product::text, v_main, 'piece', 50, 65, 36, true),
    (v_product2, v_store2, v_category, 'Barcode second store', v_product2::text, v_main, 'piece', 50, 65, 0, false);
  INSERT INTO public.product_selling_options(id, product_id, store_id, label, unit_label, selling_price, is_default, shares_base_stock)
  VALUES (v_base, v_product, v_store, 'piece', 'piece', 65, true, true);
  INSERT INTO public.product_selling_options(id, product_id, store_id, label, unit_label, selling_price, is_bulk, shares_base_stock, inventory_multiplier, quantity_value, pricing_method, manual_selling_price, discount_type, discount_value)
  VALUES (v_case, v_product, v_store, 'Case', 'piece', 680, true, true, 12, 12, 'fixed', 680, 'amount', 100),
    (v_pack, v_product, v_store, 'Pack', 'piece', 360, true, true, 6, 6, 'fixed', 360, 'amount', 30);

  -- Verify the real authenticated write path, including RLS and the private trigger.
  SET LOCAL ROLE authenticated;
  UPDATE public.product_selling_options SET barcode = v_code WHERE id = v_case;
  IF (SELECT barcode FROM public.product_selling_options WHERE id = v_case) IS DISTINCT FROM v_code THEN
    RAISE EXCEPTION 'Barcode did not persist';
  END IF;
  BEGIN
    UPDATE public.product_selling_options SET barcode = v_code WHERE id = v_pack;
    RAISE EXCEPTION 'Duplicate option barcode accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    UPDATE public.product_selling_options SET barcode = v_main WHERE id = v_pack;
    RAISE EXCEPTION 'Product/option collision accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    UPDATE public.products SET barcode = v_code WHERE id = v_product;
    RAISE EXCEPTION 'Option/product collision accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  UPDATE public.product_selling_options SET barcode = NULL WHERE id = v_case;
  UPDATE public.product_selling_options SET barcode = v_code WHERE id = v_pack;
  UPDATE public.product_selling_options SET is_active = false WHERE id = v_pack;
  UPDATE public.product_selling_options SET barcode = v_code WHERE id = v_case;
  BEGIN
    UPDATE public.product_selling_options SET is_active = true WHERE id = v_pack;
    RAISE EXCEPTION 'Reactivating a conflicting barcode accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  UPDATE public.product_selling_options SET barcode = NULL, is_active = true WHERE id = v_pack;

  v_sale := public.process_pos_sale_v4(
    p_id => gen_random_uuid(), p_store_id => v_store, p_cashier_id => v_user,
    p_subtotal => 680, p_tax => 0, p_discount => 0, p_total => 680,
    p_cash_received => 700, p_change => 20,
    p_items => jsonb_build_array(jsonb_build_object('productId', v_product, 'sellingOptionId', v_case, 'quantity', 1)),
    p_payment_method => 'cash', p_tax_rate => 0
  );
  IF (SELECT current_stock FROM public.products WHERE id = v_product) <> 24 THEN
    RAISE EXCEPTION 'Case sale did not deduct 12 pieces';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sale_items WHERE sale_id = v_sale.id AND selling_option_id = v_case AND line_total = 680 AND base_unit_quantity = 12) THEN
    RAISE EXCEPTION 'Case sale snapshot is incorrect';
  END IF;
  RESET ROLE;
  IF has_table_privilege('authenticated', 'private.product_barcode_registry', 'INSERT')
    OR has_table_privilege('anon', 'private.product_barcode_registry', 'SELECT')
    OR has_function_privilege('authenticated', 'private.sync_product_barcode_registry()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Private barcode registry is exposed';
  END IF;
END;
$test$;
ROLLBACK;
SELECT 'PASS: barcode persistence, conflicts, clearing, store isolation, RLS, case checkout and stock deduction' AS result;
