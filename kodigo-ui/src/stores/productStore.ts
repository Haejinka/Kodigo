import { create } from 'zustand';
import { calculateBulkPrice, getOptionInventoryMultiplier, isBulkSellingOption, isLegacySellingOption } from '@/types';
import type { Product, AdjustmentReason, StockAdjustment, Category, ProductSellingOption, ProductRestockingOption, RestockResult } from '@/types';
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
  seedDefaultCategories: (storeId: string) => Promise<Category[]>;
  addCategory: (storeId: string, name: string) => Promise<Category | undefined>;
  renameCategory: (categoryId: string, name: string, storeId?: string) => Promise<void>;
  deleteCategory: (categoryId: string, storeId?: string) => Promise<void>;
  fetchProducts: () => Promise<void>;
  fetchStockAdjustments: () => Promise<void>;
  addProduct: (data: ProductFormData, supplierName?: string) => Promise<Product | undefined>;
  updateProduct: (id: string, data: ProductFormData, supplierName?: string) => Promise<void>;
  setProductActive: (id: string, isActive: boolean) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  adjustStock: (id: string, sellingOptionId: string | undefined, delta: number, reason: AdjustmentReason, note: string, restock?: { restockingOptionId?: string; quantity: number; purchaseUnit: string; piecesPerUnit: number; totalSupplierCost?: number }) => Promise<RestockResult | void>;
  updateSellingPrice: (id: string, sellingPrice: number, reason?: string, updateFixedBundles?: boolean) => Promise<void>;
}

export const DEFAULT_CATEGORY_NAMES = [
  'Beverages',
  'Snacks',
  'Personal Care',
  'Canned Goods',
  'Condiments',
  'Dairy',
  'Household',
  'Tobacco',
];

const DEFAULT_CATEGORY_NAME_SET = new Set(DEFAULT_CATEGORY_NAMES.map((name) => name.toLowerCase()));

export const isDefaultCategoryName = (name: string) => DEFAULT_CATEGORY_NAME_SET.has(name.trim().toLowerCase());

const STATIC_CATEGORIES: Category[] = DEFAULT_CATEGORY_NAMES.map((name, index) => ({
  id: `default-${index + 1}`,
  name,
}));

const normalizeCategoryName = (name: string) => name.trim().replace(/\s+/g, ' ');
const categoryNameKey = (name: string) => normalizeCategoryName(name).toLowerCase();

// Category data is shared by several screens, so a request for an old store can
// otherwise overwrite the list for the store that is currently selected.
let latestCategoryRequest = 0;

