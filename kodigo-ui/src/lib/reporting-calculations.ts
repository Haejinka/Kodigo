export type DashboardReportingPeriod = 'weekly' | 'monthly' | 'yearly';

export interface ReportPaymentEvent {
  status: string;
  amount: number;
}

export interface SaleLinePaymentInput {
  saleItemId: string;
  lineTotal: number;
}

export interface MonthlySalesLine {
  dateTime: string;
  productId: string | null;
  productName: string;
  baseUnitLabel: string;
  netBaseUnitQuantity: number;
  netRevenue: number;
  status: string;
}

export interface MonthlyTopProduct {
  key: string;
  productId: string | null;
  productName: string;
  baseUnitLabel: string;
  quantitySold: number;
  salesAmount: number;
}

export interface PosHardwarePreferences {
  receiptPrintingEnabled?: boolean;
  cashDrawerIntegrationEnabled?: boolean;
}

export function isValidSalesTransactionStatus(status: string) {
  return status === 'completed' || status === 'partially_refunded' || status === 'refunded';
}

/**
 * Allocate transaction payments back to their sale lines. Captures follow each
 * line's discounted historical amount; item returns use their recorded refund
 * value first; any remaining transaction-level refunds are spread over the
 * remaining captured amounts. Cent remainders are assigned deterministically
 * by sale-item id so the line totals always reconcile with the payment ledger.
 */
export function allocateSaleLineAmountPaid(
  lines: SaleLinePaymentInput[],
  saleDiscount: number,
  payments: ReportPaymentEvent[],
  returnAmountsByLine: Record<string, number>,
): Map<string, number> {
  const orderedLines = [...lines].sort((a, b) => a.saleItemId.localeCompare(b.saleItemId));
  if (orderedLines.length === 0) return new Map();

  const lineTotals = orderedLines.map((line) => Math.max(0, finite(line.lineTotal)));
  const grossTotal = lineTotals.reduce((sum, amount) => sum + amount, 0);
  const discount = Math.min(Math.max(0, finite(saleDiscount)), grossTotal);
  const discountedWeights = prorate(discount, lineTotals).map((allocated, index) => Math.max(0, lineTotals[index] - allocated));
  const captureTotal = payments.reduce((sum, payment) => (
    payment.status === 'captured' ? sum + Math.max(0, finite(payment.amount)) : sum
  ), 0);
  const refundTotal = payments.reduce((sum, payment) => (
    payment.status === 'refunded' ? sum + Math.abs(finite(payment.amount)) : sum
  ), 0);

  const capturedByLine = prorate(captureTotal, discountedWeights);
  const returnWeights = orderedLines.map((line) => Math.max(0, finite(returnAmountsByLine[line.saleItemId])));
  const recordedReturnTotal = returnWeights.reduce((sum, amount) => sum + amount, 0);
  const itemRefundTotal = Math.min(refundTotal, recordedReturnTotal);
  const returnedByLine = prorate(itemRefundTotal, returnWeights);
  const remainingRefund = Math.max(0, roundMoney(refundTotal - itemRefundTotal));
  const remainingWeights = capturedByLine.map((amount, index) => Math.max(0, amount - returnedByLine[index]));
  const manualRefundByLine = prorate(
    remainingRefund,
    remainingWeights.some((amount) => amount > 0) ? remainingWeights : discountedWeights,
  );

  return new Map(orderedLines.map((line, index) => [
    line.saleItemId,
    roundMoney(capturedByLine[index] - returnedByLine[index] - manualRefundByLine[index]),
  ]));
}

/** Return the inclusive calendar interval containing a reference date. Weeks start on Monday. */
export function getCalendarInterval(referenceDate: string, period: DashboardReportingPeriod) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(referenceDate);
  if (!match) return { startDate: referenceDate, endDate: referenceDate };

  const reference = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(reference.getTime())) return { startDate: referenceDate, endDate: referenceDate };

  const start = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const end = new Date(start);
  if (period === 'weekly') {
    const mondayOffset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - mondayOffset);
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6);
  } else if (period === 'monthly') {
    start.setDate(1);
    end.setMonth(end.getMonth() + 1, 0);
  } else {
    start.setMonth(0, 1);
    end.setMonth(11, 31);
  }

  return { startDate: toLocalDateInput(start), endDate: toLocalDateInput(end) };
}

