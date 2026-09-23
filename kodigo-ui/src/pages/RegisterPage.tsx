import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { PasswordInput } from '@/components/shared/PasswordInput';
import { isSecurePassword, PasswordStrength } from '@/components/ui/password-strength';
import { supabase } from '@/lib/supabase';

export function RegisterPage() {
  const navigate = useNavigate();
  
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [confirmationEmail, setConfirmationEmail] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (!inviteCode.trim()) {
        throw new Error("An Admin Invite Code is required to register an owner account.");
      }
      if (!isSecurePassword(password)) {
        throw new Error('Choose a stronger password that meets all requirements.');
      }

      const normalizedEmail = email.trim().toLowerCase();
      const { error: signUpError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: { name: fullName, invite_code: inviteCode }
        }
      });
      
      if (signUpError) throw signUpError;
      
      setConfirmationEmail(normalizedEmail);
      setSuccess(true);
      
    } catch (err: any) {
      setError(err.message || 'An error occurred during registration.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    if (!confirmationEmail || resending) return;

    setResending(true);
    setResendError(null);
    setResendMessage(null);

    try {
      const { error: resendAuthError } = await supabase.auth.resend({
        type: 'signup',
        email: confirmationEmail,
      });

      if (resendAuthError) throw resendAuthError;
      setResendMessage('A new confirmation email is on its way.');
    } catch (err: any) {
      setResendError(err.message || 'Unable to resend the confirmation email. Please try again.');
    } finally {
      setResending(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Check your inbox</h2>
          <p className="text-sm text-gray-500 mb-2">
            We sent a confirmation link to
          </p>
          <p className="text-sm font-semibold text-gray-900 break-all mb-6">
            {confirmationEmail}
          </p>
          <p className="text-xs text-gray-500 mb-5">
            Confirm your email address before signing in. If you do not see the message, check your spam folder.
          </p>

          {resendMessage && (
            <div role="status" className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-700 mb-4">
              {resendMessage}
            </div>
          )}
          {resendError && (
            <div role="alert" className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700 mb-4">
              {resendError}
            </div>
          )}

          <div className="space-y-3">
            <Button onClick={() => void handleResendConfirmation()} loading={resending} className="w-full">
              Resend confirmation email
            </Button>
            <Button onClick={() => navigate('/login')} variant="outline" className="w-full">
              Go to login
            </Button>
          </div>
          <p className="text-xs text-gray-400 mt-5">
            The confirmation link can only be used once.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img
            src="/kodigo-icon.png"
            alt="KodiGo"
            className="w-14 h-14 rounded-2xl mb-3 shadow-lg object-cover"
          />
          <h1 className="text-2xl font-bold text-gray-900">KodiGo</h1>
          <p className="text-sm text-gray-500 mt-1">Admin Onboarding</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">
          <h2 className="text-base font-semibold text-gray-900 mb-5">Create an owner account</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Juan Dela Cruz"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="juan@kodigo.ph"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                visibilityLabel="password"
                autoComplete="new-password"
                placeholder="Create a strong password"
                required
              />
              <PasswordStrength value={password} className="mt-3" />
            </div>

            <div className="pt-2">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Admin Invite Code</label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border-2 border-dashed border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent uppercase placeholder:normal-case font-mono"
                placeholder="e.g. STORE-2026-XYZ123"
                required
              />
              <p className="text-xs text-gray-500 mt-1">Required to register an admin/owner account.</p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700 mt-2">
                {error}
              </div>
            )}

            <Button type="submit" loading={loading} variant="primary" size="lg" className="w-full mt-2">
              Create Account
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-gray-600">
          Already have an account?{' '}
          <Link to="/login" className="text-blue-600 font-semibold hover:text-blue-700 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
