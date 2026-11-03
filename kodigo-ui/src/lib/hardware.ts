const LOCAL_PRINT_AGENT_URL = 'http://127.0.0.1:17831';
const LOCAL_PRINT_AGENT_TOKEN_KEY = 'kodigo.local-print-agent.pairing-token';

type PrinterListResponse = { printers: string[] };
type DrawerResponse = { opened: boolean; duplicate?: boolean; message?: string };
export type ReceiptPrintResponse = { submitted: boolean; duplicate?: boolean; message?: string };
type AgentErrorResponse = { error?: string; detail?: string; title?: string };

function getPrinterPreferenceKey(storeId: string) {
  return `kodigo.pos.receipt-printer.${storeId}`;
}

function normalizeAgentError(message: string) {
  return message || 'The local print agent returned an unexpected response.';
}

async function requestLocalPrintAgent<T>(path: string, token: string | undefined, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 5000);

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
      throw new Error(normalizeAgentError(result.error || result.detail || result.title || `Print agent request failed (${response.status}).`));
    }
    return result;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('The local print agent did not respond. Check that it is running on this computer.');
    }
    if (error instanceof TypeError) {
      throw new Error('Could not reach Kodigo Print Agent. Start it on this computer and allow Kodigo local network access if your browser asks.');
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

export async function findLocalPrinters(token = getLocalPrintAgentToken()): Promise<string[]> {
  if (!token) throw new Error('Pair this computer with Kodigo Print Agent before finding printers.');
  const result = await requestLocalPrintAgent<PrinterListResponse>('/v1/printers', token);
  return Array.isArray(result.printers) ? result.printers : [];
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
