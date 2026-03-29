# FOR TECHNICAL VALIDATORS

**Generated:** 2026-03-29

---

## Executive Summary

KodiGo is a cloud-first Point-of-Sale (POS) and Inventory Management system targeted at small retail stores. The repository combines a modern React SPA (`kodigo-ui`) with a Supabase-focused backend design (Postgres + Auth + RLS + Edge Functions). The project implements multi-store tenancy, role-based access, offline-first POS queuing, supplier scoring, and analytics views.

This document is a validator-oriented, technical audit of the codebase and database artifacts present in the repository. It explains the architecture, important files, data model, RLS & security posture, triggers/functions, offline behaviour, outstanding issues, and an actionable validation checklist for technical reviewers.

---

## Repository Snapshot (important files)

- `supabase_schema.sql` — canonical DB schema (tables, enums, views, triggers, RLS policies).
- `migration_*.sql` — ordered migrations (01 → 17) containing feature and bug-fix deltas. Notable: `migration_02_super_admin.sql`, `migration_04_invite_creator_rls.sql`, `migration_07_multistore.sql`, `migration_08_multistore_rls.sql`.
- `supabase/functions/generate-invite/index.ts` — Deno Edge Function to generate admin invite codes (uses Service Role Key).
- `kodigo-ui/` — frontend SPA built with React + Vite.
  - `kodigo-ui/src/lib/supabase.ts` — Supabase client initialization (env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
  - `kodigo-ui/src/lib/offline-sync.ts` — IndexedDB offline queues and sync logic (`products_cache`, `sales_queue`, `generic_mutations`).
  - `kodigo-ui/src/lib/hardware.ts` — Web Serial code to open cash drawer.
  - `kodigo-ui/src/stores/*` — global stores using Zustand (`authStore.ts`, `productStore.ts`, `supplierStore.ts`, `cartStore.ts`, `alertStore.ts`).
  - `kodigo-ui/src/pages/*` — route-level pages including `POSPage.tsx`, `InventoryPage.tsx`, `SuppliersPage.tsx`, `SuperAdminPage.tsx`, `SettingsPage.tsx`, `LoginPage.tsx`, `RegisterPage.tsx`.
- `README.md`, `FULL_AUDIT.md` — project overview and an earlier audit.

Note: `kodigo-ui/package.json` lists runtime dependencies (React 19, Vite, Tailwind v4, @supabase/supabase-js ^2.x, zustand, @tanstack/react-query). Root `package.json` only contains a couple of small dependencies (`@heroicons/react`, `idb`).

---

## High-Level Architecture

- Frontend SPA (`kodigo-ui`) is the user-facing application. It communicates to Supabase via the `@supabase/supabase-js` client. Authentication uses Supabase Auth.
- Backend is a Supabase-managed Postgres instance with:
  - Row-Level Security (RLS) for tenant isolation and role separation
  - Triggers and functions for business logic (supplier scoring, updated_at maintenance)
  - Views for analytics (`v_daily_sales_summary`, `v_product_rankings`, etc.)
- Offline support is provided on the client via IndexedDB (using `idb`) with dedicated queues for sales and generic mutations.
- Edge function `generate-invite` (Deno) uses a Service Role Key to insert invite codes and ensures only `super_admin` users can create them.

Diagram (conceptual):

Client (Browser SPA) → Supabase JS (anon key) → Postgres (RLS enforced) → (Triggers, Views, Functions)

Offline: Client (IDB queues) → reconnect → syncPendingSales / syncPendingMutations → Supabase

---

## Data Model — Key Tables & Relationships

This section summarises the main tables (see `supabase_schema.sql` for complete definitions).

- `auth.users` — Supabase Auth users (provided by Supabase).
- `public.profiles` — one-to-one extension of `auth.users`. Columns: `id (uuid)`, `name`, `role (user_role)`, `avatar_url`, `created_at`, `updated_at`.
- `public.invite_codes` — pre-generated invite codes: `id`, `code`, `role`, `is_used`, `used_by`, `used_at`, `created_by`, `created_at`. RLS and creation handled carefully by migrations and edge function.
- `public.stores` — multi-store tenant table created by `migration_07`. Columns: `id`, `name`, `address`, `tax_rate`, timestamps.
- `public.store_users` — mapping table assigning `profiles` to `stores` (tenant membership). Unique constraint `(store_id, profile_id)`.
- `public.categories` — product categories (initially global in base schema; migrations may add `store_id` depending on applied migration).
- `public.suppliers` — supplier master data (scores computed in DB). Note: older schema does not include `store_id` (global), which has tenancy implications; migration_09 in the audit addresses adding `store_id`.
- `public.products` — product master with `sku`, `barcode`, `category_id`, `supplier_id`, pricing fields, and `current_stock`. After `migration_07`, `store_id` was added and set not-null.
- `public.sales` — sale header: `cashier_id`, `subtotal`, `tax`, `total`, `cash_received`, `change`, `created_at`, and `store_id` (tenant).
- `public.sale_items` — line items referencing `sales` and `products`. NOTE: The canonical schema does not include a DB trigger to deduct `products.current_stock` on sale by default — this was flagged by prior audit and a migration fix was recommended (`trg_deduct_stock_on_sale`).
- `public.stock_adjustments` — manual inventory adjustments with `reason`, `quantity_delta`, `stock_before`, `stock_after`, `created_by`, `store_id`.
- `public.stock_alerts` — auto-generated alerts when stock falls below thresholds.
- `public.purchase_orders` and `public.purchase_order_items` — POs and PO lines. Triggers exist to recalc supplier reliability and price scores on PO receive/cancel.

Indexes: product lookups use `sku`, `barcode`, `category_id`, and `supplier_id` indexes. Sales and other tables include `created_at` indexes for analytics.

---

## Security & Row-Level Security (RLS)

RLS is central to the platform for tenant isolation. Important constructs:

- `public.current_user_role()` — returns the role from `public.profiles` for `auth.uid()`.
- `public.is_admin()` — helper to check admin or `super_admin` presence.
- `public.user_belongs_to_store(target_store_id uuid)` — (created in migrations) checks whether `auth.uid()` is mapped to `store_users` for that store OR whether the user is `super_admin`.

Policies (high level):

- `profiles`: authenticated read allowed; update allowed for self or admins.
- `stores` and `store_users`: RLS enabled and scoped so a user sees assigned stores (super_admin sees all assigned or globally handled stores).
- `products`, `sales`, `stock_adjustments`, `purchase_orders`, `stock_alerts` etc.: policy sets were migrated to scoped read/write using `user_belongs_to_store(store_id)` or `current_user_role()` checks.
- `invite_codes`: stricter policy (migration_04) to ensure `super_admin` only manages invite codes they created. Edge function also enforces `super_admin` server-side checks.

Known or previously-observed RLS risks:

- Earlier migrations allowed an overly-broad `super_admin` policy for some tables. `FULL_AUDIT.md` and subsequent migrations recommend tightening `super_admin` access to only privileged operations (invite generation) and not normal store operations.
- `categories` and `suppliers` initially lacked `store_id` in `migration_07`, which permits global edits that can leak between tenants. Migration 09 (see audit docs) was suggested to add `store_id` and patch policies.

Validator actions for RLS checks are included in the Validation Checklist below.

---

## Triggers, Functions, Views (Important Business Logic)

- `public.handle_new_user()` — trigger attached to `auth.users` inserts: auto-creates `public.profiles` row, sets `role` based on invite codes found in `raw_user_meta_data`, inserts default notification preferences. SECURITY: defined as `security definer`.
- `public.recalc_supplier_reliability(p_supplier_id uuid)` and `public.recalc_all_price_scores()` — used to re-evaluate supplier scoring upon PO receive/cancel.
- `public.trg_po_received` — trigger for `purchase_orders` updates to call recalc functions.
- `set_updated_at()` — generic trigger used to maintain `updated_at` timestamps on multiple tables.
- Views: `v_product_stock_status`, `v_daily_sales_summary`, `v_category_sales`, `v_product_rankings` provide analytics aggregations used by the front-end.

Missing / recommended trigger (see Findings):

- `trg_deduct_stock_on_sale` — not present in `supabase_schema.sql` snapshot. This trigger should decrement `products.current_stock` atomically when `sale_items` are inserted (or when sales finalize) and insert a `stock_adjustments` record. Prior internal audit recommended adding such a trigger and migration (migration_09). Validators should confirm whether this migration has been applied to the target environment.

---

## Frontend Architecture — Key Points

- Entry: `kodigo-ui/src/main.tsx` mounts `App` (React Router + AppShell).
- Routing and Guards: `kodigo-ui/src/App.tsx` defines guarded routes via `RequireAuth`, `RequireAdmin`, `RequireSuperAdmin`, and `RequirePOSAccess`. Behavior depends on `useAuthStore` state (role, stores, activeStoreId).
- Global State (Zustand stores):
  - `authStore.ts` — session initialization, role resolution, store creation via RPC (`create_store_with_owner`), login/logout process, and store assignment management.
  - `productStore.ts` — product CRUD, fetch, categories handling (uses `executeOrQueueMutation` from `offline-sync`), caching to IDB.
  - `supplierStore.ts` — supplier CRUD and PO operations; uses DB RPC logic and `executeOrQueueMutation`.
  - `cartStore.ts` — cart items, subtotal, optimistic UI for POS.
  - `alertStore.ts` — stock alert fetch and mark-read logic.
- Offline: `offline-sync.ts` implements robust queuing for sales (`sales_queue`) and generic mutations (`generic_mutations`). Functions: `queueSaleOffline`, `syncPendingSales`, `queueMutationOffline`, `syncPendingMutations`, `executeOrQueueMutation`.
- Hardware: `hardware.ts` exposes `openCashDrawer()` using Web Serial API and ESC/POS commands (requires secure contexts and physical user gesture).

Important implementation notes:

- `kodigo-ui/src/lib/supabase.ts` creates a client with the ANON key for browser usage. Sensitive ops that bypass RLS use service role keys from server/Edge Functions only.
- Many store flows use `executeOrQueueMutation` to fall back to IDB queue when offline; however, not all front-end mutation paths are guaranteed identical in behavior (some optimistic updates and error handling differ between stores).

---

## Edge Function: Invite Code Generator

- Path: `supabase/functions/generate-invite/index.ts` (Deno).
- Behavior: Validates the requesting user via `supabaseClient.auth.getUser()` and confirms the user has `super_admin` role (via selecting profiles). Generates a random code `VIP-XXXXXX` and inserts into `invite_codes` table using a Supabase client initialized with `SUPABASE_SERVICE_ROLE_KEY` (server-only secret).

Security notes:

- The function expects `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY`/`SUPABASE_URL` in environment variables. The service role key MUST never be exposed to clients. Validate CI/CD or deployment steps to ensure the key is stored in the secret manager.

---

## Findings — Problems, Gaps, and Risks

1. Inventory stock deduction missing: the canonical snapshot does not include a `sale_items` -> decrement `products.current_stock` trigger. This leads to inventory drift unless client code deducts stock atomically (it currently does not). Recommended: add `trg_deduct_stock_on_sale` and associated `stock_adjustments` inserts.
2. Partial multi-tenancy: `migration_07` added `store_id` to many operational tables but left `categories` and `suppliers` global. This enables cross-tenant contamination. Recommended: add `store_id` to `categories` and `suppliers`, migrate existing rows with a safe default mapping or separate logic, and update RLS to enforce tenant-scoped reads/writes.
3. RLS misconfiguration risk: earlier migrations permitted broad `super_admin` capabilities. Ensure `super_admin` privileges are scoped to system-wide administrative functions (invite generation, admin-level monitoring) but *not* write access to other stores' operational data.
4. Offline mutation consistency: `offline-sync.ts` provides a generic mutations queue but several stores use optimistic local updates that may not always be reconciled identically on conflict (race conditions possible). Pay attention to error handling for `executeOrQueueMutation` where DB returns logical errors (the code throws them and does not queue).
5. Service role key exposure risk: verify CI/CD and Edge Function deployments do not leak `SUPABASE_SERVICE_ROLE_KEY`.

---

## Validator Checklist (step-by-step)

This checklist is actionable: follow the steps and mark pass/fail.

Preconditions: Ensure you have access to a Supabase project for validation (or a local Postgres instance), and a test user set for each role (cashier, admin, super_admin). Keep a service role key available for server-side operations.

1) Schema sanity
  - Verify `supabase_schema.sql` can be executed without error on a clean Postgres 15+ database.
    - Command (example):
      - `psql <your_connection_string> -f supabase_schema.sql`
  - Confirm `user_role` enum contains `super_admin` (migration_02 adds this). Query:
    - `SELECT unnest(enum_range(NULL::user_role));`

