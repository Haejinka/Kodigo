import { supabase } from '@/lib/supabase';
import {
  getSaleItemUnitLabel,
} from '@/types';
import { normalizeSaleLineQuantityToBaseUnits } from '@/lib/sales-velocity';
import type { PaymentMethod, PriceHistoryRecord, Product, SaleStatus, UserRole } from '@/types';
import type { Cell, Sheet } from 'write-excel-file/browser';

export type ReportStatusFilter = SaleStatus | 'all';

export interface ReportFilters {
  startDate: string;
  endDate: string;
  productId?: string;
  categoryName?: string;
  cashierId?: string;
  paymentMethod?: PaymentMethod | 'all';
  sellingUnitKey?: string;
  status?: ReportStatusFilter;
}

export interface SalesReportSummary {
  grossSales: number;
  discounts: number;
  tax: number;
  refunds: number;
  voidedSales: number;
  netSales: number;
  totalTransactions: number;
  completedTransactions: number;
  voidedTransactions: number;
  totalItemsSold: number;
  totalPackagesSold: number;
  returnedItems: number;
  netItemsSold: number;
  averageTransactionValue: number;
  grossProfit: number;
  totalCogs: number;
  grossMargin: number;
}

export interface SalesTransactionReportRow {
  saleId: string;
  receiptNumber: string;
  dateTime: string;
  cashierId: string | null;
  cashierName: string;
  paymentMethod: PaymentMethod;
  status: SaleStatus;
  itemCount: number;
  subtotal: number;
  discount: number;
  tax: number;
  refunds: number;
  total: number;
  netSales: number;
}

export interface SalesLineReportRow {
  saleId: string;
  saleItemId: string;
  receiptNumber: string;
  dateTime: string;
  productId: string | null;
  productName: string;
  categoryName: string;
  sellingUnitKey: string;
  sellingOptionLabel: string;
  unitLabel: string;
  baseUnitLabel: string;
  purchaseMode: 'unit' | 'bulk';
  packageSize?: number;
  packageUnit?: string;
  unitsPerPackage: number;
  regularUnitPrice: number;
  regularValue: number;
  bulkDiscountAmount: number;
  finalSellingPrice: number;
  stockSource?: string;
  quantity: number;
  baseUnitQuantity: number;
  returnedQuantity: number;
  returnedBaseUnitQuantity: number;
  netQuantity: number;
  netBaseUnitQuantity: number;
  unitPrice: number;
  costPrice: number;
  costPerBaseUnit: number;
  cogs: number;
  grossRevenue: number;
  discountAllocated: number;
  refundAllocated: number;
  netRevenue: number;
  grossProfit: number;
  grossMargin: number;
  status: SaleStatus;
  cashierId: string | null;
  cashierName: string;
  paymentMethod: PaymentMethod;
}

export interface SalesGroupReportRow {
  key: string;
  label: string;
  productId?: string | null;
  productName?: string;
  categoryName?: string;
  sellingUnitKey?: string;
  sellingOptionLabel?: string;
  unitLabel?: string;
  packageSize?: number;
  packageUnit?: string;
  quantity: number;
  baseUnitQuantity: number;
  returnedQuantity: number;
  returnedBaseUnitQuantity: number;
  netQuantity: number;
  netBaseUnitQuantity: number;
  grossRevenue: number;
  discounts: number;
  refunds: number;
  netRevenue: number;
  cost: number;
  grossProfit: number;
  grossMargin: number;
  transactions: number;
}

export interface DateSalesReportRow {
  date: string;
  grossSales: number;
  discounts: number;
  refunds: number;
  netSales: number;
  transactions: number;
  itemsSold: number;
  grossProfit: number;
}

export interface PaymentSalesReportRow {
  method: PaymentMethod;
  captured: number;
  refunds: number;
  net: number;
  transactions: number;
}

export interface CashierSalesReportRow {
  cashierId: string | null;
  cashierName: string;
  grossSales: number;
  refunds: number;
  netSales: number;
  transactions: number;
  itemsSold: number;
}

export interface SalesReportData {
  filters: ReportFilters;
  generatedAt: string;
  summary: SalesReportSummary;
  transactions: SalesTransactionReportRow[];
  saleLines: SalesLineReportRow[];
  salesByDate: DateSalesReportRow[];
  salesByProduct: SalesGroupReportRow[];
  salesByCategory: SalesGroupReportRow[];
  salesBySellingUnit: SalesGroupReportRow[];
  salesByCashier: CashierSalesReportRow[];
  salesByPaymentMethod: PaymentSalesReportRow[];
  riceUnitSales: SalesGroupReportRow[];
}

export interface InventoryReportRow {
  productId: string;
  productName: string;
  categoryName: string;
  sellingUnitKey: string;
  sellingOptionLabel: string;
  unitLabel: string;
  packageSize?: number;
  packageUnit?: string;
  stockQuantity: number;
  lowStockThreshold: number;
  stockStatus: 'in-stock' | 'low-stock' | 'out-of-stock';
  sellingPrice: number;
  costPrice: number;
}

export interface StockMovementReportRow {
  id: string;
  dateTime: string;
  productId: string | null;
  productName: string;
  sellingUnitKey: string;
  sellingOptionLabel: string;
  unitLabel: string;
  packageSize?: number;
  packageUnit?: string;
  movementType: string;
  quantityDelta: number;
  stockBefore: number;
  stockAfter: number;
  note: string;
}

export interface RestockReportRow {
  id: string;
  dateTime: string;
  productId: string;
  productName: string;
  restockingUnit: string;
  conversionFactor: number;
  quantityReceived: number;
  baseUnitsAdded: number;
  totalSupplierCost: number;
  supplierCostPerUnit: number;
  priorCostPerBaseUnit: number;
  newCostPerBaseUnit: number;
  stockBefore: number;
  stockAfter: number;
  suggestedSellingPrice: number;
  note: string;
}

interface SaleRow {
  id: string;
  store_id: string;
  cashier_id: string | null;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  payment_method: PaymentMethod;
  receipt_number: string | null;
  status: SaleStatus;
  created_at: string;
}

interface SaleItemRow {
  id: string;
  sale_id: string;
  product_id: string | null;
  product_name: string;
  category_name: string | null;
  selling_option_id: string | null;
  selling_option_label: string | null;
  unit_label: string | null;
  package_size: number | null;
  package_unit: string | null;
  stock_source: string | null;
  purchase_mode: 'unit' | 'bulk' | null;
  bulk_option_id: string | null;
  bulk_option_label: string | null;
  bulk_quantity: number | null;
  units_per_package: number | null;
  base_unit_quantity: number | null;
  regular_unit_price: number | null;
  regular_value: number | null;
  bulk_discount_type: 'percent' | 'amount' | null;
  bulk_discount_value: number | null;
  bulk_discount_amount: number | null;
  final_selling_price: number | null;
  base_unit_label: string | null;
  cost_per_base_unit: number | null;
  cogs: number | null;
  gross_profit: number | null;
  gross_margin: number | null;
  quantity: number;
  unit_price: number;
  cost_price: number | null;
  line_total: number;
}

interface SalePaymentRow {
  sale_id: string;
  method: PaymentMethod;
  status: 'captured' | 'refunded' | 'voided';
  amount: number;
}

interface SaleReturnItemRow {
  sale_item_id: string;
  quantity: number;
}

const currencyFormat = '"PHP" #,##0.00;[Red]-"PHP" #,##0.00';
const decimalFormat = '#,##0.###';
const percentFormat = '0.00%';

type ReportWorkbookSheet = Sheet<Blob>;

const zeroSummary: SalesReportSummary = {
  grossSales: 0,
  discounts: 0,
  tax: 0,
  refunds: 0,
  voidedSales: 0,
  netSales: 0,
  totalTransactions: 0,
  completedTransactions: 0,
  voidedTransactions: 0,
  totalItemsSold: 0,
  totalPackagesSold: 0,
  returnedItems: 0,
  netItemsSold: 0,
  averageTransactionValue: 0,
  grossProfit: 0,
  totalCogs: 0,
  grossMargin: 0,
};

export function canAccessReports(role: UserRole | null): boolean {
  return role === 'admin' || role === 'inventory';
}

export function getDefaultReportFilters(): ReportFilters {
  const today = toDateInput(new Date());
  return { startDate: today, endDate: today, paymentMethod: 'all', status: 'all' };
}

