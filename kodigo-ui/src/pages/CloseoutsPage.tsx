import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/shared/Button';
import { useToast } from '@/components/shared/Toast';
import { useAuthStore } from '@/stores/authStore';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { decideAdjustment, listAdjustmentRequests, listDrawerSessions, reviewDrawer } from '@/lib/drawer';
import type { AdjustmentRequest, DrawerSession } from '@/lib/drawer';

export function CloseoutsPage() {
  const { toast } = useToast();
  const storeId = useAuthStore((s) => s.activeStoreId);
  const [sessions, setSessions] = useState<DrawerSession[]>([]);
  const [requests, setRequests] = useState<AdjustmentRequest[]>([]);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!storeId || storeId === 'all') return;
    try {
      const [s, r] = await Promise.all([
        listDrawerSessions(storeId, filter === 'pending' ? 'pending' : undefined),
        listAdjustmentRequests(storeId, 'pending'),
      ]);
      setSessions(s);
      setRequests(r);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not load closeouts.');
    }
  }, [storeId, filter, toast]);

  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast('success', ok); await load(); }
    catch (err) { toast('error', err instanceof Error ? err.message : 'Action failed.'); }
    finally { setBusy(false); }
  };

  if (!storeId || storeId === 'all') return <p className="p-6 text-sm text-gray-500">Select a specific store.</p>;

  return (
    <div>
      <PageHeader title="Closeouts & Approvals" subtitle="Review cashier drawer closeouts and void, refund and return requests" />

      <h2 className="font-semibold text-gray-800 mb-2">Pending approval requests ({requests.length})</h2>
      {requests.length === 0 ? <p className="text-sm text-gray-500 mb-6">Nothing waiting.</p> : (
        <ul className="space-y-2 mb-6">
          {requests.map((r) => (
            <li key={r.id} className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-semibold capitalize">{r.kind} · {r.receipt_number ?? r.sale_id.slice(0, 8)} · {formatCurrency(r.kind === 'refund' && r.amount ? r.amount : r.sale_total)}</span>
                <span className="text-gray-500">{formatDateTime(r.requested_at)}</span>
              </div>
              <p className="text-gray-600 mt-1">{r.requester_name ?? 'Cashier'}: {r.reason}</p>
              <div className="flex gap-2 mt-3">
                <Button size="sm" loading={busy} onClick={() => act(() => decideAdjustment(r.id, true), 'Approved and applied.')}>Approve</Button>
                <Button size="sm" variant="danger" loading={busy} onClick={() => act(() => decideAdjustment(r.id, false, window.prompt('Reason for rejecting (optional)') ?? undefined), 'Rejected.')}>Reject</Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-gray-800">Cashier closeouts</h2>
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
          {(['pending', 'all'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1 text-xs rounded-lg ${filter === f ? 'bg-white shadow font-semibold' : 'text-gray-600'}`}>
              {f === 'pending' ? 'Needs review' : 'All'}
            </button>
          ))}
        </div>
      </div>
      {sessions.length === 0 ? <p className="text-sm text-gray-500">No drawer sessions.</p> : (
        <ul className="space-y-3">
          {sessions.map((s) => (
            <li key={s.id} className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-semibold">{s.cashier_name ?? 'Cashier'} · {formatDateTime(s.opened_at)}{s.closed_at ? ` → ${formatDateTime(s.closed_at)}` : ' (open)'}</span>
                <span className="capitalize text-xs px-2 py-0.5 rounded-full bg-gray-100">{s.state === 'open' ? 'open' : s.review_status}</span>
              </div>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-xs">
                <div><dt className="text-gray-500">Opening</dt><dd className="font-mono">{formatCurrency(s.totals.opening_cash)}</dd></div>
                <div><dt className="text-gray-500">Cash sales − refunds</dt><dd className="font-mono">{formatCurrency(s.totals.cash_sales - s.totals.cash_refunds)}</dd></div>
                <div><dt className="text-gray-500">Digital in / out</dt><dd className="font-mono">{formatCurrency(s.totals.digital_cash_in)} / {formatCurrency(s.totals.digital_cash_out)}</dd></div>
                <div><dt className="text-gray-500">Pay in / out</dt><dd className="font-mono">{formatCurrency(s.totals.pay_in)} / {formatCurrency(s.totals.pay_out)}</dd></div>
                <div><dt className="text-gray-500">Expected</dt><dd className="font-mono">{formatCurrency(s.totals.expected_cash)}</dd></div>
                {s.state === 'closed' && <div><dt className="text-gray-500">Counted</dt><dd className="font-mono">{formatCurrency(s.counted_cash ?? 0)}</dd></div>}
                {s.state === 'closed' && <div><dt className="text-gray-500">Variance</dt><dd className={`font-mono font-semibold ${(s.variance ?? 0) === 0 ? '' : 'text-red-600'}`}>{formatCurrency(s.variance ?? 0)}</dd></div>}
              </dl>
              {s.close_notes && <p className="text-xs text-gray-600 mt-2">Cashier note: {s.close_notes}</p>}
              {s.review_note && <p className="text-xs text-gray-600 mt-1">Review note: {s.review_note}</p>}
              {s.state === 'closed' && s.review_status === 'pending' && (
                <div className="flex gap-2 mt-3">
                  <Button size="sm" loading={busy} onClick={() => act(() => reviewDrawer(s.id, 'approved'), 'Closeout approved.')}>Approve</Button>
                  <Button size="sm" variant="danger" loading={busy} onClick={() => {
                    const note = window.prompt('Why is this closeout flagged?');
                    if (note) void act(() => reviewDrawer(s.id, 'flagged', note), 'Closeout flagged.');
                  }}>Flag</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
