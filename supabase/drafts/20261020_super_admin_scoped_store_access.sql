-- REVIEW-ONLY draft generated from the connected project's current catalog.
-- Location under supabase/drafts keeps it out of Supabase migration deployment.
-- Apply only after reviewing the paired application and Edge Function changes.
BEGIN;

-- Bootstrap policy: the Super Admin can create only a store owned by the authenticated account.
DROP POLICY IF EXISTS "Super admins can insert own stores" ON public.stores;
CREATE POLICY "Super admins can insert own stores"
ON public.stores AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (public.current_user_role()::text = 'super_admin' AND owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Admins can update assigned stores" ON public."stores";
CREATE POLICY "Admins can update assigned stores" ON public."stores" AS PERMISSIVE FOR UPDATE TO public
USING ((user_belongs_to_store(id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'super_admin'::text]))))
WITH CHECK ((user_belongs_to_store(id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'super_admin'::text]))));

DROP POLICY IF EXISTS "Admins can delete assigned stores" ON public."stores";
CREATE POLICY "Admins can delete assigned stores" ON public."stores" AS PERMISSIVE FOR DELETE TO public
USING ((user_belongs_to_store(id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'super_admin'::text]))));

DROP POLICY IF EXISTS "product_suppliers: scoped write" ON public."product_suppliers";
CREATE POLICY "product_suppliers: scoped write" ON public."product_suppliers" AS PERMISSIVE FOR ALL TO "authenticated"
USING ((((current_user_role())::text = ANY (ARRAY['admin'::text, 'inventory'::text, 'super_admin'::text])) AND (EXISTS ( SELECT 1
   FROM products p
  WHERE ((p.id = product_suppliers.product_id) AND user_belongs_to_store(p.store_id)))) AND user_can_access_supplier(supplier_id)))
WITH CHECK ((((current_user_role())::text = ANY (ARRAY['admin'::text, 'inventory'::text, 'super_admin'::text])) AND (EXISTS ( SELECT 1
   FROM products p
  WHERE ((p.id = product_suppliers.product_id) AND user_belongs_to_store(p.store_id)))) AND user_can_access_supplier(supplier_id)));

DROP POLICY IF EXISTS "categories: owner scoped insert" ON public."categories";
CREATE POLICY "categories: owner scoped insert" ON public."categories" AS PERMISSIVE FOR INSERT TO "authenticated"
WITH CHECK ((user_belongs_to_category_owner(owner_id) AND user_belongs_to_store(store_id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'inventory'::text, 'super_admin'::text]))));

DROP POLICY IF EXISTS "categories: owner scoped update" ON public."categories";
CREATE POLICY "categories: owner scoped update" ON public."categories" AS PERMISSIVE FOR UPDATE TO "authenticated"
USING ((user_belongs_to_category_owner(owner_id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'inventory'::text, 'super_admin'::text]))))
WITH CHECK ((user_belongs_to_category_owner(owner_id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'inventory'::text, 'super_admin'::text]))));

DROP POLICY IF EXISTS "categories: owner scoped delete" ON public."categories";
CREATE POLICY "categories: owner scoped delete" ON public."categories" AS PERMISSIVE FOR DELETE TO "authenticated"
USING ((user_belongs_to_category_owner(owner_id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'super_admin'::text]))));

DROP POLICY IF EXISTS "po: scoped write" ON public."purchase_orders";
CREATE POLICY "po: scoped write" ON public."purchase_orders" AS PERMISSIVE FOR ALL TO public
USING ((user_belongs_to_store(store_id) AND ((current_user_role() = 'admin'::user_role OR current_user_role() = 'super_admin'::user_role))))
WITH CHECK ((user_belongs_to_store(store_id) AND ((current_user_role() = 'admin'::user_role OR current_user_role() = 'super_admin'::user_role))));

DROP POLICY IF EXISTS "stock_alerts: scoped write" ON public."stock_alerts";
CREATE POLICY "stock_alerts: scoped write" ON public."stock_alerts" AS PERMISSIVE FOR ALL TO public
USING ((user_belongs_to_store(store_id) AND ((current_user_role() = 'admin'::user_role OR current_user_role() = 'super_admin'::user_role))))
WITH CHECK ((user_belongs_to_store(store_id) AND ((current_user_role() = 'admin'::user_role OR current_user_role() = 'super_admin'::user_role))));

DROP POLICY IF EXISTS "poi: scoped write" ON public."purchase_order_items";
CREATE POLICY "poi: scoped write" ON public."purchase_order_items" AS PERMISSIVE FOR ALL TO public
USING (((EXISTS ( SELECT 1
   FROM purchase_orders po
  WHERE ((po.id = purchase_order_items.purchase_order_id) AND user_belongs_to_store(po.store_id)))) AND ((current_user_role() = 'admin'::user_role OR current_user_role() = 'super_admin'::user_role))))
WITH CHECK (((EXISTS ( SELECT 1
   FROM purchase_orders po
  WHERE ((po.id = purchase_order_items.purchase_order_id) AND user_belongs_to_store(po.store_id)))) AND ((current_user_role() = 'admin'::user_role OR current_user_role() = 'super_admin'::user_role))));

DROP POLICY IF EXISTS "product restocking options: scoped write" ON public."product_restocking_options";
CREATE POLICY "product restocking options: scoped write" ON public."product_restocking_options" AS PERMISSIVE FOR ALL TO "authenticated"
USING ((((current_user_role())::text = ANY (ARRAY['admin'::text, 'inventory'::text, 'super_admin'::text])) AND user_belongs_to_store(store_id)))
WITH CHECK ((((current_user_role())::text = ANY (ARRAY['admin'::text, 'inventory'::text, 'super_admin'::text])) AND user_belongs_to_store(store_id)));

DROP POLICY IF EXISTS "stock_adj: admin delete" ON public."stock_adjustments";
CREATE POLICY "stock_adj: admin delete" ON public."stock_adjustments" AS PERMISSIVE FOR DELETE TO public
USING ((((current_user_role())::text = ANY (ARRAY['admin'::text, 'super_admin'::text])) AND ((pg_trigger_depth() > 0) OR user_belongs_to_store(store_id))));