const mapCategoryRows = (rows: any[] = []): Category[] => {
  return rows
    .map((row) => ({ id: row.id, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const fetchCategoriesForStore = async (storeId: string): Promise<Category[]> => {
  if (!storeId || storeId === 'all') return [];
  const knownStore = useAuthStore.getState().stores.find((store) => store.id === storeId);
  let ownerId = knownStore?.ownerId;
  if (!ownerId) {
    const { data, error } = await supabase.from('stores').select('owner_id').eq('id', storeId).single();
    if (error) throw toCategoryError(error);
    ownerId = data?.owner_id;
  }
  if (!ownerId) throw new Error('This store has no owner configured for shared categories.');
  const { data, error } = await supabase
    .from('categories')
    .select('id,name')
    .eq('owner_id', ownerId)
    .order('name', { ascending: true });
  if (error) throw toCategoryError(error);
  return mapCategoryRows(data || []);
};

const getActiveCategoryStoreId = (fallback?: string) => {
  const storeId = fallback || useAuthStore.getState().activeStoreId;
  return storeId && storeId !== 'all' ? storeId : undefined;
};

const toCategoryError = (err: any) => {
  if (err?.code === '23505') {
    return new Error('A category with that name already exists for this owner.');
  }
  if (err?.code === '23503') {
    return new Error('This category is assigned to products. Move those products to another category before deleting it.');
  }
  return err;
};

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
  inventoryMultiplier: Math.max(1, Number(row.inventory_multiplier ?? 1)),
  sharesBaseStock: row.shares_base_stock !== false,
  isBulk: row.is_bulk == null ? undefined : Boolean(row.is_bulk),
  discountType: row.discount_type === 'amount' ? 'amount' : 'percent',
  discountValue: Number(row.discount_value ?? 0),
  pricingMethod: row.pricing_method === 'fixed' || row.pricing_method === 'amount' || row.pricing_method === 'percent'
    ? row.pricing_method
    : row.discount_type === 'amount' ? 'amount' : 'percent',
  manualSellingPrice: row.manual_selling_price == null ? undefined : Number(row.manual_selling_price),
  isDefault: Boolean(row.is_default),
  isActive: row.is_active !== false,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapRestockingOption = (row: any): ProductRestockingOption => ({
  id: row.id,
  productId: row.product_id,
  storeId: row.store_id,
  label: row.label ?? row.unit_label ?? 'unit',
  conversionFactor: Math.max(1, Number(row.conversion_factor ?? 1)),
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
        inventoryMultiplier: 1,
        sharesBaseStock: true,
        isDefault: true,
        isActive: true,
        pricingMethod: 'percent' as const,
        manualSellingPrice: undefined,
      }];

  const baseUnit = data.unit?.trim() || 'unit';
  const sanitized = rawOptions.map((option) => {
    const inferredBulk = option.isBulk == null
      ? (!option.isDefault && (Number(option.inventoryMultiplier) > 1 || Number(option.quantityValue) > 1 || option.kind === 'sack'))
      : Boolean(option.isBulk);
    const isBulk = Boolean(inferredBulk);
    const unitsPerPackage = isBulk
      ? Math.max(2, getOptionInventoryMultiplier(option))
      : 1;
    const pricingMethod = option.pricingMethod
      ?? (option.discountType === 'amount' ? 'amount' as const : 'percent' as const);
    const discountType = pricingMethod === 'amount' || pricingMethod === 'fixed' ? 'amount' as const : 'percent' as const;
    const manualSellingPrice = pricingMethod === 'fixed'
      ? Math.max(0, Number(option.manualSellingPrice ?? option.sellingPrice) || 0)
      : undefined;
    const regularValue = data.sellingPrice * unitsPerPackage;
    const discountValue = pricingMethod === 'fixed'
      ? Math.max(0, regularValue - (manualSellingPrice ?? 0))
      : Math.max(0, Number(option.discountValue) || 0);
    return {
      ...option,
      id: option.id && !isLegacySellingOption(option) ? option.id : crypto.randomUUID(),
      productId,
      storeId,
      kind: isBulk ? 'custom' as const : (option.kind || (baseUnit === 'kg' ? 'kilo' : 'unit')),
      label: isBulk ? optionLabel(option) : baseUnit,
      unitLabel: baseUnit,
      quantityValue: isBulk ? unitsPerPackage : undefined,
      quantityUnit: isBulk ? baseUnit : undefined,
      stockQuantity: Math.floor(Math.max(0, Number(data.currentStock) || 0) / unitsPerPackage),
      sellingPrice: isBulk
        ? pricingMethod === 'fixed'
          ? manualSellingPrice ?? calculateBulkPrice(data.sellingPrice, unitsPerPackage, 'percent', 0)
            : calculateBulkPrice(data.sellingPrice, unitsPerPackage, discountType, discountValue)
        : Math.max(0, Number(data.sellingPrice) || Number(option.sellingPrice) || 0),
      lowStockThreshold: isBulk ? Math.floor(Math.max(0, Number(data.minStockLevel) || 0) / unitsPerPackage) : Math.max(0, Number(data.minStockLevel) || 0),
      inventoryMultiplier: unitsPerPackage,
      sharesBaseStock: true,
      isBulk,
      discountType,
      discountValue,
      pricingMethod,
      manualSellingPrice,
      isDefault: !isBulk,
      isActive: option.isActive !== false && (data.bulkPurchaseEnabled !== false || !isBulk),
      createdAt: option.createdAt,
      updatedAt: option.updatedAt,
    } satisfies ProductSellingOption;
  });

  if (!sanitized.some((option) => option.isActive && !option.isBulk)) {
    sanitized.unshift({
      id: crypto.randomUUID(),
      productId,
      storeId,
      kind: baseUnit === 'kg' ? 'kilo' : 'unit',
      label: baseUnit,
      unitLabel: baseUnit,
      stockQuantity: Math.max(0, Math.floor(Number(data.currentStock) || 0)),
      sellingPrice: Math.max(0, Number(data.sellingPrice) || 0),
      lowStockThreshold: Math.max(0, Number(data.minStockLevel) || 0),
      inventoryMultiplier: 1,
      sharesBaseStock: true,
      isBulk: false,
      discountType: 'percent',
      discountValue: 0,
      pricingMethod: 'percent',
      manualSellingPrice: undefined,
      quantityValue: undefined,
      quantityUnit: undefined,
      isDefault: true,
      isActive: true,
      createdAt: undefined,
      updatedAt: undefined,
    });
  }

  const activeOptions = sanitized.filter((option) => option.isActive);
  const defaultId = activeOptions.find((option) => !option.isBulk)?.id ?? activeOptions[0]?.id ?? sanitized[0]?.id;
  return sanitized.map((option, index) => ({
    ...option,
    isDefault: option.id === defaultId || (!defaultId && index === 0),
  }));
};

const normalizeRestockingOptions = (
  data: ProductFormData,
  productId: string,
  storeId: string,
): ProductRestockingOption[] => {
  const rawOptions = data.restockingOptions?.length
    ? data.restockingOptions
    : data.purchaseUnit
      ? [{
          id: crypto.randomUUID(),
          productId,
          storeId,
          label: data.purchaseUnit,
          conversionFactor: data.conversionFactor || 1,
          isDefault: true,
          isActive: true,
        }]
      : [];
  const active = rawOptions.filter((option) => option.isActive !== false);
  const defaultId = active.find((option) => option.isDefault)?.id ?? active[0]?.id;
  return rawOptions.map((option) => ({
    ...option,
    id: option.id || crypto.randomUUID(),
    productId,
    storeId,
    label: option.label?.trim() || 'unit',
    conversionFactor: Math.max(1, Number(option.conversionFactor) || 1),
    isDefault: option.id === defaultId,
    isActive: option.isActive !== false,
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
  inventory_multiplier: option.inventoryMultiplier,
  shares_base_stock: true,
  is_bulk: isBulkSellingOption(option),
  discount_type: option.discountType ?? 'percent',
  discount_value: option.discountValue ?? 0,
  pricing_method: option.pricingMethod ?? (option.discountType === 'amount' ? 'amount' : 'percent'),
  manual_selling_price: option.manualSellingPrice ?? null,
  is_default: option.isDefault,
  is_active: option.isActive,
});

const toRestockingOptionRow = (option: ProductRestockingOption) => ({
  id: option.id,
  store_id: option.storeId,
  product_id: option.productId,
  label: option.label.trim(),
  conversion_factor: option.conversionFactor,
  is_default: option.isDefault,
  is_active: option.isActive,
});

const normalizeSupplierIds = (data: ProductFormData): string[] => {
  const submittedIds = data.supplierIds?.length
    ? data.supplierIds
    : data.supplierId
      ? [data.supplierId]
      : [];

  return [...new Set(submittedIds.filter(Boolean))];
};

const replaceProductSuppliers = async (productId: string, supplierIds: string[]) => {
  // The RPC replaces the join rows and the legacy primary supplier reference
  // in one transaction. Supplier assignments are intentionally online-only;
  // the product's legacy supplier_id still keeps offline product mutations
  // usable until the next online edit.
  if (typeof window !== 'undefined' && !navigator.onLine) return;

  const { error } = await supabase.rpc('replace_product_suppliers', {
    p_product_id: productId,
    p_supplier_ids: supplierIds,
  });
  if (error) throw error;
};

export const useProductStore = create<ProductStore>((set, get) => ({
    addCategory: async (storeId, name) => {
      if (!storeId || storeId === 'all') throw new Error('Select a store before adding categories.');
      const normalizedName = normalizeCategoryName(name);
      if (!normalizedName) return undefined;

      // Do not use the shared category state for validation: it may still
      // contain the previous store's categories while a store switch is
      // reloading data. The database query is explicitly scoped to the target
      // store and remains the source of truth before the insert.
      const existingCategories = await fetchCategoriesForStore(storeId);
      const duplicate = existingCategories.some((category) => categoryNameKey(category.name) === categoryNameKey(normalizedName));
      if (duplicate) throw new Error('A category with that name already exists for this owner.');

      const id = crypto.randomUUID();
      const ownerId = useAuthStore.getState().stores.find((store) => store.id === storeId)?.ownerId;
      if (!ownerId) throw new Error('This store has no owner configured for shared categories.');
      const { data: insertedCategory, error } = await supabase
        .from('categories')
        .insert({ id, store_id: storeId, owner_id: ownerId, name: normalizedName })
        .select('id,name')
        .single();
      if (error) throw toCategoryError(error);
      if (useAuthStore.getState().activeStoreId === storeId) await get().fetchCategories(storeId);
      return insertedCategory ? { id: insertedCategory.id, name: insertedCategory.name } : { id, name: normalizedName };
    },

    renameCategory: async (categoryId, name, refreshStoreId) => {
      const normalizedName = normalizeCategoryName(name);
      if (!categoryId || !normalizedName) return;
      const storeId = getActiveCategoryStoreId(refreshStoreId);
      if (storeId) {
        const existingCategories = await fetchCategoriesForStore(storeId);
        const duplicate = existingCategories.some((category) =>
          category.id !== categoryId && categoryNameKey(category.name) === categoryNameKey(normalizedName)
        );
        if (duplicate) throw new Error('A category with that name already exists for this owner.');
      }

      const query = supabase.from('categories').update({ name: normalizedName }).eq('id', categoryId);
      const { error } = await query;
      if (error) throw toCategoryError(error);
      if (storeId && useAuthStore.getState().activeStoreId === storeId) await get().fetchCategories(storeId);
    },

    deleteCategory: async (categoryId, refreshStoreId) => {
      if (!categoryId) return;
      const { error } = await supabase.from('categories').delete().eq('id', categoryId);
      if (error) throw toCategoryError(error);
      const storeId = getActiveCategoryStoreId(refreshStoreId);
      if (storeId && useAuthStore.getState().activeStoreId === storeId) await get().fetchCategories(storeId);
    },
  categories: [],
  products: [],
  stockAdjustments: [],
  isLoading: false,

  fetchCategories: async (storeId) => {
    const requestId = ++latestCategoryRequest;
    if (!storeId || storeId === 'all') {
      // In combined view, keep static labels only as a display fallback.
      if (requestId === latestCategoryRequest && get().categories.length === 0) set({ categories: STATIC_CATEGORIES });
      return;
    }
    try {
      if (!navigator.onLine) throw new Error('Offline');
      const categories = await fetchCategoriesForStore(storeId);
      if (requestId === latestCategoryRequest && useAuthStore.getState().activeStoreId === storeId) set({ categories });
    } catch (err) {
      console.warn("Failed to fetch categories", err);
      // For a specific store, keep categories empty to avoid invalid static IDs in FK category_id fields.
      if (requestId === latestCategoryRequest && useAuthStore.getState().activeStoreId === storeId) set({ categories: [] });
    }
  },

  seedDefaultCategories: async (storeId) => {
    if (!storeId || storeId === 'all') throw new Error('Select a store before restoring default categories.');
    const ownerId = useAuthStore.getState().stores.find((store) => store.id === storeId)?.ownerId;
    if (!ownerId) throw new Error('This store has no owner configured for shared categories.');
    const { data, error } = await supabase
      .from('categories')
      .select('id,name')
      .eq('owner_id', ownerId);
    if (error) throw toCategoryError(error);

    const existing = mapCategoryRows(data || []);
    const existingNames = new Set(existing.map((category) => category.name.trim().toLowerCase()));
    const missingNames = DEFAULT_CATEGORY_NAMES.filter((name) => !existingNames.has(name.toLowerCase()));

    let inserted: Category[] = [];
    if (missingNames.length > 0) {
      const rows = missingNames.map((name) => ({
        id: crypto.randomUUID(),
        store_id: storeId,
        owner_id: ownerId,
        name,
      }));
      const { data: insertedRows, error: insertError } = await supabase
        .from('categories')
        .insert(rows)
        .select('id,name');
      if (insertError) throw toCategoryError(insertError);
      inserted = mapCategoryRows(insertedRows || rows);
    }

    if (useAuthStore.getState().activeStoreId === storeId) {
      set({ categories: mapCategoryRows([...existing, ...inserted]) });
    }
    return inserted;
  },

  fetchProducts: async () => {
    const storeId = useAuthStore.getState().activeStoreId;
    if (!storeId) return;

    // ensure categories are loaded for mapping
    await get().fetchCategories(storeId);

    set({ isLoading: true });
    try {
      if (!navigator.onLine) throw new Error("Offline");
      // products now has both the legacy supplier_id FK and the
      // product_suppliers join-table relationship. Explicitly select the
      // legacy FK relationship so PostgREST does not reject the query as
      // ambiguous and fall back to stale IndexedDB data.
      let query = supabase
        .from('products')
        .select('*, suppliers!products_supplier_id_fkey(name), product_selling_options(*)');
      if (storeId !== 'all') {
        query = query.eq('store_id', storeId);
      }
      const { data, error } = await query;
      if (error) throw error;

      const productRows = data || [];
      const productIds = productRows.map((product: any) => product.id).filter(Boolean);
      let supplierLinks: any[] = [];
      let restockingRows: any[] = [];
      if (productIds.length > 0) {
        const { data: relationRows, error: supplierLinksError } = await supabase
          .from('product_suppliers')
          .select('product_id,supplier_id,is_primary,suppliers(name)')
          .in('product_id', productIds);
        // Keep legacy single-supplier reads working while an environment is
        // being upgraded to migration 33.
        if (supplierLinksError && supplierLinksError.code !== '42P01') throw supplierLinksError;
        supplierLinks = relationRows || [];

          const { data: restockingData, error: restockingError } = await supabase
            .from('product_restocking_options')
            .select('*')
          .in('product_id', productIds)
          .eq('is_active', true);
        // The fallback keeps older projects usable until migration 37 is applied.
        if (restockingError && restockingError.code !== '42P01') throw restockingError;
        restockingRows = restockingData || [];
      }

      const linksByProduct = new Map<string, any[]>();
      for (const link of supplierLinks || []) {
        const links = linksByProduct.get(link.product_id) || [];
        links.push(link);
        linksByProduct.set(link.product_id, links);
      }
      const restockingByProduct = new Map<string, ProductRestockingOption[]>();
      for (const row of restockingRows) {
        const options = restockingByProduct.get(row.product_id) || [];
        options.push(mapRestockingOption(row));
        restockingByProduct.set(row.product_id, options);
      }
      
      const mapped: Product[] = productRows.map((p: any) => {
        const sellingOptions = (p.product_selling_options || [])
          .map(mapSellingOption)
          .sort((a: ProductSellingOption, b: ProductSellingOption) => {
            if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
            return optionLabel(a).localeCompare(optionLabel(b));
          });

        const supplierLinksForProduct = (linksByProduct.get(p.id) || [])
          .slice()
          .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)));
        const primarySupplierLink = supplierLinksForProduct.find((link) => link.is_primary)
          || supplierLinksForProduct[0];
        const supplierIds = supplierLinksForProduct.length > 0
          ? supplierLinksForProduct.map((link) => link.supplier_id)
          : p.supplier_id ? [p.supplier_id] : [];

        return {
          id: p.id,
          storeId: p.store_id,
          isActive: p.is_active !== false,
          name: p.name,
          sku: p.sku,
          barcode: p.barcode,
          categoryId: p.category_id,
          categoryName: get().categories.find(c => c.id === p.category_id)?.name || '',
          unit: p.unit || 'unit',
          purchaseUnit: p.purchase_unit || undefined,
          conversionFactor: p.conversion_factor || 1,
          bulkPurchasePrice: p.bulk_purchase_price == null ? undefined : Number(p.bulk_purchase_price),
          bulkPurchaseEnabled: Boolean(p.bulk_purchase_enabled) || sellingOptions.some((option: ProductSellingOption) => option.isBulk),
          autoPricingEnabled: Boolean(p.auto_pricing_enabled),
          marginPercentage: p.margin_percentage == null ? undefined : Number(p.margin_percentage),
          costPrice: p.cost_price,
          sellingPrice: p.selling_price,
          currentStock: p.current_stock,
          minStockLevel: p.min_stock_level,
          safetyStock: p.safety_stock || 0,
          reorderLevel: p.reorder_level || 0,
          leadTimeDays: p.lead_time_days || 0,
          supplierId: primarySupplierLink?.supplier_id || p.supplier_id || undefined,
          supplierName: primarySupplierLink?.suppliers?.name || p.suppliers?.name || undefined,
          supplierIds,
          imageUrl: p.image_url || undefined,
          restockingOptions: restockingByProduct.get(p.id) || (p.purchase_unit ? [{
            id: `legacy-restock-${p.id}`,
            productId: p.id,
            storeId: p.store_id,
            label: p.purchase_unit,
            conversionFactor: Math.max(1, Number(p.conversion_factor || 1)),
            isDefault: true,
            isActive: true,
          }] : []),
          priceRounding: p.price_rounding == null ? 1 : Math.max(1, Number(p.price_rounding)),
          sellingOptions,
          createdAt: p.created_at,
          updatedAt: p.updated_at,
        };
      });

      set({ products: mapped, isLoading: false });
      await cacheProductsLocally(mapped);
      void get().fetchStockAdjustments();
    } catch (err) {
      console.warn('Falling back to local cache', err);
      // Never show stale cached rows while online: they may no longer exist
      // in the database and would make edits/deletes target missing IDs.
      if (navigator.onLine) {
        set({ products: [], isLoading: false });
        return;
      }
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
    const supplierIds = normalizeSupplierIds(data);
    const primarySupplierId = supplierIds[0] || null;
    const sellingOptions = normalizeSellingOptions(data, newId, storeId);
    const restockingOptions = normalizeRestockingOptions(data, newId, storeId);
    const newProd = {
      id: newId,
      store_id: storeId,
      name: data.name,
      sku: data.sku,
      barcode: data.barcode || null,
      category_id: data.categoryId,
       cost_price: data.costPrice,
       selling_price: data.sellingPrice,
       current_stock: Math.round(data.currentStock),
       min_stock_level: Math.round(data.minStockLevel),
      safety_stock: data.safetyStock,
      reorder_level: data.reorderLevel,
      lead_time_days: data.leadTimeDays,
       unit: data.unit,
      purchase_unit: data.purchaseUnit || null,
      conversion_factor: data.conversionFactor || 1,
       bulk_purchase_price: data.bulkPurchasePrice ?? null,
       bulk_purchase_enabled: Boolean(data.bulkPurchaseEnabled),
      auto_pricing_enabled: Boolean(data.autoPricingEnabled),
       margin_percentage: data.marginPercentage ?? null,
      price_rounding: data.priceRounding ?? 1,
      supplier_id: primarySupplierId,
      image_url: data.imageUrl || null,
      is_active: true,
    };

    // Optimistic Update
    const optimisticProd: Product = {
      ...data,
      id: newId,
      storeId,
      isActive: true,
       unit: data.unit,
       sellingPrice: data.sellingPrice,
       currentStock: Math.round(data.currentStock),
      minStockLevel: Math.round(data.minStockLevel),
      supplierId: primarySupplierId || undefined,
      supplierIds,
      restockingOptions,
      priceRounding: data.priceRounding ?? 1,
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
      if (restockingOptions.length > 0) {
        await executeOrQueueMutation('product_restocking_options', 'INSERT', restockingOptions.map(toRestockingOptionRow));
      }
      await replaceProductSuppliers(newId, supplierIds);
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

    const supplierIds = normalizeSupplierIds(data);
    const primarySupplierId = supplierIds[0] || null;
    const sellingOptions = normalizeSellingOptions(data, id, storeId);
    const restockingOptions = normalizeRestockingOptions(data, id, storeId);
    const updates = {
      name: data.name,
      sku: data.sku,
      barcode: data.barcode || null,
      category_id: data.categoryId,
      cost_price: data.costPrice,
       selling_price: data.sellingPrice,
       current_stock: Math.round(data.currentStock),
       min_stock_level: Math.round(data.minStockLevel),
      safety_stock: data.safetyStock,
      reorder_level: data.reorderLevel,
      lead_time_days: data.leadTimeDays,
       unit: data.unit,
      purchase_unit: data.purchaseUnit || null,
      conversion_factor: data.conversionFactor || 1,
       bulk_purchase_price: data.bulkPurchasePrice ?? null,
       bulk_purchase_enabled: Boolean(data.bulkPurchaseEnabled),
      auto_pricing_enabled: Boolean(data.autoPricingEnabled),
       margin_percentage: data.marginPercentage ?? null,
      price_rounding: data.priceRounding ?? 1,
      supplier_id: primarySupplierId,
      image_url: data.imageUrl || null,
      is_active: data.isActive !== false,
      updated_at: new Date().toISOString(),
    };

    const previousProducts = get().products;

    // Optimistic Update
    set(s => ({
      products: s.products.map(p => 
        p.id === id ? {
          ...p,
          isActive: data.isActive !== false,
          ...data,
           unit: data.unit,
           sellingPrice: data.sellingPrice,
           currentStock: Math.round(data.currentStock),
           minStockLevel: Math.round(data.minStockLevel),
          supplierId: primarySupplierId || undefined,
          supplierIds,
          restockingOptions,
          priceRounding: data.priceRounding ?? 1,
          sellingOptions,
          categoryName: get().categories.find(c => c.id === data.categoryId)?.name || '',
          updatedAt: updates.updated_at,
        } : p
      )
    }));

    try {
      await executeOrQueueMutation('products', 'UPDATE', updates, 'id', id);
      await replaceProductSuppliers(id, supplierIds);
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
              inventory_multiplier: row.inventory_multiplier,
              shares_base_stock: row.shares_base_stock,
              is_bulk: row.is_bulk,
              discount_type: row.discount_type,
              discount_value: row.discount_value,
              pricing_method: row.pricing_method,
              manual_selling_price: row.manual_selling_price,
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

      const existingRestockingIds = new Set((targetProduct.restockingOptions || [])
        .filter((option) => !option.id.startsWith('legacy-restock-'))
        .map((option) => option.id));
      for (const option of restockingOptions) {
        const row = toRestockingOptionRow(option);
        if (existingRestockingIds.has(option.id)) {
          await executeOrQueueMutation('product_restocking_options', 'UPDATE', {
            label: row.label,
            conversion_factor: row.conversion_factor,
            is_default: row.is_default,
            is_active: row.is_active,
          }, 'id', option.id);
        } else {
          await executeOrQueueMutation('product_restocking_options', 'INSERT', row);
        }
      }
      const submittedRestockingIds = new Set(restockingOptions.map((option) => option.id));
      await Promise.all((targetProduct.restockingOptions || [])
        .filter((option) => !submittedRestockingIds.has(option.id) && !option.id.startsWith('legacy-restock-'))
        .map((option) => executeOrQueueMutation('product_restocking_options', 'UPDATE', { is_active: false }, 'id', option.id)));
    } catch (err: any) {
      set({ products: previousProducts });

      if (err?.code === '23505') {
        throw new Error('Product SKU or barcode already exists in this store.');
      }
      if (err?.code === '42501') {
        throw new Error('Update blocked by permissions (RLS). Ensure your admin or inventory account is mapped to this store.');
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

  setProductActive: async (id, isActive) => {
    const previousProducts = get().products;
    const targetProduct = previousProducts.find((product) => product.id === id);
    if (!targetProduct) {
      throw new Error('Product not found. Refresh the page and try again.');
    }

    const updatedAt = new Date().toISOString();
    set((state) => ({
      products: state.products.map((product) => product.id === id
        ? { ...product, isActive, updatedAt }
        : product),
    }));

    try {
      await executeOrQueueMutation(
        'products',
        'UPDATE',
        { is_active: isActive, updated_at: updatedAt },
        'id',
        id,
      );
    } catch (err: any) {
      set({ products: previousProducts });
      if (err?.code === '42501') {
        throw new Error('Product status change blocked by permissions (RLS). Ensure you are an admin or inventory user mapped to this store.');
      }
      throw err;
    }
  },

  adjustStock: async (id, sellingOptionId, delta, reason, note, restock) => {
    let storeId = useAuthStore.getState().activeStoreId;
    const product = get().products.find((p) => p.id === id);
    if (!product) return;

    if (storeId === 'all') storeId = product.storeId;
    if (!storeId) return;

    const selectedOption = product.sellingOptions.find((option) => option.id === sellingOptionId);
    // Bulk options are pricing modes only. Every adjustment is recorded against
    // the product's base-unit stock, while the selected option is retained as
    // audit metadata when one was chosen in the UI.
    const stockBefore = product.currentStock;
    const stockAfter = Math.max(0, stockBefore + delta);
    const actualDelta = stockAfter - stockBefore;
    if (actualDelta === 0) return;
    const entryId = crypto.randomUUID();

    // Optimistic Update products & adjustments array
    set(s => ({
      products: s.products.map(p => {
        if (p.id !== id) return p;
        return {
          ...p,
          sellingOptions: p.sellingOptions.map((option) => ({
            ...option,
            stockQuantity: Math.floor(stockAfter / Math.max(1, option.isBulk ? option.inventoryMultiplier : 1)),
          })),
          currentStock: Math.round(stockAfter),
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

    try {
      const { data: restockData, error } = reason === 'restock' && restock
        ? await supabase.rpc('restock_product_inventory_v2', {
            p_product_id: id,
            p_restocking_option_id: restock.restockingOptionId ?? null,
            p_quantity_in_purchase_units: restock.quantity,
            p_purchase_unit: restock.purchaseUnit,
            p_pieces_per_purchase_unit: restock.piecesPerUnit,
            p_total_supplier_cost: restock.totalSupplierCost ?? null,
            p_note: note || null,
          })
        : await supabase.rpc('adjust_inventory_stock', {
            p_product_id: id,
            p_selling_option_id: selectedOption?.id ?? null,
            p_quantity_delta: actualDelta,
            p_reason: reason,
            p_note: note || null,
          });
      if (error) throw error;
      if (reason === 'restock' && restock) {
        await Promise.all([get().fetchProducts(), get().fetchStockAdjustments()]);
        return {
          restockId: String(restockData?.restockId ?? restockData?.restock_id ?? entryId),
          productId: id,
          purchaseUnit: String(restockData?.purchaseUnit ?? restockData?.purchase_unit ?? restock.purchaseUnit),
          quantityReceived: Number(restockData?.quantityReceived ?? restockData?.quantity_received ?? restock.quantity),
          conversionFactor: Number(restockData?.conversionFactor ?? restockData?.conversion_factor ?? restock.piecesPerUnit),
          baseUnitsAdded: Number(restockData?.baseUnitsAdded ?? restockData?.base_units_added ?? delta),
          stockBefore: Number(restockData?.stockBefore ?? restockData?.stock_before ?? stockBefore),
          stockAfter: Number(restockData?.stockAfter ?? restockData?.stock_after ?? stockAfter),
          totalSupplierCost: restockData?.totalSupplierCost == null && restockData?.total_supplier_cost == null
            ? restock.totalSupplierCost
            : Number(restockData?.totalSupplierCost ?? restockData?.total_supplier_cost),
          previousCostPerBaseUnit: Number(restockData?.previousCostPerBaseUnit ?? restockData?.previous_cost_per_base_unit ?? product.costPrice),
          newCostPerBaseUnit: Number(restockData?.newCostPerBaseUnit ?? restockData?.new_cost_per_base_unit ?? product.costPrice),
          costChangePercent: restockData?.costChangePercent == null && restockData?.cost_change_percent == null
            ? undefined
            : Number(restockData?.costChangePercent ?? restockData?.cost_change_percent),
          previousGrossMargin: Number(restockData?.previousGrossMargin ?? restockData?.previous_gross_margin ?? 0),
          newGrossMargin: Number(restockData?.newGrossMargin ?? restockData?.new_gross_margin ?? 0),
          currentSellingPrice: Number(restockData?.currentSellingPrice ?? restockData?.current_selling_price ?? product.sellingPrice),
          suggestedSellingPrice: Number(restockData?.suggestedSellingPrice ?? restockData?.suggested_selling_price ?? product.sellingPrice),
          rawSuggestedSellingPrice: Number(restockData?.rawSuggestedSellingPrice ?? restockData?.raw_suggested_selling_price ?? product.sellingPrice),
          priceRounding: Number(restockData?.priceRounding ?? restockData?.price_rounding ?? product.priceRounding ?? 1),
        } satisfies RestockResult;
      }
    } catch (error) {
      await Promise.all([get().fetchProducts(), get().fetchStockAdjustments()]);
      throw error;
    }
  },

  updateSellingPrice: async (id, sellingPrice, reason = 'Owner approved suggested price', updateFixedBundles = false) => {
    const targetProduct = get().products.find((product) => product.id === id);
    if (!targetProduct) throw new Error('Product not found. Refresh the page and try again.');
    const safePrice = Math.max(0, Math.round((Number(sellingPrice) + Number.EPSILON) * 100) / 100);
    const invalidFixedBundle = targetProduct.sellingOptions.find((option) => {
      if (!option.isBulk || option.pricingMethod !== 'fixed') return false;
      return (option.manualSellingPrice ?? option.sellingPrice) > safePrice * Math.max(1, option.inventoryMultiplier);
    });
    if (invalidFixedBundle && !updateFixedBundles) {
      throw new Error(`${invalidFixedBundle.label} is priced above the new regular value. Review that bundle price first.`);
    }
    const previousProducts = get().products;
    set((state) => ({
      products: state.products.map((product) => product.id === id
        ? { ...product, sellingPrice: safePrice, updatedAt: new Date().toISOString() }
        : product),
    }));
    try {
      const { error } = await supabase
        .from('products')
        .update({ selling_price: safePrice, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      if (updateFixedBundles) {
        const fixedBundlesBelowCost = targetProduct.sellingOptions.filter((option) => {
          if (!option.isBulk || option.pricingMethod !== 'fixed') return false;
          return (option.manualSellingPrice ?? option.sellingPrice) < targetProduct.costPrice * Math.max(1, option.inventoryMultiplier);
        });
        for (const option of fixedBundlesBelowCost) {
          const bundlePrice = Math.round((safePrice * Math.max(1, option.inventoryMultiplier) + Number.EPSILON) * 100) / 100;
          const { error: optionError } = await supabase
            .from('product_selling_options')
            .update({
              selling_price: bundlePrice,
              manual_selling_price: bundlePrice,
              discount_type: 'amount',
              discount_value: 0,
              pricing_method: 'fixed',
              updated_at: new Date().toISOString(),
            })
            .eq('id', option.id);
          if (optionError) throw optionError;
        }
      }
      void reason;
      await get().fetchProducts();
    } catch (error) {
      set({ products: previousProducts });
      throw error;
    }
  },

}));
