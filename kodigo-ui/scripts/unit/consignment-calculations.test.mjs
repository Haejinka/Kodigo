import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildConsignmentMetrics,
  calculateConsignmentReorder,
  isConsignmentSaleInScope,
} from '../../src/lib/consignment-calculations.ts';

const baseLot = (overrides = {}) => ({
  id: 'lot-1',
  storeId: 'store-1',
  productId: 'product-1',
  supplierId: 'supplier-1',
  quantityReceived: 36,
  quantityRemaining: 36,
  unitCost: 1600 / 36,
  receivedAt: '2026-10-21T08:00:00.000Z',
  receivedPurchaseQuantity: 6,
  purchaseUnitLabel: 'case',
  piecesPerPurchaseUnit: 6,
  supplierName: 'San Miguel Corp',
  ...overrides,
});

const saleLine = (overrides = {}) => ({
  id: 'sale-item-1',
  saleId: 'sale-1',
  createdAt: '2026-10-21T09:00:00.000Z',
  status: 'completed',
  lineTotal: 0,
  baseUnitQuantity: 0,
  ...overrides,
});

const allocation = (overrides = {}) => ({
  saleItemId: 'sale-item-1',
  saleId: 'sale-1',
  lotId: 'lot-1',
  quantityBaseUnits: 0,
  quantityReturned: 0,
  unitCost: 0,
  ...overrides,
});

const calculate = ({ lots = [baseLot()], allocations = [], saleLines = [], scope } = {}) => buildConsignmentMetrics({
  lots,
  allocations,
  saleLinesById: new Map(saleLines.map((line) => [line.id, line])),
  scope,
  baseUnitByProduct: new Map([['product-1', 'piece']]),
});

test('keeps a fully paid, unsold consignment at zero sales recovery and zero profit', () => {
  const [row] = calculate();
  assert.equal(row.supplierCost, 1600);
  assert.equal(row.salesRevenue, 0);
  assert.equal(row.cogs, 0);
  assert.equal(row.grossProfit, 0);
  assert.equal(row.costCoverage, 0);
  assert.equal(row.remainingBaseUnits, 36);
  assert.equal(row.receivedPurchaseUnits, 6);
});

test('allocates revenue and historical COGS across receipts with different costs', () => {
  const lots = [
    baseLot({ id: 'lot-a', quantityReceived: 6, quantityRemaining: 0, unitCost: 10, receivedPurchaseQuantity: 1 }),
    baseLot({ id: 'lot-b', quantityReceived: 4, quantityRemaining: 2, unitCost: 20, receivedPurchaseQuantity: 1 }),
  ];
  const [row] = calculate({
    lots,
    saleLines: [saleLine({ lineTotal: 140, baseUnitQuantity: 8 })],
    allocations: [
      allocation({ lotId: 'lot-a', quantityBaseUnits: 6, unitCost: 10 }),
      allocation({ lotId: 'lot-b', quantityBaseUnits: 2, unitCost: 20 }),
    ],
  });
  assert.equal(row.salesRevenue, 140);
  assert.equal(row.cogs, 100);
  assert.equal(row.grossProfit, 40);
  assert.equal(row.grossMargin, 40 / 140);
  assert.equal(row.soldBaseUnits, 8);
});

test('uses discounted net line revenue and preserves a loss when selling below cost', () => {
  const [row] = calculate({
    saleLines: [saleLine({ lineTotal: 20, baseUnitQuantity: 2 })],
    allocations: [allocation({ quantityBaseUnits: 2, unitCost: 15 })],
  });
  assert.equal(row.salesRevenue, 20);
  assert.equal(row.cogs, 30);
  assert.equal(row.grossProfit, -10);
  assert.equal(row.grossMargin, -0.5);
});

