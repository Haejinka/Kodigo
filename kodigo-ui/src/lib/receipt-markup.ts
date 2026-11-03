import type { ReceiptSnapshot } from '@/types';

export type ReceiptLayout = 'thermal' | 'standard';

export const money = (value: unknown) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value ?? 0));

export const quantityWithUnit = (value: unknown, unitLabel: unknown) => {
  const quantity = Number(value ?? 0);
  const unit = String(unitLabel || 'unit').trim();
  if (quantity === 1) return `${value} ${unit}`;
  const plural = /(?:s|x|z|ch|sh)$/i.test(unit)
    ? `${unit}es`
    : /[^aeiou]y$/i.test(unit)
      ? `${unit.slice(0, -1)}ies`
      : `${unit}s`;
  return `${value} ${plural}`;
};

export const dateTime = (value: string) =>
  new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Manila',
  }).format(new Date(value));

const THERMAL_FEED_SPACE_MM = 9;

const escapeHtml = (value: unknown) => String(value ?? '').replace(
  /[&<>"']/g,
  (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] ?? char)
);

export function buildReceiptMarkup(
  snapshot: ReceiptSnapshot,
  layout: ReceiptLayout = 'thermal',
  logoUrl = '',
): string {
  const { store, sale, cashier, customer, items, totals, payment } = snapshot;
  const invoiceNumber = sale.receipt_number || sale.id;
  const isVat = store.vatStatus === 'vat';
  const isThermal = layout === 'thermal';
  const width = isThermal ? '48mm' : '190mm';
  const itemRows = items.map((item) => isThermal ? `
    <tr class="thermal-item">
      <td colspan="3">
        <strong>${escapeHtml(item.product_name)}</strong>
        ${item.selling_option_label ? `<div class="muted">${escapeHtml(item.selling_option_label)}</div>` : ''}
        ${item.base_unit_quantity ? `<div class="muted">${escapeHtml(quantityWithUnit(item.base_unit_quantity, item.base_unit_label || item.unit_label))}</div>` : ''}
        ${Number(item.item_discount_amount) > 0 ? `<div class="muted">Item discount: -${money(item.item_discount_amount)}</div>` : ''}
      </td>
    </tr>
    <tr class="thermal-line">
      <td>${escapeHtml(item.quantity)} x ${money(item.unit_price)}</td>
      <td></td>
      <td class="num">${money(item.line_total)}</td>
    </tr>
  ` : `
    <tr>
      <td>
        <strong>${escapeHtml(item.product_name)}</strong>
        ${item.selling_option_label ? `<div class="muted">${escapeHtml(item.selling_option_label)}</div>` : ''}
        ${item.base_unit_quantity ? `<div class="muted">${escapeHtml(quantityWithUnit(item.base_unit_quantity, item.base_unit_label || item.unit_label))}</div>` : ''}
        ${Number(item.item_discount_amount) > 0 ? `<div class="muted">Item discount: -${money(item.item_discount_amount)}</div>` : ''}
      </td>
      <td class="num">${escapeHtml(item.quantity)}</td>
      <td class="num">${money(item.unit_price)}</td>
      <td class="num">${money(item.line_total)}</td>
    </tr>
  `).join('');

  const optionalCustomer = customer?.name || customer?.tin || customer?.address
    ? `<section class="party"><strong>Customer</strong>
        ${customer.name ? `<div>${escapeHtml(customer.name)}</div>` : ''}
        ${customer.tin ? `<div>TIN: ${escapeHtml(customer.tin)}</div>` : ''}
        ${customer.address ? `<div>${escapeHtml(customer.address)}</div>` : ''}
      </section>`
    : '';

  return `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(invoiceNumber)}</title>
    <style id="receipt-print-page-size">@page { size: ${isThermal ? '58mm 100mm' : 'A4'}; margin: ${isThermal ? '0' : '12mm'}; }</style>
    <style>
      * { box-sizing: border-box; }
      html, body { width: ${isThermal ? '58mm' : 'auto'}; height: auto; min-height: 0; margin: 0; padding: 0; background: #fff; color: #111; }
      body { font-family: ${isThermal ? "'Arial', 'Helvetica', sans-serif" : 'Arial, Helvetica, sans-serif'}; font-size: ${isThermal ? '10px' : '12px'}; font-weight: ${isThermal ? '600' : '400'}; line-height: ${isThermal ? '1.28' : 'normal'}; }
      .receipt { width: ${width}; max-width: 100%; margin: 0 auto; padding: ${isThermal ? '2mm 1.5mm 0' : '8mm'}; }
      .brand { text-align: center; }
      .logo { display: ${isThermal ? 'none' : 'block'}; max-width: ${isThermal ? '0' : '45mm'}; max-height: ${isThermal ? '0' : '24mm'}; margin: 0 auto 5px; object-fit: contain; }
      h1 { margin: 2px 0; font-size: ${isThermal ? '12px' : '22px'}; font-weight: 800; overflow-wrap: anywhere; }
      .doc-label { margin: 7px 0 4px; font-weight: 800; font-size: ${isThermal ? '11px' : '18px'}; text-align: center; text-transform: uppercase; }
      .meta, .party { border-top: 1px dashed #777; margin-top: 8px; padding-top: 7px; line-height: 1.45; }
      .grid { display: grid; grid-template-columns: ${isThermal ? 'auto minmax(0, 1fr)' : '1fr 1fr'}; gap: 2px ${isThermal ? '6px' : '12px'}; }
      .meta .num { white-space: normal; overflow-wrap: anywhere; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      .items { ${isThermal ? 'table-layout: fixed;' : ''} }
      .items col:first-child { width: ${isThermal ? '62%' : 'auto'}; }
      .items col:nth-child(2) { width: ${isThermal ? '0%' : 'auto'}; }
      .items col:last-child { width: ${isThermal ? '38%' : 'auto'}; }
      th, td { padding: ${isThermal ? '3px 1px' : '4px 2px'}; vertical-align: top; border-bottom: 1px dotted ${isThermal ? '#222' : '#bbb'}; }
      .items td:first-child { overflow-wrap: anywhere; word-break: normal; }
      th { text-align: left; font-size: .95em; font-weight: 800; }
      .num { text-align: right; white-space: nowrap; }
      .totals { margin-left: auto; width: ${isThermal ? '100%' : '54%'}; ${isThermal ? 'table-layout: fixed;' : ''} }
      .totals td { border: 0; padding: 2px; }
      .totals td:first-child { width: 58%; overflow-wrap: anywhere; }
      .totals td:last-child { width: 42%; }
      .grand td { border-top: 1px solid #111; padding-top: 5px; font-size: 1.15em; font-weight: 800; }
      .muted { color: ${isThermal ? '#111' : '#555'}; font-size: .95em; font-weight: ${isThermal ? '600' : '400'}; }
      .notice { margin-top: 10px; padding: 6px; border: 1px solid #111; text-align: center; font-weight: 800; }
      .footer { margin-top: 10px; border-top: 1px dashed #777; padding-top: 7px; text-align: center; line-height: 1.45; }
      .feed-space { display: ${isThermal ? 'block' : 'none'}; height: ${THERMAL_FEED_SPACE_MM}mm; }
      .thermal-item td { border-bottom: 0; padding-bottom: 0; }
      .thermal-line td { padding-top: 1px; }
      @media print {
        html, body { height: auto; min-height: 0; }
        body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        .receipt { box-shadow: none; ${isThermal ? 'break-inside: avoid;' : ''} }
        ${isThermal ? 'tr, section, footer { break-inside: avoid; }' : ''}
      }
    </style>
  </head>
  <body>
    <main class="receipt">
      <header class="brand">
        <img class="logo" src="${escapeHtml(logoUrl)}" alt="" />
        <h1>${escapeHtml(store.businessName || store.name)}</h1>
        <div>${escapeHtml(store.registeredName || store.name)}</div>
        <div>${escapeHtml(store.address)}</div>
        ${store.phone ? `<div>${escapeHtml(store.phone)}</div>` : ''}
        <div>TIN: ${escapeHtml(store.tin || 'Not configured')} ${store.branchCode ? `- Branch: ${escapeHtml(store.branchCode)}` : ''}</div>
        <div>${isVat ? 'VAT Registered' : 'Non-VAT Registered'}</div>
      </header>
      <div class="doc-label">${escapeHtml(store.documentLabel || 'Sales Invoice')}</div>
      <section class="meta grid">
        <div>Invoice No.</div><div class="num">${escapeHtml(invoiceNumber)}</div>
        <div>Date / Time</div><div class="num">${escapeHtml(dateTime(sale.created_at))}</div>
        <div>Cashier</div><div class="num">${escapeHtml(cashier?.name || 'Unknown')}</div>
        ${(sale.status && sale.status !== 'completed') ? `<div>Status</div><div class="num">${escapeHtml(String(sale.status).toUpperCase())}</div>` : ''}
        ${(store.terminalIdentifier) ? `<div>Terminal</div><div class="num">${escapeHtml(store.terminalIdentifier)}</div>` : ''}
      </section>
      ${optionalCustomer}
      <table class="items">
        ${isThermal ? '<colgroup><col /><col /><col /></colgroup>' : ''}
        <thead>${isThermal
          ? '<tr><th>Item</th><th></th><th class="num">Amount</th></tr>'
          : '<tr><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Amount</th></tr>'}</thead>
        <tbody>${itemRows}</tbody>
      </table>
      <table class="totals">
        <tr><td>Subtotal</td><td class="num">${money(totals.subtotal)}</td></tr>
        <tr><td>Discount${totals.discountCategory && totals.discountCategory !== 'regular' ? ` (${escapeHtml(totals.discountCategory.toUpperCase())})` : ''}</td><td class="num">-${money(totals.discount)}</td></tr>
        ${isVat ? `
          <tr><td>VATable Sales</td><td class="num">${money(totals.vatableSales)}</td></tr>
          <tr><td>VAT Amount</td><td class="num">${money(totals.vatAmount)}</td></tr>
          <tr><td>VAT-Exempt Sales</td><td class="num">${money(totals.vatExemptSales)}</td></tr>
          <tr><td>Zero-Rated Sales</td><td class="num">${money(totals.zeroRatedSales)}</td></tr>
        ` : `<tr><td>Non-VAT Sales</td><td class="num">${money(totals.nonVatSales)}</td></tr>`}
        <tr class="grand"><td>Total Amount Due</td><td class="num">${money(totals.total)}</td></tr>
        <tr><td>Payment Method</td><td class="num">${escapeHtml(payment.method || sale.payment_method || 'cash')}</td></tr>
        <tr><td>Amount Tendered</td><td class="num">${money(totals.amountTendered)}</td></tr>
        <tr><td>Change</td><td class="num">${money(totals.change)}</td></tr>
        ${(payment.reference_number || sale.payment_reference) ? `<tr><td>Reference No.</td><td class="num">${escapeHtml(payment.reference_number || sale.payment_reference)}</td></tr>` : ''}
      </table>
      ${!isVat ? '<div class="notice">THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.</div>' : ''}
      <footer class="footer">
        ${store.birRegistrationInfo ? `<div>${escapeHtml(store.birRegistrationInfo)}</div>` : ''}
        ${store.accreditationInfo ? `<div>${escapeHtml(store.accreditationInfo)}</div>` : ''}
        ${store.permitInfo ? `<div>${escapeHtml(store.permitInfo)}</div>` : ''}
        <div>Thank you for your purchase.</div>
      </footer>
      <div class="feed-space" aria-hidden="true"></div>
    </main>
  </body>
  </html>`;
}
