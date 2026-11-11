-- Harden T06 public RPC ACLs after PostgreSQL preserved explicit grants from
-- historical definitions through CREATE OR REPLACE. Authenticated remains the
-- only API role allowed to call these functions.
REVOKE ALL ON FUNCTION public.prepare_inventory_cutover(jsonb) FROM service_role;
REVOKE ALL ON FUNCTION public.get_inventory_cutover_preview(uuid) FROM service_role;
REVOKE ALL ON FUNCTION public.get_inventory_ledger_status(uuid) FROM service_role;
REVOKE ALL ON FUNCTION public.complete_inventory_cutover(jsonb) FROM service_role;
REVOKE ALL ON FUNCTION public.get_inventory_product_balance(uuid, uuid) FROM service_role;
REVOKE ALL ON FUNCTION public.process_pos_sale_v5(jsonb) FROM service_role;
REVOKE ALL ON FUNCTION public.receive_product_stock_v2(jsonb) FROM service_role;
REVOKE ALL ON FUNCTION public.create_product_v2(jsonb) FROM service_role;
REVOKE ALL ON FUNCTION public.request_inventory_adjustment(jsonb) FROM service_role;
REVOKE ALL ON FUNCTION public.apply_inventory_adjustment(jsonb) FROM service_role;
REVOKE ALL ON FUNCTION public.adjust_inventory_stock(uuid, uuid, numeric, text, text) FROM service_role;
REVOKE ALL ON FUNCTION public.receive_product_stock(uuid, uuid, numeric, text, numeric, numeric, text, uuid, text) FROM service_role;
REVOKE ALL ON FUNCTION public.restock_product_inventory_v2(uuid, uuid, numeric, text, numeric, numeric, text) FROM service_role;
REVOKE ALL ON FUNCTION public.restock_product_inventory(uuid, numeric, text, numeric, numeric, text) FROM service_role;
REVOKE ALL ON FUNCTION public.void_pos_sale(uuid, text) FROM service_role;
REVOKE ALL ON FUNCTION public.return_sale_items(uuid, jsonb, text, public.payment_method, text) FROM service_role;
