import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit, Trash2, Sliders, History } from 'lucide-react';
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
import { useProductStore } from '@/stores/productStore';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import type { Product, AdjustmentReason } from '@/types';
import type { Column } from '@/components/shared/DataTable';

type Tab = 'products' | 'log';

// Category Management Modal (scaffold)
import { useEffect } from 'react';
import { useRef } from 'react';
function ManageCategoriesModal({ open, onClose, storeId }: { open: boolean; onClose: () => void; storeId: string }) {
  const { categories, fetchCategories, addCategory, renameCategory, deleteCategory } = useProductStore();
  const [newCat, setNewCat] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
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
      if (inputRef.current) inputRef.current.focus();
    } finally {
      setLoading(false);
    }
  };
  const handleRename = async (id: string) => {
    if (!editingName.trim()) return;
    setLoading(true);
    try {
      await renameCategory(id, editingName.trim());
      setEditingId(null);
      setEditingName('');
    } finally {
      setLoading(false);
    }
  };
  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this category? This cannot be undone.')) return;
    setLoading(true);
    try {
      await deleteCategory(id);
    } finally {
      setLoading(false);
    }
  };

  return open ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30">
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
        <h2 className="text-lg font-bold mb-4">Manage Categories</h2>
        <ul className="mb-4">
          {categories.map((cat) => (
            <li key={cat.id} className="flex items-center gap-2 py-1">
              {editingId === cat.id ? (
                <>
                  <input
                    className="border rounded px-2 py-1 text-sm flex-1"
                    value={editingName}
                    onChange={e => setEditingName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleRename(cat.id);
                      if (e.key === 'Escape') { setEditingId(null); setEditingName(''); }
                    }}
                    autoFocus
                  />
                  <button className="text-blue-600 text-xs" onClick={() => handleRename(cat.id)} disabled={loading}>Save</button>
                  <button className="text-gray-400 text-xs" onClick={() => { setEditingId(null); setEditingName(''); }}>Cancel</button>
                </>
              ) : (
                <>
                  <span className="flex-1 truncate">{cat.name}</span>
                  <button className="text-xs text-blue-600" onClick={() => { setEditingId(cat.id); setEditingName(cat.name); }}>Rename</button>
                  <button className="text-xs text-red-600" onClick={() => handleDelete(cat.id)} disabled={loading}>Delete</button>
                </>
              )}
            </li>
          ))}
        </ul>
        <div className="flex gap-2 mb-4">
          <input
            ref={inputRef}
            className="border rounded px-2 py-1 text-sm flex-1"
            placeholder="New category name"
            value={newCat}
            onChange={e => setNewCat(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            disabled={loading}
          />
          <button className="bg-blue-600 text-white px-3 py-1 rounded text-sm" onClick={handleAdd} disabled={loading || !newCat.trim()}>Add</button>
        </div>
        <div className="flex justify-end gap-2">
          <button className="px-4 py-2 bg-gray-200 rounded" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  ) : null;
}

export function InventoryPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { products, deleteProduct, adjustStock, stockAdjustments } = useProductStore();
  const { activeStoreId, stores } = useAuthStore();
  const [tab, setTab] = useState<Tab>('products');
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'separate' | 'combined'>('separate');
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Category modal state
  const [catModalOpen, setCatModalOpen] = useState(false);

  const categories = [...new Set(products.map((p) => p.categoryName))].sort();

  let filtered = products.filter((p) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !search || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
    const matchesCategory = categoryFilter === 'all' || p.categoryName === categoryFilter;
    const matchesStock = (() => {
      if (stockFilter === 'all') return true;
      if (stockFilter === 'out') return p.currentStock === 0;
      if (stockFilter === 'low') return p.currentStock > 0 && p.currentStock <= p.minStockLevel;
      if (stockFilter === 'ok') return p.currentStock > p.minStockLevel;
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
      header: 'Stock',
      accessor: (p) => (
        <div className="flex items-center gap-2">
          <span className="font-mono font-semibold text-gray-900">{p.currentStock}</span>
          <StockStatusBadge product={p} />
        </div>
      ),
    },
    { key: 'minStock', header: 'Min Stock', accessor: (p) => <span className="font-mono text-gray-500">{p.minStockLevel}</span>, align: 'center' },
    {
      key: 'sellingPrice',
      header: 'Price',
      accessor: (p) => <span className="font-mono font-medium text-gray-900">{formatCurrency(p.sellingPrice)}</span>,
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
              <button
                onClick={() => navigate(`/inventory/products/${p.id}`)}
                className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition-colors"
                title="Edit"
              >
                <Edit className="w-4 h-4" />
              </button>
              <button
                onClick={() => setDeleteTarget(p)}
                className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
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

  const handleAdjust = async (delta: number, reason: AdjustmentReason, note: string) => {
    await new Promise((r) => setTimeout(r, 600));
    if (adjustTarget) adjustStock(adjustTarget.id, delta, reason, note);
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
        <Button variant="secondary" onClick={() => setCatModalOpen(true)}>
          Manage Categories
        </Button>
      </div>
      <ManageCategoriesModal open={catModalOpen} onClose={() => setCatModalOpen(false)} storeId={activeStoreId} />

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

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Product"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <StockAdjustmentModal
        open={!!adjustTarget}
        productId={adjustTarget?.id ?? ''}
        productName={adjustTarget?.name ?? ''}
        currentStock={adjustTarget?.currentStock ?? 0}
        unit={adjustTarget?.unit}
        purchaseUnit={adjustTarget?.purchaseUnit}
        conversionFactor={adjustTarget?.conversionFactor}
        onClose={() => setAdjustTarget(null)}
        onSubmit={handleAdjust}
      />
    </div>
  );
}
