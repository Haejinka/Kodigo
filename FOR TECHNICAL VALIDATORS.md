# For Technical Validators

Updated: 2026-04-29

This guide is for reviewers validating KodiGo's frontend, Supabase schema/migrations, RLS behavior, offline sync, and role-based flows.

## Executive Summary

KodiGo is a React/Vite POS and inventory system backed by Supabase Auth and Postgres. It implements multi-store tenancy, admin/cashier/super-admin role separation, offline POS queueing, product and supplier management, purchase orders, stock alerts, and analytics views.

The most important validation rule is that `supabase_schema.sql` is a baseline snapshot. The final runtime database state depends on applying the numbered root migrations in order, especially migrations 07 through 17.

## Important Files

| File or folder | Validation purpose |
| --- | --- |
| `kodigo-ui/src/App.tsx` | Route guards, auth bootstrap, active-store revalidation, and offline queue flush triggers. |
| `kodigo-ui/src/stores/authStore.ts` | Supabase session handling, role resolution, assigned stores, and store RPC usage. |
| `kodigo-ui/src/stores/productStore.ts` | Product/category CRUD, store scoping, optimistic updates, offline mutation queueing. |
| `kodigo-ui/src/stores/supplierStore.ts` | Supplier CRUD, purchase orders, PO status changes, supplier score refresh. |
| `kodigo-ui/src/stores/alertStore.ts` | Stock alert fetch and read-state updates. |
| `kodigo-ui/src/lib/offline-sync.ts` | IndexedDB product cache, sale queue, generic mutation queue, and replay behavior. |
| `kodigo-ui/src/components/pos/PaymentModal.tsx` | POS sale payload construction and `processSale()` call. |
| `kodigo-ui/src/pages/SettingsPage.tsx` | Store management plus placeholder user/password settings. |
| `kodigo-ui/src/pages/SuperAdminPage.tsx` | Current client-side invite-code generation UI. |
| `supabase/functions/generate-invite/index.ts` | Server-side invite-code Edge Function. |
| `migration_*.sql` | Authoritative schema, RLS, trigger, and RPC evolution. |

## Architecture to Validate

- Frontend SPA communicates with Supabase through the anon-key client in `kodigo-ui/src/lib/supabase.ts`.
- Supabase Auth provides sessions; `profiles.role` drives route access and policy checks.
- Store tenancy uses `stores`, `store_users`, and `store_id` scoping.
- Operational writes are intended to be admin-only within assigned stores, except POS sale creation for cashier workflows.
- `super_admin` is intended for invite governance, not normal store CRUD, after the final migrations.
- Offline support uses IndexedDB object stores:
  - `products_cache`
  - `sales_queue`
  - `generic_mutations`

## Database Validation Notes

Apply migrations in order before judging final behavior:

1. Start from `supabase_schema.sql` only when creating a fresh baseline.
2. Apply `migration_01_invite_codes.sql` through `migration_17_add_suppliers_updated_at.sql`.
3. Inspect final definitions for:
   - `public.user_belongs_to_store(target_store_id uuid)`
   - `public.can_view_store_users(target_store_id uuid)`
   - `public.create_store_with_owner(text, text, numeric)`
   - `public.trg_deduct_stock_on_sale()`
   - supplier scoring functions and PO triggers

Do not assume policies in `supabase_schema.sql` are final. Later migrations intentionally drop and recreate several policies.

## Validation Checklist

### 1. Build and environment

- Confirm `kodigo-ui/.env.local` defines `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- From `kodigo-ui/`, run:

  ```bash
  npm run build
  npm run lint
  ```

### 2. Auth and routing

- Unauthenticated users must redirect to `/login`.
- `admin` should land on `/dashboard`.
- `cashier` should land on `/pos`.
- `super_admin` should land on `/super-admin`.
- Admin users on mobile should be redirected away from `/pos`.
- Cashiers should not access admin-shell routes.

### 3. Store tenancy and RLS

- As Admin A assigned to Store A, read and write Store A products.
- As Admin A, attempt to write Store B products and suppliers; expect denial.
- As Cashier A, process sales for assigned store but deny admin CRUD.
- As Super Admin, validate invite-code access and verify no normal operational store CRUD in the final policy state.
- Validate `create_store_with_owner()` creates a store and maps the current admin.

### 4. POS sale lifecycle

- With a specific active store selected, complete an online cash sale.
- Verify a `sales` row and matching `sale_items` rows are inserted.
- Verify product stock decreases through `trg_deduct_stock_on_sale` after line-item insert.
- Verify the cart clears only after the success flow completes.
- Confirm POS blocks checkout when active store is `all`.

### 5. Offline behavior

- Load products online so `products_cache` is populated.
- Simulate offline mode in browser devtools.
- Complete a POS sale; verify it appears in `sales_queue`.
- Restore network; verify `syncPendingSales()` replays the sale and removes the pending queue item.
- Test a product or supplier mutation offline; verify it is written to `generic_mutations` and replays after reconnect.
- Confirm database/RLS errors are surfaced instead of silently queued.

### 6. Supplier and PO flow

- Create a supplier under an active store.
- Generate a purchase order from restocking or supplier detail flow.
- Mark a PO as received and verify supplier reliability/price score refresh after backend triggers run.
- Attempt to delete a supplier with linked POs and confirm the UI/database rejects unsafe deletion.

### 7. Invite governance

- Validate the current `/super-admin` UI direct-insert path under RLS.
- Separately validate the Edge Function path if it is deployed:
  - Non-super-admin token should receive `403`.
  - Super-admin token should create an invite code with the correct `created_by`.
- Choose one production path before release to avoid divergent behavior.

## Current Known Gaps

- `/settings/users` is still local UI scaffolding, not a production Supabase Auth admin workflow.
- `/settings/security` validates locally and shows success without changing the Supabase password.
- POS sale writes are not currently wrapped in a single transaction RPC.
- Offline replay has limited conflict resolution for stale or deleted records.
- `supabase_schema.sql` needs regeneration if the project wants a single consolidated schema artifact.

## Release Acceptance Criteria

- Migration chain applies cleanly in staging.
- Role-based route and RLS tests pass for `admin`, `cashier`, and `super_admin`.
- POS sale writes, stock deduction, and offline replay pass.
- Store CRUD works for admins and does not grant super-admin operational access.
- No service-role key appears in frontend source, Vite env files, or client bundles.
