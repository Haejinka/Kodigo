import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase, IDBPTransaction, StoreNames } from 'idb';
import type { Product, Sale } from '@/types';
import type { OperationCommandV1, OfflineQueueState } from '@/types/operations';
import type {
  EncryptedOfflineLeaseRecord,
  LegacyRecoveryRecord,
  OfflineGrantEvent,
  OfflineLeaseSnapshot,
  OfflineOperationAck,
  OfflineOperationPayload,
  OfflineRecoveryBundleV1,
  OfflineRecoveryExportEnvelope,
  OfflineQueuedOperation,
  OfflineStockGrant,
  OfflineTerminalMetadata,
  OfflineCatalogSnapshot,
} from '@/types/offline';
import {
  decryptOfflinePayload,
  encryptOfflinePayload,
  encryptOfflineRecoveryBundle,
  OfflineKeySession,
} from './offline-crypto.ts';
import { hashCanonicalOperationValue, hashOperationCommand } from './pos-operations.ts';

export interface OfflineDatabase extends DBSchema {
  products_cache: { key: string; value: Product };
  sales_queue: {
    key: string;
    value: Sale & { _syncStatus: 'pending' | 'error'; _syncError?: string };
    indexes: { 'by-status': string };
  };
  generic_mutations: {
    key: string;
    value: {
      id: string;
      table: string;
      operation: 'INSERT' | 'UPDATE' | 'DELETE';
      payload: unknown;
      matchKey?: string;
      matchValue?: unknown;
      _syncStatus: 'pending' | 'error';
      _syncError?: string;
    };
    indexes: { 'by-status': string };
  };
  terminal_meta: {
    key: string;
    value: OfflineTerminalMetadata;
    indexes: { 'by-scope': IDBValidKey };
  };
  catalog_snapshots: {
    key: string;
    value: OfflineCatalogSnapshot;
    indexes: { 'by-store-product-version': IDBValidKey };
  };
  offline_leases: {
    key: string;
    value: EncryptedOfflineLeaseRecord;
    indexes: { 'by-store-terminal': IDBValidKey; 'by-cashier': string };
  };
  stock_grants: {
    key: string;
    value: OfflineStockGrant;
    indexes: { 'by-lease': string; 'by-product': IDBValidKey; 'by-lot': string };
  };
  offline_grant_events: {
    key: string;
    value: OfflineGrantEvent;
    indexes: { 'by-operation-grant': IDBValidKey; 'by-grant': string };
  };
  operations_outbox: {
    key: string;
    value: OfflineQueuedOperation;
    indexes: { 'by-state': OfflineQueueState; 'by-lane-sequence': IDBValidKey };
  };
  operation_acks: {
    key: string;
    value: OfflineOperationAck;
    indexes: { 'by-lane-sequence': IDBValidKey };
  };
  legacy_recovery: {
    key: string;
    value: LegacyRecoveryRecord;
    indexes: { 'by-source': string };
  };
}

export const OFFLINE_DATABASE_NAME = 'kodigo-pos-db';
export const OFFLINE_DATABASE_VERSION = 3;

export class OfflineStorageError extends Error {
  readonly code: 'UNAVAILABLE' | 'QUOTA' | 'BLOCKED' | 'CORRUPT';

  constructor(message: string, code: 'UNAVAILABLE' | 'QUOTA' | 'BLOCKED' | 'CORRUPT' = 'UNAVAILABLE') {
    super(message);
    this.name = 'OfflineStorageError';
    this.code = code;
  }
}

export function openOfflineDatabase(options: {
  name?: string;
  onBlocked?: (currentVersion: number, requestedVersion: number | null) => void;
} = {}): Promise<IDBPDatabase<OfflineDatabase>> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new OfflineStorageError('This browser does not provide IndexedDB; the sale was not saved.', 'UNAVAILABLE'));
  }

  let connection: IDBPDatabase<OfflineDatabase> | null = null;
  const opening = openDB<OfflineDatabase>(options.name ?? OFFLINE_DATABASE_NAME, OFFLINE_DATABASE_VERSION, {
    upgrade(database, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) createLegacyStores(database);
      if (oldVersion < 2) {
        createOfflineStores(database);
        if (oldVersion >= 1) {
          preserveLegacyStore(transaction, 'sales_queue');
          preserveLegacyStore(transaction, 'generic_mutations');
        }
      }
      if (oldVersion < 3) {
        createOfflineStores(database);
        preserveLegacyOfflineLeases(transaction);
      }
    },
    blocked(currentVersion, requestedVersion) {
      options.onBlocked?.(currentVersion, requestedVersion);
      if (!options.onBlocked && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('kodigo:offline-db-upgrade-blocked', {
          detail: { currentVersion, requestedVersion },
        }));
      }
    },
    blocking() {
      connection?.close();
    },
  });
  return opening.then((database) => {
    connection = database;
    return database;
  }).catch((error: unknown) => {
    if (error instanceof OfflineStorageError) throw error;
    throw normalizeOfflineStorageError(error);
  });
}

