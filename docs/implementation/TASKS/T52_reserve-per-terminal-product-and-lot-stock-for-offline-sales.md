# T52 — Reserve per-terminal product and lot stock for offline sales

**Status:** Planned; implementation has not started.  
**Task ID:** T52  
**Feature:** Offline stock escrow  
**Priority:** Critical  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T05](./T05_implement-the-centralized-stock-mutation-service.md), [T51](./T51_issue-bounded-offline-cashier-authorization-leases.md)

## Objective

Multiple terminals can use disjoint stock authority without negative available or double allocation.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/lib/offline-authorization.ts`
- `kodigo-ui/src/lib/offline-db.ts`
- `supabase/migrations/20260930130000_consignment_inventory_lots.sql`

## Files to modify

None.

## New files

- `supabase/tests/enhancements/T52_offline_stock_grants.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t52_offline_stock_escrow.sql`. Run the pinned CLI's verified `migration new t52_offline_stock_escrow` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M12 stock grants/events/cursors; M02 reserved_offline projection and grant quantity caps; exact lot/price/conversion/discount snapshots.

## Backend work

Allocate/consume/reconcile/release offline stock under ordered balance/lot locks. Online available excludes all outstanding grants. Expiry alone cannot release uncertain holdings.

## Frontend work

Return local product/grant availability and cached quote; no arbitrary stale-stock override.

## Business rules

B06/B09/D03. Without escrow approval only cart capture allowed, not fulfilled offline sale. Lost-device release needs reconciliation.

## Implementation steps

1. Reserve exact product/lot quantity online with immutable quote snapshot.
2. Deduct reserved quantity from online availability without changing physical on-hand.
3. Implement ingest consume reducing on-hand and grant outstanding together; release only reconciled unused remainder.
4. Test multiple terminals, online competing sales, lease expiry/lost device and changed catalog.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Grant stock manually damaged, product recalled/archived, mixed consignment lots, local sequence unacknowledged, allocation exhausted.

## Tests

V04,V36,V42,V43,V48; grants4+3 and online3 from10 conserve stock exactly. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Multiple terminals can use disjoint stock authority without negative available or double allocation. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T52
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

