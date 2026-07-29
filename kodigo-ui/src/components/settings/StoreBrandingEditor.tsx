import { useEffect, useMemo, useState } from 'react';
import { ImageUp, RotateCcw, Save } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { useToast } from '@/components/shared/Toast';
import {
  getStoreLogoUrl,
  removeStoreLogo,
  updateStoreBranding,
  uploadStoreLogo,
} from '@/lib/branding';
import { useAuthStore } from '@/stores/authStore';
import type { Store } from '@/types';

const inputClass = 'w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export function StoreBrandingEditor({ store }: { store: Store }) {
  const { toast } = useToast();
  const refreshStores = useAuthStore((state) => state.refreshStores);
  const [saving, setSaving] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [form, setForm] = useState({
    name: store.name,
    registeredName: store.registeredName ?? '',
    businessName: store.businessName ?? store.name,
    address: store.address,
    tin: store.tin ?? '',
    branchCode: store.branchCode ?? '',
    vatStatus: store.vatStatus,
    taxRate: String(store.taxRate),
    documentLabel: store.documentLabel,
    terminalIdentifier: store.terminalIdentifier ?? '',
    invoicePrefix: store.invoicePrefix,
    phone: store.phone ?? '',
    email: store.email ?? '',
    birRegistrationInfo: store.birRegistrationInfo ?? '',
    accreditationInfo: store.accreditationInfo ?? '',
    permitInfo: store.permitInfo ?? '',
  });

  useEffect(() => {
    setForm({
      name: store.name,
      registeredName: store.registeredName ?? '',
      businessName: store.businessName ?? store.name,
      address: store.address,
      tin: store.tin ?? '',
      branchCode: store.branchCode ?? '',
      vatStatus: store.vatStatus,
      taxRate: String(store.taxRate),
      documentLabel: store.documentLabel,
      terminalIdentifier: store.terminalIdentifier ?? '',
      invoicePrefix: store.invoicePrefix,
      phone: store.phone ?? '',
      email: store.email ?? '',
      birRegistrationInfo: store.birRegistrationInfo ?? '',
      accreditationInfo: store.accreditationInfo ?? '',
      permitInfo: store.permitInfo ?? '',
    });
    setLogoFile(null);
    setRemoveLogo(false);
  }, [store]);

  const previewUrl = useMemo(
    () => logoFile ? URL.createObjectURL(logoFile) : getStoreLogoUrl(removeLogo ? undefined : store.logoPath),
    [logoFile, removeLogo, store.logoPath]
  );

  useEffect(() => () => {
    if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const field = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!form.name.trim() || !form.businessName.trim()) {
      toast('error', 'Store name and business name are required.');
      return;
    }
    if (!/^[A-Za-z0-9-]{1,12}$/.test(form.invoicePrefix)) {
      toast('error', 'Invoice prefix must be 1–12 letters, numbers, or hyphens.');
      return;
    }

    setSaving(true);
    let pendingUploadedPath: string | undefined;
    let brandingUpdated = false;
    try {
      let logoPath: string | null | undefined;
      let obsoleteLogoPath: string | undefined;
      if (logoFile) {
        logoPath = await uploadStoreLogo(store.id, logoFile);
        pendingUploadedPath = logoPath;
        if (store.logoPath && store.logoPath !== logoPath) obsoleteLogoPath = store.logoPath;
      } else if (removeLogo) {
        logoPath = null;
        obsoleteLogoPath = store.logoPath;
      }

      await updateStoreBranding(store.id, {
        name: form.name.trim(),
        registeredName: form.registeredName.trim(),
        businessName: form.businessName.trim(),
        address: form.address.trim(),
        tin: form.tin.trim(),
        branchCode: form.branchCode.trim(),
        vatStatus: form.vatStatus,
        taxRate: form.vatStatus === 'non_vat' ? 0 : Number(form.taxRate || 0),
        documentLabel: form.documentLabel.trim() || 'Sales Invoice',
        terminalIdentifier: form.terminalIdentifier.trim(),
        invoicePrefix: form.invoicePrefix.trim().toUpperCase(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        birRegistrationInfo: form.birRegistrationInfo.trim(),
        accreditationInfo: form.accreditationInfo.trim(),
        permitInfo: form.permitInfo.trim(),
        ...(logoPath !== undefined ? { logoPath } : {}),
      });
      brandingUpdated = true;
      if (obsoleteLogoPath) {
        try {
          await removeStoreLogo(obsoleteLogoPath);
        } catch (cleanupError) {
          console.warn('Branding saved, but the previous logo could not be removed.', cleanupError);
        }
      }
      await refreshStores();
      setLogoFile(null);
      setRemoveLogo(false);
      toast('success', 'Branding and receipt information saved.');
    } catch (error) {
      if (pendingUploadedPath && !brandingUpdated) {
        try {
          await removeStoreLogo(pendingUploadedPath);
        } catch (cleanupError) {
          console.warn('Branding save failed and the uploaded logo could not be cleaned up.', cleanupError);
        }
      }
      toast('error', error instanceof Error ? error.message : 'Unable to save store branding.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-5">
        <h3 className="font-semibold text-gray-900">Store branding & receipt identity</h3>
        <p className="mt-1 text-sm text-gray-500">Applied to navigation, receipts, print previews, and PDF exports.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <div>
          <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
            <img src={previewUrl} alt="Store logo preview" className="max-h-full max-w-full object-contain" />
          </div>
          <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <ImageUp className="h-4 w-4" />
            Upload / replace
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                if (file && file.size > 2 * 1024 * 1024) {
                  toast('error', 'Logo files must be 2 MB or smaller.');
                  return;
                }
                setLogoFile(file);
                setRemoveLogo(false);
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => { setLogoFile(null); setRemoveLogo(true); }}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-50"
          >
            <RotateCcw className="h-4 w-4" /> Use default logo
          </button>
          <p className="mt-2 text-xs text-gray-400">PNG, JPG, or WebP. Maximum 2 MB.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Store name" value={form.name} onChange={(value) => field('name', value)} />
          <Input label="Registered business name" value={form.registeredName} onChange={(value) => field('registeredName', value)} />
          <Input label="Business / trade name" value={form.businessName} onChange={(value) => field('businessName', value)} />
          <Input label="TIN" value={form.tin} onChange={(value) => field('tin', value)} />
          <Input label="Branch code" value={form.branchCode} onChange={(value) => field('branchCode', value)} />
          <Input label="POS terminal / register" value={form.terminalIdentifier} onChange={(value) => field('terminalIdentifier', value)} />
          <Input label="Document label" value={form.documentLabel} onChange={(value) => field('documentLabel', value)} />
          <Input label="Invoice prefix" value={form.invoicePrefix} onChange={(value) => field('invoicePrefix', value)} />
          <Input label="Phone" value={form.phone} onChange={(value) => field('phone', value)} />
          <Input label="Email" type="email" value={form.email} onChange={(value) => field('email', value)} />
          <label className="sm:col-span-2">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">Store address</span>
            <textarea className={`${inputClass} resize-none`} rows={2} value={form.address} onChange={(event) => field('address', event.target.value)} />
          </label>
          <label>
            <span className="mb-1.5 block text-sm font-medium text-gray-700">Tax registration</span>
            <select className={inputClass} value={form.vatStatus} onChange={(event) => field('vatStatus', event.target.value)}>
              <option value="non_vat">Non-VAT registered</option>
              <option value="vat">VAT registered</option>
            </select>
          </label>
          <Input
            label="Tax rate (%)"
            type="number"
            value={form.vatStatus === 'non_vat' ? '0' : form.taxRate}
            disabled={form.vatStatus === 'non_vat'}
            onChange={(value) => field('taxRate', value)}
          />
          <TextArea label="BIR registration details" value={form.birRegistrationInfo} onChange={(value) => field('birRegistrationInfo', value)} />
          <TextArea label="Accreditation details" value={form.accreditationInfo} onChange={(value) => field('accreditationInfo', value)} />
          <TextArea label="Permit information" value={form.permitInfo} onChange={(value) => field('permitInfo', value)} />
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <Button variant="primary" loading={saving} onClick={save} icon={<Save className="h-4 w-4" />}>
          Save branding
        </Button>
      </div>
    </section>
  );
}

function Input({
  label,
  value,
  onChange,
  type = 'text',
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-sm font-medium text-gray-700">{label}</span>
      <input
        className={`${inputClass} disabled:bg-gray-100 disabled:text-gray-400`}
        type={type}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      <span className="mb-1.5 block text-sm font-medium text-gray-700">{label}</span>
      <textarea className={`${inputClass} resize-none`} rows={2} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
