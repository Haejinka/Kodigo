import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ImagePlus, Link, Package, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { useToast } from '@/components/shared/Toast';
import { useAuthStore } from '@/stores/authStore';
import { fetchCategoriesForStore, useProductStore } from '@/stores/productStore';
import { fetchSuppliersForStore, useSupplierStore } from '@/stores/supplierStore';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { calculateBulkPrice, isBulkSellingOption } from '@/types';
import type { BulkDiscountType, Category, Product, ProductSellingOption, Supplier } from '@/types';

type ProductFormData = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'categoryName' | 'supplierName'>;

interface ProductFormProps {
  initial?: Partial<Product>;
  onSubmit: (data: ProductFormData) => Promise<void>;
  mode: 'create' | 'edit';
}

const inputCls = 'h-10 w-full rounded-lg border border-[var(--input)] bg-[var(--background)] px-3 py-2 text-base text-[var(--foreground)] shadow-sm outline-none transition-[border-color,box-shadow] placeholder:text-[var(--muted-foreground)] focus-visible:border-[var(--ring)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]/20 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm';
const cardCls = 'rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)]';
const titleCls = 'text-sm font-semibold text-[var(--foreground)]';
const unitChoices = ['piece', 'bottle', 'can', 'stick', 'sachet', 'kg', 'pack', 'box', 'bag', 'tray', 'sack', 'bundle', 'dozen'];
const supplierPurchaseUnits = ['pack', 'box', 'bag', 'tray', 'case', 'bundle', 'roll', 'dozen'];

