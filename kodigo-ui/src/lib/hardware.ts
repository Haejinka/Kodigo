import qz from 'qz-tray';

interface QzTrayApi {
  websocket: {
    connect: () => Promise<void>;
    isActive: () => boolean;
  };
  printers: {
    find: () => Promise<string[] | string>;
  };
  configs: {
    create: (printerName: string, options?: Record<string, unknown>) => unknown;
  };
  print: (config: unknown, data: Array<Record<string, unknown>>) => Promise<unknown>;
}

const printBridge = qz as unknown as QzTrayApi;
let connectingToPrintBridge: Promise<void> | null = null;

function getPrinterPreferenceKey(storeId: string) {
  return `kodigo.pos.receipt-printer.${storeId}`;
}

async function connectToPrintBridge() {
  if (printBridge.websocket.isActive()) return;
  if (!connectingToPrintBridge) {
    connectingToPrintBridge = printBridge.websocket.connect().finally(() => {
      connectingToPrintBridge = null;
    });
  }
  await connectingToPrintBridge;
}

export async function findLocalReceiptPrinters(): Promise<string[]> {
  await connectToPrintBridge();
  const result = await printBridge.printers.find();
  const printers = Array.isArray(result) ? result : [result];
  return printers.filter((printer) => typeof printer === 'string' && printer.length > 0).sort((a, b) => a.localeCompare(b));
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

/** Sends the ESC/POS drawer pulse through the selected printer using QZ Tray. */
export async function openCashDrawer(printerName: string): Promise<boolean> {
  if (!printerName) return false;

  try {
    await connectToPrintBridge();
    const config = printBridge.configs.create(printerName, { jobName: 'Open cash drawer' });
    await printBridge.print(config, [{
      type: 'raw',
      format: 'command',
      flavor: 'hex',
      data: '1B700019FA',
      options: { language: 'ESCPOS' },
    }]);
    return true;
  } catch (error) {
    console.error('Failed to send the drawer pulse through the receipt printer:', error);
    return false;
  }
}
