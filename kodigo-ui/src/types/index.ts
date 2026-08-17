// ─── Auth & Stores ─────────────────────────────────────────────────────────────

export interface Store {
  id: string;
  name: string;
  address: string;
  taxRate: number;
  registeredName?: string;
  businessName?: string;
  tin?: string;
  branchCode?: string;
  vatStatus: 'vat' | 'non_vat';
  documentLabel: string;
  terminalIdentifier?: string;
  birRegistrationInfo?: string;
  accreditationInfo?: string;
  permitInfo?: string;
  invoicePrefix: string;
  logoPath?: string;
  phone?: string;
  email?: string;
}

export interface StoreUser {
  id: string;
  storeId: string;
  profileId: string;
  store: Store;
}

export type UserRole = 'admin' | 'cashier' | 'inventory' | 'super_admin';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatarUrl?: string;
  passwordHash?: string;
  storeId?: string;
  storeIds?: string[];
  storeNames?: string[];
}

// ─── Products & Inventory ────────────────────────────────────────────────────

export interface Category {
  id: string;
  name: string;
}

export interface Supplier {
  id: string;
  storeId: string;
  storeIds: string[];
  storeNames: string[];
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

export type SellingOptionKind = 'unit' | 'kilo' | 'sack' | 'custom';

export interface ProductSellingOption {
  id: string;
  productId: string;
  storeId: string;
  kind: SellingOptionKind;
  label: string;
  unitLabel: string;
  quantityValue?: number;
  quantityUnit?: string;
  stockQuantity: number;
  sellingPrice: number;
  lowStockThreshold: number;
  /** Number of base pieces removed when one of this option is sold. */
  inventoryMultiplier: number;
  /** When true, availability comes from the product's base-piece stock. */
  sharesBaseStock: boolean;
  isDefault: boolean;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
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
  /** Supplier price for one configured purchase unit (case/pack/box). */
  bulkPurchasePrice?: number;
  autoPricingEnabled?: boolean;
  /** Desired gross margin percentage (profit divided by selling price). */
  marginPercentage?: number;
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
  sellingOptions: ProductSellingOption[];
  createdAt: string;
  updatedAt: string;
}

export type StockStatus = 'in-stock' | 'low' | 'critical' | 'out-of-stock' | 'overstock';

export function getStockStatus(product: Product, option?: ProductSellingOption): StockStatus {
  const currentStock = option ? option.stockQuantity : product.currentStock;
  const minStockLevel = option ? option.lowStockThreshold : product.minStockLevel;
  const safetyStock = option ? Math.min(option.lowStockThreshold, product.safetyStock) : product.safetyStock;
  if (currentStock === 0) return 'out-of-stock';
  if (currentStock <= safetyStock) return 'critical';
  if (currentStock <= minStockLevel) return 'low';
  if (currentStock > minStockLevel * 3) return 'overstock';
  return 'in-stock';
}

const formatQty = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');

export function buildLegacySellingOption(product: Product): ProductSellingOption {
  return {
    id: `legacy-${product.id}`,
    productId: product.id,
    storeId: product.storeId,
    kind: product.unit === 'kg' ? 'kilo' : 'unit',
    label: product.unit,
    unitLabel: product.unit,
    quantityValue: product.unit === 'kg' ? 1 : undefined,
    quantityUnit: product.unit === 'kg' ? 'kg' : undefined,
    stockQuantity: product.currentStock,
    sellingPrice: product.sellingPrice,
    lowStockThreshold: product.minStockLevel,
    inventoryMultiplier: 1,
    sharesBaseStock: true,
    isDefault: true,
    isActive: true,
  };
}

export function getOptionInventoryMultiplier(option: ProductSellingOption): number {
  return option.sharesBaseStock ? Math.max(1, Number(option.inventoryMultiplier) || 1) : 1;
}

export function getAvailableSellingUnits(product: Product, option: ProductSellingOption): number {
  if (!option.sharesBaseStock) return Math.max(0, option.stockQuantity);
  return Math.floor(Math.max(0, product.currentStock) / getOptionInventoryMultiplier(option));
}

export function getOptionPurchaseCost(product: Product, option: ProductSellingOption): number {
  return product.costPrice * getOptionInventoryMultiplier(option);
}

export function getProductSellingOptions(product: Product): ProductSellingOption[] {
  const activeOptions = (product.sellingOptions || []).filter((option) => option.isActive);
  return activeOptions.length > 0 ? activeOptions : [buildLegacySellingOption(product)];
}

export function getDefaultSellingOption(product: Product): ProductSellingOption {
  const options = getProductSellingOptions(product);
  return options.find((option) => option.isDefault) ?? options[0];
}

export function isLegacySellingOption(option: ProductSellingOption): boolean {
  return option.id.startsWith('legacy-');
}

export function getSellingOptionLabel(option: ProductSellingOption): string {
  if (option.label.trim()) return option.label.trim();
  if (option.kind === 'sack' && option.quantityValue) {
    return `${formatQty(option.quantityValue)} ${option.quantityUnit || ''} ${option.unitLabel}`.trim();
  }
  return option.unitLabel;
}

export function getSellingOptionStockLabel(option: ProductSellingOption): string {
  const qty = formatQty(option.stockQuantity);
  if (option.kind === 'sack') return `${qty} ${option.unitLabel}${option.stockQuantity === 1 ? '' : 's'}`;
  return `${qty} ${option.unitLabel}`;
}

export function getProductOptionStockLabel(product: Product, option: ProductSellingOption): string {
  const available = getAvailableSellingUnits(product, option);
  const qty = formatQty(available);
  return `${qty} ${option.unitLabel}${available === 1 ? '' : 's'}`;
}

export function getSaleItemUnitLabel(item: Pick<SaleItem, 'unitLabel' | 'packageSize' | 'packageUnit'>): string {
  if (item.packageSize) {
    return `${item.unitLabel}, ${formatQty(item.packageSize)} ${item.packageUnit || ''}`.trim();
  }
  return item.unitLabel || 'unit';
}

// ─── Cart ────────────────────────────────────────────────────────────────────

export interface CartItem {
  id: string;
  product: Product;
  sellingOption: ProductSellingOption;
  quantity: number;
  lineTotal: number;
}

// ─── Sales ───────────────────────────────────────────────────────────────────

export interface SaleItem {
  id?: string;
  productId: string;
  productName: string;
  categoryName?: string;
  sellingOptionId?: string;
  sellingOptionLabel?: string;
  unitLabel?: string;
  packageSize?: number;
  packageUnit?: string;
  stockSource?: string;
  quantity: number;
  unitPrice: number;
  costPrice?: number;
  lineTotal: number;
}

export type PaymentMethod = 'cash' | 'gcash' | 'card' | 'bank_transfer' | 'other';
export type DiscountType = 'amount' | 'percent';
export type SaleStatus = 'completed' | 'voided' | 'partially_refunded' | 'refunded';

export interface Sale {
  id: string;
  storeId: string;
  items: SaleItem[];
  subtotal: number;
  tax: number;
  taxRate: number;
  discount: number;
  discountType: DiscountType;
  discountValue: number;
  total: number;
  cashReceived: number;
  change: number;
  paymentMethod: PaymentMethod;
  paymentReference?: string;
  receiptNumber?: string;
  customerName?: string;
  customerTin?: string;
  customerAddress?: string;
  terminalIdentifier?: string;
  discountCategory?: 'regular' | 'senior' | 'pwd' | 'other';
  status?: SaleStatus;
  cashierId: string | null;
  cashierName: string;
  createdAt: string;
}

export interface SaleRecord {
  id: string;
  storeId: string;
  cashierId: string | null;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  cashReceived: number;
  change: number;
  paymentMethod: PaymentMethod;
  paymentReference?: string;
  discountType: DiscountType;
  discountValue: number;
  taxRate: number;
  receiptNumber?: string;
  customerName?: string;
  customerTin?: string;
  customerAddress?: string;
  terminalIdentifier?: string;
  discountCategory?: 'regular' | 'senior' | 'pwd' | 'other';
  status: SaleStatus;
  createdAt: string;
}

export interface ReceiptStoreSnapshot {
  id: string;
  name: string;
  registeredName: string;
  businessName: string;
  address: string;
  tin?: string;
  branchCode?: string;
  vatStatus: 'vat' | 'non_vat';
  taxRate: number;
  documentLabel: string;
  terminalIdentifier?: string;
  birRegistrationInfo?: string;
  accreditationInfo?: string;
  permitInfo?: string;
  logoPath?: string;
  phone?: string;
  email?: string;
}

export interface ReceiptSnapshot {
  version: number;
  sale: Record<string, unknown> & {
    id: string;
    receipt_number?: string;
    created_at: string;
    payment_method?: PaymentMethod;
    payment_reference?: string;
    status?: SaleStatus;
  };
  store: ReceiptStoreSnapshot;
  cashier: { id?: string; name: string };
  customer: { name?: string; tin?: string; address?: string };
  items: Array<Record<string, unknown> & {
    id?: string;
    product_name: string;
    selling_option_label?: string;
    unit_label?: string;
    package_size?: number;
    package_unit?: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }>;
  payment: Record<string, unknown> & {
    method?: PaymentMethod;
    amount_tendered?: number;
    change_amount?: number;
    reference_number?: string;
  };
  totals: {
    subtotal: number;
    discount: number;
    discountType?: DiscountType;
    discountValue?: number;
    discountCategory?: 'regular' | 'senior' | 'pwd' | 'other';
    vatableSales: number;
    vatAmount: number;
    vatExemptSales: number;
    zeroRatedSales: number;
    nonVatSales: number;
    total: number;
    amountTendered: number;
    change: number;
  };
}

export interface ReceiptRecord {
  id: string;
  saleId: string;
  storeId: string;
  receiptNumber: string;
  issuedBy?: string;
  issuedAt: string;
  payload: ReceiptSnapshot;
}

export interface CashierCloseout {
  id: string;
  storeId: string;
  cashierId: string;
  periodStart: string;
  periodEnd: string;
  openingCash: number;
  cashSales: number;
  cashRefunds: number;
  expectedCash: number;
  countedCash: number;
  variance: number;
  notes: string;
  createdAt: string;
}

// ─── Stock Alerts ────────────────────────────────────────────────────────────

export interface StockAlert {
  id: string;
  storeId: string;
  productId: string;
  productName: string;
  sellingOptionId?: string;
  sellingOptionLabel?: string;
  unitLabel?: string;
  packageSize?: number;
  packageUnit?: string;
  type: 'low' | 'critical' | 'out-of-stock';
  currentStock: number;
  minStockLevel: number;
  isRead: boolean;
  createdAt: string;
}

export type NotificationType =
  | 'low_stock'
  | 'out_of_stock'
  | 'stock_adjustment'
  | 'sack_conversion'
  | 'sale_completed'
  | 'sale_voided'
  | 'sale_refunded'
  | 'sale_returned'
  | 'report_export_completed'
  | 'report_export_failed'
  | 'system_error'
  | string;

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical' | 'error';

export interface AppNotification {
  id: string;
  storeId?: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  sourceTable?: string;
  sourceId?: string;
  entityType?: string;
  entityId?: string;
  productId?: string;
  productName?: string;
  sellingOptionId?: string;
  sellingOptionLabel?: string;
  unitLabel?: string;
  packageSize?: number;
  packageUnit?: string;
  currentStock?: number;
  threshold?: number;
  isRead: boolean;
  readAt?: string;
  dismissedAt?: string;
  resolvedAt?: string;
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

export type AdjustmentReason = 'damaged' | 'expired' | 'lost' | 'manual-count' | 'restock' | 'conversion' | 'other';

export interface StockAdjustment {
  id: string;
  storeId: string;
  productId: string;
  productName: string;
  sellingOptionId?: string;
  sellingOptionLabel?: string;
  unitLabel?: string;
  packageSize?: number;
  packageUnit?: string;
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
