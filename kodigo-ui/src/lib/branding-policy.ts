import type { Store } from '@/types';

export type Branding = Pick<
  Store,
  'id' | 'name' | 'businessName' | 'registeredName' | 'logoPath'
>;

const fallbackBranding: Branding = {
  id: 'kodigo',
  name: 'KodiGo',
  businessName: 'KodiGo',
};

export function resolveActiveBranding(
  stores: Store[],
  activeStoreId: string | 'all' | null,
): Branding {
  const activeStore = activeStoreId && activeStoreId !== 'all'
    ? stores.find((store) => store.id === activeStoreId)
    : stores[0];

  if (!activeStore) return fallbackBranding;

  return {
    id: activeStore.id,
    name: activeStore.name,
    businessName: activeStore.businessName,
    registeredName: activeStore.registeredName,
    logoPath: activeStore.logoPath,
  };
}
