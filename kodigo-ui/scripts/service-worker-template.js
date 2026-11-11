/* The build replaces all three placeholders with a content-specific shell manifest. */
const CACHE_PREFIX = 'kodigo-shell-';
const CACHE_NAME = `${CACHE_PREFIX}__KODIGO_SHELL_VERSION__`;
const PRECACHE_URLS = new Set(__KODIGO_PRECACHE_URLS__);
const SUPPORTED_DATABASE_VERSION = __KODIGO_DATABASE_VERSION__;
const SUPPORTED_OPERATION_CONTRACTS = new Set(__KODIGO_OPERATION_CONTRACTS__);
const OFFLINE_DATABASE_NAME = 'kodigo-pos-db';
const SUPPORTED_QUEUE_STATES = new Set([
  'local_pending', 'syncing', 'synchronized', 'retry_wait', 'conflicted', 'blocked_auth', 'needs_recovery',
]);

async function canReadStoredOfflineData() {
  if (typeof indexedDB === 'undefined') return false;
  let database;
  try {
    if (typeof indexedDB.databases === 'function') {
      const databases = await indexedDB.databases();
      if (!databases.some((database) => database.name === OFFLINE_DATABASE_NAME)) return true;
    }
    database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(OFFLINE_DATABASE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Offline database is blocked.'));
    });
    database.onversionchange = () => database.close();
    if (database.version > SUPPORTED_DATABASE_VERSION) return false;

    const readAll = (storeName) => new Promise((resolve, reject) => {
      if (!database.objectStoreNames.contains(storeName)) return resolve([]);
      const request = database.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const [operations, leases, metadata] = await Promise.all([
      readAll('operations_outbox'), readAll('offline_leases'), readAll('terminal_meta'),
    ]);
    const operationsReadable = operations.every((operation) => {
      const contractVersion = operation.contract_version ?? 1;
      return SUPPORTED_OPERATION_CONTRACTS.has(contractVersion)
        && typeof operation.operation_id === 'string'
        && /^[0-9a-f-]{36}$/i.test(operation.operation_id)
        && /^[0-9a-f]{64}$/i.test(operation.payload_hash)
        && Number.isSafeInteger(operation.terminal_sequence)
        && operation.terminal_sequence > 0
        && SUPPORTED_QUEUE_STATES.has(operation.state)
        && operation.encrypted_payload?.version === 1
        && typeof operation.encrypted_payload.iv === 'string'
        && typeof operation.encrypted_payload.ciphertext === 'string';
    });
    const leasesReadable = database.version < 3 || leases.every((lease) =>
      lease.encrypted_snapshot?.version === 1
      && typeof lease.encrypted_snapshot.iv === 'string'
      && typeof lease.encrypted_snapshot.ciphertext === 'string'
      && !('expires_at' in lease)
      && !('sequence_start' in lease)
      && !('sequence_end' in lease));
    const metadataReadable = metadata.every((record) =>
      record.wrapped_master_key?.version === 1
      && record.wrapped_master_key?.schema_version === 2);
    return operationsReadable && leasesReadable && metadataReadable;
  } catch {
    return false;
  } finally {
    database?.close();
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    if (!await canReadStoredOfflineData()) {
      throw new Error('Offline data is not compatible with this app-shell version.');
    }
    const cache = await caches.open(CACHE_NAME);
    for (const assetUrl of PRECACHE_URLS) {
      const response = await fetch(assetUrl, { cache: 'reload', credentials: 'omit' });
      if (!response.ok || response.type === 'opaque') {
        throw new Error(`App shell asset could not be cached: ${assetUrl}`);
      }
      await cache.put(assetUrl, response);
    }
  })());
});

self.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.type === 'ACTIVATE_COMPATIBLE_UPDATE'
    && message.databaseVersion === SUPPORTED_DATABASE_VERSION
    && Array.isArray(message.operationContracts)
    && message.operationContracts.every((version) => SUPPORTED_OPERATION_CONTRACTS.has(version))) {
    event.waitUntil((async () => {
      const windows = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
      if (windows.length > 1) {
        event.source?.postMessage({ type: 'UPDATE_BLOCKED_MULTIPLE_TABS' });
        return;
      }
      await self.skipWaiting();
    })());
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = (await caches.keys())
      .filter((name) => name.startsWith(CACHE_PREFIX))
      .filter((name) => name !== CACHE_NAME)
      .sort()
      .reverse();
    const retained = new Set([CACHE_NAME, ...cacheNames.slice(0, 2)]);
    await Promise.all(cacheNames.filter((name) => !retained.has(name)).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('authorization')) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.search || url.hash) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(new Request(request, { credentials: 'omit' })).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match('/index.html')) ?? Response.error();
    }));
    return;
  }

  // Exact generated asset allowlist. Auth, REST, storage, realtime and function requests never match.
  if (!PRECACHE_URLS.has(url.pathname) || request.credentials === 'include') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(url.pathname);
    if (cached) return cached;
    const response = await fetch(new Request(request, { credentials: 'omit' }));
    if (response.ok && response.type === 'basic' && !response.headers.has('set-cookie')) {
      await cache.put(url.pathname, response.clone());
    }
    return response;
  })());
});
