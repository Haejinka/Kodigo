import { expect, test } from 'playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('v1 queues survive a blocked v2 upgrade as recovery evidence', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const name = `offline-v1-${crypto.randomUUID()}`;
    const legacySale = {
      id: 'legacy-sale-1',
      customerName: 'Recovery Test Only',
      total: 12.5,
      _syncStatus: 'pending',
    };
    const legacyMutation = {
      id: 'legacy-mutation-1',
      table: 'products',
      operation: 'UPDATE',
      payload: { active: false },
      matchKey: 'id',
      matchValue: 'product-1',
      _syncStatus: 'error',
      _syncError: 'test-only error',
    };
    const oldDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore('products_cache', { keyPath: 'id' });
        const sales = database.createObjectStore('sales_queue', { keyPath: 'id' });
        sales.createIndex('by-status', '_syncStatus');
        const mutations = database.createObjectStore('generic_mutations', { keyPath: 'id' });
        mutations.createIndex('by-status', '_syncStatus');
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const seed = oldDatabase.transaction(['sales_queue', 'generic_mutations'], 'readwrite');
    seed.objectStore('sales_queue').put(legacySale);
    seed.objectStore('generic_mutations').put(legacyMutation);
    await new Promise<void>((resolve, reject) => {
      seed.oncomplete = () => resolve();
      seed.onabort = () => reject(seed.error);
      seed.onerror = () => reject(seed.error);
    });

    let upgradeBlocked = false;
    let resolveUpgradeBlocked!: () => void;
    const blocked = new Promise<void>((resolve) => { resolveUpgradeBlocked = resolve; });
    const { openOfflineDatabase } = await import('/src/lib/offline-db.ts');
    const opening = openOfflineDatabase({
      name,
      onBlocked: () => {
        upgradeBlocked = true;
        resolveUpgradeBlocked();
      },
    });
    await blocked;
    oldDatabase.close();
    const database = await opening;
    const recovered = await database.getAll('legacy_recovery');
    const queuedSales = await database.getAll('sales_queue');
    const queuedMutations = await database.getAll('generic_mutations');
    const outbox = await database.getAll('operations_outbox');
    const version = database.version;
    database.close();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });

    return { upgradeBlocked, version, recovered, queuedSales, queuedMutations, outbox, legacySale, legacyMutation };
  });

  expect(result.upgradeBlocked).toBe(true);
  expect(result.version).toBe(2);
  expect(result.recovered).toEqual(expect.arrayContaining([
    expect.objectContaining({ source_store: 'sales_queue', source_key: 'legacy-sale-1', original_payload: result.legacySale, recovery_state: 'unreviewed' }),
    expect.objectContaining({ source_store: 'generic_mutations', source_key: 'legacy-mutation-1', original_payload: result.legacyMutation, recovery_state: 'unreviewed' }),
  ]));
  expect(result.queuedSales).toEqual([result.legacySale]);
  expect(result.queuedMutations).toEqual([result.legacyMutation]);
  expect(result.outbox).toEqual([]);
});

