import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ImagePlus, Link, Package, Plus, Star, Trash2, X } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { useToast } from '@/components/shared/Toast';
import { useAuthStore } from '@/stores/authStore';
import { fetchCategoriesForStore, useProductStore } from '@/stores/productStore';
import { fetchSuppliersForStore } from '@/stores/supplierStore';
import type { Category, Product, ProductSellingOption, SellingOptionKind, Supplier } from '@/types';

type ProductFormData = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'categoryName' | 'supplierName'>;

interface ProductFormProps {
  initial?: Partial<Product>;
  onSubmit: (data: ProductFormData) => Promise<void>;
  mode: 'create' | 'edit';
}

function Field({
  label,
  required,
  children,
  hint,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] leading-snug text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}

const inputCls = 'w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';
const selectCls = inputCls;
const cardCls = 'bg-white rounded-xl border border-gray-200 shadow-sm p-4';
const titleCls = 'text-sm font-semibold text-gray-900';

const createSellingOption = (
  storeId: string,
  kind: SellingOptionKind = 'unit',
  seed?: Partial<ProductSellingOption>,
): ProductSellingOption => {
  const isKilo = kind === 'kilo';
  const isSack = kind === 'sack';
  return {
    id: seed?.id ?? crypto.randomUUID(),
    productId: seed?.productId ?? '',
    storeId,
    kind,
    label: seed?.label ?? (isKilo ? 'Per kilo' : isSack ? 'Sack' : 'Unit'),
    unitLabel: seed?.unitLabel ?? (isKilo ? 'kg' : isSack ? 'sack' : 'piece'),
    quantityValue: seed?.quantityValue ?? (isKilo ? 1 : undefined),
    quantityUnit: seed?.quantityUnit ?? (isKilo || isSack ? 'kg' : undefined),
    stockQuantity: seed?.stockQuantity ?? 0,
    sellingPrice: seed?.sellingPrice ?? 0,
    lowStockThreshold: seed?.lowStockThreshold ?? 0,
    isDefault: seed?.isDefault ?? false,
    isActive: seed?.isActive ?? true,
    createdAt: seed?.createdAt,
    updatedAt: seed?.updatedAt,
  };
};

