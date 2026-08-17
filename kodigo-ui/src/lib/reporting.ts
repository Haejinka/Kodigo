import { supabase } from '@/lib/supabase';
import {
  getProductSellingOptions,
  getAvailableSellingUnits,
  getOptionPurchaseCost,
  getSaleItemUnitLabel,
  getSellingOptionLabel,
} from '@/types';
import type { PaymentMethod, Product, SaleStatus, UserRole } from '@/types';
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
  returnedItems: number;
  netItemsSold: number;
  averageTransactionValue: number;
  grossProfit: number;
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
  packageSize?: number;
  packageUnit?: string;
  quantity: number;
  returnedQuantity: number;
  netQuantity: number;
  unitPrice: number;
  costPrice: number;
  grossRevenue: number;
  discountAllocated: number;
  refundAllocated: number;
  netRevenue: number;
  grossProfit: number;
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
  returnedQuantity: number;
  netQuantity: number;
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
  returnedItems: 0,
  netItemsSold: 0,
  averageTransactionValue: 0,
  grossProfit: 0,
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

export function describeSellingUnit(input: {
  sellingOptionLabel?: string | null;
  unitLabel?: string | null;
  packageSize?: number | null;
  packageUnit?: string | null;
}): string {
  return getSaleItemUnitLabel({
    unitLabel: input.unitLabel || 'unit',
    packageSize: input.packageSize == null ? undefined : input.packageSize,
    packageUnit: input.packageUnit || undefined,
  });
}

export function buildInventoryReport(products: Product[]): InventoryReportRow[] {
  return products.flatMap((product) =>
    getProductSellingOptions(product).map((option) => {
      const availableStock = getAvailableSellingUnits(product, option);
      const stockStatus =
        availableStock === 0
          ? 'out-of-stock'
          : availableStock <= option.lowStockThreshold
            ? 'low-stock'
            : 'in-stock';

      return {
        productId: product.id,
        productName: product.name,
        categoryName: product.categoryName || 'Uncategorized',
        sellingUnitKey: getSellingUnitKey({
          sellingOptionId: option.id,
          sellingOptionLabel: getSellingOptionLabel(option),
          unitLabel: option.unitLabel,
          packageSize: option.quantityValue,
          packageUnit: option.quantityUnit,
        }),
        sellingOptionLabel: getSellingOptionLabel(option),
        unitLabel: option.unitLabel,
        packageSize: option.quantityValue,
        packageUnit: option.quantityUnit,
        stockQuantity: availableStock,
        lowStockThreshold: option.lowStockThreshold,
        stockStatus,
        sellingPrice: option.sellingPrice,
        costPrice: getOptionPurchaseCost(product, option),
      };
    })
  );
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

export async function exportReportsWorkbook(input: {
  salesReport: SalesReportData;
  inventoryRows: InventoryReportRow[];
  stockMovements: StockMovementReportRow[];
  fileName?: string;
}) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const generatedAt = new Date(input.salesReport.generatedAt);
  const sheets: ReportWorkbookSheet[] = [
    buildRowsSheet('Summary', buildSummarySheet(input.salesReport, generatedAt), true),
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
    buildObjectSheet('Stock Movements', input.stockMovements.map((row) => ({
      Date: formatDateTimeForReport(row.dateTime),
      Product: row.productName,
      Unit: describeSellingUnit(row),
      Type: row.movementType,
      Change: row.quantityDelta,
      Before: row.stockBefore,
      After: row.stockAfter,
      Note: row.note,
    }))),
  ];

  if (input.salesReport.riceUnitSales.length > 0) {
    sheets.splice(7, 0, buildObjectSheet('Rice Unit Sales', input.salesReport.riceUnitSales.map(groupToExportRow)));
  }

  const fileName = input.fileName || `Kodigo-Reports-${input.salesReport.filters.startDate}-to-${input.salesReport.filters.endDate}.xlsx`;
  await writeXlsxFile(sheets, { fontFamily: 'Inter', fontSize: 11 }).toFile(fileName);
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
    if (filters.sellingUnitKey && getItemUnitKey(item) !== filters.sellingUnitKey) return false;
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
    const itemQuantity = sum(filteredSaleItems.map((item) => item.quantity));
    const returnedQuantity = sum(filteredSaleItems.map((item) => returnedQuantityByItem.get(item.id) || 0));
    const cost = sum(filteredSaleItems.map((item) => (item.cost_price || 0) * Math.max(0, item.quantity - (returnedQuantityByItem.get(item.id) || 0))));
    const netSales = totalAllocated - refundAllocated;
    const grossProfit = matchingLineGross - discountAllocated - refundAllocated - cost;

    summary.completedTransactions += 1;
    summary.totalTransactions += 1;
    summary.grossSales += matchingLineGross;
    summary.discounts += discountAllocated;
    summary.tax += taxAllocated;
    summary.refunds += refundAllocated;
    summary.netSales += netSales;
    summary.totalItemsSold += itemQuantity;
    summary.returnedItems += returnedQuantity;
    summary.netItemsSold += Math.max(0, itemQuantity - returnedQuantity);
    summary.grossProfit += grossProfit;

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
    const netQuantity = Math.max(0, item.quantity - returnedQuantity);
    const netRevenue = item.line_total - lineDiscount - lineRefund;
    const cost = (item.cost_price || 0) * netQuantity;
    const line = mapSaleLine(item, sale, cashierNames, returnedQuantity, lineDiscount, lineRefund, netRevenue, cost);
    saleLines.push(line);

    addLineToGroup(productMap, getProductGroupKey(item), getProductGroupLabel(item), line);
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
    packageSize: item.package_size == null ? undefined : item.package_size,
    packageUnit: item.package_unit || undefined,
    quantity: item.quantity,
    returnedQuantity,
    netQuantity: Math.max(0, item.quantity - returnedQuantity),
    unitPrice: item.unit_price,
    costPrice: item.cost_price || 0,
    grossRevenue: item.line_total,
    discountAllocated,
    refundAllocated,
    netRevenue,
    grossProfit,
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
    returnedQuantity: 0,
    netQuantity: 0,
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
  row.returnedQuantity += line.returnedQuantity;
  row.netQuantity += line.netQuantity;
  row.grossRevenue += line.grossRevenue;
  row.discounts += line.discountAllocated;
  row.refunds += line.refundAllocated;
  row.netRevenue += line.netRevenue;
  row.cost += line.costPrice * line.netQuantity;
  row.grossProfit += line.grossProfit;
  row.transactions += 1;
}

