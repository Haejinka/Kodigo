import { useEffect, useMemo, useRef, useState } from 'react';
import { Printer, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import {
  getLocalPrintAgentCapabilities,
  getConfiguredDrawerPrinter,
  printShoppingListOnLocalAgent,
} from '@/lib/hardware';
import { buildShoppingListMarkup } from '@/lib/shopping-list-markup';
import { printShoppingList } from '@/lib/shopping-lists';
import type { LocalPrintAgentCapabilities } from '@/lib/hardware';
import type { ShoppingListPaperProfile, ShoppingListSnapshotV1 } from '@/types/shopping-lists';

type PrintMethod = 'browser' | 'native';

function createAttemptId() {
  if (!globalThis.crypto?.randomUUID) throw new Error('Secure print-attempt IDs are unavailable in this browser.');
  return globalThis.crypto.randomUUID();
}

export function ShoppingListPreviewDialog({
  open,
  snapshot,
  onClose,
  onRefresh,
}: {
  open: boolean;
  snapshot: ShoppingListSnapshotV1 | null;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [profile, setProfile] = useState<ShoppingListPaperProfile>('58mm');
  const [showPrices, setShowPrices] = useState(true);
  const [method, setMethod] = useState<PrintMethod>('browser');
  const [capabilities, setCapabilities] = useState<LocalPrintAgentCapabilities | null>(null);
  const [checkingAgent, setCheckingAgent] = useState(false);
  const [agentMessage, setAgentMessage] = useState('');
  const [attemptId, setAttemptId] = useState('');
  const [hasAttemptedPrint, setHasAttemptedPrint] = useState(false);
  const [working, setWorking] = useState(false);
  const workingRef = useRef(false);
  const [status, setStatus] = useState<{ kind: 'info' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setProfile('58mm');
    setShowPrices(true);
    setMethod('browser');
    setCapabilities(null);
    setCheckingAgent(false);
    setAgentMessage('');
    setAttemptId('');
    setHasAttemptedPrint(false);
    setWorking(false);
    workingRef.current = false;
    setStatus(null);
  }, [open, snapshot?.documentId]);

  const markup = useMemo(
    () => snapshot ? buildShoppingListMarkup(snapshot, profile, { showPrices }) : '',
    [snapshot, profile, showPrices],
  );
  const printerName = snapshot && snapshot.storeId !== 'all'
    ? getConfiguredDrawerPrinter(snapshot.storeId)
    : '';
  const supportsShoppingLists = capabilities?.supportedDocuments.includes('shopping-list') === true;
  const supportsSelectedProfile = capabilities?.shoppingListPaperProfiles.includes(profile) === true;
  const withinNativeLimit = snapshot !== null && snapshot.items.length <= (capabilities?.shoppingListMaximumItems ?? 0);
  const nativeTextWithinLimit = snapshot !== null
    && [snapshot.storeName, ...snapshot.items.flatMap((item) => [item.productName, item.purchaseUnit])].every((text) => text.length <= 192);
  const canUseNative = supportsShoppingLists && supportsSelectedProfile && withinNativeLimit && nativeTextWithinLimit && Boolean(printerName);

  if (!open || !snapshot) return null;

  const checkLocalPrinter = async () => {
    setCheckingAgent(true);
    setAgentMessage('');
    try {
      const result = await getLocalPrintAgentCapabilities();
      setCapabilities(result);
      if (!result) {
        setAgentMessage('This computer is not paired with Kodigo Print Agent. Browser printing is ready; pairing is available in Settings → POS hardware.');
      } else if (!result.supportedDocuments.includes('shopping-list')) {
        setAgentMessage('The paired agent is an older version and cannot print shopping lists. Update it or use browser printing.');
      } else if (!printerName) {
        setAgentMessage('Choose a POS printer in Settings → POS hardware before using the local printer.');
      } else if (snapshot && snapshot.items.length > result.shoppingListMaximumItems) {
        setAgentMessage(`This agent accepts up to ${result.shoppingListMaximumItems} items per native print job. Use browser printing for this longer list.`);
      } else if (!nativeTextWithinLimit) {
        setAgentMessage('One or more names exceed the local printer limit. Use browser printing for this list.');
      } else {
        setAgentMessage(`Connected to Print Agent ${result.version}. Check the loaded paper before choosing a profile.`);
      }
    } catch (error) {
      setCapabilities(null);
      setAgentMessage(error instanceof Error ? error.message : 'Could not check the local print agent. Browser printing remains available.');
    } finally {
      setCheckingAgent(false);
    }
  };

  const handlePrint = async () => {
    if (workingRef.current) return;
    workingRef.current = true;
    setWorking(true);
    setStatus(null);
    const reprint = hasAttemptedPrint;
    let currentAttemptId = attemptId;
    try {
      if (reprint || !currentAttemptId) currentAttemptId = createAttemptId();
      setAttemptId(currentAttemptId);
      setHasAttemptedPrint(true);

      if (method === 'native') {
        if (!canUseNative) throw new Error('The paired local printer does not support this paper profile. Choose browser printing or check the printer settings.');
        const result = await printShoppingListOnLocalAgent({
          printerName,
          snapshot,
          profile,
          attemptId: currentAttemptId,
          reprint,
          showPrices,
        });
        setStatus({
          kind: 'info',
          message: result.duplicate
            ? 'This attempt was already submitted; no duplicate job was sent. Choose Print another copy to create an explicit reprint attempt.'
            : `${result.message || 'Windows accepted the shopping-list job.'} This confirms spool submission only, not physical output.`,
        });
      } else {
        await printShoppingList(snapshot, profile, { showPrices });
        setStatus({ kind: 'info', message: 'The browser print dialog opened. Check the printer output; the browser cannot confirm that a page printed.' });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unable to submit the shopping list for printing.';
      setStatus({
        kind: 'error',
        message: `${detail} If the result is uncertain, use Print another copy to make an explicit new attempt.`,
      });
    } finally {
      workingRef.current = false;
      setWorking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-5" role="presentation">
      <button type="button" aria-label="Close shopping-list preview" className="absolute inset-0 bg-black/60" onClick={() => { if (!working) onClose(); }} />
      <section role="dialog" aria-modal="true" aria-labelledby="shopping-list-preview-title" className="relative flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <h2 id="shopping-list-preview-title" className="font-semibold text-gray-900">Shopping-list preview</h2>
            <p className="truncate text-xs text-gray-500">{snapshot.storeName} · {snapshot.items.length} item{snapshot.items.length === 1 ? '' : 's'} · {new Date(snapshot.createdAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <span>Paper</span>
            <select aria-label="Shopping-list paper profile" value={profile} onChange={(event) => setProfile(event.target.value as ShoppingListPaperProfile)} className="rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm">
              <option value="58mm">58 mm (32 columns)</option>
              <option value="80mm">80 mm (48 columns)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={showPrices} onChange={(event) => setShowPrices(event.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            Show prices
          </label>
          <Button variant="secondary" size="sm" disabled={working} icon={<RefreshCw className="h-4 w-4" />} onClick={onRefresh}>
            Refresh snapshot
          </Button>
          <button type="button" disabled={working} onClick={onClose} aria-label="Close shopping-list preview" className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 bg-gray-100 p-3 sm:flex-row sm:p-4">
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-lg bg-gray-200 p-3">
            <iframe title="Nonfiscal shopping-list document preview" srcDoc={markup} sandbox="" className="h-full min-h-[420px] w-full rounded border border-gray-300 bg-white" />
          </div>
          <aside className="flex w-full flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:w-72">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Print method</h3>
              <p className="mt-1 text-xs leading-5 text-gray-500">This list is a purchasing reference. It does not record a sale or change inventory.</p>
            </div>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-3 text-sm">
              <input type="radio" name="shopping-list-print-method" checked={method === 'browser'} onChange={() => setMethod('browser')} className="mt-0.5" />
              <span><strong className="block font-medium text-gray-900">Browser print</strong><span className="text-xs text-gray-500">Uses the selected width and opens the browser print dialog.</span></span>
            </label>
            <label className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${canUseNative ? 'cursor-pointer border-gray-200' : 'cursor-not-allowed border-gray-100 opacity-60'}`}>
              <input type="radio" name="shopping-list-print-method" checked={method === 'native'} onChange={() => { if (canUseNative) setMethod('native'); }} disabled={!canUseNative} className="mt-0.5" />
              <span><strong className="block font-medium text-gray-900">Configured POS printer</strong><span className="text-xs text-gray-500">{printerName || 'No printer is configured for this store.'}</span></span>
            </label>
            <Button variant="secondary" size="sm" loading={checkingAgent} disabled={working || checkingAgent} onClick={() => void checkLocalPrinter()}>
              Check local printer support
            </Button>
            {agentMessage && <p role="status" className="text-xs leading-5 text-gray-600">{agentMessage}</p>}
            {capabilities && !supportsSelectedProfile && <p role="status" className="text-xs leading-5 text-amber-800">This agent does not advertise the selected paper profile. Use browser printing or select a supported profile.</p>}
            {status && <p role={status.kind === 'error' ? 'alert' : 'status'} className={`rounded-lg p-3 text-xs leading-5 ${status.kind === 'error' ? 'bg-red-50 text-red-800' : 'bg-blue-50 text-blue-900'}`}>{status.message}</p>}
            <div className="mt-auto flex flex-col gap-2">
              <Button variant="primary" loading={working} disabled={working || (method === 'native' && !canUseNative)} icon={<Printer className="h-4 w-4" />} onClick={() => void handlePrint()}>
                {hasAttemptedPrint ? 'Print another copy (explicit reprint)' : 'Print shopping list'}
              </Button>
              <Button variant="ghost" disabled={working} onClick={onClose}>Close preview</Button>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
