# KodiGo Feature Reference

Document type: product and implementation reference
Updated: 2026-10-19
Referenced implementation: current repository state, including migrations 20261019120000 and 20261019120001

## Overview

KodiGo is a cloud-first POS, inventory, supplier, and analytics system for sari-sari stores and small retail branches. It is implemented as a React/Vite frontend backed by Supabase Auth and Postgres with store-scoped RLS.

## Implemented Roles

| Role | Access scope |
| --- | --- |
| `admin` | Store owner/operator. Manages assigned stores, inventory, suppliers, POs, analytics, and settings. |
| `cashier` | POS-focused role for assigned store operations. |
| `super_admin` | Invite-code governance only in the intended final policy state. |

`manager` appears in older planning docs but is not implemented in the current TypeScript role union or route guards.

## 1. Point of Sale

- Full-screen POS route at `/pos`, outside the normal admin shell.
- Requires a specific active store; the `all` store aggregation view cannot process sales.
- Product lookup supports manual search, SKU matching, and USB/Bluetooth barcode scanners that emit rapid keyboard input.
- Keyboard shortcuts:
  - `F2` focuses product search.
  - `F9` opens the payment modal when the cart has items.
  - Numeric key pre-entry sets a pending quantity multiplier.
- Cart supports add, remove, inline quantity changes, subtotal, item count, and charge flow.
- Payment flow creates a `Sale` payload with cashier identity, store ID, sale items, cash received, and change.
- `processSale()` writes online sales to Supabase or queues them in IndexedDB when offline/network-failed.
- Store-level POS settings independently control automatic browser receipt printing and cash-drawer integration. Drawer pulses go through the selected printer using QZ Tray; the local printer selection is stored per store in browser storage, not shared across cashiers. QZ Tray must be installed and running on each cashier computer. Both store toggles default to enabled for existing stores; saved receipt data stays available when printing is disabled.

## 2. Inventory Management

- Product list supports active-store filtering and a combined `all` view for admin aggregation.
- Products include SKU, optional barcode, category, unit, cost, selling price, stock thresholds, lead time, and optional supplier.
- Category management is store-scoped when a specific store is selected.
- Add, edit, delete, and stock-adjust flows write through Supabase-backed store logic.
- Product mutations use optimistic UI updates and `executeOrQueueMutation()` for offline/network fallback.
- Stock adjustment records capture reason, delta, before/after stock, note, creator label, and timestamp.
- Consignment stock is tracked in received lots with supplier, ownership, and historical unit cost. The full agreed value of each consigned receipt becomes a supplier payable immediately, whether units are sold or remain on hand. Sales, customer returns, and voids change stock quantities but do not create or erase that receipt liability.
- Supplier payments are stored in a separate ledger with partial payments, outstanding balances, and supplier credits; they reduce the payable without changing sales revenue or regular purchase workflows. The prior schema had no supplier-payment ledger, so the new ledger contains no imported historical payments.

## 3. Bulk Purchase and Per-Piece Selling

- The type model supports selling-unit fields and optional purchase-unit conversion fields:
  - `unit`
  - `purchaseUnit`
  - `conversionFactor`
- Stock is tracked in the smallest sellable unit.
- Restock and stock-adjustment UI can display purchase-unit context where conversion data is present.
- Some current Supabase mapping code does not persist every optional conversion display field; validate this before relying on bulk conversion in production reporting.

## 4. Dashboard and Monitoring

- Dashboard reads sales, products, and alerts from Supabase-backed stores.
- A reference date and Weekly, Monthly, or Yearly period control the sales metrics, trend chart, and recent transactions. Weeks run Monday through Sunday; boundaries use the browser's local timezone because the app has no store-timezone setting.
- The dashboard's Top 10 Best-Selling Products ranks monthly net base-unit quantities, subtracts returned quantities, excludes voided sales, and shows the month and year for the reference date.
- Stock alerts remain current-state inventory information and do not change with the sales reporting period.
- The app revalidates data on login, active-store changes, page focus, visibility changes, page show, and reconnect events.
- Supabase Realtime is a target architecture but is not consistently used across the current dashboard implementation.

## 5. Restocking and Purchase Orders

- Restocking suggestions are derived from current product data and thresholds.
- Suggested quantity follows the simple rule:

  ```text
  suggestedQty = max(reorderLevel * 2 - currentStock, reorderLevel)
  ```