export interface EnqueueOfflineOperationInput {
  database: IDBPDatabase<OfflineDatabase>;
  keySession: OfflineKeySession;
  scope: { storeId: string; actorId: string; terminalId: string };
  command: OperationCommandV1;
  operationKind: string;
  leaseId: string;
  grantConsumptions: Array<{ grantId: string; quantity: number }>;
  now?: Date;
}

export interface EnqueueOfflineOperationResult {
  operation: OfflineQueuedOperation;
  inserted: boolean;
}

/** Read and authenticate the encrypted lease snapshot for this cashier/device scope. */
export async function readOfflineLeaseSnapshot(input: {
  database: IDBPDatabase<OfflineDatabase>;
  keySession: OfflineKeySession;
  scope: { storeId: string; actorId: string; terminalId: string };
  leaseId: string;
}): Promise<OfflineLeaseSnapshot | null> {
  const record = await input.database.get('offline_leases', input.leaseId);
  if (!record) return null;
  if (record.store_id !== input.scope.storeId || record.terminal_id !== input.scope.terminalId
    || record.cashier_id !== input.scope.actorId) {
    throw new Error('Offline lease belongs to another account, store, or terminal.');
  }
  const snapshot = await decryptOfflinePayload<OfflineLeaseSnapshot>(record.encrypted_snapshot,
    input.keySession.getKey(), {
      recordId: record.id,
      storeId: input.scope.storeId,
      actorId: input.scope.actorId,
      terminalId: input.scope.terminalId,
    });
  if (snapshot.id !== record.id || snapshot.store_id !== record.store_id
    || snapshot.terminal_id !== record.terminal_id || snapshot.cashier_id !== record.cashier_id) {
    throw new Error('Encrypted offline lease does not match its clear account scope.');
  }
  return snapshot;
}

/** Persist a server-issued lease with all authority fields encrypted at rest. */
export async function persistOfflineLeaseSnapshot(input: {
  database: IDBPDatabase<OfflineDatabase>;
  keySession: OfflineKeySession;
  scope: { storeId: string; actorId: string; terminalId: string };
  snapshot: OfflineLeaseSnapshot;
}): Promise<void> {
  const { snapshot, scope } = input;
  if (snapshot.store_id !== scope.storeId || snapshot.cashier_id !== scope.actorId
    || snapshot.terminal_id !== scope.terminalId) {
    throw new Error('Offline lease scope does not match this cashier and terminal.');
  }
  const key = input.keySession.getKey();
  const encryptedSnapshot = await encryptOfflinePayload(snapshot, key, {
    recordId: snapshot.id,
    storeId: scope.storeId,
    actorId: scope.actorId,
    terminalId: scope.terminalId,
  });
  const nextRecord: EncryptedOfflineLeaseRecord = {
    id: snapshot.id,
    store_id: snapshot.store_id,
    terminal_id: snapshot.terminal_id,
    cashier_id: snapshot.cashier_id,
    encrypted_snapshot: encryptedSnapshot,
  };
  const priorRecord = await input.database.get('offline_leases', snapshot.id);
  if (priorRecord) {
    const prior = await readOfflineLeaseSnapshot({ ...input, leaseId: snapshot.id });
    if (!prior) throw new Error('Offline lease changed while it was being read.');
    if (snapshot.version < prior.version) throw new Error('A stale offline lease cannot replace a newer snapshot.');
    if (snapshot.version === prior.version && canonicalOperationJson(snapshot) !== canonicalOperationJson(prior)) {
      throw new Error('An offline lease version cannot be reused for different authorization data.');
    }
  }

  const tx = input.database.transaction('offline_leases', 'readwrite', { durability: 'strict' });
  try {
    const current = await tx.store.get(snapshot.id);
    if (canonicalOperationJson(current ?? null) !== canonicalOperationJson(priorRecord ?? null)) {
      throw new Error('Offline lease changed in another tab; refresh before saving it.');
    }
    await tx.store.put(nextRecord);
    await tx.done;
  } catch (error) {
    abortTransaction(tx);
    throw normalizeOfflineStorageError(error);
  }
}

export type OfflineOperationFailureState = Extract<OfflineQueueState, 'retry_wait' | 'conflicted' | 'blocked_auth' | 'needs_recovery'>;

