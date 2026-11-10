# T10 — Add void requests decisions and application records

**Status:** Planned; implementation has not started.  
**Task ID:** T10  
**Feature:** Void approval  
**Priority:** High  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T03](./T03_add-scoped-supervisor-capabilities-and-approval-guards.md), [T08](./T08_add-commercial-credit-and-normalized-financial-fact-models.md)

## Objective

Storage can represent independent request/decision/application without mutating completed sale money.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `migration_34_bulk_purchase_base_units.sql`
- `kodigo-ui/src/lib/transactions.ts`

## Files to modify

None.

## New files

- `kodigo-ui/src/types/voids.ts`
- `supabase/tests/enhancements/T10_void_schema.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t10_void_request_models.sql`. Run the pinned CLI's verified `migration new t10_void_request_models` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M04 request/items/decisions/voids/items, same-sale FKs, active-request uniqueness, requester/approver identity guard, operation uniqueness and immutable applied facts. Attach deferred inventory source FKs.

## Backend work

Schema and checked state transitions only; no direct void endpoint enabled.

## Frontend work

Types for requested/awaiting_settlement/rejected/applied and line quotes.

## Business rules

B04. Approval alone no effect; preserve sale and original receipt; partial flag false.

## Implementation steps

1. Add schema, states, RLS and write revocations.
2. Link structured inventory/credit source fields now parent tables exist.
3. Add active request and one-application constraints.
4. Test invalid transitions, source-store mismatch and immutable decisions.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Two pending requests, same requester admin, already applied request, partial disabled.

## Tests

V07,V09,V10,V52 schema/authorization. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Storage can represent independent request/decision/application without mutating completed sale money. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T10
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