- Admin users can create purchase orders grouped by supplier/store.
- Purchase orders support sent, received, and cancelled states.
- Marking a PO received updates PO status and relies on backend supplier-scoring triggers, followed by a supplier refetch.

## 6. Supplier Management

- Supplier CRUD is Supabase-backed and store-scoped.
- Supplier records include contact details, lead time, reliability score, price score, overall score, order totals, and delivery history fields.
- Supplier deletion checks linked purchase orders before deleting.
- Supplier scores are intended to be computed by database triggers/functions:
  - Reliability: on-time deliveries divided by received orders.
  - Price: normalized average product cost versus other suppliers.
  - Overall: weighted reliability and price score.

## 7. Analytics and Rankings

- `/analytics` supports Today, 7 days, 30 days, and 90 days.
- Analytics fetches sales, sale items, products, and categories to produce:
  - revenue/profit chart data
  - sales by hour
  - sales by category
  - recent transactions
- `/rankings` aggregates sale items by product for the selected period.
- Some analytics paths include unscoped fallback logging to diagnose store/RLS mapping issues. Review this before production hardening.

## 8. Sales and Inventory Reports

- The Sales Report shows Date, Product, Base Unit, Quantity, Unit Price, and Amount Paid, with date, product, and transaction-status filters. Voided sales are excluded; returned quantities and refunds reduce the reported results.
- Amount Paid is derived from recorded captured and refunded payment rows. Captures are allocated proportionally to each line's historical amount after sale discount. Recorded item-return amounts are assigned to their sale lines first; any remaining transaction-level refunds are allocated across the remaining captured line amounts. Cent remainders use a deterministic sale-item ordering, so line amounts sum to the payment ledger total.
- The PDF uses the same fully fetched, filtered line set and calculation as the screen, repeats its six-column header across pages, and reports the filtered Total Amount Paid. It formats currency with the `PHP` code because jsPDF's built-in font cannot render the Unicode peso symbol reliably.
- Inventory, stock movement, restocking, and price-history reports remain available in the separate Inventory & Stock Reports tab.

## 9. Stock Alerts

- Stock alert records are fetched from Supabase and joined to product names.
- Alerts track low, critical, and out-of-stock conditions.
- Alerts can be marked individually or all at once as read.
- Alert write/read behavior depends on final RLS policy state after migrations.

## 10. Authentication and Invite Flow

- Login uses Supabase email/password authentication.
- Registration requires an invite code and passes it through Supabase signup metadata.
- The signup trigger reads invite metadata, creates a `profiles` row, and marks valid invite codes as used.
- `authStore.ts` resolves roles from profile data and selected metadata fallbacks, then fetches mapped stores.
- Super-admin invite generation exists in two forms:
  - Edge Function: `supabase/functions/generate-invite/index.ts`
  - Current UI direct insert: `kodigo-ui/src/pages/SuperAdminPage.tsx`

Choose one production-supported invite path before release.

## 11. Settings

- General settings currently manage stores:
  - view assigned stores
  - create stores through `create_store_with_owner()`
  - update/delete stores through Supabase-backed `authStore` methods
- POS hardware settings independently control receipt printing and cash-drawer commands for the active store.
- Notification preferences are local UI state in the current screen.
- Password/security settings are local placeholder behavior.
- User management is local UI scaffolding and is not yet a production Supabase Auth admin flow.

## 12. Offline Support

- `products_cache` stores products for offline POS lookup.
- `sales_queue` stores offline sales.
- `generic_mutations` stores offline product/supplier/category/PO mutations.
- Online, visibility, focus, and page-show events attempt to revalidate and flush queues.
- Database/RLS errors are surfaced and not queued as if they were network failures.

## 13. Important Business Rules

- Operational data must be scoped by store membership.
- `super_admin` should not manage tenant store operations in the final policy state.
- POS sales require a specific active store.
- Service-role keys must never be exposed to the frontend.
- `supabase_schema.sql` is not enough to understand current RBAC; apply migrations in order.
- Destructive operations should use explicit confirmation in the UI.

## 14. Planned or Unfinished Work

- Production admin user creation/editing/removal.
- Production password-change flow.
- Single supported invite-code generation path.
- Transaction RPC for atomic POS sale header, line items, and stock effects.
- Stronger offline conflict resolution.
- Consistent Supabase Realtime subscriptions or documented polling strategy.
- Optional future role such as `manager`, if added to the database enum, TypeScript types, route guards, and RLS policies together.
