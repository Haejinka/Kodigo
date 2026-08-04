import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useToast } from '@/components/shared/Toast';
import { supabase } from '@/lib/supabase';
import { listTotpFactors, verifyTotpFactor, type TotpFactor } from '@/lib/mfa';

interface Enrollment {
  factorId: string;
  qrCode: string;
  secret: string;
}

export function MfaSettings() {
  const { toast } = useToast();
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TotpFactor | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      setFactors(await listTotpFactors());
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to load MFA settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const beginEnrollment = async () => {
    setWorking(true);
    try {
      const existingFactors = await listTotpFactors();
      for (const factor of existingFactors.filter((item) => item.status === 'unverified')) {
        const { error: cleanupError } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
        if (cleanupError) throw cleanupError;
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'KodiGo Authenticator',
      });
      if (error) throw error;
      setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
      setCode('');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to start MFA enrollment.');
    } finally {
      setWorking(false);
    }
  };

  const cancelEnrollment = async () => {
    if (!enrollment) return;
    setWorking(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId });
      if (error) throw error;
      setEnrollment(null);
      setCode('');
      await refresh();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to cancel MFA setup.');
    } finally {
      setWorking(false);
    }
  };

  const completeEnrollment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!enrollment) return;
    setWorking(true);
    try {
      await verifyTotpFactor(enrollment.factorId, code);
      setEnrollment(null);
      setCode('');
      await refresh();
      toast('success', 'Two-factor authentication is now enabled.');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'The verification code is invalid or expired.');
    } finally {
      setWorking(false);
    }
  };

  const removeFactor = async () => {
    if (!removeTarget) return;
    setWorking(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: removeTarget.id });
      if (error) throw error;
      await supabase.auth.refreshSession();
      setRemoveTarget(null);
      await refresh();
      toast('success', 'Two-factor authentication has been disabled.');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to disable MFA.');
    } finally {
      setWorking(false);
    }
  };

  const verifiedFactors = factors.filter((factor) => factor.status === 'verified');

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 max-w-xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" /> Two-Factor Authentication
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            Protect your account with a time-based code from an authenticator app.
          </p>
        </div>
        {!loading && (
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${verifiedFactors.length ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
            {verifiedFactors.length ? 'Enabled' : 'Not enabled'}
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 py-6">Loading MFA settings...</p>
      ) : enrollment ? (
        <form onSubmit={completeEnrollment} className="mt-5 space-y-4">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <p className="text-sm font-medium text-blue-900">1. Scan this QR code</p>
            <p className="text-xs text-blue-700 mt-1">Use Google Authenticator, Microsoft Authenticator, Authy, or another TOTP app.</p>
            <img src={enrollment.qrCode} alt="Authenticator enrollment QR code" className="w-48 h-48 mx-auto my-4 bg-white rounded-lg" />
            <p className="text-xs text-blue-700 mb-1">Cannot scan? Enter this setup key:</p>
            <div className="flex items-center gap-2 bg-white border border-blue-100 rounded-lg px-3 py-2">
              <code className="text-xs font-mono break-all flex-1 text-gray-800">{enrollment.secret}</code>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(enrollment.secret);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                }}
                className="p-1.5 text-gray-500 hover:text-blue-600"
                aria-label="Copy setup key"
              >
                {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">2. Enter the 6-digit code</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              className="w-full px-3 py-2.5 text-center text-xl tracking-[0.3em] font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="000000"
            />
          </div>
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={() => void cancelEnrollment()} disabled={working} className="flex-1">Cancel</Button>
            <Button type="submit" loading={working} disabled={code.length !== 6} className="flex-1">Verify and enable</Button>
          </div>
        </form>
      ) : verifiedFactors.length > 0 ? (
        <div className="mt-5 space-y-3">
          {verifiedFactors.map((factor) => (
            <div key={factor.id} className="flex items-center gap-3 border border-gray-100 rounded-xl p-3">
              <div className="w-9 h-9 rounded-lg bg-green-100 flex items-center justify-center"><Smartphone className="w-4 h-4 text-green-700" /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{factor.friendlyName || 'Authenticator app'}</p>
                <p className="text-xs text-gray-500">Verified TOTP factor</p>
              </div>
              <Button variant="danger" size="sm" onClick={() => setRemoveTarget(factor)}>Disable</Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-5">
          <Button onClick={() => void beginEnrollment()} loading={working} icon={<KeyRound className="w-4 h-4" />}>
            Enable authenticator app
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Disable two-factor authentication?"
        description="Your account will return to password-only sign-in. Only disable MFA if you still control this account."
        confirmLabel="Disable MFA"
        danger
        loading={working}
        onConfirm={removeFactor}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