export function toDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDateRangeForDays(days: number): Pick<ReportFilters, 'startDate' | 'endDate'> {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - Math.max(0, days - 1));
  return { startDate: toDateInput(start), endDate: toDateInput(end) };
}

export function getSellingUnitKey(input: {
  sellingOptionId?: string | null;
  sellingOptionLabel?: string | null;
  unitLabel?: string | null;
  packageSize?: number | null;
  packageUnit?: string | null;
}): string {
  return [
    input.sellingOptionId || 'snapshot',
    input.sellingOptionLabel || '',
    input.unitLabel || 'unit',
    input.packageSize ?? '',
    input.packageUnit || '',
  ].join('|');
}

/** A cross-product unit filter key. Base units group by unit label; packages
 * group by their displayed selling-option label and base-unit quantity. */
export function getSellingUnitFilterKey(input: {
  sellingOptionLabel?: string | null;
  unitLabel?: string | null;
  packageSize?: number | null;
  packageUnit?: string | null;
}): string {
  const unit = (input.unitLabel || 'unit').trim().toLowerCase();
  const packageSize = Number(input.packageSize) || 0;
  if (packageSize > 1) {
    const optionLabel = (input.sellingOptionLabel || '').trim().toLowerCase();
    const packageUnit = (input.packageUnit || unit).trim().toLowerCase();
    return `package|${optionLabel}|${packageSize}|${packageUnit}`;
  }
  return `base|${unit}`;
}

export function getSellingUnitFilterLabel(input: {
  sellingOptionLabel?: string | null;
  unitLabel?: string | null;
  packageSize?: number | null;
  packageUnit?: string | null;
}): string {
  const unit = input.unitLabel || 'unit';
  const packageSize = Number(input.packageSize) || 0;
  if (packageSize > 1) {
    const label = (input.sellingOptionLabel || '').trim();
    const packageUnit = input.packageUnit || unit;
    const pluralUnit = packageUnit.toLowerCase().endsWith('y')
      ? `${packageUnit.slice(0, -1)}ies`
      : `${packageUnit}${packageUnit.toLowerCase().endsWith('s') ? '' : 's'}`;
    return label ? `${label} (${packageSize} ${pluralUnit})` : `${packageSize} ${pluralUnit}`;
  }
  return `${unit} (base unit)`;
}

export function describeSellingUnit(input: {
  sellingOptionLabel?: string | null;
  unitLabel?: string | null;
  packageSize?: number | null;
  packageUnit?: string | null;
}): string {
  if (input.sellingOptionLabel?.trim()) return input.sellingOptionLabel.trim();
  return getSaleItemUnitLabel({
    unitLabel: input.unitLabel || 'unit',
    packageSize: input.packageSize == null ? undefined : input.packageSize,
    packageUnit: input.packageUnit || undefined,
  });
}

export async function fetchRestockHistoryReport(
  filters: ReportFilters,
  activeStoreId: string | 'all' | null,
): Promise<RestockReportRow[]> {
  const { startIso, endIso } = normalizeDateRange(filters);
  let query = supabase
    .from('restock_history')
    .select('id,store_id,product_id,purchase_unit,pieces_per_purchase_unit,quantity_in_purchase_units,pieces_added,total_supplier_cost,cost_before,cost_after,suggested_selling_price,stock_before,stock_after,note,restocked_at')
    .gte('restocked_at', startIso)
    .lte('restocked_at', endIso)
    .order('restocked_at', { ascending: false })
    .limit(2000);
  if (activeStoreId && activeStoreId !== 'all') query = query.eq('store_id', activeStoreId);
  if (filters.productId) query = query.eq('product_id', filters.productId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    dateTime: row.restocked_at,
    productId: row.product_id,
    productName: row.product_name || 'Unknown product',
    restockingUnit: row.purchase_unit || 'unit',
    conversionFactor: toNumber(row.pieces_per_purchase_unit) || 1,
    quantityReceived: toNumber(row.quantity_in_purchase_units),
    baseUnitsAdded: toNumber(row.pieces_added),
    totalSupplierCost: toNumber(row.total_supplier_cost ?? row.purchase_price_per_unit * row.quantity_in_purchase_units),
    supplierCostPerUnit: toNumber(row.purchase_price_per_unit),
    priorCostPerBaseUnit: toNumber(row.cost_before ?? row.purchase_price_per_piece),
    newCostPerBaseUnit: toNumber(row.cost_after ?? row.purchase_price_per_piece),
    stockBefore: toNumber(row.stock_before),
    stockAfter: toNumber(row.stock_after),
    suggestedSellingPrice: toNumber(row.suggested_selling_price),
    note: row.note || '',
  }));
}

export async function fetchPriceHistory(
  filters: ReportFilters,
  activeStoreId: string | 'all' | null,
): Promise<PriceHistoryRecord[]> {
  const { startIso, endIso } = normalizeDateRange(filters);
  let query = supabase
    .from('product_price_history')
    .select('id,store_id,product_id,product_name,change_type,previous_value,new_value,reason,created_by,created_at')
    .gte('created_at', startIso)
    .lte('created_at', endIso)
    .order('created_at', { ascending: false })
    .limit(2000);
  if (activeStoreId && activeStoreId !== 'all') query = query.eq('store_id', activeStoreId);
  if (filters.productId) query = query.eq('product_id', filters.productId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    storeId: row.store_id,
    productId: row.product_id,
    productName: row.product_name || 'Unknown product',
    changeType: row.change_type,
    previousValue: toNumber(row.previous_value),
    newValue: toNumber(row.new_value),
    reason: row.reason || '',
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
  }));
}

export function buildInventoryReport(products: Product[]): InventoryReportRow[] {
  return products.map((product) => ({
    productId: product.id,
    productName: product.name,
    categoryName: product.categoryName || 'Uncategorized',
    sellingUnitKey: getSellingUnitKey({
      sellingOptionId: `base:${product.id}`,
      sellingOptionLabel: `${product.unit} (base unit)`,
      unitLabel: product.unit,
    }),
    sellingOptionLabel: `${product.unit} (base unit)`,
    unitLabel: product.unit,
    stockQuantity: product.currentStock,
    lowStockThreshold: product.minStockLevel,
    stockStatus: product.currentStock === 0
      ? 'out-of-stock'
      : product.currentStock <= Math.max(product.minStockLevel, product.safetyStock)
        ? 'low-stock'
        : 'in-stock',
    sellingPrice: product.sellingPrice,
    costPrice: product.costPrice,
  }));
}

export async function fetchStockMovementReport(
  filters: ReportFilters,
  activeStoreId: string | 'all' | null,
): Promise<StockMovementReportRow[]> {
  const { startIso, endIso } = normalizeDateRange(filters);
  let query = supabase
    .from('inventory_movements')
    .select('id,product_id,product_name,selling_option_id,selling_option_label,unit_label,package_size,package_unit,movement_type,quantity_delta,stock_before,stock_after,note,created_at,store_id')
    .gte('created_at', startIso)
    .lte('created_at', endIso)
    .order('created_at', { ascending: false })
    .limit(2000);

  if (activeStoreId && activeStoreId !== 'all') query = query.eq('store_id', activeStoreId);
  if (filters.productId) query = query.eq('product_id', filters.productId);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    dateTime: row.created_at,
    productId: row.product_id ?? null,
    productName: row.product_name ?? 'Unknown product',
    sellingUnitKey: getSellingUnitKey({
      sellingOptionId: row.selling_option_id,
      sellingOptionLabel: row.selling_option_label,
      unitLabel: row.unit_label,
      packageSize: row.package_size == null ? undefined : Number(row.package_size),
      packageUnit: row.package_unit,
    }),
    sellingOptionLabel: row.selling_option_label || row.unit_label || 'unit',
    unitLabel: row.unit_label || 'unit',
    packageSize: row.package_size == null ? undefined : Number(row.package_size),
    packageUnit: row.package_unit || undefined,
    movementType: row.movement_type,
    quantityDelta: toNumber(row.quantity_delta),
    stockBefore: toNumber(row.stock_before),
    stockAfter: toNumber(row.stock_after),
    note: row.note || '',
  }));
}

