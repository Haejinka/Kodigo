export type ShoppingListPaperProfile = '58mm' | '80mm';

export interface ShoppingListLineV1 {
  readonly productId: string;
  readonly productName: string;
  readonly quantity: number;
  readonly purchaseUnit: string;
  readonly unitPrice: number;
  readonly subtotal: number;
  readonly isEstimated: boolean;
}

export interface ShoppingListSnapshotV1 {
  readonly version: 1;
  readonly documentId: string;
  readonly createdAt: string;
  readonly storeId: string;
  readonly storeName: string;
  readonly items: readonly ShoppingListLineV1[];
  readonly total: number;
}

export interface ShoppingListDraftLine {
  productId: string;
  productName: string;
  quantity: number;
  purchaseUnit: string;
  subtotal: number;
  isEstimated: boolean;
}

export interface CreateShoppingListSnapshotOptions {
  documentId?: string;
  createdAt?: string;
}
