import { Fragment, useEffect, useMemo, useState } from 'react';
import { ShoppingCart, ClipboardList, RefreshCw, AlertTriangle, PackageCheck } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/shared/Button';
import { Badge } from '@/components/shared/Badge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { useToast } from '@/components/shared/Toast';
import { formatCurrency } from '@/lib/utils';
import { fetchInventoryConsumptionHistory } from '@/lib/reporting';
import { useProductStore } from '@/stores/productStore';
import { useSupplierStore } from '@/stores/supplierStore';
import { useAuthStore } from '@/stores/authStore';
import { getStockStatus } from '@/types';
import type { ProductRestockingOption, RestockItem, RestockResult } from '@/types';

interface RestockDraft {
  optionKey: string;
  quantity: string;
  totalSupplierCost: string;
}

interface ReceiptDraft {
  quantity: string;
  totalSupplierCost: string;
}

function getRestockingOptions(item: RestockItem): ProductRestockingOption[] {
  const activeOptions = item.restockingOptions?.filter((option) => option.isActive) ?? [];
  if (activeOptions.length > 0) return activeOptions;
  return [{
    id: '',
    productId: item.productId,
    storeId: item.storeId,
    label: item.purchaseUnit || item.unit || 'piece',
    conversionFactor: item.conversionFactor || 1,
    isDefault: true,
    isActive: true,
  }];
}

const urgencyVariant: Record<string, 'danger' | 'warning' | 'info'> = {
  high: 'danger',
  medium: 'warning',
  low: 'info',
};

/** Derive restock items from current product data. */
function useRestockItems(consumptionHistory: Map<string, { unitsConsumed: number; trackingStartedAt: string }>, now: number): RestockItem[] {
  const products = useProductStore((s) => s.products);
  return useMemo(() => {
    return products
      .flatMap((p) => {
        if (p.isActive === false) return [];
        const defaultRestockingOption = p.restockingOptions?.find((option) => option.isActive && option.isDefault)
          || p.restockingOptions?.find((option) => option.isActive)
          || { label: p.purchaseUnit || p.unit, conversionFactor: p.conversionFactor || 1 };
        const effectiveReorder = Math.max(p.reorderLevel, p.safetyStock, p.minStockLevel);
        const history = consumptionHistory.get(p.id);
        const trackedDays = history && now > 0
          ? Math.max(1, (now - new Date(history.trackingStartedAt).getTime()) / 86_400_000)
          : 0;
        const unitsConsumed = Math.max(0, history?.unitsConsumed ?? 0);
        const perDay = trackedDays > 0 ? unitsConsumed / trackedDays : 0;
        const leadTimeDays = Math.max(0, Number(p.leadTimeDays) || 0);
        const velocityTarget = Math.ceil(perDay * leadTimeDays) + effectiveReorder;
        const stockStatus = getStockStatus(p);
        const isBelowStaticThreshold = stockStatus === 'out-of-stock' || stockStatus === 'critical' || stockStatus === 'low' || p.currentStock <= p.reorderLevel;
        const needsRestock = perDay > 0 ? p.currentStock <= velocityTarget : isBelowStaticThreshold;
        if (!needsRestock) return [];

        const targetStock = perDay > 0 ? velocityTarget : effectiveReorder * 2;
        const neededBaseUnits = Math.max(1, Math.ceil(targetStock - p.currentStock));
        const packageSize = Math.max(1, Number(defaultRestockingOption.conversionFactor) || 1);
        const suggestedPurchaseQty = Math.ceil(neededBaseUnits / packageSize);
        const suggestedBaseUnits = suggestedPurchaseQty * packageSize;
        const estimatedCost = suggestedBaseUnits * p.costPrice;
        const daysOfStock = perDay > 0 ? p.currentStock / perDay : null;
        const urgency: RestockItem['urgency'] =
          stockStatus === 'out-of-stock' || stockStatus === 'critical'
            ? 'high'
            : stockStatus === 'low'
            ? 'medium'
            : perDay > 0 && daysOfStock !== null && daysOfStock <= leadTimeDays
              ? 'high'
              : perDay > 0 ? 'medium' : 'low';
        return {
          productId: p.id,
          storeId: p.storeId,
          productName: p.name,
          currentStock: p.currentStock,
          suggestedQty: suggestedPurchaseQty,
          suggestedSupplierId: p.supplierId ?? p.supplierIds?.[0] ?? '',
          suggestedSupplierName: p.supplierName ?? 'No supplier assigned',
          estimatedCost,
          urgency,
          unit: p.unit,
          purchaseUnit: defaultRestockingOption.label,
          conversionFactor: defaultRestockingOption.conversionFactor,
          suggestedBaseUnits,
          suggestedPurchaseQty,
          purchaseUnitCost: suggestedPurchaseQty > 0 ? estimatedCost / suggestedPurchaseQty : 0,
          restockingOptions: p.restockingOptions,
        };
      })
      .sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return order[a.urgency] - order[b.urgency];
      });
  }, [products, consumptionHistory, now]);
}

