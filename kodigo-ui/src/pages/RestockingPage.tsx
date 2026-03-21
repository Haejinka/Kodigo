import { useMemo, useState } from 'react';
import { ShoppingCart, RefreshCw, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/shared/Button';
import { Badge } from '@/components/shared/Badge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { useToast } from '@/components/shared/Toast';
import { formatCurrency } from '@/lib/utils';
import { useProductStore } from '@/stores/productStore';
import { useSupplierStore } from '@/stores/supplierStore';
import type { RestockItem } from '@/types';

const urgencyVariant: Record<string, 'danger' | 'warning' | 'info'> = {
  high: 'danger',
  medium: 'warning',
  low: 'info',
};

/** Derive restock items from current product data. */
function useRestockItems(): RestockItem[] {
  const products = useProductStore((s) => s.products);
  return useMemo(() => {
    return products
      .filter((p) => p.currentStock <= p.reorderLevel)
      .map((p) => {
        const suggestedQty = Math.max(p.reorderLevel * 2 - p.currentStock, p.reorderLevel);
        const urgency: RestockItem['urgency'] =
          p.currentStock === 0 || p.currentStock <= p.safetyStock
            ? 'high'
            : p.currentStock <= p.minStockLevel
            ? 'medium'
            : 'low';
        return {
          productId: p.id,
          productName: p.name,
          currentStock: p.currentStock,
          suggestedQty,
          suggestedSupplierId: p.supplierId ?? '',
          suggestedSupplierName: p.supplierName ?? 'No supplier assigned',
          estimatedCost: suggestedQty * (p.costPrice / (p.conversionFactor ?? 1)),
          urgency,
          unit: p.unit,
          purchaseUnit: p.purchaseUnit,
          conversionFactor: p.conversionFactor,
        };
      })
      .sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return order[a.urgency] - order[b.urgency];
      });
  }, [products]);
}

export function RestockingPage() {
  const { toast } = useToast();
  const items = useRestockItems();
  const products = useProductStore((s) => s.products);
  const { createPurchaseOrder, recalculatePriceScores } = useSupplierStore();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(items.map((i) => i.productId)));
  const clearAll = () => setSelected(new Set());

  const selectedItems = items.filter((i) => selected.has(i.productId));
  const totalCost = selectedItems.reduce((s, i) => s + i.estimatedCost, 0);

  const handleCreatePO = async () => {
    setCreating(true);

    // Group selected items by supplier
    const grouped = new Map<string, { supplierId: string; supplierName: string; items: RestockItem[] }>();
    for (const item of selectedItems) {
      const key = item.suggestedSupplierId || '__unassigned__';
      if (!grouped.has(key)) {
        grouped.set(key, {
          supplierId: item.suggestedSupplierId,
          supplierName: item.suggestedSupplierName,
          items: [],
        });
      }
      grouped.get(key)!.items.push(item);
    }

    // Create one PO per supplier group
    for (const group of grouped.values()) {
      if (!group.supplierId) continue; // skip unassigned
      createPurchaseOrder(
        group.supplierId,
        group.supplierName,
        group.items.map((i) => ({
          productId: i.productId,
          productName: i.productName,
          quantity: i.suggestedQty,
          unitCost: i.estimatedCost / i.suggestedQty,
        })),
      );
    }

    // Refresh relative price scores now that new POs exist
    recalculatePriceScores(products);

    const poCount = [...grouped.values()].filter((g) => g.supplierId).length;
    toast(
      'success',
      `${poCount} purchase order${poCount !== 1 ? 's' : ''} created for ${selectedItems.length} product${selectedItems.length !== 1 ? 's' : ''} (${formatCurrency(totalCost)})`,
    );
    setCreating(false);
    setConfirmOpen(false);
    clearAll();
  };

  return (
    <div>
      <PageHeader
        title="Restocking"
        subtitle={`${items.length} product${items.length !== 1 ? 's' : ''} need restocking`}
        actions={
          <Button
            variant="primary"
            icon={<ShoppingCart className="w-4 h-4" />}
            disabled={selected.size === 0}
            onClick={() => setConfirmOpen(true)}
          >
            Create Purchase Order ({selected.size})
          </Button>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={RefreshCw}
          title="All stock levels are healthy"
          description="No products are currently below their reorder level. Check back later or adjust reorder levels in the Inventory settings."
        />
      ) : (
        <>
          {/* Alert banner */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800">
                {items.filter((i) => i.urgency === 'high').length} item{items.filter((i) => i.urgency === 'high').length !== 1 ? 's' : ''} need immediate restocking
              </p>
              <p className="text-xs text-amber-600 mt-0.5">
                Based on current stock levels and reorder thresholds. Select items to create a purchase order.
              </p>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-3 mb-4">
            <button onClick={selectAll} className="text-xs text-blue-600 hover:underline font-medium">Select All</button>
            <span className="text-gray-300">·</span>
            <button onClick={clearAll} className="text-xs text-gray-400 hover:underline">Clear</button>
            {selected.size > 0 && (
              <>
                <span className="text-gray-300">·</span>
                <span className="text-xs text-gray-500">{selected.size} selected · Est. {formatCurrency(totalCost)}</span>
              </>
            )}
          </div>

          {/* Restock List */}
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.productId}
                className={`bg-white rounded-xl border transition-colors shadow-sm ${
                  selected.has(item.productId) ? 'border-blue-300 ring-1 ring-blue-200' : 'border-gray-200'
                }`}
              >
                <div className="flex items-center gap-4 p-4">
                  <input
                    type="checkbox"
                    checked={selected.has(item.productId)}
                    onChange={() => toggleSelect(item.productId)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-gray-900 truncate">{item.productName}</p>
                      <Badge variant={urgencyVariant[item.urgency]}>
                        {item.urgency.charAt(0).toUpperCase() + item.urgency.slice(1)} Priority
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                      <span>
                        Current: <span className="font-mono font-semibold text-red-600">{item.currentStock}</span>
                        {item.unit && <span className="ml-0.5">{item.unit}s</span>}
                      </span>
                      <span>
                        Order: <span className="font-mono font-semibold text-gray-900">
                          {item.purchaseUnit && item.conversionFactor && item.conversionFactor > 1
                            ? `${Math.ceil(item.suggestedQty / item.conversionFactor)} ${item.purchaseUnit}${Math.ceil(item.suggestedQty / item.conversionFactor) !== 1 ? 's' : ''} (${item.suggestedQty} ${item.unit}s)`
                            : `+${item.suggestedQty}${item.unit ? ` ${item.unit}s` : ''}`}
                        </span>
                      </span>
                      <span>Supplier: <span className="font-medium text-gray-700">{item.suggestedSupplierName}</span></span>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="font-bold font-mono text-gray-900">{formatCurrency(item.estimatedCost)}</p>
                    <p className="text-xs text-gray-400">estimated</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Create Purchase Order"
        description={`Create purchase orders for ${selectedItems.length} products across ${new Set(selectedItems.map((i) => i.suggestedSupplierId).filter(Boolean)).size} supplier(s)? Estimated total: ${formatCurrency(totalCost)}`}
        confirmLabel="Create Purchase Orders"
        loading={creating}
        onConfirm={handleCreatePO}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
