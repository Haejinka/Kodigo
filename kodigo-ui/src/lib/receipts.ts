import { jsPDF } from 'jspdf';
import { supabase } from '@/lib/supabase';
import { getStoreLogoUrl } from '@/lib/branding';
import { buildReceiptMarkup, dateTime, money, quantityWithUnit } from '@/lib/receipt-markup';
import type { ReceiptLayout } from '@/lib/receipt-markup';
import { printReceiptHtml } from '@/lib/receipt-print';
import { getConfiguredDrawerPrinter, printThermalReceipt } from '@/lib/hardware';
import type { ReceiptRecord, ReceiptSnapshot, Sale } from '@/types';

export type { ReceiptLayout } from '@/lib/receipt-markup';
export type ReceiptOutput = 'preview' | 'print' | 'pdf';

const THERMAL_FEED_SPACE_MM = 9;

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
      base_unit_label: item.baseUnitLabel,
      package_size: item.packageSize,
      package_unit: item.packageUnit,
      purchase_mode: item.purchaseMode,
      bulk_option_id: item.bulkOptionId,
      bulk_option_label: item.bulkOptionLabel,
      bulk_quantity: item.bulkQuantity,
      units_per_package: item.unitsPerPackage,
      base_unit_quantity: item.baseUnitQuantity,
      regular_unit_price: item.regularUnitPrice,
      regular_value: item.regularValue,
      bulk_discount_type: item.bulkDiscountType,
      bulk_discount_value: item.bulkDiscountValue,
      bulk_discount_amount: item.bulkDiscountAmount,
      item_discount_amount: item.itemDiscountAmount,
      final_selling_price: item.finalSellingPrice,
      cost_per_base_unit: item.costPerBaseUnit,
      cogs: item.cogs,
      gross_profit: item.grossProfit,
      gross_margin: item.grossMargin,
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
        ? Math.max(0, sale.subtotal - sale.discount - sale.tax)
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
  return buildReceiptMarkup(snapshot, layout, getStoreLogoUrl(snapshot.store.logoPath));
}

export async function printReceipt(
  snapshot: ReceiptSnapshot,
  layout: ReceiptLayout = 'thermal',
  options: { reprint?: boolean } = {},
) {
  if (layout === 'standard') {
    await printReceiptHtml(buildReceiptHtml(snapshot, layout), layout);
    return {
      submitted: true as const,
      duplicate: false,
      message: 'Browser print request submitted.',
      method: 'browser' as const,
    };
  }

  const printerName = getConfiguredDrawerPrinter(snapshot.store.id);
  const result = await printThermalReceipt(printerName, snapshot.sale.id, snapshot, options.reprint === true);
  return { ...result, method: 'local-agent' as const };
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
    145 + THERMAL_FEED_SPACE_MM + snapshot.items.length * 13 + configuredInfoLines * 8
      + (snapshot.customer.name || snapshot.customer.tin || snapshot.customer.address ? 18 : 0),
  );
  const doc = new jsPDF({
    unit: 'mm',
    format: thermal ? [58, thermalHeight] : 'a4',
    orientation: 'portrait',
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = thermal ? 3 : 16;
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

  line(snapshot.store.businessName || snapshot.store.name, thermal ? 11 : 17, 'center', true);
  line(snapshot.store.registeredName || snapshot.store.name, 8, 'center');
  for (const addressLine of doc.splitTextToSize(snapshot.store.address || '', contentWidth)) line(addressLine, 8, 'center');
  line(`TIN: ${snapshot.store.tin || 'Not configured'}${snapshot.store.branchCode ? `  Branch: ${snapshot.store.branchCode}` : ''}`, 8, 'center');
  line(snapshot.store.vatStatus === 'vat' ? 'VAT Registered' : 'Non-VAT Registered', 8, 'center');
  line(snapshot.store.documentLabel || 'Sales Invoice', thermal ? 10 : 14, 'center', true);
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
    if (item.base_unit_quantity) line(`${quantityWithUnit(item.base_unit_quantity, item.base_unit_label || item.unit_label)} deducted`, 7);
    if (Number(item.item_discount_amount) > 0) line(`Item discount: -${money(item.item_discount_amount)}`, 7);
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
  if (thermal) y += THERMAL_FEED_SPACE_MM;

  doc.save(`${String(snapshot.sale.receipt_number || snapshot.sale.id)}.pdf`);
}
