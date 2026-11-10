# T29 — Add independent closeout review comments and decisions

**Status:** Planned; implementation has not started.  
**Task ID:** T29  
**Feature:** Closeout administration  
**Priority:** High  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T28](./T28_freeze-watermarked-cashier-closeout-snapshots.md), [T03](./T03_add-scoped-supervisor-capabilities-and-approval-guards.md)

## Objective

Admin can approve/flag/request clarification with identity/time/comment and no silent totals rewrite.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `migration_19_transaction_lifecycle_auth_ops.sql`
- `kodigo-ui/src/lib/closeouts.ts`

## Files to modify

- `kodigo-ui/src/lib/closeouts.ts`

## New files

- `supabase/tests/enhancements/T29_closeout_review.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t29_closeout_review_events.sql`. Run the pinned CLI's verified `migration new t29_closeout_review_events` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M08 review events/comments, reviewer<>submitter constraint, immutable approved facts and versioned allowed transitions.

## Backend work

list_closeouts/get_closeout/record_review/add_comment/resubmit_clarification APIs. Admin same-store only, no self-approval, flags/comments auditable.

## Frontend work

Typed queue/detail/review adapter for T30.

## Business rules

B01/B07. Flag/clarify has no cash adjustment; approval never recomputes totals.

## Implementation steps

1. Implement keyset pending/flagged/approved reads and scoped detail.
2. Implement versioned review/comment/resubmit transitions under header lock.
3. Enforce independent reviewer and frozen snapshot protection.
4. Test competing approve/flag and approved-row mutation attempts.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Single-admin submitter, wrong store, stale page, repeated review operation, comment contains PII.

## Tests

V25,V26,V52; approved hash remains stable. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Admin can approve/flag/request clarification with identity/time/comment and no silent totals rewrite. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T29
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

