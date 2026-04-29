import { useEffect, useMemo, useState } from 'react';
import { Banknote, RotateCcw, Undo2, X, ReceiptText, LockKeyhole, RefreshCw } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { useToast } from '@/components/shared/Toast';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import {
  closeCashierShift,
  fetchRecentSales,
  fetchSaleItems,
  refundSale,
  returnSaleItems,
  voidSale,
} from '@/lib/transactions';
import { useAuthStore } from '@/stores/authStore';
import type { PaymentMethod, SaleItem, SaleRecord } from '@/types';

interface TransactionLifecyclePanelProps {
  open: boolean;
  storeId: string;
  onClose: () => void;
}

type Action = 'void' | 'refund' | 'return' | null;

const paymentOptions: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'gcash', label: 'GCash' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank' },
  { value: 'other', label: 'Other' },
];

export function TransactionLifecyclePanel({ open, storeId, onClose }: TransactionLifecyclePanelProps) {
  const { toast } = useToast();
  const role = useAuthStore((state) => state.role);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [target, setTarget] = useState<SaleRecord | null>(null);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [processing, setProcessing] = useState(false);
  const [saleItems, setSaleItems] = useState<SaleItem[]>([]);
  const [returnDraft, setReturnDraft] = useState<Record<string, { quantity: number; restock: boolean }>>({});
  const [openingCash, setOpeningCash] = useState('');
  const [countedCash, setCountedCash] = useState('');
  const [closeoutNotes, setCloseoutNotes] = useState('');
  const [closeoutOpen, setCloseoutOpen] = useState(false);

  const isAdmin = role === 'admin';

  const refresh = async () => {
    setLoading(true);
    try {
      setSales(await fetchRecentSales(storeId));
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to load transactions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void refresh();
  }, [open, storeId]);

  const resetAction = () => {
    setAction(null);
    setTarget(null);
    setReason('');
    setAmount('');
    setMethod('cash');
    setReference('');
    setSaleItems([]);
    setReturnDraft({});
  };

  const beginAction = async (nextAction: Action, sale: SaleRecord) => {
    setAction(nextAction);
    setTarget(sale);
    setReason('');
    setMethod(sale.paymentMethod);
    setReference('');
    setAmount(nextAction === 'refund' ? String(sale.total) : '');

    if (nextAction === 'return') {
      setProcessing(true);
      try {
        const items = await fetchSaleItems(sale.id);
        setSaleItems(items);
        setReturnDraft(Object.fromEntries(
          items.filter((item) => item.id).map((item) => [item.id as string, { quantity: item.quantity, restock: true }])
        ));
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Failed to load sale items.');
      } finally {
        setProcessing(false);
      }
    }
  };

  const returnTotal = useMemo(() => {
    return saleItems.reduce((sum, item) => {
      if (!item.id) return sum;
      return sum + (returnDraft[item.id]?.quantity ?? 0) * item.unitPrice;
    }, 0);
  }, [returnDraft, saleItems]);

  const submitAction = async () => {
    if (!target || !action) return;
    if (!reason.trim()) {
      toast('error', 'Reason is required.');
      return;
    }

    setProcessing(true);
    try {
      if (action === 'void') {
        await voidSale(target.id, reason.trim());
        toast('success', 'Sale voided and stock restored.');
      } else if (action === 'refund') {
        await refundSale(target.id, parseFloat(amount) || 0, method, reason.trim(), reference.trim() || undefined);
        toast('success', 'Refund recorded.');
      } else {
        const items = Object.entries(returnDraft)
          .filter(([, line]) => line.quantity > 0)
          .map(([saleItemId, line]) => ({ saleItemId, quantity: line.quantity, restock: line.restock }));
        if (items.length === 0) throw new Error('Choose at least one returned item.');
        await returnSaleItems({
          saleId: target.id,
          items,
          reason: reason.trim(),
          method,
          reference: reference.trim() || undefined,
        });
        toast('success', 'Return recorded, refund issued, and stock updated.');
      }
      resetAction();
      await refresh();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Transaction lifecycle update failed.');
    } finally {
      setProcessing(false);
    }
  };

  const submitCloseout = async () => {
    setProcessing(true);
    try {
      const closeout = await closeCashierShift({
        storeId,
        openingCash: parseFloat(openingCash) || 0,
        countedCash: parseFloat(countedCash) || 0,
        notes: closeoutNotes.trim() || undefined,
      });
      toast('success', `Closeout saved. Variance: ${formatCurrency(closeout.variance)}.`);
      setOpeningCash('');
      setCountedCash('');
      setCloseoutNotes('');
      setCloseoutOpen(false);
      await refresh();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to close cashier shift.');
    } finally {
      setProcessing(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <section className="relative h-full w-full max-w-3xl bg-white shadow-2xl flex flex-col">
        <header className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900 flex items-center gap-2">
              <ReceiptText className="w-5 h-5 text-blue-600" />
              Transactions
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">Voids, refunds, returns, and cashier closeout</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100" aria-label="Close">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </header>

        <div className="px-5 py-4 border-b border-gray-100">
          <button
            type="button"
            onClick={() => setCloseoutOpen((value) => !value)}
            className="w-full flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-left hover:bg-gray-50"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-gray-800">
              <Banknote className="w-4 h-4 text-green-600" />
              Cashier Closeout
            </span>
            <span className="text-xs text-gray-500">Count drawer</span>
          </button>

          {closeoutOpen && (
            <div className="grid gap-3 sm:grid-cols-3 mt-3">
              <input
                type="number"
                min={0}
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                placeholder="Opening cash"
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="number"
                min={0}
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
                placeholder="Counted cash"
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Button onClick={submitCloseout} loading={processing} disabled={!countedCash} variant="primary">
                Close Shift
              </Button>
              <textarea
                value={closeoutNotes}
                onChange={(e) => setCloseoutNotes(e.target.value)}
                placeholder="Notes"
                className="sm:col-span-3 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                rows={2}
              />
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">Recent Sales</span>
            <button onClick={refresh} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="Refresh">
              <RefreshCw className="w-4 h-4 text-gray-500" />
            </button>
          </div>

          {loading ? (
            <div className="px-5 py-8 text-sm text-gray-500">Loading transactions...</div>
          ) : sales.length === 0 ? (
            <div className="px-5 py-8 text-sm text-gray-500">No recent sales found.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {sales.map((sale) => (
                <li key={sale.id} className="px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-sm font-semibold text-gray-900 truncate">
                        {sale.receiptNumber ?? sale.id.slice(0, 8)}
                      </p>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">
                        {sale.status.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{formatDateTime(sale.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-gray-900">{formatCurrency(sale.total)}</span>
                    {isAdmin ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => beginAction('void', sale)}
                          disabled={sale.status !== 'completed'}
                          className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                          title="Void sale"
                        >
                          <Undo2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => beginAction('refund', sale)}
                          disabled={sale.status === 'voided' || sale.status === 'refunded'}
                          className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                          title="Refund sale"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => beginAction('return', sale)}
                          disabled={sale.status === 'voided' || sale.status === 'refunded'}
                          className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                          title="Return items"
                        >
                          <ReceiptText className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <LockKeyhole className="w-3 h-3" />
                        Admin
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {action && target && (
          <div className="border-t border-gray-200 p-5 bg-gray-50">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-900 capitalize">{action} Transaction</h3>
              <button onClick={resetAction} className="text-xs text-gray-500 hover:text-gray-900">Cancel</button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {action === 'refund' && (
                <input
                  type="number"
                  min={0.01}
                  max={target.total}
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Refund amount"
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}

              {(action === 'refund' || action === 'return') && (
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {paymentOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              )}

              {(action === 'refund' || action === 'return') && (
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Reference number"
                  className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}

              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason"
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {action === 'return' && (
              <div className="mt-3 border border-gray-200 rounded-lg bg-white overflow-hidden">
                {saleItems.map((item) => {
                  const draft = item.id ? returnDraft[item.id] : undefined;
                  return (
                    <div key={item.id} className="grid grid-cols-[1fr_72px_84px] gap-2 items-center px-3 py-2 border-b border-gray-100 last:border-b-0">
                      <span className="text-sm text-gray-700 truncate">{item.productName}</span>
                      <input
                        type="number"
                        min={0}
                        max={item.quantity}
                        value={draft?.quantity ?? 0}
                        onChange={(e) => {
                          if (!item.id) return;
                          setReturnDraft((prev) => ({
                            ...prev,
                            [item.id as string]: {
                              restock: prev[item.id as string]?.restock ?? true,
                              quantity: Math.min(item.quantity, Math.max(0, parseInt(e.target.value) || 0)),
                            },
                          }));
                        }}
                        className="px-2 py-1 text-xs font-mono border border-gray-200 rounded"
                      />
                      <label className="flex items-center gap-1 text-xs text-gray-500">
                        <input
                          type="checkbox"
                          checked={draft?.restock ?? true}
                          onChange={(e) => {
                            if (!item.id) return;
                            setReturnDraft((prev) => ({
                              ...prev,
                              [item.id as string]: {
                                quantity: prev[item.id as string]?.quantity ?? item.quantity,
                                restock: e.target.checked,
                              },
                            }));
                          }}
                        />
                        Restock
                      </label>
                    </div>
                  );
                })}
                <div className="px-3 py-2 text-right text-xs font-semibold text-gray-600">
                  Return total: {formatCurrency(returnTotal)}
                </div>
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <Button variant="primary" onClick={submitAction} loading={processing}>
                Save {action}
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
