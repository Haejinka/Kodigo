import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, PackageCheck } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/shared/Button';
import { useToast } from '@/components/shared/Toast';

interface ConsignmentBalance {
  store_id: string;
  product_id: string;
  product_name: string;
  base_unit: string;
  supplier_id: string;
  supplier_name: string;
  quantity_received: number | string;
  quantity_on_hand: number | string;
  amount_due: number | string;
}

interface SupplierBalance {
  store_id: string;
  supplier_id: string;
  supplier_name: string;
  quantity_received: number | string;
  quantity_on_hand: number | string;
  amount_due: number | string;
  amount_paid: number | string;
  outstanding_balance: number | string;
  supplier_credit: number | string;
}

interface SupplierPayment {
  id: string;
  store_id: string;
  supplier_id: string;
  amount: number | string;
  reference: string | null;
  note: string;
  paid_at: string;
}

export function ConsignmentPanel() {
  const activeStoreId = useAuthStore((state) => state.activeStoreId);
  const role = useAuthStore((state) => state.role);
  const { toast } = useToast();
  const [rows, setRows] = useState<ConsignmentBalance[]>([]);
  const [supplierBalances, setSupplierBalances] = useState<SupplierBalance[]>([]);
  const [supplierPayments, setSupplierPayments] = useState<SupplierPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [paymentTarget, setPaymentTarget] = useState<SupplierBalance | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    let balanceQuery = supabase
      .from('consignment_settlement_balances')
      .select('store_id,product_id,product_name,base_unit,supplier_id,supplier_name,quantity_received,quantity_on_hand,amount_due')
      .order('supplier_name')
      .order('product_name');
    let supplierQuery = supabase
      .from('consignment_supplier_balances')
      .select('store_id,supplier_id,supplier_name,quantity_received,quantity_on_hand,amount_due,amount_paid,outstanding_balance,supplier_credit')
      .order('supplier_name');
    let paymentQuery = supabase
      .from('consignment_supplier_payments')
      .select('id,store_id,supplier_id,amount,reference,note,paid_at')
      .order('paid_at', { ascending: false })
      .limit(100);
    if (activeStoreId && activeStoreId !== 'all') {
      balanceQuery = balanceQuery.eq('store_id', activeStoreId);
      supplierQuery = supplierQuery.eq('store_id', activeStoreId);
      paymentQuery = paymentQuery.eq('store_id', activeStoreId);
    }
    const [balances, suppliers, payments] = await Promise.all([balanceQuery, supplierQuery, paymentQuery]);
    const queryError = balances.error ?? suppliers.error ?? payments.error;
    if (queryError) {
      setError(queryError.message || 'Could not load consignment balances.');
      setRows([]);
      setSupplierBalances([]);
      setSupplierPayments([]);
    } else {
      setRows((balances.data || []) as ConsignmentBalance[]);
      setSupplierBalances((suppliers.data || []) as SupplierBalance[]);
      setSupplierPayments((payments.data || []) as SupplierPayment[]);
    }
    setLoading(false);
  }, [activeStoreId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const beginPayment = (balance: SupplierBalance) => {
    setPaymentTarget(balance);
    setPaymentAmount('');
    setPaymentReference('');
  };

  const submitPayment = async () => {
    if (!paymentTarget) return;
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('error', 'Enter a payment amount greater than zero.');
      return;
    }
    setSavingPayment(true);
    try {
      const { error: paymentError } = await supabase.rpc('record_consignment_supplier_payment', {
        p_store_id: paymentTarget.store_id,
        p_supplier_id: paymentTarget.supplier_id,
        p_amount: amount,
        p_reference: paymentReference.trim() || null,
        p_note: null,
      });
      if (paymentError) throw paymentError;
      toast('success', `Supplier payment recorded: ${formatCurrency(amount)}.`);
      setPaymentTarget(null);
      await refresh();
    } catch (paymentError) {
      toast('error', paymentError instanceof Error ? paymentError.message : 'Could not record supplier payment.');
    } finally {
      setSavingPayment(false);
    }
  };

  if (loading) return <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">Loading consigned stock…</div>;

  return (
    <section className="space-y-6">
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="font-semibold text-gray-900">Consigned stock</h2>
            <p className="mt-1 text-sm text-gray-500">Each receipt creates a payable at the agreed supplier cost. Unsold stock is still owed; sales only change the on-hand quantity.</p>
          </div>
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">Payable on receipt</div>
        </div>
        {error ? (
          <div role="alert" className="m-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-12 text-center">
            <PackageCheck className="h-8 w-8 text-gray-300" />
            <p className="mt-3 font-medium text-gray-700">No consigned stock yet</p>
            <p className="mt-1 max-w-md text-sm text-gray-500">When receiving stock, choose “Consigned by a supplier.” Its agreed supplier cost becomes payable immediately, whether the goods are sold or remain on hand.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr><th className="px-5 py-3">Product</th><th className="px-4 py-3">Supplier</th><th className="px-4 py-3 text-right">Received</th><th className="px-4 py-3 text-right">On hand</th><th className="px-5 py-3 text-right">Amount owed</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => <tr key={`${row.store_id}:${row.product_id}:${row.supplier_id}`}>
                  <td className="px-5 py-3"><p className="font-medium text-gray-900">{row.product_name}</p><p className="text-xs text-gray-500">{row.base_unit}</p></td>
                  <td className="px-4 py-3 text-gray-700">{row.supplier_name}</td>
                  <td className="px-4 py-3 text-right font-mono">{Number(row.quantity_received).toLocaleString('en-PH')}</td>
                  <td className="px-4 py-3 text-right font-mono">{Number(row.quantity_on_hand).toLocaleString('en-PH')}</td>
                  <td className="px-5 py-3 text-right font-mono font-semibold text-amber-800">{formatCurrency(Number(row.amount_due) || 0)}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 className="font-semibold text-gray-900">Supplier payments</h2>
          <p className="mt-1 text-sm text-gray-500">Payments reduce the amount owed for received goods; they stay separate from sales revenue and regular stock purchases.</p>
        </div>
        {supplierBalances.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-500">Supplier balances will appear after consigned stock is received.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr><th className="px-5 py-3">Supplier</th><th className="px-4 py-3 text-right">Total owed</th><th className="px-4 py-3 text-right">Paid</th><th className="px-4 py-3 text-right">Outstanding</th><th className="px-4 py-3 text-right">Credit</th><th className="px-5 py-3 text-right">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {supplierBalances.map((balance) => (
                  <tr key={`${balance.store_id}:${balance.supplier_id}`}>
                    <td className="px-5 py-3 font-medium text-gray-900">{balance.supplier_name || 'Supplier'}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(Number(balance.amount_due) || 0)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(Number(balance.amount_paid) || 0)}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-amber-800">{formatCurrency(Number(balance.outstanding_balance) || 0)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(Number(balance.supplier_credit) || 0)}</td>
                    <td className="px-5 py-3 text-right">
                      {role === 'admin' && Number(balance.outstanding_balance) > 0 ? (
                        <button type="button" onClick={() => beginPayment(balance)} className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Record payment</button>
                      ) : <span className="text-xs text-gray-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {paymentTarget && (
          <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Payment to {paymentTarget.supplier_name || 'supplier'}</h3>
                <p className="mt-1 text-xs text-gray-500">Outstanding balance: {formatCurrency(Number(paymentTarget.outstanding_balance) || 0)}</p>
              </div>
              <button type="button" onClick={() => setPaymentTarget(null)} className="text-xs font-medium text-gray-500 hover:text-gray-900">Cancel</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(9rem,0.7fr)_minmax(12rem,1fr)_auto] sm:items-end">
              <label className="block text-xs font-medium text-gray-600">
                Amount
                <input type="number" min="0.01" max={Number(paymentTarget.outstanding_balance)} step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} className="report-input mt-1" />
              </label>
              <label className="block text-xs font-medium text-gray-600">
                Reference (optional)
                <input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} className="report-input mt-1" />
              </label>
              <Button type="button" variant="primary" loading={savingPayment} disabled={!paymentAmount} onClick={() => void submitPayment()}>Save payment</Button>
            </div>
          </div>
        )}
        <div className="border-t border-gray-100 px-5 py-4">
          <h3 className="text-sm font-semibold text-gray-900">Recent supplier payments</h3>
          {supplierPayments.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No supplier payments recorded yet.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Supplier</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Reference / note</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {supplierPayments.map((payment) => {
                    const supplier = supplierBalances.find((balance) => balance.store_id === payment.store_id && balance.supplier_id === payment.supplier_id);
                    return (
                      <tr key={payment.id}>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-600">{new Date(payment.paid_at).toLocaleString('en-PH')}</td>
                        <td className="px-3 py-2 font-medium text-gray-800">{supplier?.supplier_name || 'Supplier'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-mono">{formatCurrency(Number(payment.amount) || 0)}</td>
                        <td className="px-3 py-2 text-gray-600">{payment.reference || payment.note || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-gray-500">Showing the latest {supplierPayments.length} payment{supplierPayments.length === 1 ? '' : 's'}.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
