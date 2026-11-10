import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseStoreCapabilityGrants,
  STORE_CAPABILITY_OPTIONS,
} from '../../src/lib/capabilities.ts';

const grant = {
  grant_id: '11111111-1111-4111-8111-111111111111',
  profile_id: '22222222-2222-4222-8222-222222222222',
  capability: 'approve_void',
  granted_by: '33333333-3333-4333-8333-333333333333',
  granted_at: '2026-11-11T10:00:00.000Z',
  grant_reason: 'Shift supervisor coverage',
};

test('store capability options expose only the supported scoped codes', () => {
  assert.deepEqual(STORE_CAPABILITY_OPTIONS.map(({ code }) => code), [
    'approve_void',
    'approve_return',
    'approve_refund',
    'approve_cash_adjustment',
    'approve_inventory_adjustment',
    'operate_digital_services',
    'view_customer_history',
    'manage_customers',
  ]);
});

test('capability grant parser accepts a typed server response', () => {
  assert.deepEqual(parseStoreCapabilityGrants([grant]), [grant]);
});

test('capability grant parser rejects unknown codes and unsupported response fields', () => {
  assert.throws(
    () => parseStoreCapabilityGrants([{ ...grant, capability: 'super_admin' }]),
    /invalid fields/,
  );
  assert.throws(
    () => parseStoreCapabilityGrants([{ ...grant, extra: true }]),
    /invalid fields/,
  );
  assert.throws(() => parseStoreCapabilityGrants(null), /must be an array/);
});
