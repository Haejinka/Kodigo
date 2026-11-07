import assert from 'node:assert/strict';
import test from 'node:test';
import { findBarcodeMatch, normalizeBarcode, validateProductBarcodes } from '../../src/lib/product-barcodes.ts';
import { getAvailableSellingUnits, getOptionInventoryMultiplier, getOptionSellingPrice } from '../../src/types/index.ts';

const base = { id: 'piece', label: 'piece', unitLabel: 'piece', isDefault: true, isActive: true, inventoryMultiplier: 1, sharesBaseStock: true, sellingPrice: 65 };
const bundle = { ...base, id: 'case', label: 'Case', isDefault: false, isBulk: true, barcode: '00123456', inventoryMultiplier: 12, quantityValue: 12, pricingMethod: 'fixed', manualSellingPrice: 680, sellingPrice: 680 };
const product = { id: 'product', storeId: 'store', barcode: '00987654', sellingPrice: 65, currentStock: 24, bulkPurchaseEnabled: true, sellingOptions: [base, bundle] };

test('a case scan selects the exact case, price and 12-piece conversion', () => {
  const match = findBarcodeMatch([product], ' 00123456 ');
  assert.equal(match.option.id, 'case');
  assert.equal(getOptionSellingPrice(match.product, match.option), 680);
  assert.equal(getOptionInventoryMultiplier(match.option), 12);
  assert.equal(getAvailableSellingUnits(match.product, match.option), 2);
  assert.equal(findBarcodeMatch([product], '00123456').option.id, 'case');
});

test('main barcode always resolves to the base option', () => {
  assert.equal(findBarcodeMatch([product], '00987654').option.id, 'piece');
});

test('insufficient case stock never falls back to a piece', () => {
  const match = findBarcodeMatch([{ ...product, currentStock: 11 }], '00123456');
  assert.equal(match.option.id, 'case');
  assert.equal(getAvailableSellingUnits(match.product, match.option), 0);
});

test('unknown, blank, inactive option and archived product scans have no match', () => {
  assert.equal(findBarcodeMatch([product], 'missing'), undefined);
  assert.equal(findBarcodeMatch([product], '  '), undefined);
  assert.equal(findBarcodeMatch([{ ...product, isActive: false }], bundle.barcode), undefined);
  assert.equal(findBarcodeMatch([{ ...product, sellingOptions: [base, { ...bundle, isActive: false }] }], bundle.barcode), undefined);
});

test('leading zeroes survive normalization and blank barcodes stay optional', () => {
  assert.equal(normalizeBarcode(' 00123456 '), '00123456');
  assert.deepEqual(validateProductBarcodes({ ...product, barcode: '', sellingOptions: [base, { ...bundle, barcode: '' }] }, []), {});
});

test('duplicate main and option barcodes get errors on both form fields', () => {
  const errors = validateProductBarcodes({ ...product, barcode: bundle.barcode }, []);
  assert.ok(errors.barcode);
  assert.ok(errors['bulk-0-barcode']);
  const twoBundles = validateProductBarcodes({ ...product, sellingOptions: [base, bundle, { ...bundle, id: 'pack' }] }, []);
  assert.ok(twoBundles['bulk-0-barcode']);
  assert.ok(twoBundles['bulk-1-barcode']);
});

test('barcode conflicts include other products and their options within the same store', () => {
  const other = { ...product, id: 'other' };
  assert.ok(validateProductBarcodes(product, [other]).barcode);
  assert.ok(validateProductBarcodes(product, [other])['bulk-0-barcode']);
  assert.deepEqual(validateProductBarcodes(product, [{ ...other, storeId: 'different-store' }]), {});
  assert.deepEqual(validateProductBarcodes(product, [product], product.id), {});
});

test('disabled bundles do not claim barcodes on save', () => {
  assert.deepEqual(validateProductBarcodes({ ...product, bulkPurchaseEnabled: false, barcode: '' }, [{ ...product, id: 'other' }]), {});
});
