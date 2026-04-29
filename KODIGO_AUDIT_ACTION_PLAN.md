# Kodigo Multi-Store and Offline Sync Action Plan

Status: updated 2026-04-29 after reviewing the current frontend, SQL migrations, and Supabase integration files.

This document is retained as a maintainer checklist for the multi-store and offline-sync refactor. Most items from the original action plan have been implemented; the remaining items are release-hardening tasks rather than initial build tasks.

## Implemented

- Multi-store tenancy:
  - `stores` and `store_users` exist in the migration chain.
  - Operational tables are scoped with `store_id` in later migrations.
  - Frontend auth state tracks `stores` and `activeStoreId`.
- Admin-only store management:
  - `create_store_with_owner()` creates a store and maps the current admin in one RPC.
  - Migration 16 resets store CRUD policies to admin-only behavior.
- Role-aware frontend routing:
  - `RequireAuth`, `RequireAdmin`, `RequireSuperAdmin`, and `RequirePOSAccess` live in `kodigo-ui/src/App.tsx`.
  - `super_admin` users are routed to `/super-admin`.
  - Admin users are routed away from POS on mobile.
- Store-scoped frontend data:
  - Product, supplier, purchase order, alert, dashboard, rankings, and analytics flows read the active store and scope queries when appropriate.
  - POS blocks checkout when the active store is `all`.
- Offline POS:
  - `kodigo-ui/src/lib/offline-sync.ts` stores cached products in IndexedDB.
  - Offline sales queue to `sales_queue`.
  - Generic offline mutations queue to `generic_mutations`.
  - `App.tsx` and the online event listener flush pending work when the browser returns online.
- Database-side stock and supplier logic:
  - Migration 09 adds `trg_deduct_stock_on_sale`.
  - Supplier reliability and price scores are recalculated through database functions/triggers.

## Remaining Release Work

- Replace placeholder admin user management:
  - `/settings/users` currently creates/edits local `User` objects and logs `createUser not implemented in authStore`.
  - Add a server-side Supabase Auth admin flow, likely via an Edge Function, before presenting this as production user management.
- Replace placeholder password change behavior:
  - `/settings/security` currently validates and shows success locally.
  - Wire it to Supabase Auth password update APIs.
- Consolidate invite generation:
  - The Edge Function exists at `supabase/functions/generate-invite/index.ts`.
  - The current `/super-admin` page inserts invite codes directly through the browser client under RLS.
  - Choose one supported path and document/deploy it consistently.
- Improve transaction atomicity:
  - `processSale()` inserts the sale header and sale items in separate client calls.
  - Consider a transaction RPC that writes header, items, and stock effects atomically.
- Harden offline conflict handling:
  - Current replay queues handle pending/error status, but they do not resolve complex conflicts such as deleted products or stale supplier records.
- Reconcile schema documentation:
  - `supabase_schema.sql` is still a baseline snapshot. Either regenerate a current consolidated schema after all migrations or keep documentation explicit that migrations are authoritative.

## Validation Checklist

- As `cashier`, confirm only POS access and assigned-store data visibility.
- As `admin`, confirm store CRUD, product CRUD, supplier CRUD, purchase order lifecycle, and analytics within assigned stores.
- As `super_admin`, confirm access to invite-code governance and no operational store CRUD in the final migration state.
- Process an online POS sale and verify `sales`, `sale_items`, stock deduction, and stock alerts.
- Process an offline POS sale, reconnect, and verify queue replay.
- Create, update, and delete a product or supplier while offline, then reconnect and verify generic mutation replay.
- Run `npm run build` and `npm run lint` from `kodigo-ui/` before release.