/** Stores ciphertext, consumes local grants, and advances one terminal sequence atomically. */
export async function enqueueOfflineOperation(input: EnqueueOfflineOperationInput): Promise<EnqueueOfflineOperationResult> {
  const { database, keySession, scope, command, operationKind, leaseId } = input;
  const now = input.now ?? new Date();
  const sequence = command.terminal_sequence;
  if (!operationKind.trim()) throw new TypeError('Operation kind is required.');
  if (sequence === null || !Number.isInteger(sequence) || sequence < 0) throw new TypeError('Offline operation requires a non-negative terminal sequence.');
  if (!command.shift_id) throw new TypeError('Offline operation requires an open shift.');
  if (command.store_id !== scope.storeId || command.terminal_id !== scope.terminalId) {
    throw new Error('Offline command scope does not match the signed-in store and terminal.');
  }
  const grantConsumptions = normalizeGrantConsumptions(input.grantConsumptions);
  const hash = await hashOperationCommand(command);
  const existingBeforeTransaction = await database.get('operations_outbox', command.operation_id);
  if (existingBeforeTransaction) {
    assertExistingOfflineOperationMatches(existingBeforeTransaction, {
      hash, operationKind, scope, leaseId, shiftId: command.shift_id,
    });
    return { operation: existingBeforeTransaction, inserted: false };
  }
  const key = keySession.getKey();
  const leaseRecord = await database.get('offline_leases', leaseId);
  if (!leaseRecord) throw new Error('Offline authorization data is missing; nothing was saved.');
  const lease = await readOfflineLeaseSnapshot({ database, keySession, scope, leaseId });
  if (!lease) throw new Error('Offline authorization data is missing; nothing was saved.');
  const payloadScope = { recordId: command.operation_id, ...scope };
  // Encrypt before opening the transaction so no crypto wait can close it.
  const sealed = await encryptOfflinePayload({
    command,
    grant_consumptions: grantConsumptions.map(({ grantId, quantity }) => ({ grant_id: grantId, quantity })),
  }, key, payloadScope);
  const tx = database.transaction(
    ['terminal_meta', 'offline_leases', 'stock_grants', 'offline_grant_events', 'operations_outbox'],
    'readwrite',
    { durability: 'strict' },
  );
  try {
    const outbox = tx.objectStore('operations_outbox');
    const existing = await outbox.get(command.operation_id);
    if (existing) {
      assertExistingOfflineOperationMatches(existing, {
        hash, operationKind, scope, leaseId, shiftId: command.shift_id,
      });
      await tx.done;
      return { operation: existing, inserted: false };
    }

    const scopeKey = offlineScopeKey(scope);
    const metaStore = tx.objectStore('terminal_meta');
    const metadata = await metaStore.get(scopeKey);
    const currentLeaseRecord = await tx.objectStore('offline_leases').get(leaseId);
    if (!metadata || !currentLeaseRecord) throw new Error('Offline authorization data is missing; nothing was saved.');
    if (canonicalOperationJson(currentLeaseRecord) !== canonicalOperationJson(leaseRecord)) {
      throw new Error('Offline authorization changed in another tab; nothing was saved.');
    }
    if (lease.id !== metadata.lease_id || lease.id !== leaseId || lease.store_id !== scope.storeId
      || lease.terminal_id !== scope.terminalId || lease.cashier_id !== scope.actorId
      || lease.shift_id !== command.shift_id || lease.state !== 'active'
      || !Number.isFinite(Date.parse(lease.expires_at)) || Date.parse(lease.expires_at) <= now.getTime()) {
      throw new Error('Offline authorization is expired or does not match this cashier, shift, or terminal.');
    }
    if (metadata.store_id !== scope.storeId || metadata.actor_id !== scope.actorId
      || metadata.terminal_id !== scope.terminalId || metadata.lease_id !== leaseId
      || metadata.next_sequence !== sequence || sequence < lease.sequence_start || sequence > lease.sequence_end) {
      throw new Error('Offline sequence is stale, exhausted, or belongs to another terminal.');
    }

    const grantStore = tx.objectStore('stock_grants');
    const eventStore = tx.objectStore('offline_grant_events');
    for (const grantConsumption of grantConsumptions) {
      const grant = await grantStore.get(grantConsumption.grantId);
      if (!grant || grant.store_id !== scope.storeId || grant.lease_id !== leaseId
        || grant.terminal_id !== scope.terminalId || grant.state !== 'active'
        || grant.quantity_consumed + grant.quantity_released + grantConsumption.quantity > grant.quantity_allocated) {
        throw new Error('Offline stock authorization is missing or exhausted; nothing was saved.');
      }
      const consumed = grant.quantity_consumed + grantConsumption.quantity;
      const updatedGrant: OfflineStockGrant = {
        ...grant,
        quantity_consumed: consumed,
        state: consumed + grant.quantity_released >= grant.quantity_allocated ? 'exhausted' : 'active',
      };
      await grantStore.put(updatedGrant);
      await eventStore.add({
        id: `${command.operation_id}:${grant.id}`,
        grant_id: grant.id,
        operation_id: command.operation_id,
        kind: 'consume',
        quantity: grantConsumption.quantity,
        created_at_local: now.toISOString(),
      });
    }

    const operation: OfflineQueuedOperation = {
      operation_id: command.operation_id,
      operation_kind: operationKind,
      store_id: scope.storeId,
      actor_id: scope.actorId,
      terminal_id: scope.terminalId,
      terminal_sequence: sequence,
      payload_hash: hash,
      encrypted_payload: sealed,
      state: 'local_pending',
      attempt_count: 0,
      next_attempt_at: null,
      last_error_code: null,
      acknowledgement_id: null,
      lease_id: leaseId,
      shift_id: command.shift_id,
      created_at_local: now.toISOString(),
      updated_at_local: now.toISOString(),
    };
    await outbox.add(operation);
    await metaStore.put({
      ...metadata,
      next_sequence: sequence + 1,
      updated_at_local: now.toISOString(),
    });
    await tx.done;
    return { operation, inserted: true };
  } catch (error) {
    abortTransaction(tx);
    throw normalizeOfflineStorageError(error);
  }
}

