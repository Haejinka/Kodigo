import type { Supplier, Product } from '@/types';

/**
 * Reliability Score
 * Derived entirely from purchase order history.
 * New suppliers with no orders start at 100 (benefit of the doubt).
 *
 *   reliabilityScore = (onTimeDeliveries / totalOrders) × 100
 */
export function computeReliabilityScore(
  totalOrders: number,
  onTimeDeliveries: number,
): number {
  if (totalOrders === 0) return 100;
  return Math.round((onTimeDeliveries / totalOrders) * 100);
}

/**
 * Price Score
 * Normalises each supplier's average product cost against all other suppliers.
 * The supplier with the lowest average cost scores 100; the highest scores 0.
 *
 *   priceScore = 100 × (1 − (avgCost − minCost) / (maxCost − minCost))
 *
 * Suppliers with no assigned products default to 50 (neutral).
 * When all suppliers charge the same, everyone scores 100.
 */
export function computePriceScore(
  supplierId: string,
  allSuppliers: Supplier[],
  allProducts: Product[],
): number {
  // Build supplierId → average purchase price of assigned products
  const avgCosts = new Map<string, number>();
  for (const sup of allSuppliers) {
    const supProducts = allProducts.filter((p) => p.supplierId === sup.id);
    if (supProducts.length === 0) continue;
    const avg = supProducts.reduce((sum, p) => sum + p.costPrice, 0) / supProducts.length;
    avgCosts.set(sup.id, avg);
  }

  if (!avgCosts.has(supplierId)) return 50; // no products assigned yet

  const costs = Array.from(avgCosts.values());
  const min = Math.min(...costs);
  const max = Math.max(...costs);

  if (max === min) return 100; // all suppliers equally priced

  const thisCost = avgCosts.get(supplierId)!;
  return Math.round(100 * (1 - (thisCost - min) / (max - min)));
}

/**
 * Overall Score — weighted composite.
 *
 *   overallScore = (reliabilityScore × 0.6) + (priceScore × 0.4)
 */
export function computeOverallScore(reliabilityScore: number, priceScore: number): number {
  return Math.round(reliabilityScore * 0.6 + priceScore * 0.4);
}

/**
 * Recompute all three scores for a single supplier given current system data.
 */
export function computeAllScores(
  supplier: Supplier,
  allSuppliers: Supplier[],
  allProducts: Product[],
): Pick<Supplier, 'reliabilityScore' | 'priceScore' | 'overallScore'> {
  const reliabilityScore = computeReliabilityScore(
    supplier.totalOrders,
    supplier.onTimeDeliveries,
  );
  const priceScore = computePriceScore(supplier.id, allSuppliers, allProducts);
  const overallScore = computeOverallScore(reliabilityScore, priceScore);
  return { reliabilityScore, priceScore, overallScore };
}
