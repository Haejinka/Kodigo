import { supabase } from '@/lib/supabase';

export interface ConsignmentLotRecord {
  id: string;
  store_id: string;
  product_id: string;
  ownership: 'store_owned' | 'consigned';
  supplier_id: string;
  supplier_name_snapshot: string | null;
  quantity_received: number | string;
  quantity_remaining: number | string;
  quantity_sold: number | string;
  unit_cost: number | string;
  received_at: string;
  received_purchase_quantity: number | string | null;
  purchase_unit_label: string | null;
  pieces_per_purchase_unit: number | string | null;
}

export interface ConsignmentAllocationRecord {
  id: string;
  store_id: string;
  sale_item_id: string;
  lot_id: string;
  quantity_base_units: number | string;
  quantity_returned: number | string;
  unit_cost: number | string;
  ownership: 'store_owned' | 'consigned';
  supplier_id: string | null;
  created_at: string;
}

export interface ConsignmentSaleItemRecord {
  id: string;
  sale_id: string;
  product_id: string | null;
  base_unit_quantity: number | string | null;
  line_total: number | string;
}

export interface ConsignmentSaleRecord {
  id: string;
  store_id: string;
  created_at: string;
  status: string;
}

export interface ConsignmentSupplierBalanceRecord {
  store_id: string;
  supplier_id: string;
  supplier_name: string;
  quantity_received: number | string;
  quantity_on_hand: number | string;
  quantity_sold: number | string;
  amount_due: number | string;
  amount_paid: number | string;
  outstanding_balance: number | string;
  supplier_credit: number | string;
}

export interface ConsignmentPaymentRecord {
  id: string;
  store_id: string;
  supplier_id: string;
  amount: number | string;
  reference: string | null;
  note: string;
  paid_at: string;
}

export interface ConsignmentLedger {
  lots: ConsignmentLotRecord[];
  storeOwnedLots: ConsignmentLotRecord[];
  allocations: ConsignmentAllocationRecord[];
  saleItems: ConsignmentSaleItemRecord[];
  sales: ConsignmentSaleRecord[];
  supplierBalances: ConsignmentSupplierBalanceRecord[];
  payments: ConsignmentPaymentRecord[];
}

const PAGE_SIZE = 1000;
const ID_CHUNK_SIZE = 400;

export async function fetchConsignmentLedger(activeStoreId: string | 'all' | null): Promise<ConsignmentLedger> {
  if (!activeStoreId) return emptyLedger();

  const lotSelect = 'id,store_id,product_id,ownership,supplier_id,supplier_name_snapshot,quantity_received,quantity_remaining,quantity_sold,unit_cost,received_at,received_purchase_quantity,purchase_unit_label,pieces_per_purchase_unit';
  const [lots, storeOwnedLots, allocations, supplierBalances, payments] = await Promise.all([
    fetchAllRows<ConsignmentLotRecord>((from, to) => {
      let query = supabase
        .from('inventory_stock_lots')
        .select(lotSelect)
        .eq('ownership', 'consigned')
        .order('received_at', { ascending: true });
      if (activeStoreId !== 'all') query = query.eq('store_id', activeStoreId);
      return query.range(from, to);
    }),
    fetchAllRows<ConsignmentLotRecord>((from, to) => {
      let query = supabase
        .from('inventory_stock_lots')
        .select(lotSelect)
        .eq('ownership', 'store_owned')
        .order('received_at', { ascending: true });
      if (activeStoreId !== 'all') query = query.eq('store_id', activeStoreId);
      return query.range(from, to);
    }),
    fetchAllRows<ConsignmentAllocationRecord>((from, to) => {
      let query = supabase
        .from('sale_item_stock_allocations')
        .select('id,store_id,sale_item_id,lot_id,quantity_base_units,quantity_returned,unit_cost,ownership,supplier_id,created_at')
        .eq('ownership', 'consigned')
        .order('created_at', { ascending: true });
      if (activeStoreId !== 'all') query = query.eq('store_id', activeStoreId);
      return query.range(from, to);
    }),
    fetchAllRows<ConsignmentSupplierBalanceRecord>((from, to) => {
      let query = supabase
        .from('consignment_supplier_balances')
        .select('store_id,supplier_id,supplier_name,quantity_received,quantity_on_hand,quantity_sold,amount_due,amount_paid,outstanding_balance,supplier_credit')
        .order('supplier_name', { ascending: true });
      if (activeStoreId !== 'all') query = query.eq('store_id', activeStoreId);
      return query.range(from, to);
    }),
    fetchAllRows<ConsignmentPaymentRecord>((from, to) => {
      let query = supabase
        .from('consignment_supplier_payments')
        .select('id,store_id,supplier_id,amount,reference,note,paid_at')
        .order('paid_at', { ascending: false });
      if (activeStoreId !== 'all') query = query.eq('store_id', activeStoreId);
      return query.range(from, to);
    }, 100),
  ]);

  const saleItemIds = unique(allocations.map((row) => row.sale_item_id));
  const saleItems = await fetchRowsByIds<ConsignmentSaleItemRecord>(
    'sale_items',
    'id,sale_id,product_id,base_unit_quantity,line_total',
    'id',
    saleItemIds,
  );
  const saleIds = unique(saleItems.map((row) => row.sale_id));
  const sales = await fetchRowsByIds<ConsignmentSaleRecord>(
    'sales',
    'id,store_id,created_at,status',
    'id',
    saleIds,
  );

  const saleById = new Map(sales.map((row) => [row.id, row]));
  const saleItemById = new Map(saleItems.map((row) => [row.id, row]));
  const relevantAllocations = allocations.filter((allocation) => {
    const item = saleItemById.get(allocation.sale_item_id);
    const sale = item ? saleById.get(item.sale_id) : undefined;
    return Boolean(item && sale);
  });

  return {
    lots,
    storeOwnedLots,
    allocations: relevantAllocations,
    saleItems,
    sales,
    supplierBalances,
    payments,
  };
}

async function fetchRowsByIds<T>(table: string, select: string, key: string, ids: string[]): Promise<T[]> {
  if (ids.length === 0) return [];
  const rows: T[] = [];
  for (let start = 0; start < ids.length; start += ID_CHUNK_SIZE) {
    const chunk = ids.slice(start, start + ID_CHUNK_SIZE);
    const { data, error } = await supabase.from(table).select(select).in(key, chunk);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
  }
  return rows;
}

async function fetchAllRows<T>(
  queryPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryPage(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function emptyLedger(): ConsignmentLedger {
  return { lots: [], storeOwnedLots: [], allocations: [], saleItems: [], sales: [], supplierBalances: [], payments: [] };
}
