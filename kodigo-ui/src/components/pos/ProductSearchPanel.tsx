import { useState, useMemo } from 'react';
import { SearchInput } from '@/components/shared/SearchInput';
import { ProductCard } from './ProductCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { BarcodeInput } from './BarcodeInput';
import { useProductStore } from '@/stores/productStore';
import type { Product } from '@/types';
import { Package } from 'lucide-react';

interface ProductSearchPanelProps {
  onAddProduct: (product: Product) => void;
  /** Current pending quantity (1 = none set) */
  pendingQty?: number;
  /** Raw string typed by the cashier, empty when none */
  pendingQtyStr?: string;
  /** Called when cashier clears the pending qty */
  onResetQty?: () => void;
  /** Called when a rapid scan sequence starts to undo leaked digits */
  onScanStart?: () => void;
}

export function ProductSearchPanel({ onAddProduct, onScanStart }: ProductSearchPanelProps) {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const products = useProductStore((s) => s.products);

  const categories = useMemo(() => {
    const cats = [...new Set(products.map((p) => p.categoryName))].sort();
    return ['All', ...cats];
  }, [products]);

  const results = useMemo(() => {
    return products.filter((p) => {
      const q = query.toLowerCase();
      const matchesQuery =
        !query ||
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.includes(q)) ||
        p.categoryName.toLowerCase().includes(q);
      const matchesCategory = activeCategory === 'All' || p.categoryName === activeCategory;
      return matchesQuery && matchesCategory;
    });
  }, [products, query, activeCategory]);

  const handleScan = (barcode: string) => {
    const found = products.find((p) => p.barcode === barcode);
    if (found) onAddProduct(found);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault();
      onAddProduct(results[0]);
      setQuery('');
      // If using strictly keyboard, they might want to clear it visually too.
      // SearchInput internal state won't clear just by setting query to '' here if they typed fast.
    }
  };

  return (
    <div className="flex flex-col h-full">
      <BarcodeInput onScan={handleScan} onScanStart={onScanStart} />

      <div className="p-4 pb-3 border-b border-gray-100 flex gap-2">
        <SearchInput
          id="pos-search"
          value={query}
          onChange={setQuery}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search by name, SKU or scan barcode… (F2)"
          showBarcodeIcon
          className="w-full"
        />
      </div>

      {/* Category quick-filter chips */}
      <div className="px-4 py-2 flex gap-2 overflow-x-auto scrollbar-hide border-b border-gray-100">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1 text-xs font-medium rounded-full whitespace-nowrap border transition-colors ${
              activeCategory === cat
                ? 'border-blue-500 bg-blue-50 text-blue-600'
                : 'border-gray-200 bg-white hover:border-blue-400 hover:text-blue-600'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Product Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {results.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No products found"
            description="Try a different search or scan a barcode"
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {results.map((p) => (
              <ProductCard key={p.id} product={p} onAdd={onAddProduct} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
