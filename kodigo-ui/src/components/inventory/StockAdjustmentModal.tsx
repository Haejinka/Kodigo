import { useEffect, useState } from 'react';
import { X, Package } from 'lucide-react';
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
  { value: 'damaged', label: 'Damaged' },
  { value: 'expired', label: 'Expired' },
  { value: 'lost', label: 'Lost / Missing' },
  { value: 'manual-count', label: 'Manual Count Correction' },
  { value: 'restock', label: 'Restock / Add Stock' },
  { value: 'other', label: 'Other' },
];

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
  const [reason, setReason] = useState<AdjustmentReason>('manual-count');
  const [delta, setDelta] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedOptionId, setSelectedOptionId] = useState<string | undefined>(undefined);
  /** When true and reason===restock, the user enters qty in purchase units (packs/boxes) */
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
  const isRestock = reason === 'restock';

  // Final delta always in selling units (pieces)
  const rawNum = parseInt(delta) || 0;
  const deltaNum = bulkMode && isRestock ? rawNum * conversionFactor : rawNum;
  const newStock = effectiveStock + deltaNum;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (deltaNum === 0) { toast('warning', 'Quantity change cannot be zero.'); return; }
    if (newStock < 0) { toast('error', 'Resulting stock cannot be negative.'); return; }
    setLoading(true);
    try {
      await onSubmit(selectedOption?.id, deltaNum, reason, note, isRestock ? {
        quantity: bulkMode ? rawNum : deltaNum,
        purchaseUnit: bulkMode ? purchaseUnit! : effectiveUnit,
        piecesPerUnit: bulkMode ? conversionFactor : 1,
        purchasePricePerUnit: parseFloat(purchasePrice) || 0,
      } : undefined);
      const label = bulkMode && isRestock
        ? `+${rawNum} ${purchaseUnit}${rawNum !== 1 ? 's' : ''} (${deltaNum} ${unit}s)`
        : `${deltaNum > 0 ? '+' : ''}${deltaNum} ${effectiveUnit}`;
      toast('success', `Stock adjusted: ${label}.`);
      onClose();
      setDelta('');
      setNote('');
      setBulkMode(false);
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
                  setDelta('');
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

          {/* Reason */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Reason <span className="text-red-500">*</span></label>
            <select
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value as AdjustmentReason);
                setBulkMode(false);
                setDelta('');
              }}
            >
              {reasons.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          {/* Bulk-unit toggle — only on restock for products with conversion */}
          {isRestock && hasBulkUnit && (
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-gray-300 accent-blue-600"
                checked={bulkMode}
                onChange={(e) => { setBulkMode(e.target.checked); setDelta(''); }}
              />
              <span className="text-sm text-gray-700">
                Enter quantity in <strong>{purchaseUnit}s</strong> (1 {purchaseUnit} = {conversionFactor} {unit}s)
              </span>
            </label>
          )}

          {isRestock && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Purchase Price per {bulkMode ? purchaseUnit : effectiveUnit}
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                required
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
              <p className="mt-1 text-xs text-gray-400">Updates the product purchase price and recalculates automatic selling prices.</p>
            </div>
          )}

          {/* Quantity */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {bulkMode && isRestock
                ? <>{purchaseUnit}s received <span className="text-red-500">*</span><span className="text-xs font-normal text-gray-400 ml-2">(will be converted to {unit}s)</span></>
                : <>{effectiveUnit} change <span className="text-red-500">*</span><span className="text-xs font-normal text-gray-400 ml-2">(use negative for removal)</span></>}
            </label>
            <input
              type="number"
              className="w-full px-3 py-2 text-sm font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder={bulkMode && isRestock ? `e.g. 3 ${purchaseUnit}s` : isRestock ? '+50' : '-5'}
              min={bulkMode ? 1 : undefined}
            />
            {rawNum > 0 && bulkMode && isRestock && (
              <div className="flex items-center gap-1.5 mt-1.5 bg-blue-50 rounded-lg px-3 py-1.5">
                <Package className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <p className="text-xs text-blue-700">
                  {rawNum} {purchaseUnit}{rawNum !== 1 ? 's' : ''} &times; {conversionFactor} = <strong className="font-mono">+{deltaNum} {unit}s</strong> added to stock
                </p>
              </div>
            )}
            {deltaNum !== 0 && (
              <p className={`text-xs mt-1 font-medium ${newStock < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                New stock: <span className="font-mono font-bold">{newStock}</span> {effectiveUnit}
              </p>
            )}
          </div>

          {/* Note */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Note / Memo</label>
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