export async function fetchSalesReport(
  filters: ReportFilters,
  activeStoreId: string | 'all' | null,
): Promise<SalesReportData> {
  const normalizedFilters = normalizeFilters(filters);
  const empty = createEmptySalesReport(normalizedFilters);
  if (!activeStoreId) return empty;

  const { startIso, endIso } = normalizeDateRange(normalizedFilters);
  let query = supabase
    .from('sales')
    .select('id,store_id,cashier_id,subtotal,tax,discount,total,payment_method,receipt_number,status,created_at')
    .gte('created_at', startIso)
    .lte('created_at', endIso)
    .order('created_at', { ascending: false })
    .limit(2000);

  if (activeStoreId !== 'all') query = query.eq('store_id', activeStoreId);
  if (normalizedFilters.cashierId) query = query.eq('cashier_id', normalizedFilters.cashierId);
  if (normalizedFilters.paymentMethod && normalizedFilters.paymentMethod !== 'all') {
    query = query.eq('payment_method', normalizedFilters.paymentMethod);
  }
  if (normalizedFilters.status && normalizedFilters.status !== 'all') {
    query = query.eq('status', normalizedFilters.status);
  }

  const { data: salesData, error: salesError } = await query;
  if (salesError) throw salesError;

  const sales = (salesData ?? []).map(mapSaleRow);
  if (sales.length === 0) return empty;

  const saleIds = sales.map((sale) => sale.id);
  const [items, payments, returnedItems, cashierNames] = await Promise.all([
    fetchSaleItems(saleIds),
    fetchSalePayments(saleIds),
    fetchReturnedItems(saleIds),
    fetchCashierNames(sales.map((sale) => sale.cashier_id).filter(Boolean) as string[]),
  ]);

  return buildSalesReport(normalizedFilters, sales, items, payments, returnedItems, cashierNames);
}

export interface SalesVelocityAggregateRow {
  productId: string;
  unitsSold: number;
}

export interface InventoryConsumptionHistoryRow {
  productId: string;
  unitsConsumed: number;
  trackingStartedAt: string;
}

/** Load all recorded base-stock depletion events for restock planning. */
export async function fetchInventoryConsumptionHistory(
  activeStoreId: string | 'all' | null,
): Promise<InventoryConsumptionHistoryRow[]> {
  const { data, error } = await supabase.rpc('get_inventory_consumption_history', {
    p_store_id: activeStoreId && activeStoreId !== 'all' ? activeStoreId : null,
  });
  if (error) throw error;

  return (data ?? [])
    .map((row: any) => ({
      productId: row.product_id,
      unitsConsumed: toNumber(row.units_consumed),
      trackingStartedAt: row.tracking_started_at,
    }))
    .filter((row: InventoryConsumptionHistoryRow) => row.productId && row.trackingStartedAt);
}

/**
 * Load already-aggregated base-unit sales for the velocity screen. The RPC is
 * intentionally separate from the financial report because inventory users can
 * view velocity without receiving direct access to sales transactions.
 */
export async function fetchSalesVelocity(
  days: number,
  activeStoreId: string | 'all' | null,
  products: Product[],
): Promise<SalesVelocityAggregateRow[]> {
  const range = getDateRangeForDays(days);
  const { startIso, endIso } = normalizeDateRange({ ...range, paymentMethod: 'all', status: 'completed' });
  const { data, error } = await supabase.rpc('get_sales_velocity', {
    p_store_id: activeStoreId === 'all' ? null : activeStoreId,
    p_start_at: startIso,
    p_end_at: endIso,
  });

  if (!error) {
    return (data ?? [])
      .map((row: any) => ({ productId: row.product_id, unitsSold: toNumber(row.units_sold) }))
      .filter((row: SalesVelocityAggregateRow) => row.productId && row.unitsSold > 0);
  }

  // Keep older environments usable until migration 32 is applied. The normal
  // path remains the database aggregate above, so the frontend never receives
  // historical transactions for a current installation.
  if (!isMissingVelocityRpcError(error)) throw error;

  const report = await fetchSalesReport(
    { ...range, paymentMethod: 'all', status: 'completed' },
    activeStoreId,
  );
  const productById = new Map(products.map((product) => [product.id, product]));
  const totals = new Map<string, number>();
  for (const line of report.saleLines) {
    if (!line.productId) continue;
    const product = productById.get(line.productId);
    if (!product) continue;
    const units = normalizeSaleLineQuantityToBaseUnits(line, product);
    if (units > 0) totals.set(line.productId, (totals.get(line.productId) ?? 0) + units);
  }
  return Array.from(totals, ([productId, unitsSold]) => ({ productId, unitsSold }));
}

export async function exportReportsWorkbook(input: {
  salesReport: SalesReportData;
  inventoryRows: InventoryReportRow[];
  stockMovements: StockMovementReportRow[];
  restockRows?: RestockReportRow[];
  priceHistory?: PriceHistoryRecord[];
  fileName?: string;
}) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const generatedAt = new Date(input.salesReport.generatedAt);
  const sheets: ReportWorkbookSheet[] = [
    buildRowsSheet('Sales Summary', buildSummarySheet(input.salesReport, generatedAt), true),
    buildObjectSheet('Transactions', input.salesReport.saleLines.map((row) => ({
      'Date/Time': formatDateTimeForReport(row.dateTime),
      'Transaction ID': row.saleId,
      Product: row.productName,
      'Base Unit': row.baseUnitLabel,
      'Sold As': row.sellingOptionLabel,
      'Quantity Sold': row.netQuantity,
      'Conversion Factor': row.unitsPerPackage,
      'Base Units Sold': row.netBaseUnitQuantity,
      'Selling Price at Time of Sale': row.finalSellingPrice,
      'Regular Value': row.regularValue,
      Discount: row.discountAllocated + row.bulkDiscountAmount,
      'Final Revenue': row.netRevenue,
      'Cost Per Base Unit at Time of Sale': row.costPerBaseUnit,
      COGS: row.cogs,
      'Gross Profit': row.grossProfit,
      'Gross Margin': row.grossMargin,
    }))),
    buildObjectSheet('Sales Transactions', input.salesReport.transactions.map((row) => ({
      Receipt: row.receiptNumber,
      Date: formatDateTimeForReport(row.dateTime),
      Cashier: row.cashierName,
      Payment: row.paymentMethod,
      Status: row.status,
      Items: row.itemCount,
      Subtotal: row.subtotal,
      Discount: row.discount,
      Tax: row.tax,
      Refunds: row.refunds,
      Total: row.total,
      'Net Sales': row.netSales,
    }))),
    buildObjectSheet('Product Sales', input.salesReport.salesByProduct.map(groupToExportRow)),
    buildObjectSheet('Category Sales', input.salesReport.salesByCategory.map(groupToExportRow)),
    buildObjectSheet('Cashier Sales', input.salesReport.salesByCashier.map((row) => ({
      Cashier: row.cashierName,
      Transactions: row.transactions,
      'Items Sold': row.itemsSold,
      'Gross Sales': row.grossSales,
      Refunds: row.refunds,
      'Net Sales': row.netSales,
    }))),
    buildObjectSheet('Payment Breakdown', input.salesReport.salesByPaymentMethod.map((row) => ({
      Method: row.method,
      Transactions: row.transactions,
      Captured: row.captured,
      Refunds: row.refunds,
      Net: row.net,
    }))),
    buildObjectSheet('Profit', input.salesReport.salesByProduct.map((row) => ({
      Product: row.productName || row.label,
      Category: row.categoryName || 'Uncategorized',
      Unit: describeSellingUnit(row),
      'Net Revenue': row.netRevenue,
      Cost: row.cost,
      'Gross Profit': row.grossProfit,
      'Gross Margin': row.grossMargin,
    }))),
    buildObjectSheet('Inventory', input.inventoryRows.map((row) => ({
      Product: row.productName,
      Category: row.categoryName,
      Unit: describeSellingUnit(row),
      Stock: row.stockQuantity,
      'Low Stock Threshold': row.lowStockThreshold,
      Status: row.stockStatus,
      'Selling Price': row.sellingPrice,
      'Purchase Price': row.costPrice,
    }))),
    buildObjectSheet('Inventory Movement', input.stockMovements.map((row) => ({
      Date: formatDateTimeForReport(row.dateTime),
      Product: row.productName,
      Unit: describeSellingUnit(row),
      Type: row.movementType,
      Change: row.quantityDelta,
      Before: row.stockBefore,
      After: row.stockAfter,
      Note: row.note,
    }))),
    buildObjectSheet('Restocking', (input.restockRows ?? []).map((row) => ({
      'Date/Time': formatDateTimeForReport(row.dateTime),
      Product: row.productName,
      'Restocking Unit': row.restockingUnit,
      'Conversion Factor': row.conversionFactor,
      'Quantity Received': row.quantityReceived,
      'Base Units Added': row.baseUnitsAdded,
      'Total Supplier Cost': row.totalSupplierCost,
      'Cost / Restocking Unit': row.supplierCostPerUnit,
      'Prior Cost / Base Unit': row.priorCostPerBaseUnit,
      'New Cost / Base Unit': row.newCostPerBaseUnit,
      'Stock Before': row.stockBefore,
      'Stock After': row.stockAfter,
      'Suggested Selling Price': row.suggestedSellingPrice,
      Note: row.note,
    }))),
    buildObjectSheet('Price History', (input.priceHistory ?? []).map((row) => ({
      'Date/Time': formatDateTimeForReport(row.createdAt),
      Product: row.productName,
      Type: row.changeType === 'supplier_cost' ? 'Supplier cost' : 'Selling price',
      'Previous Value': row.previousValue,
      'New Value': row.newValue,
      Reason: row.reason,
      'Changed By': row.createdBy || '',
    }))),
  ];

  if (input.salesReport.riceUnitSales.length > 0) {
    sheets.splice(7, 0, buildObjectSheet('Rice Unit Sales', input.salesReport.riceUnitSales.map(groupToExportRow)));
  }

  const fileName = input.fileName || `Kodigo-Reports-${input.salesReport.filters.startDate}-to-${input.salesReport.filters.endDate}.xlsx`;
  await writeXlsxFile(sheets, { fontFamily: 'Inter', fontSize: 11 }).toFile(fileName);
}

