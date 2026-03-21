import { create } from 'zustand';
import { mockProducts, mockCategories, mockSuppliers } from '@/lib/mock-data';
import type { Product, AdjustmentReason, StockAdjustment } from '@/types';

type ProductFormData = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'categoryName' | 'supplierName'>;

interface ProductStore {
  products: Product[];
  stockAdjustments: StockAdjustment[];
  addProduct: (data: ProductFormData) => Product;
  updateProduct: (id: string, data: ProductFormData) => void;
  deleteProduct: (id: string) => void;
  adjustStock: (id: string, delta: number, reason: AdjustmentReason, note: string) => void;
}

export const useProductStore = create<ProductStore>((set, get) => ({
  products: mockProducts,
  stockAdjustments: [],

  addProduct: (data) => {
    const categoryName = mockCategories.find((c) => c.id === data.categoryId)?.name ?? '';
    const supplierName = mockSuppliers.find((s) => s.id === data.supplierId)?.name;
    const now = new Date().toISOString();
    const newProduct: Product = {
      ...data,
      id: `p${Date.now()}`,
      categoryName,
      supplierName,
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ products: [...s.products, newProduct] }));
    return newProduct;
  },

  updateProduct: (id, data) => {
    const categoryName = mockCategories.find((c) => c.id === data.categoryId)?.name ?? '';
    const supplierName = mockSuppliers.find((s) => s.id === data.supplierId)?.name;
    set((s) => ({
      products: s.products.map((p) =>
        p.id === id
          ? { ...p, ...data, categoryName, supplierName, updatedAt: new Date().toISOString() }
          : p
      ),
    }));
  },

  deleteProduct: (id) => {
    set((s) => ({ products: s.products.filter((p) => p.id !== id) }));
  },

  adjustStock: (id, delta, reason, note) => {
    const product = get().products.find((p) => p.id === id);
    if (!product) return;

    const stockBefore = product.currentStock;
    const stockAfter = Math.max(0, stockBefore + delta);
    const actualDelta = stockAfter - stockBefore;

    const entry: StockAdjustment = {
      id: `adj-${Date.now()}`,
      productId: id,
      productName: product.name,
      reason,
      quantityDelta: actualDelta,
      stockBefore,
      stockAfter,
      note,
      createdBy: 'Current User',
      createdAt: new Date().toISOString(),
    };

    set((s) => ({
      products: s.products.map((p) =>
        p.id === id
          ? { ...p, currentStock: stockAfter, updatedAt: new Date().toISOString() }
          : p
      ),
      stockAdjustments: [entry, ...s.stockAdjustments],
    }));
  },
}));
