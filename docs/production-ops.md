# Production Operations

This runbook covers production backups, restore testing, error logging, audit logs, deployment checks, and rollback for KodiGo.

## Backups

- Enable Supabase daily physical backups for the production project.
- Before every schema deployment, create a manual database backup from Supabase Dashboard > Database > Backups.
- Keep a logical schema snapshot in source control by committing all ordered `migration_*.sql` files.
- Export business-critical tables weekly with `pg_dump` or Supabase scheduled backups: `stores`, `profiles`, `store_users`, `products`, `sales`, `sale_items`, `sale_payments`, `sale_returns`, `cashier_closeouts`, `stock_adjustments`, `purchase_orders`, and `audit_logs`.
- Store backup artifacts in a restricted bucket or external backup vault with at least 30 days of retention.

## Restore Procedure

1. Restore the latest production backup into a separate Supabase project or a temporary branch.
2. Apply any newer migrations that were not included in the backup window.
3. Validate row counts for stores, products, sales, sale items, and stock adjustments.
4. Run `npm run test:integration` with `RUN_INTEGRATION_TESTS=true` against the restored project.
5. Smoke-test login, POS checkout, void, refund, return, closeout, inventory update, and user management.
6. Promote the restored project only after DNS/API keys and Edge Functions are verified.

## Error Logging

- Client runtime errors are recorded through `public.log_client_error` into `public.error_logs`.
- The global browser listeners are installed from `kodigo-ui/src/lib/error-logging.ts`.
- Edge Functions should write operational failures to `console.error`; Supabase Edge Function logs are retained by the platform.
- Production triage starts with `error_logs` filtered by `created_at desc`, then Supabase Edge Function logs for `admin-users` and `generate-invite`.

## Audit Logs

- Transaction lifecycle operations write `sale_events` and `audit_logs`.
- User management Edge Function writes `audit_logs` for create, update, and removal.
- Closeouts write `audit_logs` with expected cash, counted cash, and variance.
- Treat `audit_logs` as append-only. Corrections should be new events, not row edits.

## Deployment Checklist

1. Confirm the working branch has all migrations, Edge Functions, and UI changes committed.
2. Run from `kodigo-ui/`: `npm ci`, `npm run typecheck`, `npm run lint`, `npm run build`.
3. Run integration tests against staging with `RUN_INTEGRATION_TESTS=true`.
4. Apply new SQL migrations to staging, then production.
5. Deploy Edge Functions: `admin-users` and `generate-invite`.
6. Verify environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and Edge Function `SUPABASE_SERVICE_ROLE_KEY`.
7. Smoke-test production with a low-value sale, receipt print, void, user list, and closeout.

## Rollback Plan

1. Stop the frontend rollout or redeploy the previous frontend build.
2. If an Edge Function is faulty, redeploy the previous function bundle from git.
3. If a migration caused data issues, restore production into a replacement project from the pre-deploy backup.
4. If only a new feature path is broken, disable access in the UI and keep core checkout online while preparing a hotfix.
5. Record the incident in `audit_logs` or the external incident tracker with impact, timeline, root cause, and follow-up actions.
