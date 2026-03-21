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
import { cn } from '@/lib/utils';
import type { Product, AdjustmentReason } from '@/types';
import type { Column } from '@/components/shared/DataTable';

type Tab = 'products' | 'log';

export function InventoryPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { products, deleteProduct, adjustStock, stockAdjustments } = useProductStore();
  const [tab, setTab] = useState<Tab>('products');
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);

  const categories = [...new Set(products.map((p) => p.categoryName))].sort();

  const filtered = products.filter((p) => {
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
        </div>
      ),
      align: 'right',
    },
  ];

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    await new Promise((r) => setTimeout(r, 600));
    deleteProduct(deleteTarget.id);
    toast('success', `"${deleteTarget.name}" deleted successfully.`);
    setDeleteTarget(null);
    setDeleting(false);
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
