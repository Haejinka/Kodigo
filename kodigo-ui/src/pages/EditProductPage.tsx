import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { ProductForm } from '@/components/inventory/ProductForm';
import { Button } from '@/components/shared/Button';
import { useProductStore } from '@/stores/productStore';
import { useSupplierStore } from '@/stores/supplierStore';
import { EmptyState } from '@/components/shared/EmptyState';
import { PackageSearch } from 'lucide-react';
import type { Product } from '@/types';

type ProductFormData = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'categoryName' | 'supplierName'>;

export function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const product = useProductStore((s) => s.products.find((p) => p.id === id));
  const updateProduct = useProductStore((s) => s.updateProduct);
  const suppliers = useSupplierStore((s) => s.suppliers);

  const handleSubmit = async (data: ProductFormData) => {
    if (!id) return;
    await new Promise((r) => setTimeout(r, 600));
    const supplierName = suppliers.find((s) => s.id === data.supplierId)?.name;
    await updateProduct(id, data, supplierName);
  };

  if (!product) {
    return (
      <div className="pt-12">
        <EmptyState icon={PackageSearch} title="Product not found" description="The product you're looking for doesn't exist." />
      </div>
    );
  }

  return (
    <div className="max-w-7xl">
      <PageHeader
        title={`Edit: ${product.name}`}
        subtitle={`SKU: ${product.sku}`}
        actions={
          <Button variant="ghost" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => navigate('/inventory')}>
            Back to Inventory
          </Button>
        }
      />
      <ProductForm mode="edit" initial={product} onSubmit={handleSubmit} />
    </div>
  );
}
