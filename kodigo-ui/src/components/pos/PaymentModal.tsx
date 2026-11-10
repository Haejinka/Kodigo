import { useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { CheckCircle, X, User, CreditCard, Smartphone, Banknote, Landmark, Eye, Printer } from 'lucide-react';
import { formatCurrency, formatDateTime, formatErrorMessage } from '@/lib/utils';
import { getConfiguredDrawerPrinter, hasLocalPrintAgentToken, openCashDrawer } from '@/lib/hardware';
import { getPosHardwareActions } from '@/lib/reporting-calculations';
import { Button } from '@/components/shared/Button';
import { useToast } from '@/components/shared/Toast';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { useProductStore } from '@/stores/productStore';
import { processSale, SaleConfirmationUncertainError } from '@/lib/offline-sync';
import {
  getSellingOptionLabel,
  getAvailableSellingUnits,
  getOptionInventoryMultiplier,
  getOptionPurchaseCost,
  getOptionSellingPrice,
  isLegacySellingOption,
  isBulkSellingOption,
} from '@/types';
import type { PaymentMethod, ReceiptSnapshot, Sale } from '@/types';
import { fetchReceiptBySaleId, printReceipt, receiptSnapshotFromSale } from '@/lib/receipts';
import { ReceiptPreviewModal } from '@/components/receipts/ReceiptPreviewModal';

interface PaymentModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'payment' | 'confirmed';
const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const paymentMethods: Array<{ value: PaymentMethod; label: string; icon: ComponentType<{ className?: string }> }> = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'gcash', label: 'GCash', icon: Smartphone },
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'bank_transfer', label: 'Bank', icon: Landmark },
];

