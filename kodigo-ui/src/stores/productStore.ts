import { create } from 'zustand';
import type { Product, AdjustmentReason, StockAdjustment, Category } from '@/types';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from './authStore';
import { cacheProductsLocally, getCachedProducts, executeOrQueueMutation } from '@/lib/offline-sync';

type ProductFormData = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'categoryName' | 'supplierName'>;

interface ProductStore {
  categories: Category[];
  products: Product[];
  stockAdjustments: StockAdjustment[];
  isLoading: boolean;
  fetchCategories: (storeId: string) => Promise<void>;
  fetchProducts: () => Promise<void>;
  addProduct: (data: ProductFormData, supplierName?: string) => Promise<Product | undefined>;
  updateProduct: (id: string, data: ProductFormData, supplierName?: string) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  adjustStock: (id: string, delta: number, reason: AdjustmentReason, note: string) => Promise<void>;
}

const STATIC_CATEGORIES: Category[] = [
  { id: 'c1', name: 'Beverages' },
  { id: 'c2', name: 'Snacks' },
  { id: 'c3', name: 'Personal Care' },
  { id: 'c4', name: 'Canned Goods' },
  { id: 'c5', name: 'Condiments' },
  { id: 'c6', name: 'Dairy' },
  { id: 'c7', name: 'Household' },
  { id: 'c8', name: 'Tobacco' },
];

