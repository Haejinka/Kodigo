import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DoorOpen, Printer, RefreshCw } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { useToast } from '@/components/shared/Toast';
import { useAuthStore } from '@/stores/authStore';
import {
  clearLocalPrintAgentToken,
  connectLocalPrinters,
  getConfiguredDrawerPrinter,
  hasLocalPrintAgentToken,
  saveConfiguredDrawerPrinter,
  testCashDrawer,
} from '@/lib/hardware';
import type { Store } from '@/types';

export function PosHardwareSettings({ store }: { store: Store }) {
  const updatePosHardwareSettings = useAuthStore((state) => state.updatePosHardwareSettings);
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const autoSetupStarted = useRef(false);
  const [receiptPrintingEnabled, setReceiptPrintingEnabled] = useState(store.receiptPrintingEnabled !== false);
  const [cashDrawerIntegrationEnabled, setCashDrawerIntegrationEnabled] = useState(store.cashDrawerIntegrationEnabled !== false);
  const [availablePrinters, setAvailablePrinters] = useState<string[]>([]);
  const [unavailablePrinters, setUnavailablePrinters] = useState<string[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState(() => getConfiguredDrawerPrinter(store.id));
  const [savedPrinter, setSavedPrinter] = useState(() => getConfiguredDrawerPrinter(store.id));
  const [searchingPrinters, setSearchingPrinters] = useState(false);
  const [testingDrawer, setTestingDrawer] = useState(false);
  const [pairingTokenSaved, setPairingTokenSaved] = useState(() => hasLocalPrintAgentToken());
  const [printerMessage, setPrinterMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setReceiptPrintingEnabled(store.receiptPrintingEnabled !== false);
    setCashDrawerIntegrationEnabled(store.cashDrawerIntegrationEnabled !== false);
    setSelectedPrinter(getConfiguredDrawerPrinter(store.id));
    setSavedPrinter(getConfiguredDrawerPrinter(store.id));
    setAvailablePrinters([]);
    setUnavailablePrinters([]);
    setPrinterMessage('');
  }, [store.cashDrawerIntegrationEnabled, store.id, store.receiptPrintingEnabled]);

  const dirty = receiptPrintingEnabled !== (store.receiptPrintingEnabled !== false)
    || cashDrawerIntegrationEnabled !== (store.cashDrawerIntegrationEnabled !== false);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await updatePosHardwareSettings(store.id, {
        receiptPrintingEnabled,
        cashDrawerIntegrationEnabled,
      });
      if (!saved) throw new Error('Could not save POS hardware settings.');
      toast('success', 'POS hardware settings saved.');
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Could not save POS hardware settings.');
    } finally {
      setSaving(false);
    }
  };

  const connectAndFindPrinters = useCallback(async () => {
    setSearchingPrinters(true);
    setPrinterMessage('');
    try {
      const { printers, unavailablePrinters: unavailable } = await connectLocalPrinters();
      setPairingTokenSaved(true);
      setAvailablePrinters(printers);
      setUnavailablePrinters(unavailable);
      if (printers.length === 0) {
        setPrinterMessage('Connected, but Windows has no installed printers. Install the printer driver, then reconnect.');
      } else {
        const preferredPrinter = printers.find((printer) => !unavailable.includes(printer) && /xprinter\s*xp\s*[- ]?58/i.test(printer))
          ?? printers.find((printer) => !unavailable.includes(printer))
          ?? (printers.length === 1 ? printers[0] : '');
        const currentPrinter = selectedPrinter && printers.includes(selectedPrinter) ? selectedPrinter : '';
        const nextPrinter = currentPrinter || preferredPrinter;
        if (nextPrinter && unavailable.includes(nextPrinter)) {
          setSelectedPrinter(nextPrinter);
          setPrinterMessage(`Windows reports ${nextPrinter} is offline or unavailable. Check its USB cable or port and the Windows print queue, then reconnect this computer.`);
        } else if (nextPrinter) {
          saveConfiguredDrawerPrinter(store.id, nextPrinter);
          setSelectedPrinter(nextPrinter);
          setSavedPrinter(nextPrinter);
          setPrinterMessage(`Connected and saved ${nextPrinter} for this store on this computer.`);
        } else if (printers.length > 0 && unavailable.length === printers.length) {
          setSelectedPrinter('');
          setPrinterMessage('Windows reports all installed printers are offline or unavailable. Check their connections and Windows print queues, then reconnect this computer.');
        } else {
          setSelectedPrinter('');
          setPrinterMessage(`Connected. Found ${printers.length} printers; choose the one connected to the receipt paper and drawer.`);
        }
      }
    } catch (error) {
      setPairingTokenSaved(hasLocalPrintAgentToken());
      setAvailablePrinters([]);
      setUnavailablePrinters([]);
      setPrinterMessage(error instanceof Error
        ? error.message
        : 'Could not connect. Download and open Kodigo Print Setup, then try again.');
    } finally {
      setSearchingPrinters(false);
    }
  }, [selectedPrinter, store.id]);

  useEffect(() => {
    if (autoSetupStarted.current || new URLSearchParams(location.search).get('setupPrinter') !== '1') return;
    autoSetupStarted.current = true;
    const query = new URLSearchParams(location.search);
    query.delete('setupPrinter');
    navigate({ pathname: location.pathname, search: query.size > 0 ? `?${query.toString()}` : '' }, { replace: true });
    void connectAndFindPrinters();
  }, [connectAndFindPrinters, location.pathname, location.search, navigate]);

  const unpairThisComputer = () => {
    clearLocalPrintAgentToken();
    setPairingTokenSaved(false);
    setAvailablePrinters([]);
    setPrinterMessage('This browser is no longer paired with Kodigo Print Agent.');
  };

  const runDrawerTest = async () => {
    if (!selectedPrinter || !window.confirm(`Send a cash-drawer pulse to ${selectedPrinter}? This may open the drawer.`)) return;
    setTestingDrawer(true);
    setPrinterMessage('');
    try {
      const result = await testCashDrawer(selectedPrinter);
      setPrinterMessage(result.message || 'Drawer test pulse sent. Check that the drawer opened.');
    } catch (error) {
      setPrinterMessage(error instanceof Error ? error.message : 'Could not send the drawer test pulse.');
    } finally {
      setTestingDrawer(false);
    }
  };

  const selectLocalPrinter = (printerName: string) => {
    try {
      saveConfiguredDrawerPrinter(store.id, printerName);
      setSelectedPrinter(printerName);
      setSavedPrinter(printerName);
      setPrinterMessage(`Saved ${printerName} for this store on this computer.`);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Could not save the local printer selection.');
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="font-semibold text-gray-900">POS hardware</h3>
        <p className="mt-1 text-sm text-gray-500">Choose which peripheral actions the POS runs after saving a sale at {store.name}.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor="enable-receipt-printing" className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3">
          <input
            id="enable-receipt-printing"
            type="checkbox"
            checked={receiptPrintingEnabled}
            onChange={(event) => setReceiptPrintingEnabled(event.target.checked)}
            className="mt-0.5 size-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-sm font-medium text-gray-900"><Printer className="size-4 text-gray-500" />Enable Receipt Printing</span>
            <span className="mt-1 block text-xs leading-5 text-gray-500">Automatically open the receipt print flow after a sale. Saved receipts remain available when this is off.</span>
          </span>
        </label>
        <label htmlFor="enable-cash-drawer-integration" className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3">
          <input
            id="enable-cash-drawer-integration"
            type="checkbox"
            checked={cashDrawerIntegrationEnabled}
            onChange={(event) => setCashDrawerIntegrationEnabled(event.target.checked)}
            className="mt-0.5 size-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-sm font-medium text-gray-900"><DoorOpen className="size-4 text-gray-500" />Enable Cash Drawer Integration</span>
            <span className="mt-1 block text-xs leading-5 text-gray-500">Send a drawer pulse after a cash sale when this checkout computer is paired and its drawer printer is selected.</span>
          </span>
        </label>
      </div>
      <div className="mt-4 flex justify-end">
        <Button type="button" variant="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>Save hardware settings</Button>
      </div>
      <div className="mt-5 border-t border-gray-100 pt-5">
        <div className="mb-3">
          <h4 className="text-sm font-semibold text-gray-900">Printer for receipts and cash drawer on this computer</h4>
          <p className="mt-1 text-xs leading-5 text-gray-500">Kodigo Print Agent sends 58 mm receipts and drawer pulses directly to the selected Windows printer. Thermal receipts print without opening the browser preview; standard page receipts use the browser print dialog.</p>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <a
            href="https://github.com/Haejinka/Kodigo/releases/latest/download/Kodigo-Print-Setup-win-x64.exe"
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            Download Windows setup (.exe)
          </a>
          <Button type="button" variant="primary" loading={searchingPrinters} disabled={searchingPrinters} icon={<RefreshCw className="size-4" />} onClick={() => void connectAndFindPrinters()}>
            {pairingTokenSaved ? 'Reconnect this computer' : 'Connect this computer'}
          </Button>
          {pairingTokenSaved && <Button type="button" variant="secondary" disabled={searchingPrinters} onClick={unpairThisComputer}>Forget this browser</Button>}
        </div>
        <p className="mb-3 text-xs leading-5 text-gray-500">Open setup once. It returns here and connects automatically; click Connect this computer if you opened Settings later. Kodigo selects the XP-58 when detected. If the browser asks for local network access, choose Allow.</p>
        <div className="grid gap-3 sm:grid-cols-[minmax(12rem,1fr)_auto_auto] sm:items-end">
          <label htmlFor="pos-receipt-printer" className="block text-xs font-medium text-gray-600">
            Windows printer for receipts and drawer
            <select
              id="pos-receipt-printer"
              value={selectedPrinter}
              onChange={(event) => selectLocalPrinter(event.target.value)}
              className="report-input mt-1"
              disabled={!pairingTokenSaved || availablePrinters.length === 0}
            >
              <option value="">Choose a printer</option>
              {availablePrinters.map((printer) => <option key={printer} value={printer} disabled={unavailablePrinters.includes(printer)}>{printer}{unavailablePrinters.includes(printer) ? ' (offline)' : ''}</option>)}
            </select>
          </label>
          <Button type="button" variant="outline" loading={testingDrawer} disabled={!pairingTokenSaved || !selectedPrinter || testingDrawer || unavailablePrinters.includes(selectedPrinter)} onClick={() => void runDrawerTest()}>
            Test drawer
          </Button>
        </div>
        <p role="status" aria-live="polite" aria-atomic="true" className="mt-2 min-h-5 text-xs text-gray-500">{printerMessage}</p>
        {savedPrinter && <p className={`mt-2 text-xs ${unavailablePrinters.includes(savedPrinter) ? 'text-amber-700' : 'text-green-700'}`}>Saved for this computer: {savedPrinter}{unavailablePrinters.includes(savedPrinter) ? ' (offline)' : ''}</p>}
      </div>
    </section>
  );
}
