import { create } from 'zustand';
import { isLegacySellingOption } from '@/types';
import type { Product, AdjustmentReason, StockAdjustment, Category, ProductSellingOption } from '@/types';
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
  fetchStockAdjustments: () => Promise<void>;
  addProduct: (data: ProductFormData, supplierName?: string) => Promise<Product | undefined>;
  updateProduct: (id: string, data: ProductFormData, supplierName?: string) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  adjustStock: (id: string, sellingOptionId: string | undefined, delta: number, reason: AdjustmentReason, note: string) => Promise<void>;
  openSackToKilo: (id: string, sackOptionId: string, kiloOptionId: string, sacks: number, note: string) => Promise<void>;
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

const mapSellingOption = (row: any): ProductSellingOption => ({
  id: row.id,
  productId: row.product_id,
  storeId: row.store_id,
  kind: row.kind ?? 'unit',
  label: row.label ?? row.unit_label ?? 'unit',
  unitLabel: row.unit_label ?? 'unit',
  quantityValue: row.quantity_value == null ? undefined : Number(row.quantity_value),
  quantityUnit: row.quantity_unit ?? undefined,
  stockQuantity: Number(row.stock_quantity ?? 0),
  sellingPrice: Number(row.selling_price ?? 0),
  lowStockThreshold: Number(row.low_stock_threshold ?? 0),
  isDefault: Boolean(row.is_default),
  isActive: row.is_active !== false,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const optionLabel = (option: ProductSellingOption) => option.label.trim() || option.unitLabel;

const normalizeSellingOptions = (
  data: ProductFormData,
  productId: string,
  storeId: string,
): ProductSellingOption[] => {
  const rawOptions = data.sellingOptions?.length
    ? data.sellingOptions
    : [{
        id: crypto.randomUUID(),
        productId,
        storeId,
        kind: data.unit === 'kg' ? 'kilo' as const : 'unit' as const,
        label: data.unit || 'unit',
        unitLabel: data.unit || 'unit',
        quantityValue: data.unit === 'kg' ? 1 : undefined,
        quantityUnit: data.unit === 'kg' ? 'kg' : undefined,
        stockQuantity: data.currentStock,
        sellingPrice: data.sellingPrice,
        lowStockThreshold: data.minStockLevel,
        isDefault: true,
        isActive: true,
      }];

  const sanitized = rawOptions.map((option) => ({
    ...option,
    id: option.id && !isLegacySellingOption(option) ? option.id : crypto.randomUUID(),
    productId,
    storeId,
    label: optionLabel(option),
    unitLabel: option.unitLabel.trim() || data.unit || 'unit',
    stockQuantity: Math.max(0, Number(option.stockQuantity) || 0),
    sellingPrice: Math.max(0, Number(option.sellingPrice) || 0),
    lowStockThreshold: Math.max(0, Number(option.lowStockThreshold) || 0),
    quantityValue: option.quantityValue == null || Number(option.quantityValue) <= 0 ? undefined : Number(option.quantityValue),
    quantityUnit: option.quantityUnit?.trim() || undefined,
    isDefault: Boolean(option.isDefault),
    isActive: option.isActive !== false,
    kind: option.kind || (option.unitLabel === 'kg' ? 'kilo' : 'unit'),
    createdAt: option.createdAt,
    updatedAt: option.updatedAt,
  }));

  const activeOptions = sanitized.filter((option) => option.isActive);
  const defaultId = activeOptions.find((option) => option.isDefault)?.id ?? activeOptions[0]?.id ?? sanitized[0]?.id;
  return sanitized.map((option, index) => ({
    ...option,
    isDefault: option.id === defaultId || (!defaultId && index === 0),
  }));
};

const toSellingOptionRow = (option: ProductSellingOption) => ({
  id: option.id,
  store_id: option.storeId,
  product_id: option.productId,
  kind: option.kind,
  label: optionLabel(option),
  unit_label: option.unitLabel,
  quantity_value: option.quantityValue ?? null,
  quantity_unit: option.quantityUnit ?? null,
  stock_quantity: option.stockQuantity,
  selling_price: option.sellingPrice,
  low_stock_threshold: option.lowStockThreshold,
  is_default: option.isDefault,
  is_active: option.isActive,
});

const getCompatibilityOption = (options: ProductSellingOption[], data: ProductFormData) => {
  return options.find((option) => option.isActive && option.isDefault)
    ?? options.find((option) => option.isActive)
    ?? options[0]
    ?? {
      unitLabel: data.unit || 'unit',
      sellingPrice: data.sellingPrice,
      stockQuantity: data.currentStock,
      lowStockThreshold: data.minStockLevel,
    };
};

export const useProductStore = create<ProductStore & {
  addCategory: (storeId: string, name: string) => Promise<void>;
  renameCategory: (categoryId: string, name: string) => Promise<void>;
  deleteCategory: (categoryId: string) => Promise<void>;
}>((set, get) => ({
    addCategory: async (storeId, name) => {
      if (!storeId || !name.trim()) return;
      const id = crypto.randomUUID();
      const { error } = await supabase.from('categories').insert({ id, store_id: storeId, name });
      if (error) throw error;
      // Refresh categories
      await get().fetchCategories(storeId);
    },

    renameCategory: async (categoryId, name) => {
      if (!categoryId || !name.trim()) return;
      const { error } = await supabase.from('categories').update({ name }).eq('id', categoryId);
      if (error) throw error;
      // Refresh categories
      const storeId = useAuthStore.getState().activeStoreId;
      if (storeId) await get().fetchCategories(storeId);
    },

    deleteCategory: async (categoryId) => {
      if (!categoryId) return;
      const { error } = await supabase.from('categories').delete().eq('id', categoryId);
      if (error) throw error;
      // Refresh categories
      const storeId = useAuthStore.getState().activeStoreId;
      if (storeId) await get().fetchCategories(storeId);
    },
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
      let query = supabase.from('products').select('*, suppliers(name), product_selling_options(*)');
      if (storeId !== 'all') {
        query = query.eq('store_id', storeId);
      }
      const { data, error } = await query;
      if (error) throw error;
      
      const mapped: Product[] = (data || []).map((p: any) => {
        const sellingOptions = (p.product_selling_options || [])
          .map(mapSellingOption)
          .sort((a: ProductSellingOption, b: ProductSellingOption) => {
            if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
            return optionLabel(a).localeCompare(optionLabel(b));
          });

        return {
          id: p.id,
          storeId: p.store_id,
          name: p.name,
          sku: p.sku,
          barcode: p.barcode,
          categoryId: p.category_id,
          categoryName: get().categories.find(c => c.id === p.category_id)?.name || '',
          unit: p.unit || 'unit',
          purchaseUnit: p.purchase_unit || undefined,
          conversionFactor: p.conversion_factor || 1,
          costPrice: p.cost_price,
          sellingPrice: p.selling_price,
          currentStock: p.current_stock,
          minStockLevel: p.min_stock_level,
          safetyStock: p.safety_stock || 0,
          reorderLevel: p.reorder_level || 0,
          leadTimeDays: p.lead_time_days || 0,
          supplierId: p.supplier_id || undefined,
          supplierName: p.suppliers?.name || undefined,
          imageUrl: p.image_url || undefined,
          sellingOptions,
          createdAt: p.created_at,
          updatedAt: p.updated_at,
        };
      });

      set({ products: mapped, isLoading: false });
      await cacheProductsLocally(mapped);
      void get().fetchStockAdjustments();
    } catch (err) {
      console.warn("Falling back to local cache", err);
      const cached = await getCachedProducts();
      set({ products: storeId === 'all' ? cached : cached.filter(p => p.storeId === storeId), isLoading: false });
    }
  },

  fetchStockAdjustments: async () => {
    const storeId = useAuthStore.getState().activeStoreId;
    if (!storeId) return;

    try {
      if (!navigator.onLine) return;
      let query = supabase
        .from('stock_adjustments')
        .select('*, products(name), product_selling_options(label, unit_label, quantity_value, quantity_unit)')
        .order('created_at', { ascending: false })
        .limit(250);

      if (storeId !== 'all') query = query.eq('store_id', storeId);
      const { data, error } = await query;
      if (error) throw error;

      const mapped: StockAdjustment[] = (data || []).map((row: any) => ({
        id: row.id,
        storeId: row.store_id,
        productId: row.product_id,
        productName: row.products?.name || 'Unknown product',
        sellingOptionId: row.selling_option_id || undefined,
        sellingOptionLabel: row.selling_option_label || row.product_selling_options?.label || undefined,
        unitLabel: row.unit_label || row.product_selling_options?.unit_label || undefined,
        packageSize: row.package_size == null ? undefined : Number(row.package_size),
        packageUnit: row.package_unit || row.product_selling_options?.quantity_unit || undefined,
        reason: row.reason,
        quantityDelta: Number(row.quantity_delta ?? 0),
        stockBefore: Number(row.stock_before ?? 0),
        stockAfter: Number(row.stock_after ?? 0),
        note: row.note || '',
        createdBy: row.created_by || '',
        createdAt: row.created_at,
      }));

      set({ stockAdjustments: mapped });
    } catch (err) {
      console.warn('Failed to fetch stock adjustments', err);
    }
  },

  addProduct: async (data) => {
    const storeId = data.storeId || useAuthStore.getState().activeStoreId;
    if (storeId === 'all') {
      console.warn("Cannot add product mapping to 'all' stores. Must pick one.");
      return undefined;
    }
    if (!storeId) return undefined;

    const newId = crypto.randomUUID();
    const sellingOptions = normalizeSellingOptions(data, newId, storeId);
    const compatibilityOption = getCompatibilityOption(sellingOptions, data);
    const newProd = {
      id: newId,
      store_id: storeId,
      name: data.name,
      sku: data.sku,
      barcode: data.barcode || null,
      category_id: data.categoryId,
      cost_price: data.costPrice,
      selling_price: compatibilityOption.sellingPrice,
      current_stock: Math.round(compatibilityOption.stockQuantity),
      min_stock_level: Math.round(compatibilityOption.lowStockThreshold),
      safety_stock: data.safetyStock,
      reorder_level: data.reorderLevel,
      lead_time_days: data.leadTimeDays,
      unit: compatibilityOption.unitLabel,
      purchase_unit: data.purchaseUnit || null,
      conversion_factor: data.conversionFactor || 1,
      supplier_id: data.supplierId || null,
      image_url: data.imageUrl || null,
    };

    // Optimistic Update
    const optimisticProd: Product = {
      ...data,
      id: newId,
      storeId,
      unit: compatibilityOption.unitLabel,
      sellingPrice: compatibilityOption.sellingPrice,
      currentStock: Math.round(compatibilityOption.stockQuantity),
      minStockLevel: Math.round(compatibilityOption.lowStockThreshold),
      sellingOptions,
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
      await executeOrQueueMutation('product_selling_options', 'INSERT', sellingOptions.map(toSellingOptionRow));
      return optimisticProd;
    } catch (err) {
      if (currentActiveStoreId === 'all' || currentActiveStoreId === storeId) {
        set(s => ({ products: s.products.filter(p => p.id !== newId) }));
      }
      throw err;
    }
  },

  updateProduct: async (id, data) => {
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

    const sellingOptions = normalizeSellingOptions(data, id, storeId);
    const compatibilityOption = getCompatibilityOption(sellingOptions, data);
    const updates = {
      name: data.name,
      sku: data.sku,
      barcode: data.barcode || null,
      category_id: data.categoryId,
      cost_price: data.costPrice,
      selling_price: compatibilityOption.sellingPrice,
      current_stock: Math.round(compatibilityOption.stockQuantity),
      min_stock_level: Math.round(compatibilityOption.lowStockThreshold),
      safety_stock: data.safetyStock,
      reorder_level: data.reorderLevel,
      lead_time_days: data.leadTimeDays,
      unit: compatibilityOption.unitLabel,
      purchase_unit: data.purchaseUnit || null,
      conversion_factor: data.conversionFactor || 1,
      supplier_id: data.supplierId || null,
      image_url: data.imageUrl || null,
      updated_at: new Date().toISOString(),
    };

    const previousProducts = get().products;

    // Optimistic Update
    set(s => ({
      products: s.products.map(p => 
        p.id === id ? {
          ...p,
          ...data,
          unit: compatibilityOption.unitLabel,
          sellingPrice: compatibilityOption.sellingPrice,
          currentStock: Math.round(compatibilityOption.stockQuantity),
          minStockLevel: Math.round(compatibilityOption.lowStockThreshold),
          sellingOptions,
          categoryName: get().categories.find(c => c.id === data.categoryId)?.name || '',
          updatedAt: updates.updated_at,
        } : p
      )
    }));

    try {
      await executeOrQueueMutation('products', 'UPDATE', updates, 'id', id);
      const existingIds = new Set(targetProduct.sellingOptions.map((option) => option.id));
      const currentDefaultId = targetProduct.sellingOptions.find((option) => option.isDefault)?.id;
      const nextDefaultId = sellingOptions.find((option) => option.isDefault)?.id;
      if (currentDefaultId && currentDefaultId !== nextDefaultId) {
        await executeOrQueueMutation('product_selling_options', 'UPDATE', { is_default: false }, 'id', currentDefaultId);
      }

      for (const option of sellingOptions) {
        const row = toSellingOptionRow(option);
        if (existingIds.has(option.id)) {
          await executeOrQueueMutation('product_selling_options', 'UPDATE', {
              kind: row.kind,
              label: row.label,
              unit_label: row.unit_label,
              quantity_value: row.quantity_value,
              quantity_unit: row.quantity_unit,
              stock_quantity: row.stock_quantity,
              selling_price: row.selling_price,
              low_stock_threshold: row.low_stock_threshold,
              is_default: row.is_default,
              is_active: row.is_active,
            }, 'id', option.id);
        } else {
          await executeOrQueueMutation('product_selling_options', 'INSERT', row);
        }
      }

      const submittedIds = new Set(sellingOptions.map((option) => option.id));
      const removedOptions = targetProduct.sellingOptions.filter((option) => !submittedIds.has(option.id));
      await Promise.all(removedOptions.map((option) =>
        executeOrQueueMutation('product_selling_options', 'UPDATE', { is_active: false }, 'id', option.id)
      ));
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

  adjustStock: async (id, sellingOptionId, delta, reason, note) => {
    let storeId = useAuthStore.getState().activeStoreId;
    const product = get().products.find((p) => p.id === id);
    if (!product) return;

    if (storeId === 'all') storeId = product.storeId;
    if (!storeId) return;

    const selectedOption = product.sellingOptions.find((option) => option.id === sellingOptionId);
    const usesSellingOption = Boolean(selectedOption && !isLegacySellingOption(selectedOption));
    const stockBefore = selectedOption ? selectedOption.stockQuantity : product.currentStock;
    const stockAfter = Math.max(0, stockBefore + delta);
    const actualDelta = stockAfter - stockBefore;
    if (actualDelta === 0) return;
    const entryId = crypto.randomUUID();

    // Optimistic Update products & adjustments array
    set(s => ({
      products: s.products.map(p => {
        if (p.id !== id) return p;
        if (!selectedOption) return { ...p, currentStock: Math.round(stockAfter) };
        const updatedOptions = p.sellingOptions.map((option) =>
          option.id === selectedOption.id ? { ...option, stockQuantity: stockAfter } : option
        );
        return {
          ...p,
          sellingOptions: updatedOptions,
          currentStock: selectedOption.isDefault ? Math.round(stockAfter) : p.currentStock,
        };
      })
    }));

    const newAdjustment: StockAdjustment = {
      id: entryId,
      storeId,
      productId: id,
      productName: product.name,
      sellingOptionId: selectedOption?.id,
      sellingOptionLabel: selectedOption?.label,
      unitLabel: selectedOption?.unitLabel || product.unit,
      packageSize: selectedOption?.quantityValue,
      packageUnit: selectedOption?.quantityUnit,
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
      selling_option_id: usesSellingOption ? selectedOption?.id : null,
      selling_option_label: selectedOption?.label || null,
      unit_label: selectedOption?.unitLabel || product.unit,
      package_size: selectedOption?.quantityValue ?? null,
      package_unit: selectedOption?.quantityUnit ?? null,
      stock_source: usesSellingOption ? 'selling_option' : 'product',
      reason,
      quantity_delta: actualDelta,
      stock_before: stockBefore,
      stock_after: stockAfter,
      note,
      created_by: useAuthStore.getState().user?.id || null,
    });

    if (usesSellingOption && selectedOption) {
      await executeOrQueueMutation('product_selling_options', 'UPDATE', {
        stock_quantity: stockAfter,
        updated_at: new Date().toISOString()
      }, 'id', selectedOption.id);

      if (selectedOption.isDefault) {
        await executeOrQueueMutation('products', 'UPDATE', {
          current_stock: Math.round(stockAfter),
          updated_at: new Date().toISOString()
        }, 'id', id);
      }
    } else {
      await executeOrQueueMutation('products', 'UPDATE', {
        current_stock: Math.round(stockAfter),
        updated_at: new Date().toISOString()
      }, 'id', id);
    }
  },

  openSackToKilo: async (id, sackOptionId, kiloOptionId, sacks, note) => {
    const product = get().products.find((p) => p.id === id);
    if (!product) return;

    const sackOption = product.sellingOptions.find((option) => option.id === sackOptionId);
    const kiloOption = product.sellingOptions.find((option) => option.id === kiloOptionId);
    if (!sackOption || !kiloOption) throw new Error('Select valid sack and kilo options.');
    if (sackOption.quantityValue == null || sackOption.quantityValue <= 0) {
      throw new Error('The sack option needs a configured quantity value.');
    }
    if (sackOption.stockQuantity < sacks) {
      throw new Error(`${sackOption.label} only has ${sackOption.stockQuantity} in stock.`);
    }

    const kiloDelta = sackOption.quantityValue * sacks;
    await supabase.rpc('open_sack_to_kilo', {
      p_sack_option_id: sackOptionId,
      p_kilo_option_id: kiloOptionId,
      p_sack_quantity: sacks,
      p_note: note || null,
    }).then(({ error }) => {
      if (error) throw error;
    });

    set((state) => ({
      products: state.products.map((p) => {
        if (p.id !== id) return p;
        const updatedOptions = p.sellingOptions.map((option) => {
          if (option.id === sackOptionId) {
            return { ...option, stockQuantity: option.stockQuantity - sacks };
          }
          if (option.id === kiloOptionId) {
            return { ...option, stockQuantity: option.stockQuantity + kiloDelta };
          }
          return option;
        });
        const nextDefault = updatedOptions.find((option) => option.isDefault);
        return {
          ...p,
          sellingOptions: updatedOptions,
          currentStock: nextDefault ? Math.round(nextDefault.stockQuantity) : p.currentStock,
        };
      }),
    }));

    void get().fetchStockAdjustments();
  },
}));
