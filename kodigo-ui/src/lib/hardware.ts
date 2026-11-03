export const QZ_TRUST_SETUP_MESSAGE = 'Cash drawer integration is paused until a trusted QZ Tray certificate and server-side signer are configured.';

/** QZ calls stay disabled until the application has a trusted signer. */
export function isQzTraySigningConfigured() {
  return false;
}

function getPrinterPreferenceKey(storeId: string) {
  return `kodigo.pos.receipt-printer.${storeId}`;
}

export async function findLocalReceiptPrinters(): Promise<string[]> {
  throw new Error(QZ_TRUST_SETUP_MESSAGE);
}

export function getConfiguredReceiptPrinter(storeId: string): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(getPrinterPreferenceKey(storeId)) || '';
  } catch {
    return '';
  }
}

export function saveConfiguredReceiptPrinter(storeId: string, printerName: string) {
  if (typeof window === 'undefined') return;
  try {
    const key = getPrinterPreferenceKey(storeId);
    if (printerName) window.localStorage.setItem(key, printerName);
    else window.localStorage.removeItem(key);
  } catch (error) {
    console.error('Could not save the local receipt printer selection:', error);
    throw new Error('Could not save the printer selection on this computer.');
  }
}

/** Sends a drawer pulse only after trusted QZ signing has been implemented. */
export async function openCashDrawer(printerName: string): Promise<boolean> {
  return Boolean(printerName) && isQzTraySigningConfigured();
}
