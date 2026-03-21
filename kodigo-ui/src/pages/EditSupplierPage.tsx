import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/shared/Button';
import { EmptyState } from '@/components/shared/EmptyState';
import { SupplierForm } from '@/components/suppliers/SupplierForm';
import { useSupplierStore } from '@/stores/supplierStore';
import type { SupplierFormData } from '@/stores/supplierStore';

export function EditSupplierPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const supplier = useSupplierStore((s) => s.suppliers.find((sup) => sup.id === id));
  const updateSupplier = useSupplierStore((s) => s.updateSupplier);

  const handleSubmit = async (data: SupplierFormData) => {
    if (!id) return;
    await new Promise((r) => setTimeout(r, 600));
    updateSupplier(id, data);
  };

  if (!supplier) {
    return (
      <div className="pt-12">
        <EmptyState title="Supplier not found" description="The supplier you're looking for doesn't exist." />
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={`Edit: ${supplier.name}`}
        subtitle={`Contact: ${supplier.contact}`}
        actions={
          <Button
            variant="ghost"
            icon={<ArrowLeft className="w-4 h-4" />}
            onClick={() => navigate(`/suppliers/${id}`)}
          >
            Back to Supplier
          </Button>
        }
      />
      <SupplierForm
        mode="edit"
        initial={supplier}
        onSubmit={handleSubmit}
        backPath={`/suppliers/${id}`}
      />
    </div>
  );
}
