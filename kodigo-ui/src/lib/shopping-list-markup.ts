import type { ShoppingListPaperProfile, ShoppingListSnapshotV1 } from '../types/shopping-lists';

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
  .replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] ?? char));

const money = (value: number) => new Intl.NumberFormat('en-PH', {
  style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(Number.isFinite(value) ? value : 0);

export function getShoppingListWidth(profile: ShoppingListPaperProfile) {
  return profile === '58mm' ? '58mm' : '80mm';
}

export function getShoppingListPageRule(profile: ShoppingListPaperProfile, contentHeightPx: number) {
  const heightMm = Math.max(1, Number.isFinite(contentHeightPx) ? contentHeightPx * 25.4 / 96 : 1);
  return `@page { size: ${getShoppingListWidth(profile)} ${heightMm.toFixed(2)}mm; margin: 0; }`;
}

export function buildShoppingListMarkup(
  snapshot: ShoppingListSnapshotV1,
  profile: ShoppingListPaperProfile = '58mm',
  options: { showPrices?: boolean } = {},
) {
  const showPrices = options.showPrices !== false;
  const width = getShoppingListWidth(profile);
  const columns = profile === '58mm' ? 32 : 48;
  const date = new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila',
  }).format(new Date(snapshot.createdAt));
  const rows = snapshot.items.map((item) => `
        <tr class="item">
          <td colspan="${showPrices ? 2 : 1}">
            <strong>${escapeHtml(item.productName)}</strong>
            <div class="quantity">${escapeHtml(item.quantity)} ${escapeHtml(item.purchaseUnit)}</div>
            ${showPrices && item.isEstimated ? '<div class="estimated">Estimated cost</div>' : ''}
          </td>
        </tr>
        ${showPrices ? `<tr class="amount"><td>${money(item.unitPrice)} / unit</td><td class="number">${money(item.subtotal)}</td></tr>` : ''}
      `).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Shopping List</title>
  <style id="shopping-list-print-page-size">@page { size: ${width} 100mm; margin: 0; }</style>
  <style>
    * { box-sizing: border-box; }
    html, body { width: ${width}; height: auto; min-height: 0; margin: 0; padding: 0; background: #fff; color: #111; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: ${profile === '58mm' ? '9px' : '10px'}; line-height: 1.35; }
    .shopping-list { width: ${width}; max-width: 100%; margin: 0 auto; padding: 3mm; overflow-wrap: anywhere; word-break: normal; }
    header { text-align: center; border-bottom: 1px dashed #333; padding-bottom: 2mm; }
    h1 { margin: 0 0 2mm; font-size: ${profile === '58mm' ? '12px' : '14px'}; line-height: 1.2; }
    .nonfiscal { margin: 0 0 1mm; font-size: ${profile === '58mm' ? '8px' : '9px'}; font-weight: 800; }
    .store, .date { overflow-wrap: anywhere; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 2mm; }
    td { padding: 1.2mm 0; vertical-align: top; border-bottom: 1px dotted #888; overflow-wrap: anywhere; }
    .item td { border-bottom: 0; padding-bottom: 0; }
    .quantity { margin-top: .5mm; }
    .estimated { font-size: 8px; font-style: italic; }
    .amount td { padding-top: 0; }
    .number { text-align: right; white-space: nowrap; }
    .total { display: flex; justify-content: space-between; gap: 2mm; margin-top: 2mm; padding-top: 2mm; border-top: 1px solid #111; font-weight: 800; }
    .footer { margin-top: 3mm; border-top: 1px dashed #333; padding-top: 2mm; text-align: center; font-size: 8px; }
    @media print { html, body { height: auto; min-height: 0; } body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } .shopping-list { break-inside: avoid; } }
  </style>
</head>
<body>
  <main class="shopping-list" data-columns="${columns}">
    <header>
      <p class="nonfiscal">SHOPPING LIST — NOT A SALES RECEIPT</p>
      <h1>Shopping List</h1>
      <div class="store">${escapeHtml(snapshot.storeName)}</div>
      <div class="date">${escapeHtml(date)}</div>
    </header>
    <table aria-label="Shopping list items"><tbody>${rows}</tbody></table>
    ${showPrices ? `<div class="total"><span>Estimated / entered total</span><span>${money(snapshot.total)}</span></div>` : ''}
    <footer class="footer">For purchasing reference only. No sale or inventory change was recorded.</footer>
  </main>
</body>
</html>`;
}
