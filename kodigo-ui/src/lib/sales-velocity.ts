import type { Product } from '@/types';

/**
 * These defaults preserve the thresholds used by the previous velocity panel,
 * but keep them in one place so a store-specific rule can be introduced later.
 */
export const SALES_VELOCITY_THRESHOLDS = {
  fastMovingMinPerDay: 1,
  normalMinPerDay: 0.15,
} as const;

export type VelocityClassification = 'Fast Moving' | 'Normal' | 'Slow Moving' | 'No Sales';
export type InventoryStatus = 'Restock Soon' | 'Healthy' | 'Overstock / Slow Moving' | 'No Recent Sales';

export interface VelocitySaleLine {
  productId: string | null;
  netQuantity: number;
  sellingOptionId?: string | null;
  stockSource?: string | null;
  packageSize?: number | null;
  packageUnit?: string | null;
}

export interface SalesVelocityRow {
  product: Product;
  unitsSold: number;
  perDay: number;
  perWeek: number;
  daysOfStock: number | null;
  classification: VelocityClassification;
  inventoryStatus: InventoryStatus;
}

export type VelocitySort =
  | 'highest-velocity'
  | 'lowest-velocity'
  | 'highest-units-sold'
  | 'lowest-stock-coverage'
  | 'product-name';

const finite = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const sameUnit = (left?: string | null, right?: string | null) =>
  Boolean(left?.trim()) && Boolean(right?.trim()) && left!.trim().toLowerCase() === right!.trim().toLowerCase();

function getInventoryMultiplier(product: Product, sellingOptionId?: string | null): number {
  const option = sellingOptionId
    ? product.sellingOptions.find((candidate) => candidate.id === sellingOptionId)
    : undefined;
  return option?.sharesBaseStock ? Math.max(1, finite(option.inventoryMultiplier, 1)) : 1;
}

/**
 * Convert only sales that belong to the product's base stock stream.
 * Separate-stock selling options intentionally return zero so incompatible
 * units are not combined with the product QOH.
 */
export function normalizeSaleLineQuantityToBaseUnits(line: VelocitySaleLine, product: Product): number {
  const quantity = Math.max(0, finite(line.netQuantity));
  if (quantity === 0) return 0;

  const option = line.sellingOptionId
    ? product.sellingOptions.find((candidate) => candidate.id === line.sellingOptionId)
    : undefined;

  if (option?.sharesBaseStock) {
    return quantity * Math.max(1, finite(option.inventoryMultiplier, 1));
  }

  if (line.stockSource === 'selling_option' && !option?.sharesBaseStock) return 0;
  if (line.sellingOptionId && option && !option.sharesBaseStock) return 0;

  // Legacy rows may not have an option id. A package snapshot can still prove
  // that the quantity belongs to the base unit (for example, 20 pieces/pack).
  if (line.packageSize && sameUnit(line.packageUnit, product.unit)) {
    return quantity * Math.max(1, finite(line.packageSize, 1));
  }

  return quantity * getInventoryMultiplier(product, line.sellingOptionId);
}

export function classifyVelocity(perDay: number): VelocityClassification {
  if (perDay <= 0) return 'No Sales';
  if (perDay >= SALES_VELOCITY_THRESHOLDS.fastMovingMinPerDay) return 'Fast Moving';
  if (perDay >= SALES_VELOCITY_THRESHOLDS.normalMinPerDay) return 'Normal';
  return 'Slow Moving';
}

export function getInventoryStatus(
  product: Product,
  perDay: number,
  daysOfStock: number | null,
  classification: VelocityClassification,
): InventoryStatus {
  if (perDay <= 0 || daysOfStock === null) return 'No Recent Sales';

  const stockTrigger = Math.max(
    0,
    finite(product.reorderLevel),
    finite(product.safetyStock),
    finite(product.minStockLevel),
  );
  const safetyHorizon = stockTrigger / perDay;
  const leadTimeHorizon = Math.max(0, finite(product.leadTimeDays));

  // Both current stock (through coverage) and demand rate are required here.
  if (finite(product.currentStock) <= stockTrigger || daysOfStock <= leadTimeHorizon + safetyHorizon) {
    return 'Restock Soon';
  }

  // Reuse the existing three-times-low-stock convention for overstock rather
  // than introducing a second unrelated inventory rule.
  if (classification === 'Slow Moving' && stockTrigger > 0 && finite(product.currentStock) > stockTrigger * 3) {
    return 'Overstock / Slow Moving';
  }

  return 'Healthy';
}

export function buildSalesVelocityRows(
  products: Product[],
  unitsSoldByProduct: Map<string, number>,
  days: number,
): SalesVelocityRow[] {
  const safeDays = Math.max(1, finite(days, 30));

  return products.map((product) => {
    const unitsSold = Math.max(0, finite(unitsSoldByProduct.get(product.id)));
    const perDay = unitsSold / safeDays;
    const daysOfStock = perDay > 0
      ? Math.max(0, finite(product.currentStock)) / perDay
      : null;
    const classification = classifyVelocity(perDay);

    return {
      product,
      unitsSold,
      perDay,
      perWeek: perDay * 7,
      daysOfStock: Number.isFinite(daysOfStock) ? daysOfStock : null,
      classification,
      inventoryStatus: getInventoryStatus(product, perDay, daysOfStock, classification),
    };
  });
}

export function sortSalesVelocityRows(rows: SalesVelocityRow[], sort: VelocitySort): SalesVelocityRow[] {
  return [...rows].sort((left, right) => {
    if (sort === 'product-name') {
      return left.product.name.localeCompare(right.product.name);
    }

    const leftValue = sort === 'highest-units-sold' || sort === 'highest-velocity'
      ? sort === 'highest-units-sold' ? left.unitsSold : left.perDay
      : sort === 'lowest-stock-coverage'
        ? left.daysOfStock ?? Number.POSITIVE_INFINITY
        : left.perDay;
    const rightValue = sort === 'highest-units-sold' || sort === 'highest-velocity'
      ? sort === 'highest-units-sold' ? right.unitsSold : right.perDay
      : sort === 'lowest-stock-coverage'
        ? right.daysOfStock ?? Number.POSITIVE_INFINITY
        : right.perDay;
    const direction = sort === 'highest-units-sold' || sort === 'highest-velocity' ? -1 : 1;
    return (leftValue - rightValue) * direction || left.product.name.localeCompare(right.product.name);
  });
}

export const formatVelocityNumber = (value: number, maximumFractionDigits = 2) => {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value);
};

export const formatDaysOfStock = (value: number | null) =>
  value === null || !Number.isFinite(value) ? 'No recent sales' : `${formatVelocityNumber(value, 1)} days`;
