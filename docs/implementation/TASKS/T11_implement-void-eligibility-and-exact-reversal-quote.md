# T11 — Implement void eligibility and exact reversal quote

**Status:** Planned; implementation has not started.  
**Task ID:** T11  
**Feature:** Void validation  
**Priority:** High  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T10](./T10_add-void-requests-decisions-and-application-records.md)

## Objective

UI and apply service share one eligibility policy and never infer external reversal from approval.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `migration_34_bulk_purchase_base_units.sql`
- `supabase/migrations/20261021100000_fix_refund_pos_sale_refund_total.sql`

## Files to modify

None.

## New files

- `supabase/tests/enhancements/T11_void_eligibility.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t11_void_eligibility.sql`. Run the pinned CLI's verified `migration new t11_void_eligibility` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

Read eligibility RPC/helper; no posted money or stock writes.

## Backend work

get_void_eligibility returns policy code, eligible held units, original credit/VAT/discount/COGS quote, version and external reversal requirements. Uses current entitlements under later apply locks.

## Frontend work

Typed eligibility result added to void adapter in T12.

## Business rules

B04 table; completed/unclosed/unreturned only by default; external fulfilled service needs explicit case, partial disabled.

## Implementation steps

1. Calculate original quantities minus physical/credit/void claims using snapshots.
2. Reject closed/part-refunded/part-returned/fulfilled cases with stable reason codes.
3. Identify cash versus externally settled reversal requirements without assuming provider reversal.
4. Test each eligibility state and version changes.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Fully refunded but unreturned goods, partially fulfilled service, option changed, current stock product archived.

## Tests

V06,V08,V10; eligibility quote equals eventual allowed application. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

UI and apply service share one eligibility policy and never infer external reversal from approval. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T11
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

