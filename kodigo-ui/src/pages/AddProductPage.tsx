import { PageHeader } from '@/components/layout/PageHeader';
import { ProductForm } from '@/components/inventory/ProductForm';
import { useProductStore } from '@/stores/productStore';
import { useSupplierStore } from '@/stores/supplierStore';
import type { Product } from '@/types';

type ProductFormData = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'categoryName' | 'supplierName'>;

export function AddProductPage() {
  const addProduct = useProductStore((s) => s.addProduct);
  const suppliers = useSupplierStore((s) => s.suppliers);

  const handleSubmit = async (data: ProductFormData) => {
    await new Promise((r) => setTimeout(r, 600));
    const supplierName = suppliers.find((s) => s.id === data.supplierId)?.name;
    const created = await addProduct(data, supplierName);
    if (!created) {
      throw new Error('Failed to create product. Please select a specific store.');
    }
  };

  return (
    <div className="max-w-7xl">
      <PageHeader
        title="Add Product"
        subtitle="Create a new product in your inventory without leaving the screen"
      />
      <ProductForm mode="create" onSubmit={handleSubmit} />
    </div>
  );
}