2) RLS policies behaviour (sample tests)
  - Test: As `cashier` user, attempt to SELECT from `products` for a store they do not belong to — expect zero rows.
  - Test: As `admin` mapped to Store A, attempt to INSERT `products` with `store_id = Store B` — expect permission denied.
  - Test: As `super_admin` (unless intentionally restricted), verify you cannot modify other stores if the system has tightened `super_admin` scope — expected behaviour depends on migration applied; validate against policy definitions.

3) Signup flow / invite codes
  - Test: Create an invite via `generate-invite` (Edge Function) or via service role insert. Use that code when calling `supabase.auth.signUp()` with `options.data = { name, invite_code }`. Verify `public.profiles` row created with role `admin` and `invite_codes.is_used` set to `true` and `used_by` populated.
  - Test: Try to sign up with invalid code — expect error from `handle_new_user()` trigger or signUp rejection.

4) Sales lifecycle
  - As `cashier` with active store mapping, create a sale using the web UI POS or `supabase.from('sales').insert(...)` with `store_id` set to the assigned store. Validate that `sale_items` rows are created.
  - Verify whether `products.current_stock` decrement occurs — if not present, this is a failing validation (requires migration 09 trigger).

5) Purchase Orders & supplier scoring
  - Insert a PO and then update `status` → `received` for that PO. Ensure `recalc_supplier_reliability` and `recalc_all_price_scores()` run and `suppliers` fields `reliability_score`, `price_score`, `overall_score` are updated.

