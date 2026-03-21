import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ImagePlus, X, Link, Package } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { useToast } from '@/components/shared/Toast';
import type { Product } from '@/types';
import { mockCategories, mockSuppliers } from '@/lib/mock-data';

type ProductFormData = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'categoryName' | 'supplierName'>;

interface ProductFormProps {
  initial?: Partial<Product>;
  onSubmit: (data: ProductFormData) => Promise<void>;
  mode: 'create' | 'edit';
}

function Field({ label, required, children, hint }: { label: string; required?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';
const selectCls = inputCls;

export function ProductForm({ initial, onSubmit, mode }: ProductFormProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [urlInputMode, setUrlInputMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<ProductFormData>({
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
  });

  const set = (key: keyof ProductFormData, value: string | number) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((e) => { const ne = { ...e }; delete ne[key]; return ne; });
  };

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
    const objectUrl = URL.createObjectURL(file);
    setForm((prev) => ({ ...prev, imageUrl: objectUrl }));
  };

  const clearImage = () => {
    if (form.imageUrl?.startsWith('blob:')) URL.revokeObjectURL(form.imageUrl);
    setForm((prev) => ({ ...prev, imageUrl: undefined }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Product name is required';
    if (!form.sku.trim()) errs.sku = 'SKU is required';
    if (!form.categoryId) errs.categoryId = 'Category is required';
    if (form.sellingPrice <= 0) errs.sellingPrice = 'Selling price must be > 0';
    if (form.costPrice < 0) errs.costPrice = 'Cost price cannot be negative';
    return errs;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setLoading(true);
    try {
      await onSubmit(form);
      toast('success', mode === 'create' ? 'Product created successfully!' : 'Product updated successfully!');
      navigate('/inventory');
    } catch {
      toast('error', 'Failed to save product. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Product Image */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Product Image</h3>
        <div className="flex items-start gap-5">
          {/* Preview */}
          <div className="relative w-28 h-28 shrink-0 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden">
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
              <ImagePlus className="w-8 h-8 text-gray-300" />
            )}
          </div>

          {/* Controls */}
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors text-gray-700"
              >
                <ImagePlus className="w-4 h-4" />
                Upload Photo
              </button>
              <button
                type="button"
                onClick={() => setUrlInputMode((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors text-gray-700"
              >
                <Link className="w-4 h-4" />
                Use URL
              </button>
            </div>

            {urlInputMode && (
              <div className="flex items-center gap-2">
                <input
                  type="url"
                  className={inputCls + ' font-mono text-xs'}
                  placeholder="https://example.com/image.jpg"
                  value={form.imageUrl?.startsWith('blob:') ? '' : (form.imageUrl ?? '')}
                  onChange={(e) => setForm((prev) => ({ ...prev, imageUrl: e.target.value || undefined }))}
                />
              </div>
            )}

            <p className="text-xs text-gray-400">Accepted: JPG, PNG, GIF, WebP · Max 5 MB</p>

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

      {/* Basic Info */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Basic Information</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Product Name" required>
            <input
              className={inputCls}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Red Horse Beer 500ml"
            />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
          </Field>
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
            <select
              className={selectCls}
              value={form.categoryId}
              onChange={(e) => set('categoryId', e.target.value)}
            >
              <option value="">Select category…</option>
              {mockCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {errors.categoryId && <p className="text-xs text-red-500 mt-1">{errors.categoryId}</p>}
          </Field>
          <Field label="Supplier">
            <select
              className={selectCls}
              value={form.supplierId}
              onChange={(e) => set('supplierId', e.target.value)}
            >
              <option value="">Select supplier…</option>
              {mockSuppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      {/* Unit Configuration */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="font-semibold text-gray-900 mb-1">Unit Configuration</h3>
        <p className="text-xs text-gray-400 mb-4">Define how this product is sold and how it is bought from the supplier.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Selling Unit" hint="The unit shown on POS and sold to customers">
            <select
              className={selectCls}
              value={form.unit}
              onChange={(e) => set('unit', e.target.value)}
            >
              {['piece', 'stick', 'sachet', 'tablet', 'bottle', 'can', 'pack', 'box', 'kg', 'liter', 'ml', 'g'].map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </Field>
        </div>

        {/* Bulk purchase toggle */}
        <label className="flex items-center gap-2.5 mt-4 cursor-pointer select-none">
          <input
            type="checkbox"
            className="w-4 h-4 rounded border-gray-300 accent-blue-600"
            checked={(form.conversionFactor ?? 1) > 1 || !!form.purchaseUnit}
            onChange={(e) => {
              if (e.target.checked) {
                setForm((prev) => ({ ...prev, purchaseUnit: 'pack', conversionFactor: 1 }));
              } else {
                setForm((prev) => ({ ...prev, purchaseUnit: '', conversionFactor: 1 }));
              }
            }}
          />
          <span className="text-sm font-medium text-gray-700">
            This product is purchased from supplier in a bulk unit
            <span className="text-gray-400 font-normal ml-1">(e.g. bought per pack, box, or tray — sold per piece)</span>
          </span>
        </label>

        {!!form.purchaseUnit && (
          <div className="mt-4 pl-6 border-l-2 border-blue-100 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Purchase Unit" hint="The unit you order from your supplier">
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
                label={`Pieces per ${form.purchaseUnit}`}
                hint={`How many ${form.unit}s are in 1 ${form.purchaseUnit}`}
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
              <div className="flex items-start gap-2 bg-blue-50 rounded-lg px-3 py-2.5">
                <Package className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                <p className="text-xs text-blue-700">
                  Cost price below is entered <strong>per {form.purchaseUnit}</strong>. The system will track stock in <strong>{form.unit}s</strong> and auto-convert when you receive a delivery.
                  {form.costPrice > 0 && (
                    <> Cost per {form.unit} = ₱{(form.costPrice / (form.conversionFactor ?? 1)).toFixed(2)}.</>
                  )}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pricing */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Pricing</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={form.purchaseUnit ? `Cost Price (₱ per ${form.purchaseUnit})` : 'Cost Price (₱)'} required>
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
          <Field label="Selling Price (₱)" required>
            <input
              type="number"
              className={inputCls + ' font-mono'}
              value={form.sellingPrice}
              onChange={(e) => set('sellingPrice', parseFloat(e.target.value) || 0)}
              min={0}
              step={0.01}
            />
            {errors.sellingPrice && <p className="text-xs text-red-500 mt-1">{errors.sellingPrice}</p>}
          </Field>
        </div>
        {form.costPrice > 0 && form.sellingPrice > 0 && (() => {
          const costPerUnit = form.costPrice / (form.conversionFactor ?? 1);
          const margin = form.sellingPrice - costPerUnit;
          const marginPct = (margin / form.sellingPrice) * 100;
          return (
            <div className="mt-3 text-xs text-gray-500 space-y-0.5">
              {form.purchaseUnit && (form.conversionFactor ?? 1) > 1 && (
                <div>Cost per {form.unit}: <span className="font-mono font-medium">₱{costPerUnit.toFixed(2)}</span></div>
              )}
              <div>
                Margin: <span className="font-mono font-medium">₱{margin.toFixed(2)}</span>{' '}
                <span className={marginPct < 0 ? 'text-red-500' : 'text-green-600'}>({marginPct.toFixed(1)}%)</span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Stock & Reorder */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Stock & Reorder Settings</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {mode === 'create' && (
            <Field label="Initial Stock">
              <input
                type="number"
                className={inputCls + ' font-mono'}
                value={form.currentStock}
                onChange={(e) => set('currentStock', parseInt(e.target.value) || 0)}
                min={0}
              />
            </Field>
          )}
          <Field label="Min Stock Level" hint="Triggers low-stock alert">
            <input
              type="number"
              className={inputCls + ' font-mono'}
              value={form.minStockLevel}
              onChange={(e) => set('minStockLevel', parseInt(e.target.value) || 0)}
              min={0}
            />
          </Field>
          <Field label="Safety Stock" hint="Buffer below reorder level">
            <input
              type="number"
              className={inputCls + ' font-mono'}
              value={form.safetyStock}
              onChange={(e) => set('safetyStock', parseInt(e.target.value) || 0)}
              min={0}
            />
          </Field>
          <Field label="Reorder Level" hint="Triggers restock suggestion">
            <input
              type="number"
              className={inputCls + ' font-mono'}
              value={form.reorderLevel}
              onChange={(e) => set('reorderLevel', parseInt(e.target.value) || 0)}
              min={0}
            />
          </Field>
          <Field label="Lead Time (days)" hint="Days for supplier delivery">
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

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        <Button variant="secondary" type="button" onClick={() => navigate('/inventory')}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" loading={loading}>
          {mode === 'create' ? 'Save Product' : 'Update Product'}
        </Button>
      </div>
    </form>
  );
}
