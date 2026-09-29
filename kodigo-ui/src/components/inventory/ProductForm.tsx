import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ImagePlus, Link, Package, Plus, Trash2, X } from 'lucide-react';
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
import type { BulkDiscountType, Category, PricingMethod, Product, ProductRestockingOption, ProductSellingOption, Supplier } from '@/types';

type ProductFormData = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'categoryName' | 'supplierName'>;

interface ProductFormProps {
  initial?: Partial<Product>;
  onSubmit: (data: ProductFormData) => Promise<void>;
  mode: 'create' | 'edit';
}

const inputCls = 'h-10 w-full rounded-lg border border-[var(--input)] bg-[var(--background)] px-3 py-2 text-base text-[var(--foreground)] shadow-sm outline-none transition-[border-color,box-shadow] placeholder:text-[var(--muted-foreground)] focus-visible:border-[var(--ring)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]/20 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
const cardCls = 'rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)]';
const titleCls = 'text-sm font-semibold text-[var(--foreground)]';
const unitChoices = [
  { value: 'piece', label: 'Piece' },
  { value: 'kg', label: 'Kilogram (kg)' },
  { value: 'stick', label: 'Stick' },
  { value: 'sachet', label: 'Sachet' },
  { value: 'bottle', label: 'Bottle' },
  { value: 'can', label: 'Can' },
  { value: 'pack', label: 'Pack' },
  { value: 'box', label: 'Box' },
  { value: 'case', label: 'Case' },
  { value: 'tray', label: 'Tray' },
  { value: 'dozen', label: 'Dozen' },
  { value: 'carton', label: 'Carton' },
  { value: 'sack', label: 'Sack' },
  { value: 'bag', label: 'Bag' },
  { value: 'bundle', label: 'Bundle' },
  { value: 'roll', label: 'Roll' },
  { value: 'other', label: 'Other' },
];
const suggestedRestockingFactors: Record<string, number> = {
  dozen: 12,
  pack: 6,
  box: 12,
  case: 24,
  tray: 12,
  carton: 24,
};

function generateProductSku(name: string, products: Product[]): string {
  const prefix = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'PRODUCT';
  const usedSkus = new Set(products.map((product) => product.sku.trim().toUpperCase()));
  let candidate = '';
  let attempts = 0;

  do {
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
    candidate = `${prefix}-${suffix}`;
    attempts += 1;
  } while (usedSkus.has(candidate) && attempts < 10);

  return candidate;
}

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
    pricingMethod: seed?.pricingMethod ?? 'fixed',
    manualSellingPrice: seed?.manualSellingPrice ?? seed?.sellingPrice,
    isDefault: false,
    isActive: seed?.isActive !== false,
    createdAt: seed?.createdAt,
    updatedAt: seed?.updatedAt,
  };
}