6) Offline sync behavior
  - Simulate offline in browser (network throttling or turning network off). Create a sale with the POS; confirm it is stored in IndexedDB `sales_queue`.
  - Restore network, validate `syncPendingSales()` sends the sale to Supabase and removes the pending entry.

7) Edge function security
  - With a non-super_admin access token, call the Edge Function endpoint — expect `403`.
  - With `super_admin` credentials, call the Edge Function and ensure that the inserted `invite_codes.created_by` equals the `auth.uid()` that invoked the function (or that service-role insert recorded created_by accordingly).

8) Permissions & negative tests
  - As `cashier`, attempt to DELETE a sale — should be denied per RLS unless `admin`.
  - Attempt to update `profiles` of other users as `admin` or `cashier` depending on policy — confirm allowed/denied behaviours match policy definitions.

---

## Recommended Immediate Fixes (priority order)

1. Add `trg_deduct_stock_on_sale`: a Postgres trigger that decrements `products.current_stock` atomically when `sale_items` are inserted. Also insert corresponding row in `stock_adjustments` to preserve audit history.
2. Apply migration to add `store_id` to `categories` and `suppliers` (and backfill data safely), then update RLS to scope reads/writes to the store owner mapping.
3. Harden `super_admin` policies so `super_admin` cannot accidentally write to tenant operational tables; reserve `super_admin` for system-wide actions only.
4. Ensure `executeOrQueueMutation` consistently queues (instead of throwing) for network errors but surfaces DB rejections for logic errors — ensure uniform behaviour across stores.
5. Audit deployment for Edge Functions and CI to confirm `SUPABASE_SERVICE_ROLE_KEY` is secret and never present in client bundles.

