import { useEffect, useState } from 'react';
import { DoorOpen, Printer, RefreshCw } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { useToast } from '@/components/shared/Toast';
import { useAuthStore } from '@/stores/authStore';
import { findLocalReceiptPrinters, getConfiguredReceiptPrinter, saveConfiguredReceiptPrinter } from '@/lib/hardware';
import type { Store } from '@/types';

export function PosHardwareSettings({ store }: { store: Store }) {
  const updatePosHardwareSettings = useAuthStore((state) => state.updatePosHardwareSettings);
  const { toast } = useToast();
  const [receiptPrintingEnabled, setReceiptPrintingEnabled] = useState(store.receiptPrintingEnabled !== false);
  const [cashDrawerIntegrationEnabled, setCashDrawerIntegrationEnabled] = useState(store.cashDrawerIntegrationEnabled !== false);
  const [availablePrinters, setAvailablePrinters] = useState<string[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState(() => getConfiguredReceiptPrinter(store.id));
  const [savedPrinter, setSavedPrinter] = useState(() => getConfiguredReceiptPrinter(store.id));
  const [searchingPrinters, setSearchingPrinters] = useState(false);
  const [printerMessage, setPrinterMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setReceiptPrintingEnabled(store.receiptPrintingEnabled !== false);
    setCashDrawerIntegrationEnabled(store.cashDrawerIntegrationEnabled !== false);
    setSelectedPrinter(getConfiguredReceiptPrinter(store.id));
    setSavedPrinter(getConfiguredReceiptPrinter(store.id));
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
    setSearchingPrinters(true);
    setPrinterMessage('');
    try {
      const printers = await findLocalReceiptPrinters();
      setAvailablePrinters(printers);
      if (printers.length === 0) {
        setPrinterMessage('QZ Tray connected, but no Windows printers were found. Check that the Xprinter driver is installed.');
      } else if (selectedPrinter && !printers.includes(selectedPrinter)) {
        setSelectedPrinter('');
        setPrinterMessage('The previously selected printer is not available on this computer. Choose one from the list.');
      } else {
        setPrinterMessage(`Found ${printers.length} printer${printers.length === 1 ? '' : 's'} on this computer.`);
      }
    } catch (error) {
      setPrinterMessage(error instanceof Error
        ? `Could not connect to QZ Tray. Install and open QZ Tray on this computer, then try again. ${error.message}`
        : 'Could not connect to QZ Tray. Install and open QZ Tray on this computer, then try again.');
    } finally {
      setSearchingPrinters(false);
    }
  };

  const saveLocalPrinter = () => {
    try {
      saveConfiguredReceiptPrinter(store.id, selectedPrinter);
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
            <span className="mt-1 block text-xs leading-5 text-gray-500">Send a drawer pulse through the selected receipt printer after a cash sale. Cash payments stay available when this is off.</span>
          </span>
        </label>
      </div>
      <div className="mt-4 flex justify-end">
        <Button type="button" variant="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>Save hardware settings</Button>
      </div>
      <div className="mt-5 border-t border-gray-100 pt-5">
        <div className="mb-3">
          <h4 className="text-sm font-semibold text-gray-900">Printer for the cash drawer on this computer</h4>
          <p className="mt-1 text-xs leading-5 text-gray-500">This device-only selection routes drawer pulses to the XP-58IIH. Receipts still use the browser print flow, so set the Xprinter as the Windows default printer. Install and open QZ Tray and the Xprinter driver first; the browser may ask to allow local network access or QZ Tray.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(12rem,1fr)_auto_auto] sm:items-end">
          <label htmlFor="pos-receipt-printer" className="block text-xs font-medium text-gray-600">
            Printer that drives the drawer
            <select
              id="pos-receipt-printer"
              value={selectedPrinter}
              onChange={(event) => setSelectedPrinter(event.target.value)}
              className="report-input mt-1"
              disabled={availablePrinters.length === 0}
            >
              <option value="">Choose a printer</option>
              {availablePrinters.map((printer) => <option key={printer} value={printer}>{printer}</option>)}
            </select>
          </label>
          <Button type="button" variant="outline" loading={searchingPrinters} icon={<RefreshCw className="size-4" />} onClick={() => void discoverPrinters()}>
            Find printers
          </Button>
          <Button type="button" variant="secondary" disabled={!selectedPrinter && !savedPrinter} onClick={saveLocalPrinter}>
            Save on this computer
          </Button>
        </div>
        {printerMessage && <p role="status" className="mt-2 text-xs text-gray-500">{printerMessage}</p>}
        {savedPrinter && <p className="mt-2 text-xs text-green-700">Saved for this computer: {savedPrinter}</p>}
      </div>
    </section>
  );
}
