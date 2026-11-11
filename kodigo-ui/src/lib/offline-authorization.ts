import type { IDBPDatabase } from 'idb';
import type { ConfirmedOperationResult, OperationCommandV1 } from '@/types/operations';
import type { OfflineLeaseSnapshot } from '@/types/offline';
import type { OfflineDatabase } from './offline-db';
import { offlineScopeKey, persistOfflineLeaseSnapshot } from './offline-db';
import { parseConfirmedOperationResult, createOperationCommand } from './pos-operations';
import type { OfflineKeySession } from './offline-crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LEASE_DURATION_MS = 8 * 60 * 60 * 1000;
const MAX_LEASE_OPERATIONS = 100;

export interface OfflineLeaseScope {
  storeId: string;
  actorId: string;
  terminalId: string;
}

/** Refuse a new lease until this terminal's earlier work is acknowledged or explicitly recovered. */
export async function assertOfflineLeaseQueueDrained(
  database: IDBPDatabase<OfflineDatabase>,
  scope: OfflineLeaseScope,
): Promise<void> {
  const tx = database.transaction([
    'terminal_meta', 'operations_outbox', 'operation_acks', 'sales_queue', 'generic_mutations', 'legacy_recovery',
  ], 'readonly');
  const [metadata, operations, acknowledgements, sales, mutations, recovery] = await Promise.all([
    tx.objectStore('terminal_meta').get(offlineScopeKey(scope)),
    tx.objectStore('operations_outbox').getAll(),
    tx.objectStore('operation_acks').getAll(),
    tx.objectStore('sales_queue').getAll(),
    tx.objectStore('generic_mutations').getAll(),
    tx.objectStore('legacy_recovery').getAll(),
  ]);
  await tx.done;

  const laneOperations = operations.filter((operation) => operation.store_id === scope.storeId
    && operation.terminal_id === scope.terminalId);
  const laneAcks = new Map(acknowledgements.filter((ack) => ack.store_id === scope.storeId
    && ack.terminal_id === scope.terminalId).map((ack) => [ack.operation_id, ack]));
  const unresolvedLeaseEvidence = recovery.some((record) => record.recovery_state === 'unreviewed'
    && record.source_store === 'offline_leases'
    && isRecord(record.original_payload)
    && record.original_payload.store_id === scope.storeId
    && record.original_payload.terminal_id === scope.terminalId);
  const unresolvedLegacyQueues = recovery.some((record) => record.recovery_state === 'unreviewed'
    && (record.source_store === 'sales_queue' || record.source_store === 'generic_mutations'));

  if (sales.length > 0 || mutations.length > 0 || unresolvedLeaseEvidence || unresolvedLegacyQueues
    || laneOperations.some((operation) => operation.state !== 'synchronized'
      || !metadata || operation.terminal_sequence > metadata.last_acknowledged_sequence
      || laneAcks.get(operation.operation_id)?.payload_hash !== operation.payload_hash)) {
    throw new Error('Resolve or acknowledge this terminal’s existing offline work before issuing another lease.');
  }
}

export function buildIssueOfflineLeaseCommand(input: {
  operationId: string;
  storeId: string;
  terminalId: string;
  shiftId: string;
  occurredAtLocal?: string | null;
}): OperationCommandV1 {
  return createOperationCommand({
    operation_id: input.operationId,
    store_id: input.storeId,
    terminal_id: input.terminalId,
    shift_id: input.shiftId,
    occurred_at_local: input.occurredAtLocal ?? null,
    terminal_sequence: null,
    expected_version: null,
    payload: {},
  });
}

export function buildRevokeOfflineLeaseCommand(input: {
  operationId: string;
  lease: OfflineLeaseSnapshot;
  reason: string;
  occurredAtLocal?: string | null;
}): OperationCommandV1 {
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > 500) {
    throw new TypeError('A revocation reason of 1 to 500 characters is required.');
  }
  return createOperationCommand({
    operation_id: input.operationId,
    store_id: input.lease.store_id,
    terminal_id: input.lease.terminal_id,
    shift_id: input.lease.shift_id,
    occurred_at_local: input.occurredAtLocal ?? null,
    terminal_sequence: null,
    expected_version: input.lease.version,
    payload: { lease_id: input.lease.id, reason },
  });
}

