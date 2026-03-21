# KodiGo — Feature Reference
> **Document Type:** Research & Feature Overview
> **Last Updated:** 2026-03-04
> **System Version Referenced:** KodiGo v0.2.2

---

## Overview

**KodiGo** is a cloud-based Point-of-Sale (POS) and Inventory Management System designed for high-volume sari-sari stores (small retail stores common in the Philippines). It targets store owners who need fast transaction processing, real-time inventory visibility, and remote monitoring from any device.

---

## User Roles

| Role | Access Scope |
|------|-------------|
| **Admin (Owner)** | Full access — analytics, suppliers, users, all settings |
| **Cashier** | POS only — process sales, view product info |
| **Manager** *(Phase 3)* | Inventory + basic analytics; no supplier or user management |

---

## Feature Categories

1. [Point of Sale (POS)](#1-point-of-sale-pos)
2. [Inventory Management](#2-inventory-management)
3. [Dashboard & Monitoring](#3-dashboard--monitoring)
4. [Restocking & Forecasting](#4-restocking--forecasting)
5. [Supplier Management](#5-supplier-management)
6. [Sales Analytics](#6-sales-analytics)
7. [Product Rankings](#7-product-rankings)
8. [Stock Alerts](#8-stock-alerts)
9. [Authentication & User Management](#9-authentication--user-management)
10. [Settings](#10-settings)
11. [Planned Features (Phase 3)](#11-planned-features-phase-3)

---

## 1. Point of Sale (POS)

The POS is the core transaction interface used by cashiers. It runs as a full-screen, sidebar-free layout optimized for speed and touch use.

### 1.1 Product Search & Selection
- **Barcode scanner support** — USB and Bluetooth scanners work out of the box via a hidden global `<input>` that captures rapid keystroke sequences and triggers product lookup on `Enter`.
- **Manual search** — Debounced text search by product name or SKU.
- **Product grid** — Visual grid of product tiles showing image, name, and price for quick tap selection.

### 1.2 Cart Management
- Add products to cart by scanning, searching, or tapping.
- Adjust item quantity with a stepper control per cart row.
- Remove individual items from the cart.
- Live-calculated **subtotal**, **tax**, **discount**, and **total** displayed at all times.
- Cart resets automatically after a completed transaction or on **[New Transaction]**.

### 1.3 Payment Flow
- **[Charge / Pay]** button initiates payment.
- `<PaymentModal>` displays the full itemised order and total.
- Cashier enters cash amount tendered; change is calculated automatically.
- Quick-amount buttons for common cash denominations speed up entry.
- On **[Confirm Payment]**:
  - A complete `Sale` record is built, capturing `cashierId` and `cashierName` from the active session at the moment of confirmation.
  - Stock deduction is applied.
  - *(Supabase write pending — Phase 1 backend wiring)*
- **Receipt / Success screen** shows: Cashier name, Transaction ID, timestamp, and change amount.
- Option to **[Print Receipt]** or start a **[New Transaction]**.

### 1.4 POS Session Management
- Cashier **[Logout]** button in the POS topbar (top-right).
- A confirmation dialog warns that unsaved cart items will be lost before logging out.
- Confirms → session ends, redirected to `/login`.

### 1.5 Hardware Integration
- Designed for integration with **receipt printers** and **cash drawers**.
- Compatible with USB and Bluetooth barcode scanners — no driver installation required.

---

## 2. Inventory Management

### 2.1 Product Catalogue
- Full product list displayed in a sortable, paginated, searchable table.
- **Columns:** Name, SKU, Stock, Min Stock, Price, Cost, Actions.
- Filter by category and stock status (in-stock / low / critical / out-of-stock).
- Add, edit, and delete products.

### 2.2 Product Fields
Each product record stores:
- Name, SKU, Barcode
- Category, Unit of measure
- Cost Price, Selling Price
- Current Stock, Minimum Stock Level, Safety Stock
- Reorder Level, Lead Time (days)
- Assigned Supplier(s)
- Optional: `purchaseUnit`, `conversionFactor` (for bulk-split products)

### 2.3 Bulk-Purchase / Per-Piece Selling
For products bought in bulk but sold individually (e.g., cigarettes per pack of 20, sold per stick):
- **Stock is always tracked in the smallest sellable unit** (sticks, pieces, sachets).
- **Cost price is entered per purchase unit;** the system derives `costPerSellingUnit = costPrice / conversionFactor`.
- **Selling price is per selling unit.** The POS charges per piece regardless of pack size.
- During stock adjustment (Restock reason), a toggle lets the user "Enter in packs" — the system auto-converts to pieces with a live preview (e.g., *"5 packs × 20 = +100 sticks"*).
- Restocking page shows quantities in both units (e.g., *"Order: 3 packs (60 sticks)"*).

### 2.4 Stock Adjustment
- Adjustment modal accessible from product detail or inventory list.
- **Reason selector:** Damaged | Expired | Lost | Manual Count | Restock | Other.
- Positive or negative quantity delta.
- Optional memo/note field.
- Every adjustment is logged to a full **audit trail** with timestamp, reason, delta, and note.

### 2.5 Stock Adjustment Log
- Viewable from the product edit page.
- Filterable by reason and direction (increase / decrease).
- Searchable by product name or note text.
- Color-coded delta arrows (green = increase, red = decrease).

### 2.6 Margin Preview
- The product form shows a live **profit margin preview** that updates as cost and selling prices are adjusted.
- For bulk-split products, margin correctly uses `costPerSellingUnit`, not the raw cost price.

---

## 3. Dashboard & Monitoring

The dashboard gives the store owner a real-time overview of store performance.

### 3.1 Summary Stat Cards
Four top-level metrics displayed as stat cards:
| Metric | Description |
|--------|-------------|
| Today's Revenue | Total revenue for the current day |
| Transaction Count | Number of completed sales today |
| Average Order Value | Revenue ÷ transaction count |
| Today's Profit | Revenue minus cost of goods sold |

Each card shows a trend indicator (percentage change vs. the previous comparable period) with green (up) / red (down) color coding.

### 3.2 Revenue Chart
- Line chart showing revenue for the last 30 days.
- Hover tooltip with date and formatted revenue.

### 3.3 Top 5 Products (Mini Ranking)
- Quick-glance list of the top 5 best-selling products by revenue for the current period.

### 3.4 Low Stock Alerts Panel
- Scrollable list of products currently at low, critical, or out-of-stock levels.
- Links directly to restocking page.

### 3.5 Remote Monitoring
- Dashboard auto-refreshes every 10 seconds via Supabase Realtime or polling fallback.
- Accessible from any device on any browser — owner can monitor the store remotely.
- Real-time inventory update latency target: < 1 second.

---

## 4. Restocking & Forecasting

### 4.1 Restock List
- Auto-generated list of products that have fallen below their reorder level.
- Derived live from the product store — no manual entry needed.

### 4.2 Forecasting Engine
- Suggested restock quantity formula:
  ```
  suggestedQty = max(reorderLevel × 2 − currentStock, reorderLevel)
  ```
- Each row in the restock list shows: Product, Current Stock, Suggested Qty, Suggested Supplier.

### 4.3 Purchase Order Generation
- **[Create Purchase Order]** button on each restock row.
- Generates a PO assigned to the best-scored supplier for that product.
- PO is stored and visible on the Supplier Detail page.

### 4.4 PO Lifecycle
| Status | Trigger |
|--------|---------|
| Pending | Created via restocking page |
| Received (On Time / Late) | Marked by admin on supplier detail page |
| Cancelled | Cancelled before receipt |

---

## 5. Supplier Management

### 5.1 Supplier Catalogue
- Full list of suppliers in a sortable, searchable table.
- Add, edit, and delete suppliers.

### 5.2 Supplier Fields
- Name, Contact Person, Email, Phone, Address
- Lead Time (days)
- Assigned products
- Auto-computed scores (read-only)

### 5.3 Supplier Scoring Algorithm
Scores are **always auto-computed** — never manually entered.

| Score | Formula |
|-------|---------|
| **Reliability Score** | `(onTimeDeliveries / totalOrders) × 100` — defaults to 100 for new suppliers |
| **Price Score** | Normalised average cost vs. all other suppliers (100 = cheapest, 0 = most expensive) |
| **Overall Score** | `reliabilityScore × 0.6 + priceScore × 0.4` |

Scores are recalculated automatically when a PO is marked as received and when product costs change.

### 5.4 Supplier Detail Page
- Full profile with all fields and current scores.
- Complete **Purchase Order history** — date, items, status, on-time flag.
- Score history context (reliability driven by PO outcomes).

---

## 6. Sales Analytics

Accessible to Admin. Covers all historical sales data with filterable date ranges.

### 6.1 Summary Stats Row
Four cards mirroring the dashboard but scoped to the selected date range:
- Total Revenue, Total Transactions, Average Order Value, Total Profit.

### 6.2 Revenue Trend Chart
- Line chart of revenue over the selected period.
- Profit overlay available on the same chart.

### 6.3 Sales by Hour (Bar Chart)
- Distribution of sales volume by hour of the day.
- Useful for staffing and promotional timing decisions.

### 6.4 Sales by Category (Donut Chart)
- Revenue or unit share broken down by product category.

### 6.5 Transactions Table
- Full filterable list of individual transactions.
- Columns: Transaction ID, Cashier, Date/Time, Items, Total.
- Searchable and sortable.

---

## 7. Product Rankings

### 7.1 Top Products Table
- Configurable period: **Daily | Weekly | Monthly**.
- Configurable limit (default top 10).
- Columns: Rank, Product Name, Units Sold, Revenue, % of Total Revenue.

### 7.2 Use Cases
- Identify best sellers for promotional focus.
- Spot slow-moving items for markdown or discontinuation.
- Feed into supplier negotiation (high-volume = leverage).

---

## 8. Stock Alerts

### 8.1 Alert Types
| Type | Condition |
|------|-----------|
| **Low Stock** | Current stock ≤ Minimum Stock Level |
| **Critical Stock** | Current stock ≤ Safety Stock |
| **Out of Stock** | Current stock = 0 |
| **Overstock** *(planned)* | Current stock significantly exceeds max threshold |

### 8.2 Alert Surfaces
- **Sidebar badge** — unread alert count on the Restocking nav item.
- **Topbar bell icon** — total unread count; clicking opens alert dropdown.
- **Dashboard alerts panel** — scrollable list of current alerts.
- **Inventory table rows** — color-coded stock status badge per product.

### 8.3 Alert Management
- Mark individual alerts as read.
- Mark all alerts as read in one action.
- Alerts auto-regenerate when stock levels change.

---

## 9. Authentication & User Management

### 9.1 Login
- Email and password authentication.
- Role-based routing on login:
  - **Admin** → `/dashboard`
  - **Cashier** → `/pos`
- Admin accessing POS on mobile is redirected to `/dashboard` (POS is desktop/tablet optimized).

### 9.2 Role-Based Access Control
- Route guards enforce role restrictions throughout the app.
- Admin-only routes: Dashboard, Inventory, Restocking, Suppliers, Analytics, Rankings, Settings.
- Cashier-only route: `/pos`.

### 9.3 User Management (Admin)
Accessible at `/settings/users`:
- View all users with name, email, role, and avatar.
- **Edit User** — modify full name, email, and role.
- **Invite User** — send invite by email; user is added to the list immediately (pending real email integration).
- **Remove User** — remove from the system (with confirmation dialog).

---

## 10. Settings

The settings section is divided into four sub-pages:

| Sub-page | Path | Description |
|----------|------|-------------|
| **General** | `/settings` | Store name, currency, timezone, and other global preferences |
| **User Management** | `/settings/users` | Invite, edit, and remove users |
| **Notification Preferences** | `/settings/notifications` | Configure which alerts trigger notifications and through which channel |
| **Password & Security** | `/settings/security` | Change password, manage session security |

---

## 11. Planned Features (Phase 3)

These features are on the roadmap but not yet implemented:

| Feature | Description |
|---------|-------------|
| **Predictive Supplier Picker** | Automatically recommend the best supplier per product based on current scores and lead time |
| **Sales Trend Analysis** | Seasonality detection, week-over-week growth rate, and trend visualization |
| **Inventory Performance Classification** | Tag products as fast-moving, slow-moving, or dead stock based on sales velocity |
| **Automated Email Alerts** | Send low-stock or critical-stock notifications to the store owner via email |
| **Manager Role** | A middle-tier role with inventory + basic analytics access but no supplier or user management |
| **Multi-Device / Multi-Cashier Sessions** | Support concurrent cashier sessions across multiple devices with real-time consistency |
| **Dark Mode** | Optional dark theme for low-light environments |

---

## Performance Targets

| Operation | Target |
|-----------|--------|
| POS transaction write (end-to-end) | < 2 seconds |
| Dashboard initial load | < 3 seconds |
| Real-time inventory update latency | < 1 second |
| Dashboard auto-refresh interval | Every 10 seconds |

---

## Key Business Rules

1. **Stock is always tracked in the smallest sellable unit.** Bulk conversion happens at input boundaries (adjustment modal), not inside the ledger.
2. **Supplier scores are always auto-computed.** No manual score entry is permitted anywhere in the UI.
3. **Every destructive action requires confirmation.** Delete, void, stock adjustment, PO cancel — all go through a `<ConfirmDialog>`.
4. **Cost-based margin calculations use `costPerSellingUnit`**, not the raw purchase cost, for bulk-split products.
5. **Cashier identity is captured at payment time**, not at cart creation — the `Sale` record always reflects who processed the transaction.
6. **POS cart survives navigation** within the POS session but is cleared on logout (with explicit warning to the cashier before logout is confirmed).

---

*End of KodiGo Feature Reference*