export async function exportSalesReportPdf(report: SalesReportData, fileName?: string) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  const bottom = pageHeight - margin;
  let y = margin;

  const currency = (amount: number) => `PHP ${Number(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const number = (amount: number) => Number(amount || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 });
  const percent = (value: number) => `${number(value * 100)}%`;
  const addContinuationHeader = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Sales Report | ${report.filters.startDate} to ${report.filters.endDate}`, margin, margin - 4);
    y = margin + 2;
  };
  const drawTable = (
    title: string,
    columns: Array<{ label: string; width: number; align?: 'left' | 'right' }>,
    rows: string[][],
  ) => {
    const headerHeight = 8;
    const drawHeader = () => {
      doc.setFillColor(37, 99, 235);
      doc.rect(margin, y, contentWidth, headerHeight, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(255, 255, 255);
      let x = margin;
      for (const column of columns) {
        doc.text(column.label, x + 2, y + 5.2, { align: column.align === 'right' ? 'right' : 'left', maxWidth: column.width - 4 });
        x += column.width;
      }
      y += headerHeight;
    };

    if (y + 16 > bottom) {
      doc.addPage();
      addContinuationHeader();
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(title, margin, y + 4);
    y += 7;
    drawHeader();

    for (const row of rows.length ? rows : [['No matching records.']]) {
      const cellLines = columns.map((column, index) => doc.splitTextToSize(row[index] || '', column.width - 4) as string[]);
      const rowHeight = Math.max(7, ...cellLines.map((lines) => lines.length * 3.4 + 2));
      if (y + rowHeight > bottom) {
        doc.addPage();
        addContinuationHeader();
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(15, 23, 42);
        doc.text(`${title} (continued)`, margin, y + 4);
        y += 7;
        drawHeader();
      }
      doc.setDrawColor(226, 232, 240);
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, contentWidth, rowHeight, 'F');
      doc.line(margin, y + rowHeight, pageWidth - margin, y + rowHeight);
      let x = margin;
      columns.forEach((column, index) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(51, 65, 85);
        const textX = column.align === 'right' ? x + column.width - 2 : x + 2;
        doc.text(cellLines[index], textX, y + 4.5, {
          align: column.align === 'right' ? 'right' : 'left',
          lineHeightFactor: 1.15,
          maxWidth: column.width - 4,
        });
        x += column.width;
      });
      y += rowHeight;
    }
    y += 5;
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(15, 23, 42);
  doc.text('Sales Report', margin, y + 7);
  y += 12;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(`Period: ${report.filters.startDate} to ${report.filters.endDate}`, margin, y + 4);
  doc.text(`Generated: ${formatDateTimeForReport(report.generatedAt)}`, pageWidth - margin, y + 4, { align: 'right' });
  y += 10;

  const summary = report.summary;
  const summaryRows = [
    ['Gross sales', currency(summary.grossSales), 'Discounts', currency(summary.discounts)],
    ['Refunds', currency(summary.refunds), 'Net sales', currency(summary.netSales)],
    ['Tax', currency(summary.tax), 'COGS', currency(summary.totalCogs)],
    ['Gross profit', currency(summary.grossProfit), 'Gross margin', percent(summary.grossMargin)],
    ['Transactions', number(summary.totalTransactions), 'Items sold', number(summary.netItemsSold)],
    ['Average transaction', currency(summary.averageTransactionValue), 'Voided sales', currency(summary.voidedSales)],
  ];
  drawTable('Summary', [
    { label: 'Metric', width: 45 }, { label: 'Value', width: 91, align: 'right' },
    { label: 'Metric', width: 45 }, { label: 'Value', width: contentWidth - 181, align: 'right' },
  ], summaryRows);

  drawTable('Sales by Date', [
    { label: 'Date', width: 35 }, { label: 'Gross Sales', width: 39, align: 'right' },
    { label: 'Discounts', width: 35, align: 'right' }, { label: 'Refunds', width: 34, align: 'right' },
    { label: 'Net Sales', width: 39, align: 'right' }, { label: 'Transactions', width: 27, align: 'right' },
    { label: 'Items', width: 22, align: 'right' }, { label: 'Gross Profit', width: contentWidth - 231, align: 'right' },
  ], report.salesByDate.map((row) => [
    row.date, currency(row.grossSales), currency(row.discounts), currency(row.refunds), currency(row.netSales),
    number(row.transactions), number(row.itemsSold), currency(row.grossProfit),
  ]));

  drawTable('Sales by Product', [
    { label: 'Product', width: 61 }, { label: 'Sold as', width: 38 },
    { label: 'Packages', width: 23, align: 'right' }, { label: 'Base Units', width: 27, align: 'right' },
    { label: 'Net Sales', width: 38, align: 'right' }, { label: 'Cost', width: 34, align: 'right' },
    { label: 'Profit', width: 32, align: 'right' }, { label: 'Margin', width: contentWidth - 253, align: 'right' },
  ], report.salesByProduct.map((row) => [
    row.productName || row.label, describeSellingUnit(row), number(row.netQuantity), number(row.netBaseUnitQuantity),
    currency(row.netRevenue), currency(row.cost), currency(row.grossProfit), percent(row.grossMargin),
  ]));

  drawTable('Sales by Category', [
    { label: 'Category', width: 78 }, { label: 'Net Sales', width: 55, align: 'right' },
    { label: 'Gross Profit', width: 55, align: 'right' }, { label: 'Transactions', width: 42, align: 'right' },
    { label: 'Items Sold', width: contentWidth - 230, align: 'right' },
  ], report.salesByCategory.map((row) => [
    row.label, currency(row.netRevenue), currency(row.grossProfit), number(row.transactions), number(row.netQuantity),
  ]));

  drawTable('Sales by Payment Method', [
    { label: 'Payment Method', width: 78 }, { label: 'Transactions', width: 48, align: 'right' },
    { label: 'Captured', width: 48, align: 'right' }, { label: 'Refunds', width: 48, align: 'right' },
    { label: 'Net', width: contentWidth - 222, align: 'right' },
  ], report.salesByPaymentMethod.map((row) => [
    row.method.replace('_', ' '), number(row.transactions), currency(row.captured), currency(row.refunds), currency(row.net),
  ]));

  drawTable('Transactions', [
    { label: 'Date / Time', width: 39 }, { label: 'Receipt', width: 39 }, { label: 'Cashier', width: 43 },
    { label: 'Payment', width: 25 }, { label: 'Status', width: 31 }, { label: 'Items', width: 18, align: 'right' },
    { label: 'Total', width: 29, align: 'right' }, { label: 'Refunds', width: 25, align: 'right' },
    { label: 'Net Sales', width: contentWidth - 249, align: 'right' },
  ], report.transactions.map((row) => [
    formatDateTimeForReport(row.dateTime), row.receiptNumber, row.cashierName, row.paymentMethod.replace('_', ' '),
    row.status.replace('_', ' '), number(row.itemCount), currency(row.total), currency(row.refunds), currency(row.netSales),
  ]));

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(`Kodigo Sales Report | ${report.filters.startDate} to ${report.filters.endDate}`, margin, pageHeight - 5);
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 5, { align: 'right' });
  }

  doc.save(fileName || `Kodigo-Sales-Report-${report.filters.startDate}-to-${report.filters.endDate}.pdf`);
}

