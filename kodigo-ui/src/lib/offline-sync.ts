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

function isDatabaseRejection(err: any) {
  return Boolean(err?.code || err?.details || err?.hint || err?.status);
}

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

function mapSaleResponse(sale: Sale, row: any | null): Sale {
  if (!row) return sale;
  return {
    ...sale,
    subtotal: Number(row.subtotal ?? sale.subtotal),
    tax: Number(row.tax ?? sale.tax),
    taxRate: Number(row.tax_rate ?? sale.taxRate),
    discount: Number(row.discount ?? sale.discount),
    discountType: row.discount_type ?? sale.discountType,
    discountValue: Number(row.discount_value ?? sale.discountValue),
    total: Number(row.total ?? sale.total),
    cashReceived: Number(row.cash_received ?? sale.cashReceived),
    change: Number(row.change ?? sale.change),
    paymentMethod: row.payment_method ?? sale.paymentMethod,
    paymentReference: row.payment_reference ?? sale.paymentReference,
    receiptNumber: row.receipt_number ?? sale.receiptNumber,
    status: row.status ?? sale.status,
    createdAt: row.created_at ?? sale.createdAt,
  };
}

/** Attempt to push a single sale to Supabase */
async function pushSaleToSupabase(sale: Sale): Promise<Sale> {
  const {
    id,
    storeId,
    cashierId,
    subtotal,
    tax,
    taxRate,
    discount,
    discountType,
    discountValue,
    total,
    cashReceived,
    change,
    items,
    paymentMethod,
    paymentReference,
  } = sale;

  const { data, error } = await supabase.rpc('process_pos_sale_v2', {
    p_id: id,
    p_store_id: storeId,
    p_cashier_id: cashierId,
    p_subtotal: subtotal,
    p_tax: tax,
    p_discount: discount,
    p_total: total,
    p_cash_received: cashReceived,
    p_change: change,
    p_items: items,
    p_payment_method: paymentMethod,
    p_payment_reference: paymentReference ?? null,
    p_discount_type: discountType,
    p_discount_value: discountValue,
    p_tax_rate: taxRate,
  });

  if (error) throw error;
  return mapSaleResponse(sale, data);
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
export async function processSale(sale: Sale): Promise<Sale> {
  if (typeof window !== 'undefined' && !navigator.onLine) {
    console.log('[Sync] Offline, queueing sale locally:', sale.id);
    await queueSaleOffline(sale);
    return sale;
  }
  try {
    return await pushSaleToSupabase(sale);
  } catch (err: any) {
    if (isDatabaseRejection(err)) {
      throw err;
    }
    console.error('[Sync] Failed to push to Supabase, queueing locally:', err);
    await queueSaleOffline(sale);
    return sale;
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
        const { error } = await (supabase as any).from(mut.table).insert(mut.payload).select();
        if (error) throw error;
      } else if (mut.operation === 'UPDATE' && mut.matchKey) {
        const { error } = await (supabase as any).from(mut.table).update(mut.payload).eq(mut.matchKey, mut.matchValue).select();
        if (error) throw error;
      } else if (mut.operation === 'DELETE' && mut.matchKey) {
        const { error } = await (supabase as any).from(mut.table).delete().eq(mut.matchKey, mut.matchValue).select();
        if (error) throw error;
      }
      await idbRetry(() => db.delete('generic_mutations', mut.id));
    } catch (err: any) {
      console.error(`Failed to sync mutation on ${mut.table}:`, err);
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
      const result: any = await withTimeout((supabase as any).from(table).insert(payload));
      const { error } = result;
      if (error) throw error;
    } else if (operation === 'UPDATE' && matchKey) {
      const result: any = await withTimeout((supabase as any).from(table).update(payload).eq(matchKey, matchValue));
      const { error } = result;
      if (error) throw error;
    } else if (operation === 'DELETE' && matchKey) {
      const result: any = await withTimeout((supabase as any).from(table).delete().eq(matchKey, matchValue));
      const { error } = result;
      if (error) throw error;
    }
  } catch (err: any) {
    // Check if it's an actual Supabase/Postgres error (e.g., RLS, validation) vs a network error
    if (err && err.code) {
      console.error(`[Sync] API/DB Error on ${operation} for ${table}:`, err);
      throw err; // Do not queue locally if the database rejected it for logic/permission reasons
    }
    console.warn(`[Sync] Mutation ${operation} on ${table} failed online (network issue?), queueing locally:`, err);
    await queueMutationOffline(table, operation, payload, matchKey, matchValue);
  }
}