DROP POLICY IF EXISTS "po: admin delete cascade-safe" ON public."purchase_orders";
CREATE POLICY "po: admin delete cascade-safe" ON public."purchase_orders" AS PERMISSIVE FOR DELETE TO public
USING ((((current_user_role())::text = ANY (ARRAY['admin'::text, 'super_admin'::text])) AND ((pg_trigger_depth() > 0) OR user_belongs_to_store(store_id))));

DROP POLICY IF EXISTS "stock_alerts: admin delete cascade-safe" ON public."stock_alerts";
CREATE POLICY "stock_alerts: admin delete cascade-safe" ON public."stock_alerts" AS PERMISSIVE FOR DELETE TO public
USING ((((current_user_role())::text = ANY (ARRAY['admin'::text, 'super_admin'::text])) AND ((pg_trigger_depth() > 0) OR user_belongs_to_store(store_id))));

DROP POLICY IF EXISTS "sale_items: admin delete" ON public."sale_items";
CREATE POLICY "sale_items: admin delete" ON public."sale_items" AS PERMISSIVE FOR DELETE TO public
USING ((((current_user_role())::text = ANY (ARRAY['admin'::text, 'super_admin'::text])) AND ((pg_trigger_depth() > 0) OR (EXISTS ( SELECT 1
   FROM sales s
  WHERE ((s.id = sale_items.sale_id) AND user_belongs_to_store(s.store_id)))))));

DROP POLICY IF EXISTS "poi: admin delete cascade-safe" ON public."purchase_order_items";
CREATE POLICY "poi: admin delete cascade-safe" ON public."purchase_order_items" AS PERMISSIVE FOR DELETE TO public
USING ((((current_user_role())::text = ANY (ARRAY['admin'::text, 'super_admin'::text])) AND ((pg_trigger_depth() > 0) OR (EXISTS ( SELECT 1
   FROM purchase_orders po
  WHERE ((po.id = purchase_order_items.purchase_order_id) AND user_belongs_to_store(po.store_id)))))));

DROP POLICY IF EXISTS "product_selling_options: scoped delete" ON public."product_selling_options";
CREATE POLICY "product_selling_options: scoped delete" ON public."product_selling_options" AS PERMISSIVE FOR DELETE TO "authenticated"
USING ((user_belongs_to_store(store_id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'super_admin'::text]))));

DROP POLICY IF EXISTS "sales: scoped insert" ON public."sales";
CREATE POLICY "sales: scoped insert" ON public."sales" AS PERMISSIVE FOR INSERT TO "authenticated"
WITH CHECK ((user_belongs_to_store(store_id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'cashier'::text, 'super_admin'::text])) AND (cashier_id = auth.uid())));

DROP POLICY IF EXISTS "stock_adj: scoped read" ON public."stock_adjustments";
CREATE POLICY "stock_adj: scoped read" ON public."stock_adjustments" AS PERMISSIVE FOR SELECT TO "authenticated"
USING ((user_belongs_to_store(store_id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'inventory'::text, 'super_admin'::text]))));

DROP POLICY IF EXISTS "inventory_movements: scoped read" ON public."inventory_movements";
CREATE POLICY "inventory_movements: scoped read" ON public."inventory_movements" AS PERMISSIVE FOR SELECT TO "authenticated"
USING ((user_belongs_to_store(store_id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'inventory'::text, 'super_admin'::text]))));

DROP POLICY IF EXISTS "cashier_closeouts: scoped read" ON public."cashier_closeouts";
CREATE POLICY "cashier_closeouts: scoped read" ON public."cashier_closeouts" AS PERMISSIVE FOR SELECT TO "authenticated"
USING ((user_belongs_to_store(store_id) AND ((cashier_id = auth.uid()) OR ((current_user_role())::text = ANY (ARRAY['admin'::text, 'super_admin'::text])))));

DROP POLICY IF EXISTS "products: scoped insert" ON public."products";
CREATE POLICY "products: scoped insert" ON public."products" AS PERMISSIVE FOR INSERT TO "authenticated"
WITH CHECK ((user_belongs_to_store(store_id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'inventory'::text, 'super_admin'::text]))));

DROP POLICY IF EXISTS "products: scoped update" ON public."products";
CREATE POLICY "products: scoped update" ON public."products" AS PERMISSIVE FOR UPDATE TO "authenticated"
USING ((user_belongs_to_store(store_id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'inventory'::text, 'super_admin'::text]))))
WITH CHECK ((user_belongs_to_store(store_id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'inventory'::text, 'super_admin'::text]))));

DROP POLICY IF EXISTS "products: scoped delete" ON public."products";
CREATE POLICY "products: scoped delete" ON public."products" AS PERMISSIVE FOR DELETE TO "authenticated"
USING ((user_belongs_to_store(store_id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'super_admin'::text]))));

DROP POLICY IF EXISTS "po: scoped read" ON public."purchase_orders";
CREATE POLICY "po: scoped read" ON public."purchase_orders" AS PERMISSIVE FOR SELECT TO "authenticated"
USING ((user_belongs_to_store(store_id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'super_admin'::text]))));

DROP POLICY IF EXISTS "product_selling_options: scoped insert" ON public."product_selling_options";
CREATE POLICY "product_selling_options: scoped insert" ON public."product_selling_options" AS PERMISSIVE FOR INSERT TO "authenticated"
WITH CHECK ((user_belongs_to_store(store_id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'inventory'::text, 'super_admin'::text]))));

DROP POLICY IF EXISTS "product_selling_options: scoped update" ON public."product_selling_options";
CREATE POLICY "product_selling_options: scoped update" ON public."product_selling_options" AS PERMISSIVE FOR UPDATE TO "authenticated"
USING ((user_belongs_to_store(store_id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'inventory'::text, 'super_admin'::text]))))
WITH CHECK ((user_belongs_to_store(store_id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'inventory'::text, 'super_admin'::text]))));

DROP POLICY IF EXISTS "profiles: scoped read" ON public."profiles";
CREATE POLICY "profiles: scoped read" ON public."profiles" AS PERMISSIVE FOR SELECT TO "authenticated"
USING (((id = ( SELECT auth.uid() AS uid)) OR (((current_user_role())::text = ANY (ARRAY['admin'::text, 'super_admin'::text])) AND (EXISTS ( SELECT 1
   FROM (store_users target_mapping
     JOIN store_users actor_mapping ON ((actor_mapping.store_id = target_mapping.store_id)))
  WHERE ((target_mapping.profile_id = profiles.id) AND (actor_mapping.profile_id = ( SELECT auth.uid() AS uid))))))));

