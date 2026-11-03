import { Link, Navigate } from 'react-router-dom';
import { Store } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StoresPosSettingsPage } from '@/pages/SettingsPage';

export function AdminDashboard({ children }: { children: React.ReactNode }) {
  const stores = useAuthStore((state) => state.stores);
  return stores.length === 0 ? <Navigate to="/setup" replace /> : children;
}

export function ProductStoreRequirement({ children }: { children: React.ReactNode }) {
  const { role, stores } = useAuthStore();
  if (role !== 'admin' || stores.length > 0) return children;

  return (
    <div>
      <PageHeader title="Product Management" subtitle="Set up your store to get started" />
      <Card>
        <EmptyState
          icon={Store}
          title="Create a store before adding products"
          description="Products belong to a store so Kodigo can track its stock, prices, and sales. Create your first store, then add your products."
          action={<Button asChild><Link to="/setup">Create your first store</Link></Button>}
        />
      </Card>
    </div>
  );
}

export function StoreSetupPage() {
  const stores = useAuthStore((state) => state.stores);
  const hasStore = stores.length > 0;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader title="Set up your store" subtitle="Create a store, then add the products you sell." />
      <ol aria-label="Store setup progress" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--muted-foreground)]">
        <li aria-current={!hasStore ? 'step' : undefined}>1. Create your store{hasStore ? ' — Complete' : ''}</li>
        <li aria-current={hasStore ? 'step' : undefined}>2. Add your first products</li>
      </ol>
      {hasStore ? (
        <Card>
          <EmptyState
            icon={Store}
            title="Your store is ready"
            description="Next, add the products you sell with their prices and opening stock. You can manage stores, branding, and hardware later in Settings → Stores & POS."
            action={<Button asChild><Link to="/inventory/products/new">Add your first product</Link></Button>}
          />
          <div className="pb-6 text-center">
            <Button asChild variant="link"><Link to="/inventory">Go to Product Management</Link></Button>
          </div>
        </Card>
      ) : <StoresPosSettingsPage setup />}
    </div>
  );
}
