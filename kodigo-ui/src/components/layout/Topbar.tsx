import { useState } from 'react';
import { Bell, Menu, Store } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { useAlertStore } from '@/stores/alertStore';
import { formatDateTime } from '@/lib/utils';
import { MobileSidebarDrawer } from './Sidebar';

interface TopbarProps {
  onMenuToggle?: () => void;
}

export function Topbar({ onMenuToggle }: TopbarProps) {
  const { user, logout } = useAuthStore();
  const { alerts, unreadCount, markAllRead } = useAlertStore();
  const [alertOpen, setAlertOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const typeColors: Record<string, string> = {
    'out-of-stock': 'bg-red-100 text-red-700',
    critical: 'bg-orange-100 text-orange-700',
    low: 'bg-amber-100 text-amber-700',
  };

  const typeLabels: Record<string, string> = {
    'out-of-stock': 'Out of Stock',
    critical: 'Critical',
    low: 'Low Stock',
  };

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-30 h-16 bg-white border-b border-gray-200 flex items-center px-4 gap-4">
        {/* Mobile menu button */}
        <button
          className="lg:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5 text-gray-600" />
        </button>

        {/* Logo */}
        <div className="flex items-center gap-2">
          <Store className="w-6 h-6 text-blue-600" />
          <span className="font-bold text-gray-900 text-base">KodiGo</span>
        </div>

        <div className="flex-1" />

        {/* Alert Bell */}
        <div className="relative">
          <button
            onClick={() => { setAlertOpen((v) => !v); setProfileOpen(false); }}
            className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Notifications"
          >
            <Bell className="w-5 h-5 text-gray-600" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                {unreadCount}
              </span>
            )}
          </button>

          {alertOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setAlertOpen(false)} />
              <div className="absolute right-0 top-11 z-20 w-80 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                  <span className="font-semibold text-sm text-gray-900">Stock Alerts</span>
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllRead}
                      className="text-xs text-blue-600 hover:underline font-medium"
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {alerts.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-8">No alerts</p>
                  ) : (
                    alerts.map((alert) => (
                      <div
                        key={alert.id}
                        className={cn(
                          'px-4 py-3 border-b border-gray-50 last:border-0',
                          !alert.isRead && 'bg-blue-50/40'
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <span className={cn('text-xs font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap', typeColors[alert.type])}>
                            {typeLabels[alert.type]}
                          </span>
                          {!alert.isRead && <span className="w-2 h-2 mt-1 rounded-full bg-blue-500 shrink-0" />}
                        </div>
                        <p className="text-sm font-medium text-gray-900 mt-1">{alert.productName}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Stock: {alert.currentStock} / Min: {alert.minStockLevel}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(alert.createdAt)}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* User Avatar */}
        <div className="relative">
          <button
            onClick={() => { setProfileOpen((v) => !v); setAlertOpen(false); }}
            className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-semibold">
              {user?.name?.charAt(0) ?? 'U'}
            </div>
            <span className="hidden sm:block text-sm font-medium text-gray-700">{user?.name}</span>
          </button>

          {profileOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setProfileOpen(false)} />
              <div className="absolute right-0 top-11 z-20 w-48 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-sm font-semibold text-gray-900">{user?.name}</p>
                  <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Log out
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <MobileSidebarDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
