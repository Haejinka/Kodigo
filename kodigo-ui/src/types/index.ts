// ─── Auth & Stores ─────────────────────────────────────────────────────────────

export interface Store {
  id: string;
  ownerId?: string;
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
  facebookLink?: string;
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
export type BulkDiscountType = 'percent' | 'amount';
export type PricingMethod = 'fixed' | 'percent' | 'amount';
export type PurchaseMode = 'unit' | 'bulk';

export interface ProductRestockingOption {
  id: string;
  productId: string;
  storeId: string;
  label: string;
  conversionFactor: number;
  isDefault: boolean;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

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
  /** True when this option is a bulk purchase mode such as a case or pack. */
  isBulk?: boolean;
  /** Discount applied to the regular unit price multiplied by the package size. */
  discountType?: BulkDiscountType;
  discountValue?: number;
  /** Fixed is the simple default; percent/amount are the advanced discount modes. */
  pricingMethod?: PricingMethod;
  /** Price entered by the owner when pricingMethod is fixed. */
  manualSellingPrice?: number;
  isDefault: boolean;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Product {
  id: string;
  storeId: string;
  /** Archived products stay in history but are unavailable in active workflows. */
  isActive?: boolean;
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
  /** Enables bulk purchase modes in the POS. Stock is still stored in base units. */
  bulkPurchaseEnabled?: boolean;
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
  /** Primary supplier retained for existing restocking and reporting flows. */
  supplierId?: string;
  supplierName?: string;
  /** All suppliers that can provide this product, including the primary one. */
  supplierIds?: string[];
  imageUrl?: string;
  restockingOptions?: ProductRestockingOption[];
  /** Price increments used when suggesting a new price after a cost change. */
  priceRounding?: number;
  sellingOptions: ProductSellingOption[];
  createdAt: string;
  updatedAt: string;
}

export type StockStatus = 'in-stock' | 'low' | 'critical' | 'out-of-stock' | 'overstock';

export function getStockStatus(product: Product, option?: ProductSellingOption): StockStatus {
  const currentStock = option ? getAvailableSellingUnits(product, option) : product.currentStock;
  const multiplier = option ? getOptionInventoryMultiplier(option) : 1;
  const minStockLevel = option ? Math.floor(product.minStockLevel / multiplier) : product.minStockLevel;
  const safetyStock = option ? Math.floor(product.safetyStock / multiplier) : product.safetyStock;
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
  if (isBulkSellingOption(option)) {
    const configuredMultiplier = Number(option.inventoryMultiplier) || 0;
    const quantityValue = Number(option.quantityValue) || 0;
    return Math.max(1, configuredMultiplier > 1 ? configuredMultiplier : quantityValue || configuredMultiplier || 1);
  }
  return 1;
}

export function getAvailableSellingUnits(product: Product, option: ProductSellingOption): number {
  return Math.floor(Math.max(0, product.currentStock) / getOptionInventoryMultiplier(option));
}

export function getOptionPurchaseCost(product: Product, option: ProductSellingOption): number {
  return product.costPrice * getOptionInventoryMultiplier(option);
}

export function getOptionSellingPrice(product: Product, option: ProductSellingOption): number {
  if (!isBulkSellingOption(option)) return product.sellingPrice;
  const unitsPerPackage = getOptionUnitsPerPackage(option);
  const pricingMethod = option.pricingMethod
    ?? (option.discountType === 'amount' ? 'amount' : 'percent');
  if (pricingMethod === 'fixed') {
    return Math.max(0, Number(option.manualSellingPrice ?? option.sellingPrice) || 0);
  }
  return calculateBulkPrice(
    product.sellingPrice,
    unitsPerPackage,
    pricingMethod,
    option.discountValue,
  );
}

export function isBulkSellingOption(option: ProductSellingOption): boolean {
  return Boolean(
    option.isBulk
      ?? (option.inventoryMultiplier > 1 || Number(option.quantityValue) > 1)
  );
}

export function getOptionUnitsPerPackage(option: ProductSellingOption): number {
  return getOptionInventoryMultiplier(option);
}

export function calculateBulkPrice(
  unitPrice: number,
  unitsPerPackage: number,
  discountType: BulkDiscountType = 'percent',
  discountValue = 0,
): number {
  const regularValue = Math.max(0, Number(unitPrice) || 0) * Math.max(1, Number(unitsPerPackage) || 1);
  const discount = discountType === 'percent'
    ? regularValue * Math.min(100, Math.max(0, Number(discountValue) || 0)) / 100
    : Math.max(0, Number(discountValue) || 0);
  return Math.max(0, Math.round((regularValue - discount + Number.EPSILON) * 100) / 100);
}

export function getOptionRegularValue(product: Product, option: ProductSellingOption): number {
  return product.sellingPrice * getOptionUnitsPerPackage(option);
}

export function getOptionSavings(product: Product, option: ProductSellingOption): number {
  return Math.max(0, getOptionRegularValue(product, option) - getOptionSellingPrice(product, option));
}

export interface BulkPricingPreview {
  regularValue: number;
  bulkPrice: number;
  savings: number;
  savingsPercentage: number;
  effectiveUnitPrice: number;
}

export function getBulkPricingPreview(product: Product, option: ProductSellingOption): BulkPricingPreview {
  const regularValue = getOptionRegularValue(product, option);
  const bulkPrice = getOptionSellingPrice(product, option);
  const savings = Math.max(0, regularValue - bulkPrice);
  return {
    regularValue,
    bulkPrice,
    savings,
    savingsPercentage: regularValue > 0 ? (savings / regularValue) * 100 : 0,
    effectiveUnitPrice: getOptionUnitsPerPackage(option) > 0
      ? bulkPrice / getOptionUnitsPerPackage(option)
      : bulkPrice,
  };
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
  if (isBulkSellingOption(option)) {
    return `${qty} ${getSellingOptionLabel(option)}${available === 1 ? '' : 's'}`;
  }
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
  baseUnitLabel?: string;
  packageSize?: number;
  packageUnit?: string;
  stockSource?: string;
  purchaseMode?: PurchaseMode;
  bulkOptionId?: string;
  bulkOptionLabel?: string;
  bulkQuantity?: number;
  unitsPerPackage?: number;
  baseUnitQuantity?: number;
  regularUnitPrice?: number;
  regularValue?: number;
  bulkDiscountType?: BulkDiscountType;
  bulkDiscountValue?: number;
  bulkDiscountAmount?: number;
  finalSellingPrice?: number;
  costPerBaseUnit?: number;
  cogs?: number;
  grossProfit?: number;
  grossMargin?: number;
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
    base_unit_label?: string;
    package_size?: number;
    package_unit?: string;
    purchase_mode?: PurchaseMode;
    bulk_option_id?: string;
    bulk_option_label?: string;
    bulk_quantity?: number;
    units_per_package?: number;
    base_unit_quantity?: number;
    regular_unit_price?: number;
    regular_value?: number;
    bulk_discount_type?: BulkDiscountType;
    bulk_discount_value?: number;
    bulk_discount_amount?: number;
    final_selling_price?: number;
    cost_per_base_unit?: number;
    cogs?: number;
    gross_profit?: number;
    gross_margin?: number;
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
  suggestedBaseUnits?: number;
  suggestedPurchaseQty?: number;
  purchaseUnitCost?: number;
  urgency: 'high' | 'medium' | 'low';
  /** Selling unit (e.g. "stick", "piece") for display */
  unit?: string;
  /** Purchase unit when product is bought in bulk (e.g. "pack", "box") */
  purchaseUnit?: string;
  /** Conversion factor: selling units per purchase unit */
  conversionFactor?: number;
  restockingOptions?: ProductRestockingOption[];
}

export interface RestockResult {
  restockId: string;
  productId: string;
  purchaseUnit: string;
  quantityReceived: number;
  conversionFactor: number;
  baseUnitsAdded: number;
  stockBefore: number;
  stockAfter: number;
  totalSupplierCost?: number;
  previousCostPerBaseUnit: number;
  newCostPerBaseUnit: number;
  costChangePercent?: number;
  previousGrossMargin: number;
  newGrossMargin: number;
  currentSellingPrice: number;
  suggestedSellingPrice: number;
  rawSuggestedSellingPrice: number;
  priceRounding: number;
}

export interface PriceHistoryRecord {
  id: string;
  storeId: string;
  productId: string;
  productName: string;
  changeType: 'supplier_cost' | 'selling_price';
  previousValue: number;
  newValue: number;
  reason: string;
  createdBy?: string;
  createdAt: string;
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