function finalizeGroups(map: Map<string, SalesGroupReportRow[]> | Map<string, SalesGroupReportRow>) {
  return Array.from(map.values() as Iterable<SalesGroupReportRow>)
    .map((row) => ({
      ...row,
      quantity: round(row.quantity),
      returnedQuantity: round(row.returnedQuantity),
      netQuantity: round(row.netQuantity),
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
    .select('id,sale_id,product_id,product_name,category_name,selling_option_id,selling_option_label,unit_label,package_size,package_unit,quantity,unit_price,cost_price,line_total')
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
    package_size: row.package_size == null ? null : toNumber(row.package_size),
    package_unit: row.package_unit ?? null,
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

function getProductGroupKey(item: SaleItemRow): string {
  return [
    item.product_id || item.product_name,
    item.selling_option_id || item.selling_option_label || item.unit_label || 'unit',
    item.package_size ?? '',
    item.package_unit || '',
  ].join('|');
}

function getProductGroupLabel(item: SaleItemRow): string {
  return `${item.product_name} - ${describeSellingUnit({
    sellingOptionLabel: item.selling_option_label,
    unitLabel: item.unit_label,
    packageSize: item.package_size,
    packageUnit: item.package_unit,
  })}`;
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
    totalTransactions: summary.totalTransactions,
    completedTransactions: summary.completedTransactions,
    voidedTransactions: summary.voidedTransactions,
    totalItemsSold: round(summary.totalItemsSold, 3),
    returnedItems: round(summary.returnedItems, 3),
    netItemsSold: round(summary.netItemsSold, 3),
    averageTransactionValue: round(summary.averageTransactionValue),
    grossProfit: round(summary.grossProfit),
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
    ['Items Sold', report.summary.totalItemsSold],
    ['Returned Items', report.summary.returnedItems],
    ['Net Items Sold', report.summary.netItemsSold],
    ['Average Transaction Value', report.summary.averageTransactionValue],
    ['Gross Profit', report.summary.grossProfit],
    ['Gross Margin', report.summary.grossMargin],
  ];
}

function groupToExportRow(row: SalesGroupReportRow) {
  return {
    Product: row.productName || row.label,
    Category: row.categoryName || 'Uncategorized',
    Unit: describeSellingUnit(row),
    Quantity: row.quantity,
    Returns: row.returnedQuantity,
    'Net Quantity': row.netQuantity,
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
