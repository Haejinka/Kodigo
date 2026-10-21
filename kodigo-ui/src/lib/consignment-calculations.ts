export type ConsignmentScope = {
  startDate?: string;
  endDate?: string;
};

export interface ConsignmentLotInput {
  id: string;
  storeId: string;
  productId: string;
  supplierId: string;
  quantityReceived: number;
  quantityRemaining: number;
  unitCost: number;
  receivedAt: string;
  receivedPurchaseQuantity?: number | null;
  purchaseUnitLabel?: string | null;
  piecesPerPurchaseUnit?: number | null;
  supplierName?: string | null;
}

export interface ConsignmentAllocationInput {
  saleItemId: string;
  saleId: string;
  lotId: string;
  quantityBaseUnits: number;
  quantityReturned: number;
  unitCost: number;
}

export interface ConsignmentSaleInput {
  id: string;
  saleId: string;
  createdAt: string;
  status: string;
  lineTotal: number;
  baseUnitQuantity: number;
}

export interface ConsignmentProductMetrics {
  key: string;
  storeId: string;
  productId: string;
  supplierId: string;
  supplierName: string;
  baseUnit: string;
  purchaseUnit: string;
  packSize: number;
  receivedPurchaseUnits: number;
  receivedBaseUnits: number;
  soldBaseUnits: number;
  remainingBaseUnits: number;
  supplierCost: number;
  cogs: number;
  salesRevenue: number;
  grossProfit: number;
  grossMargin: number;
  costCoverage: number;
  sellThroughRate: number;
  averageRealizedPrice: number;
  remainingRevenueToRecover: number;
  latestReceivedAt: string;
}

export interface ConsignmentSalesTrendPoint {
  label: string;
  date: string;
  units: number;
  revenue: number;
}

export interface ConsignmentReorderInput {
  dailySales: number;
  leadTimeDays: number;
  reviewPeriodDays: number;
  safetyStock: number;
  onHand: number;
  confirmedIncoming?: number;
  committedStock?: number;
  orderMultiple?: number;
  minimumOrderQuantity?: number;
  costPerBaseUnit: number;
  sellingPrice: number;
}

export interface ConsignmentReorderResult {
  targetStock: number;
  inventoryPosition: number;
  baseQuantityBeforeRounding: number;
  suggestedBaseUnits: number;
  suggestedPackages: number;
  orderMultiple: number;
  estimatedAcquisitionCost: number;
  estimatedRevenue: number;
  estimatedGrossProfit: number;
  expectedStockCoverageDays: number | null;
  estimatedDaysUntilDepletion: number | null;
}

const validSaleStatuses = new Set(['completed', 'partially_refunded', 'refunded']);

export function isConsignmentSaleInScope(value: string, scope: ConsignmentScope = {}): boolean {
  const date = value.slice(0, 10);
  if (scope.startDate && date < scope.startDate) return false;
  if (scope.endDate && date > scope.endDate) return false;
  return true;
}

