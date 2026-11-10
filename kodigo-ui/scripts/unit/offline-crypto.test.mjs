import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import {
  OfflineKeySession,
  createOfflineMasterKey,
  decryptOfflinePayload,
  encryptOfflinePayload,
  unlockOfflineMasterKey,
} from '../../src/lib/offline-crypto.ts';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const scope = {
  recordId: '11111111-1111-4111-8111-111111111111',
  storeId: '22222222-2222-4222-8222-222222222222',
  actorId: '33333333-3333-4333-8333-333333333333',
  terminalId: '44444444-4444-4444-8444-444444444444',
};
const keyScope = { storeId: scope.storeId, actorId: scope.actorId, terminalId: scope.terminalId };

test('offline master key wraps, unlocks, and encrypts payload without storing plaintext', async () => {
  const material = await createOfflineMasterKey('test-only passphrase', keyScope);
  const unlocked = await unlockOfflineMasterKey('test-only passphrase', material.wrapped, keyScope);
  const payload = { customer: 'Sensitive Example', total: '10.00', lines: [{ product_id: 'p1', quantity: 1 }] };
  const encrypted = await encryptOfflinePayload(payload, unlocked, scope);

  assert.equal(material.wrapped.iterations, 600_000);
  assert.equal(material.wrapped.kdf, 'PBKDF2-SHA256');
  assert.equal(encrypted.iv.length, 16);
  assert.equal(encrypted.ciphertext.includes('Sensitive Example'), false);
  assert.deepEqual(await decryptOfflinePayload(encrypted, unlocked, scope), payload);
});

test('offline payload authentication binds store, actor, terminal, and record identity', async () => {
  const material = await createOfflineMasterKey('test-only passphrase', keyScope);
  const encrypted = await encryptOfflinePayload({ amount: '4.50' }, material.key, scope);

  await assert.rejects(decryptOfflinePayload(encrypted, material.key, { ...scope, actorId: '55555555-5555-4555-8555-555555555555' }), /authenticated/);
  await assert.rejects(decryptOfflinePayload(encrypted, material.key, { ...scope, terminalId: '66666666-6666-4666-8666-666666666666' }), /authenticated/);
  await assert.rejects(decryptOfflinePayload(encrypted, material.key, { ...scope, recordId: '77777777-7777-4777-8777-777777777777' }), /authenticated/);
  await assert.rejects(decryptOfflinePayload(encrypted, material.key, { ...scope, storeId: '88888888-8888-4888-8888-888888888888' }), /authenticated/);
});

test('offline records use unique random IVs and wrong passphrases cannot unlock', async () => {
  const material = await createOfflineMasterKey('test-only passphrase', keyScope);
  const first = await encryptOfflinePayload({ operation_id: 'a' }, material.key, scope);
  const second = await encryptOfflinePayload({ operation_id: 'b' }, material.key, { ...scope, recordId: '99999999-9999-4999-8999-999999999999' });

  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
  await assert.rejects(unlockOfflineMasterKey('incorrect passphrase', material.wrapped, keyScope), /Unable to unlock/);
  await assert.rejects(unlockOfflineMasterKey('test-only passphrase', material.wrapped, { ...keyScope, actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }), /incompatible/);
});

test('offline key session drops the in-memory key when locked', async () => {
  const material = await createOfflineMasterKey('test-only passphrase', keyScope);
  const session = new OfflineKeySession(material.key, 60_000);

  assert.equal(session.isUnlocked, true);
  assert.equal(session.getKey(), material.key);
  session.lock();
  assert.equal(session.isUnlocked, false);
  assert.throws(() => session.getKey(), /Offline data is locked/);
});
