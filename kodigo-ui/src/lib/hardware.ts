import type { ShoppingListPaperProfile, ShoppingListSnapshotV1 } from '@/types/shopping-lists';

const LOCAL_PRINT_AGENT_URL = 'http://127.0.0.1:17831';
const LOCAL_PRINT_AGENT_TOKEN_KEY = 'kodigo.local-print-agent.pairing-token';

type PrinterListResponse = { printers: string[]; unavailablePrinters?: string[] };
export type PrinterScanResult = { printers: string[]; unavailablePrinters: string[] };
type DrawerResponse = { opened: boolean; duplicate?: boolean; message?: string };
export type ReceiptPrintResponse = { submitted: boolean; duplicate?: boolean; message?: string };
export type ShoppingListPrintResponse = { submitted: boolean; duplicate?: boolean; message?: string };
export interface LocalPrintAgentCapabilities {
  version: string;
  supportedDocuments: string[];
  shoppingListPaperProfiles: ShoppingListPaperProfile[];
  shoppingListMaximumItems: number;
}
type AgentErrorResponse = { error?: string; detail?: string; title?: string };

class PrintAgentRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function isPrinterAccessBlocked(): Promise<boolean> {
  try {
    // Older browsers do not recognize this permission; let fetch prompt normally.
    const permission = await navigator.permissions.query({ name: 'loopback-network' as PermissionName });
    return permission.state === 'denied';
  } catch {
    return false;
  }
}

function getPrinterPreferenceKey(storeId: string) {
  return `kodigo.pos.receipt-printer.${storeId}`;
}

function normalizeAgentError(message: string) {
  return message || 'The local print agent returned an unexpected response.';
}

async function requestLocalPrintAgent<T>(path: string, token: string | undefined, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  // First connection may wait for the user to answer the browser permission prompt.
  const timeoutId = window.setTimeout(() => controller.abort(), path === '/v1/pair' ? 60_000 : 15_000);

  try {
    const response = await fetch(`${LOCAL_PRINT_AGENT_URL}${path}`, {
      ...init,
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors',
      signal: controller.signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });

    const result = await response.json().catch(() => ({})) as T & AgentErrorResponse;
    if (!response.ok) {
      throw new PrintAgentRequestError(normalizeAgentError(result.error || result.detail || result.title || `Print agent request failed (${response.status}).`), response.status);
    }
    return result;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('The local print agent did not respond. Check that it is running on this computer.');
    }
    if (error instanceof TypeError) {
      if (await isPrinterAccessBlocked()) {
        throw new Error('Your browser has blocked access to the printer on this computer. Open the site controls beside the address bar, open Site settings, and allow Apps on this device / Loopback network (or Local network access). Reload Kodigo, then click Connect this computer.');
      }
      throw new Error('Could not reach Kodigo Print Agent. Start it on this computer. In browser Site settings, allow Apps on this device / Loopback network (or Local network access), reload Kodigo, and reconnect.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function getLocalPrintAgentToken() {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(LOCAL_PRINT_AGENT_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function hasLocalPrintAgentToken() {
  return Boolean(getLocalPrintAgentToken());
}

export function saveLocalPrintAgentToken(token: string) {
  const normalizedToken = token.trim();
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(normalizedToken)) {
    throw new Error('Enter the pairing token displayed by Kodigo Print Agent on this computer.');
  }
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_PRINT_AGENT_TOKEN_KEY, normalizedToken);
  } catch {
    throw new Error('Could not save the local print-agent pairing on this computer.');
  }
}

export function clearLocalPrintAgentToken() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LOCAL_PRINT_AGENT_TOKEN_KEY);
  } catch {
    // Pairing is already unavailable if browser storage cannot be cleared.
  }
}

export async function pairLocalPrintAgent() {
  const result = await requestLocalPrintAgent<{ token: string }>('/v1/pair', undefined, {
    method: 'POST',
    body: '{}',
  });
  if (typeof result.token !== 'string') {
    throw new Error('The local print agent returned an invalid pairing response.');
  }
  saveLocalPrintAgentToken(result.token);
  return result.token;
}

export async function findLocalPrinters(token = getLocalPrintAgentToken()): Promise<PrinterScanResult> {
  if (!token) throw new Error('Pair this computer with Kodigo Print Agent before finding printers.');
  const result = await requestLocalPrintAgent<PrinterListResponse>('/v1/printers', token);
  return {
    printers: Array.isArray(result.printers) ? result.printers : [],
    unavailablePrinters: Array.isArray(result.unavailablePrinters) ? result.unavailablePrinters : [],
  };
}

/** Explicit connection action can repair a token replaced by an agent reinstall or another browser. */
export async function connectLocalPrinters(): Promise<PrinterScanResult> {
  const token = getLocalPrintAgentToken();
  if (token) {
    try {
      return await findLocalPrinters(token);
    } catch (error) {
      if (!(error instanceof PrintAgentRequestError) || error.status !== 401) throw error;
      clearLocalPrintAgentToken();
    }
  }
  return findLocalPrinters(await pairLocalPrintAgent());
}

export function getConfiguredDrawerPrinter(storeId: string): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(getPrinterPreferenceKey(storeId)) || '';
  } catch {
    return '';
  }
}

