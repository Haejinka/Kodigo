# KodiGo — AI Agent Build Guideline
> **Living Document** | Version: 0.3.0 | Last Updated: 2026-03-16
> This document is the single source of truth for building KodiGo. Update it continuously as the UI and requirements evolve. Never let code outpace this document.

---

## 📋 Table of Contents
1. [How to Use This Document](#1-how-to-use-this-document)
2. [Project Overview](#2-project-overview)
3. [Tech Stack](#3-tech-stack)
4. [Design System](#4-design-system)
5. [Application Structure](#5-application-structure)
6. [Page Layouts](#6-page-layouts)
7. [UI Components](#7-ui-components)
8. [Interaction Flows](#8-interaction-flows)
9. [Backend Considerations](#9-backend-considerations)
10. [State Management](#10-state-management)
11. [Build Phases](#11-build-phases)
12. [Iteration Notes](#12-iteration-notes)
13. [AI Agent Instructions](#13-ai-agent-instructions)

---

## 1. How to Use This Document

### For Humans
- Treat every section as a contract between design intent and implementation.
- When making a UI or logic decision not covered here, **add it to this document first**, then implement.
- Use `Iteration Notes` (Section 12) to log every meaningful change — date, what changed, and why.

### For AI Agents
- Read **Section 13 (AI Agent Instructions)** before doing anything else.
- Never implement a feature that contradicts this document without flagging the conflict first.
- After completing any task, update the relevant section of this document to reflect the current state.
- When in doubt about design or behavior, default to the principles in Section 4 (Design System).

### Versioning Convention
Bump the version at the top of this file on every meaningful update:
- `PATCH` (0.1.x) — Small corrections, typo fixes, clarifications
- `MINOR` (0.x.0) — New sections, new component specs, new pages added
- `MAJOR` (x.0.0) — Structural redesign, stack change, or major scope shift

---

## 2. Project Overview

**KodiGo** is a cloud-based Point-of-Sale (POS) and Inventory Management System designed for high-volume sari-sari stores (small retail stores common in the Philippines).

### Core Goals
- Fast, reliable sales transaction processing (< 2 seconds)
- Real-time inventory tracking
- Remote monitoring for the store owner
- Demand forecasting and restocking automation
- Supplier performance scoring and recommendation
- Sales analytics and product intelligence

### Users
| Role | Access Level |
|------|-------------|
| Admin (Owner) | Full access — analytics, suppliers, users, all settings |
| Cashier | POS only — process sales, view product info |
| Manager *(Phase 2)* | Inventory + basic analytics, no supplier or user management |

### Key Constraints
- Must work on desktop and mobile browsers
- Supports USB/Bluetooth barcode scanner input
- Integrates with receipt printer and cash drawer
- Must remain functional on modest internet connections

---

## 3. Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React 19 (Vite 7) | Component-based, fast dev cycle |
| Styling | Tailwind CSS v4 | Utility-first via `@tailwindcss/vite` plugin (no postcss/config file) |
| UI Components | Custom + Radix UI primitives | Custom components built on `@radix-ui/react-*`; no shadcn CLI used |
| Icons | Lucide React v0.576 | Consistent icon set |
| Charts | Recharts v3 | Lightweight, React-native charting |
| Routing | React Router v7 | Client-side routing |
| State | Zustand v5 | Lightweight global state |
| Server State | TanStack Query v5 | Data fetching, caching (wired for Supabase integration) |
| Backend/DB | Supabase | Auth, database, real-time subscriptions, storage |
| Real-time | Supabase Realtime | Live inventory and sales updates |
| Hosting | Vercel or Netlify | CI/CD from Git |

> **Database schema is intentionally deferred.** Schema design will follow UI finalization to ensure the data model matches actual UI needs, not assumptions.

---

## 4. Design System

### Philosophy
The KodiGo UI should feel like a **modern retail tool, not enterprise software**. It should be:
- **Light** — White/gray backgrounds, no heavy dark themes (except optional dark mode later)
- **Simple** — Every screen has a single primary action. Avoid visual clutter.
- **Fast to scan** — Store cashiers work under pressure. Data must be readable at a glance.
- **Touch-friendly** — Buttons and tap targets minimum 44×44px for mobile/tablet use

### Color Palette
```
Primary:     #2563EB  (Blue 600)    — actions, links, active states
Primary Hover: #1D4ED8 (Blue 700)
Success:     #16A34A  (Green 600)   — confirmed transactions, in-stock
Warning:     #D97706  (Amber 600)   — low stock alerts
Danger:      #DC2626  (Red 600)     — out of stock, errors, critical alerts
Neutral:     #F9FAFB  (Gray 50)     — page backgrounds
Surface:     #FFFFFF               — card/panel backgrounds
Border:      #E5E7EB  (Gray 200)    — dividers, card outlines
Text Primary: #111827 (Gray 900)
Text Muted:  #6B7280  (Gray 500)
```

### Typography
```
Font Family: Inter (Google Fonts)
Base Size:   14px / 16px
Headings:    font-semibold or font-bold
Labels:      font-medium, text-sm, text-muted
Monospace:   'Roboto Mono' for SKUs, prices, quantities
```

### Spacing Scale
Follow Tailwind defaults. Key values:
- Component padding: `p-4` (16px)
- Card gap: `gap-4` or `gap-6`
- Page padding: `px-6 py-6` on desktop, `px-4 py-4` on mobile

### Elevation / Shadow
- Cards: `shadow-sm border border-gray-200 rounded-xl`
- Modals/Drawers: `shadow-xl`
- Dropdowns: `shadow-md`

### Responsive Breakpoints
```
Mobile:  < 640px    (sm)
Tablet:  640–1024px (md)
Desktop: > 1024px   (lg, xl)
```

The POS page is the only page that must be **fully functional on tablet** in landscape mode. All other pages are desktop-primary with mobile-readable fallback.

---

## 5. Application Structure

### Folder Structure
```
src/
├── assets/             # Logos, images
├── components/
│   ├── ui/             # shadcn/ui base components
│   ├── layout/         # AppShell, Sidebar, Topbar, PageHeader
│   ├── pos/            # POS-specific components
│   ├── inventory/      # Inventory-specific components
│   ├── analytics/      # Chart and stat components
│   ├── suppliers/      # Supplier management components
│   └── shared/         # Badges, alerts, empty states, modals
├── pages/              # One file per route/page
├── hooks/              # Custom React hooks
├── stores/             # Zustand stores
├── lib/                # Supabase client, utils, formatters
├── types/              # TypeScript interfaces
└── App.tsx             # Router setup
```

### Route Map
```
/                        → Redirect to /dashboard
/pos                     → POS Terminal (Cashier default; admins redirected to /dashboard on mobile)
/dashboard               → Overview Dashboard (Admin)
/inventory               → Product & Stock List
/inventory/products/new  → Add Product
/inventory/products/:id  → Edit Product
/restocking              → Restock List & Forecasting
/suppliers               → Supplier List
/suppliers/new           → Add Supplier
/suppliers/:id           → Supplier Detail (scores, PO history, assigned products)
/suppliers/:id/edit      → Edit Supplier
/analytics               → Sales Analytics
/rankings                → Product Rankings
/settings                → General Settings
/settings/users          → User Management (invite + edit users)
/settings/notifications  → Notification Preferences
/settings/security       → Password & Security
```

---

## 6. Page Layouts

### Global Layout — AppShell
All pages except the POS share a common shell:
```
┌─────────────────────────────────────┐
│  Topbar (logo, alerts bell, avatar) │
├──────────┬──────────────────────────┤
│          │                          │
│ Sidebar  │   Page Content Area      │
│ (nav)    │   (scrollable)           │
│          │                          │
└──────────┴──────────────────────────┘
```
- Sidebar is collapsible on desktop (icon-only mode)
- Sidebar becomes a bottom sheet / drawer on mobile
- Topbar height: 64px, Sidebar width: 240px (expanded), 64px (collapsed)

### POS Page — Full Screen Layout
The POS page uses its own full-screen layout (no sidebar):
```
┌────────────────────────────────────────────┐
│  POS Topbar: Store Name | Cashier | Clock  │
├─────────────────────┬──────────────────────┤
│                     │                      │
│  Product Search +   │   Cart / Order       │
│  Barcode Input      │   Summary            │
│                     │                      │
│  (Product Grid or   │   Item list          │
│   Search Results)   │   Subtotal           │
│                     │   Discount/Tax       │
│                     │   Total              │
│                     │                      │
│                     │  [CHARGE / PAY]      │
└─────────────────────┴──────────────────────┘
```

### Dashboard Page
```
┌──────────────────────────────────────────┐
│  Page Header: "Dashboard" + date         │
├──────────┬──────────┬──────────┬─────────┤
│ Stat Card│ Stat Card│ Stat Card│StatCard │
│ Today Rev│ Txn Count│ Avg Order│ Profit  │
├──────────┴──────────┴──────────┴─────────┤
│  Revenue Chart (line) — last 30 days     │
├──────────────────┬───────────────────────┤
│  Top 5 Products  │  Low Stock Alerts     │
│  (mini ranking)  │  (scrollable list)    │
└──────────────────┴───────────────────────┘
```

### Inventory Page
```
┌──────────────────────────────────────────┐
│  Page Header + [+ Add Product] button    │
├──────────────────────────────────────────┤
│  Filters: Search | Category | Stock Status│
├──────────────────────────────────────────┤
│  Product Table (paginated, sortable)     │
│  Columns: Name | SKU | Stock | Min Stock │
│           | Price | Cost | Actions       │
└──────────────────────────────────────────┘
```

### Analytics Page
```
┌──────────────────────────────────────────┐
│  Page Header + Date Range Picker         │
├──────────────────────────────────────────┤
│  Summary Stats Row (4 cards)             │
├──────────────────────────────────────────┤
│  Revenue Trend (Line Chart)              │
├──────────────────┬───────────────────────┤
│  Sales by Hour   │  Sales by Category    │
│  (Bar Chart)     │  (Pie/Donut Chart)    │
├──────────────────┴───────────────────────┤
│  Transactions Table (filterable)         │
└──────────────────────────────────────────┘
```

---

## 7. UI Components

### Shared Components

#### `<StatCard />`
- Props: `label`, `value`, `change` (%), `changeDirection` (up/down), `icon`, `color`
- Displays a metric with trend indicator
- Color-coded: green for positive, red for negative
- Used in: Dashboard, Analytics

#### `<AlertBadge />`
- Props: `type` (low | critical | out-of-stock | overstock), `count`
- Shows colored pill badge
- Used in: Sidebar nav, Dashboard, Inventory table

#### `<DataTable />`
- Wraps a sortable, paginated table
- Props: `columns`, `data`, `onRowClick`, `loading`, `emptyState`
- Includes a toolbar slot for search/filter above the table
- Used in: Inventory, Transactions, Suppliers, Rankings

#### `<SearchInput />`
- Debounced text input with clear button and optional barcode icon
- Emits `onChange` with the trimmed search string
- Used in: POS, Inventory, Suppliers

#### `<ConfirmDialog />`
- Modal with title, description, [Cancel] and [Confirm] buttons
- Danger variant for destructive actions (red confirm button)
- Used throughout for delete/void/adjustment actions

#### `<PageHeader />`
- Props: `title`, `subtitle`, `actions` (slot for buttons)
- Consistent heading + action area at top of every page

#### `<EmptyState />`
- Props: `icon`, `title`, `description`, `action`
- Shown when tables or lists have no data

### POS-Specific Components

#### `<BarcodeInput />`
- Hidden `<input>` that captures barcode scanner keystrokes
- Auto-focused. Listens for fast sequential keydown events (scanner pattern)
- On `Enter` key: triggers product lookup
- Must not interfere with other form inputs on screen

#### `<HardwareIntegration />` (Utility)
- Handled largely via `src/lib/hardware.ts`.
- Uses **Web Serial API** (`navigator.serial`) to communicate directly with USB/Serial ESC/POS receipt printers and cash drawers.
- Cash Drawer is opened by sending the standard ESC/POS kick command (`0x1B`, `0x70`, `0x00`, `0x19`, `0xFA`).

#### `<ProductSearchPanel />`
- Left half of the POS layout
- Contains `<BarcodeInput />`, `<SearchInput />`, and `<ProductGrid />`
- `<ProductGrid />`: Responsive grid of `<ProductCard />` tiles (image, name, price)

#### `<Cart />`
- Right half of POS layout
- Renders `<CartItem />` rows (name, qty stepper, line total, remove)
- Shows subtotal, tax, discount, and total
- Contains `<PayButton />` — large, prominent, triggers payment flow

#### `<PaymentModal />`
- Full-screen overlay on payment
- Shows order total and itemised list
- Cash input with quick-amount buttons and auto-calculated change
- **[Confirm Payment]** button builds a complete `Sale` object including `cashierId` and `cashierName` from `useAuthStore` at the moment of confirmation
- On success: shows cashier name, transaction ID, and timestamp on the receipt screen
- `TODO`: replace the simulated timeout with `supabase.from('sales').insert(sale)` in Phase 1 backend wiring

### Inventory-Specific Components

#### `<ProductForm />`
- Used in Add and Edit product pages
- Fields: Name, SKU, Barcode, Category, Unit, Cost Price, Selling Price, Current Stock, Min Stock Level, Safety Stock, Lead Time, Supplier(s)
- Validates required fields before submit

#### `<StockAdjustmentModal />`
- Props: `productId`, `currentStock`; optional `unit`, `purchaseUnit`, `conversionFactor` for bulk-split products
- Reason selector: Damaged | Expired | Lost | Manual Count | Restock | Other
- Quantity input (positive or negative delta); when reason = Restock and `conversionFactor > 1`, shows toggle to enter in purchase units (auto-converts)
- Note/memo field
- Logs to audit trail on submit via `useProductStore.adjustStock()`

#### `<StockAdjustmentLog />`
- Props: `adjustments: StockAdjustment[]`
- Filterable by reason (all | damaged | expired | lost | manual-count | restock | other) and direction (all | increase | decrease)
- Searchable by product name or note text
- Displays delta with color-coded arrows (green = increase, red = decrease)
- Used in: `EditProductPage`

### Supplier-Specific Components

#### `<SupplierForm />`
- Used in `AddSupplierPage` (`/suppliers/new`) and `EditSupplierPage` (`/suppliers/:id/edit`)
- Fields: Name, Contact Person, Email, Phone, Address, Lead Time (days)
- Scores (reliability, price, overall) are **read-only** — always auto-computed, never entered manually
- On save calls `useSupplierStore.addSupplier()` / `updateSupplier()`

### Analytics Components

#### `<RevenueChart />`
- Recharts `LineChart` wrapper
- Props: `data` (array of `{ date, revenue }`), `dateRange`
- Shows tooltip on hover with date and formatted revenue

#### `<TopProductsTable />`
- Props: `period` (daily | weekly | monthly), `limit` (default 10)
- Columns: Rank, Product Name, Units Sold, Revenue, % of Total

---

## 8. Interaction Flows

### Flow 1: POS Sale
1. Cashier opens `/pos`
2. Scanner input or manual search finds product → adds to cart. Can use **[F2]** to focus the search bar, type a product name, and press **[Enter]** to add the top result.
3. Cashier adjusts quantity if needed (can type numbers without focusing any input to set a pending quantity multiplier, e.g., type `5` then scan).
4. Cashier clicks **[Charge]** or presses **[F9]**.
5. `<PaymentModal />` opens — cashier enters cash amount (auto-focused).
6. Press **[Enter]** or click **[Confirm Payment]**:
   - A `Sale` object is built in the browser, capturing `cashierId` and `cashierName` from `useAuthStore` at the moment of payment
   - The cash drawer opens automatically via Web Serial API (`openCashDrawer()`)
   - `TODO (Phase 1 backend)`: `supabase.from('sales').insert(sale)` — deducts stock + persists sale
   - Success screen shows cashier name, transaction ID, timestamp, and change, along with a "Print Receipt" button
   - Press **[Enter]** or click **[New Transaction]** to reset the cart.
7. If product stock hits reorder level → alert generated in background

### Flow 1b: POS Logout
1. Cashier clicks **[Logout]** button in the POS topbar (top-right, red on hover)
2. `<ConfirmDialog />` opens warning that unsaved cart items will be lost
3. Cashier confirms → `useAuthStore.logout()` called → redirected to `/login`
4. Cancelling the dialog returns to the POS with no state change

### Flow 2: Add Product
1. Admin clicks **[+ Add Product]** on Inventory page
2. Navigates to `/inventory/products/new`
3. Fills in `<ProductForm />`
4. Clicks **[Save Product]**:
   - `POST /api/products` → inserts product + initial stock
   - Redirects to Inventory list with success toast

### Flow 3: Restock Suggestion
1. System evaluates each product daily (or on demand)
2. Products below reorder level appear in `/restocking`
3. Each row shows: product, current stock, suggested qty, suggested supplier (scored)
4. Manager/Admin clicks **[Create Purchase Order]** → generates PO

### Flow 4: Remote Monitoring
1. Admin logs in from any device
2. Dashboard auto-refreshes every 10 seconds via Supabase Realtime or polling
3. Alerts panel shows current low/critical/out-of-stock items
4. Live sales ticker shows most recent transactions

### Flow 5: Stock Adjustment
1. Admin/Manager opens product detail or uses adjustment shortcut
2. `<StockAdjustmentModal />` opens
3. Selects reason, enters quantity delta, adds note
4. Submits → stock updated, audit log entry created

---

## 9. Backend Considerations

### Supabase Setup
- Use **Supabase Auth** with email/password for all users
- Implement Row Level Security (RLS) policies to enforce role-based access
- Use Supabase **Realtime** subscriptions for:
  - Live inventory level changes
  - New sale events on the dashboard
  - Alert state changes (stock going critical)
- Use Supabase **Edge Functions** for:
  - Forecasting calculations (reorder quantity formula)
  - Supplier scoring algorithm
  - Automated alert generation

### API Design Principles
- All data access goes through Supabase client or Edge Functions
- Never expose service role key to the frontend
- Use Supabase RLS as the primary authorization layer
- Optimistic UI updates for cart operations; real writes confirmed by server response

### Real-Time Strategy
- **Sales Dashboard**: Subscribe to `sales` table inserts
- **Inventory Levels**: Subscribe to `inventory` table updates
- **Alerts**: Subscribe to a computed `alerts` view or a dedicated `stock_alerts` table
- Fallback: polling every 10 seconds if WebSocket is unavailable

### Authentication & Roles
- Supabase Auth handles session management
- Store role (`admin` | `cashier`) in a `profiles` table linked to `auth.users`
- On login, read role and set in Zustand auth store
- React Router guards redirect unauthorized users

### Performance Targets
- POS transaction write: < 2 seconds end-to-end
- Dashboard initial load: < 3 seconds
- Real-time inventory update latency: < 1 second

> **Schema Design Note**: Database schema will be designed after UI pages are finalized. This ensures tables and columns map directly to what the UI actually queries, avoiding over-engineering.

---

## 10. State Management

### Zustand Stores

#### `useAuthStore`
```ts
{
  user: User | null,
  role: 'admin' | 'cashier' | null,
  isAuthenticated: boolean,
  isLoading: boolean,
  error: string | null,
  login: (email, password) => Promise<void>,
  logout: () => void,
}
```
> Note: Uses `isAuthenticated` flag instead of a `session` object (Supabase session will replace this in Phase 1 backend wiring).

#### `useCartStore`
```ts
{
  items: CartItem[],            // { product, quantity, lineTotal }
  addItem: (product, qty?) => void,
  removeItem: (productId) => void,
  updateQty: (productId, qty) => void, // qty ≤ 0 silently removes the item
  clearCart: () => void,
  total: () => number,          // function (Zustand v5 getter pattern)
  subtotal: () => number,
  itemCount: () => number,
}
```

#### `useAlertStore`
```ts
{
  alerts: StockAlert[],
  unreadCount: number,
  fetchAlerts: () => Promise<void>,
  markRead: (alertId) => void,
  markAllRead: () => void,
}
```

#### `useProductStore`
```ts
{
  products: Product[],
  stockAdjustments: StockAdjustment[],
  addProduct: (data: ProductFormData) => Product,
  updateProduct: (id, data) => void,
  deleteProduct: (id) => void,
  adjustStock: (id, delta, reason, note) => void, // clamps to 0; auto-logs StockAdjustment
}
```
> `ProductFormData = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'categoryName' | 'supplierName'>`

#### `useSupplierStore`
```ts
{
  suppliers: Supplier[],
  purchaseOrders: PurchaseOrder[],
  addSupplier: (data: SupplierFormData) => Supplier,
  updateSupplier: (id, data) => void,
  deleteSupplier: (id) => void,                       // also removes supplier's POs
  createPurchaseOrder: (supplierId, supplierName, items) => PurchaseOrder,
  receivePurchaseOrder: (poId, onTime, products) => void, // updates score + onTimeDeliveries
  cancelPurchaseOrder: (poId) => void,
  recalculatePriceScores: (products) => void,
}
```
> Supplier scores are **always auto-computed**, never entered manually. Formulas live in `src/lib/supplier-scores.ts`:
> - `reliabilityScore = (onTimeDeliveries / totalOrders) × 100` (100 for new suppliers)
> - `priceScore`: normalised average cost vs all other suppliers (0 = most expensive, 100 = cheapest)
> - `overallScore = reliabilityScore × 0.6 + priceScore × 0.4`

### Server State
Use **TanStack Query v5** for all Supabase data fetching once backend is wired:
- Handles caching, background refetching, and loading/error states
- Define query keys by feature: `['products']`, `['sales', dateRange]`, etc.
- Currently installed but not in use — all data comes from Zustand stores seeded with mock data.

---

## 11. Build Phases

### Phase 1 — Core System
**Goal: Functional POS + inventory + basic monitoring**
- [x] Auth (login, role-based routing) — mock login; Supabase auth pending
- [x] POS page (barcode input, cart, payment flow)
- [x] Product management (add, edit, delete) — via `useProductStore`
- [ ] Real-time inventory deduction on sale — *mock only; Supabase write pending*
- [x] Dashboard (stat cards, revenue chart, low stock list)
- [x] Basic stock alerts (low / critical / out-of-stock)
- [x] Product rankings (daily/weekly/monthly top 10)

**Phase 1 remaining:** Wire Supabase auth + live inventory writes to complete real-time deduction.

### Phase 2 — Intelligence Features
**Goal: Smarter restocking and supplier management**
- [x] Reorder level system per product — `reorderLevel` field on `Product`
- [x] Forecasting engine — `suggestedQty = max(reorderLevel × 2 − currentStock, reorderLevel)` in `RestockingPage`
- [x] Auto-generated restock list — derived live from `useProductStore` in `RestockingPage`
- [x] Supplier management (add, assign, track history) — full CRUD via `useSupplierStore`; PO history on `SupplierDetailPage`
- [x] Supplier scoring algorithm — `src/lib/supplier-scores.ts` (reliability + price + weighted overall)
- [x] Profit analysis on analytics page — `todayProfit` + `profitChange` in `DashboardStats`; `profit` on `RevenueDataPoint`
- [x] Purchase order generation — `createPurchaseOrder` in `useSupplierStore`; triggered from `RestockingPage`

**Phase 2 status:** All Phase 2 UI features are scaffolded. Backend wiring (Supabase Edge Functions for scoring/forecasting) is deferred to backend integration phase.

### Phase 3 — Advanced Optimization
**Goal: Predictive tools and full analytics suite**
- [ ] Predictive supplier picker (best supplier per product)
- [ ] Sales trend analysis (seasonality, growth rate)
- [ ] Inventory performance classification (fast/slow moving)
- [ ] Automated email alerts
- [ ] Manager role and permissions
- [ ] Multi-device / multi-cashier session support

---

## 12. Iteration Notes

> Use this section to log every meaningful decision or change. Newest entries go at the top.

---

**[2026-03-16] v0.3.1 — POS Keyboard Operability**

**Problem identified:** For speed and accessibility, the POS must be operable using primarily a keyboard without requiring a mouse point-and-click workflow.
**Solution:**
- Added standard keyboard shortcuts directly into the POS flows:
  - **F2:** Focuses the main product search input.
  - **Enter (in search):** Automatically adds the top matching search result to the cart.
  - **F9:** Triggers the Charge / Payment modal (added visible keyboard hint on the checkout button).
  - **Enter (in payment modal):** Submits the cash input to confirm the payment immediately. On the success screen, Enter correctly clears and starts a new transaction.
  - **Escape:** Soft-cancels or closes the payment modal.
- Updated `SearchInput.tsx` to accept a stable ID and propagate `onKeyDown` events correctly.
- Added dependency syncing to ensure `SearchInput` flushes out internal text when queried programs explicitly clear it.

---

**[2026-03-16] v0.3.0 — Automatic Cash Drawer Integration**

**Problem identified:** For a smooth checkout experience, the POS needed to automatically open connected hardware cash drawers upon confirming a cash payment.
**Solution:**
- Created `src/lib/hardware.ts` wrapping the `Web Serial API` (`navigator.serial`).
- `openCashDrawer()` connects to a serial POS peripheral (typically a receipt printer with a direct RJ11 cash drawer interface) at `9600` baud rate and sends the standard ESC/POS kick sequence `[27, 112, 0, 25, 250]`.
- Wired into `PaymentModal.tsx` directly in `handleConfirm` so the user gesture required by device security policies naturally maps to clicking "Confirm Payment".

---

**[2026-03-04] v0.2.2 — Cashier Capture on POS Sales**

**Problem identified:** `PaymentModal` was not wired to `useAuthStore` — the `Sale` type already had `cashierId` / `cashierName` fields, but they were never populated at transaction time.

**Schema impact:** None. The `Sale` interface already had both fields. No type changes needed.

**Changes to `PaymentModal.tsx`:**
- Imported `useAuthStore` and `Sale` type
- `handleConfirm` now builds a full `Sale` object using `user.id` / `user.name` from the auth store, captured at the moment the cashier clicks Confirm
- The sale object is ready for `supabase.from('sales').insert(sale)` — a `// TODO` comment marks the exact insertion point
- Success screen updated to show a receipt-style metadata block: Cashier name, Transaction ID, and formatted timestamp
- `completedSale` state holds the built Sale record for display on the success screen
- Removed unused `cn` import

**Answered:** The `Sale` data model was already correct for admin reporting. The gap was purely in the UI not passing the auth context — now resolved.

---

**[2026-03-04] v0.2.1 — POS Logout**

- Added **[Logout]** button to the POS topbar (right side, after the clock, before any edge).
- Uses a `<ConfirmDialog danger />` warning that unsaved cart items will be lost.
- On confirm: calls `useAuthStore.logout()` then `navigate('/login', { replace: true })`.
- Cancelling the dialog leaves the POS session intact.
- Added Flow 1b (POS Logout) to Section 8.

---

**[2026-03-04] v0.2.0 — Guideline Synchronised with Actual Implementation**

Full audit of the codebase performed. Guideline updated to reflect reality:

**Tech Stack corrections:**
- React 18 → **React 19.2.0** (latest)
- React Router v6 → **React Router v7.13.1**
- Zustand (generic) → **Zustand v5.0.11** (API: getters are functions, not plain values)
- Recharts (latest) → **Recharts v3.7.0**
- Tailwind CSS v4 via `@tailwindcss/vite` confirmed (no `postcss`/`tailwind.config.js`)
- UI Components: clarified as custom components using **Radix UI primitives** directly, not the shadcn CLI
- TanStack Query v5 added to stack table (was present in dependencies, missing from docs)

**Route Map additions:**
- `/suppliers/new` — Add Supplier page
- `/suppliers/:id/edit` — Edit Supplier page
- `/settings/notifications` — Notification Preferences
- `/settings/security` — Password & Security
- Mobile routing note: admins see `/dashboard` on mobile (blocked from `/pos` via `RequirePOSAccess` guard + `useIsMobile` hook)

**State Management corrections:**
- `useAuthStore`: uses `isAuthenticated: boolean` (not `session: Session`); has `isLoading` and `error` fields
- `useCartStore`: `total`, `subtotal`, `itemCount` are **getter functions** (Zustand v5 pattern), not plain computed values
- `useAlertStore`: added `markAllRead()` action
- **New store documented** — `useProductStore`: full product CRUD + `adjustStock` with auto-audit logging to `stockAdjustments[]`
- **New store documented** — `useSupplierStore`: CRUD + `createPurchaseOrder`, `receivePurchaseOrder`, `cancelPurchaseOrder`, `recalculatePriceScores`; supplier scoring formulas documented inline

**Supplier scoring formulas now in guideline** (previously only in `src/lib/supplier-scores.ts`):
- Reliability = `(onTimeDeliveries / totalOrders) × 100`
- Price = normalised avg cost (100 = cheapest, 0 = most expensive)
- Overall = `reliability × 0.6 + price × 0.4`

**Build phase checklist updated:**
- Phase 1: 6 of 7 items complete; only Supabase live write for sales remains
- Phase 2: All 7 items scaffolded in UI; Supabase Edge Functions for scoring/forecasting remain for backend phase

---

**[2026-03-04] v0.1.2 — Unit Conversion: Bulk-Purchase / Per-Piece Selling**

**Problem solved:** Sari-sari stores commonly buy products in bulk units (per pack, box, bag, tray) but sell them individually per piece — e.g., cigarettes bought per pack of 20 sticks, sold per stick at ₱7; candies bought per bag of 50 pieces, sold per piece at ₱1.50.

**Data model changes (`src/types/index.ts`):**
- `Product` gained two optional fields:
  - `purchaseUnit?: string` — the unit used when ordering from a supplier (e.g. `"pack"`, `"box"`, `"bag"`). Only set when it differs from the selling unit.
  - `conversionFactor?: number` — how many selling units are in one purchase unit (e.g. `20` for a pack of 20 sticks). Treated as `1` when absent.
- `RestockItem` gained matching optional display fields (`unit`, `purchaseUnit`, `conversionFactor`).

**Business rules:**
- **Stock is always tracked in the smallest sellable unit** (sticks, pieces, sachets). `currentStock = 60` on a cigarette product means 60 sticks, not 60 packs.
- **Cost price is entered per purchase unit.** The system calculates `costPerSellingUnit = costPrice / conversionFactor`.
- **Selling price is per selling unit.** The POS charges ₱7 per stick regardless of pack size.
- **Margin uses cost-per-selling-unit**, not the raw `costPrice` field.

**Component changes:**
- `ProductForm`: new "Unit Configuration" section with Selling Unit selector, bulk-purchase toggle, Purchase Unit selector, and Pieces-per-purchase-unit input. Cost Price label and margin preview update dynamically.
- `StockAdjustmentModal`: new optional props `unit`, `purchaseUnit`, `conversionFactor`. When reason = Restock and `conversionFactor > 1`, shows a "Enter in [purchaseUnit]s" toggle that auto-converts to pieces before calling `onSubmit`.
- `RestockingPage`: "Order" column shows `"2 packs (40 sticks)"` for bulk-split products; estimated cost corrected to use per-selling-unit cost.

**Practical workflows:**
1. *Setup* — Admin creates product, enables "Purchased in bulk", sets purchaseUnit=pack, conversionFactor=20, costPrice=₱100/pack, sellingPrice=₱7/stick.
2. *POS sale* — Cashier adds "Marlboro Red" qty 3; system deducts 3 sticks. No change to POS flow.
3. *Receiving delivery* — Admin: Stock Adjustment → Restock → toggle "Enter in packs" → type 5 → system adds 100 sticks with preview "5 packs × 20 = +100 sticks".
4. *Restocking page* — Shows "Order: 3 packs (60 sticks)" so the person placing the order knows what to buy.

**Mock data additions:** `c8` Tobacco category; `p9` Marlboro Red (20 sticks/pack); `p10` White Rabbit Candy (50 pieces/bag).

---

**[2026-03-04] v0.1.1 — User Management: Edit & Invite User flows**

- Added `EditUserModal` component inside `SettingsPage.tsx`: opens on "Edit" click in the user list row. Fields: Full Name, Email, Role (select). Validates required fields, shows avatar preview that updates live. On save, updates the user in local list state and shows success toast.
- Added `InviteUserModal` component inside `SettingsPage.tsx`: opens on "+ Invite User" button click. Fields: Full Name, Email, Role (select). Includes an info banner explaining invitation email behavior. On submit, appends the new user to the local list and shows a success toast.
- `UserManagementPage` state changed from `const [users]` (immutable) to `useState<User[]>` with `handleEditSave` (map-update), `handleInvite` (append), and `handleRemove` (filter) handlers.
- Extracted shared `inputCls` and `selectCls` constants at module scope for reuse across both modals.
- Added `X` and `Mail` to Lucide icon imports; removed unused `ChevronRight` and `useNavigate`.

---

**[2025-07-17] v0.1.0 — Full UI Scaffold (Phase 1 UI Complete)**

- Scaffolded `kodigo-ui/` as a Vite + React 18 + TypeScript project inside the workspace root.
- **Dependencies added:** react-router-dom v6, zustand, @tanstack/react-query, recharts, lucide-react, clsx, tailwind-merge, class-variance-authority, @tailwindcss/vite (Tailwind CSS v4), @radix-ui/react-{dialog,dropdown-menu,select,slot,toast,label,separator,avatar,tabs,popover}.
- **Note:** `@radix-ui/react-badge` does not exist as a package — `Badge` is implemented as a custom component in `src/components/shared/Badge.tsx`.
- **Tailwind approach:** Using `@tailwindcss/vite` plugin (v4 API), NOT the postcss / `tailwind.config.js` approach.
- **Path alias:** `@` → `./src` configured in `vite.config.ts` and `tsconfig.app.json`.
- Added `src/types/index.ts` — all TypeScript types and the `getStockStatus()` helper.
- Added `src/lib/mock-data.ts` — full mock dataset (users, products, suppliers, alerts, sales, rankings, etc.) for UI-first development. Supabase integration deferred until schema is finalized.
- Added `src/lib/utils.ts` was pre-existing with `cn()`, `formatCurrency()`, `formatDate/DateTime/Time()`, `formatPercent()`, `truncate()` — no changes needed.
- Added 3 Zustand stores: `authStore` (login/logout with demo accounts), `cartStore` (POS cart CRUD), `alertStore` (stock alerts with read/unread state).
- Added layout components: `AppShell`, `Sidebar` (collapsible, role-filtered nav, alert badge on Restocking), `Topbar` (alert bell, user dropdown, mobile drawer trigger), `PageHeader`.
- Added shared components: `StatCard`, `AlertBadge`, `SearchInput` (debounced), `ConfirmDialog`, `DataTable` (sortable + paginated), `EmptyState`, `Toast` (context provider + `useToast()` hook), `Button` (variants + loading state), `Badge` + `StockStatusBadge`.
- Added analytics components: `RevenueChart` (LineChart), `HourlySalesChart` (BarChart), `CategorySalesChart` (PieChart/donut).
- Added POS components: `BarcodeInput` (invisible global keydown listener for USB barcode scanners), `ProductCard`, `ProductSearchPanel`, `Cart`, `PaymentModal` (cash payment → receipt confirmation flow).
- Added inventory components: `ProductForm` (create/edit, with margin preview), `StockAdjustmentModal` (reason + delta + note).
- Added all pages: `LoginPage`, `DashboardPage`, `POSPage` (full-screen, no AppShell), `InventoryPage`, `AddProductPage`, `EditProductPage`, `RestockingPage`, `SuppliersPage`, `SupplierDetailPage`, `AnalyticsPage`, `RankingsPage`, `SettingsPage` (with `SettingsLayout` + 4 sub-pages: General, User Management, Notifications, Security).
- `App.tsx` wired with React Router v6: protected routes (redirects to `/login` if unauthenticated), role guards (admin-only routes redirect cashiers to `/pos`), settings nested routes with `Outlet`.
- `POSPage` is a full-screen route outside `AppShell` — added `BrowserRouter` and `ToastProvider` at app root level.
- TypeScript strict mode passes with zero errors (`npx tsc --noEmit`). Dev server starts cleanly on `http://localhost:5173/`.
- All destructive actions (delete product, void adjustment, create PO) use `<ConfirmDialog />`.
- Currency formatted as Philippine Peso (₱) via `formatCurrency()` with `en-PH` locale.
- **Decision:** Did not implement Supabase calls. All data comes from `mock-data.ts`. Real backend integration (Phase 1 backend wiring) is the next step after schema finalization.

---

**[2026-03-02] v0.1.0 — Initial Guideline Created**
- Drafted initial guideline from KodiGo system spec document
- Deferred database schema design until UI is finalized
- Established Phase 1/2/3 build plan
- Chose Supabase Realtime over pure polling as primary real-time strategy

---

## 13. AI Agent Instructions

You are building KodiGo. This document is your primary reference. Follow these instructions precisely.

### Before Starting Any Task
1. Read the relevant section(s) of this document for the feature you are building.
2. Check `Iteration Notes` (Section 12) for recent changes that may affect your work.
3. If the task is ambiguous or contradicts this document, **stop and flag the conflict** before proceeding.

### When Building UI
- Follow the Design System (Section 4) for all colors, typography, spacing, and component behavior.
- Use the component specs in Section 7 as blueprints. Implement them as described before inventing alternatives.
- Page layouts in Section 6 are the required structure — match them closely.
- All interactive elements must have loading, error, and empty states.
- Never hard-code data. All components must accept props and connect to real or mock data sources.

### When Building Backend / Supabase Logic
- Do not design or implement database schema until explicitly instructed and the relevant UI pages are complete.
- All Supabase queries should go through a dedicated `lib/supabase/` helper file — never write raw Supabase calls inline in components.
- Always apply Row Level Security logic when writing queries. Assume RLS is active.
- Use Supabase Edge Functions for any business logic (forecasting, scoring) that should not run on the client.

### When Adding a New Feature
1. Add the feature spec to the appropriate section of this document first.
2. Implement the feature.
3. Add an entry to Section 12 (Iteration Notes) describing what was added and any decisions made.
4. Bump the document version at the top.

### Code Quality Standards
- TypeScript everywhere. No `any` types unless absolutely necessary (comment why).
- Functional components only. Hooks for all state and side effects.
- Co-locate component styles with the component (Tailwind classes inline or in a `cn()` helper).
- Every form must have client-side validation before submitting to Supabase.
- Every destructive action (delete, void, adjust) must go through a `<ConfirmDialog />`.

### What to Never Do
- Do not add third-party libraries without documenting them in Section 3 (Tech Stack).
- Do not modify the Supabase schema without documenting the change and reason in Section 12.
- Do not build Phase 2 or Phase 3 features until all Phase 1 checkboxes in Section 11 are complete.
- Do not expose `SUPABASE_SERVICE_ROLE_KEY` in any client-side code.
- Do not write schema-coupled SQL directly in React components.

### Checklist Before Marking a Feature Done
- [ ] Feature matches spec in this document
- [ ] Component handles loading, error, and empty state
- [ ] TypeScript types defined in `src/types/`
- [ ] Supabase calls are in `lib/supabase/` helpers
- [ ] Iteration Notes updated
- [ ] No hardcoded test data left in production code

---

*End of KodiGo Build Guideline v0.2.2*
