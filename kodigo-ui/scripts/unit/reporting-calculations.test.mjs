import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateSaleLineAmountPaid,
  formatSalesReportPdfCurrency,
  getCalendarInterval,
  getMonthlyTopProducts,
  getPosHardwareActions,
  getSalesReportBaseUnitPrice,
  getSalesReportPaidTotal,
} from '../../src/lib/reporting-calculations.ts';

test('allocates captured amounts after discounts and assigns cent remainders consistently', () => {
  const allocated = allocateSaleLineAmountPaid(
    [{ saleItemId: 'b', lineTotal: 50 }, { saleItemId: 'a', lineTotal: 50 }],
    1,
    [{ status: 'captured', amount: 99 }],
    {},
  );

  assert.deepEqual([...allocated.entries()], [['a', 49.5], ['b', 49.5]]);
  assert.equal(getSalesReportPaidTotal([...allocated.values()].map((amountPaid) => ({ amountPaid }))), 99);
});

test('allocates item return refunds to the matching line and manual refunds across remaining paid lines', () => {
  const allocated = allocateSaleLineAmountPaid(
    [{ saleItemId: 'a', lineTotal: 60 }, { saleItemId: 'b', lineTotal: 40 }],
    0,
    [
      { status: 'captured', amount: 100 },
      { status: 'refunded', amount: -30 },
    ],
    { a: 20 },
  );

  assert.deepEqual([...allocated.entries()], [['a', 35], ['b', 35]]);
  assert.equal(getSalesReportPaidTotal([...allocated.values()].map((amountPaid) => ({ amountPaid }))), 70);
});

test('supports partial captures and excludes voided payment events', () => {
  const allocated = allocateSaleLineAmountPaid(
    [{ saleItemId: 'a', lineTotal: 25 }, { saleItemId: 'b', lineTotal: 75 }],
    0,
    [
      { status: 'captured', amount: 20 },
      { status: 'voided', amount: 80 },
    ],
    {},
  );

  assert.deepEqual([...allocated.values()], [5, 15]);
});

test('returns Monday-to-Sunday weeks and full calendar month and year boundaries', () => {
  assert.deepEqual(getCalendarInterval('2026-03-01', 'weekly'), { startDate: '2026-02-23', endDate: '2026-03-01' });
  assert.deepEqual(getCalendarInterval('2026-02-10', 'monthly'), { startDate: '2026-02-01', endDate: '2026-02-28' });
  assert.deepEqual(getCalendarInterval('2026-12-31', 'yearly'), { startDate: '2026-01-01', endDate: '2026-12-31' });
});

test('ranks monthly products by net base units, aggregates products, and excludes voided or canceled sales', () => {
  const rows = getMonthlyTopProducts([
    { dateTime: '2026-10-02T03:00:00.000Z', productId: 'case-product', productName: 'Case item', baseUnitLabel: 'piece', netBaseUnitQuantity: 6, netRevenue: 54, status: 'completed' },
    { dateTime: '2026-10-04T03:00:00.000Z', productId: 'case-product', productName: 'Case item', baseUnitLabel: 'piece', netBaseUnitQuantity: 2, netRevenue: 18, status: 'partially_refunded' },
    { dateTime: '2026-10-05T03:00:00.000Z', productId: 'voided-product', productName: 'Voided', baseUnitLabel: 'unit', netBaseUnitQuantity: 20, netRevenue: 100, status: 'voided' },
    { dateTime: '2026-10-07T03:00:00.000Z', productId: 'canceled-product', productName: 'Canceled', baseUnitLabel: 'unit', netBaseUnitQuantity: 20, netRevenue: 100, status: 'canceled' },
    { dateTime: '2026-09-30T12:00:00.000Z', productId: 'prior-month', productName: 'September', baseUnitLabel: 'unit', netBaseUnitQuantity: 30, netRevenue: 300, status: 'completed' },
    { dateTime: '2026-10-06T03:00:00.000Z', productId: 'two-products', productName: 'Other', baseUnitLabel: 'unit', netBaseUnitQuantity: 7, netRevenue: 70, status: 'completed' },
  ], '2026-10');

  assert.deepEqual(rows.map((row) => [row.productName, row.quantitySold, row.salesAmount]), [
    ['Case item', 8, 72],
    ['Other', 7, 70],
  ]);
  assert.equal(getMonthlyTopProducts(Array.from({ length: 12 }, (_, index) => ({
    dateTime: '2026-10-08T03:00:00.000Z',
    productId: `product-${index}`,
    productName: `Product ${index}`,
    baseUnitLabel: 'unit',
    netBaseUnitQuantity: 12 - index,
    netRevenue: 12 - index,
    status: 'completed',
  })), '2026-10').length, 10);
});

test('keeps receipt printing and cash drawer controls independent', () => {
  assert.deepEqual(getPosHardwareActions({ receiptPrintingEnabled: false, cashDrawerIntegrationEnabled: true }, 'cash'), {
    printReceipt: false,
    openCashDrawer: true,
  });
  assert.deepEqual(getPosHardwareActions({ receiptPrintingEnabled: true, cashDrawerIntegrationEnabled: false }, 'cash'), {
    printReceipt: true,
    openCashDrawer: false,
  });
  assert.deepEqual(getPosHardwareActions({ receiptPrintingEnabled: false, cashDrawerIntegrationEnabled: false }, 'cash'), {
    printReceipt: false,
    openCashDrawer: false,
  });
  assert.deepEqual(getPosHardwareActions({ receiptPrintingEnabled: true, cashDrawerIntegrationEnabled: true }, 'gcash'), {
    printReceipt: true,
    openCashDrawer: false,
  });
});

test('normalizes package line values to historical base-unit prices', () => {
  assert.equal(getSalesReportBaseUnitPrice({ grossRevenue: 24, baseUnitQuantity: 6 }), 4);
  assert.equal(formatSalesReportPdfCurrency(1234.5), 'PHP 1,234.50');
});
