# T00 — Fingerprint schema and prove bootstrap order

**Status:** In progress; source manifest and read-only deployed baseline captured. A checksummed manifest replay job now provisions an ephemeral Supabase database in GitHub Actions; its first remote result and restored-clone comparison are pending.  
**Task ID:** T00  
**Feature:** Foundation  
**Priority:** Critical  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** None; recommended first task.

## Objective

A new implementer can bootstrap an isolated DB from an exact manifest and identify actual definitions; no production mutation. All unknown deployed facts explicitly recorded.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `README.md`
- `supabase_schema.sql`
- `migration_19_transaction_lifecycle_auth_ops.sql`
- `migration_34_bulk_purchase_base_units.sql`
- `migration_37_unit_aware_inventory_workflow.sql`
- `supabase/migrations/`
- `supabase/config.toml`
- `docs/production-ops.md`

## Files to modify

- `README.md`
- `docs/production-ops.md`
- `.github/workflows/ci.yml`

## New files

- `docs/implementation/SCHEMA_BASELINE.md`
- `supabase/bootstrap-manifest.json`
- `scripts/run-bootstrap-manifest.mjs`

## Database changes

M00 only: read schema/version/history and restore an isolated copy. Do not modify production. Record effective RPCs, trigger order, policies/grants, column precision and dependency hashes; do not invent migration33.

## Backend work

No feature endpoints. Produce an exact topological manifest including all root/datetime dependencies and a reviewed forward bootstrap correction only if evidence proves it necessary.

## Frontend work

None.

## Business rules

Deployed schema is unverified. Preserve full migrations and receipt/stock/consignment history; no baseline replay over populated DB.

## Implementation steps

1. Discover CLI/psql/server versions using --help; select an explicitly named disposable test target. The CI target is a temporary Supabase database in an isolated GitHub Actions runner, not a Supabase branch or project.
2. Capture effective schema/functions/triggers/RLS/grants and compare root/datetime definitions; record every precedence choice.
3. Restore clone and build empty isolated DB using ordered checksummed manifest; compare effective fingerprints and sample hashes.
4. Document exact supported bootstrap/restore commands and unresolved deployment differences; register the test target without credentials.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Dynamic November function patches depend on root37; alphabetical BEFORE triggers; incomplete migration history; absent CLI/local Docker; clone access unavailable.

## Tests

V47,V48,V51. Empty and restored paths must produce matching effective definitions, precision, membership/MFA and known historical fixtures. If clone access absent, keep dependent write rollout blocked and finish source manifest. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

A new implementer can bootstrap an isolated DB from an exact manifest and identify actual definitions; no production mutation. All unknown deployed facts explicitly recorded. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
Read-only: git status --short; supabase --version; supabase --help; psql --version. Execute only the disposable bootstrap commands recorded by this task.
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Revert this task's isolated code/document changes while retaining durable queue/ack/history artifacts. Keep existing working paths covered by regression tests; disable the new entry point if dependencies cannot be safely downgraded. Do not erase posted facts, pending cash operations or device recovery data.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