test('offline queue commits one grant consumption and sequence across duplicate retries', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const {
      enqueueOfflineOperation,
      offlineScopeKey,
      openOfflineDatabase,
    } = await import('/src/lib/offline-db.ts');
    const { createOfflineMasterKey, OfflineKeySession } = await import('/src/lib/offline-crypto.ts');
    const name = `offline-enqueue-${crypto.randomUUID()}`;
    const scope = {
      storeId: '22222222-2222-4222-8222-222222222222',
      actorId: '33333333-3333-4333-8333-333333333333',
      terminalId: '44444444-4444-4444-8444-444444444444',
    };
    const leaseId = '55555555-5555-4555-8555-555555555555';
    const grantId = '66666666-6666-4666-8666-666666666666';
    const now = new Date('2026-11-11T00:00:00.000Z');
    const keyMaterial = await createOfflineMasterKey('test-only passphrase', scope);
    const keySession = new OfflineKeySession(keyMaterial.key, 60_000);
    const database = await openOfflineDatabase({ name });
    await database.put('terminal_meta', {
      scope_key: offlineScopeKey(scope),
      store_id: scope.storeId,
      actor_id: scope.actorId,
      terminal_id: scope.terminalId,
      lease_id: leaseId,
      next_sequence: 1,
      last_acknowledged_sequence: 0,
      wrapped_master_key: keyMaterial.wrapped,
      updated_at_local: now.toISOString(),
    });
    await database.put('offline_leases', {
      id: leaseId,
      store_id: scope.storeId,
      terminal_id: scope.terminalId,
      shift_id: '77777777-7777-4777-8777-777777777777',
      cashier_id: scope.actorId,
      issued_at: now.toISOString(),
      expires_at: '2030-01-01T00:00:00.000Z',
      last_mfa_at: now.toISOString(),
      state: 'active',
      catalog_version: 'catalog-test-v1',
      price_policy_hash: 'test-policy-hash',
      sequence_start: 1,
      sequence_end: 10,
      contract_version: 1,
    });
    await database.put('stock_grants', {
      id: grantId,
      store_id: scope.storeId,
      terminal_id: scope.terminalId,
      lease_id: leaseId,
      product_id: '88888888-8888-4888-8888-888888888888',
      location_id: '99999999-9999-4999-8999-999999999999',
      lot_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      quantity_allocated: 3,
      quantity_consumed: 0,
      quantity_released: 0,
      state: 'active',
      version: 1,
    });
    const command = {
      contract_version: 1,
      operation_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      store_id: scope.storeId,
      terminal_id: scope.terminalId,
      shift_id: '77777777-7777-4777-8777-777777777777',
      occurred_at_local: now.toISOString(),
      terminal_sequence: 1,
      expected_version: null,
      payload: { total: '15.00', line_count: 1 },
    };
    const input = {
      database,
      keySession,
      scope,
      command,
      operationKind: 'physical_sale',
      leaseId,
      grantConsumptions: [{ grantId, quantity: 2 }],
      now,
    };
    const first = await enqueueOfflineOperation(input);
    const retry = await enqueueOfflineOperation(input);
    let changedRequestRejected = false;
    try {
      await enqueueOfflineOperation({
        ...input,
        command: { ...command, payload: { total: '16.00', line_count: 1 } },
      });
    } catch (error) {
      changedRequestRejected = error instanceof Error && error.message.includes('different offline request');
    }
    const grant = await database.get('stock_grants', grantId);
    const metadata = await database.get('terminal_meta', offlineScopeKey(scope));
    const events = await database.getAll('offline_grant_events');
    const outbox = await database.getAll('operations_outbox');
    keySession.lock();
    database.close();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
    return {
      firstInserted: first.inserted,
      retryInserted: retry.inserted,
      changedRequestRejected,
      grantConsumed: grant?.quantity_consumed,
      nextSequence: metadata?.next_sequence,
      eventCount: events.length,
      outboxCount: outbox.length,
      queueState: outbox[0]?.state,
      savedPayloadIsCiphertext: typeof outbox[0]?.encrypted_payload?.ciphertext === 'string',
      savedPayloadContainsTotal: JSON.stringify(outbox[0]?.encrypted_payload).includes('15.00'),
    };
  });

  expect(result).toEqual({
    firstInserted: true,
    retryInserted: false,
    changedRequestRejected: true,
    grantConsumed: 2,
    nextSequence: 2,
    eventCount: 1,
    outboxCount: 1,
    queueState: 'local_pending',
    savedPayloadIsCiphertext: true,
    savedPayloadContainsTotal: false,
  });
});

