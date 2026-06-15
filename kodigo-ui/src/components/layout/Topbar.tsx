import { useState } from 'react';
import { Bell, Check, ChevronDown, ExternalLink, Menu, Moon, Store as StoreIcon, Sun, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn, formatDateTime } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { useAlertStore } from '@/stores/alertStore';
import { useCartStore } from '@/stores/cartStore';
import { useThemeStore } from '@/stores/themeStore';
import type { AppNotification } from '@/types';
import { MobileSidebarDrawer } from './Sidebar';
const typeLabels: Record<string, string> = {
  low_stock: 'Low Stock',
  out_of_stock: 'Out of Stock',
  stock_adjustment: 'Stock Adjustment',
  sack_conversion: 'Sack Conversion',
  sale_completed: 'Sale Completed',
  sale_voided: 'Sale Voided',
  sale_refunded: 'Refund Processed',
  sale_returned: 'Return Processed',
  report_export_completed: 'Export Completed',
  report_export_failed: 'Export Failed',
  system_error: 'System Error',
};

const severityStyles: Record<string, string> = {
  info: 'bg-blue-50 text-blue-700 border-blue-100',
  success: 'bg-green-50 text-green-700 border-green-100',
  warning: 'bg-amber-50 text-amber-700 border-amber-100',
  critical: 'bg-red-50 text-red-700 border-red-100',
  error: 'bg-red-50 text-red-700 border-red-100',
};

const formatType = (type: string) =>
  typeLabels[type] ?? type.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');

