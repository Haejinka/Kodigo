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
2. Identify the restored project by name/ref and verify it is isolated. Compare its actual migration history and effective schema to [`implementation/SCHEMA_BASELINE.md`](implementation/SCHEMA_BASELINE.md) and [`../supabase/bootstrap-manifest.json`](../supabase/bootstrap-manifest.json). Do not run a historical file, `db push`, `migration repair`, or the baseline until every discrepancy has a reviewed resolution.
3. Apply only reviewed forward changes to the restored project, using the installed, version-pinned Supabase CLI workflow after checking that version's `--help`. Keep the source manifest unchanged unless a restore-backed check proves a dependency correction is needed.
4. Validate schema fingerprints, row counts for stores, products, sales, sale items, and stock adjustments, plus representative receipt, lot-allocation, and consignment-payable fixtures.
5. Run `npm run test:integration` with `RUN_INTEGRATION_TESTS=true` only against this explicitly identified isolated restored project. The harness creates and removes Auth users and business rows.
6. Smoke-test login, POS checkout, void, refund, return, closeout, inventory update, and user management with clearly labelled test records. Never perform external settlement or financial transfers.
7. Promote the restored project only after schema, DNS/API keys, Edge Functions, authorization, and rollback checks are verified.

## Schema provenance gate

`supabase/bootstrap-manifest.json` is a checksummed source-order candidate, not a certified bootstrap. Exploratory replay in temporary GitHub Actions PostgreSQL containers reached root migration 21 and stopped because the file calls `MIN(uuid)`, which PostgreSQL 17 does not provide; no deployed SQL was applied. The user has directed that no fresh database be created, so bootstrap/restore proof remains pending. The repository has root migrations 01–32 and 34–40 (33 is absent) plus 20 timestamped migrations. The deployed KodiGo project runs PostgreSQL 17.6, has migration-history timestamps/names that differ from this checkout, and its `v_category_sales` definition does not match the candidate source. Keep it read-only for T00. Do not run the manifest or historical migrations against it.

The workspace used for the initial implementation check has no Supabase CLI, `psql`, or Docker command available. Record the version and `--help` output from the actual test host before choosing migration commands. Never place project credentials, login credentials, or database connection strings in this runbook.

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
