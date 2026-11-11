# T44 — Add customer profile screens and optional checkout selection

**Status:** In progress; the admin customer directory supports store-scoped search, profile view/create/edit/archive. Optional checkout selection remains gated on T26 because the current checkout still uses the legacy sale path. No customer data was created during implementation.
**Task ID:** T44  
**Feature:** Customer UI  
**Priority:** Medium  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T43](./T43_add-store-scoped-customer-identity-without-rewriting-history.md), [T26](./T26_bind-checkout-void-and-refund-cash-to-real-shifts.md)

## Objective

Sales can link optional customer reliably; guest flow and original receipt snapshots remain intact.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/components/pos/PaymentModal.tsx`
- `kodigo-ui/src/App.tsx`
- `kodigo-ui/src/components/layout/Sidebar.tsx`

## Files to modify

- `kodigo-ui/src/components/pos/PaymentModal.tsx`
- `kodigo-ui/src/App.tsx`
- `kodigo-ui/src/components/layout/Sidebar.tsx`

## New files

- `kodigo-ui/src/pages/CustomersPage.tsx`
- `kodigo-ui/src/components/pos/CustomerSelector.tsx`
- `kodigo-ui/tests/e2e/customer-selection.spec.ts`
- `supabase/tests/enhancements/T44_sale_customer_link.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t44_sale_customer_snapshots.sql`. Run the pinned CLI's verified `migration new t44_sale_customer_snapshots` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

Extend v5 validated customer link and snapshot at checkout; schema T43 reused. Historical snapshots not updated.

## Backend work

Validate optional customer belongs to sale store and permitted actor; receipt captures current chosen name/contact only as approved fields, with minimal offline PII.

## Frontend work

Guest default, search/create/select/clear, minimal customer management route and archive controls; privacy/permission errors clear cached details.

## Business rules

B10. Guest always allowed; no forced TIN/address; profile edits do not rewrite old receipts.

## Implementation steps

1. Bind optional customer ID and immutable snapshot inside v5.
2. Build guarded list/profile editing and checkout selector.
3. Clear selection on store/actor change and omit sensitive offline fields.
4. Test guest, profile edits, foreign-store forged ID and preserved receipt history.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Customer archived during checkout, cashier denied contact access, store switch, offline cached profile.

## Tests

V45,V46,V47,V52. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Sales can link optional customer reliably; guest flow and original receipt snapshots remain intact. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T44
npm run test:e2e -- tests/e2e/customer-selection.spec.ts
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

