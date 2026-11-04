-- Unit costs are derived from package totals. Four decimal places still lose
-- cost for repeating divisions such as PHP 650 / 6, so keep six decimal
-- places in both receipt lots and their sale allocations. Preserve the two
-- security-invoker consignment views while altering the referenced column.
DO $migration$
DECLARE
  v_settlement_definition text := pg_get_viewdef('public.consignment_settlement_balances'::regclass, true);
  v_supplier_definition text := pg_get_viewdef('public.consignment_supplier_balances'::regclass, true);
BEGIN
  DROP VIEW public.consignment_supplier_balances;
  DROP VIEW public.consignment_settlement_balances;

  ALTER TABLE public.inventory_stock_lots
    ALTER COLUMN unit_cost TYPE numeric(14, 6)
    USING unit_cost::numeric(14, 6);

  ALTER TABLE public.sale_item_stock_allocations
    ALTER COLUMN unit_cost TYPE numeric(14, 6)
    USING unit_cost::numeric(14, 6);

  EXECUTE 'CREATE VIEW public.consignment_settlement_balances WITH (security_invoker = true) AS ' || v_settlement_definition;
  EXECUTE 'CREATE VIEW public.consignment_supplier_balances WITH (security_invoker = true) AS ' || v_supplier_definition;
  GRANT SELECT ON public.consignment_settlement_balances TO authenticated;
  REVOKE ALL ON public.consignment_supplier_balances FROM PUBLIC, anon;
  GRANT SELECT ON public.consignment_supplier_balances TO authenticated;
END;
$migration$;
