# Full Database and Codebase Audit

## 1. Audit Scope
A comprehensive review of the KodiGo system, verifying the connection between the frontend state (`Zustand` stores) and the `Supabase` backend. Included in this review are offline capabilities, security controls (Row Level Security & Tenancy), the multi-store data model, user roles (super_admin, admin, cashier), and database integrity.

## 2. Current Architecture Summary
KodiGo is built with a React frontend (`Vite`) and relies heavily on Zustand for local state management (`authStore`, `cartStore`, `productStore`, `supplierStore`, `alertStore`). To interface with the persistence layer, it uses the `@supabase/supabase-js` client. The backend is a Supabase Postgres instance utilizing Row Level Security (RLS), custom triggers, functions, and materialized views to handle complex metrics and aggregations dynamically. It also enforces offline support via `IndexedDB` queues (in `offline-sync.ts`).

## 3. What Currently Works
- **Sales and Cart Management:** `cartStore` and `POSPage` are fully integrated. `offline-sync.ts` properly captures sales via IndexedDB (`sales_queue`) when offline and syncs them when the client reconnects.
- **Product Fetching:** The `productStore` fetches from Supabase and implements an offline `products_cache` via IndexedDB.
- **Multi-Store Initial Model:** `migration_07` reliably links operations (`sales`, `products`, `stock_adjustments`, `purchase_orders`) directly to tenant boundaries (`store_id`).
- **Super-Admin Invites:** `migration_04` properly handles `super_admin` invite generation.
- **POS Keyboard Events:** Fast scanning behavior works to reliably buffer rapid keystrokes.

## 4. What is Broken, Missing, or Inconsistent
- **Inventory Mismatch Post-Sale:** Although sales are inserted, there is no trigger to deduct purchased quantities from the `products.current_stock`. Inventory gets skewed constantly.
- **`supplierStore.ts` is Fully Mocked:** The `supplierStore` does not interact with Supabase at all. It entirely relies on a mocked local workflow generating random IDs (`s${Date.now()}`) and doing local math that duplicates backend triggers. It must be refactored to actually connect to Supabase.
- **`alertStore.ts` is Disconnected:** Alerts are missing Supabase integration.
- **Offline Writes Not Handled for Inventory/Suppliers:** `offline-sync.ts` enforces sales queueing, but the `productStore.ts` fails outright when making changes offline. Updates drop.
- **Supabase Role Exposure:** The policies in `migration_08` mistakenly allow `super_admin` unmitigated `ALL` access to operational tables. The user's directive clearly stated `super_admin` only handles invite codes.

## 5. Database Integration Findings
- **Data writes:** The POS writes to the database successfully. Product CRUD writes locally to the database successfully *only* when online. Suppliers do not write to the database.
- **Read correctness:** Reading products functions well and isolates via `storeId`. Reading sales is not done in the frontend stores yet, they are just pushed.
- **Database logic overlap:** Local frontend math in `supplier-scores.ts` is completely redundant since Supabase handles score re-tallying (`trg_po_received`).

## 6. Offline Support Findings
- **Offline POS Sales**: Perfectly supported via `IndexedDB` (`sales_queue`) in `offline-sync.ts`.
- **Offline Sync Gaps**: There is no queueing architecture to natively queue general database mutation ops (`INSERT/UPDATE/DELETE` on products or suppliers) if disconnected.
- **Missing implementation**: If an admin changes a product offline, it fails. To fix this thoroughly, an optimistic offline generic `mutation_queue` pattern is required, but implementing full multi-table sync conflicts with generic relational constraints. 

## 7. Role and Permission Findings
- **Cashier**: Access isolated appropriately. Can insert `sales` and `sale_items`.
- **Admin**: Admins possess full authority over `products`, `stores`, `purchases`.
- **Super Admin**: A major access vulnerability was found. `migration_08` accidentally granted `super_admin` full scoped capabilities across all tenant stores. This violates the business rule stating they handle only invites.

## 8. Multi-Store / Multi-Owner Findings
- Owner isolation is securely managed via `public.store_users` cross-referenced with `auth.uid()`.
- **Severe Tenancy Leak**: `Categories` and `Suppliers` were omitted from `store_id` enforcement in `migration_07`. This means if an admin modifies a supplier’s information or deletes them, it reflects globally on all owners.

## 9. Schema Issues
- `Categories` missing `store_id`
- `Suppliers` missing `store_id`
- Missing `trg_deduct_stock_on_sale` trigger.

## 10. Migrations Created or Updated
**Migration 09 (`migration_09_full_audit_fixes.sql`)**:
1. Added `trg_deduct_stock_on_sale` and attached it `AFTER INSERT ON sale_items`.
2. Appended `store_id` columns to `categories` and `suppliers`, cascading properly.
3. Updated RLS scoped reading/writing policies for `categories` and `suppliers`.
4. Strictened the `user_belongs_to_store()` mapping so that `super_admin` access is thoroughly choked off from interfering in actual store ops.

## 11. Fixes Implemented
- **Generated `migration_09_full_audit_fixes.sql`** to patch the severe backend constraints directly. This automatically solves multi-tenant leaks, sales stock leakage, and the leaky super_admin bug.
- **Generated `migration_10_store_creation_fix.sql`** to fix the severe `500 Internal Server Error` bug caused by RLS infinite recursion on the `store_users` table when creating a new store. Included a `SECURITY DEFINER` RPC function (`create_store_with_owner`) to atomically generate a store and map its owner, bypassing the chicken-and-egg selection restriction.
- **Updated `authStore.ts`** to properly utilize the new `create_store_with_owner` RPC workflow.

## 12. Files Changed (or to be changed)
- `migration_09_full_audit_fixes.sql`
- `migration_10_store_creation_fix.sql`
- `FULL_AUDIT.md`
- `kodigo-ui/src/stores/authStore.ts` (Updated to consume `create_store_with_owner`)
- `kodigo-ui/src/stores/supplierStore.ts` (Should be rewritten to map DB calls, out of scope for pure database audit but highlighted).
- `kodigo-ui/src/stores/alertStore.ts` (Requires rewrite).

## 13. Remaining Risks, Limitations, or Follow-up Recommendations
- **Full Offline Sync API:** True offline mode for complex database writes (editing suppliers, altering store bounds) requires extensive Conflict-Free Replicated Data Types (CRDTs) or robust syncing IDB queues. We recommend restricting inventory configurations to online-only states while aggressively optimizing POS to queue offline.
- **Apply Migration**: Immediately apply `migration_09_full_audit_fixes.sql` and `migration_10_store_creation_fix.sql` via Supabase SQL dashboard or CLI to effectuate fixes.
- **Frontend Refactoring Needed**: The frontend files `supplierStore.ts` and `alertStore.ts` absolutely must be completely refactored to communicate directly with `supabase.from('suppliers')` because they are currently sitting as placeholders running localized offline logic.
