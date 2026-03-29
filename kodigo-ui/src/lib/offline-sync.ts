import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import { supabase } from './supabase';
import type { Sale, Product } from '@/types';

interface PosDB extends DBSchema {
  products_cache: {
    key: string;
    value: Product;
  };
  sales_queue: {
    key: string;
    value: Sale & { _syncStatus: 'pending' | 'error'; _syncError?: string };
    indexes: { 'by-status': string };
  };
  generic_mutations: {
    key: string;
    value: {
      id: string; // random local uuid
      table: string;
      operation: 'INSERT' | 'UPDATE' | 'DELETE';
      payload: any;
      matchKey?: string; // used for UPDATE/DELETE
      matchValue?: any;
      _syncStatus: 'pending' | 'error';
      _syncError?: string;
    };
    indexes: { 'by-status': string };
  };
}

let dbPromise: Promise<IDBPDatabase<PosDB>>;

// Small helper to retry IDB operations that fail due to AbortError/lock stealing.
async function idbRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 150): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const isAbort = err && (err.name === 'AbortError' || String(err).includes('Lock broken'));
      if (!isAbort) throw err;
      // small backoff
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

if (typeof window !== 'undefined') {
  dbPromise = openDB<PosDB>('kodigo-pos-db', 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('products_cache')) {
        db.createObjectStore('products_cache', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('sales_queue')) {
        const store = db.createObjectStore('sales_queue', { keyPath: 'id' });
        store.createIndex('by-status', '_syncStatus');
      }
      if (!db.objectStoreNames.contains('generic_mutations')) {
        const store = db.createObjectStore('generic_mutations', { keyPath: 'id' });
        store.createIndex('by-status', '_syncStatus');
      }
    },
  });
}

/** Cache catalog for offline usage */
export async function cacheProductsLocally(products: Product[]) {
  if (!dbPromise) return;
  const db = await dbPromise;
  if (!db.objectStoreNames.contains('products_cache')) return;
  await idbRetry(async () => {
    const tx = db.transaction('products_cache', 'readwrite');
    await tx.objectStore('products_cache').clear();
    for (const product of products) {
      await tx.objectStore('products_cache').put(product);
    }
    await tx.done;
  });
}

/** Get products from local cache */
export async function getCachedProducts(): Promise<Product[]> {
  if (!dbPromise) return [];
  const db = await dbPromise;
  if (!db.objectStoreNames.contains('products_cache')) return [];
  return idbRetry(() => db.getAll('products_cache'));
}

/** Queue a sale when offline */
export async function queueSaleOffline(sale: Sale) {
  if (!dbPromise) return;
  const db = await dbPromise;
  if (!db.objectStoreNames.contains('sales_queue')) return;
  await idbRetry(async () => db.put('sales_queue', {
    ...sale,
    _syncStatus: 'pending',
  }));
}

/** Attempt to push a single sale to Supabase */
async function pushSaleToSupabase(sale: Sale): Promise<void> {
  const { id, storeId, cashierId, subtotal, tax, discount, total, cashReceived, change, items } = sale;
  
  // Start generic Supabase RPC or direct insert
  // For strictly multi-statement relations, it's often better to do this in a Supabase transaction RPC, 
  // but for now, we'll try plain JS inserts (requires RLS to allow inserts)
  
  const { error: saleError } = await supabase.from('sales').insert({
    id, // Preserve UUID generated locally
    store_id: storeId,
    cashier_id: cashierId,
    subtotal,
    tax,
    discount,
    total,
    cash_received: cashReceived,
    change
  }).select().single();

  if (saleError) throw saleError;
  
  // Insert items
  const mappedItems = items.map(item => ({
    sale_id: id,
    product_id: item.productId,
    product_name: item.productName,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    line_total: item.lineTotal
  }));

  const { error: itemsError } = await supabase.from('sale_items').insert(mappedItems);
  if (itemsError) throw itemsError;
}

/** Push all pending sales when connection is restored */
export async function syncPendingSales() {
  if (!dbPromise || !navigator.onLine) return;
  const db = await dbPromise;
  if (!db.objectStoreNames.contains('sales_queue')) return;
  let pendingSales: any[] = [];
  try {
    pendingSales = await db.getAllFromIndex('sales_queue', 'by-status', 'pending');
  } catch (err: any) {
    console.warn('[Sync] sales_queue index missing or unreadable, skipping sales sync', err);
    return;
  }

  for (const sale of pendingSales) {
    try {
      await pushSaleToSupabase(sale);
      await idbRetry(() => db.delete('sales_queue', sale.id));
    } catch (err: any) {
      console.error('Failed to sync sale:', sale.id, err);
      // Mark as error but leave in queue
      sale._syncStatus = 'error';
      sale._syncError = err?.message || 'Unknown error';
      await db.put('sales_queue', sale);
    }
  }
}