---

## Useful Queries & Commands for Validators

- List tables and trigger functions:
  - `SELECT table_name FROM information_schema.tables WHERE table_schema='public';`
  - `SELECT proname FROM pg_proc WHERE proname LIKE 'trg_%' OR proname LIKE 'recalc_%';`
- Test `user_belongs_to_store`: run as a tenant user (use Supabase client with that user's session) and execute: `SELECT public.user_belongs_to_store('<store-uuid>');`
- Check RLS policies for a table:
  - `SELECT polname, polcmd FROM pg_policies WHERE tablename = 'products';`

---

## Deployment & Operational Notes

- Environment variables required for UI: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Edge Functions require: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` in server environment — the last one must remain secret.
- Recommended deployment flow:
  1. Apply schema migrations (in order) in a staging DB and run the validator checklist.
  2. Run migration that adds `store_id` to categories/suppliers in a transaction-safe manner: create new columns, backfill, alter not-null constraints, then drop the old global usage.
  3. Deploy frontend (Vite build) with proper `VITE_*` environment variables.

---

## Acceptance Criteria (for final signoff)

1. RLS enforced: Tenants cannot access or modify other tenant data, validated by role-based tests.
2. Invite workflow: `super_admin` can create invite codes; sign-up with code creates `profiles` correctly; invalid codes fail.
3. Inventory correctness: After sale commit, `products.current_stock` reflects sale quantities; an audit `stock_adjustments` entry exists.
4. Offline sync: offline-created sales are queued and reliably pushed after reconnection.
5. No secrets in client bundles: `SUPABASE_SERVICE_ROLE_KEY` is absent from any client-side code.

---

## Quick Next Steps I can run for you

If you want, I can now:

- Run the validator checklist automatically against a target Supabase instance (you must provide connection credentials / service role key and test user tokens).
- Produce a concise one-page executive summary (2–3 paragraphs) suitable for non-technical stakeholders.

---

End of report.
