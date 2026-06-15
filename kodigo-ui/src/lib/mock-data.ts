import type {
  User,
  Product,
  Supplier,
  Sale,
  StockAlert,
  RevenueDataPoint,
  HourlySalesPoint,
  CategorySalesPoint,
  ProductRanking,
  RestockItem,
  DashboardStats,
  Category,
} from '@/types';

const MOCK_STORE_ID = 'store-main';
const MOCK_STORE_NAME = 'Main Store';

const withMockStore = <T extends object>(item: T): T & { storeId: string } => ({
  storeId: MOCK_STORE_ID,
  ...item,
});

// ─── Users ───────────────────────────────────────────────────────────────────

export const mockUsers: User[] = [
  { id: 'u1', email: 'admin@kodigo.ph', name: 'Maria Santos', role: 'admin', passwordHash: 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f' },
  { id: 'u2', email: 'cashier@kodigo.ph', name: 'Juan dela Cruz', role: 'cashier', passwordHash: 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f' },
  { id: 'u3', email: 'cashier2@kodigo.ph', name: 'Ana Reyes', role: 'cashier', passwordHash: 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f' },
  { id: 'u4', email: 'vergaraevon@gmail.com', name: 'EVON', role: 'super_admin' as any, passwordHash: 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f' },
];

// ─── Categories ──────────────────────────────────────────────────────────────

export const mockCategories: Category[] = [
  { id: 'c1', name: 'Beverages' },
  { id: 'c2', name: 'Snacks' },
  { id: 'c3', name: 'Personal Care' },
  { id: 'c4', name: 'Canned Goods' },
  { id: 'c5', name: 'Condiments' },
  { id: 'c6', name: 'Dairy' },
  { id: 'c7', name: 'Household' },
  { id: 'c8', name: 'Tobacco' },
];

// ─── Suppliers ───────────────────────────────────────────────────────────────

export const mockSuppliers: Supplier[] = [
  {
    id: 's1',
    storeIds: [MOCK_STORE_ID],
    storeNames: [MOCK_STORE_NAME],
    name: 'San Miguel Corporation',
    contact: 'Pedro Lim',
    email: 'pedro@smc.ph',
    phone: '+63 2 8632 3000',
    address: '40 San Miguel Ave, Mandaluyong City',
    leadTimeDays: 2,
    reliabilityScore: 95,
    priceScore: 80,
    overallScore: 88,
    totalOrders: 124,
    onTimeDeliveries: 118,
    createdAt: '2025-01-15T08:00:00Z',
  },
  {
    id: 's2',
    storeIds: [MOCK_STORE_ID],
    storeNames: [MOCK_STORE_NAME],
    name: 'Universal Robina Corp',
    contact: 'Lisa Tan',
    email: 'lisa@urc.ph',
    phone: '+63 2 8638 1000',
    address: 'C5 Road, Pasig City',
    leadTimeDays: 3,
    reliabilityScore: 88,
    priceScore: 92,
    overallScore: 90,
    totalOrders: 98,
    onTimeDeliveries: 86,
    createdAt: '2025-02-01T08:00:00Z',
  },
  {
    id: 's3',
    storeIds: [MOCK_STORE_ID],
    storeNames: [MOCK_STORE_NAME],
    name: 'Nestlé Philippines',
    contact: 'Carlo Reyes',
    email: 'carlo@nestle.ph',
    phone: '+63 2 8813 7000',
    address: 'Rockwell Center, Makati City',
    leadTimeDays: 4,
    reliabilityScore: 92,
    priceScore: 75,
    overallScore: 84,
    totalOrders: 67,
    onTimeDeliveries: 62,
    createdAt: '2025-03-10T08:00:00Z',
  },
].map(withMockStore) as Supplier[];

// ─── Products ────────────────────────────────────────────────────────────────

export const mockProducts: Product[] = [
  {
    id: 'p1', name: 'Red Horse Beer 500ml', sku: 'SMC-RH-001', barcode: '4800888888881',
    categoryId: 'c1', categoryName: 'Beverages', unit: 'bottle',
    costPrice: 38, sellingPrice: 50, currentStock: 240, minStockLevel: 50, safetyStock: 20,
    reorderLevel: 60, leadTimeDays: 2, supplierId: 's1', supplierName: 'San Miguel Corporation',
    createdAt: '2025-01-20T08:00:00Z', updatedAt: '2026-03-01T10:00:00Z',
  },
  {
    id: 'p2', name: 'Nova Country Cheddar 78g', sku: 'URC-NC-001', barcode: '4800016501234',
    categoryId: 'c2', categoryName: 'Snacks', unit: 'pack',
    costPrice: 20, sellingPrice: 28, currentStock: 8, minStockLevel: 30, safetyStock: 10,
    reorderLevel: 40, leadTimeDays: 3, supplierId: 's2', supplierName: 'Universal Robina Corp',
    createdAt: '2025-01-20T08:00:00Z', updatedAt: '2026-03-01T10:00:00Z',
  },
  {
    id: 'p3', name: 'Nescafé 3-in-1 Original 20g', sku: 'NES-301-001', barcode: '4800361001234',
    categoryId: 'c1', categoryName: 'Beverages', unit: 'sachet',
    costPrice: 8, sellingPrice: 12, currentStock: 0, minStockLevel: 50, safetyStock: 20,
    reorderLevel: 70, leadTimeDays: 4, supplierId: 's3', supplierName: 'Nestlé Philippines',
    createdAt: '2025-01-20T08:00:00Z', updatedAt: '2026-03-01T10:00:00Z',
  },
  {
    id: 'p4', name: 'Palmolive Shampoo 12ml Sachet', sku: 'COL-PAL-001', barcode: '5000174001234',
    categoryId: 'c3', categoryName: 'Personal Care', unit: 'sachet',
    costPrice: 4, sellingPrice: 7, currentStock: 180, minStockLevel: 40, safetyStock: 15,
    reorderLevel: 55, leadTimeDays: 3, supplierId: 's3', supplierName: 'Nestlé Philippines',
    createdAt: '2025-01-25T08:00:00Z', updatedAt: '2026-03-01T10:00:00Z',
  },
  {
    id: 'p5', name: 'Century Tuna Flakes 180g', sku: 'CTI-CTF-001', barcode: '4800633001234',
    categoryId: 'c4', categoryName: 'Canned Goods', unit: 'can',
    costPrice: 30, sellingPrice: 40, currentStock: 3, minStockLevel: 20, safetyStock: 8,
    reorderLevel: 28, leadTimeDays: 2, supplierId: 's1', supplierName: 'San Miguel Corporation',
    createdAt: '2025-02-01T08:00:00Z', updatedAt: '2026-03-01T10:00:00Z',
  },
  {
    id: 'p6', name: 'Mang Tomas Lechon Sauce 550g', sku: 'URC-MT-001', barcode: '4800016801234',
    categoryId: 'c5', categoryName: 'Condiments', unit: 'bottle',
    costPrice: 38, sellingPrice: 55, currentStock: 65, minStockLevel: 15, safetyStock: 5,
    reorderLevel: 20, leadTimeDays: 3, supplierId: 's2', supplierName: 'Universal Robina Corp',
    createdAt: '2025-02-05T08:00:00Z', updatedAt: '2026-03-01T10:00:00Z',
  },
  {
    id: 'p7', name: 'Bear Brand Fortified Milk Powder 300g', sku: 'NES-BB-001', barcode: '4800361901234',
    categoryId: 'c6', categoryName: 'Dairy', unit: 'pack',
    costPrice: 105, sellingPrice: 140, currentStock: 22, minStockLevel: 10, safetyStock: 4,
    reorderLevel: 14, leadTimeDays: 4, supplierId: 's3', supplierName: 'Nestlé Philippines',
    createdAt: '2025-02-10T08:00:00Z', updatedAt: '2026-03-01T10:00:00Z',
  },
  {
    id: 'p8', name: 'Joy Dishwashing Liquid 250ml', sku: 'PG-JOY-001', barcode: '4800300001234',
    categoryId: 'c7', categoryName: 'Household', unit: 'bottle',
    costPrice: 28, sellingPrice: 38, currentStock: 14, minStockLevel: 20, safetyStock: 8,
    reorderLevel: 28, leadTimeDays: 2, supplierId: 's1', supplierName: 'San Miguel Corporation',
    createdAt: '2025-02-15T08:00:00Z', updatedAt: '2026-03-01T10:00:00Z',
  },
  // ── Bulk-split products: bought per pack/bag, sold per piece ─────────────
  {
    // Sold per stick (₱7), bought per pack of 20 sticks (₱100/pack)
    id: 'p9', name: 'Marlboro Red', sku: 'PMI-MRL-001', barcode: '4890000111112',
    categoryId: 'c8', categoryName: 'Tobacco',
    unit: 'stick',          // selling unit
    purchaseUnit: 'pack',   // purchase unit
    conversionFactor: 20,   // 1 pack = 20 sticks
    costPrice: 100,         // ₱100 per pack → ₱5 per stick
    sellingPrice: 7,        // ₱7 per stick
    currentStock: 8,        // 8 sticks (= less than 1 pack) — CRITICAL
    minStockLevel: 20, safetyStock: 10, reorderLevel: 40,
    leadTimeDays: 1, supplierId: 's1', supplierName: 'San Miguel Corporation',
    createdAt: '2025-01-20T08:00:00Z', updatedAt: '2026-03-04T07:15:00Z',
  },
  {
    // Sold per piece (₱1.50), bought per bag of 50 pieces (₱40/bag)
    id: 'p10', name: 'White Rabbit Creamy Candy', sku: 'WR-CRM-001', barcode: '6901720001234',
    categoryId: 'c2', categoryName: 'Snacks',
    unit: 'piece',          // selling unit
    purchaseUnit: 'bag',    // purchase unit
    conversionFactor: 50,   // 1 bag = 50 pieces
    costPrice: 40,          // ₱40 per bag → ₱0.80 per piece
    sellingPrice: 1.5,      // ₱1.50 per piece
    currentStock: 35,       // 35 pieces — LOW (below minStockLevel of 50)
    minStockLevel: 50, safetyStock: 20, reorderLevel: 100,
    leadTimeDays: 2, supplierId: 's2', supplierName: 'Universal Robina Corp',
    createdAt: '2025-01-20T08:00:00Z', updatedAt: '2026-03-04T07:20:00Z',
  },
].map(withMockStore) as Product[];

// ─── Stock Alerts ────────────────────────────────────────────────────────────

export const mockAlerts: StockAlert[] = [
  // Bulk-split products — alerts show piece counts so Admin knows to buy packs/bags
  { id: 'a5', productId: 'p9', productName: 'Marlboro Red', type: 'critical', currentStock: 8, minStockLevel: 20, isRead: false, createdAt: '2026-03-04T07:15:00Z' },
  { id: 'a6', productId: 'p10', productName: 'White Rabbit Creamy Candy', type: 'low', currentStock: 35, minStockLevel: 50, isRead: false, createdAt: '2026-03-04T07:20:00Z' },
  // Regular products
  { id: 'a1', productId: 'p2', productName: 'Nova Country Cheddar 78g', type: 'critical', currentStock: 8, minStockLevel: 30, isRead: false, createdAt: '2026-03-02T08:00:00Z' },
  { id: 'a2', productId: 'p3', productName: 'Nescafé 3-in-1 Original 20g', type: 'out-of-stock', currentStock: 0, minStockLevel: 50, isRead: false, createdAt: '2026-03-02T07:30:00Z' },
  { id: 'a3', productId: 'p5', productName: 'Century Tuna Flakes 180g', type: 'critical', currentStock: 3, minStockLevel: 20, isRead: false, createdAt: '2026-03-02T07:00:00Z' },
  { id: 'a4', productId: 'p8', productName: 'Joy Dishwashing Liquid 250ml', type: 'low', currentStock: 14, minStockLevel: 20, isRead: true, createdAt: '2026-03-01T18:00:00Z' },
].map(withMockStore) as StockAlert[];

// ─── Dashboard Stats ─────────────────────────────────────────────────────────

export const mockDashboardStats: DashboardStats = {
  todayRevenue: 8_420,
  todayTransactions: 143,
  avgOrderValue: 58.88,
  todayProfit: 2_526,
  revenueChange: 12.4,
  transactionsChange: 8.2,
  avgOrderChange: 3.8,
  profitChange: 15.1,
};

// ─── Revenue Chart Data ──────────────────────────────────────────────────────

function generateRevenue(): RevenueDataPoint[] {
  const data: RevenueDataPoint[] = [];
  const base = new Date('2026-02-01');
  for (let i = 0; i < 30; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const rev = 5000 + Math.random() * 5000;
    data.push({
      date: d.toISOString().slice(0, 10),
      revenue: Math.round(rev),
      profit: Math.round(rev * 0.3),
      transactions: Math.round(80 + Math.random() * 80),
    });
  }
  return data;
}

export const mockRevenueData: RevenueDataPoint[] = generateRevenue();

// ─── Hourly Sales ────────────────────────────────────────────────────────────

export const mockHourlySales: HourlySalesPoint[] = [
  { hour: '6AM', sales: 320 }, { hour: '7AM', sales: 480 }, { hour: '8AM', sales: 920 },
  { hour: '9AM', sales: 1100 }, { hour: '10AM', sales: 850 }, { hour: '11AM', sales: 760 },
  { hour: '12PM', sales: 1350 }, { hour: '1PM', sales: 980 }, { hour: '2PM', sales: 640 },
  { hour: '3PM', sales: 720 }, { hour: '4PM', sales: 890 }, { hour: '5PM', sales: 1120 },
  { hour: '6PM', sales: 1480 }, { hour: '7PM', sales: 1250 }, { hour: '8PM', sales: 980 },
  { hour: '9PM', sales: 560 },
];

// ─── Category Sales ──────────────────────────────────────────────────────────

export const mockCategorySales: CategorySalesPoint[] = [
  { category: 'Beverages', revenue: 28400, percentage: 31 },
  { category: 'Tobacco', revenue: 12950, percentage: 14 },
  { category: 'Snacks', revenue: 11800, percentage: 13 },
  { category: 'Canned Goods', revenue: 14200, percentage: 16 },
  { category: 'Personal Care', revenue: 9800, percentage: 11 },
  { category: 'Condiments', revenue: 7400, percentage: 8 },
  { category: 'Others', revenue: 6450, percentage: 7 },
];

// ─── Product Rankings ────────────────────────────────────────────────────────

export const mockRankings: ProductRanking[] = [
  // Marlboro ranks #1 by units: cigarettes are the most-sold item in a sari-sari store
  { rank: 1, productId: 'p9', productName: 'Marlboro Red', categoryName: 'Tobacco', unitsSold: 1850, revenue: 12950, percentageOfTotal: 13.7 },
  { rank: 2, productId: 'p1', productName: 'Red Horse Beer 500ml', categoryName: 'Beverages', unitsSold: 568, revenue: 28400, percentageOfTotal: 18.2 },
  // White Rabbit ranks #3 by units: many small purchases
  { rank: 3, productId: 'p10', productName: 'White Rabbit Creamy Candy', categoryName: 'Snacks', unitsSold: 1430, revenue: 2145, percentageOfTotal: 1.4 },
  { rank: 4, productId: 'p3', productName: 'Nescafé 3-in-1 Original 20g', categoryName: 'Beverages', unitsSold: 812, revenue: 9744, percentageOfTotal: 6.2 },
  { rank: 5, productId: 'p4', productName: 'Palmolive Shampoo 12ml Sachet', categoryName: 'Personal Care', unitsSold: 920, revenue: 6440, percentageOfTotal: 4.1 },
  { rank: 6, productId: 'p2', productName: 'Nova Country Cheddar 78g', categoryName: 'Snacks', unitsSold: 380, revenue: 10640, percentageOfTotal: 6.8 },
  { rank: 7, productId: 'p5', productName: 'Century Tuna Flakes 180g', categoryName: 'Canned Goods', unitsSold: 224, revenue: 8960, percentageOfTotal: 5.7 },
  { rank: 8, productId: 'p6', productName: 'Mang Tomas Lechon Sauce 550g', categoryName: 'Condiments', unitsSold: 134, revenue: 7370, percentageOfTotal: 4.7 },
  { rank: 9, productId: 'p7', productName: 'Bear Brand Fortified Milk 300g', categoryName: 'Dairy', unitsSold: 98, revenue: 13720, percentageOfTotal: 8.8 },
  { rank: 10, productId: 'p8', productName: 'Joy Dishwashing Liquid 250ml', categoryName: 'Household', unitsSold: 156, revenue: 5928, percentageOfTotal: 3.8 },
];

// ─── Restock Items ───────────────────────────────────────────────────────────

export const mockRestockItems: RestockItem[] = [
  // Bulk-split products — suggested order shown in purchase units
  {
    productId: 'p9', productName: 'Marlboro Red',
    currentStock: 8, suggestedQty: 80,          // 80 sticks = 4 packs
    suggestedSupplierId: 's1', suggestedSupplierName: 'San Miguel Corporation',
    estimatedCost: 400,                          // 4 packs × ₱100
    urgency: 'high',
    unit: 'stick', purchaseUnit: 'pack', conversionFactor: 20,
  },
  {
    productId: 'p10', productName: 'White Rabbit Creamy Candy',
    currentStock: 35, suggestedQty: 200,         // 200 pieces = 4 bags
    suggestedSupplierId: 's2', suggestedSupplierName: 'Universal Robina Corp',
    estimatedCost: 160,                          // 4 bags × ₱40
    urgency: 'low',
    unit: 'piece', purchaseUnit: 'bag', conversionFactor: 50,
  },
  // Regular products
  { productId: 'p3', productName: 'Nescafé 3-in-1 Original 20g', currentStock: 0, suggestedQty: 100, suggestedSupplierId: 's3', suggestedSupplierName: 'Nestlé Philippines', estimatedCost: 800, urgency: 'high', unit: 'sachet' },
  { productId: 'p2', productName: 'Nova Country Cheddar 78g', currentStock: 8, suggestedQty: 60, suggestedSupplierId: 's2', suggestedSupplierName: 'Universal Robina Corp', estimatedCost: 1200, urgency: 'high', unit: 'pack' },
  { productId: 'p5', productName: 'Century Tuna Flakes 180g', currentStock: 3, suggestedQty: 50, suggestedSupplierId: 's1', suggestedSupplierName: 'San Miguel Corporation', estimatedCost: 1500, urgency: 'high', unit: 'can' },
  { productId: 'p8', productName: 'Joy Dishwashing Liquid 250ml', currentStock: 14, suggestedQty: 30, suggestedSupplierId: 's1', suggestedSupplierName: 'San Miguel Corporation', estimatedCost: 840, urgency: 'medium', unit: 'bottle' },
].map(withMockStore) as RestockItem[];

// ─── Recent Sales ────────────────────────────────────────────────────────────

export const mockRecentSales: Sale[] = [
  {
    // Typical sari-sari transaction: cigarette sticks + candy pieces
    id: 'sale4', cashierId: 'u2', cashierName: 'Juan dela Cruz',
    items: [
      { productId: 'p9', productName: 'Marlboro Red', quantity: 5, unitPrice: 7, lineTotal: 35 },
      { productId: 'p10', productName: 'White Rabbit Creamy Candy', quantity: 10, unitPrice: 1.5, lineTotal: 15 },
    ],
    subtotal: 50, tax: 0, discount: 0, total: 50, cashReceived: 50, change: 0,
    createdAt: '2026-03-04T08:05:00Z',
  },
  {
    // Cigarettes-only purchase
    id: 'sale5', cashierId: 'u3', cashierName: 'Ana Reyes',
    items: [
      { productId: 'p9', productName: 'Marlboro Red', quantity: 2, unitPrice: 7, lineTotal: 14 },
    ],
    subtotal: 14, tax: 0, discount: 0, total: 14, cashReceived: 20, change: 6,
    createdAt: '2026-03-04T07:58:00Z',
  },
  {
    id: 'sale1', cashierId: 'u2', cashierName: 'Juan dela Cruz',
    items: [
      { productId: 'p1', productName: 'Red Horse Beer 500ml', quantity: 2, unitPrice: 50, lineTotal: 100 },
      { productId: 'p4', productName: 'Palmolive Shampoo 12ml Sachet', quantity: 3, unitPrice: 7, lineTotal: 21 },
    ],
    subtotal: 121, tax: 0, discount: 0, total: 121, cashReceived: 150, change: 29,
    createdAt: '2026-03-04T07:42:00Z',
  },
  {
    id: 'sale2', cashierId: 'u2', cashierName: 'Juan dela Cruz',
    items: [
      { productId: 'p7', productName: 'Bear Brand Fortified Milk 300g', quantity: 1, unitPrice: 140, lineTotal: 140 },
    ],
    subtotal: 140, tax: 0, discount: 0, total: 140, cashReceived: 200, change: 60,
    createdAt: '2026-03-04T07:38:00Z',
  },
  {
    id: 'sale3', cashierId: 'u3', cashierName: 'Ana Reyes',
    items: [
      { productId: 'p6', productName: 'Mang Tomas Lechon Sauce 550g', quantity: 1, unitPrice: 55, lineTotal: 55 },
      { productId: 'p2', productName: 'Nova Country Cheddar 78g', quantity: 2, unitPrice: 28, lineTotal: 56 },
    ],
    subtotal: 111, tax: 0, discount: 11, total: 100, cashReceived: 100, change: 0,
    createdAt: '2026-03-04T07:31:00Z',
  },
].map(withMockStore) as Sale[];