/** Process a sale. Tries to push to Supabase immediately; if it fails or offline, it queues locally. */
export async function processSale(sale: Sale) {
  if (typeof window !== 'undefined' && !navigator.onLine) {
    console.log('[Sync] Offline, queueing sale locally:', sale.id);
    await queueSaleOffline(sale);
    return;
  }
  try {
    await pushSaleToSupabase(sale);
  } catch (err: any) {
    console.error('[Sync] Failed to push to Supabase, queueing locally:', err);
    await queueSaleOffline(sale);
  }
}

// Global listener to sync when network comes back
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[Sync] Network connected, flushing background queues...');
    syncPendingSales();
    syncPendingMutations();
  });
}

/** ── Generic Offline Mutations Queue ── */

export async function queueMutationOffline(
  table: string, 
  operation: 'INSERT'|'UPDATE'|'DELETE', 
  payload: any, 
  matchKey?: string, 
  matchValue?: any
) {
  if (!dbPromise) return;
  const db = await dbPromise;
  if (!db.objectStoreNames.contains('generic_mutations')) return;
  await idbRetry(() => db.put('generic_mutations', {
    id: crypto.randomUUID(),
    table,
    operation,
    payload,
    matchKey,
    matchValue,
    _syncStatus: 'pending'
  }));
}

export async function syncPendingMutations() {
  if (!dbPromise || !navigator.onLine) return;
  const db = await dbPromise;
  if (!db.objectStoreNames.contains('generic_mutations')) return;
  let pending: any[] = [];
  try {
    pending = await db.getAllFromIndex('generic_mutations', 'by-status', 'pending');
  } catch (err: any) {
    console.warn('[Sync] generic_mutations index missing or unreadable, skipping mutation sync', err);
    return;
  }

  for (const mut of pending) {
    try {
      if (mut.operation === 'INSERT') {
        const { error } = await supabase.from(mut.table).insert(mut.payload).select();
        if (error) throw error;
      } else if (mut.operation === 'UPDATE' && mut.matchKey) {
        const { error } = await supabase.from(mut.table).update(mut.payload).eq(mut.matchKey, mut.matchValue).select();
        if (error) throw error;
      } else if (mut.operation === 'DELETE' && mut.matchKey) {
        const { error } = await supabase.from(mut.table).delete().eq(mut.matchKey, mut.matchValue).select();
        if (error) throw error;
      }
      await idbRetry(() => db.delete('generic_mutations', mut.id));
    } catch (err: any) {
      console.error(`Failed to sync mutation on \${mut.table}:`, err);
      mut._syncStatus = 'error';
      mut._syncError = err?.message || 'Unknown error';
      await idbRetry(() => db.put('generic_mutations', mut));
    }
  }
}

/** Wrapper that automatically executes online, or queues offline */
export async function executeOrQueueMutation(
  table: string, 
  operation: 'INSERT'|'UPDATE'|'DELETE', 
  payload: any, 
  matchKey?: string, 
  matchValue?: any
) {
  const withTimeout = async <T>(promise: PromiseLike<T>, timeoutMs = 15000): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
      }),
    ]);
  };

  if (typeof window !== 'undefined' && !navigator.onLine) {
    await queueMutationOffline(table, operation, payload, matchKey, matchValue);
    return;
  }
  
  try {
    if (operation === 'INSERT') {
      const result: any = await withTimeout(supabase.from(table).insert(payload));
      const { error } = result;
      if (error) throw error;
    } else if (operation === 'UPDATE' && matchKey) {
      const result: any = await withTimeout(supabase.from(table).update(payload).eq(matchKey, matchValue));
      const { error } = result;
      if (error) throw error;
    } else if (operation === 'DELETE' && matchKey) {
      const result: any = await withTimeout(supabase.from(table).delete().eq(matchKey, matchValue));
      const { error } = result;
      if (error) throw error;
    }
  } catch (err: any) {
    // Check if it's an actual Supabase/Postgres error (e.g., RLS, validation) vs a network error
    if (err && err.code) {
      console.error(`[Sync] API/DB Error on \${operation} for \${table}:`, err);
      throw err; // Do not queue locally if the database rejected it for logic/permission reasons
    }
    console.warn(`[Sync] Mutation \${operation} on \${table} failed online (network issue?), queueing locally:`, err);
    await queueMutationOffline(table, operation, payload, matchKey, matchValue);
  }
}

