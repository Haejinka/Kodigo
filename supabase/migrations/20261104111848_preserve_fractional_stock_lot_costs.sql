-- Keep the full package-cost division for product and stock-lot unit costs.
-- The product column stores six decimal places; stock lots and allocations
-- retain full numeric precision so a case total divides and multiplies back
-- without losing centavos.
DO $migration$
DECLARE
  v_definition text;
  v_updated_definition text;
BEGIN
  v_definition := pg_get_functiondef(
    'public.restock_product_inventory_v2(uuid,uuid,numeric,text,numeric,numeric,text)'::regprocedure
  );
  v_updated_definition := replace(
    v_definition,
    'round(v_total_cost / greatest(v_base_units, 1), 4)',
    'v_total_cost / greatest(v_base_units, 1)'
  );
  IF v_updated_definition = v_definition THEN
    RAISE EXCEPTION 'Could not find the rounded unit cost in restock_product_inventory_v2';
  END IF;
  EXECUTE v_updated_definition;

  v_definition := pg_get_functiondef(
    'public.receive_product_stock(uuid,uuid,numeric,text,numeric,numeric,text,uuid,text)'::regprocedure
  );
  v_updated_definition := replace(
    v_definition,
    'round(v_total_cost / v_base_units, 4)',
    'v_total_cost / v_base_units'
  );
  IF v_updated_definition = v_definition THEN
    RAISE EXCEPTION 'Could not find the rounded lot cost in receive_product_stock';
  END IF;
  EXECUTE v_updated_definition;
END;
$migration$;