/** Rank a selected month by net base units, keeping voided sales out of the result. */
export function getMonthlyTopProducts(lines: MonthlySalesLine[], month: string, limit = 10): MonthlyTopProduct[] {
  const grouped = new Map<string, MonthlyTopProduct>();
  for (const line of lines) {
    const date = new Date(line.dateTime);
    if (Number.isNaN(date.getTime()) || toLocalDateInput(date).slice(0, 7) !== month || !isValidSalesTransactionStatus(line.status)) continue;

    const quantity = Math.max(0, finite(line.netBaseUnitQuantity));
    if (quantity === 0) continue;
    const key = line.productId || line.productName.trim().toLowerCase();
    const row = grouped.get(key) ?? {
      key,
      productId: line.productId,
      productName: line.productName,
      baseUnitLabel: line.baseUnitLabel || 'unit',
      quantitySold: 0,
      salesAmount: 0,
    };
    row.quantitySold += quantity;
    row.salesAmount += finite(line.netRevenue);
    grouped.set(key, row);
  }

  return Array.from(grouped.values())
    .map((row) => ({ ...row, quantitySold: roundNumber(row.quantitySold, 3), salesAmount: roundMoney(row.salesAmount) }))
    .sort((a, b) => b.quantitySold - a.quantitySold || b.salesAmount - a.salesAmount || a.productName.localeCompare(b.productName))
    .slice(0, Math.max(0, limit));
}

export function getPosHardwareActions(preferences: PosHardwarePreferences, paymentMethod: string) {
  return {
    printReceipt: preferences.receiptPrintingEnabled !== false,
    openCashDrawer: preferences.cashDrawerIntegrationEnabled !== false && paymentMethod === 'cash',
  };
}

export function getSalesReportBaseUnitPrice(line: { grossRevenue: number; baseUnitQuantity: number }) {
  const quantity = finite(line.baseUnitQuantity);
  return quantity > 0 ? roundMoney(finite(line.grossRevenue) / quantity) : 0;
}

export function getSalesReportPaidTotal(lines: Array<{ amountPaid: number }>) {
  return roundMoney(lines.reduce((total, line) => total + finite(line.amountPaid), 0));
}

export function formatSalesReportPdfCurrency(amount: number) {
  const formattedAmount = new Intl.NumberFormat('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(finite(amount));
  // jsPDF's built-in Helvetica maps ₱ to ±, so use the ISO currency code in PDF text.
  return `PHP ${formattedAmount}`;
}

function prorate(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const totalCents = Math.round((finite(total) + Number.EPSILON) * 100);
  const safeWeights = weights.map((weight) => Math.max(0, finite(weight)));
  const weightTotal = safeWeights.reduce((sum, weight) => sum + weight, 0);
  const effectiveWeights = weightTotal > 0 ? safeWeights : safeWeights.map(() => 1);
  const effectiveTotal = effectiveWeights.reduce((sum, weight) => sum + weight, 0);
  const raw = effectiveWeights.map((weight, index) => {
    const exact = totalCents * weight / effectiveTotal;
    return { index, cents: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  const centsLeft = totalCents - raw.reduce((sum, share) => sum + share.cents, 0);
  const remainderOrder = [...raw].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let index = 0; index < centsLeft; index += 1) remainderOrder[index % remainderOrder.length].cents += 1;
  return raw.sort((a, b) => a.index - b.index).map((share) => share.cents / 100);
}

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function roundMoney(value: number) {
  return Math.round((finite(value) + Number.EPSILON) * 100) / 100;
}

function roundNumber(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round((finite(value) + Number.EPSILON) * factor) / factor;
}

function toLocalDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