DROP POLICY IF EXISTS "sales: scoped read" ON public."sales";
CREATE POLICY "sales: scoped read" ON public."sales" AS PERMISSIVE FOR SELECT TO "authenticated"
USING ((user_belongs_to_store(store_id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'cashier'::text, 'super_admin'::text]))));

DROP POLICY IF EXISTS "sale_items: scoped read" ON public."sale_items";
CREATE POLICY "sale_items: scoped read" ON public."sale_items" AS PERMISSIVE FOR SELECT TO "authenticated"
USING ((((current_user_role())::text = ANY (ARRAY['admin'::text, 'cashier'::text, 'super_admin'::text])) AND (EXISTS ( SELECT 1
   FROM sales s
  WHERE ((s.id = sale_items.sale_id) AND user_belongs_to_store(s.store_id))))));

DROP POLICY IF EXISTS "sale_payments: scoped read" ON public."sale_payments";
CREATE POLICY "sale_payments: scoped read" ON public."sale_payments" AS PERMISSIVE FOR SELECT TO "authenticated"
USING ((user_belongs_to_store(store_id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'cashier'::text, 'super_admin'::text]))));

DROP POLICY IF EXISTS "receipts: scoped read" ON public."receipts";
CREATE POLICY "receipts: scoped read" ON public."receipts" AS PERMISSIVE FOR SELECT TO "authenticated"
USING ((user_belongs_to_store(store_id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'cashier'::text, 'super_admin'::text]))));

DROP POLICY IF EXISTS "sale_events: scoped read" ON public."sale_events";
CREATE POLICY "sale_events: scoped read" ON public."sale_events" AS PERMISSIVE FOR SELECT TO "authenticated"
USING ((user_belongs_to_store(store_id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'cashier'::text, 'super_admin'::text]))));

DROP POLICY IF EXISTS "sale_returns: scoped read" ON public."sale_returns";
CREATE POLICY "sale_returns: scoped read" ON public."sale_returns" AS PERMISSIVE FOR SELECT TO "authenticated"
USING ((user_belongs_to_store(store_id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'cashier'::text, 'super_admin'::text]))));

DROP POLICY IF EXISTS "receipt reprints: scoped read" ON public."receipt_reprints";
CREATE POLICY "receipt reprints: scoped read" ON public."receipt_reprints" AS PERMISSIVE FOR SELECT TO "authenticated"
USING ((user_belongs_to_store(store_id) AND ((current_user_role())::text = ANY (ARRAY['admin'::text, 'cashier'::text, 'super_admin'::text]))));

DROP POLICY IF EXISTS "Users view scoped mappings" ON public."store_users";
CREATE POLICY "Users view scoped mappings" ON public."store_users" AS PERMISSIVE FOR SELECT TO "authenticated"
USING (((profile_id = ( SELECT auth.uid() AS uid)) OR (((current_user_role())::text = ANY (ARRAY['admin'::text, 'super_admin'::text])) AND can_view_store_users(store_id))));

DROP POLICY IF EXISTS "profiles: admin update" ON public."profiles";
CREATE POLICY "profiles: admin update" ON public."profiles" AS PERMISSIVE FOR UPDATE TO "authenticated"
USING ((((current_user_role())::text = ANY (ARRAY['admin'::text, 'super_admin'::text])) AND (EXISTS ( SELECT 1
   FROM (store_users target_mapping
     JOIN store_users actor_mapping ON ((actor_mapping.store_id = target_mapping.store_id)))
  WHERE ((target_mapping.profile_id = profiles.id) AND (actor_mapping.profile_id = ( SELECT auth.uid() AS uid)))))))
WITH CHECK ((((current_user_role())::text = ANY (ARRAY['admin'::text, 'super_admin'::text])) AND ((role)::text = ANY (ARRAY['admin'::text, 'cashier'::text, 'inventory'::text]))));

DROP POLICY IF EXISTS "suppliers: scoped insert" ON public."suppliers";
CREATE POLICY "suppliers: scoped insert" ON public."suppliers" AS PERMISSIVE FOR INSERT TO public
WITH CHECK ((((current_user_role())::text = ANY (ARRAY['admin'::text, 'super_admin'::text])) AND (owner_profile_id = auth.uid())));

DROP POLICY IF EXISTS "suppliers: scoped update" ON public."suppliers";
CREATE POLICY "suppliers: scoped update" ON public."suppliers" AS PERMISSIVE FOR UPDATE TO public
USING ((((current_user_role())::text = ANY (ARRAY['admin'::text, 'super_admin'::text])) AND user_owns_supplier(id)))
WITH CHECK ((((current_user_role())::text = ANY (ARRAY['admin'::text, 'super_admin'::text])) AND (owner_profile_id = auth.uid())));

DROP POLICY IF EXISTS "suppliers: scoped delete" ON public."suppliers";
CREATE POLICY "suppliers: scoped delete" ON public."suppliers" AS PERMISSIVE FOR DELETE TO public
USING ((((current_user_role())::text = ANY (ARRAY['admin'::text, 'super_admin'::text])) AND ((pg_trigger_depth() > 0) OR user_owns_supplier(id))));

DROP POLICY IF EXISTS "supplier_stores: scoped insert" ON public."supplier_stores";
CREATE POLICY "supplier_stores: scoped insert" ON public."supplier_stores" AS PERMISSIVE FOR INSERT TO public
WITH CHECK ((((current_user_role())::text = ANY (ARRAY['admin'::text, 'super_admin'::text])) AND user_belongs_to_store(store_id) AND user_owns_supplier(supplier_id)));

DROP POLICY IF EXISTS "supplier_stores: scoped delete" ON public."supplier_stores";
CREATE POLICY "supplier_stores: scoped delete" ON public."supplier_stores" AS PERMISSIVE FOR DELETE TO public
USING ((((current_user_role())::text = ANY (ARRAY['admin'::text, 'super_admin'::text])) AND ((pg_trigger_depth() > 0) OR (user_belongs_to_store(store_id) AND user_owns_supplier(supplier_id)))));

