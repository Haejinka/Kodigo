import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, ArchiveRestore, Plus, Edit, Trash2, Sliders, History, X, FileSpreadsheet } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/shared/Button';
import { SearchInput } from '@/components/shared/SearchInput';
import { DataTable } from '@/components/shared/DataTable';
import { StockStatusBadge } from '@/components/shared/Badge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { StockAdjustmentModal } from '@/components/inventory/StockAdjustmentModal';
import { StockAdjustmentLog } from '@/components/inventory/StockAdjustmentLog';
import { SalesVelocityPanel } from '@/components/inventory/SalesVelocityPanel';
import { RestockingPage } from '@/pages/RestockingPage';
import { InventoryImportPanel } from '@/components/inventory/InventoryImportPanel';
import { ConsignmentPanel } from '@/components/inventory/ConsignmentPanel';
import type { InventoryImportRow } from '@/components/inventory/InventoryImportPanel';
import { useToast } from '@/components/shared/Toast';
import { formatCurrency } from '@/lib/utils';
import { fetchInventoryConsumptionHistory } from '@/lib/reporting';
import { isDefaultCategoryName, useProductStore } from '@/stores/productStore';
import { useAuthStore } from '@/stores/authStore';
import { useSupplierStore } from '@/stores/supplierStore';
import { cn } from '@/lib/utils';
import {
  getDefaultSellingOption,
  getProductOptionStockLabel,
  getProductSellingOptions,
  getSellingOptionLabel,
  getStockStatus,
  isBulkSellingOption,
} from '@/types';
import type { Product, AdjustmentReason, Category } from '@/types';
import type { Column } from '@/components/shared/DataTable';

type Tab = 'products' | 'restocking' | 'velocity' | 'log' | 'consignment';
type ProductLifecycleFilter = 'active' | 'archived' | 'all';

