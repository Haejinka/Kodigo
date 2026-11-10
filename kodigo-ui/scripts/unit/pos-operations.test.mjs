import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalOperationJson,
  createOperationCommand,
  hashOperationCommand,
} from '../../src/lib/pos-operations.ts';

const validCommand = (payload = { amount: '12.00', lines: [{ product_id: 'item-1', quantity: 2 }] }) => createOperationCommand({
  operation_id: '11111111-1111-4111-8111-111111111111',
  store_id: '22222222-2222-4222-8222-222222222222',
  terminal_id: null,
  shift_id: null,
  occurred_at_local: '2026-11-11T10:00:00+08:00',
  terminal_sequence: null,
  expected_version: null,
  payload,
});

test('canonical operation JSON sorts object keys and preserves array order', () => {
  assert.equal(canonicalOperationJson({ z: 1, a: { y: true, b: null }, list: [2, 1] }),
    '{"a":{"b":null,"y":true},"list":[2,1],"z":1}');
});

test('operation command has a stable UUID and versioned envelope for retries', () => {
  const command = validCommand();
  assert.equal(command.contract_version, 1);
  assert.equal(command.operation_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(command.payload.amount, '12.00');
  assert.equal(Object.isFrozen(command), true);
  assert.equal(Object.isFrozen(command.payload), true);
  assert.deepEqual(validCommand(), command);
});

test('operation command rejects invalid scope, sequence and unsupported JSON values', () => {
  assert.throws(() => createOperationCommand({ ...validCommand(), store_id: 'not-a-uuid' }), /Store ID must be a UUID/);
  assert.throws(() => createOperationCommand({ ...validCommand(), terminal_sequence: -1 }), /non-negative integer/);
  assert.throws(() => validCommand({ amount: Number.NaN }), /finite/);
  assert.throws(() => validCommand({ optional: undefined }), /undefined/);
  assert.throws(() => canonicalOperationJson({ [Symbol('hidden')]: true }), /symbol keys/);
  const circular = {};
  circular.self = circular;
  assert.throws(() => canonicalOperationJson(circular), /circular/);
  assert.throws(() => canonicalOperationJson({ date: new Date() }), /JSON values/);
});

test('operation hash is stable for reordered object keys and changes for semantic input changes', async () => {
  const first = validCommand({ a: 1, z: { y: 2, b: 3 } });
  const reordered = validCommand({ z: { b: 3, y: 2 }, a: 1 });
  const changed = validCommand({ a: 1, z: { y: 2, b: 4 } });
  const retryId = createOperationCommand({ ...first, operation_id: '33333333-3333-4333-8333-333333333333' });
  const firstHash = await hashOperationCommand(first);

  assert.match(firstHash, /^[a-f0-9]{64}$/);
  assert.equal(await hashOperationCommand(reordered), firstHash);
  assert.equal(await hashOperationCommand(retryId), firstHash);
  assert.notEqual(await hashOperationCommand(changed), firstHash);
});
