# KodiGo Feature Reference

Document type: product and implementation reference
Updated: 2026-04-29
Referenced implementation: current repository state after migration 17

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
- Cash drawer support uses the Web Serial API and ESC/POS drawer-kick command through `openCashDrawer()`.

## 2. Inventory Management

- Product list supports active-store filtering and a combined `all` view for admin aggregation.
- Products include SKU, optional barcode, category, unit, cost, selling price, stock thresholds, lead time, and optional supplier.
- Category management is store-scoped when a specific store is selected.
- Add, edit, delete, and stock-adjust flows write through Supabase-backed store logic.
- Product mutations use optimistic UI updates and `executeOrQueueMutation()` for offline/network fallback.
- Stock adjustment records capture reason, delta, before/after stock, note, creator label, and timestamp.

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
- Summary cards show daily revenue, transaction count, average order value, and calculated profit.
- Recent transactions are fetched from `sales`.
- The current "Top Products" dashboard panel is based on stock quantity, not best-selling revenue. Use `/rankings` for sales-based product ranking.
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

## 8. Stock Alerts

- Stock alert records are fetched from Supabase and joined to product names.
- Alerts track low, critical, and out-of-stock conditions.
- Alerts can be marked individually or all at once as read.
- Alert write/read behavior depends on final RLS policy state after migrations.

## 9. Authentication and Invite Flow

- Login uses Supabase email/password authentication.
- Registration requires an invite code and passes it through Supabase signup metadata.
- The signup trigger reads invite metadata, creates a `profiles` row, and marks valid invite codes as used.
- `authStore.ts` resolves roles from profile data and selected metadata fallbacks, then fetches mapped stores.
- Super-admin invite generation exists in two forms:
  - Edge Function: `supabase/functions/generate-invite/index.ts`
  - Current UI direct insert: `kodigo-ui/src/pages/SuperAdminPage.tsx`

Choose one production-supported invite path before release.

## 10. Settings

- General settings currently manage stores:
  - view assigned stores
  - create stores through `create_store_with_owner()`
  - update/delete stores through Supabase-backed `authStore` methods
- Notification preferences are local UI state in the current screen.
- Password/security settings are local placeholder behavior.
- User management is local UI scaffolding and is not yet a production Supabase Auth admin flow.

## 11. Offline Support

- `products_cache` stores products for offline POS lookup.
- `sales_queue` stores offline sales.
- `generic_mutations` stores offline product/supplier/category/PO mutations.
- Online, visibility, focus, and page-show events attempt to revalidate and flush queues.
- Database/RLS errors are surfaced and not queued as if they were network failures.

## 12. Important Business Rules

- Operational data must be scoped by store membership.
- `super_admin` should not manage tenant store operations in the final policy state.
- POS sales require a specific active store.
- Service-role keys must never be exposed to the frontend.
- `supabase_schema.sql` is not enough to understand current RBAC; apply migrations in order.
- Destructive operations should use explicit confirmation in the UI.

## 13. Planned or Unfinished Work

- Production admin user creation/editing/removal.
- Production password-change flow.
- Single supported invite-code generation path.
- Transaction RPC for atomic POS sale header, line items, and stock effects.
- Stronger offline conflict resolution.
- Consistent Supabase Realtime subscriptions or documented polling strategy.
- Optional future role such as `manager`, if added to the database enum, TypeScript types, route guards, and RLS policies together.
