import { PageHeader } from '@/components/layout/PageHeader';
import { ProductForm } from '@/components/inventory/ProductForm';
import { useProductStore } from '@/stores/productStore';
import type { Product } from '@/types';

type ProductFormData = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'categoryName' | 'supplierName'>;

export function AddProductPage() {
  const addProduct = useProductStore((s) => s.addProduct);

  const handleSubmit = async (data: ProductFormData) => {
    await new Promise((r) => setTimeout(r, 600));
    addProduct(data);
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Add Product"
        subtitle="Create a new product in your inventory"
      />
      <ProductForm mode="create" onSubmit={handleSubmit} />
    </div>
  );
}
