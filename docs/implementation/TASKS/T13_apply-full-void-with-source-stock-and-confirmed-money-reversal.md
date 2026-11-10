# T13 — Apply full void with source stock and confirmed money reversal

**Status:** Planned; implementation has not started.  
**Task ID:** T13  
**Feature:** Void execution  
**Priority:** Critical  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T12](./T12_implement-void-request-and-independent-decision-endpoints.md), [T05](./T05_implement-the-centralized-stock-mutation-service.md), [T08](./T08_add-commercial-credit-and-normalized-financial-fact-models.md), [T25](./T25_post-append-only-physical-cash-movements-and-holds.md)

## Objective

Applied full void has all linked facts once; awaiting settlement has no false restoration or reversal.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `migration_34_bulk_purchase_base_units.sql`
- `supabase/migrations/20261019120000_pos_reporting_and_consignment_revisions.sql`
- `kodigo-ui/src/lib/transactions.ts`

## Files to modify

- `kodigo-ui/src/lib/transactions.ts`

## New files

- `supabase/tests/enhancements/T13_apply_void.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t13_apply_full_void.sql`. Run the pinned CLI's verified `migration new t13_apply_full_void` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

Applied void/item/credit/payment/movement facts linked by operation; one application per request; old capture status no longer mutated in new version.

## Backend work

apply_approved_void revalidates locked sale/entitlement, external evidence or actual cash return, source-lot restoration and credit/payment/cash postings atomically. Disable legacy status/adjustment trigger duplication.

## Frontend work

Compatibility wrapper routes to request workflow or upgrade-required; confirmed result contains linked ledger IDs.

## Business rules

B03/B04/B06/B07; no external internal-undo; stock restored exactly once; closeout blocks inline void.

## Implementation steps

1. Validate independent decision and settlement requirements again under sale lock.
2. Post immutable cancellation credit, confirmed payment reversal and performing cash movement as applicable.
3. Restore exact source quantities through T05 and update only lifecycle projections.
4. Inject failures at each leg; test duplicate application and old RPC bypass.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Cash returned but browser response lost, external outcome unknown, partial prior return added after request, lot/location/pack changed.

## Tests

V06,V07,V10,V48,V52; receipt unchanged, stock/cash/credit sums and one restore. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Applied full void has all linked facts once; awaiting settlement has no false restoration or reversal. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T13
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