function buildSalesReport(
  filters: ReportFilters,
  sales: SaleRow[],
  items: SaleItemRow[],
  payments: SalePaymentRow[],
  returnedItems: SaleReturnItemRow[],
  cashierNames: Map<string, string>,
): SalesReportData {
  const saleById = new Map(sales.map((sale) => [sale.id, sale]));
  const allItemsBySale = groupItemsBySale(items);
  const returnedQuantityByItem = new Map<string, number>();
  for (const item of returnedItems) {
    returnedQuantityByItem.set(item.sale_item_id, (returnedQuantityByItem.get(item.sale_item_id) || 0) + toNumber(item.quantity));
  }

  const paymentRefundBySale = new Map<string, number>();
  const paymentsBySale = new Map<string, SalePaymentRow[]>();
  for (const payment of payments) {
    if (!paymentsBySale.has(payment.sale_id)) paymentsBySale.set(payment.sale_id, []);
    paymentsBySale.get(payment.sale_id)?.push(payment);
    if (payment.amount < 0 || payment.status === 'refunded') {
      paymentRefundBySale.set(payment.sale_id, (paymentRefundBySale.get(payment.sale_id) || 0) + Math.abs(payment.amount));
    }
  }

  const hasLineFilters = Boolean(filters.productId || filters.categoryName || filters.sellingUnitKey);
  const lineMatchesFilters = (item: SaleItemRow) => {
    if (filters.productId && item.product_id !== filters.productId) return false;
    if (filters.categoryName && (item.category_name || 'Uncategorized') !== filters.categoryName) return false;
    if (filters.sellingUnitKey && getItemUnitFilterKey(item) !== filters.sellingUnitKey) return false;
    return true;
  };

  const matchingItems = items.filter((item) => {
    const sale = saleById.get(item.sale_id);
    return sale && lineMatchesFilters(item);
  });
  const matchingSaleIds = hasLineFilters
    ? new Set(matchingItems.map((item) => item.sale_id))
    : new Set(sales.map((sale) => sale.id));

  const saleLines: SalesLineReportRow[] = [];
  const transactions: SalesTransactionReportRow[] = [];
  const dateMap = new Map<string, DateSalesReportRow>();
  const productMap = new Map<string, SalesGroupReportRow>();
  const categoryMap = new Map<string, SalesGroupReportRow>();
  const unitMap = new Map<string, SalesGroupReportRow>();
  const cashierMap = new Map<string, CashierSalesReportRow>();
  const paymentMap = new Map<PaymentMethod, PaymentSalesReportRow>();
  const summary: SalesReportSummary = { ...zeroSummary };
  const saleContributionFactors = new Map<string, number>();

  for (const sale of sales) {
    if (!matchingSaleIds.has(sale.id)) continue;

    const allSaleItems = allItemsBySale.get(sale.id) || [];
    const filteredSaleItems = hasLineFilters
      ? allSaleItems.filter(lineMatchesFilters)
      : allSaleItems;
    const allLineGross = sum(allSaleItems.map((item) => item.line_total)) || sale.subtotal || sale.total;
    const matchingLineGross = sum(filteredSaleItems.map((item) => item.line_total)) || (!hasLineFilters ? sale.subtotal : 0);
    const factor = allLineGross > 0 ? matchingLineGross / allLineGross : 1;
    saleContributionFactors.set(sale.id, factor);

    if (sale.status === 'voided') {
      summary.voidedTransactions += 1;
      summary.voidedSales += sale.total * factor;
      continue;
    }

    const refundAllocated = (paymentRefundBySale.get(sale.id) || 0) * factor;
    const discountAllocated = sale.discount * factor;
    const taxAllocated = sale.tax * factor;
    const totalAllocated = sale.total * factor;
    const packageQuantity = sum(filteredSaleItems.map((item) => item.quantity));
    const itemQuantity = sum(filteredSaleItems.map((item) => getBaseUnitQuantity(item)));
    const returnedQuantity = sum(filteredSaleItems.map((item) => getReturnedBaseUnitQuantity(item, returnedQuantityByItem.get(item.id) || 0)));
    const cost = sum(filteredSaleItems.map((item) => getNetCogs(item, returnedQuantityByItem.get(item.id) || 0)));
    const netSales = totalAllocated - refundAllocated;
    const grossProfit = matchingLineGross - discountAllocated - refundAllocated - cost;

    summary.completedTransactions += 1;
    summary.totalTransactions += 1;
    summary.grossSales += matchingLineGross;
    summary.discounts += discountAllocated;
    summary.tax += taxAllocated;
    summary.refunds += refundAllocated;
    summary.netSales += netSales;
    summary.totalPackagesSold += packageQuantity;
    summary.totalItemsSold += itemQuantity;
    summary.returnedItems += returnedQuantity;
    summary.netItemsSold += Math.max(0, itemQuantity - returnedQuantity);
    summary.grossProfit += grossProfit;
    summary.totalCogs += cost;

    transactions.push({
      saleId: sale.id,
      receiptNumber: sale.receipt_number || sale.id.slice(0, 8),
      dateTime: sale.created_at,
      cashierId: sale.cashier_id,
      cashierName: sale.cashier_id ? cashierNames.get(sale.cashier_id) || 'Unknown cashier' : 'Unknown cashier',
      paymentMethod: sale.payment_method,
      status: sale.status,
      itemCount: itemQuantity,
      subtotal: matchingLineGross,
      discount: discountAllocated,
      tax: taxAllocated,
      refunds: refundAllocated,
      total: totalAllocated,
      netSales,
    });

    const dateKey = sale.created_at.slice(0, 10);
    const dateRow = getOrSet(dateMap, dateKey, {
      date: dateKey,
      grossSales: 0,
      discounts: 0,
      refunds: 0,
      netSales: 0,
      transactions: 0,
      itemsSold: 0,
      grossProfit: 0,
    });
    dateRow.grossSales += matchingLineGross;
    dateRow.discounts += discountAllocated;
    dateRow.refunds += refundAllocated;
    dateRow.netSales += netSales;
    dateRow.transactions += 1;
    dateRow.itemsSold += itemQuantity;
    dateRow.grossProfit += grossProfit;

    const cashierKey = sale.cashier_id || 'unknown';
    const cashierRow = getOrSet(cashierMap, cashierKey, {
      cashierId: sale.cashier_id,
      cashierName: sale.cashier_id ? cashierNames.get(sale.cashier_id) || 'Unknown cashier' : 'Unknown cashier',
      grossSales: 0,
      refunds: 0,
      netSales: 0,
      transactions: 0,
      itemsSold: 0,
    });
    cashierRow.grossSales += matchingLineGross;
    cashierRow.refunds += refundAllocated;
    cashierRow.netSales += netSales;
    cashierRow.transactions += 1;
    cashierRow.itemsSold += itemQuantity;
  }

  for (const item of matchingItems) {
    const sale = saleById.get(item.sale_id);
    if (!sale || sale.status === 'voided') continue;

    const allSaleItems = allItemsBySale.get(item.sale_id) || [];
    const allLineGross = sum(allSaleItems.map((line) => line.line_total)) || sale.subtotal || sale.total;
    const returnedQuantity = returnedQuantityByItem.get(item.id) || 0;
    const lineShare = allLineGross > 0 ? item.line_total / allLineGross : 0;
    const lineDiscount = sale.discount * lineShare;
    const lineRefund = (paymentRefundBySale.get(sale.id) || 0) * lineShare;
    const netRevenue = item.line_total - lineDiscount - lineRefund;
    const cost = getNetCogs(item, returnedQuantity);
    const line = mapSaleLine(item, sale, cashierNames, returnedQuantity, lineDiscount, lineRefund, netRevenue, cost);
    saleLines.push(line);

    addLineToGroup(productMap, getProductGroupKey(item), getProductGroupLabel(item), line, false, true);
    addLineToGroup(categoryMap, item.category_name || 'Uncategorized', item.category_name || 'Uncategorized', line);
    categoryMap.get(item.category_name || 'Uncategorized')!.productName = undefined;
    addLineToGroup(unitMap, getItemUnitKey(item), `${item.product_name} - ${describeSellingUnit(line)}`, line);
    if (isRiceLine(line)) {
      addLineToGroup(unitMap, `rice:${getItemUnitKey(item)}:${item.product_id || item.product_name}`, `${item.product_name} - ${describeSellingUnit(line)}`, line, true);
    }
  }

  for (const [saleId, salePayments] of paymentsBySale.entries()) {
    const sale = saleById.get(saleId);
    if (!sale || sale.status === 'voided' || !matchingSaleIds.has(saleId)) continue;
    const factor = saleContributionFactors.get(saleId) ?? 1;
    for (const payment of salePayments) {
      const row = getOrSet(paymentMap, payment.method, {
        method: payment.method,
        captured: 0,
        refunds: 0,
        net: 0,
        transactions: 0,
      });
      const amount = payment.amount * factor;
      if (amount >= 0 && payment.status === 'captured') {
        row.captured += amount;
        row.transactions += 1;
      } else {
        row.refunds += Math.abs(amount);
      }
      row.net = row.captured - row.refunds;
    }
  }

  summary.averageTransactionValue = summary.totalTransactions ? summary.netSales / summary.totalTransactions : 0;
  summary.grossMargin = summary.netSales > 0 ? summary.grossProfit / summary.netSales : 0;

  return {
    filters,
    generatedAt: new Date().toISOString(),
    summary: roundSummary(summary),
    transactions: transactions.sort((a, b) => b.dateTime.localeCompare(a.dateTime)),
    saleLines: saleLines.sort((a, b) => b.dateTime.localeCompare(a.dateTime)),
    salesByDate: Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date)).map(roundDateRow),
    salesByProduct: finalizeGroups(productMap),
    salesByCategory: finalizeGroups(categoryMap),
    salesBySellingUnit: finalizeGroups(unitMap).filter((row) => !row.key.startsWith('rice:')),
    salesByCashier: Array.from(cashierMap.values()).sort((a, b) => b.netSales - a.netSales).map(roundCashierRow),
    salesByPaymentMethod: Array.from(paymentMap.values()).sort((a, b) => b.net - a.net).map(roundPaymentRow),
    riceUnitSales: finalizeGroups(unitMap).filter((row) => row.key.startsWith('rice:')),
  };
}

