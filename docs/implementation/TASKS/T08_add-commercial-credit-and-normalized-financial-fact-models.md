# T08 — Add commercial credit and normalized financial fact models

**Status:** Implemented — Pending Verification. The additive migration is applied to the existing deployed database; the reader/catalog checks and focused allocation tests passed. The credit writer remains private and version-5-only, and no UI operation is enabled.
**Task ID:** T08  
**Feature:** Accounting foundation  
**Priority:** Critical  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T02](./T02_add-operation-identity-and-replay-contract.md), [T03](./T03_add-scoped-supervisor-capabilities-and-approval-guards.md), [T06](./T06_route-all-existing-stock-writers-through-the-ledger.md)

## Objective

One canonical financial basis with explicit version; no double discount/credit/refund and no fabricated old cash.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `migration_19_transaction_lifecycle_auth_ops.sql`
- `supabase/migrations/20261021055145_fix_pos_item_discount_snapshots.sql`
- `kodigo-ui/src/lib/reporting-calculations.ts`
- `kodigo-ui/src/lib/reporting.ts`

## Files to modify

None.

## New files

- `supabase/tests/enhancements/T08_financial_facts.sql`
- `kodigo-ui/src/types/sale-adjustments.ts`
- `kodigo-ui/src/lib/sale-credits.ts`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t08_sale_credits_and_financial_facts.sql`. Run the pinned CLI's verified `migration new t08_sale_credits_and_financial_facts` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Implementation evidence

- CLI generated `supabase/migrations/20261111104446_t08_sale_credits_and_financial_facts.sql`; Supabase recorded/applied it to the existing project as `20261111110225`, aligned in the repository as `supabase/migrations/20261111110225_t08_sale_credits_and_financial_facts.sql` (canonical LF SHA-256 `4acb950cb2e0954b33ca687bcf2f9e9e440f05ba1a1a2dd6d22b788df2a9dd23`).
- `npm run typecheck` passed; focused `sale-credits.test.mjs` passed 3/3. The deployed `T08_financial_facts.sql` catalog assertions and a read-only legacy fact-adapter smoke passed.
- Existing deployed counts remain 8 sales, 8 sale items, 11 payment rows and 2 legacy return rows; all new credit/classification tables remain empty. The migration did not update receipts, payments, returns, or business rows.
- Full authenticated role/RLS, credit-writer rollback/replay, and concurrency cases remain pending. No isolated test database was created. Do not enable credit posting for legacy sales or expose a UI route until those cases and the dependent workflows are implemented.

## Database changes

M03 adjustments/lines/payment allocations/version fields and legacy_financial_classifications. Extend existing payments with immutable event_kind/original links. Add canonical guarded financial facts.

## Backend work

Implement create_sale_credit with cumulative cent/VAT/discount/COGS allocation; normalize gross/net legacy line basis without rewriting receipts. Separate net billed/net paid/refund due.

## Frontend work

Typed financial fact/credit adapter; no user operation enabled yet.

## Business rules

B02/B03. Refund consumes credit, never commercial subtraction twice; unknown historical settlement flagged.

## Implementation steps

1. Add schema and characterize gross/current-net/unknown legacy fixtures, including the deployed distinction between six-decimal lot/allocation cost and four-decimal legacy sale-line `cost_per_base_unit`.
2. Implement deterministic largest-remainder and cumulative partial-unit entitlement. Preserve legacy cost snapshots; new COGS facts use verified allocation/lot costs at their stored precision.
3. Build canonical fact functions and legacy adapter that counts negative payment/return once.
4. Assert totals, hashes and source uniqueness; keep unknown provenance explicit.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Zero-price line, full discount, mixed legacy formats, historical void status without cash evidence, final cent residual.

## Tests

V17,V18,V47,V48; net billed and paid independent; original receipt hashes identical before/after. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

One canonical financial basis with explicit version; no double discount/credit/refund and no fabricated old cash. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T08
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

