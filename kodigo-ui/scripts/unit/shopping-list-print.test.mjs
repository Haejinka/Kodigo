import assert from 'node:assert/strict';
import test from 'node:test';
import { printDocumentHtml } from '../../src/lib/document-print.ts';
import {
  buildShoppingListText,
  createShoppingListSnapshot,
  printShoppingList,
} from '../../src/lib/shopping-lists.ts';
import {
  buildShoppingListMarkup,
  getShoppingListPageRule,
} from '../../src/lib/shopping-list-markup.ts';
import { hashShoppingListDocument } from '../../src/lib/hardware.ts';

const createSnapshot = (overrides = {}) => createShoppingListSnapshot({
  storeId: 'store-1',
  storeName: 'JP Store',
  items: [{
    productId: 'product-1',
    productName: 'Café <script>alert("x")</script>\u001b',
    quantity: 2,
    purchaseUnit: 'case',
    subtotal: 120,
    isEstimated: true,
  }],
}, {
  documentId: 'document-1',
  createdAt: '2026-11-11T10:00:00.000Z',
  ...overrides,
});

test('shopping-list snapshot freezes the current receiving quantities and prices', () => {
  const snapshot = createSnapshot();

  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.items[0].quantity, 2);
  assert.equal(snapshot.items[0].purchaseUnit, 'case');
  assert.equal(snapshot.items[0].unitPrice, 60);
  assert.equal(snapshot.items[0].subtotal, 120);
  assert.equal(snapshot.items[0].isEstimated, true);
  assert.equal(snapshot.total, 120);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.items), true);
  assert.equal(Object.isFrozen(snapshot.items[0]), true);
  assert.match(buildShoppingListText(snapshot), /TOTAL AMOUNT/);
});

test('zero quantity keeps an explicit zero subtotal and never divides by zero', () => {
  const snapshot = createShoppingListSnapshot({
    storeId: 'store-1',
    storeName: 'JP Store',
    items: [{
      productId: 'product-2',
      productName: 'Zero quantity item',
      quantity: 0,
      purchaseUnit: 'box',
      subtotal: 0,
      isEstimated: true,
    }],
  }, { documentId: 'document-2', createdAt: '2026-11-11T10:00:00.000Z' });

  assert.equal(snapshot.items[0].unitPrice, 0);
  assert.equal(snapshot.total, 0);
});

test('shopping-list snapshot rejects invalid values and empty selections', () => {
  assert.throws(() => createShoppingListSnapshot({ storeId: 's', storeName: 'S', items: [] }), /Select at least one item/);
  assert.throws(() => createShoppingListSnapshot({
    storeId: 's', storeName: 'S', items: [{
      productId: 'p', productName: 'P', quantity: -1, purchaseUnit: 'case', subtotal: 1, isEstimated: false,
    }],
  }), /Quantity must be a finite, non-negative number/);
});

test('shopping-list markup supports both widths and escapes text and printer controls', () => {
  const snapshot = createSnapshot();
  const narrow = buildShoppingListMarkup(snapshot, '58mm');
  const wide = buildShoppingListMarkup(snapshot, '80mm', { showPrices: false });

  assert.match(narrow, /size: 58mm 100mm/);
  assert.match(narrow, /data-columns="32"/);
  assert.match(narrow, /SHOPPING LIST — NOT A SALES RECEIPT/);
  assert.match(narrow, /Café &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(narrow, /\u001b|<script>/);
  assert.match(narrow, /Estimated cost/);
  assert.match(wide, /size: 80mm 100mm/);
  assert.match(wide, /data-columns="48"/);
  assert.doesNotMatch(wide, /Estimated cost|Estimated \/ entered total|PHP/);
  assert.doesNotMatch(wide, /Invoice No\.|Total Amount Due|receipt_number|Payment Method|VAT Amount/);
  assert.equal(getShoppingListPageRule('80mm', 300), '@page { size: 80mm 79.38mm; margin: 0; }');
});

test('native document hash changes when content, paper profile, or price visibility changes', async () => {
  const snapshot = createSnapshot();
  const narrow = await hashShoppingListDocument(snapshot, '58mm', true);
  const wide = await hashShoppingListDocument(snapshot, '80mm', true);
  const noPrices = await hashShoppingListDocument(snapshot, '58mm', false);
  const changed = await hashShoppingListDocument({ ...snapshot, storeName: 'Another Store' }, '58mm', true);

  assert.match(narrow, /^[a-f0-9]{64}$/);
  assert.notEqual(narrow, wide);
  assert.notEqual(narrow, noPrices);
  assert.notEqual(narrow, changed);
});

test('browser document transport opens one dynamic-width print job for the shopping list', async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const frames = [];
  const timers = new Map();
  let nextTimerId = 1;
  const fakeWindow = {
    setTimeout(callback) { const id = nextTimerId++; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const pageSizeStyle = { textContent: '' };
  const fakeDocument = {
    body: { appendChild(frame) { frame.onload?.(); } },
    getElementById() { return null; },
    createElement(tagName) {
      assert.equal(tagName, 'iframe');
      const content = { scrollHeight: 300, getBoundingClientRect: () => ({ height: 299.2 }) };
      const frameDocument = {
        querySelector: (selector) => selector === '.shopping-list' ? content : null,
        getElementById: (id) => id === 'shopping-list-print-page-size' ? pageSizeStyle : null,
      };
      let printCalls = 0;
      const handlers = new Map();
      const frameWindow = {
        document: frameDocument,
        focus() {},
        print() { printCalls += 1; },
        addEventListener(type, handler) { handlers.set(type, handler); },
        finishPrint() { handlers.get('afterprint')?.(); },
        get printCalls() { return printCalls; },
      };
      const frame = {
        id: '', title: '', style: {}, srcdoc: '', contentWindow: frameWindow, onload: null,
        setAttribute() {}, remove() { this.removed = true; },
      };
      frames.push({ frame, frameWindow });
      return frame;
    },
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });

  try {
    const first = printShoppingList(createSnapshot(), '80mm');
    const duplicate = printShoppingList(createSnapshot({ documentId: 'document-duplicate' }), '58mm');
    const concurrentReceipt = printDocumentHtml('<main class="receipt">receipt</main>', {
      frameId: 'receipt-print-frame',
      frameTitle: 'Receipt print',
      contentSelector: '.receipt',
      frameWidth: '58mm',
      getFrameHeight: () => '1px',
      preparationErrorMessage: 'Unable to prepare the receipt for printing.',
    });
    await assert.rejects(concurrentReceipt, /Another document is already using the browser print dialog/);
    await Promise.all([first, duplicate]);

    assert.equal(frames.length, 1);
    assert.equal(frames[0].frame.style.width, '80mm');
    assert.equal(frames[0].frame.style.height, '300px');
    assert.equal(frames[0].frameWindow.printCalls, 1);
    assert.equal(pageSizeStyle.textContent, '@page { size: 80mm 79.38mm; margin: 0; }');
    frames[0].frameWindow.finishPrint();
    assert.equal(frames[0].frame.removed, true);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
    if (originalWindow === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});
