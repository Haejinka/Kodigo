import { create } from 'zustand';
import { getAvailableSellingUnits, getDefaultSellingOption, isLegacySellingOption } from '@/types';
import type { CartItem, DiscountType, Product, ProductSellingOption } from '@/types';
import { useAuthStore } from './authStore';

interface CartState {
  items: CartItem[];
  discountType: DiscountType;
  discountValue: number;
  addItem: (product: Product, option?: ProductSellingOption, qty?: number) => void;
  removeItem: (lineId: string) => void;
  updateQty: (lineId: string, qty: number) => void;
  setDiscount: (type: DiscountType, value: number) => void;
  clearCart: () => void;
  total: () => number;
  subtotal: () => number;
  discountAmount: () => number;
  taxRate: () => number;
  taxAmount: () => number;
  itemCount: () => number;
}

const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const getActiveStoreTaxRate = () => {
  const { activeStoreId, stores } = useAuthStore.getState();
  if (!activeStoreId || activeStoreId === 'all') return 0;
  return stores.find((store) => store.id === activeStoreId)?.taxRate ?? 0;
};

const getLineId = (product: Product, option: ProductSellingOption) => {
  const optionId = isLegacySellingOption(option) ? 'legacy' : option.id;
  return `${product.id}:${optionId}`;
};

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  discountType: 'amount',
  discountValue: 0,

  addItem: (product: Product, option = getDefaultSellingOption(product), qty = 1) => {
    const maxStock = getAvailableSellingUnits(product, option);
    if (maxStock === 0) return;
    const safeQty = Math.min(Math.max(1, qty), maxStock);
    const lineId = getLineId(product, option);

    set((state) => {
      const existing = state.items.find((i) => i.id === lineId);
      if (existing) {
        const newQty = Math.min(existing.quantity + safeQty, maxStock);
        return {
          items: state.items.map((i) =>
            i.id === lineId
              ? { ...i, quantity: newQty, lineTotal: newQty * i.sellingOption.sellingPrice }
              : i
          ),
        };
      }
      return {
        items: [
          ...state.items,
          { id: lineId, product, sellingOption: option, quantity: safeQty, lineTotal: safeQty * option.sellingPrice },
        ],
      };
    });
  },

  removeItem: (lineId: string) => {
    set((state) => ({ items: state.items.filter((i) => i.id !== lineId) }));
  },

  updateQty: (lineId: string, qty: number) => {
    if (qty <= 0) {
      get().removeItem(lineId);
      return;
    }
    const existing = get().items.find((i) => i.id === lineId);
    if (!existing) return;
    const maxStock = getAvailableSellingUnits(existing.product, existing.sellingOption);
    if (maxStock === 0) {
      get().removeItem(lineId);
      return;
    }
    const safeQty = Math.min(qty, maxStock);
    set((state) => ({
      items: state.items.map((i) =>
        i.id === lineId
          ? { ...i, quantity: safeQty, lineTotal: safeQty * i.sellingOption.sellingPrice }
          : i
      ),
    }));
  },

  setDiscount: (type, value) => {
    const safeValue = Math.max(0, Number.isFinite(value) ? value : 0);
    set({ discountType: type, discountValue: safeValue });
  },

  clearCart: () => set({ items: [], discountType: 'amount', discountValue: 0 }),

  subtotal: () => get().items.reduce((sum, i) => sum + i.lineTotal, 0),
  discountAmount: () => {
    const subtotal = get().subtotal();
    const { discountType, discountValue } = get();
    if (discountType === 'percent') {
      return roundCurrency(subtotal * Math.min(discountValue, 100) / 100);
    }
    return roundCurrency(Math.min(discountValue, subtotal));
  },
  taxRate: () => getActiveStoreTaxRate(),
  taxAmount: () => {
    const taxable = Math.max(0, get().subtotal() - get().discountAmount());
    return roundCurrency(taxable * get().taxRate() / 100);
  },
  total: () => roundCurrency(get().subtotal() - get().discountAmount() + get().taxAmount()),
  itemCount: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
}));

// Clear cart when active store changes
useAuthStore.subscribe((state, prevState) => {
  if (state.activeStoreId !== prevState.activeStoreId) {
    useCartStore.getState().clearCart();
  }
});