function NotificationItem({
  notification,
  onRead,
  onDismiss,
}: {
  notification: AppNotification;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  return (
    <div className={cn('px-4 py-3 border-b border-gray-100 last:border-0', !notification.isRead && 'bg-blue-50/40')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(
              'text-[11px] font-semibold px-2 py-0.5 rounded-full border',
              severityStyles[notification.severity] ?? severityStyles.info
            )}>
              {notification.severity}
            </span>
            <span className="text-[11px] font-medium text-gray-500">
              {formatType(notification.type)}
            </span>
            {!notification.isRead && <span className="w-2 h-2 rounded-full bg-blue-500" />}
          </div>
          <p className="text-sm font-semibold text-gray-900 mt-1.5 leading-snug">{notification.title}</p>
          <p className="text-xs text-gray-600 mt-1 leading-relaxed line-clamp-2">{notification.message}</p>
          <p className="text-[11px] text-gray-400 mt-1.5">{formatDateTime(notification.createdAt)}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!notification.isRead && (
            <button
              type="button"
              onClick={() => onRead(notification.id)}
              className="p-1.5 rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50"
              aria-label="Mark notification as read"
              title="Mark as read"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onDismiss(notification.id)}
            className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50"
            aria-label="Dismiss notification"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function Topbar() {
  const { user, profile, role, logout, stores, activeStoreId, setActiveStoreId } = useAuthStore();
  const { notifications, unreadCount, markRead, markAllRead, dismiss, isLoading, error, fetchNotifications } = useAlertStore();
  const clearCart = useCartStore(s => s.clearCart);
  const mode = useThemeStore((s) => s.mode);
  const toggleMode = useThemeStore((s) => s.toggleMode);
  const [storeOpen, setStoreOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();

  const handleStoreChange = (storeId: string) => {
    setActiveStoreId(storeId);
    setStoreOpen(false);
    clearCart();
  };

  const handleLogout = async () => {
    setProfileOpen(false);
    await logout();
    navigate('/login', { replace: true });
  };

  const handleOpenNotifications = () => {
    setAlertOpen((open) => !open);
    setProfileOpen(false);
    setStoreOpen(false);
    if (!alertOpen) void fetchNotifications();
  };

  const displayName = profile?.name || user?.user_metadata?.name || user?.email || 'User';
  const displayRole = profile?.role || role || 'user';
  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-30 h-16 flex items-center px-4 gap-4 transition-colors bg-[var(--app-surface-nav)] border-b border-[var(--app-border)]">
        <button
          className="lg:hidden p-2 rounded-lg hover:bg-[var(--app-surface-elevated)] transition-colors"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5 text-gray-600" />
        </button>

        <div className="flex items-center gap-2">
          <StoreIcon className="w-6 h-6 text-blue-600" />
          <span className="font-bold text-gray-900 text-base">KodiGo</span>
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={toggleMode}
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 transition-colors border-[var(--app-border)] bg-[var(--app-surface-card)] hover:bg-[var(--app-surface-elevated)]"
          aria-label={`Theme: ${mode}`}
          title={`Theme: ${mode}`}
        >
          {mode === 'dark' ? <Moon className="h-4 w-4 text-blue-400" /> : <Sun className="h-4 w-4 text-amber-500" />}
          <span className="hidden sm:inline capitalize">{mode}</span>
        </button>

        {role === 'admin' && stores.length > 0 && (
          <div className="relative mr-2">
            <button
              onClick={() => { setStoreOpen((v) => !v); setAlertOpen(false); setProfileOpen(false); }}
              className="flex items-center gap-2 px-3 py-1.5 border rounded-lg transition-colors border-[var(--app-border)] bg-[var(--app-surface-card)] hover:bg-[var(--app-surface-elevated)]"
            >
              <StoreIcon className="w-4 h-4 text-gray-600" />
              <span className="text-sm font-medium text-gray-700 max-w-[120px] truncate">
                {activeStoreId === 'all' ? 'All Stores' : (stores.find(s => s.id === activeStoreId)?.name || 'Select Store')}
              </span>
              <ChevronDown className="w-4 h-4 text-gray-500" />
            </button>
            {storeOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setStoreOpen(false)} />
                <div className="absolute right-0 top-11 z-20 w-56 rounded-xl shadow-xl border overflow-hidden bg-[var(--app-surface-card)] border-[var(--app-border)]">
                  <div className="px-4 py-2 border-b text-xs font-semibold text-gray-500 uppercase tracking-wide border-[var(--app-border-subtle)] bg-[var(--app-surface-elevated)]">
                    Switch Store
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    {stores.length > 1 && (
                      <button
                        onClick={() => handleStoreChange('all')}
                        className={cn(
                          'w-full text-left px-4 py-2.5 text-sm transition-colors border-b border-[var(--app-border-subtle)] hover:bg-[var(--app-accent-soft)]',
                          activeStoreId === 'all' ? 'bg-[var(--app-accent-soft)] text-blue-700 font-medium' : 'text-gray-700'
                        )}
                      >
                        All Stores
                      </button>
                    )}
                    {stores.map((store) => (
                      <button
                        key={store.id}
                        onClick={() => handleStoreChange(store.id)}
                        className={cn(
                          'w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-[var(--app-accent-soft)]',
                          activeStoreId === store.id ? 'bg-[var(--app-accent-soft)] text-blue-700 font-medium' : 'text-gray-700'
                        )}
                      >
                        {store.name}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <div className="relative">
          <button
            onClick={handleOpenNotifications}
            className="relative p-2 rounded-lg hover:bg-[var(--app-surface-elevated)] transition-colors"
            aria-label="Notifications"
          >
            <Bell className="w-5 h-5 text-gray-600" />
            {unreadCount > 0 && (
              <span className="absolute top-0.5 right-0.5 min-w-4 h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                {badgeText}
              </span>
            )}
          </button>

          {alertOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setAlertOpen(false)} />
              <div className="absolute right-0 top-11 z-20 w-[360px] max-w-[calc(100vw-2rem)] rounded-xl shadow-xl border overflow-hidden bg-[var(--app-surface-card)] border-[var(--app-border)]">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--app-border-subtle)]">
                  <div>
                    <span className="font-semibold text-sm text-gray-900">Notifications</span>
                    <p className="text-xs text-gray-500">{unreadCount} unread</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {unreadCount > 0 && (
                      <button
                        onClick={() => void markAllRead()}
                        className="text-xs text-blue-600 hover:underline font-medium whitespace-nowrap"
                      >
                        Mark all read
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setAlertOpen(false);
                        navigate(role === 'super_admin' ? '/super-admin/notifications' : '/notifications');
                      }}
                      className="p-1.5 rounded-md text-gray-400 hover:text-blue-600 hover:bg-[var(--app-accent-soft)]"
                      aria-label="View all notifications"
                      title="View all"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {isLoading ? (
                    <p className="text-sm text-gray-500 text-center py-8">Loading notifications...</p>
                  ) : error ? (
                    <div className="px-4 py-8 text-center">
                      <p className="text-sm text-red-600">{error}</p>
                      <button
                        type="button"
                        onClick={() => void fetchNotifications()}
                        className="text-xs text-blue-600 hover:underline font-medium mt-2"
                      >
                        Retry
                      </button>
                    </div>
                  ) : notifications.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-8">No notifications</p>
                  ) : (
                    notifications.slice(0, 8).map((notification) => (
                      <NotificationItem
                        key={notification.id}
                        notification={notification}
                        onRead={(id) => void markRead(id)}
                        onDismiss={(id) => void dismiss(id)}
                      />
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => { setProfileOpen((v) => !v); setAlertOpen(false); setStoreOpen(false); }}
            className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-[var(--app-surface-elevated)] transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-semibold">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <span className="hidden sm:block text-sm font-medium text-gray-700">{displayName}</span>
          </button>

          {profileOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setProfileOpen(false)} />
              <div className="absolute right-0 top-11 z-20 w-48 rounded-xl shadow-xl border overflow-hidden bg-[var(--app-surface-card)] border-[var(--app-border)]">
                <div className="px-4 py-3 border-b border-[var(--app-border-subtle)]">
                  <p className="text-sm font-semibold text-gray-900">{displayName}</p>
                  <p className="text-xs text-gray-500 capitalize">{String(displayRole).replace('_', ' ')}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-[var(--app-surface-elevated)] transition-colors"
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
