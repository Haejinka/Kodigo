import assert from 'node:assert/strict';
import test from 'node:test';
import {
  connectLocalPrinters,
  findLocalPrinters,
  getLocalPrintAgentToken,
  hasLocalPrintAgentToken,
  openCashDrawer,
  pairLocalPrintAgent,
  printThermalReceipt,
  testCashDrawer,
} from '../../src/lib/hardware.ts';

test('reconnect repairs rejected tokens once, but never repairs or retries print jobs implicitly', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const entries = new Map([['kodigo.local-print-agent.pairing-token', 'a'.repeat(43)]]);
  const calls = [];
  globalThis.window = {
    localStorage: {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, value),
      removeItem: (key) => entries.delete(key),
    },
    setTimeout, clearTimeout,
  };
  globalThis.fetch = async (url, init) => {
    calls.push(url);
    if (url.endsWith('/v1/pair')) return { ok: true, json: async () => ({ token: 'b'.repeat(43) }) };
    if (init.headers.Authorization === `Bearer ${'a'.repeat(43)}`) {
      return { ok: false, status: 401, json: async () => ({ error: 'Pair this computer' }) };
    }
    return { ok: true, json: async () => ({ printers: ['Xprinter XP-58'] }) };
  };
  try {
    assert.deepEqual(await connectLocalPrinters(), { printers: ['Xprinter XP-58'], unavailablePrinters: [] });
    assert.deepEqual(calls.map((url) => new URL(url).pathname), ['/v1/printers', '/v1/pair', '/v1/printers']);
    calls.length = 0;
    await connectLocalPrinters();
    assert.equal(calls.length, 1);
    entries.set('kodigo.local-print-agent.pairing-token', 'a'.repeat(43));
    calls.length = 0;
    await assert.rejects(printThermalReceipt('Xprinter XP-58', 'sale', {}), /Pair this computer/);
    assert.equal(calls.length, 1);
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(connectLocalPrinters(), /Could not reach Kodigo Print Agent/);
    assert.equal(entries.get('kodigo.local-print-agent.pairing-token'), 'a'.repeat(43));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

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

test('one-click pairing asks the first-party local agent for a token and stores it without user copying', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const entries = new Map();
  const calls = [];
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
    calls.push({ url, init });
    return {
      ok: true,
      json: async () => ({ token: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK' }),
    };
  };

  try {
    const token = await pairLocalPrintAgent();
    assert.equal(token, 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK');
    assert.equal(entries.get('kodigo.local-print-agent.pairing-token'), token);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:17831/v1/pair');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});
