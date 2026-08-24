import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { useToast } from '@/components/shared/Toast';
import type { AdjustmentReason, ProductSellingOption } from '@/types';
import { getSellingOptionLabel, getSellingOptionStockLabel } from '@/types';

interface StockAdjustmentModalProps {
  open: boolean;
  productId: string;
  productName: string;
  currentStock: number;
  /** Selling unit label, e.g. "piece", "stick" */
  unit?: string;
  /** Purchase unit label, e.g. "pack", "box" — only present on bulk-split products */
  purchaseUnit?: string;
  /** How many selling units are in one purchase unit */
  conversionFactor?: number;
  bulkPurchasePrice?: number;
  sellingOptions?: ProductSellingOption[];
  onClose: () => void;
  onSubmit: (sellingOptionId: string | undefined, delta: number, reason: AdjustmentReason, note: string, restock?: { quantity: number; purchaseUnit: string; piecesPerUnit: number; purchasePricePerUnit: number }) => Promise<void>;
}

const reasons: { value: AdjustmentReason; label: string }[] = [
  { value: 'restock', label: 'Restock / Add Stock' },
  { value: 'lost', label: 'Lost / Missing' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'expired', label: 'Expired' },
  { value: 'manual-count', label: 'Manual Count Correction' },
  { value: 'other', label: 'Other' },
];

type AdjustmentMode = 'add' | 'remove' | 'count';

export function StockAdjustmentModal({
  open,
  productName,
  currentStock,
  unit = 'piece',
  purchaseUnit,
  conversionFactor = 1,
  bulkPurchasePrice = 0,
  sellingOptions = [],
  onClose,
  onSubmit,
}: StockAdjustmentModalProps) {
  const { toast } = useToast();
  const [mode, setMode] = useState<AdjustmentMode>('add');
  const [reason, setReason] = useState<AdjustmentReason>('restock');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedOptionId, setSelectedOptionId] = useState<string | undefined>(undefined);
  const [bulkMode, setBulkMode] = useState(false);
  const [purchasePrice, setPurchasePrice] = useState(String(bulkPurchasePrice || ''));

  const options = sellingOptions.length > 0
    ? sellingOptions.filter((option) => option.isActive)
    : [];
  const selectedOption = options.find((option) => option.id === selectedOptionId)
    ?? options.find((option) => option.isDefault)
    ?? options[0];
  const effectiveStock = selectedOption?.stockQuantity ?? currentStock;
  const effectiveUnit = selectedOption?.unitLabel ?? unit;

  useEffect(() => {
    if (!open) return;
    const activeOptions = sellingOptions.filter((option) => option.isActive);
    const fallback = activeOptions.find((option) => option.isDefault) ?? activeOptions[0];
    setSelectedOptionId(fallback?.id);
  }, [open, sellingOptions]);

  const hasBulkUnit = !!purchaseUnit && conversionFactor > 1;

  const rawNum = parseFloat(quantity) || 0;
  const unitQuantity = bulkMode && mode === 'add' ? rawNum * conversionFactor : rawNum;
  const deltaNum = mode === 'add'
    ? unitQuantity
    : mode === 'remove'
      ? -unitQuantity
      : unitQuantity - effectiveStock;
  const newStock = effectiveStock + deltaNum;

  const setAdjustmentMode = (nextMode: AdjustmentMode) => {
    setMode(nextMode);
    setQuantity('');
    setBulkMode(false);
    setReason(nextMode === 'add' ? 'restock' : nextMode === 'remove' ? 'lost' : 'manual-count');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rawNum <= 0 && mode !== 'count') { toast('warning', 'Enter a quantity greater than zero.'); return; }
    if (mode === 'count' && quantity.trim() === '') { toast('warning', 'Enter the counted stock.'); return; }
    if (newStock < 0) { toast('error', 'Resulting stock cannot be negative.'); return; }
    if (deltaNum === 0) { toast('warning', 'Stock is already at that count.'); return; }
    setLoading(true);
    try {
      await onSubmit(selectedOption?.id, deltaNum, reason, note, mode === 'add' ? {
        quantity: bulkMode ? rawNum : deltaNum,
        purchaseUnit: bulkMode ? purchaseUnit! : effectiveUnit,
        piecesPerUnit: bulkMode ? conversionFactor : 1,
        purchasePricePerUnit: parseFloat(purchasePrice) || 0,
      } : undefined);
      const label = bulkMode && mode === 'add'
        ? `+${rawNum} ${purchaseUnit}${rawNum !== 1 ? 's' : ''} (${deltaNum} ${unit}s)`
        : `${deltaNum > 0 ? '+' : ''}${deltaNum} ${effectiveUnit}`;
      toast('success', `Stock adjusted: ${label}.`);
      onClose();
      setQuantity('');
      setNote('');
      setBulkMode(false);
      setAdjustmentMode('add');
    } catch (error: unknown) {
      toast('error', error instanceof Error ? error.message : 'Failed to adjust stock.');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">Adjust Stock</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Product info */}
          <div className="bg-gray-50 rounded-xl px-4 py-3">
            <p className="font-medium text-gray-900 text-sm">{productName}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Current stock: <span className="font-bold font-mono">{effectiveStock}</span>
              <span className="ml-1 text-gray-400">{effectiveUnit}</span>
            </p>
          </div>

          {options.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Selling Option</label>
              <select
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={selectedOption?.id ?? ''}
                onChange={(e) => {
                  setSelectedOptionId(e.target.value || undefined);
                  setQuantity('');
                  setBulkMode(false);
                }}
              >
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {getSellingOptionLabel(option)} - {getSellingOptionStockLabel(option)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">What changed?</label>
            <div className="grid grid-cols-3 gap-2 rounded-xl bg-gray-100 p-1">
              {[
                { value: 'add' as const, label: 'Add' },
                { value: 'remove' as const, label: 'Remove' },
                { value: 'count' as const, label: 'Set Count' },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setAdjustmentMode(item.value)}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                    mode === item.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {mode === 'add' && hasBulkUnit && (
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-gray-300 accent-blue-600"
                checked={bulkMode}
                onChange={(e) => { setBulkMode(e.target.checked); setQuantity(''); }}
              />
              <span className="text-sm text-gray-700">
                Received in {purchaseUnit}s
              </span>
            </label>
          )}

          {mode === 'add' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Purchase Price per {bulkMode ? purchaseUnit : effectiveUnit}
                <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {mode === 'count'
                ? <>Exact count <span className="text-red-500">*</span></>
                : <>{bulkMode && mode === 'add' ? purchaseUnit : effectiveUnit} quantity <span className="text-red-500">*</span></>}
            </label>
            <input
              type="number"
              className="w-full px-3 py-2 text-sm font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder={mode === 'count' ? `Current ${effectiveUnit} count` : '0'}
              min={0}
              step="0.001"
            />
            {rawNum > 0 && bulkMode && mode === 'add' && (
              <p className="mt-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-xs text-blue-700">
                Adds <strong className="font-mono">{deltaNum} {unit}s</strong>
              </p>
            )}
            {deltaNum !== 0 && (
              <p className={`text-xs mt-1 font-medium ${newStock < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                New stock: <span className="font-mono font-bold">{newStock}</span> {effectiveUnit}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Reason</label>
            <select
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={reason}
              onChange={(e) => setReason(e.target.value as AdjustmentReason)}
            >
              {reasons.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Note <span className="text-xs font-normal text-gray-400">(optional)</span></label>
            <textarea
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note for audit trail…"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <Button variant="secondary" type="button" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={loading} className="flex-1">
              Apply Adjustment
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
