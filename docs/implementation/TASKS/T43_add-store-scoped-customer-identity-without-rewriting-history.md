# T43 — Add store-scoped customer identity without rewriting history

**Status:** Planned; implementation has not started.  
**Task ID:** T43  
**Feature:** Customer foundation  
**Priority:** Medium  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T02](./T02_add-operation-identity-and-replay-contract.md), [T03](./T03_add-scoped-supervisor-capabilities-and-approval-guards.md)

## Objective

Customer identity exists independently of historical receipt text with safe optional checkout link.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/types/index.ts`
- `supabase_schema.sql`
- `migration_27_inventory_branding_receipts.sql`

## Files to modify

None.

## New files

- `kodigo-ui/src/types/customers.ts`
- `kodigo-ui/src/lib/customers.ts`
- `supabase/tests/enhancements/T43_customer_schema.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t43_store_customers.sql`. Run the pinned CLI's verified `migration new t43_store_customers` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M11 customers and optional sales.customer_id composite FK/index; immutable customer_sale_links; existing receipt name/TIN/address snapshots untouched; archive/contact redaction gates.

## Backend work

Create/search/get/update/archive customer and audited associate-sale commands; store-scoped, no name/phone automatic merge; no owner-wide sharing.

## Frontend work

Typed minimal profile/search results for T44.

## Business rules

B01/B10. Guest/history unlinked unless explicit authorized association; contact privacy/retention D07.

## Implementation steps

1. Add minimal profile and optional sales link without forced backfill.
2. Implement role/capability scoped profile CRUD/archive/search.
3. Implement explicit retroactive link event with reason and immutable receipt preservation.
4. Test name collisions, foreign-store IDs, archive and contact edit.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Same name/TIN/phone across stores, deleted profile, historical customer snapshots differ, privacy redaction request.

## Tests

V45–V47,V52; receipt hash unchanged and no guessed customer links. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Customer identity exists independently of historical receipt text with safe optional checkout link. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T43
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

