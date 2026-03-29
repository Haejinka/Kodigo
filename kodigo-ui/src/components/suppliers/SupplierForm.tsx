import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Info } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { useToast } from '@/components/shared/Toast';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import type { Supplier } from '@/types';
import type { SupplierFormData } from '@/stores/supplierStore';

interface SupplierFormProps {
  initial?: Partial<Supplier>;
  onSubmit: (data: SupplierFormData) => Promise<void>;
  mode: 'create' | 'edit';
  backPath?: string;
}

function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

const inputCls =
  'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';

export function SupplierForm({ initial, onSubmit, mode, backPath = '/suppliers' }: SupplierFormProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { activeStoreId, stores } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState<SupplierFormData>({
    storeId: initial?.storeId ?? (activeStoreId === 'all' ? '' : activeStoreId) ?? '',
    name: initial?.name ?? '',
    contact: initial?.contact ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    address: initial?.address ?? '',
    leadTimeDays: initial?.leadTimeDays ?? 1,
  });

  const set = <K extends keyof SupplierFormData>(key: K, value: SupplierFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((e) => { const ne = { ...e }; delete ne[key]; return ne; });
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.storeId) errs.storeId = 'Store selection is required';
    if (!form.name.trim()) errs.name = 'Supplier name is required';
    if (!form.contact.trim()) errs.contact = 'Contact person is required';
    if (!form.email.trim()) errs.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Enter a valid email address';
    if (!form.phone.trim()) errs.phone = 'Phone number is required';
    if (form.leadTimeDays < 1) errs.leadTimeDays = 'Lead time must be at least 1 day';
    return errs;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setLoading(true);
    try {
      await onSubmit(form);
      toast('success', mode === 'create' ? 'Supplier added successfully!' : 'Supplier updated successfully!');
      navigate(backPath);
    } catch (err: any) { toast('error', err?.message || 'Failed to save supplier. Please try again.'); } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Store Access</h3>
        <Field label="Store" required error={errors.storeId}>
          <select
            className={inputCls}
            value={form.storeId}
            onChange={(e) => set('storeId', e.target.value)}
            disabled={mode === 'edit'}
          >
            <option value="" disabled>Select a store</option>
            {stores.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>
      </div>

      {/* Contact Details */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Contact Details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <Field label="Supplier / Company Name" required error={errors.name}>
              <input
                className={inputCls}
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. San Miguel Corporation"
              />
            </Field>
          </div>

          <Field label="Contact Person" required error={errors.contact}>
            <input
              className={inputCls}
              value={form.contact}
              onChange={(e) => set('contact', e.target.value)}
              placeholder="e.g. Pedro Lim"
            />
          </Field>

          <Field label="Email Address" required error={errors.email}>
            <input
              type="email"
              className={inputCls}
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder="e.g. pedro@supplier.com"
            />
          </Field>

          <Field label="Phone Number" required error={errors.phone}>
            <input
              type="tel"
              className={inputCls}
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="e.g. +63 2 8632 3000"
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Address" hint="Full business address" error={errors.address}>
              <textarea
                className={inputCls + ' resize-none'}
                rows={2}
                value={form.address}
                onChange={(e) => set('address', e.target.value)}
                placeholder="e.g. 40 San Miguel Ave, Mandaluyong City"
              />
            </Field>
          </div>
        </div>
      </div>

      {/* Logistics */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Logistics</h3>
        <div className="max-w-xs">
          <Field
            label="Lead Time (days)"
            required
            hint="Average number of days from order to delivery"
            error={errors.leadTimeDays}
          >
            <input
              type="number"
              className={inputCls + ' font-mono'}
              value={form.leadTimeDays}
              onChange={(e) => set('leadTimeDays', Math.max(1, parseInt(e.target.value) || 1))}
              min={1}
              max={365}
            />
          </Field>
        </div>
      </div>

      {/* Performance Scores – read-only, auto-computed */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gray-900">Performance Scores</h3>
            <p className="text-xs text-gray-400 mt-0.5">Auto-calculated from order history and product pricing</p>
          </div>
          {mode === 'edit' && initial && (
            <div className="text-right">
              <p className="text-xs text-gray-500 mb-0.5">Overall Score</p>
              <p className={cn(
                'text-2xl font-bold font-mono',
                (initial.overallScore ?? 0) >= 90 ? 'text-green-600'
                  : (initial.overallScore ?? 0) >= 75 ? 'text-amber-600'
                  : 'text-red-600'
              )}>
                {initial.overallScore ?? '—'}
              </p>
              <p className="text-xs text-gray-400">/ 100</p>
            </div>
          )}
        </div>

        {mode === 'edit' && initial ? (
          <div className="grid grid-cols-3 gap-4 mb-4">
            {[
              { label: 'Reliability', value: initial.reliabilityScore, hint: 'From on-time delivery rate' },
              { label: 'Price', value: initial.priceScore, hint: 'vs. other supplier costs' },
              { label: 'Overall', value: initial.overallScore, hint: 'Reliability×60% + Price×40%' },
            ].map(({ label, value, hint }) => (
              <div key={label} className="bg-gray-50 rounded-xl p-3 text-center">
                <p className={cn(
                  'text-xl font-bold font-mono',
                  (value ?? 0) >= 90 ? 'text-green-600' : (value ?? 0) >= 75 ? 'text-amber-600' : 'text-red-600'
                )}>
                  {value ?? '—'}
                </p>
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mt-1.5 mb-1">
                  <div
                    className={cn('h-full rounded-full',
                      (value ?? 0) >= 90 ? 'bg-green-500' : (value ?? 0) >= 75 ? 'bg-amber-500' : 'bg-red-500'
                    )}
                    style={{ width: `${value ?? 0}%` }}
                  />
                </div>
                <p className="text-xs font-medium text-gray-700">{label}</p>
                <p className="text-xs text-gray-400">{hint}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-4">
            <p className="text-sm font-medium text-blue-800">Scores will be calculated after saving</p>
            <p className="text-xs text-blue-600 mt-0.5">
              Reliability starts at 100 and adjusts as purchase orders are marked received.
              Price score is normalised against other suppliers once products are assigned.
            </p>
          </div>
        )}

        <div className="flex items-start gap-2 bg-gray-50 rounded-lg px-3 py-2.5">
          <Info className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
          <div className="text-xs text-gray-500 space-y-0.5">
            <p><span className="font-medium">Reliability</span> = (on-time deliveries ÷ total orders) × 100</p>
            <p><span className="font-medium">Price</span> = normalised avg cost price vs. all suppliers (lower cost → higher score)</p>
            <p><span className="font-medium">Overall</span> = Reliability × 60% + Price × 40%</p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 justify-end">
        <Button type="button" variant="ghost" onClick={() => navigate(backPath)}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={loading}>
          {mode === 'create' ? 'Add Supplier' : 'Save Changes'}
        </Button>
      </div>
    </form>
  );
}
