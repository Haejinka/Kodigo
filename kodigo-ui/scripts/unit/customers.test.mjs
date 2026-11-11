import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAssociateSaleCustomerCommand,
  buildCreateCustomerCommand,
  buildUpdateCustomerCommand,
  parseCustomerProfile,
  parseCustomerSummaries,
} from '../../src/lib/customers.ts';

const storeId = '11111111-1111-4111-8111-111111111111';
const customerId = '22222222-2222-4222-8222-222222222222';
const saleId = '33333333-3333-4333-8333-333333333333';
const operationId = '44444444-4444-4444-8444-444444444444';

const customer = {
  id: customerId,
  store_id: storeId,
  display_name: 'Alex Customer',
  phone: null,
  email: 'alex@example.com',
  active: true,
  version: 1,
  created_at: '2026-11-11T05:00:00.000Z',
  updated_at: '2026-11-11T05:00:00.000Z',
  archived_at: null,
};

test('customer create command trims optional profile data and keeps a reusable operation ID', () => {
  const command = buildCreateCustomerCommand({
    storeId,
    operationId,
    displayName: '  Alex Customer  ',
    phone: '  09170000000  ',
    email: ' alex@example.com ',
  });

  assert.equal(command.operation_id, operationId);
  assert.equal(command.store_id, storeId);
  assert.equal(command.expected_version, null);
  assert.deepEqual(command.payload, {
    display_name: 'Alex Customer',
    phone: '09170000000',
    email: 'alex@example.com',
  });
});

test('customer update and retroactive association require a current version and reason', () => {
  const update = buildUpdateCustomerCommand({
    storeId,
    operationId,
    customerId,
    expectedVersion: 3,
    displayName: 'Alex Customer',
    phone: null,
    email: null,
  });
  const association = buildAssociateSaleCustomerCommand({
    storeId,
    operationId,
    customerId,
    saleId,
    expectedVersion: 3,
    reason: 'Customer confirmed this prior purchase',
  });

  assert.equal(update.expected_version, 3);
  assert.equal(association.expected_version, 3);
  assert.equal(association.payload.reason, 'Customer confirmed this prior purchase');
  assert.throws(() => buildUpdateCustomerCommand({
    storeId,
    customerId,
    expectedVersion: 0,
    displayName: 'Alex Customer',
  }), /positive safe integer/);
  assert.throws(() => buildAssociateSaleCustomerCommand({
    storeId,
    customerId,
    saleId,
    expectedVersion: 1,
    reason: '  '
  }), /3 to 500/);
});

test('customer summaries expose only the minimum identity fields', () => {
  assert.deepEqual(parseCustomerSummaries([{ id: customerId, display_name: 'Alex Customer' }]), [
    { id: customerId, display_name: 'Alex Customer' },
  ]);
  assert.throws(
    () => parseCustomerSummaries([{ id: customerId, display_name: 'Alex Customer', phone: '0917' }]),
    /invalid fields/,
  );
});

test('customer profile parser rejects another tenant’s unexpected fields and invalid versions', () => {
  assert.deepEqual(parseCustomerProfile(customer), customer);
  assert.throws(
    () => parseCustomerProfile({ ...customer, store_name: 'Not a profile field' }),
    /invalid fields/,
  );
  assert.throws(
    () => parseCustomerProfile({ ...customer, version: 0 }),
    /invalid fields/,
  );
});
