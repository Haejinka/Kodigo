import { useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import type { Store } from '@/types';

const CACHE_KEY = 'kodigo_branding_cache';

export type Branding = Pick<
  Store,
  'id' | 'name' | 'businessName' | 'registeredName' | 'logoPath'
>;

const fallbackBranding: Branding = {
  id: 'kodigo',
  name: 'KodiGo',
  businessName: 'KodiGo',
};

export function getStoreLogoUrl(logoPath?: string): string {
  if (!logoPath) return '/kodigo-icon.png';
  return supabase.storage.from('store-branding').getPublicUrl(logoPath).data.publicUrl;
}

export function cacheBranding(store: Store) {
  const branding: Branding = {
    id: store.id,
    name: store.name,
    businessName: store.businessName,
    registeredName: store.registeredName,
    logoPath: store.logoPath,
  };
  localStorage.setItem(CACHE_KEY, JSON.stringify(branding));
}

export function getCachedBranding(): Branding {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return fallbackBranding;
    const parsed = JSON.parse(raw) as Branding;
    return parsed?.name ? parsed : fallbackBranding;
  } catch {
    return fallbackBranding;
  }
}

export function useActiveBranding(): Branding & { logoUrl: string } {
  const stores = useAuthStore((state) => state.stores);
  const activeStoreId = useAuthStore((state) => state.activeStoreId);

  const branding = useMemo(() => {
    const active = activeStoreId && activeStoreId !== 'all'
      ? stores.find((store) => store.id === activeStoreId)
      : stores[0];
    return active
      ? {
          id: active.id,
          name: active.name,
          businessName: active.businessName,
          registeredName: active.registeredName,
          logoPath: active.logoPath,
        }
      : getCachedBranding();
  }, [activeStoreId, stores]);

  useEffect(() => {
    const active = stores.find((store) => store.id === branding.id);
    if (active) cacheBranding(active);
  }, [branding.id, stores]);

  return { ...branding, logoUrl: getStoreLogoUrl(branding.logoPath) };
}

export async function updateStoreBranding(
  storeId: string,
  values: Partial<{
    name: string;
    registeredName: string;
    businessName: string;
    address: string;
    tin: string;
    branchCode: string;
    vatStatus: 'vat' | 'non_vat';
    taxRate: number;
    documentLabel: string;
    terminalIdentifier: string;
    birRegistrationInfo: string;
    accreditationInfo: string;
    permitInfo: string;
    invoicePrefix: string;
    phone: string;
    email: string;
    logoPath: string | null;
  }>
) {
  const payload: Record<string, unknown> = {};
  const mappings = {
    name: 'name',
    registeredName: 'registered_name',
    businessName: 'business_name',
    address: 'address',
    tin: 'tin',
    branchCode: 'branch_code',
    vatStatus: 'vat_status',
    taxRate: 'tax_rate',
    documentLabel: 'document_label',
    terminalIdentifier: 'terminal_identifier',
    birRegistrationInfo: 'bir_registration_info',
    accreditationInfo: 'accreditation_info',
    permitInfo: 'permit_info',
    invoicePrefix: 'invoice_prefix',
    phone: 'phone',
    email: 'email',
    logoPath: 'logo_path',
  } as const;

  for (const [key, column] of Object.entries(mappings)) {
    if (key in values) payload[column] = values[key as keyof typeof values];
  }

  const { error } = await supabase.from('stores').update(payload).eq('id', storeId);
  if (error) throw error;
}

export async function uploadStoreLogo(storeId: string, file: File): Promise<string> {
  const allowed = new Set(['image/png', 'image/jpeg', 'image/webp']);
  if (!allowed.has(file.type)) throw new Error('Use a PNG, JPG, or WebP image.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Logo files must be 2 MB or smaller.');

  const extension = file.type === 'image/jpeg'
    ? 'jpg'
    : file.type.split('/')[1];
  const path = `${storeId}/logo/store-logo-${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage
    .from('store-branding')
    .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' });
  if (error) throw error;
  return path;
}

export async function removeStoreLogo(path?: string) {
  if (!path) return;
  const { error } = await supabase.storage.from('store-branding').remove([path]);
  if (error) throw error;
}
