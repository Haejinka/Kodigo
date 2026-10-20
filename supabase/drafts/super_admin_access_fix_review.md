# Super Admin store access fix — review proposal

**Status:** local review draft only. The application and Edge Function changes are in the working tree, and the SQL is stored under `supabase/drafts` so Supabase will not deploy it as a migration. Nothing has been applied to the connected Supabase project. The reset remains on hold.

## What the audit found

The protected account is a `super_admin`, but the application deliberately separates that role from a store administrator:

- `public.create_store_with_owner` rejects every role except `admin`.
- The store insert policy accepts only `admin`; many operational RLS policies and `SECURITY DEFINER` functions also make exact `admin` or `admin`/`inventory` checks.
- `kodigo-ui/src/stores/authStore.ts` returns no stores for `super_admin`, even if the database grants access.
- `kodigo-ui/src/App.tsx` redirects Super Admin away from store pages to `/super-admin`; that page only manages invite codes.
- `supabase/functions/admin-users/index.ts` authorizes only `admin`, so the retained account cannot create the first store user through the app.

This means a database-only policy change would not let the Super Admin complete fresh setup.

## Proposed access model

Keep the account's `super_admin` role and its system-level invite-code capability. Add store operations only for stores to which that account is explicitly assigned.

1. Let the Super Admin create a store as its owner. The existing atomic store-creation RPC must create the `store_users` membership in the same transaction.
2. After membership exists, let Super Admin use store-admin operations for that store. Every read or write remains constrained by existing store membership, supplier ownership, or parent-record store scope.
3. Keep `public.current_user_role()` returning `super_admin`; do not alias it to `admin`, because existing invite-code and Super Admin behavior depends on the distinct role.
4. Preserve MFA checks. Do not add a blanket RLS bypass, unrestricted `USING (true)` policy, or service-role browser access.
   The inspected public reporting and consignment views use `security_invoker=true`, so the underlying table policies continue to scope their results.
5. Keep cashier and inventory accounts limited to their existing capabilities. Do not make `super_admin` a role that can be assigned or edited through user management.

## Prepared implementation scope

### Database draft

- Update `public.create_store_with_owner` to allow `admin` and `super_admin`, while setting the new store's `owner_id` to `auth.uid()` and inserting the caller's membership atomically.
- Add an authenticated insert policy for a Super Admin's own store (`owner_id = auth.uid()`). Keep existing admin policies intact.
- Extend the existing store-scoped policies for operational records. For child tables without `store_id`, keep the existing parent (`sales`, `purchase_orders`, or product) scope and require membership in that store. For supplier records, retain `owner_profile_id` and `supplier_stores` checks.
- Extend the existing role gates for store-admin RPCs to accept `super_admin` only when the target store/product belongs to the caller. The audit identified gates in `adjust_inventory_stock`, `close_cashier_shift`, `get_sales_velocity`, `process_pos_sale_v2`/`v3` (called by v4), `receive_product_stock`, `receive_purchase_order`, `record_consignment_supplier_payment`, `record_receipt_reprint`, `record_report_export_notification`, `refund_pos_sale`, `replace_product_suppliers`, `restock_product_inventory_v2`, `return_sale_items`, and `void_pos_sale`.
- Keep `current_user_role`, `is_admin`, invite-code policies, and notification visibility semantics unchanged unless a specific store-scoped check requires a separate policy.
- The SQL draft recreates only role-gated policies while preserving each policy's existing membership, parent-record, supplier-ownership, and MFA checks. It also updates the audited `SECURITY DEFINER` routines to use the MFA-aware `current_user_role()` where they had read a profile role directly.

### Application and Edge Function changes in the working tree

- Let a Super Admin load only stores returned by the store-membership RLS policy; remove the current hard-coded empty store list.
- Give the Super Admin access to the store workspace after selecting or creating an assigned store. Retain the Super Admin portal as a separate destination for invite-code administration.
- Update route guards, sidebar visibility, store selection, store settings, and role-specific admin controls so the user can create a store, manage its catalog and inventory, and process POS sales without changing the account's role.
- Update `admin-users` to allow a Super Admin to manage only users assigned to that Super Admin's stores. Continue requiring MFA when configured; reject attempts to alter or remove any `super_admin` account; continue restricting assignable roles to `admin`, `cashier`, and `inventory`.

## Review and rollout order

1. Review the scoped database draft and app/Edge Function changes in the working tree.
2. Approve any adjustments and deployment of the reviewed changes.
3. Apply the access fix and verify store creation, membership, store-scoped catalog/inventory operations, user management, and POS access for the Super Admin.
4. Reconfirm that the protected account remains unchanged and can still access the Super Admin portal.
5. Only then present the exact reset plan and obtain separate confirmation before deleting the other accounts or business data.

## Current data safety state

- No Supabase rows, Auth users, policies, or functions have been changed or deleted.
- The protected Super Admin account has not been modified.
- An encrypted pre-reset snapshot is available at `C:/Users/verga/.codex/backups/kodigo-reset-20261020T090954Z-3ba91b/kodigo-reset-pre-reset.dpapi`; its manifest is alongside it.
- The reset remains unexecuted pending implementation/review of this access fix and a later explicit confirmation for destructive deletion.
