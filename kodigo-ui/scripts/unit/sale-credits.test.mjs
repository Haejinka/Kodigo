import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocateSaleCreditAmount,
  calculateCumulativeSaleLineCredit,
} from '../../src/lib/sale-credits.ts';

test('largest-remainder credit allocation is exact and breaks ties by sale item ID', () => {
  const amounts = allocateSaleCreditAmount('0.05', [
    { saleItemId: 'b', weight: '1.00' },
    { saleItemId: 'c', weight: '1.00' },
    { saleItemId: 'a', weight: '1.00' },
  ]);

  assert.deepEqual([...amounts], [['a', '0.02'], ['b', '0.02'], ['c', '0.01']]);
});

test('partial credits use cumulative centavo residuals and preserve snapshot shares', () => {
  const first = calculateCumulativeSaleLineCredit({
    soldQuantity: 3,
    previouslyCreditedQuantity: 0,
    requestedQuantity: 1,
    originalNetAmount: '10.00',
    previousCreditAmount: '0.00',
    originalDiscountAmount: '1.00',
    previousDiscountShare: '0.00',
    originalVatAmount: '1.07',
    previousVatShare: '0.00',
    originalBaseQuantity: '12.000000',
    previousBaseQuantity: '0.000000',
    originalCogsAmount: '3.01',
    previousCogsRecovered: '0.00',
  });
  const second = calculateCumulativeSaleLineCredit({
    soldQuantity: 3,
    previouslyCreditedQuantity: 1,
    requestedQuantity: 1,
    originalNetAmount: '10.00',
    previousCreditAmount: first.amount,
    originalDiscountAmount: '1.00',
    previousDiscountShare: first.discountShare,
    originalVatAmount: '1.07',
    previousVatShare: first.vatShare,
    originalBaseQuantity: '12.000000',
    previousBaseQuantity: first.baseQuantity,
    originalCogsAmount: '3.01',
    previousCogsRecovered: first.cogsCapacity,
  });
  const final = calculateCumulativeSaleLineCredit({
    soldQuantity: 3,
    previouslyCreditedQuantity: 2,
    requestedQuantity: 1,
    originalNetAmount: '10.00',
    previousCreditAmount: '6.67',
    originalDiscountAmount: '1.00',
    previousDiscountShare: '0.67',
    originalVatAmount: '1.07',
    previousVatShare: '0.71',
    originalBaseQuantity: '12.000000',
    previousBaseQuantity: '8.000000',
    originalCogsAmount: '3.01',
    previousCogsRecovered: '2.01',
  });

  assert.equal(first.amount, '3.33');
  assert.equal(second.amount, '3.34');
  assert.equal(final.amount, '3.33');
  assert.deepEqual([first.discountShare, second.discountShare, final.discountShare], ['0.33', '0.34', '0.33']);
  assert.deepEqual([first.vatShare, second.vatShare, final.vatShare], ['0.36', '0.35', '0.36']);
  assert.deepEqual([first.baseQuantity, second.baseQuantity, final.baseQuantity], ['4.000000', '4.000000', '4.000000']);
});

test('partial credit rejects stale allocations, zero quantities, and quantities beyond the sale', () => {
  assert.throws(() => calculateCumulativeSaleLineCredit({
    soldQuantity: 3,
    previouslyCreditedQuantity: 1,
    requestedQuantity: 1,
    originalNetAmount: '10.00',
    previousCreditAmount: '6.67',
  }), /Prior allocation/);

  assert.throws(() => calculateCumulativeSaleLineCredit({
    soldQuantity: 3,
    previouslyCreditedQuantity: 3,
    requestedQuantity: 1,
    originalNetAmount: '10.00',
    previousCreditAmount: '10.00',
  }), /Credit quantity/);
});