function assertExistingOfflineOperationMatches(
  existing: OfflineQueuedOperation,
  expected: {
    hash: string;
    operationKind: string;
    scope: { storeId: string; actorId: string; terminalId: string };
    leaseId: string;
    shiftId: string;
  },
): void {
  if (existing.payload_hash !== expected.hash || existing.operation_kind !== expected.operationKind
    || existing.store_id !== expected.scope.storeId || existing.actor_id !== expected.scope.actorId
    || existing.terminal_id !== expected.scope.terminalId || existing.lease_id !== expected.leaseId
    || existing.shift_id !== expected.shiftId) {
    throw new Error('Operation ID was already used for a different offline request.');
  }
}

/** Claim one queued command for transport and durably count the attempt before sending it. */
export async function beginOfflineOperationAttempt(input: {
  database: IDBPDatabase<OfflineDatabase>;
  scope: { storeId: string; actorId: string; terminalId: string };
  operationId: string;
  now?: Date;
}): Promise<OfflineQueuedOperation> {
  const now = input.now ?? new Date();
  const tx = input.database.transaction('operations_outbox', 'readwrite', { durability: 'strict' });
  try {
    const store = tx.objectStore('operations_outbox');
    const operation = await store.get(input.operationId);
    if (!operation || operation.store_id !== input.scope.storeId || operation.actor_id !== input.scope.actorId
      || operation.terminal_id !== input.scope.terminalId) {
      throw new Error('Queued operation is missing or belongs to another account scope.');
    }
    if (operation.state !== 'local_pending' && operation.state !== 'retry_wait') {
      throw new Error(`Queued operation cannot start another attempt from ${operation.state}.`);
    }
    if (!Number.isSafeInteger(operation.attempt_count) || operation.attempt_count < 0
      || operation.attempt_count >= Number.MAX_SAFE_INTEGER) {
      throw new Error('Queued operation attempt counter is invalid or exhausted.');
    }
    if (operation.state === 'retry_wait'
      && (!operation.next_attempt_at || !Number.isFinite(Date.parse(operation.next_attempt_at)))) {
      throw new Error('Queued retry has no valid next-attempt time.');
    }
    if (operation.state === 'retry_wait' && Date.parse(operation.next_attempt_at!) > now.getTime()) {
      throw new Error('Queued operation retry is not due yet.');
    }
    const updated: OfflineQueuedOperation = {
      ...operation,
      state: 'syncing',
      attempt_count: operation.attempt_count + 1,
      next_attempt_at: null,
      last_error_code: null,
      updated_at_local: now.toISOString(),
    };
    await store.put(updated);
    await tx.done;
    return updated;
  } catch (error) {
    abortTransaction(tx);
    throw normalizeOfflineStorageError(error);
  }
}

