import { expect, test } from '@playwright/test';

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
  expect(result.operationState).toBe('synchronized');
  expect(result.acknowledgementId).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  expect(result.ackCount).toBe(1);
  expect(result.acknowledgementSequence).toBe(4);
  expect(result.lastAcknowledgedSequence).toBe(4);
  expect(result.ackContainsReceiptNumber).toBe(false);
});
