import { Package, AlertCircle } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import type { Product, ProductSellingOption } from '@/types';
import { getAvailableSellingUnits, getProductOptionStockLabel, getProductSellingOptions, getSellingOptionLabel, getStockStatus } from '@/types';

interface ProductCardProps {
  product: Product;
  onAdd: (product: Product, option?: ProductSellingOption) => void;
}

export function ProductCard({ product, onAdd }: ProductCardProps) {
  const options = getProductSellingOptions(product);
  const outOfStock = options.every((option) => getAvailableSellingUnits(product, option) <= 0);
  const defaultInStockOption = options.find((option) => getAvailableSellingUnits(product, option) > 0);

  const handleCardAdd = () => {
    if (!defaultInStockOption) return;
    onAdd(product, defaultInStockOption);
  };

  return (
    <div
      role="button"
      tabIndex={outOfStock ? -1 : 0}
      aria-disabled={outOfStock}
      onClick={handleCardAdd}
      onKeyDown={(event) => {
        if (outOfStock) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleCardAdd();
        }
      }}
      className={cn(
        'bg-white border rounded-xl p-3 text-left transition-all group relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
        outOfStock
          ? 'opacity-50 cursor-not-allowed border-gray-200'
          : 'border-gray-200 cursor-pointer hover:border-blue-300 hover:shadow-md'
      )}
    >
      {/* Product image / icon */}
      <div className="w-full aspect-square bg-gray-50 rounded-lg flex items-center justify-center mb-2 overflow-hidden">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <Package className="w-8 h-8 text-gray-300" />
        )}
      </div>

      <p className="text-xs font-semibold text-gray-900 leading-tight line-clamp-2 mb-1">{product.name}</p>
      <div className="space-y-1.5 mt-2">
        {options.map((option) => {
          const status = getStockStatus(product, option);
          const optionOut = getAvailableSellingUnits(product, option) <= 0;

          return (
            <button
              key={option.id}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (!optionOut) onAdd(product, option);
              }}
              disabled={optionOut}
              className={cn(
                'w-full rounded-lg border px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
                optionOut
                  ? 'border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed'
                  : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50'
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-gray-700 truncate">{getSellingOptionLabel(option)}</span>
                <span className="text-xs font-bold text-blue-600 font-mono shrink-0">{formatCurrency(option.sellingPrice)}</span>
              </span>
              <span className="flex items-center gap-1 mt-0.5">
                {optionOut ? (
                  <AlertCircle className="w-3 h-3 text-red-500" />
                ) : (
                  <span className={cn('w-1.5 h-1.5 rounded-full', {
                    'bg-green-500': status === 'in-stock',
                    'bg-amber-500': status === 'low',
                    'bg-orange-500': status === 'critical',
                  })} />
                )}
                <span className="text-[10px] text-gray-400 font-mono">
                  {optionOut ? 'Out of stock' : `${getProductOptionStockLabel(product, option)} left`}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {!outOfStock && <div className="pointer-events-none absolute inset-0 rounded-xl bg-blue-600/0 group-hover:bg-blue-600/5 transition-colors" />}
    </div>
  );
}