/** Record a bounded transport/validation/auth/recovery outcome without storing server error text or PII. */
export async function recordOfflineOperationFailure(input: {
  database: IDBPDatabase<OfflineDatabase>;
  scope: { storeId: string; actorId: string; terminalId: string };
  operationId: string;
  state: OfflineOperationFailureState;
  errorCode: string;
  nextAttemptAt?: string | null;
  now?: Date;
}): Promise<OfflineQueuedOperation> {
  const now = input.now ?? new Date();
  const errorCode = input.errorCode.trim();
  const containsControlCharacter = Array.from(errorCode).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (!errorCode || errorCode.length > 80 || containsControlCharacter) {
    throw new TypeError('Offline operation error code must be a short, non-sensitive code.');
  }
  let nextAttemptAt: string | null = null;
  if (input.state === 'retry_wait') {
    if (!input.nextAttemptAt || !Number.isFinite(Date.parse(input.nextAttemptAt))) {
      throw new TypeError('A retry time is required for a retry_wait operation.');
    }
    nextAttemptAt = new Date(input.nextAttemptAt).toISOString();
  } else if (input.nextAttemptAt != null) {
    throw new TypeError('Only retry_wait operations may have a next-attempt time.');
  }

  const tx = input.database.transaction('operations_outbox', 'readwrite', { durability: 'strict' });
  try {
    const store = tx.objectStore('operations_outbox');
    const operation = await store.get(input.operationId);
    if (!operation || operation.store_id !== input.scope.storeId || operation.actor_id !== input.scope.actorId
      || operation.terminal_id !== input.scope.terminalId) {
      throw new Error('Queued operation is missing or belongs to another account scope.');
    }
    if (operation.state !== 'syncing') {
      throw new Error(`Queued operation cannot record a failure from ${operation.state}.`);
    }
    const updated: OfflineQueuedOperation = {
      ...operation,
      state: input.state,
      next_attempt_at: nextAttemptAt,
      last_error_code: errorCode,
      updated_at_local: now.toISOString(),
    };
    await store.put(updated);
    await tx.done;
    return updated;
  } catch (error) {
    abortTransaction(tx);
    throw normalizeOfflineStorageError(error);
  }
}

export async function decryptQueuedOperation(
  operation: OfflineQueuedOperation,
  keySession: OfflineKeySession,
): Promise<OfflineOperationPayload> {
  return decryptOfflinePayload<OfflineOperationPayload>(operation.encrypted_payload, keySession.getKey(), {
    recordId: operation.operation_id,
    storeId: operation.store_id,
    actorId: operation.actor_id,
    terminalId: operation.terminal_id,
  });
}

