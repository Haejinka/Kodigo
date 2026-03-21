import { create } from 'zustand';
import type { StockAlert } from '@/types';
import { mockAlerts } from '@/lib/mock-data';

interface AlertState {
  alerts: StockAlert[];
  unreadCount: number;
  fetchAlerts: () => Promise<void>;
  markRead: (alertId: string) => void;
  markAllRead: () => void;
}

export const useAlertStore = create<AlertState>((set, get) => ({
  alerts: mockAlerts,
  unreadCount: mockAlerts.filter((a) => !a.isRead).length,

  fetchAlerts: async () => {
    await new Promise((r) => setTimeout(r, 300));
    const alerts = mockAlerts;
    set({ alerts, unreadCount: alerts.filter((a) => !a.isRead).length });
  },

  markRead: (alertId: string) => {
    set((state) => {
      const alerts = state.alerts.map((a) =>
        a.id === alertId ? { ...a, isRead: true } : a
      );
      return { alerts, unreadCount: alerts.filter((a) => !a.isRead).length };
    });
  },

  markAllRead: () => {
    set((state) => ({
      alerts: state.alerts.map((a) => ({ ...a, isRead: true })),
      unreadCount: 0,
    }));
    void get(); // prevent unused warning
  },
}));
