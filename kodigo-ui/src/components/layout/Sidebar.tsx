import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, Package, RefreshCw,
  Truck, BarChart2, Trophy, Settings, LogOut, ChevronLeft,
  ChevronRight,
  FileSpreadsheet, Bell,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { useAlertStore } from '@/stores/alertStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { UserRole } from '@/types';
import { useActiveBranding } from '@/lib/branding';

interface NavItem {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: UserRole[];
  badgeKey?: 'stockAlerts' | 'notifications';
}

const navItems: NavItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, roles: ['admin'] },
  { label: 'Super Admin', path: '/super-admin', icon: LayoutDashboard, roles: ['super_admin'] },
  { label: 'Notifications', path: '/notifications', icon: Bell, roles: ['admin'], badgeKey: 'notifications' },
  { label: 'Notifications', path: '/super-admin/notifications', icon: Bell, roles: ['super_admin'], badgeKey: 'notifications' },
  { label: 'POS Terminal', path: '/pos', icon: ShoppingCart, roles: ['admin', 'cashier'] },
  { label: 'Inventory', path: '/inventory', icon: Package, roles: ['admin', 'inventory'] },
  { label: 'Restocking', path: '/restocking', icon: RefreshCw, roles: ['admin'], badgeKey: 'stockAlerts' },
  { label: 'Suppliers', path: '/suppliers', icon: Truck, roles: ['admin'] },
  { label: 'Analytics', path: '/analytics', icon: BarChart2, roles: ['admin'] },
  { label: 'Rankings', path: '/rankings', icon: Trophy, roles: ['admin'] },
  { label: 'Reports', path: '/reports', icon: FileSpreadsheet, roles: ['admin', 'inventory'] },
  { label: 'Settings', path: '/settings', icon: Settings, roles: ['admin'] },
  { label: 'Account Security', path: '/account/security', icon: Settings, roles: ['admin', 'cashier', 'inventory', 'super_admin'] },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { role, logout } = useAuthStore();
  const { alerts, unreadCount } = useAlertStore();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const stockUnreadCount = alerts.filter((alert) => !alert.isRead).length;
  const branding = useActiveBranding();

  const filtered = navItems.filter((item) => {
    if (!role || !item.roles.includes(role)) return false;
    // Hide POS Terminal from admin on mobile — POS is desktop-only for admins
    if (item.path === '/pos' && role === 'admin' && isMobile) return false;
    return true;
  });

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <aside
      className={cn(
        'fixed left-0 top-16 bottom-0 z-20 flex flex-col border-r transition-all duration-200 bg-[var(--app-surface-nav)] border-[var(--app-border)]',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* Logo area on mobile only */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--app-border-subtle)]">
        <img
          src={branding.logoUrl}
          alt={branding.businessName || branding.name}
          className="w-5 h-5 rounded-md shrink-0 object-cover"
        />
        {!collapsed && (
          <span className="font-bold text-gray-900 text-sm">{branding.businessName || branding.name}</span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2">
        {filtered.map((item) => {
          const Icon = item.icon;
          const badge = item.badgeKey === 'stockAlerts'
            ? stockUnreadCount
            : item.badgeKey === 'notifications'
              ? unreadCount
              : 0;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors relative',
                  isActive
                    ? 'bg-[var(--app-accent-soft)] text-[#60A5FA] border-r-2 border-[var(--app-accent)]'
                    : 'text-gray-600 hover:bg-[var(--app-surface-elevated)] hover:text-gray-900'
                )
              }
            >
              <Icon className="w-5 h-5 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {badge > 0 && (
                <span
                  className={cn(
                    'ml-auto bg-red-500 text-white text-xs rounded-full font-semibold leading-none px-1.5 py-0.5',
                    collapsed && 'absolute top-1 right-1'
                  )}
                >
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Bottom actions */}
      <div className="border-t border-[var(--app-border)] py-2">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-[var(--app-surface-elevated)] hover:text-gray-900 transition-colors"
        >
          <LogOut className="w-5 h-5 shrink-0" />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        className="absolute -right-3 top-6 z-10 w-6 h-6 rounded-full border shadow-sm flex items-center justify-center transition-colors bg-[var(--app-surface-card)] border-[var(--app-border)] hover:bg-[var(--app-surface-elevated)]"
        aria-label="Toggle sidebar"
      >
        {collapsed ? (
          <ChevronRight className="w-3 h-3 text-gray-500" />
        ) : (
          <ChevronLeft className="w-3 h-3 text-gray-500" />
        )}
      </button>
    </aside>
  );
}

export function useSidebar() {
  const [collapsed, setCollapsed] = useState(false);
  return { collapsed, toggleSidebar: () => setCollapsed((c) => !c) };
}

// Mobile drawer variant
interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function MobileSidebarDrawer({ open, onClose }: MobileDrawerProps) {
  const { role, logout } = useAuthStore();
  const { alerts, unreadCount } = useAlertStore();
  const navigate = useNavigate();
  const filtered = navItems.filter((item) => role && item.roles.includes(role));
  const stockUnreadCount = alerts.filter((alert) => !alert.isRead).length;
  const branding = useActiveBranding();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
    onClose();
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/40" onClick={onClose} />
      <aside className="fixed left-0 top-0 bottom-0 z-40 w-64 shadow-xl flex flex-col bg-[var(--app-surface-nav)] border-r border-[var(--app-border)]">
        <div className="flex items-center gap-3 px-4 py-4 border-b border-[var(--app-border)]">
          <img
            src={branding.logoUrl}
            alt={branding.businessName || branding.name}
            className="w-5 h-5 rounded-md object-cover"
          />
          <span className="font-bold text-gray-900">{branding.businessName || branding.name}</span>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {filtered.map((item) => {
            const Icon = item.icon;
            const badge = item.badgeKey === 'stockAlerts'
              ? stockUnreadCount
              : item.badgeKey === 'notifications'
                ? unreadCount
                : 0;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={onClose}
                className={({ isActive }) =>
                  cn(
                  'flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors',
                  isActive
                      ? 'bg-[var(--app-accent-soft)] text-[#60A5FA] border-r-2 border-[var(--app-accent)]'
                      : 'text-gray-600 hover:bg-[var(--app-surface-elevated)] hover:text-gray-900'
                  )
                }
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span>{item.label}</span>
                {badge > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-xs rounded-full font-semibold px-1.5 py-0.5">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>
        <div className="border-t border-[var(--app-border)] py-2">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-4 py-3 text-sm font-medium text-gray-600 hover:bg-[var(--app-surface-elevated)]"
          >
            <LogOut className="w-5 h-5" />
            <span>Logout</span>
          </button>
        </div>
      </aside>
    </>
  );
}