function mapSaleLine(
  item: SaleItemRow,
  sale: SaleRow,
  cashierNames: Map<string, string>,
  returnedQuantity: number,
  discountAllocated: number,
  refundAllocated: number,
  netRevenue: number,
  cost: number,
): SalesLineReportRow {
  const grossProfit = netRevenue - cost;
  const unitsPerPackage = Math.max(1, toNumber(item.units_per_package ?? item.package_size ?? 1));
  const baseUnitQuantity = Math.max(0, toNumber(item.base_unit_quantity ?? item.quantity * unitsPerPackage));
  const returnedBaseUnitQuantity = returnedQuantity * unitsPerPackage;
  const costPerBaseUnit = item.cost_per_base_unit == null
    ? (item.cost_price || 0) / unitsPerPackage
    : toNumber(item.cost_per_base_unit);
  const regularUnitPrice = toNumber(item.regular_unit_price ?? item.unit_price);
  const regularValue = toNumber(item.regular_value ?? regularUnitPrice * baseUnitQuantity);
  const finalSellingPrice = toNumber(item.final_selling_price ?? item.unit_price);
  return {
    saleId: sale.id,
    saleItemId: item.id,
    receiptNumber: sale.receipt_number || sale.id.slice(0, 8),
    dateTime: sale.created_at,
    productId: item.product_id,
    productName: item.product_name,
    categoryName: item.category_name || 'Uncategorized',
    sellingUnitKey: getItemUnitKey(item),
    sellingOptionLabel: item.selling_option_label || item.unit_label || 'unit',
    unitLabel: item.unit_label || 'unit',
    baseUnitLabel: item.base_unit_label || item.unit_label || 'unit',
    purchaseMode: item.purchase_mode || (unitsPerPackage > 1 ? 'bulk' : 'unit'),
    packageSize: item.package_size == null ? undefined : item.package_size,
    packageUnit: item.package_unit || undefined,
    unitsPerPackage,
    regularUnitPrice,
    regularValue,
    bulkDiscountAmount: toNumber(item.bulk_discount_amount),
    finalSellingPrice,
    stockSource: item.stock_source || undefined,
    quantity: item.quantity,
    baseUnitQuantity,
    returnedQuantity,
    returnedBaseUnitQuantity,
    netQuantity: Math.max(0, item.quantity - returnedQuantity),
    netBaseUnitQuantity: Math.max(0, baseUnitQuantity - returnedBaseUnitQuantity),
    unitPrice: item.unit_price,
    costPrice: item.cost_price || 0,
    costPerBaseUnit,
    cogs: cost,
    grossRevenue: item.line_total,
    discountAllocated,
    refundAllocated,
    netRevenue,
    grossProfit,
    grossMargin: netRevenue > 0 ? grossProfit / netRevenue : 0,
    status: sale.status,
    cashierId: sale.cashier_id,
    cashierName: sale.cashier_id ? cashierNames.get(sale.cashier_id) || 'Unknown cashier' : 'Unknown cashier',
    paymentMethod: sale.payment_method,
  };
}

function addLineToGroup(
  map: Map<string, SalesGroupReportRow>,
  key: string,
  label: string,
  line: SalesLineReportRow,
  keepKey = false,
  mergePurchaseModes = false,
) {
  const row = getOrSet(map, keepKey ? key : key, {
    key,
    label,
    productId: line.productId,
    productName: line.productName,
    categoryName: line.categoryName,
    sellingUnitKey: line.sellingUnitKey,
    sellingOptionLabel: line.sellingOptionLabel,
    unitLabel: line.unitLabel,
    packageSize: line.packageSize,
     packageUnit: line.packageUnit,
     quantity: 0,
     baseUnitQuantity: 0,
     returnedQuantity: 0,
     returnedBaseUnitQuantity: 0,
     netQuantity: 0,
     netBaseUnitQuantity: 0,
    grossRevenue: 0,
    discounts: 0,
    refunds: 0,
    netRevenue: 0,
    cost: 0,
    grossProfit: 0,
    grossMargin: 0,
    transactions: 0,
  });
  row.quantity += line.quantity;
  row.baseUnitQuantity += line.baseUnitQuantity;
  row.returnedQuantity += line.returnedQuantity;
  row.returnedBaseUnitQuantity += line.returnedBaseUnitQuantity;
  row.netQuantity += line.netQuantity;
  row.netBaseUnitQuantity += line.netBaseUnitQuantity;
  row.grossRevenue += line.grossRevenue;
  row.discounts += line.discountAllocated;
  row.refunds += line.refundAllocated;
  row.netRevenue += line.netRevenue;
  row.cost += line.cogs;
  row.grossProfit += line.grossProfit;
  row.transactions += 1;
  if (mergePurchaseModes && row.sellingOptionLabel !== line.sellingOptionLabel) {
    row.sellingOptionLabel = 'Multiple purchase modes';
    row.packageSize = undefined;
    row.packageUnit = undefined;
  }
}

function finalizeGroups(map: Map<string, SalesGroupReportRow[]> | Map<string, SalesGroupReportRow>) {
  return Array.from(map.values() as Iterable<SalesGroupReportRow>)
    .map((row) => ({
      ...row,
      quantity: round(row.quantity),
      baseUnitQuantity: round(row.baseUnitQuantity, 3),
      returnedQuantity: round(row.returnedQuantity),
      returnedBaseUnitQuantity: round(row.returnedBaseUnitQuantity, 3),
      netQuantity: round(row.netQuantity),
      netBaseUnitQuantity: round(row.netBaseUnitQuantity, 3),
      grossRevenue: round(row.grossRevenue),
      discounts: round(row.discounts),
      refunds: round(row.refunds),
      netRevenue: round(row.netRevenue),
      cost: round(row.cost),
      grossProfit: round(row.grossProfit),
      grossMargin: row.netRevenue > 0 ? round(row.grossProfit / row.netRevenue, 4) : 0,
    }))
    .sort((a, b) => b.netRevenue - a.netRevenue);
}

