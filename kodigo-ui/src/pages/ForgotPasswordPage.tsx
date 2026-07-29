import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/shared/Button';
import { supabase } from '@/lib/supabase';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError(null);
    setMessage(null);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (resetError) {
      setError(resetError.message);
    } else {
      setMessage('If an account exists for that email, password reset instructions have been sent.');
    }
    setSending(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <h1 className="text-xl font-bold text-gray-900">Reset your password</h1>
        <p className="text-sm text-gray-500 mt-1 mb-5">
          Enter the email address used for your KodiGo account.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              autoComplete="email"
            />
          </div>
          {message && <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">{message}</div>}
          {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>}
          <Button type="submit" variant="primary" loading={sending} className="w-full">
            Send reset instructions
          </Button>
        </form>
        <Link to="/login" className="block text-center text-sm text-blue-600 font-medium hover:underline mt-5">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