/** Persist the acknowledgement before a synchronization coordinator advances its lane. */
export async function persistOperationAcknowledgement(input: {
  database: IDBPDatabase<OfflineDatabase>;
  keySession: OfflineKeySession;
  scope: { storeId: string; actorId: string; terminalId: string };
  operationId: string;
  payloadHash: string;
  result: unknown;
  acknowledgedAtServer: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  if (!Number.isFinite(Date.parse(input.acknowledgedAtServer))) throw new TypeError('Server acknowledgement time is invalid.');
  if (!input.result || typeof input.result !== 'object'
    || !('operation_id' in input.result) || input.result.operation_id !== input.operationId
    || !('outcome' in input.result) || (input.result.outcome !== 'confirmed' && input.result.outcome !== 'pending_external')) {
    throw new Error('Server acknowledgement must include the matching operation ID and a server-confirmed outcome.');
  }
  const key = input.keySession.getKey();
  const encryptedResult = await encryptOfflinePayload(input.result, key, {
    recordId: `ack:${input.operationId}`,
    ...input.scope,
  });
  const resultHash = await hashCanonicalOperationValue(input.result);
  const tx = input.database.transaction(
    ['operations_outbox', 'operation_acks', 'terminal_meta'],
    'readwrite',
    { durability: 'strict' },
  );
  try {
    const outbox = tx.objectStore('operations_outbox');
    const operation = await outbox.get(input.operationId);
    if (!operation || operation.payload_hash !== input.payloadHash
      || operation.store_id !== input.scope.storeId || operation.actor_id !== input.scope.actorId
      || operation.terminal_id !== input.scope.terminalId) {
      throw new Error('Server acknowledgement does not match a queued operation in this account scope.');
    }
    const ackStore = tx.objectStore('operation_acks');
    const existingAck = await ackStore.get(input.operationId);
    if (existingAck) {
      if (existingAck.payload_hash !== input.payloadHash || existingAck.result_hash !== resultHash) {
        throw new Error('Stored acknowledgement conflicts with the queued operation.');
      }
      await tx.done;
      return;
    }
    const acknowledgement: OfflineOperationAck = {
      operation_id: input.operationId,
      store_id: input.scope.storeId,
      actor_id: input.scope.actorId,
      terminal_id: input.scope.terminalId,
      terminal_sequence: operation.terminal_sequence,
      payload_hash: input.payloadHash,
      result_hash: resultHash,
      encrypted_result: encryptedResult,
      acknowledged_at_server: input.acknowledgedAtServer,
      stored_at_local: now.toISOString(),
    };
    await ackStore.add(acknowledgement);
    await outbox.put({ ...operation, state: 'synchronized', acknowledgement_id: input.operationId, updated_at_local: now.toISOString() });

    const metaStore = tx.objectStore('terminal_meta');
    const metadata = await metaStore.get(offlineScopeKey(input.scope));
    if (!metadata || metadata.store_id !== input.scope.storeId || metadata.actor_id !== input.scope.actorId
      || metadata.terminal_id !== input.scope.terminalId) {
      throw new Error('Terminal metadata is missing or belongs to another account scope.');
    }
    let lastAcknowledged = metadata.last_acknowledged_sequence;
    let nextSequence = lastAcknowledged + 1;
    while (true) {
      const nextOperation = await outbox.index('by-lane-sequence').get([
        input.scope.storeId, input.scope.terminalId, nextSequence,
      ]);
      if (!nextOperation || nextOperation.state !== 'synchronized'
        || !(await ackStore.get(nextOperation.operation_id))) break;
      lastAcknowledged = nextSequence;
      nextSequence += 1;
    }
    await metaStore.put({ ...metadata, last_acknowledged_sequence: lastAcknowledged, updated_at_local: now.toISOString() });
    await tx.done;
  } catch (error) {
    abortTransaction(tx);
    throw normalizeOfflineStorageError(error);
  }
}

export async function readOperationAcknowledgement(
  database: IDBPDatabase<OfflineDatabase>,
  keySession: OfflineKeySession,
  scope: { storeId: string; actorId: string; terminalId: string },
  operationId: string,
): Promise<unknown | null> {
  const ack = await database.get('operation_acks', operationId);
  if (!ack) return null;
  if (ack.store_id !== scope.storeId || ack.actor_id !== scope.actorId || ack.terminal_id !== scope.terminalId) {
    throw new Error('Acknowledgement belongs to another account scope.');
  }
  return decryptOfflinePayload(ack.encrypted_result, keySession.getKey(), {
    recordId: `ack:${operationId}`,
    ...scope,
  });
}

export function offlineScopeKey(scope: { storeId: string; actorId: string; terminalId: string }): string {
  return `${scope.storeId}:${scope.actorId}:${scope.terminalId}`;
}

/** Take a consistent scope snapshot and encrypt all included recovery evidence before returning it. */
export async function createOfflineRecoveryExport(input: {
  database: IDBPDatabase<OfflineDatabase>;
  keySession: OfflineKeySession;
  scope: { storeId: string; actorId: string; terminalId: string };
  passphrase: string;
  now?: Date;
}): Promise<OfflineRecoveryExportEnvelope> {
  const stores = [
    'terminal_meta', 'catalog_snapshots', 'offline_leases', 'stock_grants', 'offline_grant_events',
    'operations_outbox', 'operation_acks', 'legacy_recovery', 'sales_queue', 'generic_mutations',
  ] as const;
  const tx = input.database.transaction(stores, 'readonly');
  const metaRequest = tx.objectStore('terminal_meta').get(offlineScopeKey(input.scope));
  const catalogRequest = tx.objectStore('catalog_snapshots').getAll();
  const leaseRequest = tx.objectStore('offline_leases').getAll();
  const grantRequest = tx.objectStore('stock_grants').getAll();
  const eventRequest = tx.objectStore('offline_grant_events').getAll();
  const operationRequest = tx.objectStore('operations_outbox').getAll();
  const ackRequest = tx.objectStore('operation_acks').getAll();
  const recoveryRequest = tx.objectStore('legacy_recovery').getAll();
  const legacySalesRequest = tx.objectStore('sales_queue').getAll();
  const legacyMutationsRequest = tx.objectStore('generic_mutations').getAll();
  const [terminalMeta, catalogs, leaseRecords, grants, events, operations, acknowledgements, recovery, sales, mutations] = await Promise.all([
    metaRequest, catalogRequest, leaseRequest, grantRequest, eventRequest,
    operationRequest, ackRequest, recoveryRequest, legacySalesRequest, legacyMutationsRequest,
  ]);
  await tx.done;

  const scopedLeaseRecords = leaseRecords.filter((lease) => lease.store_id === input.scope.storeId
    && lease.terminal_id === input.scope.terminalId && lease.cashier_id === input.scope.actorId);
  const scopedLeases = await Promise.all(scopedLeaseRecords.map(async (record) => {
    const lease = await decryptOfflinePayload<OfflineLeaseSnapshot>(record.encrypted_snapshot,
      input.keySession.getKey(), {
        recordId: record.id,
        storeId: input.scope.storeId,
        actorId: input.scope.actorId,
        terminalId: input.scope.terminalId,
      });
    if (lease.id !== record.id || lease.store_id !== record.store_id
      || lease.terminal_id !== record.terminal_id || lease.cashier_id !== record.cashier_id) {
      throw new Error('Encrypted offline lease does not match its recovery scope.');
    }
    return lease;
  }));
  const leaseIds = new Set(scopedLeases.map((lease) => lease.id));
  const scopedGrants = grants.filter((grant) => grant.store_id === input.scope.storeId
    && grant.terminal_id === input.scope.terminalId && leaseIds.has(grant.lease_id));
  const grantIds = new Set(scopedGrants.map((grant) => grant.id));
  const scopedOperations = operations.filter((operation) => operation.store_id === input.scope.storeId
    && operation.actor_id === input.scope.actorId && operation.terminal_id === input.scope.terminalId);
  const operationIds = new Set(scopedOperations.map((operation) => operation.operation_id));
  const scopedAcks = acknowledgements.filter((ack) => ack.store_id === input.scope.storeId
    && ack.actor_id === input.scope.actorId && ack.terminal_id === input.scope.terminalId);
  const scopedRecovery = recovery.filter((record) => record.source_store !== 'offline_leases'
    || legacyOfflineLeaseMatchesScope(record.original_payload, input.scope));
  const bundle: OfflineRecoveryBundleV1 = {
    format: 'kodigo-offline-recovery-bundle',
    version: 1,
    schema_version: 2,
    exported_at_local: (input.now ?? new Date()).toISOString(),
    scope: {
      store_id: input.scope.storeId,
      actor_id: input.scope.actorId,
      terminal_id: input.scope.terminalId,
    },
    terminal_meta: terminalMeta ?? null,
    catalog_snapshots: catalogs.filter((snapshot) => snapshot.store_id === input.scope.storeId)
      .sort((left, right) => left.id.localeCompare(right.id)),
    offline_leases: scopedLeases.sort((left, right) => left.id.localeCompare(right.id)),
    stock_grants: scopedGrants.sort((left, right) => left.id.localeCompare(right.id)),
    offline_grant_events: events.filter((event) => grantIds.has(event.grant_id) && operationIds.has(event.operation_id))
      .sort((left, right) => left.id.localeCompare(right.id)),
    operations_outbox: scopedOperations.sort((left, right) => left.terminal_sequence - right.terminal_sequence),
    operation_acks: scopedAcks.sort((left, right) => left.terminal_sequence - right.terminal_sequence),
    // Legacy v1 queues are unscoped, so retain them only as encrypted recovery evidence.
    // Migrated v2 leases have trustworthy scope and are included only for their original cashier/device.
    legacy_recovery: scopedRecovery.sort((left, right) => left.id.localeCompare(right.id)),
    legacy_v1_sales: sales,
    legacy_v1_mutations: mutations,
  };
  const hasRecoveryData = Boolean(terminalMeta) || bundle.catalog_snapshots.length > 0
    || bundle.offline_leases.length > 0 || bundle.stock_grants.length > 0
    || bundle.operations_outbox.length > 0 || bundle.operation_acks.length > 0
    || bundle.legacy_recovery.length > 0 || sales.length > 0 || mutations.length > 0;
  if (!hasRecoveryData) throw new Error('There are no offline recovery records for this terminal to export.');
  return encryptOfflineRecoveryBundle(bundle, input.passphrase);
}

function normalizeGrantConsumptions(consumptions: Array<{ grantId: string; quantity: number }>): Array<{ grantId: string; quantity: number }> {
  const quantities = new Map<string, number>();
  for (const consumption of consumptions) {
    if (!consumption.grantId || !Number.isSafeInteger(consumption.quantity) || consumption.quantity <= 0) {
      throw new TypeError('Offline grant consumption requires a grant ID and positive integer quantity.');
    }
    const quantity = (quantities.get(consumption.grantId) ?? 0) + consumption.quantity;
    if (!Number.isSafeInteger(quantity)) throw new TypeError('Combined offline grant consumption is too large.');
    quantities.set(consumption.grantId, quantity);
  }
  return Array.from(quantities, ([grantId, quantity]) => ({ grantId, quantity }))
    .sort((left, right) => left.grantId.localeCompare(right.grantId));
}

function legacyOfflineLeaseMatchesScope(
  value: unknown,
  scope: { storeId: string; actorId: string; terminalId: string },
): boolean {
  if (!value || typeof value !== 'object') return false;
  const lease = value as Partial<OfflineLeaseSnapshot>;
  return lease.store_id === scope.storeId && lease.cashier_id === scope.actorId
    && lease.terminal_id === scope.terminalId;
}

function createLegacyStores(database: IDBPDatabase<OfflineDatabase>): void {
  if (!database.objectStoreNames.contains('products_cache')) database.createObjectStore('products_cache', { keyPath: 'id' });
  if (!database.objectStoreNames.contains('sales_queue')) {
    const store = database.createObjectStore('sales_queue', { keyPath: 'id' });
    store.createIndex('by-status', '_syncStatus');
  }
  if (!database.objectStoreNames.contains('generic_mutations')) {
    const store = database.createObjectStore('generic_mutations', { keyPath: 'id' });
    store.createIndex('by-status', '_syncStatus');
  }
}

function createOfflineStores(database: IDBPDatabase<OfflineDatabase>): void {
  if (!database.objectStoreNames.contains('terminal_meta')) {
    const store = database.createObjectStore('terminal_meta', { keyPath: 'scope_key' });
    store.createIndex('by-scope', ['store_id', 'actor_id', 'terminal_id']);
  }
  if (!database.objectStoreNames.contains('catalog_snapshots')) {
    const store = database.createObjectStore('catalog_snapshots', { keyPath: 'id' });
    store.createIndex('by-store-product-version', ['store_id', 'product_id', 'catalog_version']);
  }
  if (!database.objectStoreNames.contains('offline_leases')) {
    const store = database.createObjectStore('offline_leases', { keyPath: 'id' });
    store.createIndex('by-store-terminal', ['store_id', 'terminal_id']);
    store.createIndex('by-cashier', 'cashier_id');
  }
  if (!database.objectStoreNames.contains('stock_grants')) {
    const store = database.createObjectStore('stock_grants', { keyPath: 'id' });
    store.createIndex('by-lease', 'lease_id');
    store.createIndex('by-product', ['store_id', 'terminal_id', 'product_id']);
    store.createIndex('by-lot', 'lot_id');
  }
  if (!database.objectStoreNames.contains('offline_grant_events')) {
    const store = database.createObjectStore('offline_grant_events', { keyPath: 'id' });
    store.createIndex('by-operation-grant', ['operation_id', 'grant_id'], { unique: true });
    store.createIndex('by-grant', 'grant_id');
  }
  if (!database.objectStoreNames.contains('operations_outbox')) {
    const store = database.createObjectStore('operations_outbox', { keyPath: 'operation_id' });
    store.createIndex('by-state', 'state');
    store.createIndex('by-lane-sequence', ['store_id', 'terminal_id', 'terminal_sequence'], { unique: true });
  }
  if (!database.objectStoreNames.contains('operation_acks')) {
    const store = database.createObjectStore('operation_acks', { keyPath: 'operation_id' });
    store.createIndex('by-lane-sequence', ['store_id', 'terminal_id', 'terminal_sequence'], { unique: true });
  }
  if (!database.objectStoreNames.contains('legacy_recovery')) {
    const store = database.createObjectStore('legacy_recovery', { keyPath: 'id' });
    store.createIndex('by-source', 'source_store');
  }
}

function preserveLegacyStore(
  transaction: IDBPTransaction<OfflineDatabase, StoreNames<OfflineDatabase>[], 'versionchange'>,
  sourceName: 'sales_queue' | 'generic_mutations',
): void {
  if (!transaction.objectStoreNames.contains(sourceName)) return;
  const source = transaction.objectStore(sourceName);
  const recovery = transaction.objectStore('legacy_recovery');
  void (async () => {
    try {
      for await (const cursor of source) {
        const original = cursor.value;
        const record: LegacyRecoveryRecord = {
          id: `v1:${sourceName}:${String(cursor.key)}`,
          source_store: sourceName,
          source_key: String(cursor.key),
          original_payload: original,
          imported_at_local: new Date().toISOString(),
          recovery_state: 'unreviewed',
        };
        await recovery.add(record);
      }
    } catch {
      try {
        transaction.abort();
      } catch {
        // The version-change transaction may already have aborted.
      }
    }
  })();
}

function preserveLegacyOfflineLeases(
  transaction: IDBPTransaction<OfflineDatabase, StoreNames<OfflineDatabase>[], 'versionchange'>,
): void {
  if (!transaction.objectStoreNames.contains('offline_leases')
    || !transaction.objectStoreNames.contains('legacy_recovery')) return;
  const source = transaction.objectStore('offline_leases');
  const recovery = transaction.objectStore('legacy_recovery');
  void (async () => {
    try {
      for await (const cursor of source) {
        const original = cursor.value;
        const record: LegacyRecoveryRecord = {
          id: `v2:offline_leases:${String(cursor.key)}`,
          source_store: 'offline_leases',
          source_key: String(cursor.key),
          original_payload: original,
          imported_at_local: new Date().toISOString(),
          recovery_state: 'unreviewed',
        };
        await recovery.add(record);
        await cursor.delete();
      }
    } catch {
      try {
        transaction.abort();
      } catch {
        // The version-change transaction may already have aborted.
      }
    }
  })();
}

function abortTransaction(transaction: { abort: () => void; done: Promise<unknown> }): void {
  try {
    transaction.abort();
  } catch {
    // The transaction may already have aborted or completed after its request failed.
  }
  void transaction.done.catch(() => undefined);
}

export function normalizeOfflineStorageError(error: unknown): Error {
  const candidate = error as { name?: string; message?: string } | null;
  if (candidate?.name === 'QuotaExceededError') {
    return new OfflineStorageError('Device storage is full. The operation was not saved; keep the cart and retry after freeing storage.', 'QUOTA');
  }
  if (candidate?.name === 'ConstraintError') {
    return new OfflineStorageError('An operation or stock grant conflicts with an existing local record.', 'CORRUPT');
  }
  if (error instanceof Error && error.name === 'Error') return error;
  return new OfflineStorageError(candidate?.message || 'Device storage is unavailable. The operation was not saved.', 'UNAVAILABLE');
}