CREATE OR REPLACE FUNCTION public.adjust_inventory_stock(p_product_id uuid, p_selling_option_id uuid, p_quantity_delta numeric, p_reason text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_option public.product_selling_options%ROWTYPE;
  v_before numeric;
  v_after numeric;
  v_multiplier numeric := 1;
  v_adjustment_id uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF public.current_user_role()::text NOT IN ('admin', 'inventory', 'super_admin') THEN
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
      AND store_id = v_product.store_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selling option not found';
    END IF;

    v_multiplier := CASE
      WHEN v_option.is_bulk
        THEN GREATEST(COALESCE(v_option.inventory_multiplier, v_option.quantity_value, 1), 2)
      ELSE 1
    END;
  END IF;

  v_before := v_product.current_stock;
  v_after := round(v_before + p_quantity_delta);
  IF v_after < 0 THEN
    RAISE EXCEPTION 'Base stock cannot be negative';
  END IF;

  UPDATE public.products
  SET current_stock = v_after,
      updated_at = now()
  WHERE id = v_product.id;

  PERFORM private.sync_shared_option_stock(v_product.id, v_after);

  INSERT INTO public.stock_adjustments(
    id,
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
    v_adjustment_id,
    v_product.store_id,
    v_product.id,
    CASE WHEN p_selling_option_id IS NULL THEN NULL ELSE v_option.id END,
    CASE WHEN p_selling_option_id IS NULL THEN NULL ELSE v_option.label END,
    COALESCE(v_product.unit, 'unit'),
    CASE WHEN v_multiplier > 1 THEN v_multiplier ELSE NULL END,
    CASE WHEN v_multiplier > 1 THEN COALESCE(v_product.unit, 'unit') ELSE NULL END,
    'product',
    p_reason::public.adjustment_reason,
    v_after - v_before,
    v_before,
    v_after,
    COALESCE(p_note, ''),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'adjustmentId', v_adjustment_id,
    'productId', v_product.id,
    'sellingOptionId', p_selling_option_id,
    'stockBefore', v_before,
    'stockAfter', v_after,
    'quantityDelta', v_after - v_before,
    'stockSource', 'product'
  );
END;
$function$

CREATE OR REPLACE FUNCTION public.close_cashier_shift(p_store_id uuid, p_counted_cash numeric, p_opening_cash numeric DEFAULT 0, p_notes text DEFAULT NULL::text, p_period_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_period_end timestamp with time zone DEFAULT now())
 RETURNS cashier_closeouts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  v_role := public.current_user_role()::text;
  IF v_role NOT IN ('admin', 'cashier', 'super_admin') THEN
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
$function$

CREATE OR REPLACE FUNCTION public.create_store_with_owner(p_name text, p_address text, p_tax_rate numeric)
 RETURNS stores
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE new_store public.stores; v_role text;
BEGIN
  v_role := public.current_user_role()::text;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'super_admin') THEN RAISE EXCEPTION 'Only store admins or Super Admins can create stores'; END IF;
  INSERT INTO public.stores (name, address, tax_rate, owner_id)
  VALUES (p_name, p_address, p_tax_rate, auth.uid()) RETURNING * INTO new_store;
  INSERT INTO public.store_users (store_id, profile_id) VALUES (new_store.id, auth.uid());
  RETURN new_store;
END;
$function$

