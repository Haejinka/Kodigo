export const STORE_CAPABILITY_OPTIONS = [
  { code: 'approve_void', label: 'Approve transaction voids', description: 'Review void requests raised by another staff member.' },
  { code: 'approve_return', label: 'Approve physical returns', description: 'Review return requests raised by another staff member.' },
  { code: 'approve_refund', label: 'Approve refunds', description: 'Review refund requests raised by another staff member.' },
  { code: 'approve_cash_adjustment', label: 'Approve cash adjustments', description: 'Review manual cash adjustment requests.' },
  { code: 'approve_inventory_adjustment', label: 'Approve inventory adjustments', description: 'Review manual stock decreases and corrections.' },
  { code: 'operate_digital_services', label: 'Record digital services', description: 'Use manual service workflows after they are enabled for the store.' },
  { code: 'view_customer_history', label: 'View customer purchase history', description: 'See store-scoped purchase history for identified customers.' },
  { code: 'manage_customers', label: 'Manage customer records', description: 'Create and update the store’s customer records.' },
] as const;

export type StoreCapability = (typeof STORE_CAPABILITY_OPTIONS)[number]['code'];

export interface StoreCapabilityGrant {
  grant_id: string;
  profile_id: string;
  capability: StoreCapability;
  granted_by: string;
  granted_at: string;
  grant_reason: string;
}

const supportedCapabilities = new Set<string>(STORE_CAPABILITY_OPTIONS.map(({ code }) => code));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseStoreCapabilityGrants(value: unknown): StoreCapabilityGrant[] {
  if (!Array.isArray(value)) throw new TypeError('Capability grant list must be an array.');
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TypeError('Capability grant entry must be an object.');
    }
    const row = entry as Record<string, unknown>;
    const expectedKeys = ['capability', 'grant_id', 'grant_reason', 'granted_at', 'granted_by', 'profile_id'];
    const actualKeys = Object.keys(row).sort();
    const hasExactKeys = actualKeys.length === expectedKeys.length
      && actualKeys.every((key, index) => key === expectedKeys[index]);
    if (typeof row.grant_id !== 'string' || !uuidPattern.test(row.grant_id)
      || typeof row.profile_id !== 'string' || !uuidPattern.test(row.profile_id)
      || typeof row.capability !== 'string' || !supportedCapabilities.has(row.capability)
      || typeof row.granted_by !== 'string' || !uuidPattern.test(row.granted_by)
      || typeof row.granted_at !== 'string' || Number.isNaN(Date.parse(row.granted_at))
      || typeof row.grant_reason !== 'string' || row.grant_reason.trim().length < 3
      || row.grant_reason.trim().length > 500 || !hasExactKeys) {
      throw new TypeError('Capability grant entry has invalid fields.');
    }
    return row as unknown as StoreCapabilityGrant;
  });
}

function requireUuid(value: string, label: string): string {
  if (!uuidPattern.test(value)) throw new TypeError(`${label} must be a UUID.`);
  return value.toLowerCase();
}

function requireReason(reason: string): string {
  const normalized = reason.trim();
  if (normalized.length < 3 || normalized.length > 500) {
    throw new TypeError('Reason must contain 3 to 500 characters.');
  }
  return normalized;
}

function requireCapability(capability: string): StoreCapability {
  if (!supportedCapabilities.has(capability)) throw new TypeError('Capability code is unsupported.');
  return capability as StoreCapability;
}

export async function listStoreCapabilityGrants(storeId: string): Promise<StoreCapabilityGrant[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('list_store_capability_grants', {
    p_store_id: requireUuid(storeId, 'Store ID'),
  });
  if (error) throw error;
  return parseStoreCapabilityGrants(data);
}

export async function grantStoreCapability(input: {
  storeId: string;
  profileId: string;
  capability: StoreCapability;
  reason: string;
}): Promise<string> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('grant_store_capability', {
    p_store_id: requireUuid(input.storeId, 'Store ID'),
    p_profile_id: requireUuid(input.profileId, 'User ID'),
    p_capability: requireCapability(input.capability),
    p_reason: requireReason(input.reason),
  });
  if (error) throw error;
  if (typeof data !== 'string' || !uuidPattern.test(data)) {
    throw new TypeError('Server returned an invalid capability grant ID.');
  }
  return data;
}

export async function revokeStoreCapability(input: {
  storeId: string;
  grantId: string;
  reason: string;
}): Promise<boolean> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.rpc('revoke_store_capability', {
    p_store_id: requireUuid(input.storeId, 'Store ID'),
    p_grant_id: requireUuid(input.grantId, 'Grant ID'),
    p_reason: requireReason(input.reason),
  });
  if (error) throw error;
  if (typeof data !== 'boolean') throw new TypeError('Server returned an invalid capability revocation result.');
  return data;
}
