# Kodigo: Multi-Store & Offline Sync Action Plan

Based on the codebase audit, an extensive refactoring is required to support the target business model:
1. Multiple owners/admins managing one or multiple stores.
2. Cashiers restricted to viewing/editing data for their assigned branch.
3. Offline usage for the Point of Sale (POS) with a reliable back-sync mechanism to Supabase.

This document serves as the implementation checklist to refactor the entire stack from a single-store layout to a production-ready multi-tenant and offline-capable system.

---

## Phase 1: Database & RLS Restructuring (Backend)
The database must be migrated to a multi-tenant architecture using `store_id` as the isolation key.

- [x] **Draft Migration 07 (`migration_07_multistore.sql`)**: 
  - Drop the `store_settings` singleton table.
  - Create `stores` table (id, name, address, tax_rate).
  - Create `store_users` mapping table (store_id, profile_id).
  - Append `store_id` to operational tables (`products`, `sales`, `stock_adjustments`, `stock_alerts`, `purchase_orders`).
- [x] **Apply Migration 07**: Run the SQL via Supabase Dashboard or CLI.
- [x] **Rewrite RLS Policies for Tenant Isolation**:
  - `stores`: Admins/Owners see mapped stores. (Super Admin is reserved solely for generating invite codes).
  - `profiles`: Restrict visibility so cashiers only see profiles within their `store_id`.
  - `products`, `sales`, `stock_adjustments`: Must enforce `store_id` against the `store_users` mappings of `auth.uid()`.
- [x] **RPCs and Triggers updates**: Ensure trigger functions that assign roles also respect store mapping assignments, particularly during invite code redemptions.

---

## Phase 2: Auth State & Routing (Frontend)
The frontend relies heavily on a single global context. We need to introduce the concept of an `activeStore`.

- [x] **Update `types/index.ts`**: Add `Store`, `StoreUser` models, and inject `storeId` into all operational interfaces (`Product`, `Sale`, etc.).
- [x] **Update `authStore.ts`**:
  - Fetch `store_users` mappings upon successful login.
  - Determine and set the default `activeStoreId`.
  - Expose a `setActiveStoreId` method for Owners/Admins to switch contexts.
- [x] **Update `Topbar.tsx` / `Sidebar.tsx`**: Add a Store Selector UI dropdown for users with access to multiple stores (Owners/Admins). Cashiers mapped to a single store should have this disabled. (Super Admin is a separate role limited to creating invite codes only).

---

## Phase 3: Data Scoping (Frontend Stores)
Every fetch, insert, update, and delete operation must be explicitly scoped to the `activeStoreId`.

- [x] **`productStore.ts`**: Update `fetchProducts`, `addProduct`, etc., to use `.eq('store_id', activeStoreId)`.
- [x] **`cartStore.ts` & POS Logic**: Ensure the checkout payload attaches the `store_id` so sales fall under the correct branch. 
- [x] **`supplierStore.ts`**: Determine if suppliers are global or local per store. If global, update read access; if local, add `store_id` filtering.
- [x] **Analytics (`AnalyticsPage.tsx`)**:
  - Eagerly filter charts by `activeStoreId`.
  - Add an "All Stores" aggregation view exclusively for Owners/Admins owning multiple stores.

---

## Phase 4: Offline POS & Sync Engine (Critical)
Supabase JS does not handle offline queuing out of the box. A custom local-first queue must be built for the POS to function without an internet connection.

- [x] **Implement Local Database (`IndexedDB`)**: 
  - Set up a robust local wrapper (e.g., using `idb`) in `src/lib/offline-sync.ts`.
  - Create tables/stores for `sync_queue`, `cached_products`.
- [x] **Cache Required POS Data**: 
  - On login/refresh, cache the full catalog (`products`), `categories`, and `tax_rate` for the active store so the POS UI can render when offline.
- [x] **Intercept Checkout Logic (`POSPage.tsx` / `cartStore.ts`)**:
  - Check `navigator.onLine`.
  - If ONLINE: Proceed with normal Supabase insertion.
  - If OFFLINE: Generate temporary UUIDs, save the sale to the local `sync_queue` in IndexedDB, clear the cart, and show a success message.
- [x] **Background Sync Worker (`App.tsx` or Service Worker)**:
  - Add window event listeners for `'online'`.
  - When connection is restored, flush the `sync_queue` by batch inserting pending `sales` and `sale_items` to Supabase.
  - Handle conflict resolution or sync errors (e.g., product deleted while offline).

---

## Phase 5: Testing & QA
- [x] **Roles Test**: Verify a Cashier only sees their branch and cannot switch stores.
- [x] **Visibility Test**: Verify an Owner sees multiple branches and their cross-branch aggregated stock logic.
- [x] **Offline Flight Mode Test**:
  - Load the POS.
  - Disable network (Chrome DevTools -> Offline).
  - Process a sale (should succeed locally).
  - Enable network (should sync immediately in the background).
- [x] Make sure schema changes are captured in `supabase/migrations` for CI/CD tracking.

