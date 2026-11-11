import type { ConfirmedOperationResult, OperationCommandV1 } from '@/types/operations';
import type { CashCustodySnapshot, CashDrawer, CashierShift, PosTerminal } from '@/types/cash-drawers';
import { createOperationCommand } from './pos-operations.ts';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const openingCashPattern = /^([0-9]{1,12})(?:\.([0-9]{1,2}))?$/;

interface CommandContext {
  operationId: string;
  storeId: string;
  occurredAtLocal?: string | null;
}

function normalizeUuid(value: string, label: string): string {
  if (!uuidPattern.test(value)) throw new TypeError(`${label} must be a UUID.`);
  return value.toLowerCase();
}

function normalizeName(value: string, label: string): string {
  const name = value.trim();
  const length = Array.from(name).length;
  if (length < 1 || length > 100) throw new TypeError(`${label} must contain 1 to 100 characters.`);
  return name;
}

function normalizeDisplayIdentifier(value: string | null | undefined): string | null {
  if (value == null) return null;
  const identifier = value.trim();
  if (Array.from(identifier).length > 120) throw new TypeError('Display identifier cannot exceed 120 characters.');
  return identifier || null;
}

function normalizeOpeningCash(value: string): string {
  const match = openingCashPattern.exec(value.trim());
  if (!match) throw new TypeError('Opening cash must be a non-negative amount with at most two decimals.');
  const whole = match[1].replace(/^0+(?=\d)/, '');
  const fraction = (match[2] ?? '').padEnd(2, '0');
  return `${whole}.${fraction}`;
}

function buildCommand(
  context: CommandContext,
  terminalId: string | null,
  payload: Record<string, string | null>,
): OperationCommandV1 {
  return createOperationCommand({
    operation_id: normalizeUuid(context.operationId, 'Operation ID'),
    store_id: normalizeUuid(context.storeId, 'Store ID'),
    terminal_id: terminalId,
    shift_id: null,
    occurred_at_local: context.occurredAtLocal ?? null,
    terminal_sequence: null,
    expected_version: null,
    payload,
  });
}

export function buildRegisterPosTerminalCommand(input: CommandContext & {
  name: string;
  displayIdentifier?: string | null;
}): OperationCommandV1 {
  return buildCommand(input, null, {
    name: normalizeName(input.name, 'Terminal name'),
    display_identifier: normalizeDisplayIdentifier(input.displayIdentifier),
  });
}

export function buildRegisterCashDrawerCommand(input: CommandContext & {
  name: string;
  terminalId?: string | null;
}): OperationCommandV1 {
  const terminalId = input.terminalId == null
    ? null
    : normalizeUuid(input.terminalId, 'Terminal ID');
  return buildCommand(input, terminalId, {
    name: normalizeName(input.name, 'Cash drawer name'),
    terminal_id: terminalId,
  });
}