function createRestockingOption(storeId: string, unit = 'case', factor = 24, seed?: Partial<ProductRestockingOption>): ProductRestockingOption {
  return {
    id: seed?.id ?? crypto.randomUUID(),
    productId: seed?.productId ?? '',
    storeId,
    label: seed?.label ?? unit,
    conversionFactor: seed?.conversionFactor ?? factor,
    isDefault: seed?.isDefault ?? false,
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
  const { activeStoreId, role } = useAuthStore();
  const products = useProductStore((state) => state.products);
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
  const [advancedPricing, setAdvancedPricing] = useState<Record<string, boolean>>({});
  const [skuManuallyEdited, setSkuManuallyEdited] = useState(mode === 'edit' || Boolean(initial?.sku));
  const [purchaseTotal, setPurchaseTotal] = useState(
    (initial?.costPrice ?? 0) * (initial?.restockingOptions?.find((option) => option.isDefault)?.conversionFactor
      ?? initial?.restockingOptions?.[0]?.conversionFactor
      ?? (initial?.purchaseUnit ? initial.conversionFactor ?? 1 : 1)),
  );
  const [purchaseQuantity, setPurchaseQuantity] = useState(1);
  const [purchaseRestockingOptionId, setPurchaseRestockingOptionId] = useState(
    initial?.restockingOptions?.find((option) => option.isDefault)?.id ?? initial?.restockingOptions?.[0]?.id ?? '',
  );
  const [restockingFactorDrafts, setRestockingFactorDrafts] = useState<Record<string, string>>({});
  const [sellingFactorDrafts, setSellingFactorDrafts] = useState<Record<string, string>>({});
  const [leadTimeDraft, setLeadTimeDraft] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialStoreId = initial?.storeId ?? (activeStoreId === 'all' ? '' : activeStoreId) ?? '';
  const initialSupplierIds = initial?.supplierIds?.length
    ? initial.supplierIds
    : initial?.supplierId
      ? [initial.supplierId]
      : [];

  const [form, setForm] = useState<ProductFormData>(() => ({
    storeId: initialStoreId,
    isActive: initial?.isActive !== false,
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
    priceRounding: initial?.priceRounding ?? 1,
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
    restockingOptions: initial?.restockingOptions?.length
      ? initial.restockingOptions
      : [createRestockingOption(
        initialStoreId,
        initial?.purchaseUnit ?? initial?.unit ?? 'piece',
        initial?.purchaseUnit ? initial.conversionFactor ?? 1 : 1,
        { isDefault: true },
      )],
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
  const purchaseRestockingOption = form.restockingOptions?.find((option) => option.id === purchaseRestockingOptionId)
    ?? form.restockingOptions?.find((option) => option.isDefault)
    ?? form.restockingOptions?.[0];
  const savedRestockingUnits = Array.from(new Map(
    products
      .filter((product) => product.storeId === form.storeId)
      .flatMap((product) => product.restockingOptions || [])
      .map((option) => [option.label.trim().toLowerCase(), option]),
  ).values());
  const savedSellingBundles = Array.from(new Map(
    products
      .filter((product) => product.storeId === form.storeId)
      .flatMap((product) => product.sellingOptions || [])
      .filter(isBulkSellingOption)
      .map((option) => [option.label.trim().toLowerCase(), option]),
  ).values());

  useEffect(() => {
    const totalBaseUnits = purchaseQuantity * (purchaseRestockingOption?.conversionFactor || 1);
    const calculatedCost = totalBaseUnits > 0
      ? Math.round((purchaseTotal / totalBaseUnits + Number.EPSILON) * 1_000_000) / 1_000_000
      : 0;
    setForm((prev) => prev.costPrice === calculatedCost ? prev : { ...prev, costPrice: calculatedCost });
  }, [purchaseQuantity, purchaseRestockingOption?.conversionFactor, purchaseTotal]);

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

  const updatePurchaseCost = (total: number, quantity: number) => {
    setPurchaseTotal(total);
    setPurchaseQuantity(quantity);
    setErrors((prev) => {
      if (!prev.purchaseQuantity) return prev;
      const next = { ...prev };
      delete next.purchaseQuantity;
      return next;
    });
  };

  const setBaseUnit = (unit: string) => {
    setForm((prev) => ({ ...prev, unit, sellingOptions: prev.sellingOptions.map((option) => ({ ...option, unitLabel: unit, label: option.isBulk ? option.label : unit, quantityUnit: option.isBulk ? unit : undefined })) }));
  };

  const handleProductNameChange = (name: string) => {
    setForm((prev) => ({
      ...prev,
      name,
      ...(mode === 'create' && !skuManuallyEdited
        ? { sku: name.trim() ? generateProductSku(name, products) : '' }
        : {}),
    }));
    setErrors((prev) => {
      if (!prev.name) return prev;
      const next = { ...prev };
      delete next.name;
      return next;
    });
  };

  const addRestockingOption = () => {
    setForm((prev) => ({
      ...prev,
      restockingOptions: [
        ...(prev.restockingOptions || []),
        createRestockingOption(prev.storeId, 'case', 24, { isDefault: (prev.restockingOptions || []).length === 0 }),
      ],
    }));
  };

  const updateRestockingOption = (index: number, patch: Partial<ProductRestockingOption>) => {
    setForm((prev) => ({
      ...prev,
      restockingOptions: (prev.restockingOptions || []).map((option, optionIndex) => optionIndex === index
        ? {
          ...option,
          ...patch,
          conversionFactor: Math.max(0, Number(
            patch.conversionFactor
              ?? (patch.label ? suggestedRestockingFactors[patch.label.trim().toLowerCase()] : undefined)
              ?? option.conversionFactor,
          ) || 0),
        }
        : patch.isDefault ? { ...option, isDefault: false } : option),
    }));
  };

  const removeRestockingOption = (index: number) => {
    setForm((prev) => {
      const next = (prev.restockingOptions || []).filter((_, optionIndex) => optionIndex !== index);
      if (next.length > 0 && !next.some((option) => option.isDefault)) next[0] = { ...next[0], isDefault: true };
      return { ...prev, restockingOptions: next };
    });
  };

  const addBulkOption = () => {
    const savedBundle = savedSellingBundles[0];
    setForm((prev) => ({
      ...prev,
      bulkPurchaseEnabled: true,
      sellingOptions: [...prev.sellingOptions, createBulkOption(prev.storeId, prev.unit || 'piece', savedBundle ? {
        label: savedBundle.label,
      } : undefined)],
    }));
  };

  const updateBulkOption = (index: number, patch: Partial<ProductSellingOption>) => {
    setForm((prev) => ({
      ...prev,
      sellingOptions: prev.sellingOptions.map((option, optionIndex) => {
        if (optionIndex !== index) return option;
        const next = { ...option, ...patch };
        const unitsPerBulk = Math.max(0, Number(next.quantityValue ?? next.inventoryMultiplier) || 0);
        const pricingMethod: PricingMethod = next.pricingMethod === 'fixed' || next.pricingMethod === 'amount' || next.pricingMethod === 'percent'
          ? next.pricingMethod
          : 'fixed';
        const discountType: BulkDiscountType = pricingMethod === 'amount' || pricingMethod === 'fixed' ? 'amount' : 'percent';
        const regularValue = prev.sellingPrice * unitsPerBulk;
        const previousSellingPrice = Math.max(0, Number(option.manualSellingPrice ?? option.sellingPrice) || 0);
        const methodChanged = patch.pricingMethod != null && patch.pricingMethod !== option.pricingMethod;
        const manualSellingPrice = pricingMethod === 'fixed'
          ? Math.max(0, Number(next.manualSellingPrice ?? next.sellingPrice) || 0)
          : undefined;
        const discountValue = pricingMethod === 'fixed'
          ? Math.max(0, regularValue - (manualSellingPrice ?? 0))
          : methodChanged
            ? pricingMethod === 'percent'
              ? (regularValue > 0 ? Math.max(0, (regularValue - previousSellingPrice) / regularValue * 100) : 0)
              : Math.max(0, regularValue - previousSellingPrice)
          : Math.max(0, Number(next.discountValue) || 0);
        const sellingPrice = pricingMethod === 'fixed'
          ? manualSellingPrice ?? 0
          : calculateBulkPrice(prev.sellingPrice, unitsPerBulk, discountType, discountValue);
        return { ...next, isBulk: true, kind: 'custom', unitLabel: prev.unit || 'unit', quantityValue: unitsPerBulk, quantityUnit: prev.unit || 'unit', inventoryMultiplier: unitsPerBulk, pricingMethod, manualSellingPrice, discountType, discountValue, sellingPrice, sharesBaseStock: true, isDefault: false };
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
    if (purchaseQuantity <= 0) nextErrors.purchaseQuantity = 'Quantity purchased must be greater than zero';
    if (form.sellingPrice <= 0) nextErrors.sellingPrice = 'Selling price must be greater than zero';
    if (form.currentStock < 0) nextErrors.currentStock = 'Stock cannot be negative';
    if (!form.restockingOptions || form.restockingOptions.length === 0) nextErrors.restockingOptions = 'Add at least one way you receive this product';
    const restockingLabels = new Set<string>();
    (form.restockingOptions || []).forEach((option, index) => {
      const prefix = `restock-${index}`;
      const label = option.label.trim().toLowerCase();
      if (!label) nextErrors[`${prefix}-label`] = 'Enter the supplier package name';
      if (label && restockingLabels.has(label)) nextErrors[`${prefix}-label`] = 'Use a different package name';
      if (label) restockingLabels.add(label);
      if (!option.conversionFactor || option.conversionFactor < 1) nextErrors[`${prefix}-factor`] = 'Use at least 1 base unit';
    });
    if (form.autoPricingEnabled && ((form.marginPercentage ?? 0) < 0 || (form.marginPercentage ?? 0) >= 100)) nextErrors.marginPercentage = 'Margin must be between 0% and 99.99%';
    if (form.bulkPurchaseEnabled && bulkOptions.length === 0) nextErrors.bulkOptions = 'Add at least one bulk option or turn this setting off';
    bulkOptions.forEach((option, index) => {
      const prefix = `bulk-${index}`;
      if (!option.label.trim()) nextErrors[`${prefix}-label`] = 'Bulk name is required';
      if (!option.quantityValue || option.quantityValue < 2) nextErrors[`${prefix}-units`] = 'Use at least 2 base units';
      if ((option.discountValue ?? 0) < 0) nextErrors[`${prefix}-discount`] = 'Discount cannot be negative';
      if (option.discountType === 'percent' && (option.discountValue ?? 0) > 100) nextErrors[`${prefix}-discount`] = 'Percentage cannot exceed 100%';
      if (option.discountType === 'amount' && (option.discountValue ?? 0) > basePrice * (option.quantityValue ?? 1)) nextErrors[`${prefix}-discount`] = 'Fixed discount cannot exceed regular value';
      if ((option.pricingMethod ?? 'fixed') === 'fixed' && (option.manualSellingPrice ?? option.sellingPrice) <= 0) nextErrors[`${prefix}-discount`] = 'Enter a bundle price greater than zero';
      if ((option.pricingMethod ?? 'fixed') === 'fixed' && (option.manualSellingPrice ?? option.sellingPrice) > basePrice * (option.quantityValue ?? 1)) nextErrors[`${prefix}-discount`] = 'Bundle price cannot exceed regular value';
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
        const pricingMethod: PricingMethod = option.pricingMethod === 'fixed' || option.pricingMethod === 'amount' || option.pricingMethod === 'percent'
          ? option.pricingMethod
          : isBulk ? 'fixed' : 'percent';
        const manualSellingPrice = pricingMethod === 'fixed'
          ? Math.max(0, Number(option.manualSellingPrice ?? option.sellingPrice) || 0)
          : undefined;
        const regularValue = basePrice * unitsPerBulk;
        const discountType: BulkDiscountType = pricingMethod === 'amount' || pricingMethod === 'fixed' ? 'amount' : 'percent';
        const discountValue = isBulk
          ? pricingMethod === 'fixed'
            ? Math.max(0, regularValue - (manualSellingPrice ?? 0))
            : Math.max(0, Number(option.discountValue) || 0)
          : 0;
        const sellingPrice = isBulk
          ? pricingMethod === 'fixed'
            ? manualSellingPrice ?? 0
            : calculateBulkPrice(basePrice, unitsPerBulk, discountType, discountValue)
          : basePrice;
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
          sellingPrice,
          lowStockThreshold: isBulk ? Math.floor(Math.max(0, form.minStockLevel) / unitsPerBulk) : form.minStockLevel,
          inventoryMultiplier: unitsPerBulk,
          sharesBaseStock: true,
          isBulk,
          discountType,
          discountValue,
          pricingMethod,
          manualSellingPrice,
          isDefault: !isBulk,
          isActive: isBulk ? Boolean(form.bulkPurchaseEnabled) && option.isActive : true,
        } satisfies ProductSellingOption;
      });
      const preparedRestockingOptions = (form.restockingOptions || []).map((option, index) => ({
        ...option,
        storeId: form.storeId,
        productId: initial?.id ?? option.productId,
        label: option.label.trim(),
        conversionFactor: Math.max(1, Number(option.conversionFactor) || 1),
        isDefault: option.isDefault || (index === 0 && !(form.restockingOptions || []).some((candidate) => candidate.isDefault)),
        isActive: true,
      }));
      const defaultRestock = preparedRestockingOptions.find((option) => option.isDefault) || preparedRestockingOptions[0];
      await onSubmit({ ...form, unit: form.unit.trim(), purchaseUnit: defaultRestock?.label || '', conversionFactor: defaultRestock?.conversionFactor || 1, sellingPrice: basePrice, currentStock: Math.round(form.currentStock), minStockLevel: Math.round(form.minStockLevel), restockingOptions: preparedRestockingOptions, sellingOptions: preparedOptions });
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
              <Field id="product-name" label="Product name" required><input id="product-name" className={inputCls} value={form.name} onChange={(event) => handleProductNameChange(event.target.value)} placeholder="e.g. Coca-Cola 330ml" />{errors.name && <p className="text-xs text-red-500">{errors.name}</p>}</Field>
              <Field id="product-sku" label="SKU" required hint={mode === 'create' ? 'Generated automatically from the product name. You can edit it if needed.' : 'SKU stays unchanged unless you edit it manually.'}><div className="flex gap-2"><input id="product-sku" className={`${inputCls} min-w-0 flex-1 font-mono`} value={form.sku} onChange={(event) => { setSkuManuallyEdited(true); set('sku', event.target.value.toUpperCase()); }} placeholder="e.g. COKE-330" />{mode === 'create' && <button type="button" onClick={() => { setSkuManuallyEdited(false); set('sku', generateProductSku(form.name, products)); }} disabled={!form.name.trim()} className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 text-xs font-semibold text-[var(--foreground)] shadow-sm transition-colors hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50">Regenerate</button>}</div>{errors.sku && <p className="text-xs text-red-500">{errors.sku}</p>}</Field>
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
            <div className="mb-4 flex items-start justify-between gap-4"><div><h2 className={titleCls}>Purchase setup &amp; pricing</h2><p className="mt-1 text-xs text-[var(--muted-foreground)]">Set the base unit, supplier packaging, and prices. Inventory is always tracked in base units.</p></div><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">1 {baseUnit} = 1 inventory unit</span></div>
                          <Field id="product-unit" label="Base unit" required hint="The unit stored in inventory and shown for regular sales."><select id="product-unit" className={inputCls} value={form.unit} onChange={(event) => setBaseUnit(event.target.value)}>{unitChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select></Field>
                        <div className="mt-5 border-t border-[var(--border)] pt-5">
            <div className="flex items-start justify-between gap-4">
              <div><h2 className={titleCls}>Restocking units</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--muted-foreground)]">Save the supplier packages you commonly receive. Every package adds to the same {baseUnit} stock.</p></div>
              <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Supplier packaging</span>
            </div>
            {errors.restockingOptions && <p className="mt-3 text-xs text-red-600">{errors.restockingOptions}</p>}
            <div className="mt-4 space-y-3">
              {(form.restockingOptions || []).map((option, index) => {
                const prefix = `restock-${index}`;
                const matchingSavedUnit = savedRestockingUnits.find((saved) => saved.label.trim().toLowerCase() === option.label.trim().toLowerCase());
                const unitSelectValue = matchingSavedUnit ? matchingSavedUnit.label.trim().toLowerCase() : '__custom__';
                return <div key={option.id} className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
                    <Field id={`${prefix}-label`} label="I receive this as" hint="Example: Pack, Box, Case, or Tray">
                      <select id={`${prefix}-label`} className={inputCls} value={unitSelectValue} onChange={(event) => {
                        if (event.target.value === '__custom__') {
                          updateRestockingOption(index, { label: '', conversionFactor: 1 });
                          return;
                        }
                        const savedUnit = savedRestockingUnits.find((candidate) => candidate.label.trim().toLowerCase() === event.target.value);
                        if (savedUnit) updateRestockingOption(index, { label: savedUnit.label });
                      }}>
                        {savedRestockingUnits.map((savedUnit) => <option key={savedUnit.label.trim().toLowerCase()} value={savedUnit.label.trim().toLowerCase()}>{savedUnit.label}</option>)}
                        <option value="__custom__">Add a new package…</option>
                      </select>
                      {unitSelectValue === '__custom__' && <input aria-label="New restocking package name" className={`${inputCls} mt-2`} value={option.label} onChange={(event) => updateRestockingOption(index, { label: event.target.value })} placeholder="Enter package name" />}
                      {errors[`${prefix}-label`] && <p className="text-xs text-red-600">{errors[`${prefix}-label`]}</p>}
                    </Field>
                    <Field id={`${prefix}-factor`} label={`How many ${baseUnit}s are inside?`}>
                      <input id={`${prefix}-factor`} type="number" min={1} step={1} className={`${inputCls} font-mono`} value={restockingFactorDrafts[option.id] ?? String(option.conversionFactor)} onChange={(event) => {
                        const normalized = event.target.value.replace(/^0+(?=\d)/, '');
                        setRestockingFactorDrafts((prev) => ({ ...prev, [option.id]: normalized }));
                        updateRestockingOption(index, { conversionFactor: normalized === '' ? 0 : Number(normalized) || 0 });
                      }} onBlur={() => setRestockingFactorDrafts((prev) => {
                        const next = { ...prev };
                        delete next[option.id];
                        return next;
                      })} />
                      {errors[`${prefix}-factor`] && <p className="text-xs text-red-600">{errors[`${prefix}-factor`]}</p>}
                    </Field>
                    <div className="flex items-center gap-2 md:pb-1"><label className="inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-[var(--foreground)]"><input type="radio" name="default-restocking-unit" checked={Boolean(option.isDefault)} onChange={() => updateRestockingOption(index, { isDefault: true })} />Use by default</label><button type="button" onClick={() => removeRestockingOption(index)} disabled={(form.restockingOptions || []).length <= 1} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-red-100 bg-white text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40" aria-label={`Remove ${option.label || 'restocking'} unit`}><Trash2 className="h-4 w-4" /></button></div>
                  </div>
                  <p className="mt-2 text-xs text-emerald-800">Receiving 1 {option.label || 'package'} adds <span className="font-mono font-semibold">{option.conversionFactor} {baseUnit}{option.conversionFactor === 1 ? '' : 's'}</span> to inventory.</p>
                </div>;
              })}
            </div>
            <button type="button" onClick={addRestockingOption} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-dashed border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"><Plus className="h-4 w-4" />Add another restocking unit</button>
            </div>
            <div className="mt-5 grid grid-cols-1 gap-4 border-t border-[var(--border)] pt-5 md:grid-cols-2">

              <Field id="product-purchase-total" label="How much did you pay? (PHP)" required hint="Enter the total price for everything you bought."><input id="product-purchase-total" type="number" min={0} step="0.01" className={`${inputCls} font-mono`} value={purchaseTotal || ''} onChange={(event) => updatePurchaseCost(Number(event.target.value) || 0, purchaseQuantity)} /></Field>
              <Field id="product-purchase-unit" label="Purchased as"><select id="product-purchase-unit" className={inputCls} value={purchaseRestockingOption?.id ?? ''} onChange={(event) => setPurchaseRestockingOptionId(event.target.value)}>{(form.restockingOptions || []).map((option) => <option key={option.id} value={option.id}>{option.label || baseUnit} ({option.conversionFactor} {baseUnit}{option.conversionFactor === 1 ? '' : 's'})</option>)}</select></Field>
              <Field id="product-purchase-quantity" label={`How many ${purchaseRestockingOption?.label || baseUnit}${purchaseQuantity === 1 ? '' : 's'} did you buy?`} required hint={`We use the package size to calculate the cost per ${baseUnit}.`}><input id="product-purchase-quantity" type="number" min={0.01} step="0.01" className={`${inputCls} font-mono`} value={purchaseQuantity || ''} onChange={(event) => updatePurchaseCost(purchaseTotal, Number(event.target.value) || 0)} />{errors.purchaseQuantity && <p className="text-xs text-red-500">{errors.purchaseQuantity}</p>}</Field>
              <div className="rounded-lg bg-[var(--muted)] px-3 py-2 text-xs text-[var(--muted-foreground)] md:mt-6">Calculated cost per {baseUnit}: <span className="font-mono font-semibold">PHP {form.costPrice.toFixed(2)}</span></div>
              <Field id="product-price" label={`Regular selling price per ${baseUnit}`} required hint="Enter the price the customer pays. VAT is included for VAT-registered stores."><input id="product-price" type="number" min={0} step="0.01" className={`${inputCls} font-mono disabled:bg-gray-100`} value={form.sellingPrice || ''} disabled={form.autoPricingEnabled} onChange={(event) => { const sellingPrice = Number(event.target.value) || 0; setForm((prev) => ({ ...prev, sellingPrice })); }} />{errors.sellingPrice && <p className="text-xs text-red-500">{errors.sellingPrice}</p>}</Field>
              <div className="rounded-lg bg-[var(--muted)] px-3 py-2 text-xs text-[var(--muted-foreground)] md:mt-6">Profit per {baseUnit}: <span className="font-mono font-semibold">PHP {margin.toFixed(2)}</span>{' '}<span className={marginPct < 0 ? 'text-red-600' : 'text-green-700'}>({marginPct.toFixed(1)}%)</span></div>
            </div>
            <label className="mt-4 flex cursor-pointer items-start gap-2.5 select-none"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-blue-600" checked={Boolean(form.autoPricingEnabled)} onChange={(event) => set('autoPricingEnabled', event.target.checked)} /><span className="text-xs font-medium text-[var(--foreground)]">Automatic margin-based pricing <span className="block font-normal text-[var(--muted-foreground)]">Update the regular unit price from cost and target gross margin.</span></span></label>
            {form.autoPricingEnabled && <div className="mt-3 max-w-xs"><Field id="product-margin" label="Target gross margin (%)" hint="Profit divided by selling price."><input id="product-margin" type="number" min={0} max={99.99} step="0.01" className={`${inputCls} font-mono`} value={form.marginPercentage || ''} onChange={(event) => set('marginPercentage', Number(event.target.value) || 0)} />{errors.marginPercentage && <p className="text-xs text-red-500">{errors.marginPercentage}</p>}</Field></div>}

          </div>

          <div className={cardCls}>
            <div className="flex items-start justify-between gap-4"><div><h2 className={titleCls}>Selling options</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--muted-foreground)]">Add customer-friendly ways to buy this product. These options share the base stock; they never create duplicate inventory.</p></div><label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-sm font-semibold text-[var(--foreground)]"><input type="checkbox" className="h-4 w-4 accent-blue-600" checked={Boolean(form.bulkPurchaseEnabled)} onChange={(event) => toggleBulkPurchase(event.target.checked)} />Offer bundles</label></div>
            {form.bulkPurchaseEnabled && <div className="mt-4 space-y-3">{errors.bulkOptions && <p className="text-xs text-red-600">{errors.bulkOptions}</p>}{bulkOptions.map((option) => { const index = form.sellingOptions.findIndex((candidate) => candidate.id === option.id); const unitsPerBulk = option.quantityValue ?? option.inventoryMultiplier; const regular = regularValue(option); const pricingMethod = option.pricingMethod ?? 'fixed'; const selling = pricingMethod === 'fixed' ? (option.manualSellingPrice ?? option.sellingPrice) : calculateBulkPrice(basePrice, unitsPerBulk, pricingMethod === 'amount' ? 'amount' : 'percent', option.discountValue); const savings = Math.max(0, regular - selling); const bundleProfit = selling - form.costPrice * unitsPerBulk; const profitPerBaseUnit = unitsPerBulk > 0 ? bundleProfit / unitsPerBulk : 0; const bulkIndex = bulkOptions.findIndex((candidate) => candidate.id === option.id); const prefix = `bulk-${bulkIndex}`; const advancedOpen = Boolean(advancedPricing[option.id]); return <div key={option.id} className="rounded-xl border border-blue-100 bg-blue-50/40 p-4"><div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-[var(--foreground)]">Bundle #{bulkIndex + 1}</p><p className="mt-0.5 text-xs text-blue-700">1 {option.label || 'bundle'} contains {unitsPerBulk} {baseUnit}{unitsPerBulk === 1 ? '' : 's'}</p></div><button type="button" onClick={() => removeBulkOption(index)} className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-red-100 bg-white text-red-500 hover:bg-red-50" aria-label={`Remove ${option.label || 'bundle'} option`}><Trash2 className="h-4 w-4" /></button></div><div className="grid grid-cols-1 gap-3 md:grid-cols-2"><Field id={`${prefix}-label`} label="Sell it as" hint="Reuse a saved bundle name or add one. You can change the piece count below.">
  <select id={`${prefix}-label`} className={inputCls} value={savedSellingBundles.some((saved) => saved.label.trim().toLowerCase() === option.label.trim().toLowerCase()) ? option.label.trim().toLowerCase() : '__custom__'} onChange={(event) => {
    if (event.target.value === '__custom__') {
      updateBulkOption(index, { label: '' });
      return;
    }
    const savedBundle = savedSellingBundles.find((saved) => saved.label.trim().toLowerCase() === event.target.value);
    if (savedBundle) updateBulkOption(index, { label: savedBundle.label });
  }}>
    {savedSellingBundles.map((saved) => <option key={saved.label.trim().toLowerCase()} value={saved.label.trim().toLowerCase()}>{saved.label}</option>)}
    <option value="__custom__">Add a new bundle…</option>
  </select>
  {!savedSellingBundles.some((saved) => saved.label.trim().toLowerCase() === option.label.trim().toLowerCase()) && <input aria-label="New selling bundle name" className={`${inputCls} mt-2`} value={option.label} onChange={(event) => updateBulkOption(index, { label: event.target.value })} placeholder="Enter bundle name" />}
  {errors[`${prefix}-label`] && <p className="text-xs text-red-600">{errors[`${prefix}-label`]}</p>}
</Field><Field id={`${prefix}-units`} label={`How many ${baseUnit}s are inside?`} hint="This is deducted from base stock for each bundle sold."><input id={`${prefix}-units`} type="number" min={2} step={1} className={`${inputCls} font-mono`} value={sellingFactorDrafts[option.id] ?? String(unitsPerBulk)} onChange={(event) => {
  const normalized = event.target.value.replace(/^0+(?=\d)/, '');
  setSellingFactorDrafts((prev) => ({ ...prev, [option.id]: normalized }));
  const units = normalized === '' ? 0 : Number(normalized) || 0;
  updateBulkOption(index, { quantityValue: units, inventoryMultiplier: units });
}} onBlur={() => setSellingFactorDrafts((prev) => {
  const next = { ...prev };
  delete next[option.id];
  return next;
})} />{errors[`${prefix}-units`] && <p className="text-xs text-red-600">{errors[`${prefix}-units`]}</p>}</Field></div><div className="mt-3 max-w-sm"><Field id={`${prefix}-price`} label={`Sell this ${option.label || 'bundle'} for`} hint="Enter the price customers actually pay."><input id={`${prefix}-price`} type="number" min={0} step="0.01" className={`${inputCls} font-mono`} value={pricingMethod === 'fixed' ? (option.manualSellingPrice ?? option.sellingPrice) || '' : selling || ''} onChange={(event) => updateBulkOption(index, { pricingMethod: 'fixed', manualSellingPrice: Number(event.target.value) || 0, sellingPrice: Number(event.target.value) || 0 })} />{errors[`${prefix}-discount`] && <p className="text-xs text-red-600">{errors[`${prefix}-discount`]}</p>}</Field></div><button type="button" onClick={() => setAdvancedPricing((current) => ({ ...current, [option.id]: !advancedOpen }))} className="mt-3 inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-blue-700 hover:text-blue-900"><ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />Advanced pricing</button>{advancedOpen && <div className="mt-2 grid grid-cols-1 gap-3 rounded-lg border border-blue-100 bg-white p-3 sm:grid-cols-2"><Field id={`${prefix}-method`} label="Pricing method"><select id={`${prefix}-method`} className={inputCls} value={pricingMethod} onChange={(event) => updateBulkOption(index, { pricingMethod: event.target.value as PricingMethod })}><option value="fixed">Fixed bundle price</option><option value="percent">Percentage discount</option><option value="amount">Fixed amount discount</option></select></Field>{pricingMethod !== 'fixed' && <Field id={`${prefix}-discount`} label={pricingMethod === 'amount' ? 'Discount amount (PHP)' : 'Discount (%)'}><input id={`${prefix}-discount`} type="number" min={0} max={pricingMethod === 'percent' ? 100 : undefined} step="0.01" className={`${inputCls} font-mono`} value={option.discountValue || ''} onChange={(event) => updateBulkOption(index, { discountValue: Number(event.target.value) || 0 })} />{errors[`${prefix}-discount`] && <p className="text-xs text-red-600">{errors[`${prefix}-discount`]}</p>}</Field>}</div>}<div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-blue-100 bg-white p-3 text-sm sm:grid-cols-7"><div><p className="text-xs text-gray-500">Regular value</p><p className="font-mono font-semibold text-gray-900">PHP {regular.toFixed(2)}</p></div><div><p className="text-xs text-gray-500">Bundle price</p><p className="font-mono font-bold text-blue-700">PHP {selling.toFixed(2)}</p></div><div><p className="text-xs text-gray-500">Customer saves</p><p className="font-mono font-semibold text-green-700">PHP {savings.toFixed(2)}</p></div><div><p className="text-xs text-gray-500">Equivalent discount</p><p className="font-mono font-semibold text-green-700">{regular > 0 ? ((savings / regular) * 100).toFixed(2) : '0.00'}%</p></div><div><p className="text-xs text-gray-500">Effective price</p><p className="font-mono font-semibold text-gray-900">PHP {(unitsPerBulk > 0 ? selling / unitsPerBulk : 0).toFixed(2)} / {baseUnit}</p></div><div><p className="text-xs text-gray-500">Effective profit</p><p className={`font-mono font-semibold ${bundleProfit < 0 ? 'text-red-600' : 'text-green-700'}`}>PHP {bundleProfit.toFixed(2)}</p></div><div><p className="text-xs text-gray-500">Profit per {baseUnit}</p><p className={`font-mono font-semibold ${profitPerBaseUnit < 0 ? 'text-red-600' : 'text-green-700'}`}>PHP {profitPerBaseUnit.toFixed(2)}</p></div></div></div>; })}<button type="button" onClick={addBulkOption} className="inline-flex items-center gap-2 rounded-lg border border-dashed border-blue-300 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"><Plus className="h-4 w-4" />Add another selling option</button></div>}
          </div>

          {bulkOptions.some((option) => option.pricingMethod === 'fixed' && (option.manualSellingPrice ?? option.sellingPrice) < form.costPrice * (option.quantityValue ?? option.inventoryMultiplier)) && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800"><p className="font-semibold">Bundle price warning</p><p className="mt-1">Some fixed bundle prices are below the current supplier cost. Review them before selling.</p></div>}

          <div className={cardCls}>
            <h2 className={`${titleCls} mb-4`}>Inventory levels</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><Field id="product-stock" label={`Starting stock (${baseUnit}s)`} hint={mode === 'edit' ? 'Use Adjust Stock from Product Management to change stock.' : 'Stored only in base units.'}><input id="product-stock" type="number" min={0} step={1} disabled={mode === 'edit'} className={`${inputCls} font-mono`} value={form.currentStock || ''} onChange={(event) => set('currentStock', Number(event.target.value) || 0)} /></Field><Field id="product-low-stock" label={`Low stock alert (${baseUnit}s)`}><input id="product-low-stock" type="number" min={0} step={1} className={`${inputCls} font-mono`} value={form.minStockLevel || ''} onChange={(event) => set('minStockLevel', Number(event.target.value) || 0)} placeholder="e.g. 24" /></Field><Field id="product-safety-stock" label={`Safety stock (${baseUnit}s)`}><input id="product-safety-stock" type="number" min={0} step={1} className={`${inputCls} font-mono`} value={form.safetyStock || ''} onChange={(event) => set('safetyStock', Number(event.target.value) || 0)} /></Field><Field id="product-reorder-level" label={`Reorder level (${baseUnit}s)`}><input id="product-reorder-level" type="number" min={0} step={1} className={`${inputCls} font-mono`} value={form.reorderLevel || ''} onChange={(event) => set('reorderLevel', Number(event.target.value) || 0)} /></Field><Field id="product-lead-time" label="Lead time (days)"><input id="product-lead-time" type="number" min={1} step={1} className={`${inputCls} font-mono`} value={leadTimeDraft ?? String(form.leadTimeDays)} onChange={(event) => {
              const normalized = event.target.value.replace(/^0+(?=\d)/, '');
              setLeadTimeDraft(normalized);
              set('leadTimeDays', normalized === '' ? 1 : Number(normalized) || 1);
            }} onBlur={() => setLeadTimeDraft(null)} /></Field><Field id="product-rounding" label="Suggested price rounding"><select id="product-rounding" className={inputCls} value={form.priceRounding ?? 1} onChange={(event) => set('priceRounding', Number(event.target.value) || 1)}><option value={1}>Round up to nearest PHP 1</option><option value={5}>Round up to nearest PHP 5</option><option value={10}>Round up to nearest PHP 10</option></select></Field></div>
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