async function fetchSaleItems(saleIds: string[]): Promise<SaleItemRow[]> {
  const { data, error } = await supabase
    .from('sale_items')
    .select('id,sale_id,product_id,product_name,category_name,selling_option_id,selling_option_label,unit_label,base_unit_label,package_size,package_unit,stock_source,purchase_mode,bulk_option_id,bulk_option_label,bulk_quantity,units_per_package,base_unit_quantity,regular_unit_price,regular_value,bulk_discount_type,bulk_discount_value,bulk_discount_amount,final_selling_price,cost_per_base_unit,cogs,gross_profit,gross_margin,quantity,unit_price,cost_price,line_total')
    .in('sale_id', saleIds)
    .limit(5000);

  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    sale_id: row.sale_id,
    product_id: row.product_id,
    product_name: row.product_name || 'Unknown product',
    category_name: row.category_name || 'Uncategorized',
    selling_option_id: row.selling_option_id ?? null,
    selling_option_label: row.selling_option_label ?? null,
    unit_label: row.unit_label ?? 'unit',
    base_unit_label: row.base_unit_label ?? row.unit_label ?? 'unit',
    package_size: row.package_size == null ? null : toNumber(row.package_size),
    package_unit: row.package_unit ?? null,
    stock_source: row.stock_source ?? null,
    purchase_mode: row.purchase_mode ?? null,
    bulk_option_id: row.bulk_option_id ?? null,
    bulk_option_label: row.bulk_option_label ?? null,
    bulk_quantity: row.bulk_quantity == null ? null : toNumber(row.bulk_quantity),
    units_per_package: row.units_per_package == null ? null : toNumber(row.units_per_package),
    base_unit_quantity: row.base_unit_quantity == null ? null : toNumber(row.base_unit_quantity),
    regular_unit_price: row.regular_unit_price == null ? null : toNumber(row.regular_unit_price),
    regular_value: row.regular_value == null ? null : toNumber(row.regular_value),
    bulk_discount_type: row.bulk_discount_type ?? null,
    bulk_discount_value: row.bulk_discount_value == null ? null : toNumber(row.bulk_discount_value),
    bulk_discount_amount: row.bulk_discount_amount == null ? null : toNumber(row.bulk_discount_amount),
    final_selling_price: row.final_selling_price == null ? null : toNumber(row.final_selling_price),
    cost_per_base_unit: row.cost_per_base_unit == null ? null : toNumber(row.cost_per_base_unit),
    cogs: row.cogs == null ? null : toNumber(row.cogs),
    gross_profit: row.gross_profit == null ? null : toNumber(row.gross_profit),
    gross_margin: row.gross_margin == null ? null : toNumber(row.gross_margin),
    quantity: toNumber(row.quantity),
    unit_price: toNumber(row.unit_price),
    cost_price: toNumber(row.cost_price),
    line_total: toNumber(row.line_total),
  }));
}

async function fetchSalePayments(saleIds: string[]): Promise<SalePaymentRow[]> {
  const { data, error } = await supabase
    .from('sale_payments')
    .select('sale_id,method,status,amount')
    .in('sale_id', saleIds)
    .limit(5000);

  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    sale_id: row.sale_id,
    method: row.method || 'cash',
    status: row.status || 'captured',
    amount: toNumber(row.amount),
  }));
}

async function fetchReturnedItems(saleIds: string[]): Promise<SaleReturnItemRow[]> {
  const { data: returns, error: returnsError } = await supabase
    .from('sale_returns')
    .select('id')
    .in('sale_id', saleIds)
    .eq('status', 'completed')
    .limit(2000);

  if (returnsError) throw returnsError;
  const returnIds = (returns ?? []).map((row: any) => row.id);
  if (returnIds.length === 0) return [];

  const { data, error } = await supabase
    .from('sale_return_items')
    .select('sale_item_id,quantity')
    .in('return_id', returnIds)
    .limit(5000);

  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    sale_item_id: row.sale_item_id,
    quantity: toNumber(row.quantity),
  }));
}

async function fetchCashierNames(cashierIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(cashierIds));
  if (uniqueIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('profiles')
    .select('id,name')
    .in('id', uniqueIds)
    .limit(500);

  if (error) throw error;
  return new Map((data ?? []).map((row: any) => [row.id, row.name || 'Unknown cashier']));
}

function mapSaleRow(row: any): SaleRow {
  return {
    id: row.id,
    store_id: row.store_id,
    cashier_id: row.cashier_id ?? null,
    subtotal: toNumber(row.subtotal),
    tax: toNumber(row.tax),
    discount: toNumber(row.discount),
    total: toNumber(row.total),
    payment_method: row.payment_method || 'cash',
    receipt_number: row.receipt_number ?? null,
    status: row.status || 'completed',
    created_at: row.created_at,
  };
}

function normalizeFilters(filters: ReportFilters): ReportFilters {
  return {
    ...filters,
    startDate: filters.startDate || getDefaultReportFilters().startDate,
    endDate: filters.endDate || filters.startDate || getDefaultReportFilters().endDate,
    paymentMethod: filters.paymentMethod || 'all',
    status: filters.status || 'all',
  };
}

