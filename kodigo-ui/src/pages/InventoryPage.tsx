import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, ArchiveRestore, Plus, Edit, Trash2, Sliders, History } from 'lucide-react';
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
import { useToast } from '@/components/shared/Toast';
import { formatCurrency } from '@/lib/utils';
import { isDefaultCategoryName, useProductStore } from '@/stores/productStore';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import {
  getDefaultSellingOption,
  getProductOptionStockLabel,
  getProductSellingOptions,
  getSellingOptionLabel,
  getStockStatus,
  isBulkSellingOption,
} from '@/types';
import type { Product, AdjustmentReason } from '@/types';
import type { Column } from '@/components/shared/DataTable';

type Tab = 'products' | 'restocking' | 'velocity' | 'log';
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
  const { products, deleteProduct, setProductActive, adjustStock, updateSellingPrice, stockAdjustments } = useProductStore();
  const { activeStoreId, stores, role } = useAuthStore();
  const [tab, setTab] = useState<Tab>('products');
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [lifecycleFilter, setLifecycleFilter] = useState<ProductLifecycleFilter>('active');
  const [viewMode, setViewMode] = useState<'separate' | 'combined'>('separate');
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [statusTarget, setStatusTarget] = useState<Product | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  // Category modal state
  const [catModalOpen, setCatModalOpen] = useState(false);
  const categoryStoreId = activeStoreId && activeStoreId !== 'all' ? activeStoreId : '';
  const canManageCategories = Boolean(categoryStoreId);

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

  const columns: Column<Product>[] = [
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
                onClick={() => setAdjustTarget(p)}
                aria-label={`Adjust stock for ${p.name}`}
                className="p-1.5 rounded-lg hover:bg-amber-50 text-gray-400 hover:text-amber-600 transition-colors"
                title="Adjust stock"
              >
                <Sliders className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => navigate(`/inventory/products/${p.id}`)}
                aria-label={`Edit ${p.name}`}
                className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors"
                title="Edit"
              >
                <Edit className="w-4 h-4" />
              </button>
              {(role === 'admin' || role === 'inventory') && <button
                type="button"
                onClick={() => setStatusTarget(p)}
                aria-label={p.isActive === false ? `Restore ${p.name}` : `Archive ${p.name}`}
                className={cn(
                  'p-1.5 rounded-lg transition-colors',
                  p.isActive === false
                    ? 'text-gray-400 hover:bg-green-50 hover:text-green-600'
                    : 'text-gray-400 hover:bg-amber-50 hover:text-amber-600',
                )}
                title={p.isActive === false ? 'Restore to active inventory' : 'Archive product'}
              >
                {p.isActive === false ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
              </button>}
              {role === 'admin' && <button
                type="button"
                onClick={() => setDeleteTarget(p)}
                aria-label={`Delete ${p.name}`}
                className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
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

  const handleAdjust = async (sellingOptionId: string | undefined, delta: number, reason: AdjustmentReason, note: string, restock?: { restockingOptionId?: string; quantity: number; purchaseUnit: string; piecesPerUnit: number; totalSupplierCost?: number }) => {
    await new Promise((r) => setTimeout(r, 600));
    if (!adjustTarget) throw new Error('Select a product before adjusting stock.');
    return adjustStock(adjustTarget.id, sellingOptionId, delta, reason, note, restock);
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
          <Button
            variant="primary"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => navigate('/inventory/products/new')}
          >
            Add Product
          </Button>
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

      {tab === 'products' && (
        <DataTable
          columns={columns}
          data={filtered}
          rowKey={(p) => p.id}
          onRowClick={(p) => navigate(`/inventory/products/${p.id}`)}
          toolbar={toolbar}
          emptyTitle="No products found"
          emptyDescription="Try adjusting your filters or add a new product."
        />
      )}

      {tab === 'log' && (
        <StockAdjustmentLog adjustments={stockAdjustments} />
      )}

      {tab === 'velocity' && <SalesVelocityPanel products={products} />}
      {tab === 'restocking' && (role === 'admin' || role === 'inventory') && <RestockingPage embedded />}

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

      <StockAdjustmentModal
        open={!!adjustTarget}
        productId={adjustTarget?.id ?? ''}
        productName={adjustTarget?.name ?? ''}
        currentStock={adjustTarget?.currentStock ?? 0}
        unit={adjustTarget?.unit}
        purchaseUnit={adjustTarget?.purchaseUnit}
        conversionFactor={adjustTarget?.conversionFactor}
        restockingOptions={adjustTarget?.restockingOptions}
        sellingOptions={adjustTarget?.sellingOptions}
        onClose={() => setAdjustTarget(null)}
        onSubmit={handleAdjust}
        onUpdateSuggestedPrice={(sellingPrice) => updateSellingPrice(adjustTarget?.id ?? '', sellingPrice, undefined, true)}
      />

    </div>
  );
}