test('failed multi-grant write rolls back earlier grant use, events, and sequence', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { enqueueOfflineOperation, offlineScopeKey, openOfflineDatabase } = await import('/src/lib/offline-db.ts');
    const { createOfflineMasterKey, OfflineKeySession } = await import('/src/lib/offline-crypto.ts');
    const name = `offline-rollback-${crypto.randomUUID()}`;
    const scope = {
      storeId: '22222222-2222-4222-8222-222222222222',
      actorId: '33333333-3333-4333-8333-333333333333',
      terminalId: '44444444-4444-4444-8444-444444444444',
    };
    const leaseId = '55555555-5555-4555-8555-555555555555';
    const shiftId = '77777777-7777-4777-8777-777777777777';
    const grantA = '66666666-6666-4666-8666-666666666666';
    const grantB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const now = new Date('2026-11-11T00:00:00.000Z');
    const material = await createOfflineMasterKey('test-only passphrase', scope);
    const session = new OfflineKeySession(material.key, 60_000);
    const database = await openOfflineDatabase({ name });
    await database.put('terminal_meta', {
      scope_key: offlineScopeKey(scope), store_id: scope.storeId, actor_id: scope.actorId, terminal_id: scope.terminalId,
      lease_id: leaseId, next_sequence: 1, last_acknowledged_sequence: 0,
      wrapped_master_key: material.wrapped, updated_at_local: now.toISOString(),
    });
    await database.put('offline_leases', {
      id: leaseId, store_id: scope.storeId, terminal_id: scope.terminalId, shift_id: shiftId, cashier_id: scope.actorId,
      issued_at: now.toISOString(), expires_at: '2030-01-01T00:00:00.000Z', last_mfa_at: now.toISOString(),
      state: 'active', catalog_version: 'v1', price_policy_hash: 'hash', sequence_start: 1, sequence_end: 10, contract_version: 1,
    });
    for (const [id, quantity] of [[grantA, 3], [grantB, 1]] as const) {
      await database.put('stock_grants', {
        id, store_id: scope.storeId, terminal_id: scope.terminalId, lease_id: leaseId,
        product_id: id, location_id: '99999999-9999-4999-8999-999999999999', lot_id: id,
        quantity_allocated: quantity, quantity_consumed: 0, quantity_released: 0, state: 'active', version: 1,
      });
    }
    const command = {
      contract_version: 1,
      operation_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      store_id: scope.storeId, terminal_id: scope.terminalId, shift_id: shiftId,
      occurred_at_local: now.toISOString(), terminal_sequence: 1, expected_version: null, payload: { total: '20.00' },
    };
    let rejected = false;
    try {
      await enqueueOfflineOperation({
        database, keySession: session, scope, command, operationKind: 'physical_sale', leaseId,
        grantConsumptions: [{ grantId: grantA, quantity: 2 }, { grantId: grantB, quantity: 2 }], now,
      });
    } catch {
      rejected = true;
    }
    const a = await database.get('stock_grants', grantA);
    const b = await database.get('stock_grants', grantB);
    const metadata = await database.get('terminal_meta', offlineScopeKey(scope));
    const events = await database.getAll('offline_grant_events');
    const outbox = await database.getAll('operations_outbox');
    session.lock();
    database.close();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
    return {
      rejected,
      consumedA: a?.quantity_consumed,
      consumedB: b?.quantity_consumed,
      nextSequence: metadata?.next_sequence,
      events: events.length,
      outbox: outbox.length,
    };
  });

  expect(result).toEqual({ rejected: true, consumedA: 0, consumedB: 0, nextSequence: 1, events: 0, outbox: 0 });
});

