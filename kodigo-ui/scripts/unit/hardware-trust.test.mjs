import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findLocalPrinters,
  getLocalPrintAgentToken,
  hasLocalPrintAgentToken,
  openCashDrawer,
  printThermalReceipt,
  testCashDrawer,
} from '../../src/lib/hardware.ts';

test('local printer and drawer requests fail closed until this browser is paired with the agent', async () => {
  assert.equal(getLocalPrintAgentToken(), '');
  assert.equal(hasLocalPrintAgentToken(), false);
  await assert.rejects(findLocalPrinters(), { message: 'Pair this computer with Kodigo Print Agent before finding printers.' });
  await assert.rejects(openCashDrawer('Xprinter XP-58', '71d3baf1-b2f3-4e3d-bbb3-7cab9348b541'), { message: 'This computer is not paired with Kodigo Print Agent.' });
  await assert.rejects(printThermalReceipt('Xprinter XP-58', '71d3baf1-b2f3-4e3d-bbb3-7cab9348b541', {}), { message: 'This computer is not paired with Kodigo Print Agent. Pair it in Settings → POS hardware.' });
  await assert.rejects(testCashDrawer('Xprinter XP-58'), { message: 'Pair this computer with Kodigo Print Agent first.' });
});

test('thermal receipts submit one structured sale payload to the paired local agent', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const entries = new Map([
    ['kodigo.local-print-agent.pairing-token', 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK'],
    ['kodigo.pos.receipt-printer.store-01', 'Xprinter XP-58'],
  ]);
  const requests = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key) => entries.get(key) ?? null,
        setItem: (key, value) => entries.set(key, value),
        removeItem: (key) => entries.delete(key),
      },
      setTimeout: (callback) => setTimeout(callback, 5000),
      clearTimeout: (timer) => clearTimeout(timer),
    },
  });
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return { ok: true, json: async () => ({ submitted: true, duplicate: false, message: 'Windows accepted the receipt job.' }) };
  };

  try {
    const receipt = { version: 2, sale: { id: '71d3baf1-b2f3-4e3d-bbb3-7cab9348b541' }, items: [{ product_name: 'Coke' }] };
    const result = await printThermalReceipt('Xprinter XP-58', receipt.sale.id, receipt);
    assert.equal(result.submitted, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://127.0.0.1:17831/v1/receipts/print');
    assert.equal(requests[0].init.method, 'POST');
    assert.equal(requests[0].init.headers.Authorization, 'Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK');
    assert.deepEqual(JSON.parse(requests[0].init.body), {
      printerName: 'Xprinter XP-58',
      saleId: receipt.sale.id,
      reprint: false,
      receipt,
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});