function normalizeDateRange(filters: ReportFilters) {
  const start = new Date(`${filters.startDate}T00:00:00`);
  const end = new Date(`${filters.endDate || filters.startDate}T23:59:59.999`);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function isMissingVelocityRpcError(error: { code?: string; message?: string }) {
  return error.code === '42883'
    || error.code === 'PGRST202'
    || /get_sales_velocity/i.test(error.message || '');
}

function createEmptySalesReport(filters: ReportFilters): SalesReportData {
  return {
    filters,
    generatedAt: new Date().toISOString(),
    summary: { ...zeroSummary },
    transactions: [],
    saleLines: [],
    salesByDate: [],
    salesByProduct: [],
    salesByCategory: [],
    salesBySellingUnit: [],
    salesByCashier: [],
    salesByPaymentMethod: [],
    riceUnitSales: [],
  };
}

function groupItemsBySale(items: SaleItemRow[]) {
  const map = new Map<string, SaleItemRow[]>();
  for (const item of items) {
    if (!map.has(item.sale_id)) map.set(item.sale_id, []);
    map.get(item.sale_id)?.push(item);
  }
  return map;
}

function getItemUnitKey(item: SaleItemRow): string {
  return getSellingUnitKey({
    sellingOptionId: item.selling_option_id,
    sellingOptionLabel: item.selling_option_label,
    unitLabel: item.unit_label,
    packageSize: item.package_size,
    packageUnit: item.package_unit,
  });
}

function getItemUnitFilterKey(item: SaleItemRow): string {
  return getSellingUnitFilterKey({
    sellingOptionLabel: item.selling_option_label,
    unitLabel: item.unit_label,
    packageSize: item.package_size,
    packageUnit: item.package_unit,
  });
}

function getProductGroupKey(item: SaleItemRow): string {
  return item.product_id || item.product_name;
}

function getProductGroupLabel(item: SaleItemRow): string {
  return item.product_name;
}

function getUnitsPerPackage(item: SaleItemRow): number {
  return Math.max(1, toNumber(item.units_per_package ?? item.package_size ?? 1));
}

function getBaseUnitQuantity(item: SaleItemRow): number {
  return Math.max(0, toNumber(item.base_unit_quantity ?? item.quantity * getUnitsPerPackage(item)));
}

function getReturnedBaseUnitQuantity(item: SaleItemRow, returnedPackages: number): number {
  return Math.max(0, returnedPackages) * getUnitsPerPackage(item);
}

function getNetCogs(item: SaleItemRow, returnedPackages: number): number {
  const netBaseUnits = Math.max(0, getBaseUnitQuantity(item) - getReturnedBaseUnitQuantity(item, returnedPackages));
  if (item.cost_per_base_unit != null) return toNumber(item.cost_per_base_unit) * netBaseUnits;
  return toNumber(item.cost_price) * Math.max(0, item.quantity - returnedPackages);
}

function isRiceLine(line: SalesLineReportRow) {
  return `${line.productName} ${line.categoryName}`.toLowerCase().includes('rice');
}

function getOrSet<K, V>(map: Map<K, V>, key: K, fallback: V): V {
  const existing = map.get(key);
  if (existing) return existing;
  map.set(key, fallback);
  return fallback;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + toNumber(value), 0);
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function roundSummary(summary: SalesReportSummary): SalesReportSummary {
  return {
    grossSales: round(summary.grossSales),
    discounts: round(summary.discounts),
    tax: round(summary.tax),
    refunds: round(summary.refunds),
    voidedSales: round(summary.voidedSales),
    netSales: round(summary.netSales),
    totalPackagesSold: round(summary.totalPackagesSold, 3),
    totalTransactions: summary.totalTransactions,
    completedTransactions: summary.completedTransactions,
    voidedTransactions: summary.voidedTransactions,
    totalItemsSold: round(summary.totalItemsSold, 3),
    returnedItems: round(summary.returnedItems, 3),
    netItemsSold: round(summary.netItemsSold, 3),
    averageTransactionValue: round(summary.averageTransactionValue),
    grossProfit: round(summary.grossProfit),
    totalCogs: round(summary.totalCogs),
    grossMargin: round(summary.grossMargin, 4),
  };
}

function roundDateRow(row: DateSalesReportRow): DateSalesReportRow {
  return {
    ...row,
    grossSales: round(row.grossSales),
    discounts: round(row.discounts),
    refunds: round(row.refunds),
    netSales: round(row.netSales),
    itemsSold: round(row.itemsSold, 3),
    grossProfit: round(row.grossProfit),
  };
}

function roundCashierRow(row: CashierSalesReportRow): CashierSalesReportRow {
  return {
    ...row,
    grossSales: round(row.grossSales),
    refunds: round(row.refunds),
    netSales: round(row.netSales),
    itemsSold: round(row.itemsSold, 3),
  };
}

function roundPaymentRow(row: PaymentSalesReportRow): PaymentSalesReportRow {
  return {
    ...row,
    captured: round(row.captured),
    refunds: round(row.refunds),
    net: round(row.net),
  };
}

function buildSummarySheet(report: SalesReportData, generatedAt: Date) {
  const filters = report.filters;
  return [
    ['Kodigo Sales Report'],
    ['Generated', formatDateTimeForReport(generatedAt.toISOString())],
    ['Date Range', `${filters.startDate} to ${filters.endDate}`],
    ['Product Filter', filters.productId || 'All products'],
    ['Category Filter', filters.categoryName || 'All categories'],
    ['Cashier Filter', filters.cashierId || 'All cashiers'],
    ['Payment Filter', filters.paymentMethod || 'All payment methods'],
    ['Selling Unit Filter', filters.sellingUnitKey || 'All selling units'],
    ['Status Filter', filters.status || 'All statuses'],
    [],
    ['Metric', 'Value'],
    ['Net Sales', report.summary.netSales],
    ['Gross Sales', report.summary.grossSales],
    ['Discounts', report.summary.discounts],
    ['Refunds', report.summary.refunds],
    ['Voided Sales', report.summary.voidedSales],
    ['Tax', report.summary.tax],
    ['Transactions', report.summary.totalTransactions],
    ['Packages Sold', report.summary.totalPackagesSold],
    ['Items Sold', report.summary.totalItemsSold],
    ['Returned Items', report.summary.returnedItems],
    ['Net Items Sold', report.summary.netItemsSold],
    ['Average Transaction Value', report.summary.averageTransactionValue],
    ['Gross Profit', report.summary.grossProfit],
    ['Total COGS', report.summary.totalCogs],
    ['Gross Margin', report.summary.grossMargin],
  ];
}

function groupToExportRow(row: SalesGroupReportRow) {
  return {
    Product: row.productName || row.label,
    Category: row.categoryName || 'Uncategorized',
    Unit: describeSellingUnit(row),
    Packages: row.quantity,
    'Base Units': row.baseUnitQuantity,
    Returns: row.returnedQuantity,
    'Net Base Units': row.netBaseUnitQuantity,
    'Gross Revenue': row.grossRevenue,
    Discounts: row.discounts,
    Refunds: row.refunds,
    'Net Revenue': row.netRevenue,
    Cost: row.cost,
    'Gross Profit': row.grossProfit,
    'Gross Margin': row.grossMargin,
    Transactions: row.transactions,
  };
}

function buildRowsSheet(name: string, rows: unknown[][], isSummary = false): ReportWorkbookSheet {
  return {
    sheet: safeSheetName(name),
    data: rows.map((row, rowIndex) => {
      if (row.length === 0) return [];
      if (isSummary && rowIndex === 0) return [titleCell(String(row[0] || name))];

      const rowLabel = String(row[0] ?? '');
      const isHeader = isSummary && rowLabel === 'Metric' && String(row[1] ?? '') === 'Value';
      return row.map((value, columnIndex) => {
        if (isHeader) return headerCell(String(value ?? ''));
        return makeExcelCell(
          value,
          columnIndex === 0 ? 'label' : rowLabel,
          isSummary && columnIndex === 0 ? { fontWeight: 'bold' } : undefined,
        );
      });
    }),
    columns: getColumnWidths(rows),
    showGridLines: true,
  };
}

function buildObjectSheet(name: string, rows: Record<string, unknown>[]): ReportWorkbookSheet {
  const dataRows = rows.length > 0 ? rows : [{ Notice: 'No records match the selected filters.' }];
  const headers = Object.keys(dataRows[0] || {});
  const rawRows = [headers, ...dataRows.map((row) => headers.map((header) => row[header]))];

  return {
    sheet: safeSheetName(name),
    data: [
      headers.map((header) => headerCell(header)),
      ...dataRows.map((row) => headers.map((header) => makeExcelCell(row[header], header))),
    ],
    columns: getColumnWidths(rawRows),
    stickyRowsCount: 1,
    showGridLines: true,
  };
}

function getColumnWidths(rows: unknown[][]) {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      const length = String(cell ?? '').length;
      widths[index] = Math.min(42, Math.max(widths[index] || 10, length + 2));
    });
  }
  return widths.map((width) => ({ width }));
}

function titleCell(value: string): Cell {
  return {
    value,
    type: String,
    span: 2,
    align: 'center',
    fontSize: 16,
    fontWeight: 'bold',
    backgroundColor: '#EFF6FF',
    borderColor: '#E5E7EB',
    borderStyle: 'thin',
  };
}

function headerCell(value: string): Cell {
  return {
    value,
    type: String,
    fontWeight: 'bold',
    backgroundColor: '#EFF6FF',
    borderColor: '#E5E7EB',
    borderStyle: 'thin',
  };
}

function makeExcelCell(value: unknown, label: string, style: Record<string, unknown> = {}): Cell {
  const baseStyle = {
    borderColor: '#E5E7EB',
    borderStyle: 'thin',
    alignVertical: 'center',
    ...style,
  };

  if (typeof value === 'number') {
    return {
      ...baseStyle,
      value,
      type: Number,
      format: numberFormatForLabel(label),
    } as Cell;
  }

  if (value instanceof Date) {
    return {
      ...baseStyle,
      value,
      type: Date,
      format: 'mmm d, yyyy h:mm',
    } as Cell;
  }

  if (typeof value === 'boolean') {
    return {
      ...baseStyle,
      value,
      type: Boolean,
    } as Cell;
  }

  return {
    ...baseStyle,
    value: value == null ? '' : String(value),
    type: String,
  } as Cell;
}

function numberFormatForLabel(label: string) {
  const lowerLabel = label.toLowerCase();
  if (lowerLabel.includes('margin')) return percentFormat;
  if (
    lowerLabel.includes('sales') ||
    lowerLabel.includes('revenue') ||
    lowerLabel.includes('price') ||
    lowerLabel.includes('cost') ||
    lowerLabel.includes('profit') ||
    lowerLabel.includes('cogs') ||
    lowerLabel.includes('total') ||
    lowerLabel.includes('discount') ||
    lowerLabel.includes('refund') ||
    lowerLabel.includes('tax') ||
    lowerLabel.includes('captured') ||
    lowerLabel === 'net'
  ) {
    return currencyFormat;
  }
  return decimalFormat;
}

function safeSheetName(name: string) {
  return name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
}

function formatDateTimeForReport(value: string) {
  return new Intl.DateTimeFormat('en-PH', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
