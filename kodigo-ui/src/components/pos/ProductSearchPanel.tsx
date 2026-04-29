import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Package } from 'lucide-react';
import { SearchInput } from '@/components/shared/SearchInput';
import { ProductCard } from './ProductCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { BarcodeInput } from './BarcodeInput';
import { useProductStore } from '@/stores/productStore';
import { cn, formatCurrency } from '@/lib/utils';
import {
  getDefaultSellingOption,
  getProductSellingOptions,
  getSellingOptionLabel,
  getSellingOptionStockLabel,
} from '@/types';
import type { Product, ProductSellingOption } from '@/types';

interface ProductSearchPanelProps {
  onAddProduct: (product: Product, option?: ProductSellingOption) => void;
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
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const products = useProductStore((s) => s.products);

  const categories = useMemo(() => {
    const cats = [...new Set(products.map((p) => p.categoryName))].sort();
    return ['All', ...cats];
  }, [products]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();

    return products.filter((p) => {
      const matchesQuery =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.includes(q)) ||
        p.categoryName.toLowerCase().includes(q);
      const matchesCategory = activeCategory === 'All' || p.categoryName === activeCategory;
      return matchesQuery && matchesCategory;
    });
  }, [products, query, activeCategory]);

  const quickLookupResults = useMemo(() => {
    return query.trim()
      ? results.flatMap((product) =>
          getProductSellingOptions(product).map((option) => ({ product, option }))
        ).slice(0, 8)
      : [];
  }, [query, results]);

  const firstAvailableIndex = useMemo(() => {
    return quickLookupResults.findIndex(({ option }) => option.stockQuantity > 0);
  }, [quickLookupResults]);

  const highlightedLookup = highlightedIndex >= 0 ? quickLookupResults[highlightedIndex] : undefined;
  const activeOptionId = highlightedLookup ? `pos-quick-lookup-${highlightedLookup.product.id}-${highlightedLookup.option.id}` : undefined;

  useEffect(() => {
    if (quickLookupResults.length === 0) {
      setHighlightedIndex(-1);
      return;
    }

    setHighlightedIndex((current) => {
      const currentProduct = quickLookupResults[current];
      if (currentProduct?.option.stockQuantity > 0) return current;
      return firstAvailableIndex;
    });
  }, [quickLookupResults, firstAvailableIndex]);

  const handleScan = (barcode: string) => {
    const found = products.find((p) => p.barcode === barcode);
    if (!found) return;
    const options = getProductSellingOptions(found).filter((option) => option.stockQuantity > 0);
    if (options.length === 1) {
      onAddProduct(found, options[0]);
      return;
    }
    setQuery(found.name);
  };

  const addLookupProduct = useCallback((product: Product, option: ProductSellingOption) => {
    if (option.stockQuantity <= 0) return;
    onAddProduct(product, option);
    setQuery('');
    setHighlightedIndex(-1);
    window.requestAnimationFrame(() => searchRef.current?.focus());
  }, [onAddProduct]);

  const moveHighlight = (step: 1 | -1) => {
    if (quickLookupResults.length === 0) return;

    let next = highlightedIndex;
    for (let i = 0; i < quickLookupResults.length; i += 1) {
      next = (next + step + quickLookupResults.length) % quickLookupResults.length;
      if (quickLookupResults[next]?.option.stockQuantity > 0) {
        setHighlightedIndex(next);
        return;
      }
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveHighlight(1);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveHighlight(-1);
      return;
    }

    if (e.key === 'Home' && quickLookupResults.length > 0) {
      e.preventDefault();
      setHighlightedIndex(firstAvailableIndex);
      return;
    }

    if (e.key === 'End' && quickLookupResults.length > 0) {
      e.preventDefault();
      let lastAvailableIndex = -1;
      for (let i = quickLookupResults.length - 1; i >= 0; i -= 1) {
        if (quickLookupResults[i].option.stockQuantity > 0) {
          lastAvailableIndex = i;
          break;
        }
      }
      setHighlightedIndex(lastAvailableIndex);
      return;
    }

    if (e.key === 'Escape' && query) {
      e.preventDefault();
      setQuery('');
      setHighlightedIndex(-1);
      return;
    }

    if (e.key === 'Enter') {
      const lookup = highlightedLookup ?? quickLookupResults[firstAvailableIndex];
      if (lookup) {
        e.preventDefault();
        addLookupProduct(lookup.product, lookup.option);
        return;
      }
      const product = results.find((p) => getDefaultSellingOption(p).stockQuantity > 0);
      if (product) {
        e.preventDefault();
        addLookupProduct(product, getDefaultSellingOption(product));
      }
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
          inputRef={searchRef}
          placeholder="Quick lookup by name, SKU or barcode... (F2)"
          showBarcodeIcon
          role="combobox"
          ariaLabel="Quick product lookup"
          ariaControls="pos-quick-lookup-list"
          ariaExpanded={quickLookupResults.length > 0}
          ariaActiveDescendant={activeOptionId}
          ariaAutocomplete="list"
          debounceMs={0}
          className="w-full"
        />
      </div>

      {quickLookupResults.length > 0 && (
        <div className="px-4 pt-3 border-b border-gray-100 bg-gray-50/80">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Quick lookup</h2>
            <span className="sr-only" aria-live="polite">
              {quickLookupResults.length} matching products. Use arrow keys to choose a product and Enter to add it.
            </span>
          </div>
          <div id="pos-quick-lookup-list" role="listbox" aria-label="Quick lookup results" className="grid gap-2 pb-3">
            {quickLookupResults.map(({ product, option }, index) => {
              const outOfStock = option.stockQuantity <= 0;
              const isActive = index === highlightedIndex;

              return (
                <button
                  key={`${product.id}-${option.id}`}
                  id={`pos-quick-lookup-${product.id}-${option.id}`}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  aria-disabled={outOfStock}
                  disabled={outOfStock}
                  onMouseEnter={() => !outOfStock && setHighlightedIndex(index)}
                  onClick={() => addLookupProduct(product, option)}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
                    isActive && !outOfStock
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-blue-300',
                    outOfStock && 'cursor-not-allowed opacity-50 hover:border-gray-200'
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-gray-900">{product.name}</span>
                    <span className="block truncate text-xs text-gray-500">
                      {getSellingOptionLabel(option)} - {product.sku} {product.barcode ? `- ${product.barcode}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono font-semibold text-blue-700">{formatCurrency(option.sellingPrice)}</span>
                    <span className="block text-xs text-gray-500">
                      {outOfStock ? 'Out of stock' : `${getSellingOptionStockLabel(option)} left`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Category quick-filter chips */}
      <div className="px-4 py-2 flex gap-2 overflow-x-auto scrollbar-hide border-b border-gray-100">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1 text-xs font-medium rounded-full whitespace-nowrap border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
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
