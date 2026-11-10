# T02 — Add operation identity and replay contract

**Status:** In progress; typed command/result contracts, server operation tables/helpers, and the read-result RPC are implemented and applied to the existing deployed project. Domain write wrappers and isolated replay/concurrency proof remain pending.
**Task ID:** T02  
**Feature:** Transaction foundation  
**Priority:** Critical  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T01](./T01_add-guarded-enhancement-test-harness.md)

## Objective

One committed result per operation; changed semantic request cannot reuse ID; locally recorded type cannot enter confirmed branch.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `supabase/migrations/20261021055145_fix_pos_item_discount_snapshots.sql`
- `kodigo-ui/src/lib/offline-sync.ts`
- `kodigo-ui/src/types/index.ts`

## Files to modify

- `kodigo-ui/src/types/index.ts`

## New files

- `kodigo-ui/src/types/operations.ts`
- `kodigo-ui/src/lib/pos-operations.ts`
- `supabase/tests/enhancements/T02_operations.sql`
- `kodigo-ui/scripts/unit/pos-operations.test.mjs`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t02_pos_operations.sql`. Run the pinned CLI's verified `migration new t02_pos_operations` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M01 pos_operations/pos_operation_events and server flags: UUID/store/actor/kind/hash/result, metadata, uniqueness and append-only events. Nullable future terminal/shift FKs are attached later.

## Backend work

Implement private begin/finish command helpers and get_pos_operation. Canonicalize typed semantic fields, server hash, auth/scope/hash equality, transactional advisory lock and persisted response. Minimal public definer wrappers per A03.

## Frontend work

Typed server confirmed/pending_external result versus recordedLocally union; synchronization adapter has its own durable conflict/auth state mapping. Do not migrate checkout yet.

## Business rules

A02, B01/B09. Lost response repeats same ID; different body/actor/store rejects, rollback leaves no committed success.

## Implementation steps

1. Create additive schema/grants/RLS and private helpers with blank search_path.
2. Define validation/error details and canonical JSON fixtures.
3. Implement read-result RPC and typed adapter returning decimal strings.
4. Test concurrent identical commands, changed payload and failure rollback.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

UUID reused across stores, null auth, MFA failure, response lost after commit, hash drift from irrelevant retry headers.

## Tests

V03,V38,V52; compare same-UUID two-connection effects and canonical hash fixtures. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

One committed result per operation; changed semantic request cannot reuse ID; locally recorded type cannot enter confirmed branch. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T02
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

