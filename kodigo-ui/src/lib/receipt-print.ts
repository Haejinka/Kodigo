import type { ReceiptLayout } from './receipt-markup';

let printInProgress = false;
let activePrintPromise: Promise<void> | null = null;

export function getReceiptPrintFrameHeight(layout: ReceiptLayout, contentHeightPx: number): string {
  if (layout !== 'thermal') return '297mm';
  return `${Math.max(1, Math.ceil(Number.isFinite(contentHeightPx) ? contentHeightPx : 1))}px`;
}

export function getReceiptPrintPageRule(layout: ReceiptLayout, contentHeightPx: number): string {
  if (layout !== 'thermal') return '@page { size: A4; margin: 12mm; }';
  const heightMm = Math.max(1, Number.isFinite(contentHeightPx) ? contentHeightPx * 25.4 / 96 : 1);
  return `@page { size: 58mm ${heightMm.toFixed(2)}mm; margin: 0; }`;
}

/** Prints one rendered receipt document through the browser's native print flow. */
export function printReceiptHtml(html: string, layout: ReceiptLayout = 'thermal'): Promise<void> {
  if (printInProgress) return activePrintPromise ?? Promise.resolve();
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return Promise.reject(new Error('Receipt printing is only available in a browser.'));
  }

  printInProgress = true;
  let frame: HTMLIFrameElement | null = null;
  let fallbackCleanup: number | null = null;

  const cleanup = () => {
    if (fallbackCleanup !== null) window.clearTimeout(fallbackCleanup);
    frame?.remove();
    frame = null;
    printInProgress = false;
    activePrintPromise = null;
  };

  const currentPromise = new Promise<void>((resolve, reject) => {
    try {
      document.getElementById('receipt-print-frame')?.remove();
      frame = document.createElement('iframe');
      frame.id = 'receipt-print-frame';
      frame.title = 'Receipt print';
      frame.style.position = 'fixed';
      frame.style.left = '-10000px';
      frame.style.top = '0';
      frame.style.width = layout === 'thermal' ? '58mm' : '210mm';
      frame.style.height = '1px';
      frame.style.border = '0';
      frame.style.opacity = '0';
      frame.style.pointerEvents = 'none';
      frame.setAttribute('aria-hidden', 'true');

      const printFrame = frame;
      let requested = false;
      frame.onload = () => {
        if (requested) return;
        const frameWindow = printFrame.contentWindow;
        const frameDocument = frameWindow?.document;
        const receipt = frameDocument?.querySelector<HTMLElement>('.receipt');
        if (!frameWindow || !frameDocument || !receipt) {
          cleanup();
          reject(new Error('Unable to prepare the receipt for printing.'));
          return;
        }

        requested = true;
        const contentHeight = Math.max(
          receipt.scrollHeight,
          Math.ceil(receipt.getBoundingClientRect().height),
        );
        printFrame.style.height = getReceiptPrintFrameHeight(layout, contentHeight);
        if (layout === 'thermal') {
          const pageSizeStyle = frameDocument.getElementById('receipt-print-page-size');
          if (!pageSizeStyle) {
            cleanup();
            reject(new Error('Unable to set the thermal receipt paper size.'));
            return;
          }
          pageSizeStyle.textContent = getReceiptPrintPageRule(layout, contentHeight);
        }
        try {
          frameWindow.focus();
          frameWindow.addEventListener('afterprint', cleanup, { once: true });
          fallbackCleanup = window.setTimeout(cleanup, 60_000);
          frameWindow.print();
          resolve();
        } catch (error) {
          cleanup();
          reject(error instanceof Error ? error : new Error('The browser rejected the print request.'));
        }
      };

      frame.srcdoc = html;
      document.body.appendChild(frame);
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : new Error('Unable to prepare the receipt for printing.'));
    }
  });

  activePrintPromise = currentPromise;
  return currentPromise;
}
