import { openDB } from 'idb';
import type { Sale } from '@/types';

// Own small IndexedDB so it cannot clash with the versioned legacy outbox.
// shortcut: plain (unencrypted) local queue; upgrade to the leased encrypted outbox (T50-T53) when offline escrow is enabled.
export interface QueuedSale {
  sale: Sale;
  customerId: string | null;
  userId: string;
  queuedAt: string;
  error?: string;
}

const dbp = () => openDB('kodigo-offline-sales', 1, {
  upgrade(db) { db.createObjectStore('sales', { keyPath: 'sale.id' }); },
});

export async function queueOfflineSale(sale: Sale, customerId: string | null): Promise<void> {
  const db = await dbp();
  await db.put('sales', { sale, customerId, userId: sale.cashierId ?? '', queuedAt: new Date().toISOString() } satisfies QueuedSale);
  window.dispatchEvent(new Event('kodigo-offline-queue'));
}

export async function listOfflineSales(userId?: string): Promise<QueuedSale[]> {
  const all = (await (await dbp()).getAll('sales')) as QueuedSale[];
  return userId ? all.filter((q) => q.userId === userId) : all;
}

export async function removeOfflineSale(id: string): Promise<void> {
  await (await dbp()).delete('sales', id);
  window.dispatchEvent(new Event('kodigo-offline-queue'));
}

export async function markOfflineSaleError(q: QueuedSale, error: string): Promise<void> {
  await (await dbp()).put('sales', { ...q, error });
  window.dispatchEvent(new Event('kodigo-offline-queue'));
}
