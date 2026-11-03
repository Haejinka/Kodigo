import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReceiptMarkup } from '../../src/lib/receipt-markup.ts';

const snapshot = {
  version: 2,
  sale: {
    id: 'sale-01',
    receipt_number: 'INV-TEST-0001',
    created_at: '2026-11-03T02:00:00.000Z',
    payment_method: 'cash',
    status: 'completed',
  },
  store: {
    id: 'store-01',
    name: 'Kodigo Demo Store',
    registeredName: 'Kodigo Demo Store',
    businessName: 'Kodigo Demo Store',
    address: 'Cebu City',
    vatStatus: 'non_vat',
    taxRate: 0,
    documentLabel: 'Sales Invoice',
  },
  cashier: { name: 'Test Cashier' },
  customer: {},
  items: [
    {
      product_name: 'Coke',
      quantity: 1,
      unit_price: 150,
      line_total: 150,
      item_discount_amount: 0,
    },
    {
      product_name: 'A very long product name that must wrap safely on narrow thermal paper without clipping',
      quantity: 2,
      unit_price: 40,
      line_total: 70,
      item_discount_amount: 10,
      selling_option_label: 'Two-pack',
    },
  ],
  payment: {
    method: 'cash',
    amount_tendered: 250,
    change_amount: 30,
  },
  totals: {
    subtotal: 230,
    discount: 10,
    discountCategory: 'regular',
    vatableSales: 0,
    vatAmount: 0,
    vatExemptSales: 0,
    zeroRatedSales: 0,
    nonVatSales: 220,
    total: 220,
    amountTendered: 250,
    change: 30,
  },
};

test('thermal receipt keeps narrow-paper sizing, wraps long names, and retains transaction amounts', () => {
  const html = buildReceiptMarkup(snapshot, 'thermal');

  assert.match(html, /@page \{ size: 58mm 100mm; margin: 0; \}/);
  assert.match(html, /\.receipt \{ width: 48mm;/);
  assert.match(html, /<th>Item<\/th><th><\/th><th class="num">Amount<\/th>/);
  assert.match(html, /overflow-wrap: anywhere/);
  assert.match(html, /A very long product name that must wrap safely/);
  assert.match(html, /Item discount: -₱10\.00/);
  assert.match(html, /Discount<\/td><td class="num">-₱10\.00/);
  assert.match(html, /₱220\.00/);
  assert.match(html, /Payment Method<\/td><td class="num">cash/);
  assert.match(html, /Amount Tendered<\/td><td class="num">₱250\.00/);
  assert.match(html, /Change<\/td><td class="num">₱30\.00/);
});

test('thermal receipt escapes item text and preserves standard-page layout when requested', () => {
  const unsafe = {
    ...snapshot,
    items: [{ ...snapshot.items[0], product_name: '<script>alert(1)</script>' }],
  };
  const thermal = buildReceiptMarkup(unsafe, 'thermal');
  const standard = buildReceiptMarkup(snapshot, 'standard');

  assert.match(thermal, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(thermal, /<script>alert\(1\)<\/script>/);
  assert.match(standard, /@page \{ size: A4; margin: 12mm; \}/);
  assert.match(standard, /\.receipt \{ width: 190mm;/);
});
