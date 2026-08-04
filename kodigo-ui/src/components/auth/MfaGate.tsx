import { useEffect, useState } from 'react';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { useAuthStore } from '@/stores/authStore';
import { getMfaRequirement, verifyTotpFactor } from '@/lib/mfa';

export function MfaGate({ children }: { children: React.ReactNode }) {
  const userId = useAuthStore((state) => state.user?.id);
  const logout = useAuthStore((state) => state.logout);
  const refreshStores = useAuthStore((state) => state.refreshStores);
  const [checking, setChecking] = useState(true);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const check = async () => {
      setChecking(true);
      setError(null);
      try {
        const requirement = await getMfaRequirement();
        if (active) setFactorId(requirement.required ? requirement.factor?.id ?? null : null);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Unable to check MFA status.');
      } finally {
        if (active) setChecking(false);
      }
    };
    if (userId) void check();
    return () => { active = false; };
  }, [userId]);

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!factorId) return;
    setVerifying(true);
    setError(null);
    try {
      await verifyTotpFactor(factorId, code);
      await refreshStores();
      setFactorId(null);
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The verification code is invalid or expired.');
    } finally {
      setVerifying(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-sm text-gray-500">Checking account security...</div>
      </div>
    );
  }

  if (error && !factorId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-sm bg-white border border-gray-200 rounded-2xl shadow-sm p-6 text-center">
          <ShieldCheck className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-gray-900">Security check unavailable</h1>
          <p className="text-sm text-gray-500 mt-2">{error}</p>
          <Button variant="secondary" className="w-full mt-5" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  if (!factorId) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
        <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center mb-4">
          <KeyRound className="w-6 h-6 text-blue-700" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">Two-factor verification</h1>
        <p className="text-sm text-gray-500 mt-2">
          Enter the current 6-digit code from your authenticator app to continue.
        </p>
        <form onSubmit={verify} className="mt-5 space-y-4">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            className="w-full px-3 py-3 text-center text-2xl tracking-[0.35em] font-mono border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="000000"
            autoFocus
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" size="lg" loading={verifying} disabled={code.length !== 6} className="w-full">
            Verify and continue
          </Button>
          <button
            type="button"
            onClick={() => void logout()}
            className="w-full inline-flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-gray-800"
          >
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
