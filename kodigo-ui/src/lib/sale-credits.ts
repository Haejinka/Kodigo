import type {
  CumulativeSaleLineCredit,
  CumulativeSaleLineCreditInput,
  SaleCreditAllocationInput,
  SaleFinancialFacts,
  SaleLineAmountBasis,
} from '@/types/sale-adjustments';

const MONEY_SCALE = 100n;
const QUANTITY_SCALE = 1_000_000n;

function parseDecimal(value: string, scale: bigint, precision: number): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(?:\.(\d+))?$/.test(value)) {
    throw new TypeError('Amount must be a non-negative decimal string.');
  }
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > precision) throw new RangeError(`Amount supports at most ${precision} decimal places.`);
  const paddedFraction = fraction.padEnd(precision, '0');
  return BigInt(whole) * scale + BigInt(paddedFraction || '0');
}

function formatDecimal(value: bigint, scale: bigint, precision: number): string {
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(precision, '0');
  return `${whole}.${fraction}`;
}

function parseMoney(value: string): bigint {
  return parseDecimal(value, MONEY_SCALE, 2);
}

function roundDivideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('Division requires a positive denominator.');
  return (numerator + denominator / 2n) / denominator;
}

function cumulativeAmount(
  originalAmount: string,
  previousQuantity: number,
  cumulativeQuantity: number,
  soldQuantity: number,
  previousAmount: string,
): string {
  const original = parseMoney(originalAmount);
  const previous = parseMoney(previousAmount);
  const expectedPrevious = roundDivideHalfUp(original * BigInt(previousQuantity), BigInt(soldQuantity));
  if (previous !== expectedPrevious) {
    throw new RangeError('Prior allocation does not match the cumulative entitlement.');
  }
  const entitlement = roundDivideHalfUp(original * BigInt(cumulativeQuantity), BigInt(soldQuantity));
  if (entitlement < previous) throw new RangeError('Cumulative allocation cannot reverse prior credits.');
  return formatDecimal(entitlement - previous, MONEY_SCALE, 2);
}

function cumulativeQuantityAmount(
  originalAmount: string | undefined,
  previousQuantity: number,
  cumulativeQuantity: number,
  soldQuantity: number,
  previousAmount: string | undefined,
): string {
  if (!originalAmount) return '0.00';
  return cumulativeAmount(originalAmount, previousQuantity, cumulativeQuantity, soldQuantity, previousAmount ?? '0.00');
}

function remainingCumulativeCapacity(
  originalAmount: string | undefined,
  cumulativeQuantity: number,
  soldQuantity: number,
  previouslyRecovered: string | undefined,
): string {
  if (!originalAmount) return '0.00';
  const entitlement = roundDivideHalfUp(parseMoney(originalAmount) * BigInt(cumulativeQuantity), BigInt(soldQuantity));
  const recovered = parseMoney(previouslyRecovered ?? '0.00');
  if (recovered > entitlement) throw new RangeError('Recovered amount exceeds the cumulative entitlement.');
  return formatDecimal(entitlement - recovered, MONEY_SCALE, 2);
}

/**
 * Allocate an exact amount to line IDs using largest remainder. Ties are stable
 * by sale-item UUID, and all arithmetic is integer-only.
 */
export function allocateSaleCreditAmount(
  totalAmount: string,
  lines: SaleCreditAllocationInput[],
): Map<string, string> {
  const total = parseMoney(totalAmount);
  const ids = new Set<string>();
  const weights = lines.map((line) => {
    if (!line.saleItemId || ids.has(line.saleItemId)) throw new TypeError('Sale item IDs must be unique and non-empty.');
    ids.add(line.saleItemId);
    return { id: line.saleItemId, weight: parseDecimal(line.weight, QUANTITY_SCALE, 6) };
  });
  const weightTotal = weights.reduce((sum, line) => sum + line.weight, 0n);
  if (weights.length === 0) return new Map();
  if (weightTotal === 0n) {
    if (total !== 0n) throw new RangeError('A positive amount cannot be allocated across zero weights.');
    return new Map(weights.map((line) => [line.id, '0.00']));
  }

  const rows = weights.map((line) => {
    const numerator = total * line.weight;
    return { ...line, cents: numerator / weightTotal, remainder: numerator % weightTotal };
  });
  let remaining = total - rows.reduce((sum, line) => sum + line.cents, 0n);
  const priority = [...rows].sort((a, b) => (
    a.remainder === b.remainder
      ? a.id.localeCompare(b.id)
      : a.remainder > b.remainder ? -1 : 1
  ));
  for (const row of priority) {
    if (remaining <= 0n) break;
    row.cents += 1n;
    remaining -= 1n;
  }
  return new Map(rows.sort((a, b) => a.id.localeCompare(b.id))
    .map((line) => [line.id, formatDecimal(line.cents, MONEY_SCALE, 2)]));
}

