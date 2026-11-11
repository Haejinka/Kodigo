import { useCallback, useEffect, useState } from 'react';
import { CloudOff, RefreshCw } from 'lucide-react';
import { listOfflineSales } from '@/lib/offline-sales';
import { syncOfflineSales } from '@/lib/offline-sync';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/components/shared/Toast';

/** Shows offline state and queued sales; uploads them automatically on reconnect and every 30s. */
export function OfflineSyncBanner() {
  const userId = useAuthStore((s) => s.user?.id);
  const { toast } = useToast();
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);

  const refresh = useCallback(async () => {
    const q = await listOfflineSales(userId).catch(() => []);
    setPending(q.filter((x) => !x.error).length);
    setFailed(q.filter((x) => x.error).length);
  }, [userId]);

  const sync = useCallback(async () => {
    if (!userId) return;
    const n = await syncOfflineSales(userId).catch(() => 0);
    if (n > 0) toast('success', `${n} offline sale${n === 1 ? '' : 's'} synced.`);
    await refresh();
  }, [userId, refresh, toast]);

  useEffect(() => {
    const on = () => { setOnline(true); void sync(); };
    const off = () => setOnline(false);
    const changed = () => void refresh();
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener('kodigo-offline-queue', changed);
    void sync();
    const timer = window.setInterval(() => void sync(), 30_000);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('kodigo-offline-queue', changed);
      window.clearInterval(timer);
    };
  }, [sync, refresh]);

  if (online && pending === 0 && failed === 0) return null;
  return (
    <div className={`flex items-center gap-2 px-4 py-1.5 text-xs font-medium ${online ? 'bg-amber-50 text-amber-900' : 'bg-gray-900 text-white'}`} role="status">
      {online ? <RefreshCw className="w-3.5 h-3.5" /> : <CloudOff className="w-3.5 h-3.5" />}
      <span>
        {online ? 'Back online.' : 'You are offline — sales are saved on this device and will sync automatically.'}
        {pending > 0 && ` ${pending} sale${pending === 1 ? '' : 's'} waiting to sync.`}
        {failed > 0 && ` ${failed} sale${failed === 1 ? '' : 's'} were rejected by the server (e.g. stock) — ask an admin to review.`}
      </span>
    </div>
  );
}
