import assert from 'node:assert/strict';
import test from 'node:test';
import { getReceiptPrintFrameHeight, getReceiptPrintPageRule, printReceiptHtml } from '../../src/lib/receipt-print.ts';

test('thermal print frame height follows rendered receipt content rather than a fixed sheet', () => {
  assert.equal(getReceiptPrintFrameHeight('thermal', 443.2), '444px');
  assert.equal(getReceiptPrintFrameHeight('thermal', Number.NaN), '1px');
  assert.equal(getReceiptPrintFrameHeight('standard', 443.2), '297mm');
  assert.equal(getReceiptPrintPageRule('thermal', 443.2), '@page { size: 58mm 117.26mm; margin: 0; }');
  assert.equal(getReceiptPrintPageRule('standard', 443.2), '@page { size: A4; margin: 12mm; }');
});

test('one active receipt print request produces one browser print job and can reprint after close', async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const frames = [];
  let nextTimerId = 1;
  const timers = new Map();

  const fakeWindow = {
    setTimeout(callback) {
      const id = nextTimerId++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };

  const fakeDocument = {
    body: { appendChild(frame) { frame.onload?.(); } },
    getElementById() { return null; },
    createElement(tagName) {
      assert.equal(tagName, 'iframe');
      let html = '';
      const receiptElement = {
        scrollHeight: 443,
        getBoundingClientRect: () => ({ height: 442.4 }),
      };
      const frameDocument = {
        documentElement: { scrollHeight: 1200 },
        body: { scrollHeight: 1200 },
        getElementById(id) { return id === 'receipt-print-page-size' ? pageSizeStyle : null; },
        querySelector(selector) { return selector === '.receipt' ? receiptElement : null; },
        get writtenHtml() { return html; },
      };
      let printCalls = 0;
      const eventHandlers = new Map();
      const pageSizeStyle = { textContent: '@page { size: 58mm 100mm; margin: 0; }' };
      const frameWindow = {
        document: frameDocument,
        focus() {},
        print() { printCalls += 1; },
        addEventListener(type, handler) { eventHandlers.set(type, handler); },
        get printCalls() { return printCalls; },
        finishPrint() { eventHandlers.get('afterprint')?.(); },
      };
      const frame = {
        id: '',
        title: '',
        style: {},
        srcdoc: '',
        contentWindow: frameWindow,
        setAttribute() {},
        remove() { this.removed = true; },
        onload: null,
      };
      frames.push({ frame, frameWindow, frameDocument });
      return frame;
    },
  };

  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });

  try {
    const first = printReceiptHtml('<main class="receipt">first</main>', 'thermal');
    const duplicate = printReceiptHtml('<main class="receipt">duplicate</main>', 'thermal');
    await Promise.all([first, duplicate]);

    const [{ frame, frameWindow, frameDocument }] = frames;
    assert.equal(frameWindow.printCalls, 1);
    assert.equal(frame.style.width, '58mm');
    assert.equal(frame.style.height, '443px');
    assert.equal(frameDocument.getElementById('receipt-print-page-size').textContent, '@page { size: 58mm 117.21mm; margin: 0; }');
    assert.match(frame.srcdoc, /first/);
    assert.doesNotMatch(frame.srcdoc, /duplicate/);

    frameWindow.finishPrint();
    assert.equal(frame.removed, true);

    const reprint = printReceiptHtml('<main class="receipt">reprint</main>', 'thermal');
    await reprint;
    assert.equal(frames[1].frameWindow.printCalls, 1);
    frames[1].frameWindow.finishPrint();
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
    if (originalWindow === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
});