export function RestockingPage({ embedded = false }: { embedded?: boolean }) {
  const { toast } = useToast();
  const products = useProductStore((s) => s.products);
  const adjustStock = useProductStore((s) => s.adjustStock);
  const updateSellingPrice = useProductStore((s) => s.updateSellingPrice);
  const { createPurchaseOrder, recalculatePriceScores } = useSupplierStore();
  const { stores, activeStoreId } = useAuthStore();
  const [consumptionHistory, setConsumptionHistory] = useState<Map<string, { unitsConsumed: number; trackingStartedAt: string }>>(new Map());
  const [now, setNow] = useState(0);
  const [consumptionHistoryLoading, setConsumptionHistoryLoading] = useState(false);
  const [consumptionHistoryFailed, setConsumptionHistoryFailed] = useState(false);
  const items = useRestockItems(consumptionHistory, now);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [restockDrafts, setRestockDrafts] = useState<Record<string, RestockDraft>>({});
  const [receiptDrafts, setReceiptDrafts] = useState<Record<string, ReceiptDraft>>({});
  const [priceReviews, setPriceReviews] = useState<Record<string, RestockResult>>({});
  const [receiptReviewId, setReceiptReviewId] = useState<string | null>(null);
  const [bulkReceiptOpen, setBulkReceiptOpen] = useState(false);
  const [bulkReceiptReviewed, setBulkReceiptReviewed] = useState(false);
  const [bulkReceiving, setBulkReceiving] = useState(false);
  const [bulkReceiptProgress, setBulkReceiptProgress] = useState<{ done: number; total: number } | null>(null);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setNow(Date.now());
  }, []);

  useEffect(() => {
    if (!activeStoreId || products.length === 0) {
      setConsumptionHistory(new Map());
      setConsumptionHistoryLoading(false);
      setConsumptionHistoryFailed(false);
      return;
    }

    let cancelled = false;
    setConsumptionHistoryLoading(true);
    setConsumptionHistoryFailed(false);
    void fetchInventoryConsumptionHistory(activeStoreId)
      .then((rows) => {
        if (!cancelled) {
          setConsumptionHistory(new Map(rows.map((row) => [row.productId, {
            unitsConsumed: row.unitsConsumed,
            trackingStartedAt: row.trackingStartedAt,
          }])));
          setConsumptionHistoryFailed(false);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to load inventory consumption history', error);
          setConsumptionHistory(new Map());
          setConsumptionHistoryFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setConsumptionHistoryLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeStoreId, products.length]);

  useEffect(() => {
    setRestockDrafts((previous) => {
      const next = { ...previous };
      for (const item of items) {
        if (next[item.productId]) continue;
        const options = getRestockingOptions(item);
        const selectedOption = options.find((option) => option.isDefault) || options[0];
        next[item.productId] = {
          optionKey: selectedOption.id || selectedOption.label,
          quantity: String(item.suggestedPurchaseQty ?? item.suggestedQty),
          totalSupplierCost: '',
        };
      }
      return next;
    });
  }, [items]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => { if (!bulkReceiptReviewed && !bulkReceiving) setSelected(new Set(items.map((i) => i.productId))); };
  const clearAll = () => { if (!bulkReceiptReviewed && !bulkReceiving) setSelected(new Set()); };

  const selectedItems = items.filter((i) => selected.has(i.productId));
  const getDraftCalculation = (item: RestockItem) => {
    const options = getRestockingOptions(item);
    const draft = restockDrafts[item.productId];
    const option = options.find((candidate) => (candidate.id || candidate.label) === draft?.optionKey)
      || options.find((candidate) => candidate.isDefault)
      || options[0];
    const quantity = Math.max(0, Number(draft?.quantity) || 0);
    const baseUnits = quantity * Math.max(1, Number(option.conversionFactor) || 1);
    const product = products.find((candidate) => candidate.id === item.productId);
    const estimatedCost = baseUnits * (product?.costPrice ?? 0);
    const enteredCost = draft?.totalSupplierCost?.trim() ? Math.max(0, Number(draft.totalSupplierCost) || 0) : null;
    return {
      option,
      quantity,
      baseUnits,
      totalCost: enteredCost ?? estimatedCost,
      isEstimated: enteredCost === null,
      costPerBaseUnit: baseUnits > 0 ? (enteredCost ?? estimatedCost) / baseUnits : 0,
    };
  };
  const totalCost = selectedItems.reduce((sum, item) => sum + getDraftCalculation(item).totalCost, 0);

  const handleCreateShoppingList = () => {
    if (selectedItems.length === 0) return;
    const selectedStoreNames = Array.from(new Set(selectedItems.map((item) => (
      stores.find((store) => store.id === item.storeId)?.name || 'Unknown'
    )));
    const lines = [
      'SHOPPING LIST',
      `${selectedStoreNames.length === 1 ? 'Store' : 'Stores'}: ${selectedStoreNames.join(', ')}`,
      `Created: ${new Date().toLocaleDateString('en-PH')}`,
      `Items: ${selectedItems.length}`,
      '',
      ...selectedItems.flatMap((item, index) => {
        const calculation = getDraftCalculation(item);
        return [
          `${index + 1}. ${item.productName}`,
          `   Buy: ${calculation.quantity} ${calculation.option.label}${calculation.quantity === 1 ? '' : 's'} (${calculation.baseUnits} ${item.unit}${calculation.baseUnits === 1 ? '' : 's'})`,
          `   Supplier: ${item.suggestedSupplierName}`,
          `   Priority: ${item.urgency}`,
          `   ${calculation.isEstimated ? 'Estimated cost' : 'Purchase cost'}: ${formatCurrency(calculation.totalCost)}`,
          '',
        ];
      }),
      '----------------------------------------',
      `ESTIMATED TOTAL: ${formatCurrency(totalCost)}`,
    ];
    const text = lines.join('\r\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `Shopping-List-${new Date().toISOString().slice(0, 10)}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast('success', 'Shopping list downloaded.');
  };

  const applyReceipt = async (item: RestockItem, quantityReceived: number, actualCost?: number) => {
    const calculation = getDraftCalculation(item);
    const baseUnitsReceived = quantityReceived * Math.max(1, Number(calculation.option.conversionFactor) || 1);
    const result = await adjustStock(
      item.productId,
      undefined,
      baseUnitsReceived,
      'restock',
      '',
      {
        restockingOptionId: calculation.option.id || undefined,
        quantity: quantityReceived,
        purchaseUnit: calculation.option.label,
        piecesPerUnit: calculation.option.conversionFactor,
        totalSupplierCost: actualCost,
      },
    );
    if (result && result.costChangePercent != null && Math.abs(result.costChangePercent) >= 0.01 && result.newCostPerBaseUnit !== result.previousCostPerBaseUnit) {
      setPriceReviews((previous) => ({ ...previous, [item.productId]: result }));
    }
    setSelected((previous) => new Set([...previous].filter((productId) => productId !== item.productId)));
    setRestockDrafts((previous) => { const next = { ...previous }; delete next[item.productId]; return next; });
    setReceiptDrafts((previous) => { const next = { ...previous }; delete next[item.productId]; return next; });
    setReceiptReviewId(null);
  };

  const handleConfirmReceipt = async (item: RestockItem) => {
    const receipt = receiptDrafts[item.productId];
    const quantityReceived = Math.max(0, Number(receipt?.quantity) || 0);
    const actualCost = receipt?.totalSupplierCost?.trim() ? Math.max(0, Number(receipt.totalSupplierCost) || 0) : undefined;
    if (quantityReceived <= 0) {
      toast('warning', `Enter the quantity actually received for ${item.productName}.`);
      return;
    }

    setReceivingId(item.productId);
    try {
      await applyReceipt(item, quantityReceived, actualCost);
      const calculation = getDraftCalculation(item);
      toast('success', `${quantityReceived} ${calculation.option.label}${quantityReceived === 1 ? '' : 's'} received for ${item.productName}.`);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : `Could not receive ${item.productName}.`);
    } finally {
      setReceivingId(null);
    }
  };

  const bulkReceiptRows = selectedItems.flatMap((item) => {
    const draft = receiptDrafts[item.productId];
    const rawQuantity = draft?.quantity?.trim() ?? '';
    const quantity = rawQuantity ? Number(rawQuantity) : 0;
    const rawCost = draft?.totalSupplierCost?.trim() ?? '';
    const totalCost = rawCost ? Number(rawCost) : undefined;
    if (!Number.isFinite(quantity) || quantity <= 0) return [];
    return [{ item, quantity, totalCost }];
  });

  const handleReviewBulkReceipt = () => {
    const invalid = selectedItems.find((item) => {
      const draft = receiptDrafts[item.productId];
      const quantity = draft?.quantity?.trim();
      const cost = draft?.totalSupplierCost?.trim();
      return (quantity !== undefined && quantity !== '' && (!Number.isFinite(Number(quantity)) || Number(quantity) < 0))
        || (cost !== undefined && cost !== '' && (!Number.isFinite(Number(cost)) || Number(cost) < 0));
    });
    if (invalid) {
      toast('warning', `Enter valid non-negative amounts for ${invalid.productName}.`);
      return;
    }
    if (bulkReceiptRows.length === 0) {
      toast('warning', 'Enter the quantities actually received. Leave unavailable items at 0 or blank.');
      return;
    }
    setBulkReceiptReviewed(true);
  };

  const handleApplyBulkReceipt = async () => {
    if (bulkReceiptRows.length === 0) return;
    setBulkReceiving(true);
    setBulkReceiptProgress({ done: 0, total: bulkReceiptRows.length });
    const failures: string[] = [];
    let received = 0;
    for (const [index, row] of bulkReceiptRows.entries()) {
      try {
        await applyReceipt(row.item, row.quantity, row.totalCost);
        received += 1;
      } catch (error) {
        failures.push(`${row.item.productName}: ${error instanceof Error ? error.message : 'Receipt failed.'}`);
      }
      setBulkReceiptProgress({ done: index + 1, total: bulkReceiptRows.length });
    }
    setBulkReceiving(false);
    setBulkReceiptProgress(null);
    setBulkReceiptReviewed(false);
    if (failures.length === 0) {
      toast('success', `Recorded actual receipts for ${received} product${received === 1 ? '' : 's'}.`);
      setBulkReceiptOpen(false);
    } else {
      toast('error', `Recorded ${received}; ${failures.length} failed. ${failures[0]}`);
    }
  };

  const handleCreatePO = async () => {
    setCreating(true);
    try {
      // Group selected items by supplier and store
      const grouped = new Map<string, { storeId: string; supplierId: string; supplierName: string; items: RestockItem[] }>();
      for (const item of selectedItems) {
        const key = `${item.storeId}_${item.suggestedSupplierId || '__unassigned__'}`;
        if (!grouped.has(key)) {
          grouped.set(key, {
            storeId: item.storeId,
            supplierId: item.suggestedSupplierId,
            supplierName: item.suggestedSupplierName,
            items: [],
          });
        }
        grouped.get(key)!.items.push(item);
      }

      const groups = [...grouped.values()];
      const validGroups = groups.filter((g) => g.supplierId);
      const skippedItems = groups
        .filter((g) => !g.supplierId)
        .reduce((count, group) => count + group.items.length, 0);

      if (validGroups.length === 0) {
        toast('error', 'Assign a supplier before creating a purchase order.');
        return;
      }

      await Promise.all(validGroups.map((group) =>
        createPurchaseOrder(
          group.storeId,
          group.supplierId,
          group.supplierName,
          group.items.map((item) => {
            const calculation = getDraftCalculation(item);
            return {
              productId: item.productId,
              productName: item.productName,
              quantity: calculation.quantity,
              unitCost: calculation.totalCost / Math.max(1, calculation.quantity),
            };
          }),
        )
      ));

      // Refresh relative price scores now that new POs exist
      recalculatePriceScores(products);

      toast(
        skippedItems > 0 ? 'info' : 'success',
        `${validGroups.length} purchase order${validGroups.length !== 1 ? 's' : ''} created. ${skippedItems > 0 ? `${skippedItems} item${skippedItems !== 1 ? 's' : ''} skipped without suppliers.` : `Estimated total: ${formatCurrency(totalCost)}`}`,
      );
      setConfirmOpen(false);
      clearAll();
    } catch (err: any) {
      toast('error', err?.message || 'Failed to create purchase orders.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      {!embedded && <PageHeader
        title="Restocking"
        subtitle={`${items.length} product${items.length !== 1 ? 's' : ''} need restocking`}
      />}

      {items.length === 0 ? (
        consumptionHistoryLoading ? (
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">Calculating restock recommendations from inventory history…</div>
        ) : (
          <EmptyState
            icon={RefreshCw}
            title="All stock levels are healthy"
            description="No products are currently expected to run low during supplier lead time. Check back later or adjust reorder levels in Product Management."
          />
        )
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
                {consumptionHistoryFailed
                  ? 'Inventory history is unavailable, so estimates use reorder thresholds. Costs use current unit cost and round up to full supplier packages.'
                  : 'Uses recorded sales and stock losses since inventory tracking began, plus supplier lead time and stock buffers. Estimated costs use current unit cost and round up to full supplier packages.'}
              </p>
            </div>
          </div>

          {/* Toolbar */}
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={selectAll} disabled={bulkReceiptReviewed || bulkReceiving} className="text-xs text-blue-600 hover:underline font-medium disabled:opacity-50">Select All</button>
              <span className="text-gray-300">·</span>
              <button onClick={clearAll} disabled={bulkReceiptReviewed || bulkReceiving} className="text-xs text-gray-400 hover:underline disabled:opacity-50">Clear</button>
              <span className="text-xs text-gray-500">{selectedItems.length} selected · Est. {formatCurrency(totalCost)}</span>
            </div>
            <div className="flex flex-wrap gap-2 lg:ml-auto">
              <Button
                variant="secondary"
                size={embedded ? 'sm' : 'md'}
                icon={<PackageCheck className="w-4 h-4" />}
                disabled={selectedItems.length === 0 || bulkReceiving || receivingId !== null}
                onClick={() => {
                  setReceiptReviewId(null);
                  setBulkReceiptReviewed(false);
                  setBulkReceiptOpen((open) => !open);
                }}
              >
                {bulkReceiptOpen ? 'Close bulk receipt' : 'Record bulk receipt'}
              </Button>
              <Button variant="secondary" size={embedded ? 'sm' : 'md'} icon={<ClipboardList className="w-4 h-4" />} disabled={selectedItems.length === 0} onClick={handleCreateShoppingList}>
                Create Shopping List
              </Button>
              <Button variant="secondary" size={embedded ? 'sm' : 'md'} icon={<ShoppingCart className="w-4 h-4" />} disabled={selectedItems.length === 0} onClick={() => setConfirmOpen(true)}>
                Create Purchase Order
              </Button>
            </div>
          </div>

          {bulkReceiptOpen && (
            <section className="mb-4 rounded-xl border border-blue-200 bg-blue-50/60 p-4" aria-label="Record bulk stock receipt">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-blue-950">Record a delivery</h2>
                  <p className="mt-1 text-xs leading-5 text-blue-800">
                    Enter what was actually purchased for each selected item. Planned quantities will not be received automatically; leave unavailable or unpurchased items at 0 or blank.
                  </p>
                </div>
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-blue-800">{selectedItems.length} selected</span>
              </div>

              {!bulkReceiptReviewed ? (
                <>
                  {selectedItems.length === 0 ? (
                    <p className="mt-4 rounded-lg bg-white px-3 py-4 text-sm text-gray-600">Select products from the restocking list to record a delivery.</p>
                  ) : (
                    <div className="mt-4 overflow-x-auto rounded-lg border border-blue-100 bg-white">
                      <table className="w-full min-w-[680px] text-left text-sm">
                        <thead className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                          <tr><th className="px-3 py-2.5">Product</th><th className="px-3 py-2.5">Planned</th><th className="px-3 py-2.5">Actually received</th><th className="px-3 py-2.5">Actual amount paid (optional)</th></tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {selectedItems.map((item) => {
                            const calculation = getDraftCalculation(item);
                            const receipt = receiptDrafts[item.productId] ?? { quantity: '', totalSupplierCost: '' };
                            return <tr key={item.productId}>
                              <td className="px-3 py-3 font-medium text-gray-900">{item.productName}<span className="mt-0.5 block text-xs font-normal text-gray-500">Received as {calculation.option.label} · {calculation.option.conversionFactor} {item.unit}s each</span></td>
                              <td className="px-3 py-3 font-mono text-gray-600">{calculation.quantity} {calculation.option.label}</td>
                              <td className="px-3 py-3">
                                <label className="sr-only" htmlFor={`bulk-received-qty-${item.productId}`}>Actual quantity received for {item.productName}</label>
                                <input
                                  id={`bulk-received-qty-${item.productId}`}
                                  type="text"
                                  inputMode="decimal"
                                  value={receipt.quantity}
                                  onChange={(event) => setReceiptDrafts((previous) => ({ ...previous, [item.productId]: { quantity: event.target.value, totalSupplierCost: previous[item.productId]?.totalSupplierCost ?? '' } }))}
                                  className="w-36 rounded-lg border border-gray-300 bg-white px-2.5 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                  placeholder="0"
                                />
                                <span className="ml-2 text-xs text-gray-500">{calculation.option.label}s</span>
                              </td>
                              <td className="px-3 py-3">
                                <label className="sr-only" htmlFor={`bulk-received-cost-${item.productId}`}>Actual total paid for {item.productName}</label>
                                <input
                                  id={`bulk-received-cost-${item.productId}`}
                                  type="text"
                                  inputMode="decimal"
                                  value={receipt.totalSupplierCost}
                                  onChange={(event) => setReceiptDrafts((previous) => ({ ...previous, [item.productId]: { quantity: previous[item.productId]?.quantity ?? '', totalSupplierCost: event.target.value } }))}
                                  className="w-40 rounded-lg border border-gray-300 bg-white px-2.5 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                  placeholder="Optional"
                                />
                              </td>
                            </tr>;
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-blue-800">Only quantities entered above will be added. Verify the entries in the next step before inventory changes.</p>
                    <Button size="sm" variant="primary" disabled={bulkReceiptRows.length === 0 || bulkReceiving} onClick={handleReviewBulkReceipt}>Review actual delivery</Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="mt-4 rounded-lg border border-blue-100 bg-white">
                    <div className="border-b border-gray-100 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Review before updating inventory</div>
                    <ul className="divide-y divide-gray-100">
                      {bulkReceiptRows.map(({ item, quantity, totalCost }) => {
                        const calculation = getDraftCalculation(item);
                        const baseUnits = quantity * calculation.option.conversionFactor;
                        return <li key={item.productId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-sm">
                          <span className="font-medium text-gray-900">{item.productName}</span>
                          <span className="font-mono text-gray-700">{quantity} {calculation.option.label} · adds {baseUnits} {item.unit}s</span>
                          <span className="text-xs text-gray-600">{totalCost === undefined ? 'No actual price entered' : `Paid ${formatCurrency(totalCost)}`}</span>
                        </li>;
                      })}
                    </ul>
                  </div>
                  <p className="mt-3 text-xs text-blue-800">{selectedItems.length - bulkReceiptRows.length} selected item{selectedItems.length - bulkReceiptRows.length === 1 ? '' : 's'} with 0 or blank quantity will be left unchanged.</p>
                  {bulkReceiptProgress && <p role="status" className="mt-2 text-sm font-medium text-blue-800">Recording item {bulkReceiptProgress.done} of {bulkReceiptProgress.total}…</p>}
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="secondary" disabled={bulkReceiving} onClick={() => setBulkReceiptReviewed(false)}>Edit quantities</Button>
                    <Button size="sm" variant="primary" loading={bulkReceiving} disabled={bulkReceiving || bulkReceiptRows.length === 0} onClick={() => void handleApplyBulkReceipt()}>
                      Confirm receipt of {bulkReceiptRows.length} item{bulkReceiptRows.length === 1 ? '' : 's'}
                    </Button>
                  </div>
                </>
              )}
            </section>
          )}

          {/* Inline restocking table */}
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="w-10 px-4 py-3"><span className="sr-only">Select</span></th>
                  <th className="px-4 py-3">Product</th>
                  <th className="w-44 px-4 py-3">Purchase unit</th>
                  <th className="w-32 px-4 py-3">Quantity to buy</th>
                  <th className="w-44 px-4 py-3">Total price</th>
                  <th className="w-44 px-4 py-3">Effective cost</th>
                  <th className="w-32 px-4 py-3">Priority</th>
                  <th className="w-36 px-4 py-3">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item) => {
                  const calculation = getDraftCalculation(item);
                  const draft = restockDrafts[item.productId] ?? {
                    optionKey: calculation.option.id || calculation.option.label,
                    quantity: String(item.suggestedPurchaseQty ?? item.suggestedQty),
                    totalSupplierCost: '',
                  };
                  const product = products.find((candidate) => candidate.id === item.productId);
                  const selectedStyle = selected.has(item.productId) ? 'bg-blue-50/60' : 'bg-white';
                  return (
                    <Fragment key={item.productId}>
                      <tr className={selectedStyle}>
                        <td className="px-4 py-4 align-top">
                          <input type="checkbox" checked={selected.has(item.productId)} onChange={() => toggleSelect(item.productId)} disabled={bulkReceiptReviewed || bulkReceiving} aria-label={`Select ${item.productName}`} className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50" />
                        </td>
                        <td className="px-4 py-4 align-top">
                          <p className="font-medium text-gray-900">{item.productName}</p>
                          <p className="mt-1 text-xs text-gray-500">Stock: <span className="font-mono font-semibold text-red-600">{item.currentStock} {item.unit}s</span> · Supplier: {item.suggestedSupplierName}</p>
                          {activeStoreId === 'all' && <p className="mt-1 text-xs font-medium text-blue-700">{stores.find((store) => store.id === item.storeId)?.name || 'Unknown store'}</p>}
                        </td>
                        <td className="px-4 py-4 align-top">
                          <select
                            aria-label={`Purchase unit for ${item.productName}`}
                            value={calculation.option.id || calculation.option.label}
                            onChange={(event) => {
                              const option = getRestockingOptions(item).find((candidate) => (candidate.id || candidate.label) === event.target.value);
                              if (!option) return;
                              const quantity = Math.ceil(calculation.baseUnits / Math.max(1, option.conversionFactor));
                              setRestockDrafts((previous) => ({ ...previous, [item.productId]: { ...draft, optionKey: option.id || option.label, quantity: String(quantity) } }));
                            }}
                            className="w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          >
                            {getRestockingOptions(item).map((option) => <option key={option.id || option.label} value={option.id || option.label}>{option.label} ({option.conversionFactor} {item.unit}s)</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <input
                            aria-label={`Purchase quantity for ${item.productName}`}
                            type="number"
                            min="0"
                            step="any"
                            value={draft.quantity}
                            onChange={(event) => setRestockDrafts((previous) => ({ ...previous, [item.productId]: { ...draft, quantity: event.target.value } }))}
                            className="w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          />
                          <p className="mt-1 text-xs text-gray-400">{calculation.baseUnits} {item.unit}s</p>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <input
                            aria-label={`Total purchase price for ${item.productName}`}
                            type="number"
                            min="0"
                            step="0.01"
                            value={draft.totalSupplierCost}
                            onChange={(event) => setRestockDrafts((previous) => ({ ...previous, [item.productId]: { ...draft, totalSupplierCost: event.target.value } }))}
                            placeholder={formatCurrency(calculation.baseUnits * (product?.costPrice ?? 0))}
                            className="w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          />
                          <p className="mt-1 text-xs text-gray-400">Leave blank to use estimate</p>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <p className="font-mono font-semibold text-gray-900">{formatCurrency(calculation.costPerBaseUnit)} / {item.unit}</p>
                          <p className="mt-1 text-xs text-gray-500">{calculation.isEstimated ? 'Estimated' : 'From entered price'} · line {formatCurrency(calculation.totalCost)}</p>
                        </td>
                        <td className="px-4 py-4 align-top"><Badge variant={urgencyVariant[item.urgency]}>{item.urgency.charAt(0).toUpperCase() + item.urgency.slice(1)}</Badge></td>
                        <td className="px-4 py-4 align-top">
                          <Button size="sm" variant="secondary" disabled={receivingId !== null} onClick={() => setReceiptReviewId(receiptReviewId === item.productId ? null : item.productId)}>
                            {receiptReviewId === item.productId ? 'Close' : 'Record receipt'}
                          </Button>
                        </td>
                      </tr>
                      {receiptReviewId === item.productId && (
                        <tr className="bg-blue-50">
                          <td colSpan={8} className="px-4 py-3">
                            <div className="flex flex-wrap items-end gap-3">
                              <div>
                                <label className="mb-1 block text-xs font-medium text-blue-900" htmlFor={`received-qty-${item.productId}`}>Actual quantity received ({calculation.option.label})</label>
                                <input
                                  id={`received-qty-${item.productId}`}
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={receiptDrafts[item.productId]?.quantity ?? ''}
                                  onChange={(event) => setReceiptDrafts((previous) => ({ ...previous, [item.productId]: { quantity: event.target.value, totalSupplierCost: previous[item.productId]?.totalSupplierCost ?? '' } }))}
                                  className="w-44 rounded-lg border border-blue-200 bg-white px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                  placeholder="Enter received qty"
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-xs font-medium text-blue-900" htmlFor={`received-cost-${item.productId}`}>Actual total paid (optional)</label>
                                <input
                                  id={`received-cost-${item.productId}`}
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={receiptDrafts[item.productId]?.totalSupplierCost ?? ''}
                                  onChange={(event) => setReceiptDrafts((previous) => ({ ...previous, [item.productId]: { quantity: previous[item.productId]?.quantity ?? '', totalSupplierCost: event.target.value } }))}
                                  className="w-44 rounded-lg border border-blue-200 bg-white px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                                  placeholder="Enter amount paid"
                                />
                              </div>
                              <p className="min-w-52 flex-1 pb-2 text-xs text-blue-800">
                                {Number(receiptDrafts[item.productId]?.quantity) > 0
                                  ? `This will add ${Number(receiptDrafts[item.productId].quantity) * calculation.option.conversionFactor} ${item.unit}s to stock. Items not received can be left blank.`
                                  : 'Only the actual quantity entered here will be added to stock. Leave unavailable items unrecorded.'}
                              </p>
                              <Button size="sm" variant="primary" loading={receivingId === item.productId} disabled={receivingId !== null || !(Number(receiptDrafts[item.productId]?.quantity) > 0)} onClick={() => void handleConfirmReceipt(item)}>Confirm receipt</Button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {Object.entries(priceReviews).length > 0 && (
        <div className="mt-4 space-y-2">
          {Object.entries(priceReviews).map(([productId, review]) => {
            const product = products.find((candidate) => candidate.id === productId);
            return (
              <div key={productId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs text-amber-900">{product?.name || 'Product'} cost per unit changed from {formatCurrency(review.previousCostPerBaseUnit)} to {formatCurrency(review.newCostPerBaseUnit)}. Suggested selling price: {formatCurrency(review.suggestedSellingPrice)}.</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setPriceReviews((previous) => { const next = { ...previous }; delete next[productId]; return next; })}>Keep current price</Button>
                  <Button size="sm" variant="primary" onClick={async () => { try { await updateSellingPrice(productId, review.suggestedSellingPrice, undefined, true); setPriceReviews((previous) => { const next = { ...previous }; delete next[productId]; return next; }); toast('success', `Selling price updated for ${product?.name || 'product'}.`); } catch (error) { toast('error', error instanceof Error ? error.message : 'Failed to update selling price.'); } }}>Update price</Button>
                </div>
              </div>
            );
          })}
        </div>
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
