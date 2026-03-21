import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from '@/components/shared/Toast';
import { AppShell } from '@/components/layout/AppShell';
import { useAuthStore } from '@/stores/authStore';
import { useIsMobile } from '@/hooks/useIsMobile';

// Pages
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
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

// Route guard
function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.role);
  if (role !== 'admin') return <Navigate to="/pos" replace />;
  return <>{children}</>;
}

// Admins should use POS on desktop only; redirect them away on mobile
function RequirePOSAccess({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.role);
  const isMobile = useIsMobile();
  if (role === 'admin' && isMobile) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />

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

      {/* Admin pages — wrapped in AppShell */}
      <Route
        path="/*"
        element={
          <RequireAuth>
            <RequireAdmin>
              <AppShell>
                <Routes>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
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

