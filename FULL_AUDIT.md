# Full Database and Codebase Audit

Status: historical audit record, refreshed 2026-04-29 for current implementation accuracy.

This file records the original multi-store/database audit and the follow-up state after later migrations and frontend rewrites. For day-to-day architecture and RBAC guidance, prefer `KODIGO_SYSTEM_RBAC_UML_CFD_DFD_GUIDE.md`.

## Scope

The audit covers:

- Supabase schema, migrations, RLS policies, triggers, and functions.
- Frontend stores and route guards in `kodigo-ui/src`.
- Offline queues in `kodigo-ui/src/lib/offline-sync.ts`.
- Multi-store tenancy, role separation, and invite-code governance.

## Current Architecture Summary

KodiGo is a React/Vite SPA backed by Supabase Auth and Postgres. Zustand stores coordinate local UI state and Supabase reads/writes. IndexedDB is used for offline POS sales and generic mutation replay. Later migrations add multi-store tenancy, tighten RLS, create store-management RPCs, and add database-side stock/supplier logic.

Important source-of-truth rule:

- `supabase_schema.sql` is a baseline schema snapshot.
- The numbered migrations are authoritative for the current database behavior.

## Issues Found by the Original Audit

The original audit identified these high-impact problems:

- Sales inserted into the database did not automatically deduct product stock.
- `categories` and `suppliers` were originally global, creating cross-tenant leakage risk.
- Earlier RLS policies gave `super_admin` broader store-operation access than intended.
- Store creation could fail because the user/store mapping did not exist yet.
- Supplier and alert flows were not fully backed by Supabase at the time.
- Offline support initially focused on POS sales and did not cover general mutations.

## Fixes Implemented Since the Original Audit

- `migration_09_full_audit_fixes.sql`
  - Adds `trg_deduct_stock_on_sale`.
  - Adds `store_id` to categories and suppliers.
  - Scopes category/supplier policies by store membership.
  - Removes super-admin operational shortcuts from `user_belongs_to_store()`.
- `migration_10_store_creation_fix.sql`, `migration_13_fix_store_creation.sql`, `migration_15_fix_store_admin_access.sql`, and `migration_16_fix_store_policies_final.sql`
  - Stabilize `create_store_with_owner()`.
  - Reset store and store-user policies.
  - Harden cascade-safe delete behavior with `pg_trigger_depth()`.
  - Finalize admin-only store CRUD.
- `migration_11_role_fixes.sql` and `migration_12_revert_super_admin.sql`
  - Document the temporary expansion and later rollback of `super_admin` operational permissions.
- `migration_17_add_suppliers_updated_at.sql`
  - Adds and maintains `suppliers.updated_at`.
- Frontend updates
  - `authStore.ts` uses Supabase Auth, role resolution, assigned stores, active-store selection, and the store creation RPC.
  - `productStore.ts`, `supplierStore.ts`, and `alertStore.ts` use Supabase-backed flows.
  - `offline-sync.ts` now includes both `sales_queue` and `generic_mutations`.

## Current Remaining Risks

- User management in `/settings/users` remains a local UI scaffold and is not a production Supabase Auth admin flow.
- Password changes in `/settings/security` are still local placeholder behavior.
- The invite-code flow has two implementations: the Edge Function and direct client insert from `/super-admin`. Choose and document one supported production path.
- POS sale creation is not wrapped in one transaction RPC; sale header and line items are inserted separately.
- Offline conflict handling is basic. The queue tracks pending/error status but does not perform semantic conflict resolution.
- The baseline schema can mislead maintainers unless they understand the migration chain overrides it.

## Files to Review During Release Hardening

- `kodigo-ui/src/App.tsx`
- `kodigo-ui/src/stores/authStore.ts`
- `kodigo-ui/src/stores/productStore.ts`
- `kodigo-ui/src/stores/supplierStore.ts`
- `kodigo-ui/src/stores/alertStore.ts`
- `kodigo-ui/src/pages/SettingsPage.tsx`
- `kodigo-ui/src/pages/SuperAdminPage.tsx`
- `kodigo-ui/src/components/pos/PaymentModal.tsx`
- `kodigo-ui/src/lib/offline-sync.ts`
- `migration_09_full_audit_fixes.sql`
- `migration_16_fix_store_policies_final.sql`
- `migration_17_add_suppliers_updated_at.sql`
