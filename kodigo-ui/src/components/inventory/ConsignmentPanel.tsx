import { useEffect, useState } from 'react';
import { AlertTriangle, PackageCheck } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

interface ConsignmentBalance {
  store_id: string;
  product_id: string;
  product_name: string;
  base_unit: string;
  supplier_id: string;
  supplier_name: string;
  quantity_received: number | string;
  quantity_on_hand: number | string;
  quantity_sold: number | string;
  amount_due: number | string;
}

export function ConsignmentPanel() {
  const activeStoreId = useAuthStore((state) => state.activeStoreId);
  const [rows, setRows] = useState<ConsignmentBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const fetchBalances = async () => {
      setLoading(true);
      setError('');
      let query = supabase
        .from('consignment_settlement_balances')
        .select('store_id,product_id,product_name,base_unit,supplier_id,supplier_name,quantity_received,quantity_on_hand,quantity_sold,amount_due')
        .order('supplier_name')
        .order('product_name');
      if (activeStoreId && activeStoreId !== 'all') query = query.eq('store_id', activeStoreId);
      const { data, error: queryError } = await query;
      if (cancelled) return;
      if (queryError) {
        setError(queryError.message || 'Could not load consignment balances.');
        setRows([]);
      } else {
        setRows((data || []) as ConsignmentBalance[]);
      }
      setLoading(false);
    };
    void fetchBalances();
    return () => { cancelled = true; };
  }, [activeStoreId]);

  if (loading) return <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">Loading consigned stock…</div>;

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
        <div>
          <h2 className="font-semibold text-gray-900">Consigned stock</h2>
          <p className="mt-1 text-sm text-gray-500">Supplier-owned items share the regular inventory and sales flow. Sold units add to the amount owed.</p>
        </div>
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">On-hand consigned units are not store purchases</div>
      </div>
      {error ? (
        <div className="m-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center px-5 py-12 text-center">
          <PackageCheck className="h-8 w-8 text-gray-300" />
          <p className="mt-3 font-medium text-gray-700">No consigned stock yet</p>
          <p className="mt-1 max-w-md text-sm text-gray-500">When receiving stock, choose “Consigned by a supplier.” It will remain available to sell alongside store-owned stock.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr><th className="px-5 py-3">Product</th><th className="px-4 py-3">Supplier</th><th className="px-4 py-3 text-right">Received</th><th className="px-4 py-3 text-right">On hand</th><th className="px-4 py-3 text-right">Sold</th><th className="px-5 py-3 text-right">Amount owed</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => <tr key={`${row.store_id}:${row.product_id}:${row.supplier_id}`}>
                <td className="px-5 py-3"><p className="font-medium text-gray-900">{row.product_name}</p><p className="text-xs text-gray-500">{row.base_unit}</p></td>
                <td className="px-4 py-3 text-gray-700">{row.supplier_name}</td>
                <td className="px-4 py-3 text-right font-mono">{Number(row.quantity_received).toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-mono">{Number(row.quantity_on_hand).toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-mono">{Number(row.quantity_sold).toLocaleString()}</td>
                <td className="px-5 py-3 text-right font-mono font-semibold text-amber-800">{formatCurrency(Number(row.amount_due) || 0)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