export function parseOfflineLeaseSnapshot(value: unknown): OfflineLeaseSnapshot {
  if (!isRecord(value)) throw new TypeError('Server offline lease must be an object.');
  const state = value.state;
  if (state !== 'pending_stock' && state !== 'active' && state !== 'revoked'
    && state !== 'expired' && state !== 'reconciled') {
    throw new TypeError('Server offline lease state is invalid.');
  }
  const lease: OfflineLeaseSnapshot = {
    id: requireUuid(value.id, 'Lease ID'),
    store_id: requireUuid(value.store_id, 'Store ID'),
    terminal_id: requireUuid(value.terminal_id, 'Terminal ID'),
    shift_id: requireUuid(value.shift_id, 'Shift ID'),
    cashier_id: requireUuid(value.cashier_id, 'Cashier ID'),
    prepared_at: requireTimestamp(value.prepared_at, 'Prepared time'),
    issued_at: requireTimestamp(value.issued_at, 'Issue time'),
    expires_at: requireTimestamp(value.expires_at, 'Expiry time'),
    last_mfa_at: value.last_mfa_at === null ? null : requireTimestamp(value.last_mfa_at, 'MFA time'),
    activated_at: value.activated_at === null ? null : requireTimestamp(value.activated_at, 'Activation time'),
    state,
    catalog_version: nullableString(value.catalog_version, 'Catalog version'),
    price_policy_hash: nullableString(value.price_policy_hash, 'Price policy hash'),
    sequence_start: requireInteger(value.sequence_start, 'Sequence start', 1),
    sequence_end: requireInteger(value.sequence_end, 'Sequence end', 1),
    contract_version: requireInteger(value.contract_version, 'Contract version', 1),
    version: requireInteger(value.version, 'Lease version', 1),
  };
  if (lease.sequence_end < lease.sequence_start
    || lease.sequence_end - lease.sequence_start + 1 > MAX_LEASE_OPERATIONS) {
    throw new TypeError('Server offline lease exceeds its operation limit.');
  }
  if ((lease.catalog_version === null) !== (lease.price_policy_hash === null)
    || (lease.price_policy_hash !== null && !/^[0-9a-f]{64}$/.test(lease.price_policy_hash))) {
    throw new TypeError('Offline lease snapshot metadata is inconsistent.');
  }
  if (lease.contract_version !== 1
    || Date.parse(lease.prepared_at) > Date.parse(lease.issued_at)
    || Date.parse(lease.expires_at) <= Date.parse(lease.issued_at)) {
    throw new TypeError('Server offline lease times or contract version are invalid.');
  }
  if ((lease.state === 'pending_stock' && lease.activated_at !== null)
    || (lease.state === 'active' && lease.activated_at === null)
    || (lease.activated_at !== null
      && (Date.parse(lease.activated_at) < Date.parse(lease.issued_at)
        || Date.parse(lease.activated_at) > Date.parse(lease.expires_at)))) {
    throw new TypeError('Server offline lease activation state is inconsistent.');
  }
  return lease;
}