test('server acknowledgements are encrypted, durable, and idempotent', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const {
      enqueueOfflineOperation,
      offlineScopeKey,
      openOfflineDatabase,
      persistOperationAcknowledgement,
      readOperationAcknowledgement,
    } = await import('/src/lib/offline-db.ts');
    const { createOfflineMasterKey, OfflineKeySession } = await import('/src/lib/offline-crypto.ts');
    const name = `offline-ack-${crypto.randomUUID()}`;
    const scope = {
      storeId: '22222222-2222-4222-8222-222222222222',
      actorId: '33333333-3333-4333-8333-333333333333',
      terminalId: '44444444-4444-4444-8444-444444444444',
    };
    const leaseId = '55555555-5555-4555-8555-555555555555';
    const shiftId = '77777777-7777-4777-8777-777777777777';
    const operationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const now = new Date('2026-11-11T00:00:00.000Z');
    const material = await createOfflineMasterKey('test-only passphrase', scope);
    const session = new OfflineKeySession(material.key, 60_000);
    const database = await openOfflineDatabase({ name });
    await database.put('terminal_meta', {
      scope_key: offlineScopeKey(scope), store_id: scope.storeId, actor_id: scope.actorId, terminal_id: scope.terminalId,
      lease_id: leaseId, next_sequence: 4, last_acknowledged_sequence: 3,
      wrapped_master_key: material.wrapped, updated_at_local: now.toISOString(),
    });
    await database.put('offline_leases', {
      id: leaseId, store_id: scope.storeId, terminal_id: scope.terminalId, shift_id: shiftId, cashier_id: scope.actorId,
      issued_at: now.toISOString(), expires_at: '2030-01-01T00:00:00.000Z', last_mfa_at: now.toISOString(),
      state: 'active', catalog_version: 'v1', price_policy_hash: 'hash', sequence_start: 4, sequence_end: 10, contract_version: 1,
    });
    await database.put('stock_grants', {
      id: '66666666-6666-4666-8666-666666666666', store_id: scope.storeId, terminal_id: scope.terminalId,
      lease_id: leaseId, product_id: '88888888-8888-4888-8888-888888888888',
      location_id: '99999999-9999-4999-8999-999999999999', lot_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      quantity_allocated: 2, quantity_consumed: 0, quantity_released: 0, state: 'active', version: 1,
    });
    const command = {
      contract_version: 1, operation_id: operationId, store_id: scope.storeId, terminal_id: scope.terminalId,
      shift_id: shiftId, occurred_at_local: now.toISOString(), terminal_sequence: 4, expected_version: null,
      payload: { total: '9.00' },
    };
    const queued = await enqueueOfflineOperation({
      database, keySession: session, scope, command, operationKind: 'physical_sale', leaseId,
      grantConsumptions: [{ grantId: '66666666-6666-4666-8666-666666666666', quantity: 1 }], now,
    });
    const serverResult = {
      contract_version: 1,
      operation_id: operationId,
      outcome: 'confirmed',
      aggregate_type: 'sale',
      aggregate_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      aggregate_version: 1,
      confirmed_at: '2026-11-11T00:01:00.000Z',
      result: { receipt_number: 'TEST-ONLY' },
    };
    const ackInput = {
      database, keySession: session, scope, operationId,
      payloadHash: queued.operation.payload_hash, result: serverResult,
      acknowledgedAtServer: serverResult.confirmed_at, now,
    };
    await persistOperationAcknowledgement(ackInput);
    await persistOperationAcknowledgement(ackInput);
    const restored = await readOperationAcknowledgement(database, session, scope, operationId);
    let otherActorRejected = false;
    try {
      await readOperationAcknowledgement(database, session, { ...scope, actorId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }, operationId);
    } catch {
      otherActorRejected = true;
    }
    let conflictingAckRejected = false;
    try {
      await persistOperationAcknowledgement({
        ...ackInput,
        result: { ...serverResult, result: { receipt_number: 'CONFLICT' } },
      });
    } catch {
      conflictingAckRejected = true;
    }
    let locallyRecordedAckRejected = false;
    try {
      await persistOperationAcknowledgement({
        ...ackInput,
        result: { ...serverResult, outcome: 'recorded_locally' },
      });
    } catch {
      locallyRecordedAckRejected = true;
    }
    const operation = await database.get('operations_outbox', operationId);
    const acks = await database.getAll('operation_acks');
    const metadata = await database.get('terminal_meta', offlineScopeKey(scope));
    const ackCiphertext = JSON.stringify(acks[0]?.encrypted_result);
    session.lock();
    database.close();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
    return {
      restored,
      serverResult,
      otherActorRejected,
      conflictingAckRejected,
      locallyRecordedAckRejected,
      operationState: operation?.state,
      acknowledgementId: operation?.acknowledgement_id,
      ackCount: acks.length,
      acknowledgementSequence: acks[0]?.terminal_sequence,
      lastAcknowledgedSequence: metadata?.last_acknowledged_sequence,
      ackContainsReceiptNumber: ackCiphertext.includes('TEST-ONLY'),
    };
  });

  expect(result.restored).toEqual(result.serverResult);
  expect(result.otherActorRejected).toBe(true);
  expect(result.conflictingAckRejected).toBe(true);
  expect(result.locallyRecordedAckRejected).toBe(true);
  expect(result.operationState).toBe('synchronized');
  expect(result.acknowledgementId).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  expect(result.ackCount).toBe(1);
  expect(result.acknowledgementSequence).toBe(4);
  expect(result.lastAcknowledgedSequence).toBe(4);
  expect(result.ackContainsReceiptNumber).toBe(false);
});

