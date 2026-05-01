import { Bell, Check, CheckCheck, RefreshCw, X } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/shared/Button';
import { cn, formatDateTime } from '@/lib/utils';
import { useAlertStore } from '@/stores/alertStore';
import type { AppNotification } from '@/types';

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

function NotificationRow({
  notification,
  onRead,
  onDismiss,
}: {
  notification: AppNotification;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  return (
    <article className={cn(
      'bg-white border border-gray-200 rounded-lg p-4 shadow-sm',
      !notification.isRead && 'border-blue-200 bg-blue-50/30'
    )}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(
              'text-xs font-semibold px-2 py-0.5 rounded-full border',
              severityStyles[notification.severity] ?? severityStyles.info
            )}>
              {notification.severity}
            </span>
            <span className="text-xs font-medium text-gray-500">{formatType(notification.type)}</span>
            {!notification.isRead && <span className="text-xs font-semibold text-blue-700">Unread</span>}
          </div>
          <h2 className="mt-2 text-base font-semibold text-gray-900">{notification.title}</h2>
          <p className="mt-1 text-sm text-gray-600 leading-relaxed">{notification.message}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
            <span>{formatDateTime(notification.createdAt)}</span>
            {notification.productName && <span>{notification.productName}</span>}
            {notification.sellingOptionLabel && <span>{notification.sellingOptionLabel}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:justify-end">
          {!notification.isRead && (
            <Button
              variant="secondary"
              size="sm"
              icon={<Check className="w-4 h-4" />}
              onClick={() => onRead(notification.id)}
            >
              Mark read
            </Button>
          )}
          <button
            type="button"
            onClick={() => onDismiss(notification.id)}
            className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
            aria-label="Dismiss notification"
            title="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </article>
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

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle={`${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={<RefreshCw className="w-4 h-4" />}
              onClick={() => void fetchNotifications()}
              loading={isLoading}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              icon={<CheckCheck className="w-4 h-4" />}
              onClick={() => void markAllRead()}
              disabled={unreadCount === 0}
            >
              Mark all read
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <div className="bg-white border border-gray-200 rounded-lg p-10 text-center text-sm text-gray-500">
          Loading notifications...
        </div>
      ) : error ? (
        <div className="bg-white border border-red-100 rounded-lg p-10 text-center">
          <p className="text-sm font-medium text-red-600">{error}</p>
          <button
            type="button"
            onClick={() => void fetchNotifications()}
            className="mt-3 text-sm font-medium text-blue-600 hover:underline"
          >
            Retry
          </button>
        </div>
      ) : notifications.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-10 text-center">
          <Bell className="w-8 h-8 text-gray-300 mx-auto" />
          <p className="mt-3 text-sm font-medium text-gray-700">No notifications</p>
          <p className="mt-1 text-sm text-gray-500">New store activity and system events will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
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
