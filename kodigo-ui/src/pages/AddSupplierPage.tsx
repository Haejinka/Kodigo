import { PageHeader } from '@/components/layout/PageHeader';
import { SupplierForm } from '@/components/suppliers/SupplierForm';
import { useSupplierStore } from '@/stores/supplierStore';
import type { SupplierFormData } from '@/stores/supplierStore';

export function AddSupplierPage() {
  const addSupplier = useSupplierStore((s) => s.addSupplier);

  const handleSubmit = async (data: SupplierFormData) => {
    await new Promise((r) => setTimeout(r, 600));
    try { await addSupplier(data); } catch(e) { window.alert(e.message || JSON.stringify(e)); }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Add Supplier"
        subtitle="Register a new supplier for your products"
      />
      <SupplierForm mode="create" onSubmit={handleSubmit} />
    </div>
  );
}