test('offline checkout does not save a legacy sale or return a confirmed result', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { processSale, SaleConfirmationUncertainError } = await import('/src/lib/offline-sync.ts');
    const saleId = crypto.randomUUID();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    let errorName = '';
    let errorMessage = '';
    let returnedSale = false;
    try {
      returnedSale = Boolean(await processSale({ id: saleId } as never));
    } catch (error) {
      errorName = error instanceof Error ? error.name : '';
      errorMessage = error instanceof Error ? error.message : '';
    }
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kodigo-pos-db', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const queuedSale = await new Promise<unknown>((resolve, reject) => {
      const request = database.transaction('sales_queue', 'readonly').objectStore('sales_queue').get(saleId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result ?? null);
    });
    database.close();
    return {
      errorName,
      errorMessage,
      returnedSale,
      isUncertainOutcome: errorName === new SaleConfirmationUncertainError('').name,
      queuedSale,
    };
  });

  expect(result.errorName).toBe('SaleConfirmationUncertainError');
  expect(result.errorMessage).toContain('No sale was submitted');
  expect(result.returnedSale).toBe(false);
  expect(result.isUncertainOutcome).toBe(true);
  expect(result.queuedSale).toBeNull();
});

test('legacy sale records remain untouched instead of auto-replaying on reconnect', async ({ page }) => {
  let replayRequests = 0;
  await page.route('**/rpc/process_pos_sale_v4*', async (route) => {
    replayRequests += 1;
    await route.abort();
  });
  const result = await page.evaluate(async () => {
    const { syncPendingSales } = await import('/src/lib/offline-sync.ts');
    const saleId = crypto.randomUUID();
    const legacySale = { id: saleId, total: 5, _syncStatus: 'pending' as const };
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('kodigo-pos-db', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('sales_queue', 'readwrite');
      transaction.objectStore('sales_queue').put(legacySale);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    await syncPendingSales();
    const retainedSale = await new Promise<unknown>((resolve, reject) => {
      const request = database.transaction('sales_queue', 'readonly').objectStore('sales_queue').get(saleId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result ?? null);
    });
    database.close();
    return { retainedSale, legacySale };
  });

  expect(result.retainedSale).toEqual(result.legacySale);
  expect(replayRequests).toBe(0);
});

test('outbox attempts and retry states persist atomically and prevent overlapping sends', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const {
      beginOfflineOperationAttempt,
      enqueueOfflineOperation,
      offlineScopeKey,
      openOfflineDatabase,
      recordOfflineOperationFailure,
    } = await import('/src/lib/offline-db.ts');
    const { createOfflineMasterKey, OfflineKeySession } = await import('/src/lib/offline-crypto.ts');
    const name = `offline-attempt-${crypto.randomUUID()}`;
    const scope = {
      storeId: '22222222-2222-4222-8222-222222222222',
      actorId: '33333333-3333-4333-8333-333333333333',
      terminalId: '44444444-4444-4444-8444-444444444444',
    };
    const leaseId = '55555555-5555-4555-8555-555555555555';
    const shiftId = '77777777-7777-4777-8777-777777777777';
    const grantId = '66666666-6666-4666-8666-666666666666';
    const operationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const now = new Date('2026-11-11T00:00:00.000Z');
    const material = await createOfflineMasterKey('test-only passphrase', scope);
    const keySession = new OfflineKeySession(material.key, 60_000);
    const database = await openOfflineDatabase({ name });
    await database.put('terminal_meta', {
      scope_key: offlineScopeKey(scope), store_id: scope.storeId, actor_id: scope.actorId, terminal_id: scope.terminalId,
      lease_id: leaseId, next_sequence: 1, last_acknowledged_sequence: 0,
      wrapped_master_key: material.wrapped, updated_at_local: now.toISOString(),
    });
    await database.put('offline_leases', {
      id: leaseId, store_id: scope.storeId, terminal_id: scope.terminalId, shift_id: shiftId, cashier_id: scope.actorId,
      issued_at: now.toISOString(), expires_at: '2030-01-01T00:00:00.000Z', last_mfa_at: now.toISOString(),
      state: 'active', catalog_version: 'v1', price_policy_hash: 'hash', sequence_start: 1, sequence_end: 10, contract_version: 1,
    });
    await database.put('stock_grants', {
      id: grantId, store_id: scope.storeId, terminal_id: scope.terminalId, lease_id: leaseId,
      product_id: '88888888-8888-4888-8888-888888888888', location_id: '99999999-9999-4999-8999-999999999999',
      lot_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', quantity_allocated: 2, quantity_consumed: 0,
      quantity_released: 0, state: 'active', version: 1,
    });
    const command = {
      contract_version: 1, operation_id: operationId, store_id: scope.storeId, terminal_id: scope.terminalId,
      shift_id: shiftId, occurred_at_local: now.toISOString(), terminal_sequence: 1, expected_version: null,
      payload: { total: '8.00' },
    };
    await enqueueOfflineOperation({
      database, keySession, scope, command, operationKind: 'physical_sale', leaseId,
      grantConsumptions: [{ grantId, quantity: 1 }], now,
    });
    const claimResults = await Promise.allSettled([
      beginOfflineOperationAttempt({ database, scope, operationId, now }),
      beginOfflineOperationAttempt({ database, scope, operationId, now }),
    ]);
    const claimed = claimResults.find((entry) => entry.status === 'fulfilled');
    const failedClaim = claimResults.find((entry) => entry.status === 'rejected');
    const retryAt = new Date(now.getTime() + 1_000).toISOString();
    await recordOfflineOperationFailure({
      database, scope, operationId, state: 'retry_wait', errorCode: 'network_timeout', nextAttemptAt: retryAt, now,
    });
    let earlyRetryRejected = false;
    try {
      await beginOfflineOperationAttempt({ database, scope, operationId, now: new Date(now.getTime() + 500) });
    } catch {
      earlyRetryRejected = true;
    }
    const secondAttempt = await beginOfflineOperationAttempt({
      database, scope, operationId, now: new Date(now.getTime() + 1_500),
    });
    await recordOfflineOperationFailure({
      database, scope, operationId, state: 'blocked_auth', errorCode: 'lease_revoked',
      now: new Date(now.getTime() + 1_500),
    });
    let blockedRetryRejected = false;
    try {
      await beginOfflineOperationAttempt({ database, scope, operationId, now: new Date(now.getTime() + 5_000) });
    } catch {
      blockedRetryRejected = true;
    }
    const finalOperation = await database.get('operations_outbox', operationId);
    keySession.lock();
    database.close();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
    return {
      claimFulfilled: claimed?.status === 'fulfilled',
      claimCount: claimResults.filter((entry) => entry.status === 'fulfilled').length,
      concurrentClaimRejected: failedClaim?.status === 'rejected',
      firstAttemptCount: claimed?.status === 'fulfilled' ? claimed.value.attempt_count : null,
      earlyRetryRejected,
      secondAttemptCount: secondAttempt.attempt_count,
      blockedRetryRejected,
      finalState: finalOperation?.state,
      finalAttemptCount: finalOperation?.attempt_count,
      nextAttemptAt: finalOperation?.next_attempt_at,
      lastErrorCode: finalOperation?.last_error_code,
    };
  });

  expect(result).toEqual({
    claimFulfilled: true,
    claimCount: 1,
    concurrentClaimRejected: true,
    firstAttemptCount: 1,
    earlyRetryRejected: true,
    secondAttemptCount: 2,
    blockedRetryRejected: true,
    finalState: 'blocked_auth',
    finalAttemptCount: 2,
    nextAttemptAt: null,
    lastErrorCode: 'lease_revoked',
  });
});