export function buildOpenCashierShiftCommand(input: CommandContext & {
  drawerId: string;
  terminalId: string;
  openingCash: string;
}): OperationCommandV1 {
  return buildCommand(input, normalizeUuid(input.terminalId, 'Terminal ID'), {
    drawer_id: normalizeUuid(input.drawerId, 'Drawer ID'),
    opening_cash: normalizeOpeningCash(input.openingCash),
  });
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} returned an invalid response.`);
  }
  return value as Record<string, unknown>;
}

function parseConfirmedResult<T>(
  value: unknown,
  expectedOperationId: string,
  expectedAggregateType: string,
): ConfirmedOperationResult<T> {
  const result = asRecord(value, 'Cash custody command');
  if (result.contract_version !== 1
    || result.operation_id !== expectedOperationId
    || result.outcome !== 'confirmed'
    || result.aggregate_type !== expectedAggregateType
    || typeof result.aggregate_id !== 'string'
    || !Number.isSafeInteger(result.aggregate_version)
    || (result.aggregate_version as number) < 1
    || typeof result.confirmed_at !== 'string') {
    throw new TypeError('Server returned an invalid cash custody command result.');
  }
  asRecord(result.result, 'Cash custody command result');
  return result as unknown as ConfirmedOperationResult<T>;
}

function isPosTerminal(value: unknown): value is PosTerminal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const terminal = value as Record<string, unknown>;
  return typeof terminal.id === 'string'
    && uuidPattern.test(terminal.id)
    && typeof terminal.store_id === 'string'
    && uuidPattern.test(terminal.store_id)
    && typeof terminal.name === 'string'
    && (terminal.display_identifier === null || typeof terminal.display_identifier === 'string')
    && typeof terminal.active === 'boolean'
    && Number.isSafeInteger(terminal.version)
    && typeof terminal.created_at === 'string';
}

function isCashDrawer(value: unknown): value is CashDrawer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const drawer = value as Record<string, unknown>;
  return typeof drawer.id === 'string'
    && uuidPattern.test(drawer.id)
    && typeof drawer.store_id === 'string'
    && uuidPattern.test(drawer.store_id)
    && typeof drawer.name === 'string'
    && (drawer.terminal_id === null || (typeof drawer.terminal_id === 'string' && uuidPattern.test(drawer.terminal_id)))
    && typeof drawer.active === 'boolean'
    && Number.isSafeInteger(drawer.version)
    && typeof drawer.created_at === 'string';
}

function parseCashCustodySnapshot(value: unknown): CashCustodySnapshot {
  const snapshot = asRecord(value, 'Cash custody list');
  if (!Array.isArray(snapshot.terminals) || !snapshot.terminals.every(isPosTerminal)
    || !Array.isArray(snapshot.drawers) || !snapshot.drawers.every(isCashDrawer)) {
    throw new TypeError('Server returned an invalid cash custody list.');
  }
  return { terminals: snapshot.terminals, drawers: snapshot.drawers };
}

function isCashierShift(value: unknown): value is CashierShift {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const shift = value as Record<string, unknown>;
  return typeof shift.id === 'string'
    && uuidPattern.test(shift.id)
    && typeof shift.store_id === 'string'
    && uuidPattern.test(shift.store_id)
    && typeof shift.drawer_id === 'string'
    && uuidPattern.test(shift.drawer_id)
    && typeof shift.terminal_id === 'string'
    && uuidPattern.test(shift.terminal_id)
    && typeof shift.cashier_id === 'string'
    && uuidPattern.test(shift.cashier_id)
    && typeof shift.cashier_name_snapshot === 'string'
    && (shift.state === 'active' || shift.state === 'submitting' || shift.state === 'closed')
    && Number.isSafeInteger(shift.version)
    && typeof shift.opening_amount === 'string'
    && typeof shift.opened_at === 'string'
    && (shift.occurred_at_local === null || typeof shift.occurred_at_local === 'string');
}

export async function listStoreCashCustody(storeId: string): Promise<CashCustodySnapshot> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('list_store_cash_custody', {
    p_store_id: normalizeUuid(storeId, 'Store ID'),
  });
  if (error) throw error;
  return parseCashCustodySnapshot(data);
}

export async function registerPosTerminal(input: CommandContext & {
  name: string;
  displayIdentifier?: string | null;
}): Promise<ConfirmedOperationResult<PosTerminal>> {
  const command = buildRegisterPosTerminalCommand(input);
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('register_pos_terminal', { p_command: command });
  if (error) throw error;
  return parseConfirmedResult<PosTerminal>(data, command.operation_id, 'pos_terminal');
}

export async function registerCashDrawer(input: CommandContext & {
  name: string;
  terminalId?: string | null;
}): Promise<ConfirmedOperationResult<CashDrawer>> {
  const command = buildRegisterCashDrawerCommand(input);
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('register_cash_drawer', { p_command: command });
  if (error) throw error;
  return parseConfirmedResult<CashDrawer>(data, command.operation_id, 'cash_drawer');
}

export async function openCashierShift(input: CommandContext & {
  drawerId: string;
  terminalId: string;
  openingCash: string;
}): Promise<ConfirmedOperationResult<CashierShift>> {
  const command = buildOpenCashierShiftCommand(input);
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('open_cashier_shift', { p_command: command });
  if (error) throw error;
  const result = parseConfirmedResult<CashierShift>(data, command.operation_id, 'cashier_shift');
  if (!isCashierShift(result.result)) throw new TypeError('Server returned an invalid cashier shift.');
  return result;
}