function Field({ id, label, required, children, hint }: { id?: string; label: string; required?: boolean; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-[var(--foreground)]">
        {label}{required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs leading-5 text-[var(--muted-foreground)]">{hint}</p>}
    </div>
  );
}

function createBaseOption(storeId: string, initial?: Partial<Product>): ProductSellingOption {
  return {
    id: initial?.sellingOptions?.find((option) => !isBulkSellingOption(option))?.id ?? crypto.randomUUID(),
    productId: initial?.id ?? '',
    storeId,
    kind: initial?.unit === 'kg' ? 'kilo' : 'unit',
    label: initial?.unit ?? 'piece',
    unitLabel: initial?.unit ?? 'piece',
    stockQuantity: initial?.currentStock ?? 0,
    sellingPrice: initial?.sellingPrice ?? 0,
    lowStockThreshold: initial?.minStockLevel ?? 0,
    inventoryMultiplier: 1,
    sharesBaseStock: true,
    isBulk: false,
    discountType: 'percent',
    discountValue: 0,
    isDefault: true,
    isActive: true,
  };
}

function createBulkOption(storeId: string, unit: string, seed?: Partial<ProductSellingOption>): ProductSellingOption {
  const seededMultiplier = Number(seed?.inventoryMultiplier) || 0;
  const unitsPerBulk = Math.max(2, seededMultiplier > 1 ? seededMultiplier : Number(seed?.quantityValue) || seededMultiplier || 2);
  const discountType: BulkDiscountType = seed?.discountType === 'amount' ? 'amount' : 'percent';
  return {
    id: seed?.id ?? crypto.randomUUID(),
    productId: seed?.productId ?? '',
    storeId,
    kind: 'custom',
    label: seed?.label ?? 'Case',
    unitLabel: unit,
    quantityValue: unitsPerBulk,
    quantityUnit: unit,
    stockQuantity: 0,
    sellingPrice: seed?.sellingPrice ?? 0,
    lowStockThreshold: 0,
    inventoryMultiplier: unitsPerBulk,
    sharesBaseStock: true,
    isBulk: true,
    discountType,
    discountValue: Math.max(0, Number(seed?.discountValue ?? 0)),
    isDefault: false,
    isActive: seed?.isActive !== false,
    createdAt: seed?.createdAt,
    updatedAt: seed?.updatedAt,
  };
}

function getInitialOptions(storeId: string, initial?: Partial<Product>) {
  const base = createBaseOption(storeId, initial);
  const bulkOptions = (initial?.sellingOptions ?? [])
    .filter((option) => isBulkSellingOption(option))
    .map((option) => createBulkOption(storeId, initial?.unit ?? 'piece', option));
  return [base, ...bulkOptions];
}

export function ProductForm({ initial, onSubmit, mode }: ProductFormProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { stores, activeStoreId, role } = useAuthStore();
  const fetchCategories = useProductStore((state) => state.fetchCategories);
  const addCategory = useProductStore((state) => state.addCategory);
  const seedDefaultCategories = useProductStore((state) => state.seedDefaultCategories);
  const addSupplier = useSupplierStore((state) => state.addSupplier);
  const [loading, setLoading] = useState(false);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [storeCategories, setStoreCategories] = useState<Category[]>([]);
  const [storeSuppliers, setStoreSuppliers] = useState<Supplier[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [quickAddType, setQuickAddType] = useState<'category' | 'supplier' | null>(null);
  const [quickAddName, setQuickAddName] = useState('');
  const [quickAddLoading, setQuickAddLoading] = useState(false);
  const [urlInputMode, setUrlInputMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialStoreId = initial?.storeId ?? (activeStoreId === 'all' ? '' : activeStoreId) ?? '';
  const initialSupplierIds = initial?.supplierIds?.length
    ? initial.supplierIds
    : initial?.supplierId
      ? [initial.supplierId]
      : [];

  const [form, setForm] = useState<ProductFormData>(() => ({
    storeId: initialStoreId,
    name: initial?.name ?? '',
    sku: initial?.sku ?? '',
    barcode: initial?.barcode ?? '',
    categoryId: initial?.categoryId ?? '',
    unit: initial?.unit ?? 'piece',
    purchaseUnit: initial?.purchaseUnit ?? '',
    conversionFactor: initial?.conversionFactor ?? 1,
    bulkPurchasePrice: initial?.bulkPurchasePrice,
    bulkPurchaseEnabled: initial?.bulkPurchaseEnabled ?? (initial?.sellingOptions ?? []).some(isBulkSellingOption),
    autoPricingEnabled: initial?.autoPricingEnabled ?? false,
    marginPercentage: initial?.marginPercentage ?? 20,
    costPrice: initial?.costPrice ?? 0,
    sellingPrice: initial?.sellingPrice ?? 0,
    currentStock: initial?.currentStock ?? 0,
    minStockLevel: initial?.minStockLevel ?? 0,
    safetyStock: initial?.safetyStock ?? 0,
    reorderLevel: initial?.reorderLevel ?? 0,
    leadTimeDays: initial?.leadTimeDays ?? 1,
    supplierId: initialSupplierIds[0] ?? '',
    supplierIds: initialSupplierIds,
    imageUrl: initial?.imageUrl,
    sellingOptions: getInitialOptions(initialStoreId, initial),
  }));

  const bulkOptions = form.sellingOptions.filter((option) => option.isBulk && option.isActive);
  const baseOption = form.sellingOptions.find((option) => !option.isBulk) ?? form.sellingOptions[0];
  const baseUnit = form.unit || baseOption?.unitLabel || 'unit';
  const basePrice = Math.max(0, Number(form.sellingPrice) || 0);
  const selectedSupplierIds = form.supplierIds?.length
    ? form.supplierIds
    : form.supplierId
      ? [form.supplierId]
      : [];

  useEffect(() => {
    if (mode !== 'create' || !activeStoreId || activeStoreId === 'all') return;
    setForm((prev) => prev.storeId === activeStoreId
      ? prev
      : { ...prev, storeId: activeStoreId, categoryId: '', supplierId: '', supplierIds: [], sellingOptions: prev.sellingOptions.map((option) => ({ ...option, storeId: activeStoreId })) });
  }, [activeStoreId, mode]);

  useEffect(() => {
    const targetStoreId = form.storeId || (activeStoreId === 'all' ? '' : activeStoreId) || '';
    if (!targetStoreId) {
      setStoreCategories([]);
      setStoreSuppliers([]);
      return;
    }
    let cancelled = false;
    setCategoryLoading(true);
    void Promise.all([
      fetchCategoriesForStore(targetStoreId),
      role === 'admin' ? fetchSuppliersForStore(targetStoreId) : Promise.resolve([]),
    ]).then(([categories, suppliers]) => {
      if (cancelled) return;
      setStoreCategories(categories);
      setStoreSuppliers(suppliers);
      setForm((prev) => ({
        ...prev,
        categoryId: categories.some((category) => category.id === prev.categoryId) ? prev.categoryId : '',
        supplierIds: role === 'admin'
          ? (prev.supplierIds?.length ? prev.supplierIds : prev.supplierId ? [prev.supplierId] : [])
            .filter((supplierId) => suppliers.some((supplier) => supplier.id === supplierId))
          : (prev.supplierIds?.length ? prev.supplierIds : prev.supplierId ? [prev.supplierId] : []),
        supplierId: role === 'admin'
          ? ((prev.supplierIds?.length ? prev.supplierIds : prev.supplierId ? [prev.supplierId] : [])
            .find((supplierId) => suppliers.some((supplier) => supplier.id === supplierId)) || '')
          : prev.supplierId || prev.supplierIds?.[0] || '',
      }));
    }).catch(() => {
      if (cancelled) return;
      setStoreCategories([]);
      setStoreSuppliers([]);
    }).finally(() => {
      if (!cancelled) setCategoryLoading(false);
    });
    return () => { cancelled = true; };
  }, [activeStoreId, form.storeId, role]);

  useEffect(() => {
    const targetStoreId = form.storeId || (activeStoreId === 'all' ? 'all' : activeStoreId);
    if (targetStoreId) void fetchCategories(targetStoreId);
  }, [activeStoreId, fetchCategories, form.storeId]);

  useEffect(() => {
    if (!form.autoPricingEnabled) return;
    const targetMargin = Math.min(99.99, Math.max(0, Number(form.marginPercentage) || 0));
    const nextPrice = form.costPrice > 0 ? Math.round((form.costPrice / (1 - targetMargin / 100) + Number.EPSILON) * 100) / 100 : 0;
    setForm((prev) => prev.sellingPrice === nextPrice ? prev : { ...prev, sellingPrice: nextPrice });
  }, [form.autoPricingEnabled, form.costPrice, form.marginPercentage]);

  const set = <K extends keyof ProductFormData>(key: K, value: ProductFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const setBaseUnit = (unit: string) => {
    setForm((prev) => ({ ...prev, unit, sellingOptions: prev.sellingOptions.map((option) => ({ ...option, unitLabel: unit, label: option.isBulk ? option.label : unit, quantityUnit: option.isBulk ? unit : undefined })) }));
  };

  const addBulkOption = () => {
    setForm((prev) => ({ ...prev, bulkPurchaseEnabled: true, sellingOptions: [...prev.sellingOptions, createBulkOption(prev.storeId, prev.unit || 'piece')] }));
  };

  const updateBulkOption = (index: number, patch: Partial<ProductSellingOption>) => {
    setForm((prev) => ({
      ...prev,
      sellingOptions: prev.sellingOptions.map((option, optionIndex) => {
        if (optionIndex !== index) return option;
        const next = { ...option, ...patch };
        const unitsPerBulk = Math.max(2, Number(next.inventoryMultiplier ?? next.quantityValue) || 2);
        const discountType: BulkDiscountType = next.discountType === 'amount' ? 'amount' : 'percent';
        const discountValue = Math.max(0, Number(next.discountValue) || 0);
        return { ...next, isBulk: true, kind: 'custom', unitLabel: prev.unit || 'unit', quantityValue: unitsPerBulk, quantityUnit: prev.unit || 'unit', inventoryMultiplier: unitsPerBulk, discountType, discountValue, sellingPrice: calculateBulkPrice(prev.sellingPrice, unitsPerBulk, discountType, discountValue), sharesBaseStock: true, isDefault: false };
      }),
    }));
  };

  const removeBulkOption = (index: number) => setForm((prev) => ({ ...prev, sellingOptions: prev.sellingOptions.filter((_, optionIndex) => optionIndex !== index) }));

  const toggleBulkPurchase = (enabled: boolean) => {
    if (enabled && bulkOptions.length === 0) {
      addBulkOption();
      return;
    }
    set('bulkPurchaseEnabled', enabled);
  };

  const handleImageFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('error', 'Please select a valid image file.'); return; }
    if (file.size > 5 * 1024 * 1024) { toast('error', 'Image must be smaller than 5 MB.'); return; }
    set('imageUrl', URL.createObjectURL(file));
  };

  const clearImage = () => {
    if (form.imageUrl?.startsWith('blob:')) URL.revokeObjectURL(form.imageUrl);
    set('imageUrl', undefined);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const openQuickAdd = (type: 'category' | 'supplier') => {
    if (!form.storeId) {
      toast('error', 'Select a store first.');
      return;
    }
    setQuickAddName('');
    setQuickAddType(type);
  };

  const toggleSupplier = (supplierId: string) => {
    const nextSupplierIds = selectedSupplierIds.includes(supplierId)
      ? selectedSupplierIds.filter((id) => id !== supplierId)
      : [...selectedSupplierIds, supplierId];
    setForm((prev) => ({
      ...prev,
      supplierIds: nextSupplierIds,
      supplierId: nextSupplierIds[0] ?? '',
    }));
  };

  const handleQuickAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = quickAddName.trim();
    if (!name || !form.storeId || !quickAddType) return;

    setQuickAddLoading(true);
    try {
      if (quickAddType === 'category') {
        const category = await addCategory(form.storeId, name);
        if (!category) throw new Error('Enter a category name.');
        setStoreCategories(await fetchCategoriesForStore(form.storeId));
        set('categoryId', category.id);
        toast('success', `"${category.name}" category added.`);
      } else {
        const supplier = await addSupplier({
          storeIds: [form.storeId],
          name,
          contact: '',
          email: '',
          phone: '',
          facebookLink: '',
          address: '',
          leadTimeDays: 1,
        });
        if (!supplier) throw new Error('Failed to add supplier.');
        setStoreSuppliers(await fetchSuppliersForStore(form.storeId));
        setForm((prev) => {
          const nextSupplierIds = prev.supplierIds?.length
            ? prev.supplierIds.includes(supplier.id) ? prev.supplierIds : [...prev.supplierIds, supplier.id]
            : prev.supplierId ? [prev.supplierId, supplier.id] : [supplier.id];
          return {
            ...prev,
            supplierIds: nextSupplierIds,
            supplierId: nextSupplierIds[0],
          };
        });
        toast('success', `"${supplier.name}" supplier added.`);
      }

      setQuickAddType(null);
      setQuickAddName('');
    } catch (error: any) {
      toast('error', error?.message || `Failed to add ${quickAddType}.`);
    } finally {
      setQuickAddLoading(false);
    }
  };

  const handleRestoreDefaultCategories = async () => {
    if (!form.storeId) return;
    setCategoryLoading(true);
    try {
      const added = await seedDefaultCategories(form.storeId);
      setStoreCategories(await fetchCategoriesForStore(form.storeId));
      if (added.length > 0 && !form.categoryId) set('categoryId', added[0].id);
      toast(added.length > 0 ? 'success' : 'info', added.length > 0 ? 'Default categories restored.' : 'Default categories are already available.');
    } catch (error: any) { toast('error', error?.message || 'Failed to restore default categories.'); }
    finally { setCategoryLoading(false); }
  };

  const validate = () => {
    const nextErrors: Record<string, string> = {};
    if (!form.storeId) nextErrors.storeId = 'Store is required';
    if (!form.name.trim()) nextErrors.name = 'Product name is required';
    if (!form.sku.trim()) nextErrors.sku = 'SKU is required';
    if (!form.categoryId) nextErrors.categoryId = 'Category is required';
    if (storeCategories.length === 0 && form.storeId) nextErrors.categoryId = 'No categories are available for this store yet';
    if (form.costPrice < 0) nextErrors.costPrice = 'Purchase price cannot be negative';
    if (form.sellingPrice <= 0) nextErrors.sellingPrice = 'Selling price must be greater than zero';
    if (form.currentStock < 0) nextErrors.currentStock = 'Stock cannot be negative';
    if (form.autoPricingEnabled && ((form.marginPercentage ?? 0) < 0 || (form.marginPercentage ?? 0) >= 100)) nextErrors.marginPercentage = 'Margin must be between 0% and 99.99%';
    if (form.bulkPurchaseEnabled && bulkOptions.length === 0) nextErrors.bulkOptions = 'Add at least one bulk option or turn this setting off';
    bulkOptions.forEach((option, index) => {
      const prefix = `bulk-${index}`;
      if (!option.label.trim()) nextErrors[`${prefix}-label`] = 'Bulk name is required';
      if (!option.quantityValue || option.quantityValue < 2) nextErrors[`${prefix}-units`] = 'Use at least 2 base units';
      if ((option.discountValue ?? 0) < 0) nextErrors[`${prefix}-discount`] = 'Discount cannot be negative';
      if (option.discountType === 'percent' && (option.discountValue ?? 0) > 100) nextErrors[`${prefix}-discount`] = 'Percentage cannot exceed 100%';
      if (option.discountType === 'amount' && (option.discountValue ?? 0) > basePrice * (option.quantityValue ?? 1)) nextErrors[`${prefix}-discount`] = 'Fixed discount cannot exceed regular value';
    });
    return nextErrors;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) { setErrors(nextErrors); return; }
    setLoading(true);
    try {
      const preparedOptions = form.sellingOptions.map((option) => {
        const isBulk = Boolean(option.isBulk);
        const unitsPerBulk = isBulk ? Math.max(2, Number(option.quantityValue) || Number(option.inventoryMultiplier) || 2) : 1;
        const discountType: BulkDiscountType = option.discountType === 'amount' ? 'amount' : 'percent';
        const discountValue = isBulk ? Math.max(0, Number(option.discountValue) || 0) : 0;
        return {
          ...option,
          storeId: form.storeId,
          productId: initial?.id ?? option.productId,
          kind: isBulk ? 'custom' as const : form.unit === 'kg' ? 'kilo' as const : 'unit' as const,
          label: isBulk ? option.label.trim() : form.unit.trim(),
          unitLabel: form.unit.trim(),
          quantityValue: isBulk ? unitsPerBulk : undefined,
          quantityUnit: isBulk ? form.unit.trim() : undefined,
          stockQuantity: Math.floor(Math.max(0, form.currentStock) / unitsPerBulk),
          sellingPrice: isBulk ? calculateBulkPrice(basePrice, unitsPerBulk, discountType, discountValue) : basePrice,
          lowStockThreshold: isBulk ? Math.floor(Math.max(0, form.minStockLevel) / unitsPerBulk) : form.minStockLevel,
          inventoryMultiplier: unitsPerBulk,
          sharesBaseStock: true,
          isBulk,
          discountType,
          discountValue,
          isDefault: !isBulk,
          isActive: isBulk ? Boolean(form.bulkPurchaseEnabled) && option.isActive : true,
        } satisfies ProductSellingOption;
      });
      await onSubmit({ ...form, unit: form.unit.trim(), sellingPrice: basePrice, currentStock: Math.round(form.currentStock), minStockLevel: Math.round(form.minStockLevel), sellingOptions: preparedOptions });
      toast('success', mode === 'create' ? 'Product created successfully!' : 'Product updated successfully!');
      navigate('/inventory');
    } catch (error: any) { toast('error', error?.message || 'Failed to save product. Please try again.'); }
    finally { setLoading(false); }
  };

  const regularValue = (option: ProductSellingOption) => basePrice * (option.quantityValue ?? 1);
  const margin = basePrice - form.costPrice;
  const marginPct = basePrice > 0 ? (margin / basePrice) * 100 : 0;

  return (
    <>
      <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          <div className={cardCls}>
            <h2 className={`${titleCls} mb-4`}>Product identity</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field id="product-store" label="Store" required><select id="product-store" className={inputCls} value={form.storeId} disabled={mode === 'edit'} onChange={(event) => set('storeId', event.target.value)}><option value="" disabled>Select a store</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select>{errors.storeId && <p className="text-xs text-red-500">{errors.storeId}</p>}</Field>
              <Field id="product-name" label="Product name" required><input id="product-name" className={inputCls} value={form.name} onChange={(event) => set('name', event.target.value)} placeholder="e.g. Coca-Cola 330ml" />{errors.name && <p className="text-xs text-red-500">{errors.name}</p>}</Field>
              <Field id="product-sku" label="SKU" required><input id="product-sku" className={`${inputCls} font-mono`} value={form.sku} onChange={(event) => set('sku', event.target.value)} placeholder="e.g. COKE-330" />{errors.sku && <p className="text-xs text-red-500">{errors.sku}</p>}</Field>
              <Field id="product-barcode" label="Barcode" hint="Optional. Scan or type the product barcode."><input id="product-barcode" className={`${inputCls} font-mono`} value={form.barcode} onChange={(event) => set('barcode', event.target.value)} placeholder="4800888888881" /></Field>
              <Field id="product-category" label="Category" required>
                <div className="flex gap-2">
                  <select id="product-category" className={`${inputCls} min-w-0 flex-1`} value={form.categoryId} disabled={!form.storeId} onChange={(event) => set('categoryId', event.target.value)}>
                    <option value="">Select category</option>
                    {storeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                  <button type="button" onClick={() => openQuickAdd('category')} disabled={!form.storeId || categoryLoading} className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] shadow-sm transition-colors hover:bg-[var(--muted)] hover:text-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50" aria-label="Add category" title="Add category">
                    <Plus className="size-4" aria-hidden="true" />
                  </button>
                </div>
                <button type="button" onClick={() => void handleRestoreDefaultCategories()} disabled={!form.storeId || categoryLoading} className="mt-1 text-xs font-medium text-blue-700 hover:text-blue-800 disabled:text-gray-400">Restore default categories</button>
                {errors.categoryId && <p className="text-xs text-red-500">{errors.categoryId}</p>}
              </Field>
              {role === 'admin' && (
                <Field label="Suppliers" hint="Optional. Select one or more suppliers; the first selected is used for restocking by default.">
                  <div className="flex items-start gap-2">
                    <div role="group" aria-label="Suppliers" className="min-h-10 min-w-0 flex-1 rounded-lg border border-[var(--input)] bg-[var(--background)] p-2 shadow-sm">
                      {storeSuppliers.length === 0 ? (
                        <p className="px-2 py-1 text-sm text-[var(--muted-foreground)]">No suppliers assigned to this store.</p>
                      ) : (
                        <div className="grid max-h-32 gap-1 overflow-y-auto sm:grid-cols-2">
                          {storeSuppliers.map((supplier) => (
                            <label key={supplier.id} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--foreground)] hover:bg-[var(--muted)]">
                              <input
                                type="checkbox"
                                checked={selectedSupplierIds.includes(supplier.id)}
                                onChange={() => toggleSupplier(supplier.id)}
                                disabled={!form.storeId}
                                className="h-4 w-4 shrink-0 accent-blue-600"
                              />
                              <span className="truncate">{supplier.name}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={() => openQuickAdd('supplier')} disabled={!form.storeId || quickAddLoading} className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] shadow-sm transition-colors hover:bg-[var(--muted)] hover:text-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50" aria-label="Add supplier" title="Add supplier">
                      <Plus className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                </Field>
              )}
            </div>
          </div>

          <div className={cardCls}>
            <div className="mb-4 flex items-start justify-between gap-4"><div><h2 className={titleCls}>Base unit pricing</h2><p className="mt-1 text-xs text-[var(--muted-foreground)]">One product, one stock quantity. All POS purchase modes deduct from this base-unit count.</p></div><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">1 {baseUnit} = 1 inventory unit</span></div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field id="product-unit" label="Base unit" required hint="The unit stored in inventory and shown for regular sales."><select id="product-unit" className={inputCls} value={form.unit} onChange={(event) => setBaseUnit(event.target.value)}>{unitChoices.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></Field>
              <Field id="product-cost" label={`Purchase price per ${baseUnit}`} required><input id="product-cost" type="number" min={0} step="0.01" className={`${inputCls} font-mono`} value={form.costPrice || ''} onChange={(event) => set('costPrice', Number(event.target.value) || 0)} />{errors.costPrice && <p className="text-xs text-red-500">{errors.costPrice}</p>}</Field>
              <Field id="product-price" label={`Regular selling price per ${baseUnit}`} required><input id="product-price" type="number" min={0} step="0.01" className={`${inputCls} font-mono disabled:bg-gray-100`} value={form.sellingPrice || ''} disabled={form.autoPricingEnabled} onChange={(event) => { const sellingPrice = Number(event.target.value) || 0; setForm((prev) => ({ ...prev, sellingPrice })); }} />{errors.sellingPrice && <p className="text-xs text-red-500">{errors.sellingPrice}</p>}</Field>
              <div className="rounded-lg bg-[var(--muted)] px-3 py-2 text-xs text-[var(--muted-foreground)] md:mt-6">Profit per {baseUnit}: <span className="font-mono font-semibold">PHP {margin.toFixed(2)}</span>{' '}<span className={marginPct < 0 ? 'text-red-600' : 'text-green-700'}>({marginPct.toFixed(1)}%)</span></div>
            </div>
            <label className="mt-4 flex cursor-pointer items-start gap-2.5 select-none"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-blue-600" checked={Boolean(form.autoPricingEnabled)} onChange={(event) => set('autoPricingEnabled', event.target.checked)} /><span className="text-xs font-medium text-[var(--foreground)]">Automatic margin-based pricing <span className="block font-normal text-[var(--muted-foreground)]">Update the regular unit price from cost and target gross margin.</span></span></label>
            {form.autoPricingEnabled && <div className="mt-3 max-w-xs"><Field id="product-margin" label="Target gross margin (%)" hint="Profit divided by selling price."><input id="product-margin" type="number" min={0} max={99.99} step="0.01" className={`${inputCls} font-mono`} value={form.marginPercentage || ''} onChange={(event) => set('marginPercentage', Number(event.target.value) || 0)} />{errors.marginPercentage && <p className="text-xs text-red-500">{errors.marginPercentage}</p>}</Field></div>}
          </div>

          <div className={cardCls}>
            <div className="flex items-start justify-between gap-4"><div><h2 className={titleCls}>Bulk Purchasing</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--muted-foreground)]">Configure case, pack, box, tray, or bundle prices. These are purchase modes attached to this product—not separate inventory products.</p></div><label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-sm font-semibold text-[var(--foreground)]"><input type="checkbox" className="h-4 w-4 accent-blue-600" checked={Boolean(form.bulkPurchaseEnabled)} onChange={(event) => toggleBulkPurchase(event.target.checked)} />Enable Bulk Purchase</label></div>
            {form.bulkPurchaseEnabled && <div className="mt-4 space-y-3">{errors.bulkOptions && <p className="text-xs text-red-600">{errors.bulkOptions}</p>}{bulkOptions.map((option) => { const index = form.sellingOptions.findIndex((candidate) => candidate.id === option.id); const unitsPerBulk = option.quantityValue ?? option.inventoryMultiplier; const regular = regularValue(option); const selling = calculateBulkPrice(basePrice, unitsPerBulk, option.discountType, option.discountValue); const savings = Math.max(0, regular - selling); const bulkIndex = bulkOptions.findIndex((candidate) => candidate.id === option.id); const prefix = `bulk-${bulkIndex}`; return <div key={option.id} className="rounded-xl border border-blue-100 bg-blue-50/40 p-4"><div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-[var(--foreground)]">Bulk option #{bulkIndex + 1}</p><p className="mt-0.5 text-xs text-blue-700">1 {option.label || 'bulk'} = {unitsPerBulk} {baseUnit}s</p></div><button type="button" onClick={() => removeBulkOption(index)} className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-red-100 bg-white text-red-500 hover:bg-red-50" aria-label={`Remove ${option.label || 'bulk'} option`}><Trash2 className="h-4 w-4" /></button></div><div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4"><Field id={`${prefix}-label`} label="Bulk name"><input id={`${prefix}-label`} className={inputCls} value={option.label} onChange={(event) => updateBulkOption(index, { label: event.target.value })} placeholder="Case" />{errors[`${prefix}-label`] && <p className="text-xs text-red-600">{errors[`${prefix}-label`]}</p>}</Field><Field id={`${prefix}-units`} label="Units per bulk" hint={`Base ${baseUnit}s deducted.`}><input id={`${prefix}-units`} type="number" min={2} step={1} className={`${inputCls} font-mono`} value={unitsPerBulk} onChange={(event) => updateBulkOption(index, { quantityValue: Number(event.target.value) || 2, inventoryMultiplier: Number(event.target.value) || 2 })} />{errors[`${prefix}-units`] && <p className="text-xs text-red-600">{errors[`${prefix}-units`]}</p>}</Field><Field id={`${prefix}-discount-type`} label="Discount type"><select id={`${prefix}-discount-type`} className={inputCls} value={option.discountType ?? 'percent'} onChange={(event) => updateBulkOption(index, { discountType: event.target.value as BulkDiscountType })}><option value="percent">Percentage Discount</option><option value="amount">Fixed Amount Discount</option></select></Field><Field id={`${prefix}-discount`} label={option.discountType === 'amount' ? 'Discount (PHP)' : 'Discount (%)'}><input id={`${prefix}-discount`} type="number" min={0} max={option.discountType === 'percent' ? 100 : undefined} step="0.01" className={`${inputCls} font-mono`} value={option.discountValue || ''} onChange={(event) => updateBulkOption(index, { discountValue: Number(event.target.value) || 0 })} />{errors[`${prefix}-discount`] && <p className="text-xs text-red-600">{errors[`${prefix}-discount`]}</p>}</Field></div><div className="mt-3 grid grid-cols-1 gap-2 rounded-lg border border-blue-100 bg-white p-3 text-sm sm:grid-cols-3"><div><p className="text-xs text-gray-500">Regular value</p><p className="font-mono font-semibold text-gray-900">PHP {regular.toFixed(2)}</p></div><div><p className="text-xs text-gray-500">Bulk selling price</p><p className="font-mono text-base font-bold text-blue-700">PHP {selling.toFixed(2)}</p></div><div><p className="text-xs text-gray-500">Savings</p><p className="font-mono font-semibold text-green-700">PHP {savings.toFixed(2)}</p></div></div></div>; })}<button type="button" onClick={addBulkOption} className="inline-flex items-center gap-2 rounded-lg border border-dashed border-blue-300 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"><Plus className="h-4 w-4" />Add Another Bulk Option</button></div>}
          </div>

          <div className={cardCls}>
            <h2 className={`${titleCls} mb-4`}>Inventory & supplier purchasing</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><Field id="product-stock" label={`Starting stock (${baseUnit}s)`} hint={mode === 'edit' ? 'Use Adjust Stock from Product Management to change stock.' : 'Stored only in base units.'}><input id="product-stock" type="number" min={0} step={1} disabled={mode === 'edit'} className={`${inputCls} font-mono`} value={form.currentStock || ''} onChange={(event) => set('currentStock', Number(event.target.value) || 0)} /></Field><Field id="product-low-stock" label={`Low stock alert (${baseUnit}s)`}><input id="product-low-stock" type="number" min={0} step={1} className={`${inputCls} font-mono`} value={form.minStockLevel || ''} onChange={(event) => set('minStockLevel', Number(event.target.value) || 0)} placeholder="e.g. 24" /></Field><Field id="product-safety-stock" label={`Safety stock (${baseUnit}s)`}><input id="product-safety-stock" type="number" min={0} step={1} className={`${inputCls} font-mono`} value={form.safetyStock || ''} onChange={(event) => set('safetyStock', Number(event.target.value) || 0)} /></Field><Field id="product-reorder-level" label={`Reorder level (${baseUnit}s)`}><input id="product-reorder-level" type="number" min={0} step={1} className={`${inputCls} font-mono`} value={form.reorderLevel || ''} onChange={(event) => set('reorderLevel', Number(event.target.value) || 0)} /></Field><Field id="product-lead-time" label="Lead time (days)"><input id="product-lead-time" type="number" min={1} step={1} className={`${inputCls} font-mono`} value={form.leadTimeDays} onChange={(event) => set('leadTimeDays', Number(event.target.value) || 1)} /></Field></div>
            <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3"><label className="flex cursor-pointer items-start gap-2.5 select-none"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-blue-600" checked={Boolean(form.purchaseUnit)} onChange={(event) => setForm((prev) => event.target.checked ? { ...prev, purchaseUnit: 'case', conversionFactor: 24, bulkPurchasePrice: prev.bulkPurchasePrice ?? prev.costPrice * 24 } : { ...prev, purchaseUnit: '', conversionFactor: 1, bulkPurchasePrice: undefined })} /><span className="text-xs font-medium text-gray-700">Supplier purchase unit <span className="block font-normal text-gray-500">Optional restocking convenience. Receiving a case still adds base units to the same inventory.</span></span></label>{!!form.purchaseUnit && <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3"><Field id="purchase-unit" label="Purchase unit"><select id="purchase-unit" className={inputCls} value={form.purchaseUnit} onChange={(event) => set('purchaseUnit', event.target.value)}>{supplierPurchaseUnits.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></Field><Field id="purchase-conversion" label={`Base units per ${form.purchaseUnit}`}><input id="purchase-conversion" type="number" min={1} step={1} className={`${inputCls} font-mono`} value={form.conversionFactor} onChange={(event) => set('conversionFactor', Number(event.target.value) || 1)} /></Field><Field id="purchase-bulk-price" label={`Price per ${form.purchaseUnit}`}><input id="purchase-bulk-price" type="number" min={0} step="0.01" className={`${inputCls} font-mono`} value={form.bulkPurchasePrice ?? ''} onChange={(event) => { const bulkPrice = Number(event.target.value) || 0; setForm((prev) => ({ ...prev, bulkPurchasePrice: bulkPrice, costPrice: bulkPrice / Math.max(1, prev.conversionFactor ?? 1) })); }} /></Field></div>}</div>
          </div>
        </div>

        <div className="min-w-0 space-y-4"><div className={cardCls}><h2 className={`${titleCls} mb-3`}>Product image</h2><div className="flex items-center gap-3"><div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-gray-200 bg-gray-50">{form.imageUrl ? <><img src={form.imageUrl} alt="Product preview" className="h-full w-full object-cover" /><button type="button" onClick={clearImage} className="absolute right-1 top-1 rounded-full border border-gray-200 bg-white p-0.5 text-gray-500 hover:text-red-500" aria-label="Remove product image"><X className="h-3.5 w-3.5" /></button></> : <ImagePlus className="h-7 w-7 text-gray-300" />}</div><div className="min-w-0 flex-1 space-y-2"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"><ImagePlus className="h-3.5 w-3.5" />Upload</button><button type="button" onClick={() => setUrlInputMode((value) => !value)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"><Link className="h-3.5 w-3.5" />URL</button></div>{urlInputMode && <input type="url" className={`${inputCls} font-mono text-xs`} value={form.imageUrl?.startsWith('blob:') ? '' : form.imageUrl ?? ''} onChange={(event) => set('imageUrl', event.target.value || undefined)} placeholder="https://example.com/image.jpg" />}<p className="text-[11px] leading-snug text-gray-400">JPG, PNG, GIF, or WebP. Max 5 MB.</p><input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} /></div></div></div><div className="rounded-xl border border-blue-100 bg-blue-50 p-4"><div className="flex items-start gap-2"><Package className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" /><div><p className="text-sm font-semibold text-blue-900">Inventory rule</p><p className="mt-1 text-xs leading-5 text-blue-800">POS availability for a bulk mode is derived as floor(base stock ÷ units per bulk). A case, pack, or bundle never gets its own stock balance.</p></div></div></div><div className="flex items-center justify-end gap-3"><Button variant="secondary" type="button" onClick={() => navigate('/inventory')}>Cancel</Button><Button variant="primary" type="submit" loading={loading}>{mode === 'create' ? 'Save Product' : 'Update Product'}</Button></div></div>
      </div>
      </form>

      <Dialog
        open={quickAddType !== null}
        onOpenChange={(open) => {
          if (!open && !quickAddLoading) {
            setQuickAddType(null);
            setQuickAddName('');
          }
        }}
      >
        <DialogContent
          onInteractOutside={(event) => { if (quickAddLoading) event.preventDefault(); }}
          onEscapeKeyDown={(event) => { if (quickAddLoading) event.preventDefault(); }}
        >
          <form onSubmit={handleQuickAdd}>
            <DialogHeader className="pr-8">
              <DialogTitle>Add {quickAddType === 'supplier' ? 'supplier' : 'category'}</DialogTitle>
              <DialogDescription>
                Add it to the selected store and use it for this product.
              </DialogDescription>
            </DialogHeader>
            <div className="py-2">
              <label htmlFor="quick-add-name" className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">
                {quickAddType === 'supplier' ? 'Supplier name' : 'Category name'}
                <span className="ml-0.5 text-red-500">*</span>
              </label>
              <input
                id="quick-add-name"
                className={inputCls}
                value={quickAddName}
                onChange={(event) => setQuickAddName(event.target.value)}
                placeholder={quickAddType === 'supplier' ? 'e.g. San Miguel Corporation' : 'e.g. Beverages'}
                autoFocus
                disabled={quickAddLoading}
              />
            </div>
            <DialogFooter>
              <Button
                variant="secondary"
                type="button"
                onClick={() => {
                  setQuickAddType(null);
                  setQuickAddName('');
                }}
                disabled={quickAddLoading}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                loading={quickAddLoading}
                disabled={!quickAddName.trim()}
              >
                Add {quickAddType === 'supplier' ? 'Supplier' : 'Category'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
