import type { ReceiptLayout } from './receipt-markup';
import { printDocumentHtml } from './document-print';

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
  return printDocumentHtml(html, {
    frameId: 'receipt-print-frame',
    frameTitle: 'Receipt print',
    contentSelector: '.receipt',
    frameWidth: layout === 'thermal' ? '58mm' : '210mm',
    getFrameHeight: (contentHeight) => getReceiptPrintFrameHeight(layout, contentHeight),
    ...(layout === 'thermal' ? {
      pageSizeStyleId: 'receipt-print-page-size',
      getPageRule: (contentHeight: number) => getReceiptPrintPageRule(layout, contentHeight),
      missingPageStyleMessage: 'Unable to set the thermal receipt paper size.',
    } : {}),
    preparationErrorMessage: 'Unable to prepare the receipt for printing.',
  });
}
