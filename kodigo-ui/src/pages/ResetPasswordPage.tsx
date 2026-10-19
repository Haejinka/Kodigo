import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/shared/Button';
import { PasswordInput } from '@/components/shared/PasswordInput';
import { isSecurePassword, PasswordStrength } from '@/components/ui/password-strength';
import { supabase } from '@/lib/supabase';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) setSessionReady(Boolean(data.session));
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) setSessionReady(Boolean(session));
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!isSecurePassword(password)) {
      setError('Choose a stronger password that meets all requirements.');
      return;
    }
    setSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setMessage('Your password was updated successfully. Redirecting you to sign in…');
      void supabase.auth.signOut({ scope: 'local' }).catch((signOutError) => {
        console.warn('Password was updated, but the recovery session could not be cleared:', signOutError);
      });
      navigate('/login', { replace: true, state: { passwordReset: true } });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save your new password. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <h1 className="text-xl font-bold text-gray-900">Choose a new password</h1>
        <p className="text-sm text-gray-500 mt-1 mb-5">
          Use at least 8 characters and do not reuse your temporary password.
        </p>
        {!sessionReady ? (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            This reset link is invalid or expired. Request a new password reset email.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">New password</label>
              <PasswordInput
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                visibilityLabel="new password"
                required
                autoComplete="new-password"
              />
              <PasswordStrength value={password} className="mt-3" />
            </div>
            {message && <div role="status" className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">{message}</div>}
            {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>}
            <Button type="submit" variant="primary" loading={saving} className="w-full">
              Save new password
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