export function PaymentModal({ open, onClose, onSuccess }: PaymentModalProps) {
  const { toast } = useToast();
  const {
    items,
    subtotal,
    discountAmount,
    taxRate,
    vatStatus,
    setItemDiscount,
    clearCart,
  } = useCartStore();
  const { user, profile, stores } = useAuthStore();

  const [cashInput, setCashInput] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [step, setStep] = useState<Step>('payment');
  const [processing, setProcessing] = useState(false);
  const processingRef = useRef(false);
  const completedSaleIdRef = useRef<string | null>(null);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);
  const [uncertainSale, setUncertainSale] = useState<Sale | null>(null);
  const [receiptSnapshot, setReceiptSnapshot] = useState<ReceiptSnapshot | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [receiptPrintStatus, setReceiptPrintStatus] = useState<{ tone: 'warning'; message: string } | null>(null);
  const [cashDrawerStatus, setCashDrawerStatus] = useState<{ tone: 'warning'; message: string } | null>(null);

  const orderSubtotal = subtotal();
  const orderDiscount = discountAmount();
  const orderTaxRate = taxRate();
  const isVatRegistered = vatStatus() === 'vat';
  const finalSalePrice = roundCurrency(Math.max(0, orderSubtotal - orderDiscount));
  const orderTax = isVatRegistered && orderTaxRate > 0
    ? roundCurrency(finalSalePrice * orderTaxRate / (100 + orderTaxRate))
    : 0;
  const orderTotal = roundCurrency(finalSalePrice);

  const cashAmount = parseFloat(cashInput) || 0;
  const isCash = paymentMethod === 'cash';
  const tendered = isCash ? cashAmount : orderTotal;
  const change = isCash ? Math.max(0, cashAmount - orderTotal) : 0;
  const stockIssue = items.find((i) => i.quantity > getAvailableSellingUnits(i.product, i.sellingOption));
  const canConfirm = items.length > 0 && (isCash ? cashAmount >= orderTotal : true) && (!stockIssue || Boolean(uncertainSale)) && !processing;

  const quickAmounts = [
    Math.ceil(orderTotal / 50) * 50,
    Math.ceil(orderTotal / 100) * 100,
    Math.ceil(orderTotal / 500) * 500,
  ].filter((v, i, arr) => arr.indexOf(v) === i && v >= orderTotal);

  const handleConfirm = async () => {
    if (!canConfirm || processingRef.current) return;
    processingRef.current = true;
    setProcessing(true);

    const storeId = useAuthStore.getState().activeStoreId;
    if (!storeId || storeId === 'all') {
      toast('error', 'Select a specific store before processing the sale.');
      setProcessing(false);
      processingRef.current = false;
      return;
    }

    const currentStockIssue = items.find((i) => i.quantity > getAvailableSellingUnits(i.product, i.sellingOption));
    if (currentStockIssue && !uncertainSale) {
      toast('error', `${currentStockIssue.product.name} - ${getSellingOptionLabel(currentStockIssue.sellingOption)} only has ${getAvailableSellingUnits(currentStockIssue.product, currentStockIssue.sellingOption)} in stock.`);
      setProcessing(false);
      processingRef.current = false;
      return;
    }

    const sale: Sale = uncertainSale ?? {
      id: crypto.randomUUID(),
      storeId,
      items: items.map((i) => {
        const isBulk = isBulkSellingOption(i.sellingOption);
        const unitsPerPackage = getOptionInventoryMultiplier(i.sellingOption);
        const baseUnitQuantity = i.quantity * unitsPerPackage;
        const regularValue = i.product.sellingPrice * baseUnitQuantity;
        const bulkDiscountAmount = isBulk ? Math.max(0, regularValue - i.lineTotal) : 0;
        const finalSellingPrice = getOptionSellingPrice(i.product, i.sellingOption);
        const costPerBaseUnit = i.product.costPrice;
        const cogs = costPerBaseUnit * baseUnitQuantity;
        const itemDiscountPerUnit = Math.min(getOptionSellingPrice(i.product, i.sellingOption), i.discountPerUnit ?? 0);
        const itemDiscountAmount = roundCurrency(itemDiscountPerUnit * i.quantity);
        const netLineTotal = roundCurrency(i.lineTotal - itemDiscountAmount);
        const grossProfit = netLineTotal - cogs;
        return {
        productId: i.product.id,
        productName: i.product.name,
        categoryName: i.product.categoryName,
        sellingOptionId: isLegacySellingOption(i.sellingOption) ? undefined : i.sellingOption.id,
        sellingOptionLabel: getSellingOptionLabel(i.sellingOption),
        unitLabel: i.sellingOption.unitLabel,
        packageSize: i.sellingOption.quantityValue,
        packageUnit: i.sellingOption.quantityUnit,
        stockSource: 'product',
        purchaseMode: isBulk ? 'bulk' : 'unit',
        bulkOptionId: isBulk ? i.sellingOption.id : undefined,
        bulkOptionLabel: isBulk ? getSellingOptionLabel(i.sellingOption) : undefined,
        bulkQuantity: isBulk ? i.quantity : undefined,
        unitsPerPackage,
        baseUnitQuantity,
        regularUnitPrice: i.product.sellingPrice,
        regularValue,
        bulkDiscountType: isBulk ? i.sellingOption.discountType : undefined,
        bulkDiscountValue: isBulk ? i.sellingOption.discountValue : undefined,
        bulkDiscountAmount,
        itemDiscountPerUnit,
        itemDiscountAmount,
        finalSellingPrice: roundCurrency(finalSellingPrice - itemDiscountPerUnit),
        baseUnitLabel: i.product.unit,
        costPerBaseUnit,
        cogs,
        grossProfit,
        grossMargin: netLineTotal > 0 ? grossProfit / netLineTotal : 0,
        quantity: i.quantity,
        unitPrice: roundCurrency(finalSellingPrice - itemDiscountPerUnit),
        costPrice: getOptionPurchaseCost(i.product, i.sellingOption),
        lineTotal: netLineTotal,
        };
      }),
      subtotal: orderSubtotal,
      tax: orderTax,
      taxRate: orderTaxRate,
      discount: orderDiscount,
      discountType: 'amount',
      discountValue: orderDiscount,
      total: orderTotal,
      cashReceived: tendered,
      change,
      paymentMethod,
      paymentReference: paymentReference.trim() || undefined,
      terminalIdentifier: stores.find((store) => store.id === storeId)?.terminalIdentifier,
      discountCategory: orderDiscount > 0 ? 'other' : 'regular',
      cashierId: user?.id || null,
      cashierName: profile?.name || user?.user_metadata?.name || user?.email || 'Unknown Cashier',
      createdAt: new Date().toISOString(),
    };

    let recordedSale: Sale;
    try {
      recordedSale = await processSale(sale);
    } catch (err) {
      console.error('Failed to record POS sale:', err);
      setUncertainSale(err instanceof SaleConfirmationUncertainError ? sale : null);
      toast('error', formatErrorMessage(err, 'Payment could not be completed. Please review the error and try again.'));
      setProcessing(false);
      processingRef.current = false;
      return;
    }

    // The database commit above is the transaction boundary. Everything below
    // is local UI/peripheral work and must not turn a completed sale into a
    // false failure (or encourage the cashier to charge the customer twice).
    setCompletedSale(recordedSale);
    setUncertainSale(null);
    setReceiptPrintStatus(null);
    setCashDrawerStatus(null);
    completedSaleIdRef.current = recordedSale.id;
    setStep('confirmed');
    setProcessing(false);
    toast('success', 'Payment completed and saved.');

    void (async () => { try {
      useProductStore.setState((state) => ({
        products: state.products.map((product) => {
          const soldLines = items.filter((line) => line.product.id === product.id);
          if (soldLines.length === 0) return product;
          const sharedPieceDelta = soldLines
            .reduce((sum, line) => sum + line.quantity * getOptionInventoryMultiplier(line.sellingOption), 0);
          const sellingOptions = (product.sellingOptions ?? []).map((option) => {
            return { ...option, stockQuantity: Math.floor(Math.max(0, product.currentStock - sharedPieceDelta) / getOptionInventoryMultiplier(option)) };
          });
          return {
            ...product,
            sellingOptions,
            currentStock: Math.max(0, product.currentStock - sharedPieceDelta),
          };
        }),
      }));
      const activeStore = stores.find((store) => store.id === storeId);
      const hardwareActions = getPosHardwareActions(activeStore ?? {}, paymentMethod, hasLocalPrintAgentToken());
      const cashDrawerWasRequested = Boolean(activeStore
        && activeStore.cashDrawerIntegrationEnabled !== false
        && paymentMethod === 'cash');
      if (hardwareActions.openCashDrawer) {
        const printerName = getConfiguredDrawerPrinter(storeId);
        if (!printerName) {
          setCashDrawerStatus({
            tone: 'warning',
            message: 'Sale saved, but this computer has no drawer printer selected. Ask an admin to configure it in Settings → POS hardware.',
          });
        } else {
          void openCashDrawer(printerName, recordedSale.id).then((result) => {
            setCashDrawerStatus(result.opened || result.duplicate
              ? null
              : { tone: 'warning', message: 'Sale saved, but the drawer pulse was not sent. Check the printer and drawer connection.' });
          }).catch((error) => {
            setCashDrawerStatus({
              tone: 'warning',
              message: error instanceof Error
                ? `Sale saved, but the drawer could not be opened. ${error.message}`
                : 'Sale saved, but the drawer could not be opened. Check the printer and drawer connection.',
            });
          });
        }
      } else if (cashDrawerWasRequested && !hasLocalPrintAgentToken()) {
        setCashDrawerStatus({
          tone: 'warning',
          message: 'Sale saved, but this computer is not paired with Kodigo Print Agent. Pair it in Settings → POS hardware.',
        });
      }
      let nextReceiptSnapshot: ReceiptSnapshot | null = activeStore ? receiptSnapshotFromSale(recordedSale, {
            id: activeStore.id,
            name: activeStore.name,
            registeredName: activeStore.registeredName || activeStore.name,
            businessName: activeStore.businessName || activeStore.name,
            address: activeStore.address,
            tin: activeStore.tin,
            branchCode: activeStore.branchCode,
            vatStatus: activeStore.vatStatus,
            taxRate: activeStore.taxRate,
            documentLabel: activeStore.documentLabel,
            terminalIdentifier: activeStore.terminalIdentifier,
            birRegistrationInfo: activeStore.birRegistrationInfo,
            accreditationInfo: activeStore.accreditationInfo,
            permitInfo: activeStore.permitInfo,
            logoPath: activeStore.logoPath,
            phone: activeStore.phone,
            email: activeStore.email,
          }) : null;
      if (nextReceiptSnapshot) {
        setReceiptSnapshot(nextReceiptSnapshot);
        if (hardwareActions.printReceipt) {
          void printReceipt(nextReceiptSnapshot, 'thermal').then(() => setReceiptPrintStatus(null)).catch((err) => {
            console.warn('Sale recorded, but receipt printing failed:', err);
            setReceiptPrintStatus({
              tone: 'warning',
              message: `Sale saved, but the receipt was not sent to the printer. ${err instanceof Error ? err.message : 'Check the printer connection.'}`,
            });
          });
        }
      }
      if (activeStore) {
        try {
          const receipt = await fetchReceiptBySaleId(recordedSale.id);
          if (completedSaleIdRef.current === recordedSale.id) {
            nextReceiptSnapshot = receipt.payload;
            setReceiptSnapshot(nextReceiptSnapshot);
          }
        } catch (err) {
          console.warn('Sale recorded, but the saved receipt could not be loaded:', err);
        }
      }
    } catch (err) {
      console.warn('Sale recorded, but POS post-processing failed:', err);
    } })();
  };

  const handleDone = () => {
    clearCart();
    setCashInput('');
    setPaymentMethod('cash');
    setPaymentReference('');
    setStep('payment');
    setCompletedSale(null);
    setUncertainSale(null);
    setReceiptSnapshot(null);
    setReceiptPrintStatus(null);
    setCashDrawerStatus(null);
    setPreviewOpen(false);
    completedSaleIdRef.current = null;
    processingRef.current = false;
    onSuccess();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60" onClick={step === 'payment' && !processing && !uncertainSale ? onClose : undefined} />
      <div className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">
            {step === 'payment' ? 'Process Payment' : 'Payment Successful'}
          </h2>
          {step === 'payment' && (
            <button onClick={onClose} disabled={processing || Boolean(uncertainSale)} aria-label="Close payment" className="p-1 rounded-lg hover:bg-gray-100 disabled:opacity-40">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          )}
        </div>

        {step === 'payment' ? (
          <>
            <div className="min-h-0 overflow-y-auto overscroll-contain p-6 space-y-5">
              <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                <div role="region" aria-label="Order items and discounts" tabIndex={0} className="max-h-[30dvh] space-y-2 overflow-y-auto overscroll-contain [overflow-wrap:anywhere]">
                  {items.map((item) => {
                    const optionLabel = getSellingOptionLabel(item.sellingOption);
                    const unitDiscount = Math.min(getOptionSellingPrice(item.product, item.sellingOption), item.discountPerUnit ?? 0);
                    const netLineTotal = item.lineTotal - unitDiscount * item.quantity;
                    return (
                      <div key={item.id} className="space-y-2 border-b border-gray-200 pb-3 last:border-0 last:pb-0">
                        <div className="flex items-start justify-between gap-3 text-sm">
                          <span className="min-w-0 flex-1 text-gray-700">
                            {item.product.name} · {item.quantity} {optionLabel}
                            <span className="block text-xs text-gray-500">{item.quantity * getOptionInventoryMultiplier(item.sellingOption)} {item.product.unit}{item.quantity * getOptionInventoryMultiplier(item.sellingOption) === 1 ? '' : 's'}</span>
                          </span>
                          <span className="whitespace-nowrap text-right font-mono font-medium text-gray-900">{formatCurrency(netLineTotal)}</span>
                        </div>
                        <label className="flex items-center justify-between gap-3 text-xs text-gray-500">
                          <span>Discount per {optionLabel}</span>
                          <span className="relative w-32 shrink-0">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">PHP</span>
                            <input
                              type="number"
                              min="0"
                              max={getOptionSellingPrice(item.product, item.sellingOption)}
                              step="0.01"
                              value={unitDiscount ? unitDiscount : ''}
                              onChange={(event) => setItemDiscount(item.id, Number(event.target.value) || 0)}
                              disabled={processing || Boolean(uncertainSale)}
                              aria-label={`Discount per ${optionLabel} for ${item.product.name}`}
                              className="w-full rounded-md border border-gray-200 bg-white py-1.5 pl-8 pr-2 text-right font-mono text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </span>
                        </label>
                      </div>
                    );
                  })}
                </div>
                <div className="pt-2 border-t border-gray-200 space-y-1">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Item discounts</span>
                    <span className="font-mono">-{formatCurrency(orderDiscount)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{isVatRegistered ? `VAT included (${orderTaxRate}%)` : 'Tax'}</span>
                    <span className="font-mono">{formatCurrency(orderTax)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-gray-900">
                    <span>Total</span>
                    <span className="font-mono text-blue-600 text-xl">{formatCurrency(orderTotal)}</span>
                  </div>
                </div>
              </div>

              {uncertainSale && (
                <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <p className="font-semibold">Sale status is not confirmed</p>
                  <p className="mt-1">Keep this order and payment unchanged. Retry this same request after reconnecting. Do not start a second transaction for these goods.</p>
                </div>
              )}

              <div className="grid grid-cols-4 gap-2">
                {paymentMethods.map((method) => {
                  const Icon = method.icon;
                  const active = paymentMethod === method.value;
                  return (
                    <button
                      key={method.value}
                      type="button"
                      onClick={() => setPaymentMethod(method.value)}
                      disabled={processing || Boolean(uncertainSale)}
                      className={[
                        'h-16 rounded-xl border text-xs font-semibold flex flex-col items-center justify-center gap-1 transition',
                        active ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50',
                      ].join(' ')}
                    >
                      <Icon className="w-4 h-4" />
                      {method.label}
                    </button>
                  );
                })}
              </div>

              {isCash ? (
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1.5 block">Cash Received</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-semibold">PHP</span>
                    <input
                      type="number"
                      value={cashInput}
                      onChange={(e) => setCashInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && canConfirm) {
                          e.preventDefault();
                          handleConfirm();
                        } else if (e.key === 'Escape' && !processing && !uncertainSale) {
                          e.preventDefault();
                          onClose();
                        }
                      }}
                      placeholder="0.00"
                      className="w-full pl-12 pr-4 py-3 text-xl font-mono font-bold border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 text-gray-900"
                      autoFocus
                      min={0}
                      disabled={processing || Boolean(uncertainSale)}
                    />
                  </div>

                  <div className="flex gap-2 mt-2">
                    {quickAmounts.slice(0, 3).map((amt) => (
                      <button
                        key={amt}
                        onClick={() => setCashInput(String(amt))}
                        disabled={processing || Boolean(uncertainSale)}
                        className="flex-1 py-2 text-sm font-semibold font-mono bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                      >
                        {formatCurrency(amt)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1.5 block">Reference Number</label>
                  <input
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    disabled={processing || Boolean(uncertainSale)}
                    placeholder="Optional"
                    className="w-full px-3 py-3 text-sm border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 text-gray-900"
                    autoFocus
                  />
                </div>
              )}

              {isCash && cashAmount >= orderTotal && (
                <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex justify-between items-center">
                  <span className="text-sm font-medium text-green-700">Change</span>
                  <span className="text-xl font-bold font-mono text-green-700">{formatCurrency(change)}</span>
                </div>
              )}

            </div>
            <div className="shrink-0 border-t border-gray-100 bg-white px-6 py-4">
              <Button
                onClick={handleConfirm}
                disabled={!canConfirm}
                loading={processing}
                variant="primary"
                size="lg"
                className="w-full text-base"
              >
                {uncertainSale ? 'Retry Same Sale Request' : 'Confirm Payment'}
              </Button>
            </div>
          </>
        ) : (
          <div className="min-h-0 overflow-y-auto overscroll-contain p-8 flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-1">Payment Complete</h3>
            <p className="text-gray-500 text-sm mb-2">Transaction recorded successfully</p>
            <p className="text-2xl font-bold font-mono text-gray-900 mb-1">{formatCurrency(completedSale?.total ?? orderTotal)}</p>
            <p className="text-sm text-green-600 font-semibold font-mono mb-4">
              Change: {formatCurrency(completedSale?.change ?? change)}
            </p>

            <div className="w-full bg-gray-50 rounded-xl px-4 py-3 mb-6 space-y-1.5 text-left">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span className="flex items-center gap-1.5">
                  <User className="w-3 h-3" />
                  Cashier
                </span>
                <span className="font-medium text-gray-700">{completedSale?.cashierName ?? profile?.name ?? user?.email}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Receipt</span>
                <span className="font-mono text-gray-600">{completedSale?.receiptNumber ?? completedSale?.id ?? '-'}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Time</span>
                <span className="font-mono text-gray-600">
                  {completedSale ? formatDateTime(completedSale.createdAt) : '-'}
                </span>
              </div>
            </div>

            {receiptPrintStatus && (
              <div
                role="alert"
                className="mb-3 w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm text-amber-900"
              >
                {receiptPrintStatus.message}
              </div>
            )}

            {cashDrawerStatus && (
              <div
                role="alert"
                className="mb-4 w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm text-amber-900"
              >
                {cashDrawerStatus.message}
              </div>
            )}

            <div className="flex gap-3 w-full">
              <button
                onClick={() => receiptSnapshot && setPreviewOpen(true)}
                disabled={!receiptSnapshot}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition"
              >
                <Eye className="w-4 h-4" />
                Preview
              </button>
              <button
                onClick={() => {
                  if (!receiptSnapshot) return;
                  setReceiptPrintStatus(null);
                  void printReceipt(receiptSnapshot, 'thermal', { reprint: true }).then(() => setReceiptPrintStatus(null)).catch((error) => {
                    setReceiptPrintStatus({
                      tone: 'warning',
                      message: error instanceof Error ? error.message : 'Unable to send the receipt to the printer.',
                    });
                  });
                }}
                disabled={!receiptSnapshot}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
              >
                <Printer className="w-4 h-4" />
                Reprint Receipt
              </button>
            </div>

            <div className="mt-3 w-full">
              <Button autoFocus variant="primary" size="md" onClick={handleDone} className="w-full text-base py-3">
                New Transaction
              </Button>
            </div>
          </div>
        )}
      </div>
      <ReceiptPreviewModal
        open={previewOpen}
        snapshot={receiptSnapshot}
        saleId={completedSale?.id ?? ''}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  );
}
