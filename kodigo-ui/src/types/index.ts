// ─── Auth & Stores ─────────────────────────────────────────────────────────────

export interface Store {
  id: string;
  name: string;
  address: string;
  taxRate: number;
}

export interface StoreUser {
  id: string;
  storeId: string;
  profileId: string;
  store: Store;
}

export type UserRole = 'admin' | 'cashier' | 'super_admin';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatarUrl?: string;
  passwordHash?: string;
  storeId?: string;
}

// ─── Products & Inventory ────────────────────────────────────────────────────

export interface Category {
  id: string;
  name: string;
}

export interface Supplier {
  id: string;
  storeId: string;
  name: string;
  contact: string;
  email: string;
  phone: string;
  address: string;
  leadTimeDays: number;
  reliabilityScore: number; // 0–100
  priceScore: number;       // 0–100
  overallScore: number;     // computed
  totalOrders: number;
  onTimeDeliveries: number;
  createdAt: string;
}

export interface Product {
  id: string;
  storeId: string;
  name: string;
  sku: string;
  barcode?: string;
  categoryId: string;
  categoryName: string;
  /** The unit shown on POS and sold to the customer (e.g. "piece", "stick", "sachet") */
  unit: string;
  /**
   * The unit used when purchasing from a supplier (e.g. "pack", "box", "tray").
   * Only set when the selling unit differs from the purchase unit.
   */
  purchaseUnit?: string;
  /**
   * How many selling units are in one purchase unit.
   * e.g. 20 sticks per pack → conversionFactor = 20.
   * Defaults to 1 (no conversion needed) when purchaseUnit is not set.
   */
  conversionFactor?: number;
  costPrice: number;
  sellingPrice: number;
  currentStock: number;
  minStockLevel: number;
  safetyStock: number;
  reorderLevel: number;
  leadTimeDays: number;
  supplierId?: string;
  supplierName?: string;
  imageUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export type StockStatus = 'in-stock' | 'low' | 'critical' | 'out-of-stock' | 'overstock';

export function getStockStatus(product: Product): StockStatus {
  if (product.currentStock === 0) return 'out-of-stock';
  if (product.currentStock <= product.safetyStock) return 'critical';
  if (product.currentStock <= product.minStockLevel) return 'low';
  if (product.currentStock > product.minStockLevel * 3) return 'overstock';
  return 'in-stock';
}

// ─── Cart ────────────────────────────────────────────────────────────────────

export interface CartItem {
  product: Product;
  quantity: number;
  lineTotal: number;
}

// ─── Sales ───────────────────────────────────────────────────────────────────

export interface SaleItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Sale {
  id: string;
  storeId: string;
  items: SaleItem[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  cashReceived: number;
  change: number;
  cashierId: string | null;
  cashierName: string;
  createdAt: string;
}

// ─── Stock Alerts ────────────────────────────────────────────────────────────

export interface StockAlert {
  id: string;
  storeId: string;
  productId: string;
  productName: string;
  type: 'low' | 'critical' | 'out-of-stock';
  currentStock: number;
  minStockLevel: number;
  isRead: boolean;
  createdAt: string;
}

// ─── Restocking ──────────────────────────────────────────────────────────────

export interface RestockItem {
  productId: string;
  storeId: string;
  productName: string;
  currentStock: number;
  suggestedQty: number;
  suggestedSupplierId: string;
  suggestedSupplierName: string;
  estimatedCost: number;
  urgency: 'high' | 'medium' | 'low';
  /** Selling unit (e.g. "stick", "piece") for display */
  unit?: string;
  /** Purchase unit when product is bought in bulk (e.g. "pack", "box") */
  purchaseUnit?: string;
  /** Conversion factor: selling units per purchase unit */
  conversionFactor?: number;
}

export interface PurchaseOrder {
  id: string;
  storeId: string;
  supplierId: string;
  supplierName: string;
  items: { productId: string; productName: string; quantity: number; unitCost: number }[];
  total: number;
  status: 'draft' | 'sent' | 'received' | 'cancelled';
  /** Set when status transitions to 'received' — drives reliability score */
  onTime?: boolean;
  /** ISO timestamp of when the PO was marked received */
  receivedAt?: string;
  createdAt: string;
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export interface RevenueDataPoint {
  date: string;
  revenue: number;
  profit: number;
  transactions: number;
}

export interface HourlySalesPoint {
  hour: string;
  sales: number;
}

export interface CategorySalesPoint {
  category: string;
  revenue: number;
  percentage: number;
}

export interface ProductRanking {
  rank: number;
  productId: string;
  productName: string;
  categoryName: string;
  unitsSold: number;
  revenue: number;
  percentageOfTotal: number;
}

// ─── Stock Adjustment ────────────────────────────────────────────────────────

export type AdjustmentReason = 'damaged' | 'expired' | 'lost' | 'manual-count' | 'restock' | 'other';

export interface StockAdjustment {
  id: string;
  storeId: string;
  productId: string;
  productName: string;
  reason: AdjustmentReason;
  quantityDelta: number;
  stockBefore: number;
  stockAfter: number;
  note: string;
  createdBy: string;
  createdAt: string;
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export interface DashboardStats {
  todayRevenue: number;
  todayTransactions: number;
  avgOrderValue: number;
  todayProfit: number;
  revenueChange: number;
  transactionsChange: number;
  avgOrderChange: number;
  profitChange: number;
}
