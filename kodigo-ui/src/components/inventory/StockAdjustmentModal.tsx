import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { useToast } from '@/components/shared/Toast';
import type { AdjustmentReason, ProductRestockingOption, ProductSellingOption, RestockResult } from '@/types';
import { getOptionInventoryMultiplier, isBulkSellingOption } from '@/types';

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
  restockingOptions?: ProductRestockingOption[];
  /** Retained for compatibility with older inventory page variants; stock is always product-level. */
  sellingOptions?: ProductSellingOption[];
  onClose: () => void;
  onSubmit: (sellingOptionId: string | undefined, delta: number, reason: AdjustmentReason, note: string, restock?: { restockingOptionId?: string; quantity: number; purchaseUnit: string; piecesPerUnit: number; totalSupplierCost?: number }) => Promise<RestockResult | void>;
  onUpdateSuggestedPrice?: (sellingPrice: number) => Promise<void>;
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
  productId,
  productName,
  currentStock,
  unit = 'piece',
  purchaseUnit,
  conversionFactor = 1,
  restockingOptions = [],
  sellingOptions = [],
  onClose,
  onSubmit,
  onUpdateSuggestedPrice,
}: StockAdjustmentModalProps) {
  const { toast } = useToast();
  const [mode, setMode] = useState<AdjustmentMode>('add');
  const [reason, setReason] = useState<AdjustmentReason>('restock');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [restockingOptionId, setRestockingOptionId] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [restockResult, setRestockResult] = useState<RestockResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode('add');
    setReason('restock');
    setQuantity('');
    setNote('');
    setRestockingOptionId('');
    setPurchasePrice('');
    setRestockResult(null);
  }, [open, productId]);

  const availableRestockingOptions = restockingOptions.length > 0
    ? restockingOptions.filter((option) => option.isActive)
    : purchaseUnit
      ? [{ id: '', productId, storeId: '', label: purchaseUnit, conversionFactor, isDefault: true, isActive: true }]
      : [{ id: '', productId, storeId: '', label: unit, conversionFactor: 1, isDefault: true, isActive: true }];
  const selectedRestockingOption = availableRestockingOptions.find((option) => option.id === restockingOptionId)
    || availableRestockingOptions.find((option) => option.isDefault)
    || availableRestockingOptions[0];
  const selectedPurchaseUnit = selectedRestockingOption?.label || unit;
  const selectedConversionFactor = selectedRestockingOption?.conversionFactor || 1;

  const rawNum = parseFloat(quantity) || 0;
  const unitQuantity = mode === 'add' ? rawNum * selectedConversionFactor : rawNum;
  const totalSupplierCost = parseFloat(purchasePrice) || 0;
  const supplierUnitCost = rawNum > 0 ? totalSupplierCost / rawNum : 0;
  const supplierBaseCost = unitQuantity > 0 ? totalSupplierCost / unitQuantity : 0;
  const deltaNum = mode === 'add'
    ? unitQuantity
    : mode === 'remove'
      ? -unitQuantity
    : unitQuantity - currentStock;
  const newStock = currentStock + deltaNum;
  const fixedPriceWarnings = restockResult
    ? sellingOptions.filter((option) => {
      if (!isBulkSellingOption(option) || option.pricingMethod !== 'fixed') return false;
      const bundlePrice = option.manualSellingPrice ?? option.sellingPrice;
      return bundlePrice < restockResult.newCostPerBaseUnit * getOptionInventoryMultiplier(option);
    })
    : [];

  const setAdjustmentMode = (nextMode: AdjustmentMode) => {
    setMode(nextMode);
    setQuantity('');
    setRestockingOptionId('');
    setRestockResult(null);
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
      const result = await onSubmit(undefined, deltaNum, reason, note, mode === 'add' ? {
        restockingOptionId: selectedRestockingOption?.id || undefined,
        quantity: rawNum,
        purchaseUnit: selectedPurchaseUnit,
        piecesPerUnit: selectedConversionFactor,
        totalSupplierCost: purchasePrice.trim() ? parseFloat(purchasePrice) || 0 : undefined,
      } : undefined);
      if (result && result.costChangePercent != null && Math.abs(result.costChangePercent) >= 0.01 && result.newCostPerBaseUnit !== result.previousCostPerBaseUnit) {
        setRestockResult(result);
      } else {
        const label = mode === 'add'
          ? `+${rawNum} ${selectedPurchaseUnit}${rawNum !== 1 ? 's' : ''} (${deltaNum} ${unit}s)`
          : `${deltaNum > 0 ? '+' : ''}${deltaNum} ${unit}`;
        toast('success', `Stock adjusted: ${label}.`);
        onClose();
        setQuantity('');
        setNote('');
        setAdjustmentMode('add');
      }
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
          <button type="button" onClick={onClose} aria-label="Close stock adjustment dialog" className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {restockResult ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                <div><p className="text-sm font-semibold text-amber-900">Supplier cost changed</p><p className="mt-1 text-xs leading-5 text-amber-800">Stock was added. Review the suggested selling price before you close this window.</p></div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
                <p className="font-semibold text-gray-900">Supplier cost {restockResult.costChangePercent && restockResult.costChangePercent > 0 ? 'increased' : 'changed'} by {Math.abs(restockResult.costChangePercent ?? 0).toFixed(1)}%</p>
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs"><div><p className="text-gray-500">Previous cost</p><p className="mt-1 font-mono font-semibold">₱{restockResult.previousCostPerBaseUnit.toFixed(2)} / {unit}</p></div><div><p className="text-gray-500">New cost</p><p className="mt-1 font-mono font-semibold">₱{restockResult.newCostPerBaseUnit.toFixed(2)} / {unit}</p></div><div><p className="text-gray-500">Previous gross margin</p><p className="mt-1 font-mono font-semibold">{(restockResult.previousGrossMargin * 100).toFixed(1)}%</p></div><div><p className="text-gray-500">New gross margin</p><p className="mt-1 font-mono font-semibold text-amber-700">{(restockResult.newGrossMargin * 100).toFixed(1)}%</p></div><div><p className="text-gray-500">Current selling price</p><p className="mt-1 font-mono font-semibold">₱{restockResult.currentSellingPrice.toFixed(2)}</p></div><div><p className="text-gray-500">Suggested selling price</p><p className="mt-1 font-mono font-semibold text-blue-700">₱{restockResult.suggestedSellingPrice.toFixed(2)}</p></div></div>
              </div>
              {fixedPriceWarnings.length > 0 && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800"><p className="font-semibold">Bundle price warning</p><p className="mt-1">These fixed bundle prices are now below the new supplier cost:</p><ul className="mt-2 list-disc space-y-1 pl-4">{fixedPriceWarnings.map((option) => <li key={option.id}>{option.label}: ₱{(option.manualSellingPrice ?? option.sellingPrice).toFixed(2)} current price; suggested at least ₱{(restockResult.newCostPerBaseUnit * getOptionInventoryMultiplier(option)).toFixed(2)}</li>)}</ul></div>}
              <div className="flex flex-col gap-2 sm:flex-row"><Button variant="secondary" type="button" onClick={() => { toast('info', 'Current selling price kept.'); onClose(); }} className="flex-1">Keep current price</Button><Button variant="primary" type="button" onClick={async () => { if (!onUpdateSuggestedPrice) return; setLoading(true); try { await onUpdateSuggestedPrice(restockResult.suggestedSellingPrice); toast('success', 'Selling price updated.'); onClose(); } catch (error) { toast('error', error instanceof Error ? error.message : 'Failed to update selling price.'); } finally { setLoading(false); } }} loading={loading} className="flex-1"><CheckCircle2 className="mr-1 h-4 w-4" />Update price</Button></div>
            </div>
          ) : <>
          {/* Product info */}
          <div className="bg-gray-50 rounded-xl px-4 py-3">
            <p className="font-medium text-gray-900 text-sm">{productName}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Current base stock: <span className="font-bold font-mono">{currentStock}</span>
              <span className="ml-1 text-gray-400">{unit}s</span>
            </p>
          </div>

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

          {mode === 'add' && <div><label htmlFor="restocking-unit" className="mb-1.5 block text-sm font-medium text-gray-700">Received as</label><select id="restocking-unit" value={selectedRestockingOption?.id || selectedPurchaseUnit} onChange={(event) => setRestockingOptionId(event.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">{availableRestockingOptions.map((option) => <option key={option.id || option.label} value={option.id || option.label}>{option.label} — 1 {option.label} = {option.conversionFactor} {unit}{option.conversionFactor === 1 ? '' : 's'}</option>)}</select></div>}

          {mode === 'add' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Total supplier cost for this delivery
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
              {rawNum > 0 && purchasePrice.trim() && <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-900"><div><p className="text-blue-700">Cost per {selectedPurchaseUnit}</p><p className="mt-0.5 font-mono font-semibold">₱{supplierUnitCost.toFixed(2)}</p></div><div><p className="text-blue-700">Cost per {unit}</p><p className="mt-0.5 font-mono font-semibold">₱{supplierBaseCost.toFixed(2)}</p></div></div>}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {mode === 'count'
                ? <>Exact count <span className="text-red-500">*</span></>
                : <>{mode === 'add' ? selectedPurchaseUnit : unit} quantity <span className="text-red-500">*</span></>}
            </label>
            <input
              type="number"
              className="w-full px-3 py-2 text-sm font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder={mode === 'count' ? `Current ${unit} count` : '0'}
              min={0}
              step="1"
            />
            {rawNum > 0 && mode === 'add' && (
              <p className="mt-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-xs text-blue-700">
                <strong className="font-mono">{rawNum} {selectedPurchaseUnit}{rawNum === 1 ? '' : 's'} × {selectedConversionFactor} = {deltaNum} {unit}{deltaNum === 1 ? '' : 's'}</strong> will be added to inventory.
              </p>
            )}
            {deltaNum !== 0 && (
              <p className={`text-xs mt-1 font-medium ${newStock < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                New base stock: <span className="font-mono font-bold">{newStock}</span> {unit}s
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
              {mode === 'add' ? 'Receive stock' : 'Apply adjustment'}
            </Button>
          </div>
          </>}
        </form>
      </div>
    </div>
  );
}
