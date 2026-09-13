import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, Package,
  Truck, BarChart2, Trophy, Settings, ChevronLeft,
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
  { label: 'POS Terminal', path: '/pos', icon: ShoppingCart, roles: ['admin', 'cashier'] },
  { label: 'Product Management', path: '/inventory', icon: Package, roles: ['admin', 'inventory'], badgeKey: 'stockAlerts' },
  { label: 'Suppliers', path: '/suppliers', icon: Truck, roles: ['admin'] },
  { label: 'Analytics', path: '/analytics', icon: BarChart2, roles: ['admin'] },
  { label: 'Rankings', path: '/rankings', icon: Trophy, roles: ['admin'] },
  { label: 'Sales Reports', path: '/reports', icon: FileSpreadsheet, roles: ['admin', 'inventory'] },
  { label: 'Settings', path: '/settings', icon: Settings, roles: ['admin'] },
  // Admins access security from Settings; keep this shortcut for roles without the admin settings area.
  { label: 'Account Security', path: '/account/security', icon: Settings, roles: ['cashier', 'inventory', 'super_admin'] },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { role } = useAuthStore();
  const { alerts, unreadCount } = useAlertStore();
  const isMobile = useIsMobile();
  const stockUnreadCount = alerts.filter((alert) => !alert.isRead).length;
  const branding = useActiveBranding();

  const filtered = navItems.filter((item) => {
    if (!role || !item.roles.includes(role)) return false;
    // Hide POS Terminal from admin on mobile — POS is desktop-only for admins
    if (item.path === '/pos' && role === 'admin' && isMobile) return false;
    return true;
  });

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
      <nav className="flex-1 overflow-y-auto py-3" aria-label="Primary navigation">
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
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  'relative flex min-h-11 items-center gap-3 px-4 py-2.5 text-sm font-medium transition-[background-color,color] duration-150',
                  isActive
                    ? 'border-r-2 border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]'
                    : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]'
                )
              }
            >
              <Icon className="w-5 h-5 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {badge > 0 && (
                <span
                  className={cn(
                    'ml-auto rounded-full bg-[var(--destructive)] px-1.5 py-0.5 text-xs font-semibold leading-none text-white',
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

      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        className="absolute -right-3 top-6 z-10 flex size-7 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)] shadow-sm transition-colors hover:bg-[var(--muted)]"
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
  const { role } = useAuthStore();
  const { alerts, unreadCount } = useAlertStore();
  const filtered = navItems.filter((item) => role && item.roles.includes(role));
  const stockUnreadCount = alerts.filter((alert) => !alert.isRead).length;
  const branding = useActiveBranding();

  useEffect(() => {
    if (!open) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <>
      <button type="button" aria-label="Close navigation" className="fixed inset-0 z-30 cursor-default bg-black/40" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-label="Navigation menu" className="fixed bottom-0 left-0 top-0 z-40 flex w-72 flex-col border-r border-[var(--border)] bg-[var(--card)] shadow-xl">
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-4">
          <img
            src={branding.logoUrl}
            alt={branding.businessName || branding.name}
            className="w-5 h-5 rounded-md object-cover"
          />
          <span className="font-semibold text-[var(--foreground)]">{branding.businessName || branding.name}</span>
        </div>
        <nav className="flex-1 overflow-y-auto py-3" aria-label="Primary navigation">
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
                  'flex min-h-11 items-center gap-3 px-4 py-3 text-sm font-medium transition-[background-color,color] duration-150',
                  isActive
                      ? 'border-r-2 border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]'
                      : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]'
                  )
                }
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span>{item.label}</span>
                {badge > 0 && (
                  <span className="ml-auto rounded-full bg-[var(--destructive)] px-1.5 py-0.5 text-xs font-semibold text-white">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
