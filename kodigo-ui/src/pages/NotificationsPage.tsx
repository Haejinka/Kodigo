import { AlertTriangle, Bell, Check, CheckCheck, CircleCheck, CircleX, Info, RefreshCw, X } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/shared/Button';
import { Badge } from '@/components/shared/Badge';
import { EmptyState } from '@/components/shared/EmptyState';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, formatDateTime } from '@/lib/utils';
import { useAlertStore } from '@/stores/alertStore';
import type { AppNotification } from '@/types';

const typeLabels: Record<string, string> = {
  low_stock: 'Low stock',
  out_of_stock: 'Out of stock',
  stock_adjustment: 'Stock adjustment',
  sack_conversion: 'Sack conversion',
  sale_completed: 'Sale completed',
  sale_voided: 'Sale voided',
  sale_refunded: 'Refund processed',
  sale_returned: 'Return processed',
  report_export_completed: 'Export completed',
  report_export_failed: 'Export failed',
  system_error: 'System error',
};

const formatType = (type: string) =>
  typeLabels[type] ?? type.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');

type NotificationVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

const severityConfig: Record<string, {
  label: string;
  variant: NotificationVariant;
  icon: React.ComponentType<{ className?: string }>;
}> = {
  info: { label: 'Info', variant: 'info', icon: Info },
  success: { label: 'Success', variant: 'success', icon: CircleCheck },
  warning: { label: 'Warning', variant: 'warning', icon: AlertTriangle },
  critical: { label: 'Critical', variant: 'danger', icon: CircleX },
  error: { label: 'Error', variant: 'danger', icon: CircleX },
};

function NotificationRow({
  notification,
  onRead,
  onDismiss,
}: {
  notification: AppNotification;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const severity = severityConfig[notification.severity] ?? severityConfig.info;
  const SeverityIcon = severity.icon;

  return (
    <Card
      role="listitem"
      className={cn(
        'p-4 sm:p-5',
        !notification.isRead && 'border-l-4 border-l-[var(--primary)] bg-[var(--primary-soft)]/20',
      )}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={severity.variant} className="gap-1">
              <SeverityIcon className="size-3.5" aria-hidden="true" />
              {severity.label}
            </Badge>
            <span className="text-xs font-medium text-[var(--muted-foreground)]">{formatType(notification.type)}</span>
            {!notification.isRead && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--primary)]">
                <span className="size-1.5 rounded-full bg-[var(--primary)]" aria-hidden="true" />
                Unread
              </span>
            )}
          </div>

          <h2 className="mt-3 text-base font-semibold leading-6 text-[var(--foreground)]">{notification.title}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)] text-pretty">{notification.message}</p>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
            <time dateTime={notification.createdAt}>{formatDateTime(notification.createdAt)}</time>
            {notification.productName && <span>{notification.productName}</span>}
            {notification.sellingOptionLabel && <span>{notification.sellingOptionLabel}</span>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 md:pt-0.5">
          {!notification.isRead && (
            <Button
              variant="outline"
              size="sm"
              icon={<Check />}
              onClick={() => onRead(notification.id)}
            >
              Mark read
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={<X />}
            onClick={() => onDismiss(notification.id)}
            aria-label="Dismiss notification"
            title="Dismiss notification"
            className="!size-9 !p-0 text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
          >
            <span className="sr-only">Dismiss notification</span>
          </Button>
        </div>
      </div>
    </Card>
  );
}

function NotificationLoadingState() {
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <span className="sr-only">Loading notifications…</span>
      {Array.from({ length: 4 }).map((_, index) => (
        <Card key={index} className="space-y-3 p-5">
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-4 w-28" />
          </div>
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-4 w-full max-w-2xl" />
          <Skeleton className="h-3 w-32" />
        </Card>
      ))}
    </div>
  );
}

export function NotificationsPage() {
  const {
    notifications,
    unreadCount,
    isLoading,
    error,
    fetchNotifications,
    markRead,
    markAllRead,
    dismiss,
  } = useAlertStore();

  const subtitle = unreadCount === 0
    ? 'You’re all caught up'
    : `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`;

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle={subtitle}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={<RefreshCw />}
              onClick={() => void fetchNotifications()}
              loading={isLoading}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              icon={<CheckCheck />}
              onClick={() => void markAllRead()}
              disabled={unreadCount === 0}
            >
              Mark all read
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <NotificationLoadingState />
      ) : error ? (
        <Alert variant="destructive" className="flex flex-wrap items-center justify-between gap-3">
          <AlertDescription>{error}</AlertDescription>
          <Button variant="outline" size="sm" onClick={() => void fetchNotifications()}>Retry</Button>
        </Alert>
      ) : notifications.length === 0 ? (
        <Card>
          <EmptyState
            icon={Bell}
            title="No notifications"
            description="New store activity and system events will appear here."
          />
        </Card>
      ) : (
        <div className="space-y-3" role="list" aria-label="Notifications">
          {notifications.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              onRead={(id) => void markRead(id)}
              onDismiss={(id) => void dismiss(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