export const useProductStore = create<ProductStore>((set, get) => ({
  categories: [],
  products: [],
  stockAdjustments: [],
  isLoading: false,

  fetchCategories: async (storeId) => {
    if (!storeId || storeId === 'all') {
      // In combined view, we don't fetch or insert categories, just use static for display fallback
      if (get().categories.length === 0) set({ categories: STATIC_CATEGORIES });
      return;
    }
    try {
      if (!navigator.onLine) throw new Error('Offline');
      const { data, error } = await supabase.from('categories').select('*').eq('store_id', storeId);
      if (error) throw error;
      
      if (!data || data.length === 0) {
        // Seed database with default categories for this store with valid UUIDs
        const newCats = STATIC_CATEGORIES.map(c => ({
          id: crypto.randomUUID(),
          store_id: storeId,
          name: c.name
        }));
        const { error: insertError } = await supabase.from('categories').insert(newCats);
        if (insertError) throw insertError;
        set({ categories: newCats.map(c => ({ id: c.id, name: c.name })) });
      } else {
        set({ categories: data.map(c => ({ id: c.id, name: c.name })) });
      }
    } catch (err) {
      console.warn("Failed to fetch/seed categories", err);
      // For a specific store, keep categories empty to avoid invalid static IDs in FK category_id fields.
      set({ categories: [] });
    }
  },

  fetchProducts: async () => {
    const storeId = useAuthStore.getState().activeStoreId;
    if (!storeId) return;

    // ensure categories are loaded for mapping
    await get().fetchCategories(storeId);

    set({ isLoading: true });
    try {
      if (!navigator.onLine) throw new Error("Offline");
      let query = supabase.from('products').select('*');
      if (storeId !== 'all') {
        query = query.eq('store_id', storeId);
      }
      const { data, error } = await query;
      if (error) throw error;
      
      const mapped: Product[] = (data || []).map(p => ({
        id: p.id,
        storeId: p.store_id,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        categoryId: p.category_id,
        categoryName: get().categories.find(c => c.id === p.category_id)?.name || '', 
        unit: p.unit || 'unit',
        costPrice: p.cost_price,
        sellingPrice: p.selling_price,
        currentStock: p.current_stock,
        minStockLevel: p.min_stock_level,
        safetyStock: p.safety_stock || 0,
        reorderLevel: p.reorder_level || 0,
        leadTimeDays: p.lead_time_days || 0,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      }));

      set({ products: mapped, isLoading: false });
      await cacheProductsLocally(mapped);
    } catch (err) {
      console.warn("Falling back to local cache", err);
      const cached = await getCachedProducts();
      set({ products: storeId === 'all' ? cached : cached.filter(p => p.storeId === storeId), isLoading: false });
    }
  },

  addProduct: async (data, _supplierName) => {
    let storeId = data.storeId || useAuthStore.getState().activeStoreId;
    if (storeId === 'all') {
      console.warn("Cannot add product mapping to 'all' stores. Must pick one.");
      return undefined;
    }
    if (!storeId) return undefined;

    const newId = crypto.randomUUID();
    const newProd = {
      id: newId,
      store_id: storeId,
      name: data.name,
      sku: data.sku,
      barcode: data.barcode || null,
      category_id: data.categoryId,
      cost_price: data.costPrice,
      selling_price: data.sellingPrice,
      current_stock: data.currentStock,
      min_stock_level: data.minStockLevel,
      safety_stock: data.safetyStock,
      reorder_level: data.reorderLevel,
      lead_time_days: data.leadTimeDays,
      unit: data.unit,
      supplier_id: data.supplierId || null,
    };

    // Optimistic Update
    const optimisticProd: Product = {
      ...data,
      id: newId,
      storeId,
      categoryName: get().categories.find(c => c.id === data.categoryId)?.name || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    // Only add to local state if viewing 'all' stores or if viewing the store it was added to
    const currentActiveStoreId = useAuthStore.getState().activeStoreId;
    if (currentActiveStoreId === 'all' || currentActiveStoreId === storeId) {
      set(s => ({ products: [...s.products, optimisticProd] }));
    }

    try {
      await executeOrQueueMutation('products', 'INSERT', newProd);
      return optimisticProd;
    } catch (err) {
      if (currentActiveStoreId === 'all' || currentActiveStoreId === storeId) {
        set(s => ({ products: s.products.filter(p => p.id !== newId) }));
      }
      throw err;
    }
  },

  updateProduct: async (id, data, _supplierName) => {
    const targetProduct = get().products.find((p) => p.id === id);
    if (!targetProduct) {
      throw new Error('Product not found. Refresh the page and try again.');
    }

    let storeId = data.storeId || useAuthStore.getState().activeStoreId;
    if (storeId === 'all') {
      if (targetProduct) storeId = targetProduct.storeId;
      else return;
    }
    if (!storeId) return;

    const updates = {
      name: data.name,
      sku: data.sku,
      barcode: data.barcode || null,
      category_id: data.categoryId,
      cost_price: data.costPrice,
      selling_price: data.sellingPrice,
      current_stock: data.currentStock,
      min_stock_level: data.minStockLevel,
      safety_stock: data.safetyStock,
      reorder_level: data.reorderLevel,
      lead_time_days: data.leadTimeDays,
      unit: data.unit,
      supplier_id: data.supplierId || null,
      updated_at: new Date().toISOString(),
    };

    const previousProducts = get().products;

    // Optimistic Update
    set(s => ({
      products: s.products.map(p => 
        p.id === id ? { ...p, ...data, categoryName: get().categories.find(c => c.id === data.categoryId)?.name || '', updatedAt: updates.updated_at } : p
      )
    }));

    try {
      await executeOrQueueMutation('products', 'UPDATE', updates, 'id', id);
    } catch (err: any) {
      set({ products: previousProducts });

      if (err?.code === '23505') {
        throw new Error('Product SKU or barcode already exists in this store.');
      }
      if (err?.code === '42501') {
        throw new Error('Update blocked by permissions (RLS). Ensure you are an admin mapped to this store.');
      }

      throw err;
    }
  },

  deleteProduct: async (id) => {
    const previousProducts = get().products;

    // Optimistic Update
    set((s) => ({ products: s.products.filter((p) => p.id !== id) }));

    try {
      await Promise.race([
        executeOrQueueMutation('products', 'DELETE', undefined, 'id', id),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Delete request timed out. Check your internet and try again.')), 15000);
        })
      ]);
    } catch (err: any) {
      set({ products: previousProducts });

      if (err?.code === '42501') {
        throw new Error('Delete blocked by permissions (RLS). Ensure you are an admin mapped to this store.');
      }

      throw err;
    }
  },

  adjustStock: async (id, delta, reason, note) => {
    let storeId = useAuthStore.getState().activeStoreId;
    const product = get().products.find((p) => p.id === id);
    if (!product) return;

    if (storeId === 'all') storeId = product.storeId;
    if (!storeId) return;

    const stockBefore = product.currentStock;
    const stockAfter = Math.max(0, stockBefore + delta);
    const actualDelta = stockAfter - stockBefore;
    const entryId = crypto.randomUUID();

    // Optimistic Update products & adjustments array
    set(s => ({
      products: s.products.map(p => p.id === id ? { ...p, currentStock: stockAfter } : p)
    }));

    const newAdjustment: StockAdjustment = {
      id: entryId,
      storeId,
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

    set(s => ({ stockAdjustments: [newAdjustment, ...s.stockAdjustments] }));

    // Queue in background
    await executeOrQueueMutation('stock_adjustments', 'INSERT', {
      id: entryId,
      store_id: storeId,
      product_id: id,
      reason,
      quantity_delta: actualDelta,
      stock_before: stockBefore,
      stock_after: stockAfter,
      note
    });

    await executeOrQueueMutation('products', 'UPDATE', {
      current_stock: stockAfter,
      updated_at: new Date().toISOString()
    }, 'id', id);
  },
}));
