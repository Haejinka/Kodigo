import { useState } from 'react';
import type { ComponentType } from 'react';
import { CheckCircle, X, User, CreditCard, Smartphone, Banknote, Landmark, Eye } from 'lucide-react';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { openCashDrawer } from '@/lib/hardware';
import { Button } from '@/components/shared/Button';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { useProductStore } from '@/stores/productStore';
import { processSale } from '@/lib/offline-sync';
import {
  getSellingOptionLabel,
  isLegacySellingOption,
} from '@/types';
import type { PaymentMethod, ReceiptSnapshot, Sale } from '@/types';
import { fetchReceiptBySaleId, receiptSnapshotFromSale } from '@/lib/receipts';
import { ReceiptPreviewModal } from '@/components/receipts/ReceiptPreviewModal';

interface PaymentModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'payment' | 'confirmed';

const paymentMethods: Array<{ value: PaymentMethod; label: string; icon: ComponentType<{ className?: string }> }> = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'gcash', label: 'GCash', icon: Smartphone },
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'bank_transfer', label: 'Bank', icon: Landmark },
];

export function PaymentModal({ open, onClose, onSuccess }: PaymentModalProps) {
  const {
    items,
    total,
    subtotal,
    taxAmount,
    taxRate,
    discountAmount,
    discountType,
    discountValue,
    clearCart,
  } = useCartStore();
  const { user, profile, stores } = useAuthStore();

  const [cashInput, setCashInput] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerTin, setCustomerTin] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [discountCategory, setDiscountCategory] = useState<'regular' | 'senior' | 'pwd' | 'other'>('regular');
  const [step, setStep] = useState<Step>('payment');
  const [processing, setProcessing] = useState(false);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);
  const [receiptSnapshot, setReceiptSnapshot] = useState<ReceiptSnapshot | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const orderSubtotal = subtotal();
  const orderDiscount = discountAmount();
  const orderTaxRate = taxRate();
  const isSpecialDiscount = discountCategory === 'senior' || discountCategory === 'pwd';
  const orderTax = isSpecialDiscount ? 0 : taxAmount();
  const orderTotal = isSpecialDiscount
    ? Math.max(0, orderSubtotal - orderDiscount)
    : total();

  const cashAmount = parseFloat(cashInput) || 0;
  const isCash = paymentMethod === 'cash';
  const tendered = isCash ? cashAmount : orderTotal;
  const change = isCash ? Math.max(0, cashAmount - orderTotal) : 0;
  const stockIssue = items.find((i) => i.quantity > i.sellingOption.stockQuantity);
  const canConfirm = items.length > 0 && (isCash ? cashAmount >= orderTotal : true) && !stockIssue;

  const quickAmounts = [
    Math.ceil(orderTotal / 50) * 50,
    Math.ceil(orderTotal / 100) * 100,
    Math.ceil(orderTotal / 500) * 500,
  ].filter((v, i, arr) => arr.indexOf(v) === i && v >= orderTotal);

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setProcessing(true);

    const storeId = useAuthStore.getState().activeStoreId;
    if (!storeId || storeId === 'all') {
      alert('Please select a specific store to process sales.');
      setProcessing(false);
      return;
    }

    const currentStockIssue = items.find((i) => i.quantity > i.sellingOption.stockQuantity);
    if (currentStockIssue) {
      alert(`${currentStockIssue.product.name} - ${getSellingOptionLabel(currentStockIssue.sellingOption)} only has ${currentStockIssue.sellingOption.stockQuantity} in stock.`);
      setProcessing(false);
      return;
    }

    const sale: Sale = {
      id: crypto.randomUUID(),
      storeId,
      items: items.map((i) => ({
        productId: i.product.id,
        productName: i.product.name,
        categoryName: i.product.categoryName,
        sellingOptionId: isLegacySellingOption(i.sellingOption) ? undefined : i.sellingOption.id,
        sellingOptionLabel: getSellingOptionLabel(i.sellingOption),
        unitLabel: i.sellingOption.unitLabel,
        packageSize: i.sellingOption.quantityValue,
        packageUnit: i.sellingOption.quantityUnit,
        stockSource: isLegacySellingOption(i.sellingOption) ? 'product' : 'selling_option',
        quantity: i.quantity,
        unitPrice: i.sellingOption.sellingPrice,
        costPrice: i.product.costPrice,
        lineTotal: i.lineTotal,
      })),
      subtotal: orderSubtotal,
      tax: orderTax,
      taxRate: orderTaxRate,
      discount: orderDiscount,
      discountType,
      discountValue,
      total: orderTotal,
      cashReceived: tendered,
      change,
      paymentMethod,
      paymentReference: paymentReference.trim() || undefined,
      customerName: customerName.trim() || undefined,
      customerTin: customerTin.trim() || undefined,
      customerAddress: customerAddress.trim() || undefined,
      terminalIdentifier: stores.find((store) => store.id === storeId)?.terminalIdentifier,
      discountCategory,
      cashierId: user?.id || null,
      cashierName: profile?.name || user?.user_metadata?.name || user?.email || 'Unknown Cashier',
      createdAt: new Date().toISOString(),
    };

    try {
      const recordedSale = await processSale(sale);
      useProductStore.setState((state) => ({
        products: state.products.map((product) => {
          const soldLines = items.filter((line) => line.product.id === product.id);
          if (soldLines.length === 0) return product;
          const sellingOptions = product.sellingOptions.map((option) => {
            const soldForOption = soldLines
              .filter((line) => line.sellingOption.id === option.id)
              .reduce((sum, line) => sum + line.quantity, 0);
            return soldForOption > 0 ? { ...option, stockQuantity: Math.max(0, option.stockQuantity - soldForOption) } : option;
          });
          const defaultOption = sellingOptions.find((option) => option.isDefault);
          return {
            ...product,
            sellingOptions,
            currentStock: defaultOption ? Math.round(defaultOption.stockQuantity) : product.currentStock,
          };
        }),
      }));
      if (paymentMethod === 'cash') await openCashDrawer();
      setCompletedSale(recordedSale);
      const activeStore = stores.find((store) => store.id === storeId);
      if (activeStore) {
        try {
          const receipt = await fetchReceiptBySaleId(recordedSale.id);
          setReceiptSnapshot(receipt.payload);
        } catch {
          setReceiptSnapshot(receiptSnapshotFromSale(recordedSale, {
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
          }));
        }
      }
      setStep('confirmed');
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Failed to process transaction.');
    } finally {
      setProcessing(false);
    }
  };

  const handleDone = () => {
    clearCart();
    setCashInput('');
    setPaymentMethod('cash');
    setPaymentReference('');
    setCustomerName('');
    setCustomerTin('');
    setCustomerAddress('');
    setDiscountCategory('regular');
    setStep('payment');
    setCompletedSale(null);
    setReceiptSnapshot(null);
    setPreviewOpen(false);
    onSuccess();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60" onClick={step === 'payment' ? onClose : undefined} />
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">
            {step === 'payment' ? 'Process Payment' : 'Payment Successful'}
          </h2>
          {step === 'payment' && (
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          )}
        </div>

        {step === 'payment' ? (
          <div className="p-6 space-y-5">
            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              {items.map((item) => (
                <div key={item.product.id} className="flex justify-between text-sm">
                  <span className="text-gray-600 truncate flex-1 mr-2">
                    {item.product.name} - {getSellingOptionLabel(item.sellingOption)} x{item.quantity}
                  </span>
                  <span className="font-mono text-gray-900 font-medium">{formatCurrency(item.lineTotal)}</span>
                </div>
              ))}
              <div className="pt-2 border-t border-gray-200 space-y-1">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Discount</span>
                  <span className="font-mono">-{formatCurrency(orderDiscount)}</span>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{isSpecialDiscount ? 'VAT-exempt sale' : `Tax (${orderTaxRate}%)`}</span>
                  <span className="font-mono">{formatCurrency(orderTax)}</span>
                </div>
                <div className="flex justify-between font-bold text-gray-900">
                  <span>Total</span>
                  <span className="font-mono text-blue-600 text-xl">{formatCurrency(orderTotal)}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {paymentMethods.map((method) => {
                const Icon = method.icon;
                const active = paymentMethod === method.value;
                return (
                  <button
                    key={method.value}
                    type="button"
                    onClick={() => setPaymentMethod(method.value)}
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
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        onClose();
                      }
                    }}
                    placeholder="0.00"
                    className="w-full pl-12 pr-4 py-3 text-xl font-mono font-bold border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 text-gray-900"
                    autoFocus
                    min={0}
                  />
                </div>

                <div className="flex gap-2 mt-2">
                  {quickAmounts.slice(0, 3).map((amt) => (
                    <button
                      key={amt}
                      onClick={() => setCashInput(String(amt))}
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

            <div className="rounded-xl border border-gray-200 p-3">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Customer & discount details</p>
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  placeholder="Customer name (optional)"
                  className="col-span-2 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
                <input
                  value={customerTin}
                  onChange={(event) => setCustomerTin(event.target.value)}
                  placeholder="Customer TIN"
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
                <select
                  value={discountCategory}
                  onChange={(event) => setDiscountCategory(event.target.value as typeof discountCategory)}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                >
                  <option value="regular">Regular</option>
                  <option value="senior">Senior Citizen</option>
                  <option value="pwd">PWD</option>
                  <option value="other">Other discount</option>
                </select>
                <input
                  value={customerAddress}
                  onChange={(event) => setCustomerAddress(event.target.value)}
                  placeholder="Customer address"
                  className="col-span-2 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <Button
              onClick={handleConfirm}
              disabled={!canConfirm}
              loading={processing}
              variant="primary"
              size="lg"
              className="w-full text-base"
            >
              Confirm Payment
            </Button>
          </div>
        ) : (
          <div className="p-8 flex flex-col items-center text-center">
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

            <div className="flex gap-3 w-full">
              <button
                onClick={() => receiptSnapshot && setPreviewOpen(true)}
                disabled={!receiptSnapshot}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition"
              >
                <Eye className="w-4 h-4" />
                Preview / Print
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
