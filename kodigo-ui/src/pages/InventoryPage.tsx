import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit, Trash2, Sliders, History, PackageOpen } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/shared/Button';
import { SearchInput } from '@/components/shared/SearchInput';
import { DataTable } from '@/components/shared/DataTable';
import { StockStatusBadge } from '@/components/shared/Badge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { StockAdjustmentModal } from '@/components/inventory/StockAdjustmentModal';
import { StockAdjustmentLog } from '@/components/inventory/StockAdjustmentLog';
import { useToast } from '@/components/shared/Toast';
import { formatCurrency } from '@/lib/utils';
import { isDefaultCategoryName, useProductStore } from '@/stores/productStore';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import {
  getDefaultSellingOption,
  getProductSellingOptions,
  getSellingOptionLabel,
  getSellingOptionStockLabel,
} from '@/types';
import type { Product, AdjustmentReason } from '@/types';
import type { Column } from '@/components/shared/DataTable';

type Tab = 'products' | 'log';

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

function SackConversionModal({
  product,
  open,
  onClose,
  onSubmit,
}: {
  product: Product | null;
  open: boolean;
  onClose: () => void;
  onSubmit: (sackOptionId: string, kiloOptionId: string, sacks: number, note: string) => Promise<void>;
}) {
  const [sackOptionId, setSackOptionId] = useState('');
  const [kiloOptionId, setKiloOptionId] = useState('');
  const [sacks, setSacks] = useState('1');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const options = product ? getProductSellingOptions(product) : [];
  const sackOptions = options.filter((option) => option.kind === 'sack' && option.quantityValue);
  const kiloOptions = options.filter((option) => option.kind === 'kilo' || option.unitLabel.toLowerCase() === 'kg');
  const selectedSack = sackOptions.find((option) => option.id === sackOptionId) ?? sackOptions[0];
  const selectedKilo = kiloOptions.find((option) => option.id === kiloOptionId) ?? kiloOptions[0];
  const sackCount = Math.max(1, parseInt(sacks) || 1);
  const kiloDelta = selectedSack?.quantityValue ? selectedSack.quantityValue * sackCount : 0;

  useEffect(() => {
    if (!open) return;
    setSackOptionId(sackOptions[0]?.id ?? '');
    setKiloOptionId(kiloOptions[0]?.id ?? '');
    setSacks('1');
    setNote('');
  }, [open, product?.id]);

  if (!open || !product) return null;

  const canSubmit = Boolean(selectedSack && selectedKilo && selectedSack.stockQuantity >= sackCount && selectedSack.id !== selectedKilo.id);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedSack || !selectedKilo || !canSubmit) return;
    setLoading(true);
    try {
      await onSubmit(selectedSack.id, selectedKilo.id, sackCount, note);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <form onSubmit={handleSubmit} className="relative z-10 bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Open Sack</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700">Close</button>
        </div>

        <div className="bg-gray-50 rounded-xl px-4 py-3">
          <p className="font-medium text-gray-900 text-sm">{product.name}</p>
          {selectedSack && selectedKilo && (
            <p className="text-xs text-gray-500 mt-0.5">
              {sackCount} {getSellingOptionLabel(selectedSack)} adds {kiloDelta} {selectedKilo.unitLabel}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Source Sack Stock</label>
          <select
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={selectedSack?.id ?? ''}
            onChange={(e) => setSackOptionId(e.target.value)}
          >
            {sackOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {getSellingOptionLabel(option)} - {getSellingOptionStockLabel(option)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Destination Kilo Stock</label>
          <select
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={selectedKilo?.id ?? ''}
            onChange={(e) => setKiloOptionId(e.target.value)}
          >
            {kiloOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {getSellingOptionLabel(option)} - {getSellingOptionStockLabel(option)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Sacks to Open</label>
          <input
            type="number"
            min={1}
            className="w-full px-3 py-2 text-sm font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={sacks}
            onChange={(e) => setSacks(e.target.value)}
          />
          {selectedSack && selectedSack.stockQuantity < sackCount && (
            <p className="text-xs text-red-500 mt-1">Not enough stock for this sack option.</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Note</label>
          <textarea
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note"
          />
        </div>

        <div className="flex gap-3 pt-1">
          <Button variant="secondary" type="button" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={loading} disabled={!canSubmit} className="flex-1">
            Convert
          </Button>
        </div>
      </form>
    </div>
  );
}

export function InventoryPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { products, deleteProduct, adjustStock, openSackToKilo, stockAdjustments } = useProductStore();
  const { activeStoreId, stores, role } = useAuthStore();
  const [tab, setTab] = useState<Tab>('products');
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'separate' | 'combined'>('separate');
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const [convertTarget, setConvertTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);
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
    const matchesStock = (() => {
      if (stockFilter === 'all') return true;
      const options = getProductSellingOptions(p);
      if (stockFilter === 'out') return options.some((option) => option.stockQuantity === 0);
      if (stockFilter === 'low') return options.some((option) => option.stockQuantity > 0 && option.stockQuantity <= option.lowStockThreshold);
      if (stockFilter === 'ok') return options.every((option) => option.stockQuantity > option.lowStockThreshold);
      return true;
    })();
    return matchesSearch && matchesCategory && matchesStock;
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
          <p className="font-medium text-gray-900">{p.name}</p>
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
      header: 'Option Stock',
      accessor: (p) => (
        <div className="space-y-1">
          {getProductSellingOptions(p).map((option) => (
            <div key={option.id} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 min-w-20 truncate">{getSellingOptionLabel(option)}</span>
              <span className="font-mono font-semibold text-gray-900">{getSellingOptionStockLabel(option)}</span>
              {option.id === getDefaultSellingOption(p).id && <StockStatusBadge product={p} className="hidden sm:inline-flex" />}
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
      header: 'Cost',
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
                onClick={() => setAdjustTarget(p)}
                className="p-1.5 rounded-lg hover:bg-amber-50 text-gray-400 hover:text-amber-600 transition-colors"
                title="Adjust stock"
              >
                <Sliders className="w-4 h-4" />
              </button>
              {role === 'admin' &&
                getProductSellingOptions(p).some((option) => option.kind === 'sack' && option.quantityValue) &&
                getProductSellingOptions(p).some((option) => option.kind === 'kilo' || option.unitLabel.toLowerCase() === 'kg') && (
                  <button
                    onClick={() => setConvertTarget(p)}
                    className="p-1.5 rounded-lg hover:bg-purple-50 text-gray-400 hover:text-purple-600 transition-colors"
                    title="Open sack into kilo stock"
                  >
                    <PackageOpen className="w-4 h-4" />
                  </button>
                )}
              <button
                onClick={() => navigate(`/inventory/products/${p.id}`)}
                className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors"
                title="Edit"
              >
                <Edit className="w-4 h-4" />
              </button>
              {role === 'admin' && <button
                onClick={() => setDeleteTarget(p)}
                className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                title="Delete"
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

  const handleAdjust = async (sellingOptionId: string | undefined, delta: number, reason: AdjustmentReason, note: string) => {
    await new Promise((r) => setTimeout(r, 600));
    if (!adjustTarget) throw new Error('Select a product before adjusting stock.');
    await adjustStock(adjustTarget.id, sellingOptionId, delta, reason, note);
    setAdjustTarget(null);
  };

  const handleConvert = async (sackOptionId: string, kiloOptionId: string, sacks: number, note: string) => {
    if (!convertTarget) return;
    try {
      await openSackToKilo(convertTarget.id, sackOptionId, kiloOptionId, sacks, note);
      toast('success', 'Sack stock converted into kilo stock.');
      setConvertTarget(null);
    } catch (err: any) {
      toast('error', err?.message || 'Failed to convert stock.');
      throw err;
    }
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
        title="Inventory"
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

      {role === 'admin' && <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Product"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />}

      <StockAdjustmentModal
        open={!!adjustTarget}
        productId={adjustTarget?.id ?? ''}
        productName={adjustTarget?.name ?? ''}
        currentStock={adjustTarget?.currentStock ?? 0}
        unit={adjustTarget?.unit}
        purchaseUnit={adjustTarget?.purchaseUnit}
        conversionFactor={adjustTarget?.conversionFactor}
        sellingOptions={adjustTarget?.sellingOptions ?? []}
        onClose={() => setAdjustTarget(null)}
        onSubmit={handleAdjust}
      />

      <SackConversionModal
        open={!!convertTarget}
        product={convertTarget}
        onClose={() => setConvertTarget(null)}
        onSubmit={handleConvert}
      />
    </div>
  );
}
