import { create } from 'zustand';
import type { CartItem, Product } from '@/types';
import { useAuthStore } from './authStore';

interface CartState {
  items: CartItem[];
  addItem: (product: Product, qty?: number) => void;
  removeItem: (productId: string) => void;
  updateQty: (productId: string, qty: number) => void;
  clearCart: () => void;
  total: () => number;
  subtotal: () => number;
  itemCount: () => number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],

  addItem: (product: Product, qty = 1) => {
    const maxStock = Math.max(0, product.currentStock);
    if (maxStock === 0) return;
    const safeQty = Math.min(Math.max(1, qty), maxStock);

    set((state) => {
      const existing = state.items.find((i) => i.product.id === product.id);
      if (existing) {
        const newQty = Math.min(existing.quantity + safeQty, maxStock);
        return {
          items: state.items.map((i) =>
            i.product.id === product.id
              ? { ...i, quantity: newQty, lineTotal: newQty * i.product.sellingPrice }
              : i
          ),
        };
      }
      return {
        items: [
          ...state.items,
          { product, quantity: safeQty, lineTotal: safeQty * product.sellingPrice },
        ],
      };
    });
  },

  removeItem: (productId: string) => {
    set((state) => ({ items: state.items.filter((i) => i.product.id !== productId) }));
  },

  updateQty: (productId: string, qty: number) => {
    if (qty <= 0) {
      get().removeItem(productId);
      return;
    }
    const existing = get().items.find((i) => i.product.id === productId);
    if (!existing) return;
    const maxStock = Math.max(0, existing.product.currentStock);
    if (maxStock === 0) {
      get().removeItem(productId);
      return;
    }
    const safeQty = Math.min(qty, maxStock);
    set((state) => ({
      items: state.items.map((i) =>
        i.product.id === productId
          ? { ...i, quantity: safeQty, lineTotal: safeQty * i.product.sellingPrice }
          : i
      ),
    }));
  },

  clearCart: () => set({ items: [] }),

  subtotal: () => get().items.reduce((sum, i) => sum + i.lineTotal, 0),
  total: () => get().items.reduce((sum, i) => sum + i.lineTotal, 0),
  itemCount: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
}));

// Clear cart when active store changes
useAuthStore.subscribe((state, prevState) => {
  if (state.activeStoreId !== prevState.activeStoreId) {
    useCartStore.getState().clearCart();
  }
});
