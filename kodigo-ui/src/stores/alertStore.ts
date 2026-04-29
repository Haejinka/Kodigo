import { create } from 'zustand';
import type { StockAlert } from '@/types';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from './authStore';

interface AlertState {
  alerts: StockAlert[];
  unreadCount: number;
  fetchAlerts: () => Promise<void>;
  markRead: (alertId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export const useAlertStore = create<AlertState>((set) => ({
  alerts: [],
  unreadCount: 0,

  fetchAlerts: async () => {
    const storeId = useAuthStore.getState().activeStoreId;
    if (!storeId || storeId === 'all') return;

    const { data, error } = await supabase
      .from('stock_alerts')
      .select(`
        id, product_id, selling_option_id, selling_option_label, unit_label, package_size, package_unit, type, current_stock, min_stock_level, is_read, created_at,
        products!inner (name)
      `)
      .eq('store_id', storeId)
      .order('created_at', { ascending: false });

    if (!error && data) {
      const mapped: StockAlert[] = data.map((a: any) => ({
        id: a.id,
        storeId,
        productId: a.product_id,
        productName: a.products?.name || 'Unknown',
        sellingOptionId: a.selling_option_id || undefined,
        sellingOptionLabel: a.selling_option_label || undefined,
        unitLabel: a.unit_label || undefined,
        packageSize: a.package_size == null ? undefined : Number(a.package_size),
        packageUnit: a.package_unit || undefined,
        type: a.type as 'low' | 'critical' | 'out-of-stock',
        currentStock: a.current_stock,
        minStockLevel: a.min_stock_level,
        isRead: a.is_read,
        createdAt: a.created_at,
      }));
      set({ alerts: mapped, unreadCount: mapped.filter((a) => !a.isRead).length });
    }
  },

  markRead: async (alertId: string) => {
    // Optimistic update
    set((state) => {
      const alerts = state.alerts.map((a) =>
        a.id === alertId ? { ...a, isRead: true } : a
      );
      return { alerts, unreadCount: alerts.filter((a) => !a.isRead).length };
    });

    // Supabase update
    if (navigator.onLine) {
      await supabase.from('stock_alerts').update({ is_read: true }).eq('id', alertId);
    }
  },

  markAllRead: async () => {
    const storeId = useAuthStore.getState().activeStoreId;
    if (!storeId || storeId === 'all') return;

    // Optimistic
    set((state) => ({
      alerts: state.alerts.map((a) => ({ ...a, isRead: true })),
      unreadCount: 0,
    }));

    if (navigator.onLine) {
      await supabase.from('stock_alerts').update({ is_read: true }).eq('store_id', storeId).eq('is_read', false);
    }
  },
}));