test('removes returned units and excludes voided sale allocations', () => {
  const [row] = calculate({
    saleLines: [
      saleLine({ id: 'sale-item-returned', lineTotal: 100, baseUnitQuantity: 5 }),
      saleLine({ id: 'sale-item-voided', saleId: 'sale-void', lineTotal: 50, baseUnitQuantity: 2, status: 'voided' }),
    ],
    allocations: [
      allocation({ saleItemId: 'sale-item-returned', quantityBaseUnits: 5, quantityReturned: 2, unitCost: 10 }),
      allocation({ saleItemId: 'sale-item-voided', saleId: 'sale-void', quantityBaseUnits: 2, unitCost: 10 }),
    ],
  });
  assert.equal(row.soldBaseUnits, 3);
  assert.equal(row.salesRevenue, 60);
  assert.equal(row.cogs, 30);
  assert.equal(row.grossProfit, 30);
});

test('keeps regular inventory out of consignment metrics when lots are separate', () => {
  const [row] = calculate({
    lots: [baseLot()],
    saleLines: [saleLine({ lineTotal: 50, baseUnitQuantity: 5 })],
    allocations: [allocation({ lotId: 'regular-lot', quantityBaseUnits: 5, unitCost: 2 })],
  });
  assert.equal(row.soldBaseUnits, 0);
  assert.equal(row.salesRevenue, 0);
  assert.equal(row.cogs, 0);
});

test('applies receipt and sale dates consistently to a selected reporting scope', () => {
  const metrics = calculate({
    lots: [baseLot({ receivedAt: '2026-10-20T08:00:00.000Z' })],
    saleLines: [saleLine({ createdAt: '2026-10-21T09:00:00.000Z', lineTotal: 100, baseUnitQuantity: 5 })],
    allocations: [allocation({ quantityBaseUnits: 5, unitCost: 10 })],
    scope: { startDate: '2026-10-21', endDate: '2026-10-21' },
  });
  assert.equal(metrics.length, 0);
  assert.equal(isConsignmentSaleInScope('2026-10-21T09:00:00.000Z', { startDate: '2026-10-21', endDate: '2026-10-21' }), true);
});

test('supports a zero selling price without inventing a break-even quantity', () => {
  const result = calculateConsignmentReorder({
    dailySales: 0,
    leadTimeDays: 5,
    reviewPeriodDays: 7,
    safetyStock: 3,
    onHand: 10,
    orderMultiple: 6,
    costPerBaseUnit: 10,
    sellingPrice: 0,
  });
  assert.equal(result.suggestedBaseUnits, 0);
  assert.equal(result.estimatedRevenue, 0);
  assert.equal(result.expectedStockCoverageDays, null);
});

test('rounds reorder quantities upward to supplier packs', () => {
  const result = calculateConsignmentReorder({
    dailySales: 2,
    leadTimeDays: 5,
    reviewPeriodDays: 7,
    safetyStock: 3,
    onHand: 10,
    orderMultiple: 6,
    costPerBaseUnit: 10,
    sellingPrice: 20,
  });
  assert.equal(result.targetStock, 27);
  assert.equal(result.inventoryPosition, 10);
  assert.equal(result.baseQuantityBeforeRounding, 17);
  assert.equal(result.suggestedPackages, 3);
  assert.equal(result.suggestedBaseUnits, 18);
  assert.equal(result.estimatedAcquisitionCost, 180);
  assert.equal(result.estimatedRevenue, 360);
  assert.equal(result.estimatedGrossProfit, 180);
});

test('honors a supplier minimum order quantity before pack rounding', () => {
  const result = calculateConsignmentReorder({
    dailySales: 0.5,
    leadTimeDays: 2,
    reviewPeriodDays: 2,
    safetyStock: 0,
    onHand: 0,
    orderMultiple: 6,
    minimumOrderQuantity: 13,
    costPerBaseUnit: 4,
    sellingPrice: 8,
  });
  assert.equal(result.baseQuantityBeforeRounding, 2);
  assert.equal(result.suggestedBaseUnits, 18);
  assert.equal(result.suggestedPackages, 3);
});

test('does not suggest a reorder when there is no recent demand history', () => {
  const result = calculateConsignmentReorder({
    dailySales: 0,
    leadTimeDays: 5,
    reviewPeriodDays: 7,
    safetyStock: 3,
    onHand: 0,
    orderMultiple: 6,
    costPerBaseUnit: 10,
    sellingPrice: 20,
  });
  assert.equal(result.suggestedBaseUnits, 0);
  assert.equal(result.estimatedDaysUntilDepletion, null);
});
