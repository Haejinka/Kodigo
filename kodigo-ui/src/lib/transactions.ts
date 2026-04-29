import { supabase } from '@/lib/supabase';
import type { CashierCloseout, PaymentMethod, SaleItem, SaleRecord } from '@/types';

const toSaleRecord = (row: any): SaleRecord => ({
  id: row.id,
  storeId: row.store_id,
  cashierId: row.cashier_id,
  subtotal: Number(row.subtotal ?? 0),
  tax: Number(row.tax ?? 0),
  discount: Number(row.discount ?? 0),
  total: Number(row.total ?? 0),
  cashReceived: Number(row.cash_received ?? 0),
  change: Number(row.change ?? 0),
  paymentMethod: row.payment_method ?? 'cash',
  paymentReference: row.payment_reference ?? undefined,
  discountType: row.discount_type ?? 'amount',
  discountValue: Number(row.discount_value ?? 0),
  taxRate: Number(row.tax_rate ?? 0),
  receiptNumber: row.receipt_number ?? undefined,
  status: row.status ?? 'completed',
  createdAt: row.created_at,
});

const toCloseout = (row: any): CashierCloseout => ({
  id: row.id,
  storeId: row.store_id,
  cashierId: row.cashier_id,
  periodStart: row.period_start,
  periodEnd: row.period_end,
  openingCash: Number(row.opening_cash ?? 0),
  cashSales: Number(row.cash_sales ?? 0),
  cashRefunds: Number(row.cash_refunds ?? 0),
  expectedCash: Number(row.expected_cash ?? 0),
  countedCash: Number(row.counted_cash ?? 0),
  variance: Number(row.variance ?? 0),
  notes: row.notes ?? '',
  createdAt: row.created_at,
});

export async function fetchRecentSales(storeId: string, limit = 50): Promise<SaleRecord[]> {
  const { data, error } = await supabase
    .from('sales')
    .select('*')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map(toSaleRecord);
}

export async function voidSale(saleId: string, reason: string): Promise<SaleRecord> {
  const { data, error } = await supabase.rpc('void_pos_sale', {
    p_sale_id: saleId,
    p_reason: reason,
  });
  if (error) throw error;
  return toSaleRecord(data);
}

export async function refundSale(
  saleId: string,
  amount: number,
  method: PaymentMethod,
  reason: string,
  reference?: string
): Promise<SaleRecord> {
  const { data, error } = await supabase.rpc('refund_pos_sale', {
    p_sale_id: saleId,
    p_amount: amount,
    p_method: method,
    p_reason: reason,
    p_reference: reference ?? null,
  });
  if (error) throw error;
  return toSaleRecord(data);
}

export async function fetchSaleItems(saleId: string): Promise<SaleItem[]> {
  const { data, error } = await supabase
    .from('sale_items')
    .select('id, product_id, product_name, category_name, selling_option_id, selling_option_label, unit_label, package_size, package_unit, stock_source, quantity, unit_price, cost_price, line_total')
    .eq('sale_id', saleId)
    .order('product_name', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    categoryName: row.category_name ?? undefined,
    sellingOptionId: row.selling_option_id ?? undefined,
    sellingOptionLabel: row.selling_option_label ?? undefined,
    unitLabel: row.unit_label ?? 'unit',
    packageSize: row.package_size == null ? undefined : Number(row.package_size),
    packageUnit: row.package_unit ?? undefined,
    stockSource: row.stock_source ?? undefined,
    quantity: Number(row.quantity ?? 0),
    unitPrice: Number(row.unit_price ?? 0),
    costPrice: Number(row.cost_price ?? 0),
    lineTotal: Number(row.line_total ?? 0),
  }));
}

export async function returnSaleItems(input: {
  saleId: string;
  items: Array<{ saleItemId: string; quantity: number; restock: boolean }>;
  reason: string;
  method: PaymentMethod;
  reference?: string;
}) {
  const { data, error } = await supabase.rpc('return_sale_items', {
    p_sale_id: input.saleId,
    p_items: input.items,
    p_reason: input.reason,
    p_refund_method: input.method,
    p_reference: input.reference ?? null,
  });
  if (error) throw error;
  return data;
}

export async function closeCashierShift(input: {
  storeId: string;
  countedCash: number;
  openingCash: number;
  notes?: string;
}): Promise<CashierCloseout> {
  const { data, error } = await supabase.rpc('close_cashier_shift', {
    p_store_id: input.storeId,
    p_counted_cash: input.countedCash,
    p_opening_cash: input.openingCash,
    p_notes: input.notes ?? null,
  });
  if (error) throw error;
  return toCloseout(data);
}
