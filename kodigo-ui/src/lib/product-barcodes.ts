import { getDefaultSellingOption, getProductSellingOptions } from '../types/index.ts';
import type { Product, ProductSellingOption } from '../types/index.ts';

export const normalizeBarcode = (value?: string | null): string => value?.trim() ?? '';

/** Resolve the option before checking stock, so a scan never falls back to another unit. */
export function findBarcodeMatch(products: Product[], value: string): { product: Product; option: ProductSellingOption } | undefined {
  const barcode = normalizeBarcode(value);
  if (!barcode) return;
  for (const product of products) {
    if (product.isActive === false) continue;
    if (normalizeBarcode(product.barcode) === barcode) {
      return { product, option: getDefaultSellingOption(product) };
    }
    const option = getProductSellingOptions(product).find((candidate) => normalizeBarcode(candidate.barcode) === barcode);
    if (option) return { product, option };
  }
}

/** Keys match the form's product field and bundle-card fields. */
export function validateProductBarcodes(
  data: Pick<Product, 'storeId' | 'barcode' | 'sellingOptions' | 'bulkPurchaseEnabled'>,
  products: Product[],
  productId?: string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const used = new Set<string>();
  for (const product of products) {
    if (product.storeId !== data.storeId || product.id === productId) continue;
    const main = normalizeBarcode(product.barcode);
    if (main) used.add(main);
    for (const option of product.sellingOptions ?? []) {
      const code = normalizeBarcode(option.barcode);
      if (option.isActive && code) used.add(code);
    }
  }
  const fields = [{ key: 'barcode', barcode: data.barcode }];
  // Base units use the product's main barcode; only bundle cards have their own field.
  if (data.bulkPurchaseEnabled) {
    data.sellingOptions.filter((option) => option.isBulk && option.isActive).forEach((option, index) => {
      fields.push({ key: `bulk-${index}-barcode`, barcode: option.barcode });
    });
  }
  const firstField = new Map<string, string>();
  for (const field of fields) {
    const code = normalizeBarcode(field.barcode);
    if (!code) continue;
    if (used.has(code)) errors[field.key] = 'This barcode is already assigned in this store.';
    const previous = firstField.get(code);
    if (previous) {
      errors[previous] = errors[field.key] = 'Use a different barcode for each selling option.';
    } else firstField.set(code, field.key);
  }
  return errors;
}
