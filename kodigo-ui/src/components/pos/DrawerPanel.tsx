import { useCallback, useEffect, useState } from 'react';
import { Banknote } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { useToast } from '@/components/shared/Toast';
import { formatCurrency } from '@/lib/utils';
import { closeDrawer, getOpenDrawer, openDrawer, recordDrawerEntry } from '@/lib/drawer';
import type { DrawerEntry, DrawerSession } from '@/lib/drawer';

const input = 'px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';

export function DrawerPanel({ storeId }: { storeId: string }) {
  const { toast } = useToast();
  const [session, setSession] = useState<DrawerSession | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState('');
  const [entryType, setEntryType] = useState<DrawerEntry['entry_type']>('pay_in');
  const [entryAmount, setEntryAmount] = useState('');
  const [entryReason, setEntryReason] = useState('');
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [lastClosed, setLastClosed] = useState<DrawerSession | null>(null);

  const load = useCallback(async () => {
    try {
      setSession(await getOpenDrawer(storeId));
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not load drawer.');
    } finally {
      setLoaded(true);
    }
  }, [storeId, toast]);

  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', ok);
      await load();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Drawer action failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <p className="text-sm text-gray-500">Loading drawer…</p>;

  if (!session) {
    return (
      <div>
        <p className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-2">
          <Banknote className="w-4 h-4 text-green-600" /> Cash drawer is closed
        </p>
        {lastClosed && (
          <p className="text-xs text-gray-600 mb-2">
            Last closeout: expected {formatCurrency(lastClosed.expected_cash ?? 0)}, counted {formatCurrency(lastClosed.counted_cash ?? 0)}, variance {formatCurrency(lastClosed.variance ?? 0)}. Sent for admin review.
          </p>
        )}
        <div className="flex gap-2">
          <input type="number" min={0} step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="Opening cash counted" className={`${input} flex-1`} />
          <Button loading={busy} disabled={opening === ''} onClick={() => run(() => openDrawer(storeId, parseFloat(opening)), 'Drawer opened.')}>Open drawer</Button>
        </div>
      </div>
    );
  }

  const t = session.totals;
  const rows: Array<[string, number]> = [
    ['Opening cash', t.opening_cash],
    ['+ Cash sales', t.cash_sales],
    ['− Cash refunds', -t.cash_refunds],
    ['+ Digital cash in (e-load, GCash cash-in)', t.digital_cash_in],
    ['− Digital cash out (GCash cash-out)', -t.digital_cash_out],
    ['+ Pay in', t.pay_in],
    ['− Pay out / drops', -t.pay_out],
  ];

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-gray-800">
        <Banknote className="w-4 h-4 text-green-600" /> Drawer open · {session.cashier_name ?? 'cashier'} · since {new Date(session.opened_at).toLocaleTimeString()}
      </p>
      <dl className="text-xs space-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between"><dt className="text-gray-600">{label}</dt><dd className="font-mono">{formatCurrency(value)}</dd></div>
        ))}
        <div className="flex justify-between border-t pt-1 font-semibold"><dt>Expected in drawer</dt><dd className="font-mono">{formatCurrency(t.expected_cash)}</dd></div>
      </dl>

      <div className="grid gap-2 sm:grid-cols-4">
        <select value={entryType} onChange={(e) => setEntryType(e.target.value as DrawerEntry['entry_type'])} className={input}>
          <option value="pay_in">Pay in</option><option value="pay_out">Pay out</option><option value="drop">Safe drop</option>
        </select>
        <input type="number" min={0} step="0.01" value={entryAmount} onChange={(e) => setEntryAmount(e.target.value)} placeholder="Amount" className={input} />
        <input value={entryReason} onChange={(e) => setEntryReason(e.target.value)} placeholder="Reason" className={input} />
        <Button variant="secondary" loading={busy} disabled={!entryAmount || !entryReason.trim()}
          onClick={() => run(async () => { await recordDrawerEntry(session.id, entryType, parseFloat(entryAmount), entryReason.trim()); setEntryAmount(''); setEntryReason(''); }, 'Cash movement recorded.')}>
          Record
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-3 border-t pt-3">
        <input type="number" min={0} step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="Counted cash" className={input} />
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" className={input} />
        <Button variant="danger" loading={busy} disabled={counted === ''}
          onClick={() => run(async () => { setLastClosed(await closeDrawer(session.id, parseFloat(counted), notes)); setCounted(''); setNotes(''); }, 'Drawer closed.')}>
          Close drawer
        </Button>
      </div>
    </div>
  );
}