function ManageCategoriesModal({ open, onClose, storeId }: { open: boolean; onClose: () => void; storeId: string }) {
  const { toast } = useToast();
  const { categories, products, fetchCategories, seedDefaultCategories, addCategory, renameCategory, deleteCategory } = useProductStore();
  const [newCat, setNewCat] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [loading, setLoading] = useState(false);
  const role = useAuthStore((state) => state.role);
  const inputRef = useRef<HTMLInputElement>(null);
  const usedCategoryIds = useMemo(() => {
    return new Set(products.filter((product) => product.storeId === storeId).map((product) => product.categoryId));
  }, [products, storeId]);
  const defaultCategories = useMemo(() => {
    return categories.filter((category) => isDefaultCategoryName(category.name));
  }, [categories]);
  const unusedDefaultCategories = useMemo(() => {
    return defaultCategories.filter((category) => !usedCategoryIds.has(category.id));
  }, [defaultCategories, usedCategoryIds]);

  useEffect(() => {
    if (open && storeId) fetchCategories(storeId);
    setNewCat('');
    setEditingId(null);
    setEditingName('');
  }, [open, storeId, fetchCategories]);

  const handleAdd = async () => {
    if (!newCat.trim()) return;
    setLoading(true);
    try {
      await addCategory(storeId, newCat.trim());
      setNewCat('');
      toast('success', 'Category added.');
      if (inputRef.current) inputRef.current.focus();
    } catch (err: any) {
      toast('error', err?.message || 'Failed to add category.');
    } finally {
      setLoading(false);
    }
  };

  const handleRename = async (id: string) => {
    if (!editingName.trim()) return;
    setLoading(true);
    try {
      await renameCategory(id, editingName.trim(), storeId);
      setEditingId(null);
      setEditingName('');
      toast('success', 'Category renamed.');
    } catch (err: any) {
      toast('error', err?.message || 'Failed to rename category.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, isUsed: boolean) => {
    if (isUsed) {
      toast('warning', 'Move products to another category before deleting this one.');
      return;
    }
    if (!window.confirm('Delete this category? This cannot be undone.')) return;
    setLoading(true);
    try {
      await deleteCategory(id, storeId);
      toast('success', 'Category deleted.');
    } catch (err: any) {
      toast('error', err?.message || 'Failed to delete category.');
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreDefaults = async () => {
    setLoading(true);
    try {
      const restored = await seedDefaultCategories(storeId);
      toast(restored.length > 0 ? 'success' : 'info', restored.length > 0 ? 'Default categories restored.' : 'Default categories are already available.');
    } catch (err: any) {
      toast('error', err?.message || 'Failed to restore default categories.');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveUnusedDefaults = async () => {
    if (unusedDefaultCategories.length === 0) {
      toast('warning', 'No unused default categories can be removed.');
      return;
    }
    if (!window.confirm(`Remove ${unusedDefaultCategories.length} unused default categor${unusedDefaultCategories.length === 1 ? 'y' : 'ies'}?`)) return;
    setLoading(true);
    try {
      for (const category of unusedDefaultCategories) {
        await deleteCategory(category.id, storeId);
      }
      const stillUsed = defaultCategories.length - unusedDefaultCategories.length;
      toast('success', 'Unused default categories removed.');
      if (stillUsed > 0) {
        toast('info', `${stillUsed} default categor${stillUsed === 1 ? 'y is' : 'ies are'} still used by products.`);
      }
    } catch (err: any) {
      toast('error', err?.message || 'Failed to remove default categories.');
    } finally {
      setLoading(false);
    }
  };

  return open ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 bg-white rounded-xl shadow-xl p-6 w-full max-w-lg">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Manage Categories</h2>
            <p className="text-xs text-gray-500 mt-0.5">{categories.length} categories in this store</p>
          </div>
          <button className="text-sm text-gray-400 hover:text-gray-700" onClick={onClose}>Close</button>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {role === 'admin' && <button
            type="button"
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            onClick={handleRestoreDefaults}
            disabled={loading}
          >
            Restore defaults
          </button>}
          {role === 'admin' && <button
            type="button"
            className="px-3 py-1.5 rounded-lg border border-red-200 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
            onClick={handleRemoveUnusedDefaults}
            disabled={loading || defaultCategories.length === 0}
          >
            Remove unused defaults
          </button>}
        </div>

        <div className="mb-4 max-h-72 overflow-y-auto rounded-lg border border-gray-100 divide-y divide-gray-100">
          {categories.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-gray-500">No categories yet.</div>
          ) : categories.map((cat) => {
            const isDefault = isDefaultCategoryName(cat.name);
            const isUsed = usedCategoryIds.has(cat.id);
            return (
              <div key={cat.id} className="flex items-center gap-2 px-3 py-2">
                {editingId === cat.id ? (
                  <>
                    <input
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm flex-1"
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') void handleRename(cat.id);
                        if (e.key === 'Escape') { setEditingId(null); setEditingName(''); }
                      }}
                      autoFocus
                    />
                    <button className="text-blue-600 text-xs font-semibold" onClick={() => handleRename(cat.id)} disabled={loading}>Save</button>
                    <button className="text-gray-400 text-xs font-semibold" onClick={() => { setEditingId(null); setEditingName(''); }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 truncate text-sm text-gray-800">{cat.name}</span>
                    {isDefault && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">Default</span>}
                    {isUsed && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">In use</span>}
                    <button className="text-xs font-semibold text-blue-600" onClick={() => { setEditingId(cat.id); setEditingName(cat.name); }}>Rename</button>
                    {role === 'admin' && <button className="text-xs font-semibold text-red-600 disabled:text-gray-300" onClick={() => handleDelete(cat.id, isUsed)} disabled={loading || isUsed}>Delete</button>}
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex gap-2">
          <input
            ref={inputRef}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1"
            placeholder="New category name"
            value={newCat}
            onChange={e => setNewCat(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            disabled={loading}
          />
          <button className="inline-flex items-center gap-1.5 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-50" onClick={handleAdd} disabled={loading || !newCat.trim()}>
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
      </div>
    </div>
  ) : null;
}

export function InventoryPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { products, categories: storeCategories, fetchCategories, addCategory, addProduct, deleteProduct, setProductActive, adjustStock, updateSellingPrice, stockAdjustments } = useProductStore();
  const { activeStoreId, stores, role } = useAuthStore();
  const { suppliers, fetchSuppliers } = useSupplierStore();
  const [tab, setTab] = useState<Tab>('products');
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [lifecycleFilter, setLifecycleFilter] = useState<ProductLifecycleFilter>('active');
  const [viewMode, setViewMode] = useState<'separate' | 'combined'>('separate');
  const [importPanelOpen, setImportPanelOpen] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<'archive' | 'restore' | 'delete' | null>(null);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [statusTarget, setStatusTarget] = useState<Product | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  // Category modal state
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [consumptionHistory, setConsumptionHistory] = useState<Map<string, { unitsConsumed: number; trackingStartedAt: string }>>(new Map());
  const [consumptionHistoryState, setConsumptionHistoryState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const categoryStoreId = activeStoreId && activeStoreId !== 'all' ? activeStoreId : '';
  const canManageCategories = Boolean(categoryStoreId);

  useEffect(() => {
    if (categoryStoreId) void fetchCategories(categoryStoreId);
  }, [categoryStoreId, fetchCategories]);

  useEffect(() => {
    if (role === 'admin' || role === 'inventory') void fetchSuppliers();
  }, [fetchSuppliers, activeStoreId, role]);

  useEffect(() => {
    if (tab !== 'products') return;
    if (!activeStoreId || products.length === 0) {
      setConsumptionHistory(new Map());
      setConsumptionHistoryState('ready');
      return;
    }

    let cancelled = false;
    setConsumptionHistoryState('loading');
    void fetchInventoryConsumptionHistory(activeStoreId)
      .then((rows) => {
        if (cancelled) return;
        setConsumptionHistory(new Map(rows.map((row) => [row.productId, {
          unitsConsumed: row.unitsConsumed,
          trackingStartedAt: row.trackingStartedAt,
        }])));
        setConsumptionHistoryState('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to load product restock estimates', error);
        setConsumptionHistory(new Map());
        setConsumptionHistoryState('error');
      });

    return () => { cancelled = true; };
  }, [activeStoreId, products.length, tab]);

  useEffect(() => {
    if (tab !== 'products') setAdjustTarget(null);
  }, [tab]);

  useEffect(() => {
    setSelectedProductIds(new Set());
  }, [activeStoreId, viewMode]);

  const categories = [...new Set(products.map((p) => p.categoryName))].sort();

  let filtered = products.filter((p) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !search || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
    const matchesCategory = categoryFilter === 'all' || p.categoryName === categoryFilter;
    const matchesLifecycle = lifecycleFilter === 'all'
      || (lifecycleFilter === 'active' ? p.isActive !== false : p.isActive === false);
    const matchesStock = (() => {
      if (stockFilter === 'all') return true;
      const status = getStockStatus(p);
      if (stockFilter === 'out') return status === 'out-of-stock';
      if (stockFilter === 'low') return status === 'low' || status === 'critical';
      if (stockFilter === 'ok') return status === 'in-stock' || status === 'overstock';
      return true;
    })();
    return matchesSearch && matchesCategory && matchesStock && matchesLifecycle;
  });

  if (activeStoreId === 'all' && viewMode === 'combined') {
    const combinedMap = new Map<string, Product>();
    for (const p of filtered) {
      const key = p.sku || p.barcode || p.name;
      if (!combinedMap.has(key)) {
        combinedMap.set(key, { ...p, storeId: 'combined' });
      } else {
        const existing = combinedMap.get(key)!;
        existing.currentStock += p.currentStock;
        existing.sellingOptions = [
          ...existing.sellingOptions,
          ...p.sellingOptions.map((option) => ({ ...option, id: `${p.storeId}-${option.id}` })),
        ];
      }
    }
    filtered = Array.from(combinedMap.values());
  }

  const visibleSelectableProducts = filtered.filter((product) => product.storeId !== 'combined');
  const selectedProducts = products.filter((product) => selectedProductIds.has(product.id));
  const selectedActiveProducts = selectedProducts.filter((product) => product.isActive !== false);
  const selectedArchivedProducts = selectedProducts.filter((product) => product.isActive === false);
  const allVisibleSelected = visibleSelectableProducts.length > 0
    && visibleSelectableProducts.every((product) => selectedProductIds.has(product.id));

  const toggleProductSelection = (productId: string) => {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const toggleVisibleSelection = () => {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleSelectableProducts.forEach((product) => next.delete(product.id));
      else visibleSelectableProducts.forEach((product) => next.add(product.id));
      return next;
    });
  };

  const columns: Column<Product>[] = [
    ...((role === 'admin' || role === 'inventory') ? [{
      key: 'select',
      header: '',
      width: 'w-10',
      align: 'center' as const,
      accessor: (p: Product) => (
        <input
          type="checkbox"
          aria-label={`Select ${p.name}`}
          checked={p.storeId !== 'combined' && selectedProductIds.has(p.id)}
          disabled={p.storeId === 'combined'}
          onChange={() => toggleProductSelection(p.id)}
          onClick={(event) => event.stopPropagation()}
          className="size-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-30"
        />
      ),
    }] : []),
    {
      key: 'image',
      header: '',
      accessor: (p) => (
        <div className="w-10 h-10 rounded-lg border border-gray-100 bg-gray-50 overflow-hidden flex items-center justify-center shrink-0">
          {p.imageUrl ? (
            <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-lg select-none">📦</span>
          )}
        </div>
      ),
    },
    {
      key: 'name',
      header: 'Product',
      accessor: (p) => (
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium text-gray-900">{p.name}</p>
            {p.isActive === false && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">Archived</span>}
          </div>
          <p className="text-xs text-gray-400 font-mono">{p.sku}</p>
        </div>
      ),
    },
    ...(activeStoreId === 'all' ? [{
      key: 'store',
      header: 'Store',
      accessor: (p: Product) => (
        <span className="text-sm font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
          {p.storeId === 'combined' ? 'Multiple Stores' : (stores.find(s => s.id === p.storeId)?.name || 'Unknown')}
        </span>
      ),
    }] : []),
    { key: 'category', header: 'Category', accessor: (p) => <span className="text-gray-600">{p.categoryName}</span> },
    {
      key: 'stock',
      header: 'Base Stock',
      accessor: (p) => (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-gray-900">{p.currentStock}</span>
            <span className="text-xs text-gray-500">{p.unit}s</span>
            <StockStatusBadge product={p} className="hidden sm:inline-flex" />
          </div>
          {getProductSellingOptions(p).filter(isBulkSellingOption).map((option) => (
            <div key={option.id} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 min-w-20 truncate">{getSellingOptionLabel(option)}</span>
              <span className="font-mono text-xs font-semibold text-blue-700">{getProductOptionStockLabel(p, option)} available</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      key: 'estimatedRestockDate',
      header: 'Estimated Restock Date',
      accessor: (p) => {
        if (consumptionHistoryState === 'loading' || consumptionHistoryState === 'idle') {
          return <span className="text-xs text-gray-400">Calculating…</span>;
        }
        if (consumptionHistoryState === 'error') {
          return <span className="text-xs text-gray-400">Unavailable</span>;
        }
        const matchingProducts = p.storeId === 'combined'
          ? products.filter((candidate) => (candidate.sku || candidate.barcode || candidate.name) === (p.sku || p.barcode || p.name))
          : [p];
        const historyRows = matchingProducts
          .map((candidate) => consumptionHistory.get(candidate.id))
          .filter((row): row is { unitsConsumed: number; trackingStartedAt: string } => Boolean(row));
        const unitsConsumed = historyRows.reduce((total, row) => total + row.unitsConsumed, 0);
        if (unitsConsumed <= 0 || historyRows.length === 0) return <span className="text-xs text-gray-400">No recorded sales/losses</span>;

        const trackingStartedAt = Math.min(...historyRows.map((row) => new Date(row.trackingStartedAt).getTime()));
        const trackedDays = Math.max(1, (Date.now() - trackingStartedAt) / 86_400_000);
        const perDay = unitsConsumed / trackedDays;
        if (perDay <= 0) return <span className="text-xs text-gray-400">No recorded sales/losses</span>;
        const lowStockThreshold = getDefaultSellingOption(p).lowStockThreshold;
        const daysUntilRestock = Math.max(0, Math.ceil((p.currentStock - lowStockThreshold) / perDay));
        const estimatedDate = new Date();
        estimatedDate.setDate(estimatedDate.getDate() + daysUntilRestock);
        return daysUntilRestock === 0
          ? <span className="whitespace-nowrap font-medium text-amber-700">Restock now</span>
          : <span className="whitespace-nowrap font-mono tabular-nums text-gray-700">{estimatedDate.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</span>;
      },
    },
    { key: 'minStock', header: 'Low Stock', accessor: (p) => <span className="font-mono text-gray-500">{getDefaultSellingOption(p).lowStockThreshold}</span>, align: 'center' },
    {
      key: 'sellingPrice',
      header: 'Prices',
      accessor: (p) => (
        <div className="space-y-1 text-right">
          {getProductSellingOptions(p).map((option) => (
            <div key={option.id} className="font-mono font-medium text-gray-900">
              {formatCurrency(option.sellingPrice)}
            </div>
          ))}
        </div>
      ),
      align: 'right',
    },
    {
      key: 'costPrice',
      header: 'Purchase Price',
      accessor: (p) => <span className="font-mono text-gray-500">{formatCurrency(p.costPrice)}</span>,
      align: 'right',
    },
    {
      key: 'actions',
      header: '',
      accessor: (p) => (
        <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
          {p.storeId !== 'combined' && (
            <>
              <button
                type="button"
                onClick={() => setAdjustTarget((current) => current?.id === p.id ? null : p)}
                aria-label={adjustTarget?.id === p.id ? `Close stock adjustment for ${p.name}` : `Adjust stock for ${p.name}`}
                className="rounded-md p-1.5 text-teal-600 transition-colors hover:bg-teal-50 hover:text-teal-700"
                title={adjustTarget?.id === p.id ? 'Close adjustment' : 'Adjust stock'}
              >
                {adjustTarget?.id === p.id ? <X className="w-4 h-4" /> : <Sliders className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={() => navigate(`/inventory/products/${p.id}`)}
                aria-label={`Edit ${p.name}`}
                className="rounded-md p-1.5 text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700"
                title="Edit"
              >
                <Edit className="w-4 h-4" />
              </button>
              {(role === 'admin' || role === 'inventory') && <button
                type="button"
                onClick={() => setStatusTarget(p)}
                aria-label={p.isActive === false ? `Restore ${p.name}` : `Archive ${p.name}`}
                className={cn(
                  'rounded-md p-1.5 transition-colors',
                  p.isActive === false
                    ? 'text-green-600 hover:bg-green-50 hover:text-green-700'
                    : 'text-amber-600 hover:bg-amber-50 hover:text-amber-700',
                )}
                title={p.isActive === false ? 'Restore to active inventory' : 'Archive product'}
              >
                {p.isActive === false ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
              </button>}
              {role === 'admin' && <button
                type="button"
                onClick={() => setDeleteTarget(p)}
                aria-label={`Delete ${p.name}`}
                className="rounded-md p-1.5 text-red-600 transition-colors hover:bg-red-50 hover:text-red-700"
                title="Delete unused product"
              >
                <Trash2 className="w-4 h-4" />
              </button>}
            </>
          )}
        </div>
      ),
      align: 'right',
    },
  ];

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    await new Promise((r) => setTimeout(r, 600));
    try {
      await deleteProduct(deleteTarget.id);
      toast('success', `"${deleteTarget.name}" deleted successfully.`);
      setDeleteTarget(null);
    } catch (err: any) {
      toast('error', err?.message || 'Failed to delete product.');
    } finally {
      setDeleting(false);
    }
  };

  const handleAdjust = async (sellingOptionId: string | undefined, delta: number, reason: AdjustmentReason, note: string, restock?: { restockingOptionId?: string; quantity: number; purchaseUnit: string; piecesPerUnit: number; totalSupplierCost?: number; ownership?: 'store_owned' | 'consigned'; supplierId?: string }) => {
    await new Promise((r) => setTimeout(r, 600));
    if (!adjustTarget) throw new Error('Select a product before adjusting stock.');
    return adjustStock(adjustTarget.id, sellingOptionId, delta, reason, note, restock);
  };

  const handleImportProduct = async (row: InventoryImportRow) => {
    if (!categoryStoreId) throw new Error('Select one store before importing products.');
    const baseOptionId = crypto.randomUUID();
    const defaultPurchaseOptionIndex = row.purchaseOptions.findIndex((option) => option.isDefault);
    const inferredPurchaseOptionIndex = defaultPurchaseOptionIndex >= 0
      ? defaultPurchaseOptionIndex
      : Math.max(0, row.purchaseOptions.findIndex((option) => option.label.toLowerCase() === row.purchaseUnit.toLowerCase()));
    const created = await addProduct({
      storeId: categoryStoreId,
      isActive: true,
      name: row.name,
      sku: row.sku,
      barcode: row.barcode,
      categoryId: row.categoryId,
      unit: row.unit,
      purchaseUnit: row.purchaseUnit,
      conversionFactor: row.conversionFactor,
      bulkPurchasePrice: row.purchaseQuantity > 0 ? row.totalPurchasePrice / row.purchaseQuantity : 0,
      costPrice: row.costPrice,
      sellingPrice: row.sellingPrice,
      currentStock: row.currentStock,
      minStockLevel: row.minStockLevel,
      safetyStock: row.safetyStock,
      reorderLevel: row.reorderLevel,
      leadTimeDays: row.leadTimeDays,
      supplierIds: [],
      supplierId: '',
      bulkPurchaseEnabled: row.sellingBundles.length > 0,
      autoPricingEnabled: false,
      marginPercentage: 20,
      priceRounding: 1,
      restockingOptions: row.purchaseOptions.length > 0
        ? row.purchaseOptions.map((option, index) => ({
            id: crypto.randomUUID(),
            productId: '',
            storeId: categoryStoreId,
            label: option.label,
            conversionFactor: option.conversionFactor,
            isDefault: index === inferredPurchaseOptionIndex,
            isActive: true,
          }))
        : [{
            id: crypto.randomUUID(),
            productId: '',
            storeId: categoryStoreId,
            label: row.purchaseUnit,
            conversionFactor: row.conversionFactor,
            isDefault: true,
            isActive: true,
          }],
      sellingOptions: [{
        id: baseOptionId,
        productId: '',
        storeId: categoryStoreId,
        kind: row.unit === 'kg' ? 'kilo' : 'unit',
        label: row.unit,
        unitLabel: row.unit,
        quantityValue: row.unit === 'kg' ? 1 : undefined,
        quantityUnit: row.unit === 'kg' ? 'kg' : undefined,
        stockQuantity: row.currentStock,
        sellingPrice: row.sellingPrice,
        lowStockThreshold: row.minStockLevel,
        inventoryMultiplier: 1,
        sharesBaseStock: true,
        isBulk: false,
        discountType: 'percent',
        discountValue: 0,
        pricingMethod: 'fixed',
        manualSellingPrice: row.sellingPrice,
        isDefault: true,
        isActive: true,
      }, ...row.sellingBundles.map((bundle) => ({
        id: crypto.randomUUID(),
        productId: '',
        storeId: categoryStoreId,
        kind: 'custom' as const,
        label: bundle.label,
        unitLabel: row.unit,
        quantityValue: bundle.unitsPerBundle,
        quantityUnit: row.unit,
        stockQuantity: Math.floor(row.currentStock / bundle.unitsPerBundle),
        sellingPrice: bundle.sellingPrice,
        lowStockThreshold: Math.floor(row.minStockLevel / bundle.unitsPerBundle),
        inventoryMultiplier: bundle.unitsPerBundle,
        sharesBaseStock: true,
        isBulk: true,
        discountType: 'amount' as const,
        discountValue: Math.max(0, row.sellingPrice * bundle.unitsPerBundle - bundle.sellingPrice),
        pricingMethod: 'fixed' as const,
        manualSellingPrice: bundle.sellingPrice,
        isDefault: false,
        isActive: true,
      }))],
    });
    if (!created) throw new Error('Could not create product in the selected store.');
  };

  const handleCreateImportCategory = async (name: string): Promise<Category> => {
    if (!categoryStoreId) throw new Error('Select one store before creating categories.');
    const category = await addCategory(categoryStoreId, name);
    if (!category) throw new Error(`Could not create category “${name}”.`);
    return category;
  };

  const handleBulkAction = async () => {
    if (!bulkConfirm) return;
    if (bulkConfirm === 'delete' && role !== 'admin') return;
    if (bulkConfirm !== 'delete' && role !== 'admin' && role !== 'inventory') return;

    const targets = bulkConfirm === 'archive'
      ? selectedActiveProducts
      : bulkConfirm === 'restore'
        ? selectedArchivedProducts
        : selectedProducts;
    if (targets.length === 0) {
      setBulkConfirm(null);
      return;
    }

    setBulkActionLoading(true);
    const succeeded: string[] = [];
    const failures: string[] = [];
    for (const product of targets) {
      try {
        if (bulkConfirm === 'delete') await deleteProduct(product.id);
        else await setProductActive(product.id, bulkConfirm === 'restore');
        succeeded.push(product.id);
      } catch (error: any) {
        failures.push(`${product.name}: ${error?.message || 'operation failed'}`);
      }
    }

    if (succeeded.length > 0) {
      setSelectedProductIds((current) => {
        const next = new Set(current);
        succeeded.forEach((id) => next.delete(id));
        return next;
      });
    }
    const verb = bulkConfirm === 'delete' ? 'deleted' : bulkConfirm === 'archive' ? 'archived' : 'restored';
    if (failures.length === 0) {
      toast('success', `${succeeded.length} product${succeeded.length === 1 ? '' : 's'} ${verb}.`);
      setBulkConfirm(null);
    } else {
      const reason = failures[0].split(': ').slice(1).join(': ');
      toast('error', `${succeeded.length} ${verb}; ${failures.length} failed. ${reason}`);
      if (succeeded.length > 0) setBulkConfirm(null);
    }
    setBulkActionLoading(false);
  };

  const toolbar = (
    <div className="flex flex-wrap items-center gap-3">
      <SearchInput value={search} onChange={setSearch} placeholder="Search products…" className="w-56" />
      <select
        value={categoryFilter}
        onChange={(e) => setCategoryFilter(e.target.value)}
        className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="all">All Categories</option>
        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select
        value={stockFilter}
        onChange={(e) => setStockFilter(e.target.value)}
        className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="all">All Stock Status</option>
        <option value="ok">In Stock</option>
        <option value="low">Low Stock</option>
        <option value="out">Out of Stock</option>
      </select>
      <select
        value={lifecycleFilter}
        onChange={(e) => setLifecycleFilter(e.target.value as ProductLifecycleFilter)}
        aria-label="Product lifecycle"
        className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="active">Active Products</option>
        <option value="archived">Archived Products</option>
        <option value="all">All Products</option>
      </select>
      {activeStoreId === 'all' && (
        <select
          value={viewMode}
          onChange={(e) => setViewMode(e.target.value as 'separate' | 'combined')}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="separate">Separate Views</option>
          <option value="combined">Combined View</option>
        </select>
      )}
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Product Management"
        subtitle={`${filtered.length} of ${products.length} products`}
        actions={
          <div className="flex flex-wrap gap-2">
            {(role === 'admin' || role === 'inventory') && <Button
              variant="secondary"
              icon={<FileSpreadsheet className="w-4 h-4" />}
              onClick={() => setImportPanelOpen((open) => !open)}
            >
              Import .xlsx
            </Button>}
            <Button
              variant="primary"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => navigate('/inventory/products/new')}
            >
              Add Product
            </Button>
          </div>
        }
      />
      <div className="flex justify-end mb-4">
        <Button variant="secondary" onClick={() => setCatModalOpen(true)} disabled={!canManageCategories}>
          Manage Categories
        </Button>
      </div>
      <ManageCategoriesModal open={catModalOpen} onClose={() => setCatModalOpen(false)} storeId={categoryStoreId} />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200 mb-5">
        {(role === 'admin' || role === 'inventory') && <button
          onClick={() => setTab('restocking')}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'restocking' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
          )}
        >
          Restocking
        </button>}
        {(role === 'admin' || role === 'inventory') && <button
          onClick={() => setTab('consignment')}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'consignment' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
          )}
        >
          Consignment
        </button>}
        <button
          onClick={() => setTab('velocity')}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'velocity' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
          )}
        >
          Sales Velocity
        </button>
        <button
          onClick={() => setTab('products')}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'products'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
          )}
        >
          Products
          <span className={cn(
            'text-xs font-semibold px-1.5 py-0.5 rounded-full',
            tab === 'products' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
          )}>
            {products.length}
          </span>
        </button>
        <button
          onClick={() => setTab('log')}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'log'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
          )}
        >
          <History className="w-3.5 h-3.5" />
          Adjustment Log
          {stockAdjustments.length > 0 && (
            <span className={cn(
              'text-xs font-semibold px-1.5 py-0.5 rounded-full',
              tab === 'log' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
            )}>
              {stockAdjustments.length}
            </span>
          )}
        </button>
      </div>

      {tab === 'products' && importPanelOpen && (role === 'admin' || role === 'inventory') && (
        <InventoryImportPanel
          storeId={categoryStoreId || null}
          categories={storeCategories}
          products={products}
          onCreateCategory={handleCreateImportCategory}
          onImport={handleImportProduct}
          onClose={() => setImportPanelOpen(false)}
        />
      )}

      {tab === 'products' && (
        <>
        {(role === 'admin' || role === 'inventory') && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
            <span className="mr-auto text-sm font-medium text-blue-900" aria-live="polite">
              {selectedProductIds.size} selected
            </span>
            <Button variant="secondary" size="sm" onClick={toggleVisibleSelection}>
              {allVisibleSelected ? 'Deselect filtered' : 'Select filtered'}
            </Button>
            {(role === 'admin' || role === 'inventory') && selectedActiveProducts.length > 0 && (
              <Button variant="secondary" size="sm" onClick={() => setBulkConfirm('archive')}>
                Archive {selectedActiveProducts.length}
              </Button>
            )}
            {(role === 'admin' || role === 'inventory') && selectedArchivedProducts.length > 0 && (
              <Button variant="secondary" size="sm" onClick={() => setBulkConfirm('restore')}>
                Restore {selectedArchivedProducts.length}
              </Button>
            )}
            {role === 'admin' && (
              <Button variant="danger" size="sm" onClick={() => setBulkConfirm('delete')}>
                Delete {selectedProducts.length}
              </Button>
            )}
            {selectedProductIds.size > 0 && <Button variant="ghost" size="sm" onClick={() => setSelectedProductIds(new Set())}>Clear</Button>}
          </div>
        )}
        <DataTable
          columns={columns}
          data={filtered}
          rowKey={(p) => p.id}
          onRowClick={(p) => navigate(`/inventory/products/${p.id}`)}
          toolbar={toolbar}
          expandedRowId={adjustTarget?.id ?? null}
          expandedRow={(product) => (
            <StockAdjustmentModal
              open
              presentation="inline"
              productId={product.id}
              productName={product.name}
              currentStock={product.currentStock}
              unit={product.unit}
              purchaseUnit={product.purchaseUnit}
              conversionFactor={product.conversionFactor}
              restockingOptions={product.restockingOptions}
              suppliers={suppliers.filter((supplier) => supplier.storeIds.includes(product.storeId))}
              sellingOptions={product.sellingOptions}
              onClose={() => setAdjustTarget(null)}
              onSubmit={handleAdjust}
              onUpdateSuggestedPrice={(sellingPrice) => updateSellingPrice(product.id, sellingPrice, undefined, true)}
            />
          )}
          emptyTitle="No products found"
          emptyDescription="Try adjusting your filters or add a new product."
        />
        </>
      )}

      {tab === 'log' && (
        <StockAdjustmentLog adjustments={stockAdjustments} />
      )}

      {tab === 'velocity' && <SalesVelocityPanel products={products} />}
      {tab === 'restocking' && (role === 'admin' || role === 'inventory') && <RestockingPage embedded />}
      {tab === 'consignment' && (role === 'admin' || role === 'inventory') && <ConsignmentPanel />}

      {role === 'admin' && <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Product"
        description={`Delete "${deleteTarget?.name}" permanently? Only products with no sales history can be deleted. Sold products must be archived instead.`}
        confirmLabel="Delete"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />}

      {(role === 'admin' || role === 'inventory') && <ConfirmDialog
        open={bulkConfirm === 'archive' || bulkConfirm === 'restore' || (bulkConfirm === 'delete' && role === 'admin')}
        title={bulkConfirm === 'delete' ? 'Delete selected products' : bulkConfirm === 'restore' ? 'Restore selected products' : 'Archive selected products'}
        description={bulkConfirm === 'delete'
          ? `Permanently delete ${selectedProducts.length} selected product${selectedProducts.length === 1 ? '' : 's'}? Products with sales history cannot be deleted and will remain unchanged.`
          : bulkConfirm === 'restore'
            ? `Restore ${selectedArchivedProducts.length} selected product${selectedArchivedProducts.length === 1 ? '' : 's'} to active inventory and make them available in POS?`
            : `Archive ${selectedActiveProducts.length} selected product${selectedActiveProducts.length === 1 ? '' : 's'}? They will be removed from active inventory and POS while preserving sales history.`}
        confirmLabel={bulkConfirm === 'delete' ? 'Delete selected' : bulkConfirm === 'restore' ? 'Restore selected' : 'Archive selected'}
        danger={bulkConfirm === 'delete'}
        loading={bulkActionLoading}
        onConfirm={handleBulkAction}
        onCancel={() => setBulkConfirm(null)}
      />}

      {(role === 'admin' || role === 'inventory') && <ConfirmDialog
        open={!!statusTarget}
        title={statusTarget?.isActive === false ? 'Restore Product' : 'Archive Product'}
        description={statusTarget?.isActive === false
          ? `Restore "${statusTarget?.name}" to active inventory and make it available in POS again?`
          : `Archive "${statusTarget?.name}"? It will be removed from active inventory and POS, while sales history is preserved.`}
        confirmLabel={statusTarget?.isActive === false ? 'Restore' : 'Archive'}
        loading={updatingStatus}
        onConfirm={async () => {
          if (!statusTarget) return;
          const restoring = statusTarget.isActive === false;
          setUpdatingStatus(true);
          try {
            await setProductActive(statusTarget.id, restoring);
            toast('success', `"${statusTarget.name}" ${restoring ? 'restored to active inventory' : 'archived'}.`);
            setStatusTarget(null);
          } catch (err: any) {
            toast('error', err?.message || `Failed to ${restoring ? 'restore' : 'archive'} product.`);
          } finally {
            setUpdatingStatus(false);
          }
        }}
        onCancel={() => setStatusTarget(null)}
      />}

    </div>
  );
}
