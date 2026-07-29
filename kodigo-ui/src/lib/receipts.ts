import { jsPDF } from 'jspdf';
import { supabase } from '@/lib/supabase';
import { getStoreLogoUrl } from '@/lib/branding';
import type { ReceiptRecord, ReceiptSnapshot, Sale } from '@/types';

export type ReceiptLayout = 'thermal' | 'standard';
export type ReceiptOutput = 'preview' | 'print' | 'pdf';

const money = (value: unknown) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value ?? 0));

const dateTime = (value: string) =>
  new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Manila',
  }).format(new Date(value));

const escapeHtml = (value: unknown) => String(value ?? '').replace(
  /[&<>"']/g,
  (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] ?? char)
);

export async function fetchReceiptBySaleId(saleId: string): Promise<ReceiptRecord> {
  const { data, error } = await supabase
    .from('receipts')
    .select('id, sale_id, store_id, receipt_number, issued_by, issued_at, payload')
    .eq('sale_id', saleId)
    .single();
  if (error) throw error;
  return {
    id: data.id,
    saleId: data.sale_id,
    storeId: data.store_id,
    receiptNumber: data.receipt_number,
    issuedBy: data.issued_by ?? undefined,
    issuedAt: data.issued_at,
    payload: data.payload as ReceiptSnapshot,
  };
}

export async function recordReceiptOutput(saleId: string, output: ReceiptOutput, reason?: string) {
  const { error } = await supabase.rpc('record_receipt_reprint', {
    p_sale_id: saleId,
    p_output_type: output,
    p_reason: reason ?? null,
  });
  if (error) throw error;
}

export function receiptSnapshotFromSale(sale: Sale, store: ReceiptSnapshot['store']): ReceiptSnapshot {
  return {
    version: 2,
    sale: {
      id: sale.id,
      receipt_number: sale.receiptNumber,
      created_at: sale.createdAt,
      payment_method: sale.paymentMethod,
      payment_reference: sale.paymentReference,
      status: sale.status,
    },
    store,
    cashier: { id: sale.cashierId ?? undefined, name: sale.cashierName },
    customer: {
      name: sale.customerName,
      tin: sale.customerTin,
      address: sale.customerAddress,
    },
    items: sale.items.map((item) => ({
      product_name: item.productName,
      selling_option_label: item.sellingOptionLabel,
      unit_label: item.unitLabel,
      package_size: item.packageSize,
      package_unit: item.packageUnit,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      line_total: item.lineTotal,
    })),
    payment: {
      method: sale.paymentMethod,
      amount_tendered: sale.cashReceived,
      change_amount: sale.change,
      reference_number: sale.paymentReference,
    },
    totals: {
      subtotal: sale.subtotal,
      discount: sale.discount,
      discountType: sale.discountType,
      discountValue: sale.discountValue,
      discountCategory: sale.discountCategory,
      vatableSales: store.vatStatus === 'vat' && sale.discountCategory !== 'senior' && sale.discountCategory !== 'pwd'
        ? Math.max(0, sale.subtotal - sale.discount)
        : 0,
      vatAmount: store.vatStatus === 'vat' && sale.discountCategory !== 'senior' && sale.discountCategory !== 'pwd'
        ? sale.tax
        : 0,
      vatExemptSales: sale.discountCategory === 'senior' || sale.discountCategory === 'pwd'
        ? Math.max(0, sale.subtotal - sale.discount)
        : 0,
      zeroRatedSales: 0,
      nonVatSales: store.vatStatus === 'non_vat' ? Math.max(0, sale.subtotal - sale.discount) : 0,
      total: sale.total,
      amountTendered: sale.cashReceived,
      change: sale.change,
    },
  };
}