export function saveConfiguredDrawerPrinter(storeId: string, printerName: string) {
  if (typeof window === 'undefined') return;
  try {
    const key = getPrinterPreferenceKey(storeId);
    if (printerName) window.localStorage.setItem(key, printerName);
    else window.localStorage.removeItem(key);
  } catch (error) {
    console.error('Could not save the local drawer printer selection:', error);
    throw new Error('Could not save the printer selection on this computer.');
  }
}

export async function openCashDrawer(printerName: string, saleId: string): Promise<DrawerResponse> {
  const token = getLocalPrintAgentToken();
  if (!token) throw new Error('This computer is not paired with Kodigo Print Agent.');
  if (!printerName) throw new Error('Choose the printer connected to the cash drawer in POS hardware settings.');
  return requestLocalPrintAgent<DrawerResponse>('/v1/drawer/pulse', token, {
    method: 'POST',
    body: JSON.stringify({ printerName, saleId }),
  });
}

export async function testCashDrawer(printerName: string, token = getLocalPrintAgentToken()) {
  if (!token) throw new Error('Pair this computer with Kodigo Print Agent first.');
  if (!printerName) throw new Error('Choose the printer connected to the cash drawer first.');
  return requestLocalPrintAgent<DrawerResponse>('/v1/drawer/test', token, {
    method: 'POST',
    body: JSON.stringify({ printerName }),
  });
}

export async function printThermalReceipt(
  printerName: string,
  saleId: string,
  receipt: unknown,
  reprint = false,
): Promise<ReceiptPrintResponse> {
  const token = getLocalPrintAgentToken();
  if (!token) throw new Error('This computer is not paired with Kodigo Print Agent. Pair it in Settings → POS hardware.');
  if (!printerName) throw new Error('Choose the thermal printer in Settings → POS hardware before printing.');
  return requestLocalPrintAgent<ReceiptPrintResponse>('/v1/receipts/print', token, {
    method: 'POST',
    body: JSON.stringify({ printerName, saleId, reprint, receipt }),
  });
}

export async function getLocalPrintAgentCapabilities(): Promise<LocalPrintAgentCapabilities | null> {
  const token = getLocalPrintAgentToken();
  if (!token) return null;

  try {
    const response = await requestLocalPrintAgent<{
      version?: string;
      supportedDocuments?: unknown;
      paperProfiles?: { shoppingList?: unknown };
      shoppingListMaximumItems?: unknown;
    }>('/v1/capabilities', token);
    return {
      version: response.version || 'unknown',
      supportedDocuments: Array.isArray(response.supportedDocuments)
        ? response.supportedDocuments.filter((value): value is string => typeof value === 'string')
        : [],
      shoppingListPaperProfiles: Array.isArray(response.paperProfiles?.shoppingList)
        ? response.paperProfiles.shoppingList.filter((value): value is ShoppingListPaperProfile => value === '58mm' || value === '80mm')
        : [],
      shoppingListMaximumItems: typeof response.shoppingListMaximumItems === 'number' && Number.isInteger(response.shoppingListMaximumItems)
        ? Math.max(0, response.shoppingListMaximumItems)
        : 0,
    };
  } catch (error) {
    if (error instanceof Error && /Unknown print-agent endpoint|\(404\)/i.test(error.message)) {
      return { version: 'legacy', supportedDocuments: ['receipt'], shoppingListPaperProfiles: [], shoppingListMaximumItems: 0 };
    }
    throw error;
  }
}

export async function hashShoppingListDocument(
  snapshot: ShoppingListSnapshotV1,
  profile: ShoppingListPaperProfile,
  showPrices: boolean,
) {
  if (!globalThis.crypto?.subtle) throw new Error('Secure document hashing is unavailable in this browser.');
  const compactSnapshot = JSON.stringify(snapshot);
  const source = `profile:${profile}\nshow_prices:${showPrices}\n${compactSnapshot}`;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function printShoppingListOnLocalAgent(input: {
  printerName: string;
  snapshot: ShoppingListSnapshotV1;
  profile: ShoppingListPaperProfile;
  attemptId: string;
  reprint: boolean;
  showPrices: boolean;
}): Promise<ShoppingListPrintResponse> {
  const token = getLocalPrintAgentToken();
  if (!token) throw new Error('This computer is not paired with Kodigo Print Agent. Use browser printing or pair it in Settings → POS hardware.');
  if (!input.printerName) throw new Error('Choose the thermal printer in Settings → POS hardware before printing.');
  const documentHash = await hashShoppingListDocument(input.snapshot, input.profile, input.showPrices);

  try {
    return await requestLocalPrintAgent<ShoppingListPrintResponse>('/v1/documents/shopping-list/print', token, {
      method: 'POST',
      body: JSON.stringify({
        printerName: input.printerName,
        document_id: input.snapshot.documentId,
        attempt_id: input.attemptId,
        document_hash: documentHash,
        profile: input.profile,
        reprint: input.reprint,
        show_prices: input.showPrices,
        shopping_list: input.snapshot,
      }),
    });
  } catch (error) {
    if (error instanceof Error && /Unknown print-agent endpoint|\(404\)/i.test(error.message)) {
      throw new Error('This print agent does not support shopping lists yet. Update the agent or use browser printing.');
    }
    throw error;
  }
}
