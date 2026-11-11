import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import {
  buildIssueOfflineLeaseCommand,
  buildRevokeOfflineLeaseCommand,
  parseOfflineLeaseSnapshot,
} from '../../src/lib/offline-authorization.ts';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const context = {
  operationId: '11111111-1111-4111-8111-111111111111',
  storeId: '22222222-2222-4222-8222-222222222222',
  terminalId: '33333333-3333-4333-8333-333333333333',
  shiftId: '44444444-4444-4444-8444-444444444444',
};

const pendingLease = {
  id: '55555555-5555-4555-8555-555555555555',
  store_id: context.storeId,
  terminal_id: context.terminalId,
  shift_id: context.shiftId,
  cashier_id: '66666666-6666-4666-8666-666666666666',
  prepared_at: '2026-11-11T00:00:00.000Z',
  issued_at: '2026-11-11T00:00:00.000Z',
  expires_at: '2026-11-11T08:00:00.000Z',
  last_mfa_at: null,
  activated_at: null,
  state: 'pending_stock',
  catalog_version: null,
  price_policy_hash: null,
  sequence_start: 1,
  sequence_end: 100,
  contract_version: 1,
  version: 1,
};

test('issue command carries only current cashier shift and no client-selected offline bounds', () => {
  const command = buildIssueOfflineLeaseCommand(context);

  assert.deepEqual(JSON.parse(JSON.stringify(command)), {
    contract_version: 1,
    operation_id: context.operationId,
    store_id: context.storeId,
    terminal_id: context.terminalId,
    shift_id: context.shiftId,
    occurred_at_local: null,
    terminal_sequence: null,
    expected_version: null,
    payload: {},
  });
  assert.equal(JSON.stringify(command).includes('expires'), false);
  assert.equal(JSON.stringify(command).includes('sequence_end'), false);
});

test('lease response parser accepts pending stock and nullable MFA/snapshot metadata', () => {
  assert.deepEqual(parseOfflineLeaseSnapshot(pendingLease), pendingLease);
});

test('lease response parser rejects an oversized sequence range or invalid hash', () => {
  assert.throws(() => parseOfflineLeaseSnapshot({ ...pendingLease, sequence_end: 101 }), /operation limit/);
  assert.throws(() => parseOfflineLeaseSnapshot({
    ...pendingLease,
    catalog_version: 'catalog-v1',
    price_policy_hash: 'invalid',
  }), /snapshot metadata/);
});

test('revocation command binds lease version and trims an auditable reason', () => {
  const lease = parseOfflineLeaseSnapshot(pendingLease);
  const command = buildRevokeOfflineLeaseCommand({
    operationId: '77777777-7777-4777-8777-777777777777',
    lease,
    reason: '  Device retired  ',
  });

  assert.equal(command.expected_version, lease.version);
  assert.deepEqual(JSON.parse(JSON.stringify(command.payload)), {
    lease_id: lease.id,
    reason: 'Device retired',
  });
  assert.throws(() => buildRevokeOfflineLeaseCommand({
    operationId: '88888888-8888-4888-8888-888888888888',
    lease,
    reason: '  ',
  }), /revocation reason/);
});