/**
 * Calculate one partial credit against cumulative line entitlements. The final
 * quantity receives any centavo residual without ever exceeding the snapshot.
 */
export function calculateCumulativeSaleLineCredit(
  input: CumulativeSaleLineCreditInput,
): CumulativeSaleLineCredit {
  const {
    soldQuantity,
    previouslyCreditedQuantity,
    requestedQuantity,
  } = input;
  if (!Number.isSafeInteger(soldQuantity) || soldQuantity <= 0
    || !Number.isSafeInteger(previouslyCreditedQuantity) || previouslyCreditedQuantity < 0
    || !Number.isSafeInteger(requestedQuantity) || requestedQuantity <= 0
    || previouslyCreditedQuantity + requestedQuantity > soldQuantity) {
    throw new RangeError('Credit quantity must be a positive integer within the remaining sold quantity.');
  }
  const cumulativeQuantity = previouslyCreditedQuantity + requestedQuantity;
  const amount = cumulativeQuantityAmount(
    input.originalNetAmount,
    previouslyCreditedQuantity,
    cumulativeQuantity,
    soldQuantity,
    input.previousCreditAmount,
  );
  const discountShare = cumulativeQuantityAmount(
    input.originalDiscountAmount,
    previouslyCreditedQuantity,
    cumulativeQuantity,
    soldQuantity,
    input.previousDiscountShare,
  );
  const vatShare = cumulativeQuantityAmount(
    input.originalVatAmount,
    previouslyCreditedQuantity,
    cumulativeQuantity,
    soldQuantity,
    input.previousVatShare,
  );
  const cogsCapacity = remainingCumulativeCapacity(
    input.originalCogsAmount,
    cumulativeQuantity,
    soldQuantity,
    input.previousCogsRecovered,
  );

  const baseQuantityScale = parseDecimal(input.originalBaseQuantity ?? '0', QUANTITY_SCALE, 6);
  const previousBaseQuantity = parseDecimal(input.previousBaseQuantity ?? '0', QUANTITY_SCALE, 6);
  const expectedPreviousBase = roundDivideHalfUp(
    baseQuantityScale * BigInt(previouslyCreditedQuantity),
    BigInt(soldQuantity),
  );
  if (previousBaseQuantity !== expectedPreviousBase) {
    throw new RangeError('Prior base quantity does not match the cumulative entitlement.');
  }
  const cumulativeBaseQuantity = roundDivideHalfUp(
    baseQuantityScale * BigInt(cumulativeQuantity),
    BigInt(soldQuantity),
  );

  return {
    cumulativeQuantity,
    amount,
    discountShare,
    vatShare,
    baseQuantity: formatDecimal(cumulativeBaseQuantity - previousBaseQuantity, QUANTITY_SCALE, 6),
    cogsCapacity,
  };
}

function toFinancialFacts(row: Record<string, unknown>): SaleFinancialFacts {
  const basis = row.line_amount_basis;
  if (basis !== 'net_item_discounted' && basis !== 'legacy_gross' && basis !== 'legacy_unknown') {
    throw new TypeError('The server returned an unsupported sale amount basis.');
  }
  const decimal = (value: unknown, nullable = false): string | null => {
    if (value == null && nullable) return null;
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new TypeError('The server returned an invalid financial amount.');
    }
    const normalized = String(value);
    parseMoney(normalized);
    return normalized;
  };
  return {
    saleId: String(row.sale_id),
    storeId: String(row.store_id),
    accountingVersion: row.accounting_version == null ? null : Number(row.accounting_version),
    lineAmountBasis: basis as SaleLineAmountBasis,
    financialComplete: row.financial_complete === true,
    unclassifiedCount: Number(row.unclassified_count ?? 0),
    grossBilled: decimal(row.gross_billed, true),
    saleDiscount: decimal(row.sale_discount, true),
    netBilled: decimal(row.net_billed)!,
    postedCredits: decimal(row.posted_credits)!,
    capturedPayments: decimal(row.captured_payments)!,
    confirmedRefunds: decimal(row.confirmed_refunds)!,
    netPaid: decimal(row.net_paid)!,
    refundDue: decimal(row.refund_due)!,
    settlementUnknown: row.settlement_unknown === true,
  };
}

export async function fetchSaleFinancialFacts(saleId: string): Promise<SaleFinancialFacts | null> {
  const { supabase } = await import('@/lib/supabase');
  const { data, error } = await supabase.rpc('get_sale_financial_facts', { p_sale_id: saleId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? toFinancialFacts(row as Record<string, unknown>) : null;
}
