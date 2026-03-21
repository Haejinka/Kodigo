import { create } from 'zustand';
import type { CartItem, Product } from '@/types';

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
    set((state) => {
      const existing = state.items.find((i) => i.product.id === product.id);
      if (existing) {
        const newQty = existing.quantity + qty;
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
          { product, quantity: qty, lineTotal: qty * product.sellingPrice },
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
    set((state) => ({
      items: state.items.map((i) =>
        i.product.id === productId
          ? { ...i, quantity: qty, lineTotal: qty * i.product.sellingPrice }
          : i
      ),
    }));
  },

  clearCart: () => set({ items: [] }),

  subtotal: () => get().items.reduce((sum, i) => sum + i.lineTotal, 0),
  total: () => get().items.reduce((sum, i) => sum + i.lineTotal, 0),
  itemCount: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
}));