test('recovery export encrypts legacy queues and rejects another passphrase or account scope', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const {
      createOfflineRecoveryExport,
      openOfflineDatabase,
    } = await import('/src/lib/offline-db.ts');
    const { decryptOfflineRecoveryBundle } = await import('/src/lib/offline-crypto.ts');
    const name = `offline-export-${crypto.randomUUID()}`;
    const scope = {
      storeId: '22222222-2222-4222-8222-222222222222',
      actorId: '33333333-3333-4333-8333-333333333333',
      terminalId: '44444444-4444-4444-8444-444444444444',
    };
    const legacySale = {
      id: 'legacy-export-sale',
      customerName: 'EXPORT-SECRET-CUSTOMER',
      total: 37.5,
      _syncStatus: 'pending' as const,
    };
    const legacyMutation = {
      id: 'legacy-export-mutation',
      table: 'products',
      operation: 'UPDATE' as const,
      payload: { privateNote: 'EXPORT-SECRET-MUTATION' },
      _syncStatus: 'error' as const,
    };
    const database = await openOfflineDatabase({ name });
    await database.put('sales_queue', legacySale as never);
    await database.put('generic_mutations', legacyMutation as never);
    await database.put('legacy_recovery', {
      id: 'v1:sales_queue:legacy-export-sale',
      source_store: 'sales_queue',
      source_key: legacySale.id,
      original_payload: legacySale,
      imported_at_local: '2026-11-11T00:00:00.000Z',
      recovery_state: 'unreviewed',
    });
    const envelope = await createOfflineRecoveryExport({
      database,
      scope,
      passphrase: 'export test-only passphrase',
      now: new Date('2026-11-11T00:00:00.000Z'),
    });
    const serialized = JSON.stringify(envelope);
    const recovered = await decryptOfflineRecoveryBundle(envelope, 'export test-only passphrase', scope);
    let wrongPassphraseRejected = false;
    try {
      await decryptOfflineRecoveryBundle(envelope, 'incorrect test-only passphrase', scope);
    } catch {
      wrongPassphraseRejected = true;
    }
    let wrongScopeRejected = false;
    try {
      await decryptOfflineRecoveryBundle(envelope, 'export test-only passphrase', {
        ...scope,
        actorId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      });
    } catch {
      wrongScopeRejected = true;
    }
    database.close();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
    return {
      envelopeFormat: envelope.format,
      kdfIterations: envelope.iterations,
      legacySales: recovered.legacy_v1_sales,
      legacyMutations: recovered.legacy_v1_mutations,
      recoveryState: recovered.legacy_recovery[0]?.recovery_state,
      hasRawSaleSecret: serialized.includes('EXPORT-SECRET-CUSTOMER'),
      hasRawMutationSecret: serialized.includes('EXPORT-SECRET-MUTATION'),
      wrongPassphraseRejected,
      wrongScopeRejected,
    };
  });

  expect(result.envelopeFormat).toBe('kodigo-offline-recovery');
  expect(result.kdfIterations).toBe(600_000);
  expect(result.legacySales).toEqual([expect.objectContaining({ customerName: 'EXPORT-SECRET-CUSTOMER' })]);
  expect(result.legacyMutations).toEqual([expect.objectContaining({ payload: { privateNote: 'EXPORT-SECRET-MUTATION' } })]);
  expect(result.recoveryState).toBe('unreviewed');
  expect(result.hasRawSaleSecret).toBe(false);
  expect(result.hasRawMutationSecret).toBe(false);
  expect(result.wrongPassphraseRejected).toBe(true);
  expect(result.wrongScopeRejected).toBe(true);
});

