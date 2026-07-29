import { useState, useEffect } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/shared/Button';
import { useActiveBranding } from '@/lib/branding';

export function LoginPage() {
  const { login, isLoading, error, isAuthenticated, role } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const branding = useActiveBranding();

  // If already logged in, redirect them immediately 
  useEffect(() => {
    if (isAuthenticated) {
      if (role === 'super_admin') {
        navigate('/super-admin');
      } else {
        navigate(role === 'cashier' ? '/pos' : role === 'inventory' ? '/inventory' : '/dashboard');
      }
    }
  }, [isAuthenticated, role, navigate]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await login(email, password);
    // The useEffect above will handle the routing once state updates
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img
            src={branding.logoUrl}
            alt={branding.businessName || branding.name}
            className="w-14 h-14 rounded-2xl mb-3 shadow-lg object-cover"
          />
          <h1 className="text-2xl font-bold text-gray-900">{branding.businessName || branding.name}</h1>
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
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-gray-700">Password</label>
                <Link to="/forgot-password" className="text-xs font-medium text-blue-600 hover:underline">
                  Forgot password?
                </Link>
              </div>
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

            {location.state?.passwordReset && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-700">
                Password updated. Sign in with your new password.
              </div>
            )}

            <Button type="submit" loading={isLoading} variant="primary" size="lg" className="w-full">
              Sign In
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-gray-600 mt-6">
          New to KodiGo?{' '}
          <Link to="/register" className="text-blue-600 font-semibold hover:text-blue-700 hover:underline">
            Create an owner account
          </Link>
        </p>

        <p className="text-center text-xs text-gray-400 mt-6">
          KodiGo v0.1.0 · Cloud POS for Sari-Sari Stores
        </p>
      </div>
    </div>
  );
}
