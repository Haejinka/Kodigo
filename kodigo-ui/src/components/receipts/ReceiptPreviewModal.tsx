import { useState } from 'react';
import { Download, Printer, X } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { useToast } from '@/components/shared/Toast';
import {
  buildReceiptHtml,
  downloadReceiptPdf,
  printReceipt,
  recordReceiptOutput,
} from '@/lib/receipts';
import type { ReceiptLayout } from '@/lib/receipts';
import type { ReceiptSnapshot } from '@/types';

export function ReceiptPreviewModal({
  open,
  snapshot,
  saleId,
  onClose,
  trackReprint = false,
}: {
  open: boolean;
  snapshot: ReceiptSnapshot | null;
  saleId: string;
  onClose: () => void;
  trackReprint?: boolean;
}) {
  const { toast } = useToast();
  const [layout, setLayout] = useState<ReceiptLayout>('thermal');
  const [working, setWorking] = useState<'print' | 'pdf' | null>(null);

  if (!open || !snapshot) return null;

  const record = async (type: 'print' | 'pdf') => {
    if (!trackReprint) return;
    await recordReceiptOutput(saleId, type, 'Reprinted from sales history');
  };

  const handlePrint = async () => {
    setWorking('print');
    try {
      await record('print');
      printReceipt(snapshot, layout);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Unable to print receipt.');
    } finally {
      setWorking(null);
    }
  };

  const handlePdf = async () => {
    setWorking('pdf');
    try {
      await record('pdf');
      await downloadReceiptPdf(snapshot, layout);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Unable to download receipt PDF.');
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-gray-900">Receipt preview</h2>
            <p className="truncate font-mono text-xs text-gray-500">{snapshot.sale.receipt_number || snapshot.sale.id}</p>
          </div>
          <div className="flex rounded-lg bg-gray-100 p-1 text-sm">
            {(['thermal', 'standard'] as ReceiptLayout[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setLayout(option)}
                className={`rounded-md px-3 py-1.5 capitalize ${layout === option ? 'bg-white font-medium text-blue-700 shadow-sm' : 'text-gray-500'}`}
              >
                {option}
              </button>
            ))}
          </div>
          <Button variant="secondary" onClick={handlePdf} loading={working === 'pdf'} icon={<Download className="h-4 w-4" />}>
            PDF
          </Button>
          <Button variant="primary" onClick={handlePrint} loading={working === 'print'} icon={<Printer className="h-4 w-4" />}>
            Print
          </Button>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 overflow-hidden bg-gray-100 p-4">
          <iframe
            key={layout}
            title="Receipt preview"
            srcDoc={buildReceiptHtml(snapshot, layout)}
            className="h-full w-full rounded-lg border border-gray-200 bg-white"
          />
        </div>
      </div>
    </div>
  );
}