test('offline storage quota and conflict errors give safe recovery guidance', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { normalizeOfflineStorageError } = await import('/src/lib/offline-db.ts');
    const quota = normalizeOfflineStorageError(new DOMException('sensitive underlying storage detail', 'QuotaExceededError'));
    const conflict = normalizeOfflineStorageError(new DOMException('sensitive underlying storage detail', 'ConstraintError'));
    return {
      quotaName: quota.name,
      quotaCode: (quota as Error & { code?: string }).code,
      quotaMessage: quota.message,
      conflictName: conflict.name,
      conflictCode: (conflict as Error & { code?: string }).code,
      conflictMessage: conflict.message,
    };
  });

  expect(result.quotaName).toBe('OfflineStorageError');
  expect(result.quotaCode).toBe('QUOTA');
  expect(result.quotaMessage).toContain('operation was not saved');
  expect(result.quotaMessage).toContain('keep the cart');
  expect(result.conflictName).toBe('OfflineStorageError');
  expect(result.conflictCode).toBe('CORRUPT');
  expect(result.conflictMessage).toContain('conflicts with an existing local record');
  expect(result.quotaMessage).not.toContain('sensitive underlying storage detail');
  expect(result.conflictMessage).not.toContain('sensitive underlying storage detail');
});

test('quota failure aborts grant, event, outbox, and sequence writes atomically', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { enqueueOfflineOperation, offlineScopeKey, openOfflineDatabase } = await import('/src/lib/offline-db.ts');
    const { createOfflineMasterKey, OfflineKeySession } = await import('/src/lib/offline-crypto.ts');
    const name = `offline-quota-abort-${crypto.randomUUID()}`;
    const scope = {
      storeId: '22222222-2222-4222-8222-222222222222',
      actorId: '33333333-3333-4333-8333-333333333333',
      terminalId: '44444444-4444-4444-8444-444444444444',
    };
    const leaseId = '55555555-5555-4555-8555-555555555555';
    const shiftId = '77777777-7777-4777-8777-777777777777';
    const grantIds = [
      '66666666-6666-4666-8666-666666666666',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    ];
    const operationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const now = new Date('2026-11-11T00:00:00.000Z');
    const material = await createOfflineMasterKey('quota test-only passphrase', scope);
    const keySession = new OfflineKeySession(material.key, 60_000);
    const database = await openOfflineDatabase({ name });
    await database.put('terminal_meta', {
      scope_key: offlineScopeKey(scope), store_id: scope.storeId, actor_id: scope.actorId,
      terminal_id: scope.terminalId, lease_id: leaseId, next_sequence: 1,
      last_acknowledged_sequence: 0, wrapped_master_key: material.wrapped,
      updated_at_local: now.toISOString(),
    });
    await database.put('offline_leases', {
      id: leaseId, store_id: scope.storeId, terminal_id: scope.terminalId,
      shift_id: shiftId, cashier_id: scope.actorId, issued_at: now.toISOString(),
      expires_at: '2030-01-01T00:00:00.000Z', last_mfa_at: now.toISOString(),
      state: 'active', catalog_version: 'v1', price_policy_hash: 'hash',
      sequence_start: 1, sequence_end: 10, contract_version: 1,
    });
    for (const id of grantIds) {
      await database.put('stock_grants', {
        id, store_id: scope.storeId, terminal_id: scope.terminalId, lease_id: leaseId,
        product_id: id, location_id: '99999999-9999-4999-8999-999999999999', lot_id: id,
        quantity_allocated: 2, quantity_consumed: 0, quantity_released: 0,
        state: 'active', version: 1,
      });
    }

    const originalDescriptor = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'put');
    if (!originalDescriptor) throw new Error('IndexedDB put method is unavailable in this browser.');
    const originalPut = originalDescriptor.value as IDBObjectStore['put'];
    let stockGrantWrites = 0;
    Object.defineProperty(IDBObjectStore.prototype, 'put', {
      ...originalDescriptor,
      value: function (this: IDBObjectStore, ...args: unknown[]) {
        if (this.name === 'stock_grants' && ++stockGrantWrites === 2) {
          throw new DOMException('test-only quota exhaustion', 'QuotaExceededError');
        }
        return Reflect.apply(originalPut, this, args);
      },
    });

    let errorCode: string | null = null;
    let safeMessage = false;
    try {
      await enqueueOfflineOperation({
        database,
        keySession,
        scope,
        command: {
          contract_version: 1, operation_id: operationId, store_id: scope.storeId,
          terminal_id: scope.terminalId, shift_id: shiftId, occurred_at_local: now.toISOString(),
          terminal_sequence: 1, expected_version: null, payload: { total: '21.00' },
        },
        operationKind: 'physical_sale',
        leaseId,
        grantConsumptions: grantIds.map((grantId) => ({ grantId, quantity: 1 })),
        now,
      });
    } catch (error) {
      errorCode = (error as Error & { code?: string }).code ?? null;
      safeMessage = error instanceof Error && error.message.includes('operation was not saved');
    } finally {
      Object.defineProperty(IDBObjectStore.prototype, 'put', originalDescriptor);
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
    const grants = await Promise.all(grantIds.map((id) => database.get('stock_grants', id)));
    const metadata = await database.get('terminal_meta', offlineScopeKey(scope));
    const events = await database.getAll('offline_grant_events');
    const outbox = await database.getAll('operations_outbox');
    keySession.lock();
    database.close();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
    return {
      errorCode,
      safeMessage,
      injectedAfterFirstGrantWrite: stockGrantWrites === 2,
      consumed: grants.map((grant) => grant?.quantity_consumed),
      nextSequence: metadata?.next_sequence,
      eventCount: events.length,
      outboxCount: outbox.length,
    };
  });

  expect(result).toEqual({
    errorCode: 'QUOTA',
    safeMessage: true,
    injectedAfterFirstGrantWrite: true,
    consumed: [0, 0],
    nextSequence: 1,
    eventCount: 0,
    outboxCount: 0,
  });
});