export function buildConsignmentMetrics(input: {
  lots: ConsignmentLotInput[];
  allocations: ConsignmentAllocationInput[];
  saleLinesById: Map<string, ConsignmentSaleInput>;
  scope?: ConsignmentScope;
  supplierId?: string;
  baseUnitByProduct?: Map<string, string>;
}): ConsignmentProductMetrics[] {
  const scope = input.scope ?? {};
  const lotById = new Map(input.lots.map((lot) => [lot.id, lot]));
  const grouped = new Map<string, ConsignmentProductMetrics>();

  for (const lot of input.lots) {
    if (input.supplierId && lot.supplierId !== input.supplierId) continue;
    if (!isConsignmentSaleInScope(lot.receivedAt, scope)) continue;

    const key = `${lot.storeId}:${lot.productId}:${lot.supplierId}`;
    const existing = grouped.get(key) ?? {
      key,
      storeId: lot.storeId,
      productId: lot.productId,
      supplierId: lot.supplierId,
      supplierName: lot.supplierName || 'Supplier',
      baseUnit: input.baseUnitByProduct?.get(lot.productId) || 'unit',
      purchaseUnit: lot.purchaseUnitLabel || input.baseUnitByProduct?.get(lot.productId) || 'unit',
      packSize: safePositive(lot.piecesPerPurchaseUnit, 1),
      receivedPurchaseUnits: 0,
      receivedBaseUnits: 0,
      soldBaseUnits: 0,
      remainingBaseUnits: 0,
      supplierCost: 0,
      cogs: 0,
      salesRevenue: 0,
      grossProfit: 0,
      grossMargin: 0,
      costCoverage: 0,
      sellThroughRate: 0,
      averageRealizedPrice: 0,
      remainingRevenueToRecover: 0,
      latestReceivedAt: lot.receivedAt,
    };

    const receivedBaseUnits = safeNonNegative(lot.quantityReceived);
    const unitCost = safeNonNegative(lot.unitCost);
    const packSize = safePositive(lot.piecesPerPurchaseUnit, 1);
    existing.receivedBaseUnits += receivedBaseUnits;
    existing.remainingBaseUnits += safeNonNegative(lot.quantityRemaining);
    existing.receivedPurchaseUnits += lot.receivedPurchaseQuantity == null
      ? receivedBaseUnits / packSize
      : safeNonNegative(lot.receivedPurchaseQuantity);
    existing.supplierCost += receivedBaseUnits * unitCost;
    if (lot.receivedAt > existing.latestReceivedAt) {
      existing.latestReceivedAt = lot.receivedAt;
      existing.purchaseUnit = lot.purchaseUnitLabel || existing.purchaseUnit;
      existing.packSize = packSize;
    }
    grouped.set(key, existing);
  }

  for (const allocation of input.allocations) {
    const lot = lotById.get(allocation.lotId);
    if (!lot || (input.supplierId && lot.supplierId !== input.supplierId)) continue;
    if (!isConsignmentSaleInScope(lot.receivedAt, scope)) continue;

    const sale = input.saleLinesById.get(allocation.saleItemId);
    if (!sale || !validSaleStatuses.has(sale.status) || !isConsignmentSaleInScope(sale.createdAt, scope)) continue;

    const soldUnits = Math.min(
      safeNonNegative(allocation.quantityBaseUnits),
      Math.max(0, safeNonNegative(allocation.quantityBaseUnits) - safeNonNegative(allocation.quantityReturned)),
    );
    if (soldUnits <= 0) continue;

    const key = `${lot.storeId}:${lot.productId}:${lot.supplierId}`;
    const existing = grouped.get(key);
    if (!existing) continue;
    const lineBaseUnits = safePositive(sale.baseUnitQuantity, soldUnits);
    const allocatedRevenue = safeNonNegative(sale.lineTotal) * soldUnits / lineBaseUnits;
    existing.soldBaseUnits += soldUnits;
    existing.cogs += soldUnits * safeNonNegative(allocation.unitCost);
    existing.salesRevenue += allocatedRevenue;
  }

  return Array.from(grouped.values()).map((row) => finalizeMetrics(row));
}

export function buildConsignmentSalesTrend(input: {
  lots: ConsignmentLotInput[];
  allocations: ConsignmentAllocationInput[];
  saleLinesById: Map<string, ConsignmentSaleInput>;
  productId: string;
  supplierId: string;
  storeId?: string;
  scope?: ConsignmentScope;
  limit?: number;
}): ConsignmentSalesTrendPoint[] {
  const scope = input.scope ?? {};
  const lotById = new Map(input.lots.map((lot) => [lot.id, lot]));
  const trend = new Map<string, ConsignmentSalesTrendPoint>();

  for (const allocation of input.allocations) {
    const lot = lotById.get(allocation.lotId);
    if (!lot || lot.productId !== input.productId || lot.supplierId !== input.supplierId || (input.storeId && lot.storeId !== input.storeId)) continue;
    if (!isConsignmentSaleInScope(lot.receivedAt, scope)) continue;
    const sale = input.saleLinesById.get(allocation.saleItemId);
    if (!sale || !validSaleStatuses.has(sale.status) || !isConsignmentSaleInScope(sale.createdAt, scope)) continue;

    const units = Math.max(0, safeNonNegative(allocation.quantityBaseUnits) - safeNonNegative(allocation.quantityReturned));
    if (units <= 0) continue;
    const date = sale.createdAt.slice(0, 10);
    const existing = trend.get(date) ?? { date, label: formatTrendDate(date), units: 0, revenue: 0 };
    existing.units += units;
    existing.revenue += safeNonNegative(sale.lineTotal) * units / safePositive(sale.baseUnitQuantity, units);
    trend.set(date, existing);
  }

  return Array.from(trend.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-(input.limit ?? 12))
    .map((row) => ({ ...row, units: roundNumber(row.units, 3), revenue: roundMoney(row.revenue) }));
}

