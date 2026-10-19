-- Store the supplier purchase unit captured at each receipt so consignment
-- reporting does not change when a product's current purchase settings change.
ALTER TABLE public.inventory_stock_lots
  ADD COLUMN IF NOT EXISTS received_purchase_quantity numeric(14,3),
  ADD COLUMN IF NOT EXISTS purchase_unit_label text,
  ADD COLUMN IF NOT EXISTS pieces_per_purchase_unit numeric(14,3);

ALTER TABLE public.inventory_stock_lots
  ADD CONSTRAINT inventory_stock_lots_purchase_quantity_nonnegative
    CHECK (received_purchase_quantity IS NULL OR received_purchase_quantity >= 0),
  ADD CONSTRAINT inventory_stock_lots_purchase_conversion_positive
    CHECK (pieces_per_purchase_unit IS NULL OR pieces_per_purchase_unit > 0);

-- Preserve the package quantity and label on each newly received stock lot.
CREATE OR REPLACE FUNCTION public.receive_product_stock(
  p_product_id uuid,
  p_restocking_option_id uuid,
  p_quantity_in_purchase_units numeric,
  p_purchase_unit text,
  p_pieces_per_purchase_unit numeric,
  p_total_supplier_cost numeric,
  p_ownership text DEFAULT 'store_owned',
  p_supplier_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_result jsonb;
  v_total_cost numeric := p_total_supplier_cost;
  v_lot_id uuid;
  v_base_units numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF public.current_user_role()::text NOT IN ('admin', 'inventory') THEN
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
$$;

REVOKE ALL ON FUNCTION public.receive_product_stock(uuid, uuid, numeric, text, numeric, numeric, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_product_stock(uuid, uuid, numeric, text, numeric, numeric, text, uuid, text) TO authenticated;

-- Sales display is allocated to consignment lots for visibility. Payables
-- remain based on all units received, even before those units are sold.
CREATE OR REPLACE VIEW public.consignment_settlement_balances
WITH (security_invoker = true)
AS
WITH sold AS (
  SELECT
    allocation.lot_id,
    SUM(GREATEST(allocation.quantity_base_units - allocation.quantity_returned, 0)) AS quantity_sold,
    SUM(CASE
      WHEN sale_item.base_unit_quantity > 0 THEN
        sale_item.line_total
        * GREATEST(allocation.quantity_base_units - allocation.quantity_returned, 0)
        / sale_item.base_unit_quantity
      ELSE 0
    END) AS amount_sold
  FROM public.sale_item_stock_allocations allocation
  JOIN public.sale_items sale_item ON sale_item.id = allocation.sale_item_id
  JOIN public.sales sale ON sale.id = sale_item.sale_id AND sale.status <> 'voided'
  WHERE allocation.ownership = 'consigned'
  GROUP BY allocation.lot_id
)
SELECT
  lot.store_id,
  lot.product_id,
  product.name AS product_name,
  product.unit AS base_unit,
  lot.supplier_id,
  lot.supplier_name_snapshot AS supplier_name,
  SUM(lot.quantity_received) AS quantity_received,
  SUM(lot.quantity_remaining) AS quantity_on_hand,
  SUM(COALESCE(sold.quantity_sold, 0)) AS quantity_sold,
  round(SUM(lot.quantity_received * lot.unit_cost), 2) AS amount_due,
  round(SUM(COALESCE(
    lot.received_purchase_quantity,
    lot.quantity_received / COALESCE(NULLIF(lot.pieces_per_purchase_unit, 0), 1)
  )), 3) AS quantity_received_purchase_units,
  COALESCE(NULLIF(lot.purchase_unit_label, ''), product.unit, 'piece') AS purchase_unit_label,
  round(SUM(COALESCE(sold.amount_sold, 0)), 2) AS amount_sold
FROM public.inventory_stock_lots lot
JOIN public.products product ON product.id = lot.product_id
LEFT JOIN sold ON sold.lot_id = lot.id
WHERE lot.ownership = 'consigned'
GROUP BY
  lot.store_id, lot.product_id, product.name, product.unit, lot.supplier_id,
  lot.supplier_name_snapshot, COALESCE(NULLIF(lot.purchase_unit_label, ''), product.unit, 'piece');

GRANT SELECT ON public.consignment_settlement_balances TO authenticated;

-- Accept per-cart-unit discounts while retaining the existing server-side
-- product-price validation and one-transaction stock/sales write.
ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS item_discount_amount numeric(14,2) NOT NULL DEFAULT 0
    CHECK (item_discount_amount >= 0);

CREATE OR REPLACE FUNCTION public.process_pos_sale_v4(
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
SET search_path = ''
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_item jsonb;
  v_product_id uuid;
  v_option_id uuid;
  v_quantity integer;
  v_unit_price numeric;
  v_discount_per_unit numeric;
  v_discount_amount numeric;
  v_discount_total numeric := 0;
  v_updated_rows integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  -- A timed-out client may retry the same sale id after the first request
  -- committed. Return its committed result instead of charging twice.
  SELECT * INTO v_sale
  FROM public.sales
  WHERE id = p_id AND store_id = p_store_id AND cashier_id = auth.uid();
  IF FOUND THEN RETURN v_sale; END IF;

  IF COALESCE(p_discount_type, 'amount') <> 'amount' THEN
    RAISE EXCEPTION 'Enter discounts on the individual sale items';
  END IF;

  v_sale := public.process_pos_sale_v3(
    p_id => p_id,
    p_store_id => p_store_id,
    p_cashier_id => p_cashier_id,
    p_subtotal => p_subtotal,
    p_tax => p_tax,
    p_discount => p_discount,
    p_total => p_total,
    p_cash_received => p_cash_received,
    p_change => p_change,
    p_items => p_items,
    p_payment_method => p_payment_method,
    p_payment_reference => p_payment_reference,
    p_discount_type => 'amount',
    p_discount_value => COALESCE(p_discount, 0),
    p_tax_rate => p_tax_rate,
    p_customer_name => p_customer_name,
    p_customer_tin => p_customer_tin,
    p_customer_address => p_customer_address,
    p_terminal_identifier => p_terminal_identifier,
    p_discount_category => p_discount_category
  );

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Sale items must be a JSON array';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS item(value)
  LOOP
    v_product_id := (v_item->>'productId')::uuid;
    v_option_id := NULLIF(v_item->>'sellingOptionId', '')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    v_discount_per_unit := COALESCE(NULLIF(v_item->>'itemDiscountPerUnit', '')::numeric, 0);
    IF v_quantity IS NULL OR v_quantity <= 0 OR v_discount_per_unit < 0 THEN
      RAISE EXCEPTION 'Sale item quantity and discount must be valid';
    END IF;

    SELECT sale_item.unit_price INTO v_unit_price
    FROM public.sale_items sale_item
    WHERE sale_item.sale_id = v_sale.id
      AND sale_item.product_id = v_product_id
      AND sale_item.selling_option_id IS NOT DISTINCT FROM v_option_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sale item was not saved for product %', v_product_id; END IF;
    IF v_discount_per_unit > v_unit_price THEN
      RAISE EXCEPTION 'Item discount cannot exceed the price of the selected selling unit';
    END IF;

    v_discount_amount := round(v_discount_per_unit * v_quantity, 2);
    v_discount_total := v_discount_total + v_discount_amount;
    UPDATE public.sale_items sale_item
    SET item_discount_amount = v_discount_amount,
        unit_price = round(sale_item.unit_price - v_discount_per_unit, 2),
        final_selling_price = round(sale_item.final_selling_price - v_discount_per_unit, 2),
        line_total = round(sale_item.line_total - v_discount_amount, 2),
        gross_profit = round(sale_item.line_total - v_discount_amount - COALESCE(sale_item.cogs, 0), 2),
        gross_margin = CASE
          WHEN sale_item.line_total - v_discount_amount > 0 THEN
            (sale_item.line_total - v_discount_amount - COALESCE(sale_item.cogs, 0))
              / (sale_item.line_total - v_discount_amount)
          ELSE 0
        END
    WHERE sale_item.sale_id = v_sale.id
      AND sale_item.product_id = v_product_id
      AND sale_item.selling_option_id IS NOT DISTINCT FROM v_option_id;
    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    IF v_updated_rows <> 1 THEN
      RAISE EXCEPTION 'Each product and selling option must appear once in the cart';
    END IF;
  END LOOP;

  IF round(v_discount_total, 2) <> round(COALESCE(p_discount, 0), 2)
    OR round(COALESCE(p_discount_value, p_discount, 0), 2) <> round(v_discount_total, 2) THEN
    RAISE EXCEPTION 'Item discounts do not match the submitted sale total';
  END IF;

  UPDATE public.receipts
  SET payload = private.build_receipt_snapshot(v_sale.id)
  WHERE sale_id = v_sale.id;
  RETURN v_sale;
END;
$$;

REVOKE ALL ON FUNCTION public.process_pos_sale_v4(
  uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, jsonb,
  public.payment_method, text, text, numeric, numeric, text, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_pos_sale_v4(
  uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, numeric, jsonb,
  public.payment_method, text, text, numeric, numeric, text, text, text, text, text
) TO authenticated;