CREATE OR REPLACE FUNCTION public.get_sales_velocity(p_store_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone)
 RETURNS TABLE(product_id uuid, units_sold numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL
    OR COALESCE(public.current_user_role()::text, '') NOT IN ('admin', 'inventory', 'super_admin') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at < p_start_at THEN
    RAISE EXCEPTION 'Invalid sales velocity date range';
  END IF;

  RETURN QUERY
  WITH returned AS (
    SELECT sri.sale_item_id, SUM(sri.quantity)::numeric AS returned_quantity
    FROM public.sale_return_items sri
    JOIN public.sale_returns sr ON sr.id = sri.return_id
    WHERE sr.status = 'completed'
    GROUP BY sri.sale_item_id
  )
  SELECT
    si.product_id,
    SUM(GREATEST(
      COALESCE(si.base_unit_quantity, si.quantity * CASE
        WHEN COALESCE(pso.is_bulk, false)
          THEN GREATEST(COALESCE(pso.inventory_multiplier, pso.quantity_value, 1), 2)
        ELSE 1
      END)
      - COALESCE(returned.returned_quantity, 0) * CASE
        WHEN COALESCE(pso.is_bulk, false)
          THEN GREATEST(COALESCE(pso.inventory_multiplier, pso.quantity_value, 1), 2)
        ELSE 1
      END,
      0
    ))::numeric AS units_sold
  FROM public.sales sale
  JOIN public.sale_items si ON si.sale_id = sale.id
  LEFT JOIN returned ON returned.sale_item_id = si.id
  LEFT JOIN public.product_selling_options pso ON pso.id = si.selling_option_id
  WHERE sale.status = 'completed'
    AND sale.created_at >= p_start_at
    AND sale.created_at <= p_end_at
    AND (p_store_id IS NULL OR sale.store_id = p_store_id)
    AND public.user_belongs_to_store(sale.store_id)
    AND si.product_id IS NOT NULL
    AND si.stock_source = 'product'
  GROUP BY si.product_id;
END;
$function$

CREATE OR REPLACE FUNCTION public.process_pos_sale_v2(p_id uuid, p_store_id uuid, p_cashier_id uuid, p_subtotal numeric, p_tax numeric, p_discount numeric, p_total numeric, p_cash_received numeric, p_change numeric, p_items jsonb, p_payment_method payment_method DEFAULT 'cash'::payment_method, p_payment_reference text DEFAULT NULL::text, p_discount_type text DEFAULT 'amount'::text, p_discount_value numeric DEFAULT NULL::numeric, p_tax_rate numeric DEFAULT NULL::numeric)
 RETURNS sales
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_category_name text;
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

  v_role := public.current_user_role()::text;
  IF v_role NOT IN ('admin', 'cashier', 'super_admin') THEN
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
    v_option_label := NULL;
    v_unit_label := NULL;
    v_package_size := NULL;
    v_package_unit := NULL;

    SELECT *
    INTO v_product
    FROM public.products
    WHERE id = v_product_id;

    SELECT c.name
    INTO v_category_name
    FROM public.categories c
    WHERE c.id = v_product.category_id;

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
    END IF;

    INSERT INTO public.sale_items (
      sale_id,
      product_id,
      product_name,
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
      line_total
    )
    VALUES (
      v_sale.id,
      v_product.id,
      v_product.name,
      COALESCE(v_category_name, 'Uncategorized'),
      v_option_id,
      COALESCE(v_option_label, v_item->>'sellingOptionLabel', v_unit_label),
      COALESCE(v_unit_label, v_item->>'unitLabel', 'unit'),
      v_package_size,
      v_package_unit,
      CASE WHEN v_option_id IS NULL THEN 'product' ELSE 'selling_option' END,
      v_qty,
      v_unit_price,
      v_product.cost_price,
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
$function$

CREATE OR REPLACE FUNCTION public.process_pos_sale_v3(p_id uuid, p_store_id uuid, p_cashier_id uuid, p_subtotal numeric, p_tax numeric, p_discount numeric, p_total numeric, p_cash_received numeric, p_change numeric, p_items jsonb, p_payment_method payment_method DEFAULT 'cash'::payment_method, p_payment_reference text DEFAULT NULL::text, p_discount_type text DEFAULT 'amount'::text, p_discount_value numeric DEFAULT NULL::numeric, p_tax_rate numeric DEFAULT NULL::numeric, p_customer_name text DEFAULT NULL::text, p_customer_tin text DEFAULT NULL::text, p_customer_address text DEFAULT NULL::text, p_terminal_identifier text DEFAULT NULL::text, p_discount_category text DEFAULT 'regular'::text)
 RETURNS sales
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
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

  v_role := public.current_user_role()::text;

  IF v_role NOT IN ('admin', 'cashier', 'super_admin') THEN
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
    ELSE COALESCE(p_tax_rate, tax_rate, 0)
  END
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
$function$

CREATE OR REPLACE FUNCTION public.receive_product_stock(p_product_id uuid, p_restocking_option_id uuid, p_quantity_in_purchase_units numeric, p_purchase_unit text, p_pieces_per_purchase_unit numeric, p_total_supplier_cost numeric, p_ownership text DEFAULT 'store_owned'::text, p_supplier_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_result jsonb;
  v_total_cost numeric := p_total_supplier_cost;
  v_lot_id uuid;
  v_base_units numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF public.current_user_role()::text NOT IN ('admin', 'inventory', 'super_admin') THEN
    RAISE EXCEPTION 'Only admins or inventory users can receive inventory';
  END IF;
  IF p_ownership NOT IN ('store_owned', 'consigned') THEN
    RAISE EXCEPTION 'Invalid inventory ownership type';
  END IF;
  SELECT * INTO v_product FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND OR NOT public.user_belongs_to_store(v_product.store_id) THEN
    RAISE EXCEPTION 'Product not found or access denied';
  END IF;
  IF p_ownership = 'consigned' THEN
    IF p_supplier_id IS NULL THEN RAISE EXCEPTION 'Choose the supplier who owns this stock'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.supplier_stores ss
      WHERE ss.supplier_id = p_supplier_id AND ss.store_id = v_product.store_id
    ) THEN RAISE EXCEPTION 'Supplier is not assigned to this store'; END IF;
    IF v_total_cost IS NULL OR v_total_cost < 0 THEN
      RAISE EXCEPTION 'Enter the total amount owed to the supplier for this consignment';
    END IF;
  END IF;

  PERFORM set_config('kodigo.stock_ownership', p_ownership, true);
  PERFORM set_config('kodigo.stock_supplier_id', COALESCE(p_supplier_id::text, ''), true);
  PERFORM set_config('kodigo.stock_unit_cost', COALESCE(v_total_cost::text, ''), true);
  v_result := public.restock_product_inventory_v2(
    p_product_id, p_restocking_option_id, p_quantity_in_purchase_units,
    p_purchase_unit, p_pieces_per_purchase_unit,
    CASE WHEN p_ownership = 'consigned' THEN NULL ELSE v_total_cost END,
    p_note
  );
  v_base_units := COALESCE((v_result->>'baseUnitsAdded')::numeric, (v_result->>'base_units_added')::numeric);
  IF v_base_units IS NULL OR v_base_units <= 0 THEN
    RAISE EXCEPTION 'Stock receipt did not add a valid quantity';
  END IF;

  SELECT id INTO v_lot_id
  FROM public.inventory_stock_lots
  WHERE product_id = p_product_id
  ORDER BY received_at DESC, id DESC
  LIMIT 1;
  IF v_lot_id IS NULL THEN RAISE EXCEPTION 'Stock receipt did not create an inventory lot'; END IF;

  UPDATE public.inventory_stock_lots
  SET unit_cost = COALESCE(
        round(v_total_cost / v_base_units, 4),
        (v_result->>'newCostPerBaseUnit')::numeric,
        (v_result->>'new_cost_per_base_unit')::numeric,
        v_product.cost_price,
        0
      ),
      received_purchase_quantity = p_quantity_in_purchase_units,
      purchase_unit_label = COALESCE(NULLIF(trim(p_purchase_unit), ''), v_product.unit, 'piece'),
      pieces_per_purchase_unit = COALESCE(p_pieces_per_purchase_unit, 1)
  WHERE id = v_lot_id;

  RETURN v_result || jsonb_build_object(
    'ownership', p_ownership, 'supplierId', p_supplier_id, 'stockLotId', v_lot_id
  );
END;
$function$

CREATE OR REPLACE FUNCTION public.receive_purchase_order(p_po_id uuid, p_on_time boolean)
 RETURNS purchase_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_po public.purchase_orders%ROWTYPE;
  v_item record;
  v_before integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
  INTO v_po
  FROM public.purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order % does not exist', p_po_id;
  END IF;

  IF public.current_user_role()::text NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only store admins can receive purchase orders';
  END IF;

  IF NOT public.user_belongs_to_store(v_po.store_id) THEN
    RAISE EXCEPTION 'User is not assigned to this purchase order store';
  END IF;

  IF v_po.status <> 'sent' THEN
    RAISE EXCEPTION 'Only sent purchase orders can be received';
  END IF;

  FOR v_item IN
    SELECT product_id, product_name, quantity
    FROM public.purchase_order_items
    WHERE purchase_order_id = p_po_id
  LOOP
    SELECT current_stock
    INTO v_before
    FROM public.products
    WHERE id = v_item.product_id
      AND store_id = v_po.store_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % does not exist in purchase order store', v_item.product_id;
    END IF;

    UPDATE public.products
    SET current_stock = current_stock + v_item.quantity,
        updated_at = now()
    WHERE id = v_item.product_id;

    INSERT INTO public.stock_adjustments (
      store_id,
      product_id,
      reason,
      quantity_delta,
      stock_before,
      stock_after,
      note,
      created_by
    )
    VALUES (
      v_po.store_id,
      v_item.product_id,
      'restock'::public.adjustment_reason,
      v_item.quantity,
      v_before,
      v_before + v_item.quantity,
      'Received purchase order ' || p_po_id::text,
      auth.uid()
    );
  END LOOP;

  UPDATE public.purchase_orders
  SET status = 'received',
      on_time = p_on_time,
      received_at = now(),
      updated_at = now()
  WHERE id = p_po_id
  RETURNING * INTO v_po;

  RETURN v_po;
END;
$function$

CREATE OR REPLACE FUNCTION public.record_consignment_supplier_payment(p_store_id uuid, p_supplier_id uuid, p_amount numeric, p_reference text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS consignment_supplier_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_payment public.consignment_supplier_payments%ROWTYPE;
  v_due numeric := 0;
  v_paid numeric := 0;
  v_outstanding numeric := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF public.current_user_role()::text NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only store admins can record supplier payments';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;
  IF NOT public.user_belongs_to_store(p_store_id) THEN
    RAISE EXCEPTION 'User is not assigned to this store';
  END IF;

  -- Lock the supplier so concurrent partial payments cannot exceed its balance.
  PERFORM 1 FROM public.suppliers WHERE id = p_supplier_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplier does not exist'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.supplier_stores ss
    WHERE ss.supplier_id = p_supplier_id AND ss.store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'Supplier is not assigned to this store';
  END IF;

  SELECT COALESCE(SUM(lot.quantity_received * lot.unit_cost), 0)
  INTO v_due
  FROM public.inventory_stock_lots lot
  WHERE lot.store_id = p_store_id
    AND lot.supplier_id = p_supplier_id
    AND lot.ownership = 'consigned';

  SELECT COALESCE(SUM(payment.amount), 0)
  INTO v_paid
  FROM public.consignment_supplier_payments payment
  WHERE payment.store_id = p_store_id
    AND payment.supplier_id = p_supplier_id;

  v_outstanding := GREATEST(round(v_due - v_paid, 2), 0);
  IF round(p_amount, 2) > v_outstanding THEN
    RAISE EXCEPTION 'Payment exceeds the outstanding consignment balance of %', v_outstanding;
  END IF;

  INSERT INTO public.consignment_supplier_payments (
    store_id, supplier_id, amount, reference, note, created_by
  ) VALUES (
    p_store_id, p_supplier_id, round(p_amount, 2), NULLIF(trim(COALESCE(p_reference, '')), ''),
    COALESCE(trim(p_note), ''), auth.uid()
  )
  RETURNING * INTO v_payment;
  RETURN v_payment;
END;
$function$

CREATE OR REPLACE FUNCTION public.record_receipt_reprint(p_sale_id uuid, p_output_type text DEFAULT 'print'::text, p_reason text DEFAULT NULL::text)
 RETURNS receipts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    OR public.current_user_role()::text NOT IN ('admin', 'cashier', 'super_admin') THEN
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
$function$

CREATE OR REPLACE FUNCTION public.record_report_export_notification(p_store_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'completed'::text, p_file_name text DEFAULT NULL::text, p_error text DEFAULT NULL::text, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text := lower(COALESCE(NULLIF(p_status, ''), 'completed'));
  v_type text;
  v_severity text;
  v_title text;
  v_message text;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF public.current_user_role()::text NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only store admins can record report export notifications';
  END IF;

  IF p_store_id IS NOT NULL AND NOT public.user_belongs_to_store(p_store_id) THEN
    RAISE EXCEPTION 'User is not assigned to this store';
  END IF;

  IF v_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'Report export status must be completed or failed';
  END IF;

  IF v_status = 'completed' THEN
    v_type := 'report_export_completed';
    v_severity := 'success';
    v_title := 'Report export completed';
    v_message := COALESCE(NULLIF(p_file_name, ''), 'Report export') || ' finished successfully.';
  ELSE
    v_type := 'report_export_failed';
    v_severity := 'error';
    v_title := 'Report export failed';
    v_message := COALESCE(NULLIF(p_file_name, ''), 'Report export') || ' failed' ||
      CASE WHEN p_error IS NULL OR p_error = '' THEN '.' ELSE ': ' || left(p_error, 160) END;
  END IF;

  RETURN public.create_notification(
    p_store_id,
    v_type,
    v_severity,
    v_title,
    v_message,
    ARRAY['admin']::text[],
    'report_export',
    NULL,
    'report_export',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    jsonb_build_object(
      'fileName', p_file_name,
      'status', v_status,
      'error', p_error,
      'filters', COALESCE(p_filters, '{}'::jsonb)
    ),
    NULL
  );
END;
$function$

CREATE OR REPLACE FUNCTION public.refund_pos_sale(p_sale_id uuid, p_amount numeric, p_method payment_method DEFAULT 'cash'::payment_method, p_reason text DEFAULT NULL::text, p_reference text DEFAULT NULL::text)
 RETURNS sales
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF public.current_user_role()::text NOT IN ('admin', 'super_admin') THEN
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

  SELECT COALESCE(ABS(SUM(amount) FILTER (WHERE amount < 0)), 0)
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
$function$

CREATE OR REPLACE FUNCTION public.replace_product_suppliers(p_product_id uuid, p_supplier_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_store_id uuid;
  v_supplier_ids uuid[];
BEGIN
  IF (SELECT auth.uid()) IS NULL
    OR COALESCE(public.current_user_role()::text, '') NOT IN ('admin', 'inventory', 'super_admin') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT p.store_id
  INTO v_store_id
  FROM public.products p
  WHERE p.id = p_product_id;

  IF v_store_id IS NULL OR NOT public.user_belongs_to_store(v_store_id) THEN
    RAISE EXCEPTION 'Product not found or access denied';
  END IF;

  SELECT COALESCE(
    array_agg(supplier_id ORDER BY first_position),
    ARRAY[]::uuid[]
  )
  INTO v_supplier_ids
  FROM (
    SELECT supplied.supplier_id, MIN(supplied.position) AS first_position
    FROM unnest(COALESCE(p_supplier_ids, ARRAY[]::uuid[]))
      WITH ORDINALITY AS supplied(supplier_id, position)
    WHERE supplied.supplier_id IS NOT NULL
    GROUP BY supplied.supplier_id
  ) normalized;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_supplier_ids) selected(supplier_id)
    WHERE NOT public.supplier_serves_store(selected.supplier_id, v_store_id)
  ) THEN
    RAISE EXCEPTION 'Every product supplier must be assigned to the product store'
      USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.product_suppliers
  WHERE product_id = p_product_id;

  INSERT INTO public.product_suppliers (product_id, supplier_id, is_primary)
  SELECT p_product_id, selected.supplier_id, selected.position = 1
  FROM unnest(v_supplier_ids) WITH ORDINALITY AS selected(supplier_id, position);

  UPDATE public.products
  SET supplier_id = CASE
        WHEN cardinality(v_supplier_ids) > 0 THEN v_supplier_ids[1]
        ELSE NULL
      END,
      updated_at = now()
  WHERE id = p_product_id;
END;
$function$

CREATE OR REPLACE FUNCTION public.restock_product_inventory_v2(p_product_id uuid, p_restocking_option_id uuid DEFAULT NULL::uuid, p_quantity_in_purchase_units numeric DEFAULT NULL::numeric, p_purchase_unit text DEFAULT NULL::text, p_pieces_per_purchase_unit numeric DEFAULT NULL::numeric, p_total_supplier_cost numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_restocking_option public.product_restocking_options%ROWTYPE;
  v_before numeric;
  v_after numeric;
  v_quantity numeric := coalesce(p_quantity_in_purchase_units, 0);
  v_factor numeric := coalesce(p_pieces_per_purchase_unit, 1);
  v_unit text := nullif(trim(coalesce(p_purchase_unit, '')), '');
  v_base_units numeric;
  v_old_cost numeric;
  v_new_cost numeric;
  v_total_cost numeric := p_total_supplier_cost;
  v_cost_change_percent numeric;
  v_previous_gross_margin numeric;
  v_new_gross_margin numeric;
  v_raw_suggested_price numeric;
  v_suggested_price numeric;
  v_rounding numeric;
  v_restock_id uuid := gen_random_uuid();
  v_adjustment_id uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role()::text NOT IN ('admin', 'inventory', 'super_admin') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_quantity <= 0 OR v_quantity <> v_quantity THEN
    RAISE EXCEPTION 'Quantity received must be greater than zero';
  END IF;
  IF p_total_supplier_cost IS NOT NULL AND p_total_supplier_cost < 0 THEN
    RAISE EXCEPTION 'Supplier cost cannot be negative';
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;
  IF NOT FOUND OR NOT public.user_belongs_to_store(v_product.store_id) THEN
    RAISE EXCEPTION 'Product not found or access denied';
  END IF;

  IF p_restocking_option_id IS NOT NULL THEN
    SELECT * INTO v_restocking_option
    FROM public.product_restocking_options
    WHERE id = p_restocking_option_id
      AND product_id = p_product_id
      AND store_id = v_product.store_id
      AND is_active
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Restocking option not found or inactive';
    END IF;
    v_unit := v_restocking_option.label;
    v_factor := v_restocking_option.conversion_factor;
  END IF;

  v_unit := coalesce(v_unit, nullif(trim(coalesce(v_product.purchase_unit, '')), ''), v_product.unit, 'unit');
  IF v_factor < 1 OR v_factor <> v_factor THEN
    RAISE EXCEPTION 'Conversion factor must be at least one';
  END IF;
  v_base_units := round(v_quantity * v_factor, 3);
  v_before := coalesce(v_product.current_stock, 0);
  v_after := v_before + v_base_units;
  v_old_cost := coalesce(v_product.cost_price, 0);
  v_new_cost := CASE
    WHEN v_total_cost IS NULL THEN v_old_cost
    ELSE round(v_total_cost / greatest(v_base_units, 1), 4)
  END;

  IF v_old_cost > 0 THEN
    v_cost_change_percent := round((v_new_cost - v_old_cost) / v_old_cost * 100, 4);
  ELSIF v_new_cost > 0 THEN
    v_cost_change_percent := 100;
  ELSE
    v_cost_change_percent := 0;
  END IF;

  v_raw_suggested_price := CASE
    WHEN v_new_cost > 0 AND v_product.margin_percentage IS NOT NULL
      THEN v_new_cost / greatest(1 - v_product.margin_percentage / 100, 0.0001)
    WHEN v_new_cost > 0 AND v_old_cost > 0
      THEN coalesce(v_product.selling_price, 0) * v_new_cost / v_old_cost
    ELSE coalesce(v_product.selling_price, 0)
  END;
  v_rounding := greatest(coalesce(v_product.price_rounding, 1), 0.01);
  v_previous_gross_margin := CASE
    WHEN coalesce(v_product.selling_price, 0) > 0
      THEN (v_product.selling_price - v_old_cost) / v_product.selling_price
    ELSE 0
  END;
  v_new_gross_margin := CASE
    WHEN coalesce(v_product.selling_price, 0) > 0
      THEN (v_product.selling_price - v_new_cost) / v_product.selling_price
    ELSE 0
  END;
  v_suggested_price := CASE
    WHEN v_raw_suggested_price > 0 THEN ceil(v_raw_suggested_price / v_rounding) * v_rounding
    ELSE 0
  END;

  UPDATE public.products
  SET current_stock = round(v_after),
      cost_price = CASE WHEN v_total_cost IS NULL THEN cost_price ELSE v_new_cost END,
      purchase_unit = v_unit,
      conversion_factor = round(v_factor),
      bulk_purchase_price = CASE WHEN v_total_cost IS NULL THEN bulk_purchase_price ELSE round(v_total_cost / greatest(v_quantity, 1), 2) END,
      updated_at = now()
  WHERE id = p_product_id;
  PERFORM private.sync_shared_option_stock(p_product_id, v_after);

  INSERT INTO public.restock_history(
    id, store_id, product_id, restocking_option_id,
    quantity_in_purchase_units, purchase_unit, pieces_per_purchase_unit,
    pieces_added, purchase_price_per_unit, purchase_price_per_piece,
    total_supplier_cost, cost_before, cost_after, cost_change_percent,
    suggested_selling_price, raw_suggested_selling_price, price_rounding,
    stock_before, stock_after, restocked_by, note
  ) VALUES (
    v_restock_id, v_product.store_id, p_product_id, p_restocking_option_id,
    v_quantity, v_unit, v_factor, v_base_units,
    CASE WHEN v_total_cost IS NULL THEN 0 ELSE round(v_total_cost / greatest(v_quantity, 1), 2) END,
    v_new_cost, v_total_cost, v_old_cost, v_new_cost, v_cost_change_percent,
    v_suggested_price, v_raw_suggested_price, v_rounding,
    v_before, v_after, auth.uid(), coalesce(p_note, '')
  );

  INSERT INTO public.stock_adjustments(
    id, store_id, product_id, unit_label, package_size, package_unit,
    stock_source, reason, quantity_delta, stock_before, stock_after,
    note, created_by
  ) VALUES (
    v_adjustment_id, v_product.store_id, p_product_id, v_product.unit,
    v_factor, v_unit, 'product', 'restock', v_base_units,
    v_before, v_after, coalesce(p_note, ''), auth.uid()
  );

  RETURN jsonb_build_object(
    'restockId', v_restock_id,
    'productId', p_product_id,
    'purchaseUnit', v_unit,
    'quantityReceived', v_quantity,
    'conversionFactor', v_factor,
    'baseUnitsAdded', v_base_units,
    'stockBefore', v_before,
    'stockAfter', v_after,
    'totalSupplierCost', v_total_cost,
    'previousCostPerBaseUnit', v_old_cost,
    'newCostPerBaseUnit', v_new_cost,
    'costChangePercent', v_cost_change_percent,
    'previousGrossMargin', v_previous_gross_margin,
    'newGrossMargin', v_new_gross_margin,
    'currentSellingPrice', coalesce(v_product.selling_price, 0),
    'suggestedSellingPrice', v_suggested_price,
    'rawSuggestedSellingPrice', v_raw_suggested_price,
    'priceRounding', v_rounding
  );
END;
$function$

CREATE OR REPLACE FUNCTION public.return_sale_items(p_sale_id uuid, p_items jsonb, p_reason text, p_refund_method payment_method DEFAULT 'cash'::payment_method, p_reference text DEFAULT NULL::text)
 RETURNS sale_returns
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
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
  v_after numeric;
  v_base_quantity numeric;
  v_multiplier numeric;
  v_refunded numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_sale
  FROM public.sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale % does not exist', p_sale_id;
  END IF;
  IF public.current_user_role()::text NOT IN ('admin', 'super_admin') THEN
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
    SELECT * INTO v_sale_item
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
      v_multiplier := GREATEST(COALESCE(v_sale_item.units_per_package, v_sale_item.package_size, 1), 1);
      v_base_quantity := v_qty * v_multiplier;

      SELECT current_stock INTO v_before
      FROM public.products
      WHERE id = v_sale_item.product_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % no longer exists', v_sale_item.product_id;
      END IF;

      v_after := round(v_before + v_base_quantity);
      UPDATE public.products
      SET current_stock = v_after,
          updated_at = now()
      WHERE id = v_sale_item.product_id;

      PERFORM private.sync_shared_option_stock(v_sale_item.product_id, v_after);

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
        CASE WHEN v_multiplier > 1 THEN v_multiplier ELSE NULL END,
        CASE WHEN v_multiplier > 1 THEN COALESCE(v_sale_item.unit_label, 'unit') ELSE NULL END,
        'product',
        'other',
        v_base_quantity,
        v_before,
        v_after,
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
$function$

CREATE OR REPLACE FUNCTION public.void_pos_sale(p_sale_id uuid, p_reason text)
 RETURNS sales
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_item record;
  v_before numeric;
  v_after numeric;
  v_base_quantity numeric;
  v_multiplier numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_sale
  FROM public.sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale % does not exist', p_sale_id;
  END IF;
  IF public.current_user_role()::text NOT IN ('admin', 'super_admin') THEN
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
      si.product_id,
      si.selling_option_id,
      si.selling_option_label,
      si.unit_label,
      si.package_size,
      si.package_unit,
      si.quantity,
      si.units_per_package,
      si.base_unit_quantity
    FROM public.sale_items si
    WHERE si.sale_id = p_sale_id
      AND si.product_id IS NOT NULL
  LOOP
    v_multiplier := GREATEST(COALESCE(v_item.units_per_package, v_item.package_size, 1), 1);
    v_base_quantity := GREATEST(COALESCE(v_item.base_unit_quantity, v_item.quantity * v_multiplier), 0);

    SELECT current_stock INTO v_before
    FROM public.products
    WHERE id = v_item.product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % no longer exists', v_item.product_id;
    END IF;

    v_after := round(v_before + v_base_quantity);
    UPDATE public.products
    SET current_stock = v_after,
        updated_at = now()
    WHERE id = v_item.product_id;

    PERFORM private.sync_shared_option_stock(v_item.product_id, v_after);

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
      CASE WHEN v_multiplier > 1 THEN v_multiplier ELSE NULL END,
      CASE WHEN v_multiplier > 1 THEN COALESCE(v_item.unit_label, 'unit') ELSE NULL END,
      'product',
      'other',
      v_base_quantity,
      v_before,
      v_after,
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
$function$

COMMIT;