export function ProductForm({ initial, onSubmit, mode }: ProductFormProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const fetchCategories = useProductStore((s) => s.fetchCategories);
  const addCategory = useProductStore((s) => s.addCategory);
  const seedDefaultCategories = useProductStore((s) => s.seedDefaultCategories);
  const { stores, activeStoreId } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [storeCategories, setStoreCategories] = useState<Category[]>([]);
  const [storeSuppliers, setStoreSuppliers] = useState<Supplier[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [newCategoryName, setNewCategoryName] = useState('');
  const [urlInputMode, setUrlInputMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialStoreId = initial?.storeId ?? (activeStoreId === 'all' ? '' : activeStoreId) ?? '';

  const [form, setForm] = useState<ProductFormData>({
    storeId: initialStoreId,
    name: initial?.name ?? '',
    sku: initial?.sku ?? '',
    barcode: initial?.barcode ?? '',
    categoryId: initial?.categoryId ?? '',
    unit: initial?.unit ?? 'piece',
    purchaseUnit: initial?.purchaseUnit ?? '',
    conversionFactor: initial?.conversionFactor ?? 1,
    costPrice: initial?.costPrice ?? 0,
    sellingPrice: initial?.sellingPrice ?? 0,
    currentStock: initial?.currentStock ?? 0,
    minStockLevel: initial?.minStockLevel ?? 0,
    safetyStock: initial?.safetyStock ?? 0,
    reorderLevel: initial?.reorderLevel ?? 0,
    leadTimeDays: initial?.leadTimeDays ?? 1,
    supplierId: initial?.supplierId ?? '',
    imageUrl: initial?.imageUrl,
    sellingOptions: initial?.sellingOptions?.length
      ? initial.sellingOptions
      : [createSellingOption(initialStoreId, initial?.unit === 'kg' ? 'kilo' : 'unit', {
          label: initial?.unit ?? 'piece',
          unitLabel: initial?.unit ?? 'piece',
          stockQuantity: initial?.currentStock ?? 0,
          sellingPrice: initial?.sellingPrice ?? 0,
          lowStockThreshold: initial?.minStockLevel ?? 0,
          isDefault: true,
        })],
  });

  const set = (key: keyof ProductFormData, value: string | number) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((e) => {
      const next = { ...e };
      delete next[key];
      return next;
    });
  };

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
      fetchSuppliersForStore(targetStoreId),
    ]).then(([categories, suppliers]) => {
      if (cancelled) return;
      setStoreCategories(categories);
      setStoreSuppliers(suppliers);
      setForm((prev) => ({
        ...prev,
        categoryId: categories.some((category) => category.id === prev.categoryId) ? prev.categoryId : '',
        supplierId: suppliers.some((supplier) => supplier.id === prev.supplierId) ? prev.supplierId : '',
      }));
    }).catch((err) => {
      if (cancelled) return;
      console.warn('Failed to load store-scoped product form options', err);
      setStoreCategories([]);
      setStoreSuppliers([]);
    }).finally(() => {
      if (!cancelled) setCategoryLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [form.storeId, activeStoreId]);

  useEffect(() => {
    const targetStoreId = form.storeId || (activeStoreId === 'all' ? 'all' : activeStoreId);
    if (!targetStoreId) return;
    void fetchCategories(targetStoreId);
  }, [form.storeId, activeStoreId, fetchCategories]);

  const activeSellingOptions = form.sellingOptions.filter((option) => option.isActive);
  const defaultSellingOption = activeSellingOptions.find((option) => option.isDefault) ?? activeSellingOptions[0] ?? form.sellingOptions[0];
  const defaultSellingIndex = form.sellingOptions.findIndex((option) => option.id === defaultSellingOption?.id);
  const defaultSellingUnit = defaultSellingOption?.unitLabel || form.unit || 'unit';
  const defaultSellingPrice = defaultSellingOption?.sellingPrice ?? 0;
  const costPerDefaultUnit = form.costPrice / (form.conversionFactor ?? 1);
  const margin = defaultSellingPrice > 0 ? defaultSellingPrice - costPerDefaultUnit : 0;
  const marginPct = defaultSellingPrice > 0 ? (margin / defaultSellingPrice) * 100 : 0;

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('error', 'Please select a valid image file (JPG, PNG, GIF, WebP)');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast('error', 'Image must be smaller than 5 MB');
      return;
    }
    setForm((prev) => ({ ...prev, imageUrl: URL.createObjectURL(file) }));
  };

  const clearImage = () => {
    if (form.imageUrl?.startsWith('blob:')) URL.revokeObjectURL(form.imageUrl);
    setForm((prev) => ({ ...prev, imageUrl: undefined }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const updateSellingOption = (index: number, patch: Partial<ProductSellingOption>) => {
    setForm((prev) => {
      const options = prev.sellingOptions.map((option, i) => i === index ? { ...option, ...patch } : option);
      const activeDefault = options.find((option) => option.isActive && option.isDefault);
      const firstActive = options.find((option) => option.isActive);
      const defaultId = activeDefault?.id ?? firstActive?.id;
      return {
        ...prev,
        sellingOptions: options.map((option) => ({
          ...option,
          storeId: prev.storeId,
          isDefault: defaultId ? option.id === defaultId : option.isDefault,
        })),
      };
    });
  };

  const addSellingOption = (kind: SellingOptionKind = 'sack') => {
    setForm((prev) => ({
      ...prev,
      sellingOptions: [
        ...prev.sellingOptions,
        createSellingOption(prev.storeId, kind, { isDefault: prev.sellingOptions.every((option) => !option.isActive) }),
      ],
    }));
  };

  const removeSellingOption = (index: number) => {
    setForm((prev) => {
      const options = prev.sellingOptions.filter((_, i) => i !== index);
      const activeOptions = options.filter((option) => option.isActive);
      const defaultId = activeOptions.find((option) => option.isDefault)?.id ?? activeOptions[0]?.id;
      return {
        ...prev,
        sellingOptions: options.map((option) => ({ ...option, isDefault: defaultId ? option.id === defaultId : option.isDefault })),
      };
    });
  };

  const makeDefaultOption = (index: number) => {
    setForm((prev) => ({
      ...prev,
      sellingOptions: prev.sellingOptions.map((option, i) => ({
        ...option,
        isActive: i === index ? true : option.isActive,
        isDefault: i === index,
      })),
    }));
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.storeId) errs.storeId = 'Store is required';
    if (!form.name.trim()) errs.name = 'Product name is required';
    if (!form.sku.trim()) errs.sku = 'SKU is required';
    if (!form.categoryId) errs.categoryId = 'Category is required';
    if (form.storeId && storeCategories.length === 0) errs.categoryId = 'No categories available for this store yet';
    if (form.costPrice < 0) errs.costPrice = 'Cost price cannot be negative';
    if (activeSellingOptions.length === 0) errs.sellingOptions = 'At least one active selling option is required';
    form.sellingOptions.forEach((option, index) => {
      if (!option.isActive) return;
      const prefix = `sellingOption-${index}`;
      if (!option.label.trim()) errs[`${prefix}-label`] = 'Label is required';
      if (!option.unitLabel.trim()) errs[`${prefix}-unit`] = 'Unit is required';
      if (option.sellingPrice <= 0) errs[`${prefix}-price`] = 'Price must be > 0';
      if (option.stockQuantity < 0) errs[`${prefix}-stock`] = 'Stock cannot be negative';
      if (option.lowStockThreshold < 0) errs[`${prefix}-threshold`] = 'Low stock threshold cannot be negative';
      if (option.kind === 'sack' && (!option.quantityValue || option.quantityValue <= 0)) {
        errs[`${prefix}-quantity`] = 'Sack size is required';
      }
    });
    return errs;
  };

  const clearCategoryError = () => {
    setErrors((current) => {
      if (!current.categoryId) return current;
      const next = { ...current };
      delete next.categoryId;
      return next;
    });
  };

  const handleAddCategory = async () => {
    const name = newCategoryName.trim();
    if (!form.storeId) {
      toast('error', 'Select a store first.');
      return;
    }
    if (!name) return;

    setCategoryLoading(true);
    try {
      const category = await addCategory(form.storeId, name);
      if (category) {
        const refreshedCategories = await fetchCategoriesForStore(form.storeId);
        setStoreCategories(refreshedCategories);
        setForm((prev) => ({ ...prev, categoryId: category.id }));
        setNewCategoryName('');
        clearCategoryError();
        toast('success', `"${category.name}" category added.`);
      }
    } catch (err: any) {
      toast('error', err?.message || 'Failed to add category.');
    } finally {
      setCategoryLoading(false);
    }
  };

  const handleRestoreDefaultCategories = async () => {
    if (!form.storeId) {
      toast('error', 'Select a store first.');
      return;
    }

    setCategoryLoading(true);
    try {
      const added = await seedDefaultCategories(form.storeId);
      const refreshedCategories = await fetchCategoriesForStore(form.storeId);
      setStoreCategories(refreshedCategories);
      if (added.length > 0 && !form.categoryId) {
        setForm((prev) => ({ ...prev, categoryId: added[0].id }));
        clearCategoryError();
      }
      toast(added.length > 0 ? 'success' : 'info', added.length > 0 ? 'Default categories restored.' : 'Default categories are already available.');
    } catch (err: any) {
      toast('error', err?.message || 'Failed to restore default categories.');
    } finally {
      setCategoryLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setLoading(true);
    try {
      const activeDefault = activeSellingOptions.find((option) => option.isDefault) ?? activeSellingOptions[0];
      const preparedOptions = form.sellingOptions.map((option) => ({
        ...option,
        storeId: form.storeId,
        label: option.label.trim(),
        unitLabel: option.unitLabel.trim(),
        quantityUnit: option.quantityUnit?.trim() || undefined,
        isDefault: activeDefault ? option.id === activeDefault.id : option.isDefault,
      }));
      const compatibility = activeDefault ?? preparedOptions[0];
      await onSubmit({
        ...form,
        unit: compatibility?.unitLabel || form.unit,
        sellingPrice: compatibility?.sellingPrice ?? form.sellingPrice,
        currentStock: compatibility?.stockQuantity ?? form.currentStock,
        minStockLevel: compatibility?.lowStockThreshold ?? form.minStockLevel,
        sellingOptions: preparedOptions,
      });
      toast('success', mode === 'create' ? 'Product created successfully!' : 'Product updated successfully!');
      navigate('/inventory');
    } catch (err: any) {
      toast('error', err?.message || 'Failed to save product. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px] gap-4 items-start">
        <div className="space-y-4 min-w-0">
          <div className={cardCls}>
            <h3 className={`${titleCls} mb-3`}>Basic Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
              <Field label="Store" required>
                <select
                  className={selectCls}
                  value={form.storeId}
                  onChange={(e) => {
                    const storeId = e.target.value;
                    setForm((prev) => ({
                      ...prev,
                      storeId,
                      categoryId: '',
                      supplierId: '',
                      sellingOptions: prev.sellingOptions.map((option) => ({ ...option, storeId })),
                    }));
                    setNewCategoryName('');
                  }}
                  disabled={mode === 'edit'}
                >
                  <option value="" disabled>Select a store</option>
                  {stores.map(store => (
                    <option key={store.id} value={store.id}>{store.name}</option>
                  ))}
                </select>
                {errors.storeId && <p className="text-xs text-red-500 mt-1">{errors.storeId}</p>}
              </Field>
              <div className="2xl:col-span-2">
                <Field label="Product Name" required>
                  <input
                    className={inputCls}
                    value={form.name}
                    onChange={(e) => set('name', e.target.value)}
                    placeholder="e.g. Red Horse Beer 500ml"
                  />
                  {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
                </Field>
              </div>
              <Field label="SKU" required>
                <input
                  className={inputCls + ' font-mono'}
                  value={form.sku}
                  onChange={(e) => set('sku', e.target.value)}
                  placeholder="e.g. SMC-RH-001"
                />
                {errors.sku && <p className="text-xs text-red-500 mt-1">{errors.sku}</p>}
              </Field>
              <Field label="Barcode" hint="Scan or type barcode number">
                <input
                  className={inputCls + ' font-mono'}
                  value={form.barcode}
                  onChange={(e) => set('barcode', e.target.value)}
                  placeholder="e.g. 4800888888881"
                />
              </Field>
              <Field label="Category" required>
                <div className="space-y-2">
                  <select
                    className={selectCls}
                    value={form.categoryId}
                    onChange={(e) => set('categoryId', e.target.value)}
                    disabled={!form.storeId}
                  >
                    <option value="">Select category...</option>
                    {storeCategories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <input
                      className={inputCls}
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleAddCategory();
                        }
                      }}
                      placeholder="New category name"
                      disabled={!form.storeId || categoryLoading}
                    />
                    <button
                      type="button"
                      onClick={handleAddCategory}
                      disabled={!form.storeId || categoryLoading || !newCategoryName.trim()}
                      className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                      title="Add category"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className={storeCategories.length === 0 ? 'text-xs text-amber-600' : 'text-xs text-gray-400'}>
                      {storeCategories.length === 0 ? 'No categories for this store.' : `${storeCategories.length} categories available.`}
                    </p>
                    <button
                      type="button"
                      onClick={handleRestoreDefaultCategories}
                      disabled={!form.storeId || categoryLoading}
                      className="text-xs font-medium text-blue-700 hover:text-blue-800 disabled:text-gray-400"
                    >
                      Restore defaults
                    </button>
                  </div>
                </div>
                {errors.categoryId && <p className="text-xs text-red-500 mt-1">{errors.categoryId}</p>}
              </Field>
              <Field label="Supplier" hint="Optional. Leave blank if this product has no supplier yet.">
                <select
                  className={selectCls}
                  value={form.supplierId}
                  onChange={(e) => set('supplierId', e.target.value)}
                  disabled={!form.storeId}
                >
                  <option value="">No supplier assigned</option>
                  {storeSuppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          <div className={cardCls}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className={titleCls}>Selling Options</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => addSellingOption('kilo')}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border border-gray-200 rounded-lg bg-white hover:bg-gray-50 text-gray-700"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Kilo
                </button>
                <button
                  type="button"
                  onClick={() => addSellingOption('sack')}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border border-gray-200 rounded-lg bg-white hover:bg-gray-50 text-gray-700"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Sack
                </button>
              </div>
            </div>
            {errors.sellingOptions && <p className="text-xs text-red-500 mb-3">{errors.sellingOptions}</p>}
            <div className="space-y-2 xl:max-h-[calc(100vh-28rem)] xl:overflow-y-auto xl:pr-1">
              {form.sellingOptions.map((option, index) => {
                const prefix = `sellingOption-${index}`;
                return (
                  <div key={option.id} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 grid grid-cols-2 md:grid-cols-6 2xl:grid-cols-12 gap-2 min-w-0">
                        <div className="col-span-2 2xl:col-span-2">
                          <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
                          <select
                            className={selectCls}
                            value={option.kind}
                            onChange={(e) => {
                              const kind = e.target.value as SellingOptionKind;
                              updateSellingOption(index, {
                                kind,
                                unitLabel: kind === 'kilo' ? 'kg' : kind === 'sack' ? 'sack' : option.unitLabel,
                                quantityUnit: kind === 'kilo' || kind === 'sack' ? 'kg' : option.quantityUnit,
                                quantityValue: kind === 'kilo' ? 1 : option.quantityValue,
                                label: kind === 'kilo' ? 'Per kilo' : kind === 'sack' ? option.label || 'Sack' : option.label,
                              });
                            }}
                          >
                            <option value="unit">Unit</option>
                            <option value="kilo">Kilo</option>
                            <option value="sack">Sack</option>
                            <option value="custom">Custom</option>
                          </select>
                        </div>
                        <div className="col-span-2 2xl:col-span-3">
                          <label className="block text-xs font-medium text-gray-500 mb-1">Label</label>
                          <input
                            className={inputCls}
                            value={option.label}
                            onChange={(e) => updateSellingOption(index, { label: e.target.value })}
                            placeholder="e.g. 50 kg sack"
                          />
                          {errors[`${prefix}-label`] && <p className="text-xs text-red-500 mt-1">{errors[`${prefix}-label`]}</p>}
                        </div>
                        <div className="col-span-1">
                          <label className="block text-xs font-medium text-gray-500 mb-1">Unit</label>
                          <input
                            className={inputCls}
                            value={option.unitLabel}
                            onChange={(e) => updateSellingOption(index, { unitLabel: e.target.value })}
                            placeholder="kg"
                          />
                          {errors[`${prefix}-unit`] && <p className="text-xs text-red-500 mt-1">{errors[`${prefix}-unit`]}</p>}
                        </div>
                        <div className="col-span-1 2xl:col-span-2">
                          <label className="block text-xs font-medium text-gray-500 mb-1">Package</label>
                          <div className="flex gap-1">
                            <input
                              type="number"
                              className={inputCls + ' font-mono min-w-0'}
                              value={option.quantityValue ?? ''}
                              onChange={(e) => updateSellingOption(index, { quantityValue: e.target.value === '' ? undefined : parseFloat(e.target.value) || 0 })}
                              min={0}
                              step="0.001"
                              placeholder="-"
                            />
                            <input
                              className={inputCls + ' w-14 shrink-0'}
                              value={option.quantityUnit ?? ''}
                              onChange={(e) => updateSellingOption(index, { quantityUnit: e.target.value })}
                              placeholder="kg"
                            />
                          </div>
                          {errors[`${prefix}-quantity`] && <p className="text-xs text-red-500 mt-1">{errors[`${prefix}-quantity`]}</p>}
                        </div>
                        <div className="col-span-1">
                          <label className="block text-xs font-medium text-gray-500 mb-1">Stock</label>
                          <input
                            type="number"
                            className={inputCls + ' font-mono'}
                            value={option.stockQuantity}
                            onChange={(e) => updateSellingOption(index, { stockQuantity: parseFloat(e.target.value) || 0 })}
                            min={0}
                            step="0.001"
                          />
                          {errors[`${prefix}-stock`] && <p className="text-xs text-red-500 mt-1">{errors[`${prefix}-stock`]}</p>}
                        </div>
                        <div className="col-span-1">
                          <label className="block text-xs font-medium text-gray-500 mb-1">Price</label>
                          <input
                            type="number"
                            className={inputCls + ' font-mono'}
                            value={option.sellingPrice}
                            onChange={(e) => updateSellingOption(index, { sellingPrice: parseFloat(e.target.value) || 0 })}
                            min={0}
                            step="0.01"
                          />
                          {errors[`${prefix}-price`] && <p className="text-xs text-red-500 mt-1">{errors[`${prefix}-price`]}</p>}
                        </div>
                        <div className="col-span-2 md:col-span-2 2xl:col-span-2">
                          <label className="block text-xs font-medium text-gray-500 mb-1">Low Stock</label>
                          <input
                            type="number"
                            className={inputCls + ' font-mono'}
                            value={option.lowStockThreshold}
                            onChange={(e) => updateSellingOption(index, { lowStockThreshold: parseFloat(e.target.value) || 0 })}
                            min={0}
                            step="0.001"
                          />
                          {errors[`${prefix}-threshold`] && <p className="text-xs text-red-500 mt-1">{errors[`${prefix}-threshold`]}</p>}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 pt-5">
                        <button
                          type="button"
                          onClick={() => makeDefaultOption(index)}
                          className={`p-1.5 rounded-lg border transition-colors ${option.isDefault ? 'bg-amber-50 border-amber-200 text-amber-600' : 'border-gray-200 text-gray-400 hover:bg-gray-50'}`}
                          title="Set as default option"
                        >
                          <Star className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSellingOption(index)}
                          disabled={form.sellingOptions.length === 1}
                          className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-gray-400"
                          title="Remove option"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <label className="mt-2 inline-flex items-center gap-2 text-xs font-medium text-gray-600">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-gray-300 accent-blue-600"
                        checked={option.isActive}
                        onChange={(e) => updateSellingOption(index, { isActive: e.target.checked })}
                      />
                      Active
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-4 min-w-0">
          <div className={cardCls}>
            <h3 className={`${titleCls} mb-3`}>Product Image</h3>
            <div className="flex items-center gap-3">
              <div className="relative w-20 h-20 shrink-0 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden">
                {form.imageUrl ? (
                  <>
                    <img src={form.imageUrl} alt="Product" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={clearImage}
                      className="absolute top-1 right-1 bg-white rounded-full p-0.5 shadow border border-gray-200 text-gray-500 hover:text-red-500 transition-colors"
                      title="Remove image"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </>
                ) : (
                  <ImagePlus className="w-7 h-7 text-gray-300" />
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors text-gray-700"
                  >
                    <ImagePlus className="w-3.5 h-3.5" />
                    Upload
                  </button>
                  <button
                    type="button"
                    onClick={() => setUrlInputMode((v) => !v)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors text-gray-700"
                  >
                    <Link className="w-3.5 h-3.5" />
                    URL
                  </button>
                </div>
                {urlInputMode && (
                  <input
                    type="url"
                    className={inputCls + ' font-mono text-xs'}
                    placeholder="https://example.com/image.jpg"
                    value={form.imageUrl?.startsWith('blob:') ? '' : (form.imageUrl ?? '')}
                    onChange={(e) => setForm((prev) => ({ ...prev, imageUrl: e.target.value || undefined }))}
                  />
                )}
                <p className="text-[11px] leading-snug text-gray-400">JPG, PNG, GIF, WebP. Max 5 MB.</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageFile}
                />
              </div>
            </div>
          </div>

          <div className={cardCls}>
            <h3 className={`${titleCls} mb-3`}>Price & Cost</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label={form.purchaseUnit ? `Cost per ${form.purchaseUnit}` : 'Cost (PHP)'} required>
                <input
                  type="number"
                  className={inputCls + ' font-mono'}
                  value={form.costPrice}
                  onChange={(e) => set('costPrice', parseFloat(e.target.value) || 0)}
                  min={0}
                  step={0.01}
                />
                {errors.costPrice && <p className="text-xs text-red-500 mt-1">{errors.costPrice}</p>}
              </Field>
              <Field label="Default Price" required>
                <input
                  type="number"
                  className={inputCls + ' font-mono'}
                  value={defaultSellingPrice}
                  onChange={(e) => {
                    if (defaultSellingIndex >= 0) updateSellingOption(defaultSellingIndex, { sellingPrice: parseFloat(e.target.value) || 0 });
                  }}
                  min={0}
                  step={0.01}
                />
                {defaultSellingIndex >= 0 && errors[`sellingOption-${defaultSellingIndex}-price`] && (
                  <p className="text-xs text-red-500 mt-1">{errors[`sellingOption-${defaultSellingIndex}-price`]}</p>
                )}
              </Field>
            </div>
            {form.costPrice > 0 && defaultSellingPrice > 0 && (
              <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                {form.purchaseUnit && (form.conversionFactor ?? 1) > 1 && (
                  <span className="mr-2">Unit cost: <span className="font-mono font-medium">PHP {costPerDefaultUnit.toFixed(2)}</span></span>
                )}
                <span>Margin: <span className="font-mono font-medium">PHP {margin.toFixed(2)}</span>{' '}</span>
                <span className={marginPct < 0 ? 'text-red-500' : 'text-green-600'}>({marginPct.toFixed(1)}%)</span>
              </div>
            )}
            <label className="mt-3 flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                className="mt-0.5 w-4 h-4 rounded border-gray-300 accent-blue-600"
                checked={(form.conversionFactor ?? 1) > 1 || !!form.purchaseUnit}
                onChange={(e) => {
                  if (e.target.checked) {
                    setForm((prev) => ({ ...prev, purchaseUnit: 'pack', conversionFactor: 1 }));
                  } else {
                    setForm((prev) => ({ ...prev, purchaseUnit: '', conversionFactor: 1 }));
                  }
                }}
              />
              <span className="text-xs font-medium text-gray-700">
                Bought in bulk
                <span className="block text-[11px] font-normal text-gray-400">Pack, box, tray, bag, case, or similar units.</span>
              </span>
            </label>
            {!!form.purchaseUnit && (
              <div className="mt-3 pl-4 border-l-2 border-blue-100 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Purchase Unit" hint="Supplier order unit">
                    <select
                      className={selectCls}
                      value={form.purchaseUnit}
                      onChange={(e) => set('purchaseUnit', e.target.value)}
                    >
                      {['pack', 'box', 'bag', 'tray', 'case', 'bundle', 'roll', 'dozen'].map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label={`Units per ${form.purchaseUnit}`}
                    hint={`${defaultSellingUnit} in 1 ${form.purchaseUnit}`}
                  >
                    <input
                      type="number"
                      className={inputCls + ' font-mono'}
                      value={form.conversionFactor}
                      onChange={(e) => set('conversionFactor', parseInt(e.target.value) || 1)}
                      min={2}
                      step={1}
                    />
                  </Field>
                </div>
                {(form.conversionFactor ?? 1) >= 2 && (
                  <div className="flex items-start gap-2 bg-blue-50 rounded-lg px-3 py-2">
                    <Package className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-blue-700">
                      Receiving converts each {form.purchaseUnit} into {defaultSellingUnit} stock.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className={cardCls}>
            <h3 className={`${titleCls} mb-3`}>Stock & Reorder</h3>
            <div className="grid grid-cols-2 gap-3">
              {mode === 'create' && (
                <Field label="Default Stock">
                  <input
                    type="number"
                    className={inputCls + ' font-mono'}
                    value={defaultSellingOption?.stockQuantity ?? form.currentStock}
                    onChange={(e) => {
                      if (defaultSellingIndex >= 0) updateSellingOption(defaultSellingIndex, { stockQuantity: parseFloat(e.target.value) || 0 });
                      else set('currentStock', parseInt(e.target.value) || 0);
                    }}
                    min={0}
                  />
                </Field>
              )}
              <Field label="Default Low Stock" hint="Triggers alert">
                <input
                  type="number"
                  className={inputCls + ' font-mono'}
                  value={defaultSellingOption?.lowStockThreshold ?? form.minStockLevel}
                  onChange={(e) => {
                    if (defaultSellingIndex >= 0) updateSellingOption(defaultSellingIndex, { lowStockThreshold: parseFloat(e.target.value) || 0 });
                    else set('minStockLevel', parseInt(e.target.value) || 0);
                  }}
                  min={0}
                />
              </Field>
              <Field label="Safety Stock" hint="Buffer level">
                <input
                  type="number"
                  className={inputCls + ' font-mono'}
                  value={form.safetyStock}
                  onChange={(e) => set('safetyStock', parseInt(e.target.value) || 0)}
                  min={0}
                />
              </Field>
              <Field label="Reorder Level" hint="Restock trigger">
                <input
                  type="number"
                  className={inputCls + ' font-mono'}
                  value={form.reorderLevel}
                  onChange={(e) => set('reorderLevel', parseInt(e.target.value) || 0)}
                  min={0}
                />
              </Field>
              <Field label="Lead Time" hint="Delivery days">
                <input
                  type="number"
                  className={inputCls + ' font-mono'}
                  value={form.leadTimeDays}
                  onChange={(e) => set('leadTimeDays', parseInt(e.target.value) || 1)}
                  min={1}
                />
              </Field>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <Button variant="secondary" type="button" onClick={() => navigate('/inventory')}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={loading}>
              {mode === 'create' ? 'Save Product' : 'Update Product'}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
