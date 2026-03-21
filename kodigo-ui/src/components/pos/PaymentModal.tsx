import { useState } from 'react';
import { CheckCircle, X, Printer, User } from 'lucide-react';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { openCashDrawer } from '@/lib/hardware';
import { Button } from '@/components/shared/Button';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import type { Sale } from '@/types';

interface PaymentModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'payment' | 'confirmed';

export function PaymentModal({ open, onClose, onSuccess }: PaymentModalProps) {
  const { items, total, clearCart } = useCartStore();
  const { user } = useAuthStore();
  const orderTotal = total();

  const [cashInput, setCashInput] = useState('');
  const [step, setStep] = useState<Step>('payment');
  const [processing, setProcessing] = useState(false);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);

  const cashAmount = parseFloat(cashInput) || 0;
  const change = Math.max(0, cashAmount - orderTotal);
  const canConfirm = cashAmount >= orderTotal;

  const quickAmounts = [
    Math.ceil(orderTotal / 50) * 50,
    Math.ceil(orderTotal / 100) * 100,
    Math.ceil(orderTotal / 500) * 500,
  ].filter((v, i, arr) => arr.indexOf(v) === i && v >= orderTotal);

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setProcessing(true);

    // Build the sale record — cashier info captured at transaction time
    const sale: Sale = {
      id: `txn-${Date.now()}`,
      items: items.map((i) => ({
        productId: i.product.id,
        productName: i.product.name,
        quantity: i.quantity,
        unitPrice: i.product.sellingPrice,
        lineTotal: i.lineTotal,
      })),
      subtotal: orderTotal,
      tax: 0,
      discount: 0,
      total: orderTotal,
      cashReceived: cashAmount,
      change,
      cashierId: user?.id ?? 'unknown',
      cashierName: user?.name ?? 'Unknown Cashier',
      createdAt: new Date().toISOString(),
    };

    await new Promise((r) => setTimeout(r, 1000)); // TODO: replace with POST to Supabase
    // await supabase.from('sales').insert(sale); // <- wire here in Phase 1 backend

    // Trigger the cash drawer to open automatically when cash payment is confirmed
    await openCashDrawer();

    setCompletedSale(sale);
    setProcessing(false);
    setStep('confirmed');
  };

  const handleDone = () => {
    clearCart();
    setCashInput('');
    setStep('payment');
    setCompletedSale(null);
    onSuccess();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60" onClick={step === 'payment' ? onClose : undefined} />
      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
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
            {/* Order summary */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              {items.map((item) => (
                <div key={item.product.id} className="flex justify-between text-sm">
                  <span className="text-gray-600 truncate flex-1 mr-2">
                    {item.product.name} ×{item.quantity}
                  </span>
                  <span className="font-mono text-gray-900 font-medium">{formatCurrency(item.lineTotal)}</span>
                </div>
              ))}
              <div className="pt-2 border-t border-gray-200 flex justify-between font-bold text-gray-900">
                <span>Total</span>
                <span className="font-mono text-blue-600 text-xl">{formatCurrency(orderTotal)}</span>
              </div>
            </div>

            {/* Cash input */}
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1.5 block">Cash Received</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-semibold">₱</span>
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
                  className="w-full pl-8 pr-4 py-3 text-xl font-mono font-bold border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 text-gray-900"
                  autoFocus
                  min={0}
                />
              </div>

              {/* Quick amounts */}
              <div className="flex gap-2 mt-2">
                {quickAmounts.slice(0, 3).map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setCashInput(String(amt))}
                    className="flex-1 py-2 text-sm font-semibold font-mono bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    ₱{amt}
                  </button>
                ))}
              </div>
            </div>

            {/* Change display */}
            {cashAmount >= orderTotal && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex justify-between items-center">
                <span className="text-sm font-medium text-green-700">Change</span>
                <span className="text-xl font-bold font-mono text-green-700">{formatCurrency(change)}</span>
              </div>
            )}

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
          /* Success screen */
          <div className="p-8 flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-1">Payment Complete</h3>
            <p className="text-gray-500 text-sm mb-2">Transaction recorded successfully</p>
            <p className="text-2xl font-bold font-mono text-gray-900 mb-1">{formatCurrency(orderTotal)}</p>
            <p className="text-sm text-green-600 font-semibold font-mono mb-4">
              Change: {formatCurrency(change)}
            </p>

            {/* Transaction metadata */}
            <div className="w-full bg-gray-50 rounded-xl px-4 py-3 mb-6 space-y-1.5 text-left">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span className="flex items-center gap-1.5">
                  <User className="w-3 h-3" />
                  Cashier
                </span>
                <span className="font-medium text-gray-700">{completedSale?.cashierName ?? user?.name}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Transaction ID</span>
                <span className="font-mono text-gray-600">{completedSale?.id ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Time</span>
                <span className="font-mono text-gray-600">
                  {completedSale ? formatDateTime(completedSale.createdAt) : '—'}
                </span>
              </div>
            </div>

            <div className="flex gap-3 w-full">
              <button
                onClick={handleDone}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition"
              >
                <Printer className="w-4 h-4" />
                Print Receipt
              </button>
            </div>
            
            <div className="mt-3 w-full">
              <Button autoFocus variant="primary" size="md" onClick={handleDone} className="w-full text-base py-3">
                New Transaction (Enter)
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
