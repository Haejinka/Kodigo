import type {
  CreateShoppingListSnapshotOptions,
  ShoppingListDraftLine,
  ShoppingListSnapshotV1,
} from '../types/shopping-lists';
import { printDocumentHtml } from './document-print';
import { buildShoppingListMarkup, getShoppingListPageRule, getShoppingListWidth } from './shopping-list-markup';
import type { ShoppingListPaperProfile } from '../types/shopping-lists';

const MAX_SHOPPING_LIST_ITEMS = 500;

function finiteNonNegative(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite, non-negative number.`);
  }
  return value;
}

function requiredText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function createDocumentId() {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('Secure random IDs are unavailable in this browser.');
  }
  return globalThis.crypto.randomUUID();
}

/** Freeze one receiving draft as a non-sale document without changing its calculations. */
export function createShoppingListSnapshot(
  input: {
    storeId: string;
    storeName: string;
    items: readonly ShoppingListDraftLine[];
  },
  options: CreateShoppingListSnapshotOptions = {},
): ShoppingListSnapshotV1 {
  const storeId = requiredText(input.storeId, 'Store ID');
  const storeName = requiredText(input.storeName, 'Store name');
  if (input.items.length === 0) throw new Error('Select at least one item for the shopping list.');
  if (input.items.length > MAX_SHOPPING_LIST_ITEMS) {
    throw new Error(`A shopping list cannot contain more than ${MAX_SHOPPING_LIST_ITEMS} items.`);
  }

  const items = input.items.map((item) => {
    const quantity = finiteNonNegative(item.quantity, 'Quantity');
    const subtotal = finiteNonNegative(item.subtotal, 'Subtotal');
    const purchaseUnit = requiredText(item.purchaseUnit, 'Purchase unit');
    const unitPrice = quantity > 0 ? subtotal / quantity : 0;
    return Object.freeze({
      productId: requiredText(item.productId, 'Product ID'),
      productName: requiredText(item.productName, 'Product name'),
      quantity,
      purchaseUnit,
      unitPrice,
      subtotal,
      isEstimated: Boolean(item.isEstimated),
    });
  });

  const createdAt = options.createdAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('Snapshot time must be a valid timestamp.');

  return Object.freeze({
    version: 1 as const,
    documentId: requiredText(options.documentId ?? createDocumentId(), 'Document ID'),
    createdAt,
    storeId,
    storeName,
    items: Object.freeze(items),
    total: items.reduce((sum, item) => sum + item.subtotal, 0),
  });
}

export function buildShoppingListText(snapshot: ShoppingListSnapshotV1) {
  const columns = ['Item', 'Quantity', 'Unit Price', 'Total'] as const;
  const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  const money = (value: number) => new Intl.NumberFormat('en-PH', {
    style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
  const itemRows: [string, string, string, string][] = snapshot.items.map((item) => [
    clean(item.productName),
    `${item.quantity} ${clean(item.purchaseUnit)}`,
    money(item.unitPrice),
    money(item.subtotal),
  ]);
  const totalRow: [string, string, string, string] = ['TOTAL AMOUNT', '', '', money(snapshot.total)];
  const columnWidths = columns.map((column, index) => Math.max(
    column.length,
    ...itemRows.map((row) => row[index].length),
    totalRow[index].length,
  ));
  const renderRow = (row: readonly string[]) => `| ${row.map((cell, index) => cell.padEnd(columnWidths[index] ?? cell.length)).join(' | ')} |`;
  const separator = `+-${columnWidths.map((width) => '-'.repeat(width)).join('-+-')}-+`;
  const displayDate = new Intl.DateTimeFormat('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila',
  }).format(new Date(snapshot.createdAt));

  return [
    `SHOPPING LIST — NOT A SALES RECEIPT — ${displayDate}`,
    '',
    separator,
    renderRow(columns),
    separator,
    ...itemRows.map(renderRow),
    separator,
    renderRow(totalRow),
    separator,
    '',
  ].join('\n');
}

export function downloadShoppingListText(snapshot: ShoppingListSnapshotV1) {
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Manila',
  }).formatToParts(new Date(snapshot.createdAt));
  const dateValues = Object.fromEntries(dateParts.map(({ type, value }) => [type, value]));
  const fileDate = `${dateValues.year}-${dateValues.month}-${dateValues.day}`;
  const url = URL.createObjectURL(new Blob([`\uFEFF${buildShoppingListText(snapshot)}`], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `Shopping-List-${fileDate}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function printShoppingList(
  snapshot: ShoppingListSnapshotV1,
  profile: ShoppingListPaperProfile = '58mm',
  options: { showPrices?: boolean } = {},
) {
  return printDocumentHtml(buildShoppingListMarkup(snapshot, profile, options), {
    frameId: 'shopping-list-print-frame',
    frameTitle: 'Shopping list print',
    contentSelector: '.shopping-list',
    frameWidth: getShoppingListWidth(profile),
    getFrameHeight: (height) => `${Math.max(1, Math.ceil(Number.isFinite(height) ? height : 1))}px`,
    pageSizeStyleId: 'shopping-list-print-page-size',
    getPageRule: (height: number) => getShoppingListPageRule(profile, height),
    missingPageStyleMessage: 'Unable to set the shopping-list paper size.',
    preparationErrorMessage: 'Unable to prepare the shopping list for printing.',
  });
}
