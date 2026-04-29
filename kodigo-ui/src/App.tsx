import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { ToastProvider } from '@/components/shared/Toast';
import { AppShell } from '@/components/layout/AppShell';
import { useAuthStore } from '@/stores/authStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { syncPendingMutations, syncPendingSales } from '@/lib/offline-sync';
import { installGlobalErrorLogging } from '@/lib/error-logging';

import { useProductStore } from '@/stores/productStore';
import { useSupplierStore } from '@/stores/supplierStore';
import { useAlertStore } from '@/stores/alertStore';

// Pages
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { SuperAdminPage } from '@/pages/SuperAdminPage';
import { POSPage } from '@/pages/POSPage';
import { InventoryPage } from '@/pages/InventoryPage';
import { AddProductPage } from '@/pages/AddProductPage';
import { EditProductPage } from '@/pages/EditProductPage';
import { RestockingPage } from '@/pages/RestockingPage';
import { SuppliersPage } from '@/pages/SuppliersPage';
import { SupplierDetailPage } from '@/pages/SupplierDetailPage';
import { AnalyticsPage } from '@/pages/AnalyticsPage';
import { RankingsPage } from '@/pages/RankingsPage';
import { AddSupplierPage } from '@/pages/AddSupplierPage';
import { EditSupplierPage } from '@/pages/EditSupplierPage';
import {
  SettingsLayout,
  GeneralSettingsPage,
  UserManagementPage,
  NotificationsSettingsPage,
  SecuritySettingsPage,
} from '@/pages/SettingsPage';

// Route guards
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, role } = useAuthStore();

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!role) return (
    <div className="min-h-screen flex flex-col items-center justify-center space-y-4 text-red-600 font-medium">
      <p>Error: User role could not be verified. Please contact system administrator.</p>
      <button
        onClick={() => useAuthStore.getState().logout()}
        className="px-6 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition"
      >
        Log Out to Reset Session
      </button>
    </div>
  );
  return <>{children}</>;
}

// Require true admin (managerial)
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.role);
  if (role !== 'admin') {
    if (role === 'super_admin') return <Navigate to="/super-admin" replace />;
    return <Navigate to="/pos" replace />;
  }
  return <>{children}</>;
}

// Require super admin
function RequireSuperAdmin({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.role);
  if (role !== 'super_admin') {
    if (role === 'admin') return <Navigate to="/dashboard" replace />;
    return <Navigate to="/pos" replace />;
  }
  return <>{children}</>;
}

// Admins should use POS on desktop only; redirect them away on mobile
function RequirePOSAccess({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.role);
  const isMobile = useIsMobile();

  // If super_admin, do not force them into POS
  if (role === 'super_admin') return <Navigate to="/super-admin" replace />;

  if (role === 'admin' && isMobile) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function DefaultAdminRoute() {
  const role = useAuthStore((s) => s.role);
  if (role === 'super_admin') return <Navigate to="/super-admin" replace />;
  return <Navigate to="/dashboard" replace />;
}

function AppRoutes() {
  const initialize = useAuthStore((s) => s.initialize);
  const activeStoreId = useAuthStore((s) => s.activeStoreId);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const fetchProducts = useProductStore((s) => s.fetchProducts);
  const fetchSuppliers = useSupplierStore((s) => s.fetchSuppliers);
  const fetchPurchaseOrders = useSupplierStore((s) => s.fetchPurchaseOrders);
  const fetchAlerts = useAlertStore((s) => s.fetchAlerts);

  const revalidateData = async () => {
    // Allow supplier and purchase order fetches even when no specific store is selected.
    if (!isAuthenticated) return;
    // Flush offline queues first so subsequent fetches include just-synced writes.
    await syncPendingSales();
    await syncPendingMutations();

    // Only fetch products when a specific store is selected
    if (activeStoreId) {
      fetchProducts();
    }

    // Suppliers and purchase orders can be global — fetch regardless of selected store
    fetchSuppliers();
    fetchPurchaseOrders();
    fetchAlerts();
  };

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    return installGlobalErrorLogging(() => {
      const storeId = useAuthStore.getState().activeStoreId;
      return storeId && storeId !== 'all' ? storeId : null;
    });
  }, []);

  useEffect(() => {
    void revalidateData();
  }, [activeStoreId, isAuthenticated, fetchProducts, fetchSuppliers, fetchPurchaseOrders, fetchAlerts]);

  useEffect(() => {
    const onFocus = () => { void revalidateData(); };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void revalidateData();
      }
    };
    const onOnline = () => { void revalidateData(); };
    const onPageShow = () => { void revalidateData(); };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);
    window.addEventListener('pageshow', onPageShow);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [activeStoreId, isAuthenticated, fetchProducts, fetchSuppliers, fetchPurchaseOrders, fetchAlerts]);

  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* POS — no sidebar shell; admin blocked on mobile */}
      <Route
        path="/pos"
        element={
          <RequireAuth>
            <RequirePOSAccess>
              <POSPage />
            </RequirePOSAccess>
          </RequireAuth>
        }
      />

      {/* Super Admin Area */}
      <Route
        path="/super-admin/*"
        element={
          <RequireAuth>
            <RequireSuperAdmin>
              <AppShell>
                <Routes>
                  <Route path="/" element={<SuperAdminPage />} />
                  <Route path="*" element={<Navigate to="/super-admin" replace />} />
                </Routes>
              </AppShell>
            </RequireSuperAdmin>
          </RequireAuth>
        }
      />

      {/* Admin pages wrapped in AppShell */}
      <Route
        path="/*"
        element={
          <RequireAuth>
            <RequireAdmin>
              <AppShell>
                <Routes>
                  <Route path="/" element={<DefaultAdminRoute />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/inventory" element={<InventoryPage />} />
                  <Route path="/inventory/products/new" element={<AddProductPage />} />
                  <Route path="/inventory/products/:id" element={<EditProductPage />} />
                  <Route path="/restocking" element={<RestockingPage />} />
                  <Route path="/suppliers" element={<SuppliersPage />} />
                  <Route path="/suppliers/new" element={<AddSupplierPage />} />
                  <Route path="/suppliers/:id" element={<SupplierDetailPage />} />
                  <Route path="/suppliers/:id/edit" element={<EditSupplierPage />} />
                  <Route path="/analytics" element={<AnalyticsPage />} />
                  <Route path="/rankings" element={<RankingsPage />} />
                  <Route path="/settings" element={<SettingsLayout />}>
                    <Route index element={<GeneralSettingsPage />} />
                    <Route path="users" element={<UserManagementPage />} />
                    <Route path="notifications" element={<NotificationsSettingsPage />} />
                    <Route path="security" element={<SecuritySettingsPage />} />
                  </Route>
                </Routes>
              </AppShell>
            </RequireAdmin>
          </RequireAuth>
        }
      />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AppRoutes />
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
