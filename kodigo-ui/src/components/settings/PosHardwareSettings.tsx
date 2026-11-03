import { useEffect, useState } from 'react';
import { DoorOpen, Printer, RefreshCw } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { useToast } from '@/components/shared/Toast';
import { useAuthStore } from '@/stores/authStore';
import {
  clearLocalPrintAgentToken,
  findLocalPrinters,
  getLocalPrintAgentToken,
  getConfiguredDrawerPrinter,
  hasLocalPrintAgentToken,
  saveLocalPrintAgentToken,
  saveConfiguredDrawerPrinter,
  testCashDrawer,
} from '@/lib/hardware';
import type { Store } from '@/types';

export function PosHardwareSettings({ store }: { store: Store }) {
  const updatePosHardwareSettings = useAuthStore((state) => state.updatePosHardwareSettings);
  const { toast } = useToast();
  const [receiptPrintingEnabled, setReceiptPrintingEnabled] = useState(store.receiptPrintingEnabled !== false);
  const [cashDrawerIntegrationEnabled, setCashDrawerIntegrationEnabled] = useState(store.cashDrawerIntegrationEnabled !== false);
  const [availablePrinters, setAvailablePrinters] = useState<string[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState(() => getConfiguredDrawerPrinter(store.id));
  const [savedPrinter, setSavedPrinter] = useState(() => getConfiguredDrawerPrinter(store.id));
  const [searchingPrinters, setSearchingPrinters] = useState(false);
  const [testingDrawer, setTestingDrawer] = useState(false);
  const [pairingTokenSaved, setPairingTokenSaved] = useState(() => hasLocalPrintAgentToken());
  const [pairingToken, setPairingToken] = useState('');
  const [printerMessage, setPrinterMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setReceiptPrintingEnabled(store.receiptPrintingEnabled !== false);
    setCashDrawerIntegrationEnabled(store.cashDrawerIntegrationEnabled !== false);
    setSelectedPrinter(getConfiguredDrawerPrinter(store.id));
    setSavedPrinter(getConfiguredDrawerPrinter(store.id));
    setAvailablePrinters([]);
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

  const discoverPrinters = async () => {
    const token = pairingToken.trim() || getLocalPrintAgentToken();
    if (!token) {
      setPrinterMessage('Enter the pairing token shown by Kodigo Print Agent on this computer.');
      return;
    }
    setSearchingPrinters(true);
    setPrinterMessage('');
    try {
      const printers = await findLocalPrinters(token);
      saveLocalPrintAgentToken(token);
      setPairingToken('');
      setPairingTokenSaved(true);
      setAvailablePrinters(printers);
      if (printers.length === 0) {
        setPrinterMessage('Connected to Kodigo Print Agent, but Windows reported no printers. Install the printer driver and try again.');
      } else if (selectedPrinter && !printers.includes(selectedPrinter)) {
        setSelectedPrinter('');
        setPrinterMessage('The previously selected printer is not available on this computer. Choose one from the list.');
      } else {
        setPrinterMessage(`Connected. Found ${printers.length} printer${printers.length === 1 ? '' : 's'} on this computer.`);
      }
    } catch (error) {
      setPairingTokenSaved(hasLocalPrintAgentToken());
      setAvailablePrinters([]);
      setPrinterMessage(error instanceof Error ? error.message : 'Could not connect to Kodigo Print Agent. Start it on this computer and try again.');
    } finally {
      setSearchingPrinters(false);
    }
  };

  const unpairThisComputer = () => {
    clearLocalPrintAgentToken();
    setPairingTokenSaved(false);
    setPairingToken('');
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

  const saveLocalPrinter = () => {
    try {
      saveConfiguredDrawerPrinter(store.id, selectedPrinter);
      setSavedPrinter(selectedPrinter);
      toast('success', selectedPrinter ? `Drawer printer saved for this computer: ${selectedPrinter}.` : 'Local drawer printer selection cleared.');
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
        <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_auto_auto] sm:items-end">
          <label htmlFor="print-agent-token" className="block text-xs font-medium text-gray-600">
            Pair this checkout computer
            <input
              id="print-agent-token"
              name="print-agent-pairing-token"
              type="password"
              autoComplete="off"
              value={pairingToken}
              onChange={(event) => setPairingToken(event.target.value)}
              placeholder={pairingTokenSaved ? 'Token saved on this computer' : 'Paste the one-time token shown by the agent'}
              className="report-input mt-1"
            />
          </label>
          <Button type="button" variant="outline" loading={searchingPrinters} disabled={searchingPrinters} icon={<RefreshCw className="size-4" />} onClick={() => void discoverPrinters()}>
            {pairingTokenSaved ? 'Reconnect and find printers' : 'Pair and find printers'}
          </Button>
          {pairingTokenSaved && <Button type="button" variant="secondary" disabled={searchingPrinters} onClick={unpairThisComputer}>Forget this browser</Button>}
        </div>
        <p className="mb-3 text-xs leading-5 text-gray-500">Install and run Kodigo Print Agent on this computer first. Your browser may ask permission for Kodigo to access local devices; allow it to connect to the agent.</p>
        <div className="grid gap-3 sm:grid-cols-[minmax(12rem,1fr)_auto_auto] sm:items-end">
          <label htmlFor="pos-receipt-printer" className="block text-xs font-medium text-gray-600">
            Windows printer for receipts and drawer
            <select
              id="pos-receipt-printer"
              value={selectedPrinter}
              onChange={(event) => setSelectedPrinter(event.target.value)}
              className="report-input mt-1"
              disabled={!pairingTokenSaved || availablePrinters.length === 0}
            >
              <option value="">Choose a printer</option>
              {availablePrinters.map((printer) => <option key={printer} value={printer}>{printer}</option>)}
            </select>
          </label>
          <Button type="button" variant="secondary" disabled={!pairingTokenSaved || (!selectedPrinter && !savedPrinter)} onClick={saveLocalPrinter}>
            Save on this computer
          </Button>
          <Button type="button" variant="outline" loading={testingDrawer} disabled={!pairingTokenSaved || !selectedPrinter || testingDrawer} onClick={() => void runDrawerTest()}>
            Test drawer
          </Button>
        </div>
        <p role="status" aria-live="polite" aria-atomic="true" className="mt-2 min-h-5 text-xs text-gray-500">{printerMessage}</p>
        {savedPrinter && <p className="mt-2 text-xs text-green-700">Saved for this computer: {savedPrinter}</p>}
      </div>
    </section>
  );
}
