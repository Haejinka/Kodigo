import { PageHeader } from '@/components/layout/PageHeader';
import { SupplierForm } from '@/components/suppliers/SupplierForm';
import { useSupplierStore } from '@/stores/supplierStore';
import type { SupplierFormData } from '@/stores/supplierStore';

export function AddSupplierPage() {
  const addSupplier = useSupplierStore((s) => s.addSupplier);

  const handleSubmit = async (data: SupplierFormData) => {
    await new Promise((r) => setTimeout(r, 600));
    await addSupplier(data);
  };

  return (
    <div className="max-w-7xl">
      <PageHeader
        title="Add Supplier"
        subtitle="Register a new supplier without leaving the screen"
      />
      <SupplierForm mode="create" onSubmit={handleSubmit} />
    </div>
  );
}