export async function issueOfflineLease(input: {
  command: OperationCommandV1;
  scope: OfflineLeaseScope;
  database: IDBPDatabase<OfflineDatabase>;
  keySession: OfflineKeySession;
}): Promise<ConfirmedOperationResult<OfflineLeaseSnapshot>> {
  assertIssueCommandScope(input.command, input.scope);
  await assertOfflineLeaseQueueDrained(input.database, input.scope);
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('issue_offline_lease', { p_command: input.command });
  if (error) throw error;
  const result = parseConfirmedOperationResult<unknown>(data);
  if (result.operation_id !== input.command.operation_id
    || result.aggregate_type !== 'offline_authorization_lease'
    || result.aggregate_version < 1) {
    throw new Error('Server confirmation does not match the offline lease request.');
  }
  const lease = parseOfflineLeaseSnapshot(result.result);
  if (lease.state !== 'pending_stock' || lease.store_id !== input.scope.storeId
    || lease.terminal_id !== input.scope.terminalId || lease.shift_id !== input.command.shift_id
    || lease.cashier_id !== input.scope.actorId || result.aggregate_id !== lease.id
    || result.aggregate_version !== lease.version) {
    throw new Error('Server returned an offline lease with a different identity or unsafe state.');
  }
  const duration = Date.parse(lease.expires_at) - Date.parse(lease.issued_at);
  if (duration <= 0 || duration > MAX_LEASE_DURATION_MS) {
    throw new Error('Server returned an offline lease outside the approved time limit.');
  }
  await persistOfflineLeaseSnapshot({
    database: input.database,
    keySession: input.keySession,
    scope: input.scope,
    snapshot: lease,
  });
  return { ...result, result: lease };
}

export async function getOfflineLease(storeId: string, leaseId: string): Promise<OfflineLeaseSnapshot> {
  if (!UUID_PATTERN.test(storeId) || !UUID_PATTERN.test(leaseId)) {
    throw new TypeError('Store and lease IDs must be UUIDs.');
  }
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('get_offline_lease', {
    p_store_id: storeId.toLowerCase(),
    p_lease_id: leaseId.toLowerCase(),
  });
  if (error) throw error;
  const lease = parseOfflineLeaseSnapshot(data);
  if (lease.store_id !== storeId.toLowerCase() || lease.id !== leaseId.toLowerCase()) {
    throw new Error('Server returned an offline lease from a different store.');
  }
  return lease;
}

export async function revokeOfflineLease(input: {
  command: OperationCommandV1;
  lease: OfflineLeaseSnapshot;
  scope: OfflineLeaseScope;
  database: IDBPDatabase<OfflineDatabase>;
  keySession: OfflineKeySession;
}): Promise<ConfirmedOperationResult<OfflineLeaseSnapshot>> {
  if (input.command.store_id !== input.lease.store_id
    || input.command.terminal_id !== input.lease.terminal_id
    || input.command.shift_id !== input.lease.shift_id
    || input.command.expected_version !== input.lease.version) {
    throw new Error('Revocation command does not match the current offline lease version.');
  }
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('revoke_offline_lease', { p_command: input.command });
  if (error) throw error;
  const result = parseConfirmedOperationResult<unknown>(data);
  if (result.operation_id !== input.command.operation_id
    || result.aggregate_type !== 'offline_authorization_lease'
    || result.aggregate_version < 1) {
    throw new Error('Server confirmation does not match the offline lease revocation.');
  }
  const lease = parseOfflineLeaseSnapshot(result.result);
  if (lease.id !== input.lease.id || lease.version !== input.lease.version + 1
    || result.aggregate_id !== lease.id || result.aggregate_version !== lease.version
    || (lease.state !== 'revoked' && lease.state !== 'expired')) {
    throw new Error('Server returned an invalid offline lease revocation result.');
  }
  // Admins may revoke another cashier's lease. Never copy that authority into the admin's device scope.
  if (lease.cashier_id === input.scope.actorId) {
    await persistOfflineLeaseSnapshot({
      database: input.database,
      keySession: input.keySession,
      scope: input.scope,
      snapshot: lease,
    });
  }
  return { ...result, result: lease };
}

function assertIssueCommandScope(command: OperationCommandV1, scope: OfflineLeaseScope): void {
  if (command.store_id !== scope.storeId || command.terminal_id !== scope.terminalId
    || command.shift_id === null || command.terminal_sequence !== null
    || command.expected_version !== null || Object.keys(command.payload).length !== 0) {
    throw new Error('Offline lease command does not match the signed-in cashier and terminal scope.');
  }
}

function requireUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new TypeError(`${label} is invalid.`);
  return value.toLowerCase();
}

function requireTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)
    || !Number.isFinite(Date.parse(value))) throw new TypeError(`${label} is invalid.`);
  return value;
}

function requireInteger(value: unknown, label: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is invalid.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
