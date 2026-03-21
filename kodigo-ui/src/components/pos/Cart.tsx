import { Minus, Plus, Trash2, ShoppingCart, Package } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import { useCartStore } from '@/stores/cartStore';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/shared/Button';
import { useState } from 'react';

interface CartProps {
  onCharge: () => void;
}

/** Inline-editable qty cell: click the number to type a value directly */
function QtyCell({ productId, quantity, maxStock }: { productId: string; quantity: number; maxStock: number }) {
  const { updateQty } = useCartStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const commit = (raw: string) => {
    const n = parseInt(raw);
    if (!isNaN(n) && n > 0) updateQty(productId, Math.min(n, maxStock));
    setEditing(false);
    setDraft('');
  };

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        min={1}
        max={maxStock}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(draft);
          if (e.key === 'Escape') { setEditing(false); setDraft(''); }
        }}
        className="w-10 text-center text-sm font-semibold font-mono border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
      />
    );
  }

  return (
    <button
      title="Click to edit quantity"
      onClick={() => { setEditing(true); setDraft(String(quantity)); }}
      className="w-8 text-center text-sm font-semibold font-mono text-gray-900 hover:bg-blue-50 hover:text-blue-700 rounded transition-colors leading-6"
    >
      {quantity}
    </button>
  );
}

export function Cart({ onCharge }: CartProps) {
  const { items, removeItem, updateQty, subtotal, total } = useCartStore();
  const sub = subtotal();
  const tot = total();

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <ShoppingCart className="w-4 h-4" />
          Order Summary
        </h2>
        {items.length > 0 && (
          <span className="text-xs bg-blue-100 text-blue-700 font-semibold px-2 py-0.5 rounded-full">
            {items.reduce((s, i) => s + i.quantity, 0)} items
          </span>
        )}
      </div>

      {/* Cart Items */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="Cart is empty"
            description="Add products by searching or scanning a barcode"
          />
        ) : (
          <ul className="divide-y divide-gray-50">
            {items.map((item) => (
              <li key={item.product.id} className="px-4 py-3 flex items-start gap-3">
                {/* Product thumbnail */}
                <div className="w-9 h-9 rounded-lg border border-gray-100 bg-gray-50 overflow-hidden flex items-center justify-center shrink-0 mt-0.5">
                  {item.product.imageUrl ? (
                    <img src={item.product.imageUrl} alt={item.product.name} className="w-full h-full object-cover" />
                  ) : (
                    <Package className="w-4 h-4 text-gray-300" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{item.product.name}</p>
                  <p className="text-xs text-gray-400 font-mono">{formatCurrency(item.product.sellingPrice)} each</p>
                </div>

                {/* Qty stepper — click the number to type directly */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => updateQty(item.product.id, item.quantity - 1)}
                    className="w-6 h-6 rounded-md bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
                  >
                    <Minus className="w-3 h-3 text-gray-600" />
                  </button>
                  <QtyCell
                    productId={item.product.id}
                    quantity={item.quantity}
                    maxStock={item.product.currentStock}
                  />
                  <button
                    onClick={() => updateQty(item.product.id, item.quantity + 1)}
                    className={cn(
                      'w-6 h-6 rounded-md flex items-center justify-center transition-colors',
                      item.quantity >= item.product.currentStock
                        ? 'bg-gray-50 cursor-not-allowed opacity-40'
                        : 'bg-gray-100 hover:bg-gray-200'
                    )}
                    disabled={item.quantity >= item.product.currentStock}
                  >
                    <Plus className="w-3 h-3 text-gray-600" />
                  </button>
                </div>

                <div className="text-right shrink-0 ml-2">
                  <p className="text-sm font-bold font-mono text-gray-900">
                    {formatCurrency(item.lineTotal)}
                  </p>
                  <button
                    onClick={() => removeItem(item.product.id)}
                    className="mt-1 text-gray-300 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Totals */}
      <div className="border-t border-gray-100 px-4 pt-3 pb-4 space-y-1">
        <div className="flex justify-between text-sm text-gray-600">
          <span>Subtotal</span>
          <span className="font-mono">{formatCurrency(sub)}</span>
        </div>
        <div className="flex justify-between text-sm text-gray-400">
          <span>Tax (0%)</span>
          <span className="font-mono">₱0.00</span>
        </div>
        <div className="flex justify-between text-sm text-gray-400">
          <span>Discount</span>
          <span className="font-mono">₱0.00</span>
        </div>
        <div className="flex justify-between text-base font-bold text-gray-900 pt-2 border-t border-gray-100">
          <span>Total</span>
          <span className="font-mono text-blue-600">{formatCurrency(tot)}</span>
        </div>

        <Button
          onClick={onCharge}
          disabled={items.length === 0}
          variant="primary"
          size="lg"
          className="w-full mt-4 text-base relative"
        >
          <span>Charge {items.length > 0 ? formatCurrency(tot) : ''}</span>
          <span className="absolute right-4 text-xs bg-blue-700/50 px-2 py-0.5 rounded-md text-blue-100 hidden sm:block">
            F9
          </span>
        </Button>
      </div>
    </div>
  );
}
