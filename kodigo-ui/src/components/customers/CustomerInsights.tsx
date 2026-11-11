import { useEffect, useState } from 'react';
import { getCustomerHistory, getCustomerRankings } from '@/lib/drawer';
import type { CustomerHistory, CustomerRank } from '@/lib/drawer';
import { formatCurrency, formatDateTime } from '@/lib/utils';

export function CustomerHistoryPanel({ customerId }: { customerId: string }) {
  const [history, setHistory] = useState<CustomerHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setHistory(null);
    setError(null);
    getCustomerHistory(customerId)
      .then((h) => { if (current) setHistory(h); })
      .catch((e: unknown) => { if (current) setError(e instanceof Error ? e.message : 'Could not load purchase history.'); });
    return () => { current = false; };
  }, [customerId]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!history) return <p className="text-sm text-gray-500">Loading purchase history…</p>;
  return (
    <div className="border-t border-[var(--border)] pt-4">
      <h3 className="text-sm font-semibold mb-2">Purchase history</h3>
      <p className="text-xs text-gray-600 mb-2">
        {history.visits} visit{history.visits === 1 ? '' : 's'} · {formatCurrency(Number(history.total_spent))} spent
        {history.last_purchase_at ? ` · last ${formatDateTime(history.last_purchase_at)}` : ''}
      </p>
      {history.sales.length === 0 ? (
        <p className="text-xs text-gray-500">No sales linked yet. Pick this customer at checkout to track their purchases.</p>
      ) : (
        <ul className="divide-y divide-gray-100 max-h-72 overflow-y-auto text-xs">
          {history.sales.map((s) => (
            <li key={s.id} className="py-2">
              <div className="flex justify-between"><span>{formatDateTime(s.created_at)} · {s.receipt_number ?? s.id.slice(0, 8)}</span><span className="font-mono">{formatCurrency(Number(s.total))}</span></div>
              <p className="text-gray-500 capitalize">{s.status.replace('_', ' ')} · {s.payment_method}</p>
              {s.items && <p className="text-gray-600 truncate">{s.items}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CustomerRankingsPanel({ storeId }: { storeId: string }) {
  const [days, setDays] = useState(30);
  const [by, setBy] = useState<'spend' | 'visits'>('spend');
  const [rows, setRows] = useState<CustomerRank[] | null>(null);

  useEffect(() => {
    let current = true;
    setRows(null);
    const to = new Date(Date.now() + 60_000);
    getCustomerRankings(storeId, new Date(Date.now() - days * 86_400_000), to, by)
      .then((r) => { if (current) setRows(r); })
      .catch(() => { if (current) setRows([]); });
    return () => { current = false; };
  }, [storeId, days, by]);

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold">Regular customer rankings</h2>
        <div className="flex gap-2 text-xs">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="border rounded-lg px-2 py-1 bg-transparent">
            <option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option>
          </select>
          <select value={by} onChange={(e) => setBy(e.target.value as 'spend' | 'visits')} className="border rounded-lg px-2 py-1 bg-transparent">
            <option value="spend">By spend</option><option value="visits">By visits</option>
          </select>
        </div>
      </div>
      {rows === null ? <p className="text-xs text-gray-500">Loading…</p> : rows.length === 0 ? (
        <p className="text-xs text-gray-500">No tracked customer purchases in this period.</p>
      ) : (
        <ol className="space-y-1 text-sm">
          {rows.map((r, i) => (
            <li key={r.customer_id} className="flex justify-between gap-3">
              <span>{i + 1}. {r.display_name}</span>
              <span className="font-mono text-xs text-gray-600">{r.visits} visits · {formatCurrency(Number(r.total_spent))}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
