import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Store, Eye, EyeOff } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/shared/Button';

export function LoginPage() {
  const { login, isLoading, error } = useAuthStore();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await login(email, password);
    const { isAuthenticated, role } = useAuthStore.getState();
    if (isAuthenticated) {
      navigate(role === 'cashier' ? '/pos' : '/dashboard');
    }
  };

  const demoLogin = async (demoEmail: string) => {
    await login(demoEmail, 'demo');
    const { isAuthenticated, role } = useAuthStore.getState();
    if (isAuthenticated) {
      navigate(role === 'cashier' ? '/pos' : '/dashboard');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mb-3 shadow-lg">
            <Store className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">KodiGo</h1>
          <p className="text-sm text-gray-500 mt-1">Point of Sale & Inventory System</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-5">Sign in to your account</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="you@kodigo.ph"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2.5 pr-10 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <Button type="submit" loading={isLoading} variant="primary" size="lg" className="w-full">
              Sign In
            </Button>
          </form>

          {/* Demo accounts */}
          <div className="mt-5 pt-5 border-t border-gray-100">
            <p className="text-xs text-gray-400 mb-3 text-center font-medium">DEMO ACCOUNTS</p>
            <div className="space-y-2">
              <button
                onClick={() => demoLogin('admin@kodigo.ph')}
                disabled={isLoading}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-sm disabled:opacity-50"
              >
                <div className="text-left">
                  <p className="font-medium text-gray-800">Admin (Owner)</p>
                  <p className="text-xs text-gray-400">admin@kodigo.ph</p>
                </div>
                <span className="text-xs bg-purple-100 text-purple-700 font-semibold px-2 py-0.5 rounded-full">Admin</span>
              </button>
              <button
                onClick={() => demoLogin('cashier@kodigo.ph')}
                disabled={isLoading}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-sm disabled:opacity-50"
              >
                <div className="text-left">
                  <p className="font-medium text-gray-800">Cashier</p>
                  <p className="text-xs text-gray-400">cashier@kodigo.ph</p>
                </div>
                <span className="text-xs bg-blue-100 text-blue-700 font-semibold px-2 py-0.5 rounded-full">Cashier</span>
              </button>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          KodiGo v0.1.0 · Cloud POS for Sari-Sari Stores
        </p>
      </div>
    </div>
  );
}
