import { supabase } from '@/lib/supabase';

export interface TotpFactor {
  id: string;
  friendlyName?: string;
  status: 'verified' | 'unverified';
  createdAt?: string;
}

const mapFactor = (factor: {
  id: string;
  friendly_name?: string;
  status: 'verified' | 'unverified';
  created_at?: string;
}): TotpFactor => ({
  id: factor.id,
  friendlyName: factor.friendly_name,
  status: factor.status,
  createdAt: factor.created_at,
});

export async function listTotpFactors(): Promise<TotpFactor[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return data.totp.map(mapFactor);
}

export async function getMfaRequirement(): Promise<{
  required: boolean;
  factor: TotpFactor | null;
}> {
  const { data: assurance, error: assuranceError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) throw assuranceError;

  if (assurance.currentLevel === 'aal2' || assurance.nextLevel !== 'aal2') {
    return { required: false, factor: null };
  }

  const factors = await listTotpFactors();
  const factor = factors.find((item) => item.status === 'verified') ?? null;
  return { required: Boolean(factor), factor };
}

export async function verifyTotpFactor(factorId: string, code: string): Promise<void> {
  const normalizedCode = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new Error('Enter the 6-digit code from your authenticator app.');
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: normalizedCode,
  });
  if (error) throw error;

  const { data: assurance, error: assuranceError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) throw assuranceError;
  if (assurance.currentLevel !== 'aal2') {
    throw new Error('MFA verification did not upgrade this session. Try again.');
  }
}
