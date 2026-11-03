import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findLocalReceiptPrinters,
  isQzTraySigningConfigured,
  openCashDrawer,
  QZ_TRUST_SETUP_MESSAGE,
} from '../../src/lib/hardware.ts';

test('untrusted QZ discovery and drawer actions fail closed without opening a local connection', async () => {
  assert.equal(isQzTraySigningConfigured(), false);
  await assert.rejects(findLocalReceiptPrinters(), { message: QZ_TRUST_SETUP_MESSAGE });
  assert.equal(await openCashDrawer('Xprinter XP-58'), false);
  assert.equal(await openCashDrawer(''), false);
});