export function calculateConsignmentReorder(input: ConsignmentReorderInput): ConsignmentReorderResult {
  const dailySales = safeNonNegative(input.dailySales);
  const leadTimeDays = safeNonNegative(input.leadTimeDays);
  const reviewPeriodDays = safeNonNegative(input.reviewPeriodDays);
  const safetyStock = safeNonNegative(input.safetyStock);
  const onHand = safeNonNegative(input.onHand);
  const confirmedIncoming = safeNonNegative(input.confirmedIncoming);
  const committedStock = safeNonNegative(input.committedStock);
  const orderMultiple = Math.max(1, Math.ceil(safePositive(input.orderMultiple, 1)));
  const minimumOrderQuantity = safeNonNegative(input.minimumOrderQuantity);
  const targetStock = dailySales * (leadTimeDays + reviewPeriodDays) + safetyStock;
  const inventoryPosition = onHand + confirmedIncoming - committedStock;
  // A safety-stock floor should not create a purchase recommendation for an item
  // with no observed demand. The UI can still surface the target stock for review.
  const baseQuantityBeforeRounding = dailySales > 0
    ? Math.max(0, Math.ceil(targetStock - inventoryPosition))
    : 0;
  const minimumOrder = dailySales > 0
    ? Math.max(baseQuantityBeforeRounding, Math.ceil(minimumOrderQuantity))
    : 0;
  const suggestedBaseUnits = minimumOrder > 0
    ? Math.ceil(minimumOrder / orderMultiple) * orderMultiple
    : 0;
  const suggestedPackages = Math.ceil(suggestedBaseUnits / orderMultiple);
  const costPerBaseUnit = safeNonNegative(input.costPerBaseUnit);
  const sellingPrice = safeNonNegative(input.sellingPrice);

  return {
    targetStock: roundNumber(targetStock, 3),
    inventoryPosition: roundNumber(inventoryPosition, 3),
    baseQuantityBeforeRounding,
    suggestedBaseUnits,
    suggestedPackages,
    orderMultiple,
    estimatedAcquisitionCost: roundMoney(suggestedBaseUnits * costPerBaseUnit),
    estimatedRevenue: roundMoney(suggestedBaseUnits * sellingPrice),
    estimatedGrossProfit: roundMoney(suggestedBaseUnits * (sellingPrice - costPerBaseUnit)),
    expectedStockCoverageDays: dailySales > 0 ? roundNumber((inventoryPosition + suggestedBaseUnits) / dailySales, 1) : null,
    estimatedDaysUntilDepletion: dailySales > 0 ? roundNumber(onHand / dailySales, 1) : null,
  };
}

export function roundMoney(value: number): number {
  return Math.round((safeFinite(value) + Number.EPSILON) * 100) / 100;
}

export function roundNumber(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round((safeFinite(value) + Number.EPSILON) * factor) / factor;
}

function finalizeMetrics(row: ConsignmentProductMetrics): ConsignmentProductMetrics {
  const supplierCost = roundMoney(row.supplierCost);
  const cogs = roundMoney(row.cogs);
  const salesRevenue = roundMoney(row.salesRevenue);
  const grossProfit = roundMoney(salesRevenue - cogs);
  return {
    ...row,
    receivedPurchaseUnits: roundNumber(row.receivedPurchaseUnits),
    receivedBaseUnits: roundNumber(row.receivedBaseUnits),
    soldBaseUnits: roundNumber(row.soldBaseUnits),
    remainingBaseUnits: roundNumber(row.remainingBaseUnits),
    supplierCost,
    cogs,
    salesRevenue,
    grossProfit,
    grossMargin: salesRevenue > 0 ? grossProfit / salesRevenue : 0,
    costCoverage: supplierCost > 0 ? salesRevenue / supplierCost : 0,
    sellThroughRate: row.receivedBaseUnits > 0 ? row.soldBaseUnits / row.receivedBaseUnits : 0,
    averageRealizedPrice: row.soldBaseUnits > 0 ? salesRevenue / row.soldBaseUnits : 0,
    remainingRevenueToRecover: roundMoney(Math.max(0, supplierCost - salesRevenue)),
  };
}

function formatTrendDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(date);
}

function safeFinite(value: number | null | undefined): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function safeNonNegative(value: number | null | undefined): number {
  return Math.max(0, safeFinite(value));
}

function safePositive(value: number | null | undefined, fallback: number): number {
  const parsed = safeFinite(value);
  return parsed > 0 ? parsed : fallback;
}
