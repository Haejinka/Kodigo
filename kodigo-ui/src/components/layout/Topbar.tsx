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
import { useActiveBranding } from '@/lib/branding';
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
    <div className={cn('border-b border-[var(--border)] px-4 py-3 last:border-0', !notification.isRead && 'bg-[var(--primary-soft)]/50')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(
              'rounded-full border px-2 py-0.5 text-[11px] font-semibold',
              severityStyles[notification.severity] ?? severityStyles.info
            )}>
              {notification.severity}
            </span>
            <span className="text-[11px] font-medium text-[var(--muted-foreground)]">
              {formatType(notification.type)}
            </span>
            {!notification.isRead && <span className="w-2 h-2 rounded-full bg-blue-500" />}
          </div>
          <p className="mt-1.5 text-sm font-semibold leading-snug text-[var(--foreground)]">{notification.title}</p>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--muted-foreground)]">{notification.message}</p>
          <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">{formatDateTime(notification.createdAt)}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!notification.isRead && (
            <button
              type="button"
              onClick={() => onRead(notification.id)}
              className="rounded-md p-2 text-[var(--muted-foreground)] hover:bg-[var(--primary-soft)] hover:text-[var(--primary)]"
              aria-label="Mark notification as read"
              title="Mark as read"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onDismiss(notification.id)}
              className="rounded-md p-2 text-[var(--muted-foreground)] hover:bg-[var(--destructive-soft)] hover:text-[var(--destructive)]"
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
  const branding = useActiveBranding();

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
      <header className="fixed left-0 right-0 top-0 z-30 flex h-16 items-center gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4 sm:gap-4">
        <button
          type="button"
          className="inline-flex size-10 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] lg:hidden"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5 text-gray-600" />
        </button>

        <div className="flex items-center gap-2 lg:hidden">
          <img src={branding.logoUrl} alt="" className="h-7 w-7 rounded-md object-contain" />
          <span className="text-base font-semibold text-[var(--foreground)]">{branding.businessName || branding.name}</span>
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={toggleMode}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--muted)]"
          aria-label={`Theme: ${mode}`}
          title={`Theme: ${mode}`}
        >
          {mode === 'dark' ? <Moon className="h-4 w-4 text-blue-400" /> : <Sun className="h-4 w-4 text-amber-500" />}
          <span className="hidden sm:inline capitalize">{mode}</span>
        </button>

        {(role === 'admin' || role === 'inventory') && stores.length > 0 && (
          <div className="relative mr-2">
            <button
              onClick={() => { setStoreOpen((v) => !v); setAlertOpen(false); setProfileOpen(false); }}
              type="button"
              aria-haspopup="menu"
              aria-expanded={storeOpen}
              className="flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 hover:bg-[var(--muted)]"
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
                <div role="menu" className="absolute right-0 top-12 z-20 w-56 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-xl">
                  <div className="border-b border-[var(--border)] bg-[var(--muted)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                    Switch Store
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    {stores.length > 1 && (
                      <button
                        onClick={() => handleStoreChange('all')}
                        type="button"
                        className={cn(
                          'w-full border-b border-[var(--border)] px-4 py-2.5 text-left text-sm hover:bg-[var(--primary-soft)]',
                          activeStoreId === 'all' ? 'bg-[var(--primary-soft)] font-medium text-[var(--primary)]' : 'text-[var(--foreground)]'
                        )}
                      >
                        All Stores
                      </button>
                    )}
                    {stores.map((store) => (
                      <button
                        key={store.id}
                        onClick={() => handleStoreChange(store.id)}
                        type="button"
                        className={cn(
                          'w-full px-4 py-2.5 text-left text-sm hover:bg-[var(--primary-soft)]',
                          activeStoreId === store.id ? 'bg-[var(--primary-soft)] font-medium text-[var(--primary)]' : 'text-[var(--foreground)]'
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

        {role !== 'inventory' && role !== 'super_admin' && <div className="relative">
          <button
            onClick={handleOpenNotifications}
            type="button"
            className="relative inline-flex size-10 items-center justify-center rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            aria-label="Notifications"
            aria-haspopup="menu"
            aria-expanded={alertOpen}
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
              <div role="menu" className="absolute right-0 top-12 z-20 w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-xl">
                <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
                  <div>
                    <span className="text-sm font-semibold text-[var(--foreground)]">Notifications</span>
                    <p className="text-xs text-[var(--muted-foreground)]">{unreadCount} unread</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {unreadCount > 0 && (
                      <button
                        onClick={() => void markAllRead()}
                        type="button"
                        className="whitespace-nowrap text-xs font-medium text-[var(--primary)] hover:underline"
                      >
                        Mark all read
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setAlertOpen(false);
                        navigate('/notifications');
                      }}
                      type="button"
                      className="rounded-md p-2 text-[var(--muted-foreground)] hover:bg-[var(--primary-soft)] hover:text-[var(--primary)]"
                      aria-label="View all notifications"
                      title="View all"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {isLoading ? (
                    <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">Loading notifications…</p>
                  ) : error ? (
                    <div className="px-4 py-8 text-center">
                      <p className="text-sm text-red-600">{error}</p>
                      <button
                        type="button"
                        onClick={() => void fetchNotifications()}
                        className="mt-2 text-xs font-medium text-[var(--primary)] hover:underline"
                      >
                        Retry
                      </button>
                    </div>
                  ) : notifications.length === 0 ? (
                    <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">No notifications</p>
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
        </div>}

        <div className="relative">
          <button
            onClick={() => { setProfileOpen((v) => !v); setAlertOpen(false); setStoreOpen(false); }}
            type="button"
            aria-haspopup="menu"
            aria-expanded={profileOpen}
            className="flex min-h-10 items-center gap-2 rounded-lg p-1.5 hover:bg-[var(--muted)]"
          >
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-semibold">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <span className="hidden max-w-40 truncate text-sm font-medium text-[var(--foreground)] sm:block">{displayName}</span>
          </button>

          {profileOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setProfileOpen(false)} />
              <div role="menu" className="absolute right-0 top-12 z-20 w-52 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-xl">
                <div className="border-b border-[var(--border)] px-4 py-3">
                  <p className="truncate text-sm font-semibold text-[var(--foreground)]">{displayName}</p>
                  <p className="text-xs capitalize text-[var(--muted-foreground)]">{String(displayRole).replace('_', ' ')}</p>
                </div>
                <button
                  onClick={() => {
                    setProfileOpen(false);
                    navigate(role === 'admin' ? '/settings/security' : '/account/security');
                  }}
                  type="button"
                  className="w-full px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--muted)]"
                >
                  Account security
                </button>
                <button
                  onClick={handleLogout}
                  type="button"
                  className="w-full px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--muted)]"
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
