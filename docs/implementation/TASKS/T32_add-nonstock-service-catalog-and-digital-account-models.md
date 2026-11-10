# T32 — Add nonstock service catalog and digital account models

**Status:** Planned; implementation has not started.  
**Task ID:** T32  
**Feature:** Digital foundation  
**Priority:** High  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T03](./T03_add-scoped-supervisor-capabilities-and-approval-guards.md), [T08](./T08_add-commercial-credit-and-normalized-financial-fact-models.md), [T25](./T25_post-append-only-physical-cash-movements-and-holds.md)

## Objective

Digital service identities/accounts are explicit and cannot be confused with GCash retail tender.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/types/index.ts`
- `kodigo-ui/src/stores/productStore.ts`
- `kodigo-ui/src/components/inventory/ProductForm.tsx`
- `migration_34_bulk_purchase_base_units.sql`

## Files to modify

- `kodigo-ui/src/types/index.ts`

## New files

- `kodigo-ui/src/types/digital-services.ts`
- `supabase/tests/enhancements/T32_digital_schema.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t32_nonstock_digital_catalog.sql`. Run the pinned CLI's verified `migration new t32_nonstock_digital_catalog` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M09 product kind/stock_tracked defaults physical, provider/wallet account tables; M10 service/event skeleton. Service lines explicitly nonstock; existing physical products unchanged.

## Backend work

Catalog validation and service-kind reads, no provider integration. Inventory/cost triggers bypass only validated authorized nonstock path; generic physical sale cannot fabricate service stock.

## Frontend work

Types distinguish physical product, digital product, load, cash-in/out; preserve GCash tender enum.

## Business rules

B08. Zero artificial stock; pending service not completed sale; provider account masked metadata no secrets.

## Implementation steps

1. Add additive kind/check/default models and service references.
2. Validate existing products migrate physical unchanged.
3. Teach central sale/stock services nonstock branch without bypassing service completion.
4. Test no stock/lot movement for digital and normal physical rules preserved.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Service SKU mistakenly has positive stock, service inserted via legacy physical RPC, archived catalog.

## Tests

V27–V34,V41,V51; no inventory effect for any digital service. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Digital service identities/accounts are explicit and cannot be confused with GCash retail tender. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T32
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

