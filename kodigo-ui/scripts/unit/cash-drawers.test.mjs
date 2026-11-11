import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOpenCashierShiftCommand,
  buildRegisterCashDrawerCommand,
  buildRegisterPosTerminalCommand,
  parseCashierShiftPosition,
} from '../../src/lib/cash-drawers.ts';

const context = {
  operationId: '11111111-1111-4111-8111-111111111111',
  storeId: '22222222-2222-4222-8222-222222222222',
  occurredAtLocal: '2026-11-11T08:30:00+08:00',
};

test('terminal registration command normalizes display metadata and carries no actor override', () => {
  const command = buildRegisterPosTerminalCommand({
    ...context,
    name: '  Front Counter  ',
    displayIdentifier: '  COUNTER-A  ',
  });

  assert.deepEqual(JSON.parse(JSON.stringify(command)), {
    contract_version: 1,
    operation_id: context.operationId,
    store_id: context.storeId,
    terminal_id: null,
    shift_id: null,
    occurred_at_local: context.occurredAtLocal,
    terminal_sequence: null,
    expected_version: null,
    payload: { name: 'Front Counter', display_identifier: 'COUNTER-A' },
  });
  assert.equal('actor_id' in command, false);
});

test('drawer registration binds optional terminal context to its payload', () => {
  const terminalId = '33333333-3333-4333-8333-333333333333';
  const command = buildRegisterCashDrawerCommand({
    ...context,
    name: 'Drawer 1',
    terminalId,
  });

  assert.equal(command.terminal_id, terminalId);
  assert.equal(command.payload.terminal_id, terminalId);
  assert.equal(command.payload.name, 'Drawer 1');
});

test('shift opening uses exact non-negative money strings and registered identifiers', () => {
  const terminalId = '33333333-3333-4333-8333-333333333333';
  const drawerId = '44444444-4444-4444-8444-444444444444';
  const command = buildOpenCashierShiftCommand({
    ...context,
    terminalId,
    drawerId,
    openingCash: '000750.5',
  });

  assert.equal(command.terminal_id, terminalId);
  assert.equal(command.shift_id, null);
  assert.deepEqual(JSON.parse(JSON.stringify(command.payload)), { drawer_id: drawerId, opening_cash: '750.50' });
});

test('cash custody command builders reject malformed IDs, names, and unsupported money precision', () => {
  assert.throws(() => buildRegisterPosTerminalCommand({ ...context, name: '   ' }), /1 to 100 characters/);
  assert.throws(() => buildRegisterPosTerminalCommand({ ...context, name: 'Terminal', displayIdentifier: 'x'.repeat(121) }), /120 characters/);
  assert.throws(() => buildRegisterCashDrawerCommand({ ...context, name: 'Drawer', terminalId: 'not-a-uuid' }), /Terminal ID must be a UUID/);
  assert.throws(() => buildOpenCashierShiftCommand({
    ...context,
    terminalId: '33333333-3333-4333-8333-333333333333',
    drawerId: '44444444-4444-4444-8444-444444444444',
    openingCash: '-1.00',
  }), /non-negative amount/);
  assert.throws(() => buildOpenCashierShiftCommand({
    ...context,
    terminalId: '33333333-3333-4333-8333-333333333333',
    drawerId: '44444444-4444-4444-8444-444444444444',
    openingCash: '1.005',
  }), /at most two decimals/);
});

test('cash position parser preserves centavos and verifies the server balance projection', () => {
  const position = parseCashierShiftPosition({
    shift_id: '44444444-4444-4444-8444-444444444444',
    state: 'active',
    version: 4,
    last_cash_sequence: '12',
    posted_balance: '620.00',
    reserved_balance: '20.50',
    available_balance: '599.50',
    movement_count: 5,
  });
  assert.equal(position.posted_balance, '620.00');
  assert.equal(position.reserved_balance, '20.50');
  assert.equal(position.available_balance, '599.50');
  assert.throws(() => parseCashierShiftPosition({
    shift_id: '44444444-4444-4444-8444-444444444444',
    state: 'active',
    version: 4,
    last_cash_sequence: '12',
    posted_balance: '620.00',
    reserved_balance: '20.50',
    available_balance: '600.00',
    movement_count: 5,
  }), /invalid cash shift position/);
  assert.throws(() => parseCashierShiftPosition({
    shift_id: '44444444-4444-4444-8444-444444444444',
    state: 'active',
    version: 4,
    last_cash_sequence: '12',
    posted_balance: '620',
    reserved_balance: '20.50',
    available_balance: '599.50',
    movement_count: 5,
  }), /invalid posted cash balance/);
});
