# T12 — Implement void request and independent decision endpoints

**Status:** Planned; implementation has not started.  
**Task ID:** T12  
**Feature:** Void approvals  
**Priority:** High  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T11](./T11_implement-void-eligibility-and-exact-reversal-quote.md)

## Objective

Requester cannot approve own void through any API; queue decisions preserve actor/time/reason and do not falsely post effects.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/lib/transactions.ts`
- `kodigo-ui/src/components/pos/TransactionLifecyclePanel.tsx`

## Files to modify

None.

## New files

- `kodigo-ui/src/lib/voids.ts`
- `supabase/tests/enhancements/T12_void_decisions.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t12_void_requests_and_decisions.sql`. Run the pinned CLI's verified `migration new t12_void_requests_and_decisions` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M04 operation/event writes to requests/decisions; request version checked and active unique constraint used.

## Backend work

request_sale_void, decide_sale_void, list_void_requests and detail; reason3–500, requester derived, independent capability/MFA, reject/apply-ready/awaiting-settlement transitions.

## Frontend work

Typed thin request/list/decision wrappers; legacy voidSale remains disabled for direct bypass until T13.

## Business rules

B01/B04. Rejection zero inventory/payment effect; approved external pending remains pending.

## Implementation steps

1. Implement idempotent request with original sale version.
2. Implement locked decision/self-approval denial and immutable comment/evidence.
3. Expose paginated queue/detail reads with store scope.
4. Test decision races, same-ID retries and direct old void denial.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Requester permissions revoked, double approve/reject, stale version, missing reason, foreign sale.

## Tests

V07,V09,V10,V52; compare counts before/after pending/rejected. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Requester cannot approve own void through any API; queue decisions preserve actor/time/reason and do not falsely post effects. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T12
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