export function buildReceiptHtml(snapshot: ReceiptSnapshot, layout: ReceiptLayout = 'thermal'): string {
  const { store, sale, cashier, customer, items, totals, payment } = snapshot;
  const invoiceNumber = sale.receipt_number || sale.id;
  const logoUrl = getStoreLogoUrl(store.logoPath);
  const isVat = store.vatStatus === 'vat';
  const width = layout === 'thermal' ? '80mm' : '190mm';
  const itemRows = items.map((item) => `
    <tr>
      <td>
        <strong>${escapeHtml(item.product_name)}</strong>
        ${item.selling_option_label ? `<div class="muted">${escapeHtml(item.selling_option_label)}</div>` : ''}
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
    <title>${escapeHtml(invoiceNumber)}</title>
    <style>
      @page { size: ${layout === 'thermal' ? '80mm auto' : 'A4'}; margin: ${layout === 'thermal' ? '4mm' : '12mm'}; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #fff; color: #111; font-family: Arial, Helvetica, sans-serif; font-size: ${layout === 'thermal' ? '10px' : '12px'}; }
      .receipt { width: ${width}; max-width: 100%; margin: 0 auto; padding: ${layout === 'thermal' ? '3mm' : '8mm'}; }
      .brand { text-align: center; }
      .logo { display: block; max-width: ${layout === 'thermal' ? '34mm' : '45mm'}; max-height: 24mm; margin: 0 auto 5px; object-fit: contain; }
      h1 { margin: 2px 0; font-size: ${layout === 'thermal' ? '15px' : '22px'}; }
      .doc-label { margin: 10px 0 4px; font-weight: 800; font-size: ${layout === 'thermal' ? '13px' : '18px'}; text-align: center; text-transform: uppercase; }
      .meta, .party { border-top: 1px dashed #777; margin-top: 8px; padding-top: 7px; line-height: 1.45; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th, td { padding: 4px 2px; vertical-align: top; border-bottom: 1px dotted #bbb; }
      th { text-align: left; font-size: .9em; }
      .num { text-align: right; white-space: nowrap; }
      .totals { margin-left: auto; width: ${layout === 'thermal' ? '100%' : '54%'}; }
      .totals td { border: 0; padding: 2px; }
      .grand td { border-top: 1px solid #111; padding-top: 5px; font-size: 1.15em; font-weight: 800; }
      .muted { color: #555; font-size: .9em; }
      .notice { margin-top: 10px; padding: 6px; border: 1px solid #111; text-align: center; font-weight: 800; }
      .footer { margin-top: 10px; border-top: 1px dashed #777; padding-top: 7px; text-align: center; line-height: 1.45; }
      @media print { body { print-color-adjust: exact; } .receipt { box-shadow: none; } }
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
        <div>TIN: ${escapeHtml(store.tin || 'Not configured')} ${store.branchCode ? `• Branch: ${escapeHtml(store.branchCode)}` : ''}</div>
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
      <table>
        <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Amount</th></tr></thead>
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
    </main>
  </body>
  </html>`;
}

export function printReceipt(snapshot: ReceiptSnapshot, layout: ReceiptLayout = 'thermal') {
  const popup = window.open('', '_blank', layout === 'thermal' ? 'width=420,height=720' : 'width=960,height=800');
  if (!popup) throw new Error('Pop-up blocked. Allow pop-ups to print the receipt.');
  popup.document.open();
  popup.document.write(buildReceiptHtml(snapshot, layout));
  popup.document.close();
  popup.addEventListener('load', () => {
    popup.focus();
    popup.print();
  }, { once: true });
}

async function imageAsDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function downloadReceiptPdf(snapshot: ReceiptSnapshot, layout: ReceiptLayout = 'standard') {
  const thermal = layout === 'thermal';
  const configuredInfoLines = [
    snapshot.store.birRegistrationInfo,
    snapshot.store.accreditationInfo,
    snapshot.store.permitInfo,
  ].filter(Boolean).length;
  const thermalHeight = Math.max(
    180,
    145 + snapshot.items.length * 13 + configuredInfoLines * 8
      + (snapshot.customer.name || snapshot.customer.tin || snapshot.customer.address ? 18 : 0),
  );
  const doc = new jsPDF({
    unit: 'mm',
    format: thermal ? [80, thermalHeight] : 'a4',
    orientation: 'portrait',
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = thermal ? 5 : 16;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;
  const ensureSpace = (height: number) => {
    if (y + height <= pageHeight - margin) return;
    doc.addPage();
    y = margin;
  };
  const line = (text: unknown, size = 9, align: 'left' | 'center' | 'right' = 'left', bold = false) => {
    ensureSpace(size * 0.42 + 2.5);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    const x = align === 'center' ? pageWidth / 2 : align === 'right' ? pageWidth - margin : margin;
    doc.text(String(text ?? ''), x, y, { align });
    y += size * 0.42 + 1.2;
  };
  const rule = () => {
    ensureSpace(4);
    doc.setDrawColor(120);
    doc.line(margin, y, pageWidth - margin, y);
    y += 3;
  };
  const twoCol = (label: string, value: string, bold = false) => {
    ensureSpace(bold ? 6 : 5);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 10 : 8);
    doc.text(label, margin, y);
    doc.text(value, pageWidth - margin, y, { align: 'right' });
    y += bold ? 5 : 4;
  };

  const logo = await imageAsDataUrl(getStoreLogoUrl(snapshot.store.logoPath));
  if (logo && !logo.startsWith('data:image/svg')) {
    try {
      const imageFormat = logo.startsWith('data:image/png')
        ? 'PNG'
        : logo.startsWith('data:image/webp')
          ? 'WEBP'
          : 'JPEG';
      doc.addImage(logo, imageFormat, pageWidth / 2 - 12, y, 24, 16, undefined, 'FAST');
      y += 19;
    } catch {
      // Text identity remains available if a browser cannot decode the logo.
    }
  }

  line(snapshot.store.businessName || snapshot.store.name, thermal ? 13 : 17, 'center', true);
  line(snapshot.store.registeredName || snapshot.store.name, 8, 'center');
  for (const addressLine of doc.splitTextToSize(snapshot.store.address || '', contentWidth)) line(addressLine, 8, 'center');
  line(`TIN: ${snapshot.store.tin || 'Not configured'}${snapshot.store.branchCode ? `  Branch: ${snapshot.store.branchCode}` : ''}`, 8, 'center');
  line(snapshot.store.vatStatus === 'vat' ? 'VAT Registered' : 'Non-VAT Registered', 8, 'center');
  line(snapshot.store.documentLabel || 'Sales Invoice', thermal ? 11 : 14, 'center', true);
  rule();
  twoCol('Invoice No.', String(snapshot.sale.receipt_number || snapshot.sale.id));
  twoCol('Date / Time', dateTime(snapshot.sale.created_at));
  twoCol('Cashier', snapshot.cashier.name);
  if (snapshot.store.terminalIdentifier) twoCol('Terminal', snapshot.store.terminalIdentifier);
  rule();
  if (snapshot.customer.name || snapshot.customer.tin || snapshot.customer.address) {
    line('Customer', 8, 'left', true);
    if (snapshot.customer.name) line(snapshot.customer.name, 8);
    if (snapshot.customer.tin) line(`TIN: ${snapshot.customer.tin}`, 8);
    if (snapshot.customer.address) {
      for (const addressLine of doc.splitTextToSize(snapshot.customer.address, contentWidth)) line(addressLine, 8);
    }
    rule();
  }

  for (const item of snapshot.items) {
    const itemName = `${item.product_name}${item.selling_option_label ? ` - ${item.selling_option_label}` : ''}`;
    for (const textLine of doc.splitTextToSize(itemName, contentWidth)) line(textLine, 8, 'left', true);
    twoCol(`${item.quantity} x ${money(item.unit_price)}`, money(item.line_total));
  }
  rule();
  twoCol('Subtotal', money(snapshot.totals.subtotal));
  twoCol('Discount', `-${money(snapshot.totals.discount)}`);
  if (snapshot.store.vatStatus === 'vat') {
    twoCol('VATable Sales', money(snapshot.totals.vatableSales));
    twoCol('VAT Amount', money(snapshot.totals.vatAmount));
    twoCol('VAT-Exempt Sales', money(snapshot.totals.vatExemptSales));
    twoCol('Zero-Rated Sales', money(snapshot.totals.zeroRatedSales));
  } else {
    twoCol('Non-VAT Sales', money(snapshot.totals.nonVatSales));
  }
  twoCol('TOTAL AMOUNT DUE', money(snapshot.totals.total), true);
  twoCol('Payment', String(snapshot.payment.method || snapshot.sale.payment_method || 'cash'));
  twoCol('Tendered', money(snapshot.totals.amountTendered));
  twoCol('Change', money(snapshot.totals.change));
  const reference = snapshot.payment.reference_number || snapshot.sale.payment_reference;
  if (reference) twoCol('Reference', String(reference));
  if (snapshot.store.vatStatus !== 'vat') {
    y += 2;
    for (const textLine of doc.splitTextToSize('THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.', contentWidth)) {
      line(textLine, 8, 'center', true);
    }
  }
  y += 2;
  for (const info of [snapshot.store.birRegistrationInfo, snapshot.store.accreditationInfo, snapshot.store.permitInfo].filter(Boolean)) {
    for (const textLine of doc.splitTextToSize(String(info), contentWidth)) line(textLine, 7, 'center');
  }
  line('Thank you for your purchase.', 8, 'center');

  doc.save(`${String(snapshot.sale.receipt_number || snapshot.sale.id)}.pdf`);
}
