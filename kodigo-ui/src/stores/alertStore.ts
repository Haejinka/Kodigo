import { create } from 'zustand';
import type { AppNotification, NotificationSeverity, StockAlert } from '@/types';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from './authStore';

interface NotificationRow {
  id: string;
  store_id: string | null;
  type: string;
  severity: string;
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  source_table: string | null;
  source_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  product_id: string | null;
  product_name: string | null;
  selling_option_id: string | null;
  selling_option_label: string | null;
  unit_label: string | null;
  package_size: number | string | null;
  package_unit: string | null;
  current_stock: number | string | null;
  threshold: number | string | null;
  is_read: boolean | null;
  read_at: string | null;
  dismissed_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

interface AlertState {
  notifications: AppNotification[];
  alerts: StockAlert[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
  fetchNotifications: () => Promise<void>;
  fetchAlerts: () => Promise<void>;
  markRead: (notificationId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  dismiss: (notificationId: string) => Promise<void>;
}

const stockNotificationTypes = new Set(['low_stock', 'out_of_stock']);

const toNumber = (value: number | string | null | undefined): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const getStoreRpcParam = () => {
  const storeId = useAuthStore.getState().activeStoreId;
  return storeId && storeId !== 'all' ? storeId : null;
};

const normalizeSeverity = (severity: string | null | undefined): NotificationSeverity => {
  if (severity === 'success' || severity === 'warning' || severity === 'critical' || severity === 'error') {
    return severity;
  }
  return 'info';
};

const mapNotificationRow = (row: NotificationRow): AppNotification => ({
  id: row.id,
  storeId: row.store_id ?? undefined,
  type: row.type,
  severity: normalizeSeverity(row.severity),
  title: row.title,
  message: row.message,
  metadata: row.metadata ?? {},
  sourceTable: row.source_table ?? undefined,
  sourceId: row.source_id ?? undefined,
  entityType: row.entity_type ?? undefined,
  entityId: row.entity_id ?? undefined,
  productId: row.product_id ?? undefined,
  productName: row.product_name ?? undefined,
  sellingOptionId: row.selling_option_id ?? undefined,
  sellingOptionLabel: row.selling_option_label ?? undefined,
  unitLabel: row.unit_label ?? undefined,
  packageSize: toNumber(row.package_size),
  packageUnit: row.package_unit ?? undefined,
  currentStock: toNumber(row.current_stock),
  threshold: toNumber(row.threshold),
  isRead: Boolean(row.is_read),
  readAt: row.read_at ?? undefined,
  dismissedAt: row.dismissed_at ?? undefined,
  resolvedAt: row.resolved_at ?? undefined,
  createdAt: row.created_at,
});

const metadataText = (metadata: Record<string, unknown>, key: string): string | undefined => {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
};

const toStockAlert = (notification: AppNotification): StockAlert | null => {
  if (!stockNotificationTypes.has(notification.type) || !notification.productId || notification.resolvedAt) {
    return null;
  }

  const productName = notification.productName ?? metadataText(notification.metadata, 'productName') ?? notification.title;
  const currentStock = notification.currentStock ?? Number(notification.metadata.currentStock ?? 0);
  const minStockLevel = notification.threshold ?? Number(notification.metadata.threshold ?? 0);

  return {
    id: notification.id,
    storeId: notification.storeId ?? '',
    productId: notification.productId,
    productName,
    sellingOptionId: notification.sellingOptionId,
    sellingOptionLabel: notification.sellingOptionLabel ?? metadataText(notification.metadata, 'sellingOptionLabel'),
    unitLabel: notification.unitLabel ?? metadataText(notification.metadata, 'unitLabel'),
    packageSize: notification.packageSize,
    packageUnit: notification.packageUnit ?? metadataText(notification.metadata, 'packageUnit'),
    type: notification.type === 'out_of_stock'
      ? 'out-of-stock'
      : notification.severity === 'critical'
        ? 'critical'
        : 'low',
    currentStock: Number.isFinite(currentStock) ? currentStock : 0,
    minStockLevel: Number.isFinite(minStockLevel) ? minStockLevel : 0,
    isRead: notification.isRead,
    createdAt: notification.createdAt,
  };
};

const deriveStockAlerts = (notifications: AppNotification[]) =>
  notifications
    .map(toStockAlert)
    .filter((alert): alert is StockAlert => Boolean(alert));

const refreshUnreadCount = async () => {
  const { data, error } = await supabase.rpc('get_unread_notification_count', {
    p_store_id: getStoreRpcParam(),
  });
  if (error) throw error;
  return Number(data ?? 0);
};

export const useAlertStore = create<AlertState>((set, get) => ({
  notifications: [],
  alerts: [],
  unreadCount: 0,
  isLoading: false,
  error: null,

  fetchNotifications: async () => {
    const { isAuthenticated, user } = useAuthStore.getState();
    if (!isAuthenticated || !user) {
      set({ notifications: [], alerts: [], unreadCount: 0, isLoading: false, error: null });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const [{ data, error }, unreadCount] = await Promise.all([
        supabase.rpc('get_notifications', {
          p_store_id: getStoreRpcParam(),
          p_limit: 100,
        }),
        refreshUnreadCount(),
      ]);

      if (error) throw error;

      const notifications = ((data ?? []) as NotificationRow[]).map(mapNotificationRow);
      set({
        notifications,
        alerts: deriveStockAlerts(notifications),
        unreadCount,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load notifications.';
      console.error('Failed to load notifications:', err);
      set({ isLoading: false, error: message });
    }
  },

  fetchAlerts: async () => {
    await get().fetchNotifications();
  },

  markRead: async (notificationId: string) => {
    set((state) => {
      const notifications = state.notifications.map((notification) =>
        notification.id === notificationId
          ? { ...notification, isRead: true, readAt: notification.readAt ?? new Date().toISOString() }
          : notification
      );
      return {
        notifications,
        alerts: deriveStockAlerts(notifications),
        unreadCount: notifications.filter((notification) => !notification.isRead).length,
      };
    });

    try {
      const { error } = await supabase.rpc('mark_notification_read', {
        p_notification_id: notificationId,
      });
      if (error) throw error;
      await get().fetchNotifications();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to mark notification as read.';
      console.error('Failed to mark notification as read:', err);
      set({ error: message });
      await get().fetchNotifications();
    }
  },

  markAllRead: async () => {
    const now = new Date().toISOString();
    set((state) => {
      const notifications = state.notifications.map((notification) => (
        notification.isRead ? notification : { ...notification, isRead: true, readAt: now }
      ));
      return {
        notifications,
        alerts: deriveStockAlerts(notifications),
        unreadCount: 0,
      };
    });

    try {
      const { error } = await supabase.rpc('mark_all_notifications_read', {
        p_store_id: getStoreRpcParam(),
      });
      if (error) throw error;
      await get().fetchNotifications();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to mark notifications as read.';
      console.error('Failed to mark all notifications as read:', err);
      set({ error: message });
      await get().fetchNotifications();
    }
  },

  dismiss: async (notificationId: string) => {
    set((state) => {
      const notifications = state.notifications.filter((notification) => notification.id !== notificationId);
      return {
        notifications,
        alerts: deriveStockAlerts(notifications),
        unreadCount: notifications.filter((notification) => !notification.isRead).length,
      };
    });

    try {
      const { error } = await supabase.rpc('dismiss_notification', {
        p_notification_id: notificationId,
      });
      if (error) throw error;
      await get().fetchNotifications();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to dismiss notification.';
      console.error('Failed to dismiss notification:', err);
      set({ error: message });
      await get().fetchNotifications();
    }
  },
}));
