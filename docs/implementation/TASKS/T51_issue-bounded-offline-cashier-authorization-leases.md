# T51 — Issue bounded offline cashier authorization leases

**Status:** Planned; implementation has not started.  
**Task ID:** T51  
**Feature:** Offline identity  
**Priority:** Critical  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T03](./T03_add-scoped-supervisor-capabilities-and-approval-guards.md), [T24](./T24_register-terminals-drawers-and-real-shift-opening.md), [T50](./T50_migrate-indexeddb-to-a-durable-encrypted-operation-outbox.md)

## Objective

Offline selling authority is bounded and explicit, with queued original identity retained and no new offline authentication.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/stores/authStore.ts`
- `kodigo-ui/src/lib/mfa.ts`
- `kodigo-ui/src/lib/offline-db.ts`

## Files to modify

- `kodigo-ui/src/stores/authStore.ts`

## New files

- `kodigo-ui/src/lib/offline-authorization.ts`
- `supabase/tests/enhancements/T51_offline_leases.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t51_offline_authorization_leases.sql`. Run the pinned CLI's verified `migration new t51_offline_authorization_leases` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M12 lease immutable authority snapshot keyed cashier/terminal/shift, issue/expiry/MFA/contract/catalog/sequence bounds; current profile membership/role rechecked on ingest.

## Backend work

`issue_offline_lease` creates an online-only `pending_stock` identity/time/sequence envelope for a cashier's own active shift. It cannot authorize an offline sale. T52 attaches exact lots and server-computed quote snapshots and atomically activates it. `revoke_offline_lease` and `get_offline_lease` require current store authorization; revocation never releases stock grants. Defaults are 8 hours and at most 100 terminal operations. No offline login, privilege elevation, approvals or digital service completion.

## Frontend work

Unlock existing local authorized session, show lease time/scope/expiry and stop new offline sale at limit. Protect pending work across logout; no role reassignment.

## Business rules

B09/D03. Offline revocation cannot be immediate; bounded exposure explicitly approved before feature on.

## Implementation steps

1. Add lease schema and online-only issue/revoke RPC.
2. Persist minimal immutable lease metadata in encrypted device store.
3. Gate offline UI on same actor/terminal/open shift and configured duration.
4. Test expired/revoked/foreign lease and reconnect authorization failures retaining queue.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Browser clock altered, offline cold reload, MFA challenge cannot complete, different cashier opens app, removed membership.

## Tests

V40,V41,V44,V52; backend never trusts client role or local time alone. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Offline selling authority is bounded and explicit, with queued original identity retained and no new offline authentication. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T51
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

