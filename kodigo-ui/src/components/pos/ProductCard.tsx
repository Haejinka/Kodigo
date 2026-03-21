import { Package, AlertCircle } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import type { Product } from '@/types';
import { getStockStatus } from '@/types';

interface ProductCardProps {
  product: Product;
  onAdd: (product: Product) => void;
}

export function ProductCard({ product, onAdd }: ProductCardProps) {
  const status = getStockStatus(product);
  const outOfStock = status === 'out-of-stock';

  return (
    <button
      onClick={() => !outOfStock && onAdd(product)}
      disabled={outOfStock}
      className={cn(
        'bg-white border rounded-xl p-3 text-left transition-all group relative',
        outOfStock
          ? 'opacity-50 cursor-not-allowed border-gray-200'
          : 'border-gray-200 hover:border-blue-300 hover:shadow-md cursor-pointer active:scale-[0.98]'
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
      <p className="text-sm font-bold text-blue-600 font-mono">{formatCurrency(product.sellingPrice)}</p>

      {/* Stock indicator */}
      <div className="flex items-center gap-1 mt-1">
        {outOfStock ? (
          <AlertCircle className="w-3 h-3 text-red-500" />
        ) : (
          <span className={cn('w-1.5 h-1.5 rounded-full', {
            'bg-green-500': status === 'in-stock',
            'bg-amber-500': status === 'low',
            'bg-orange-500': status === 'critical',
          })} />
        )}
        <span className="text-[10px] text-gray-400 font-mono">
          {outOfStock ? 'Out of stock' : `${product.currentStock} left`}
        </span>
      </div>

      {!outOfStock && (
        <div className="absolute inset-0 rounded-xl bg-blue-600/0 group-hover:bg-blue-600/5 transition-colors" />
      )}
    </button>
  );
}
