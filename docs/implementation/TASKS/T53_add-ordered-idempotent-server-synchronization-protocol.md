# T53 — Add ordered idempotent server synchronization protocol

**Status:** Planned; implementation has not started.  
**Task ID:** T53  
**Feature:** Offline ingest  
**Priority:** Critical  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T06](./T06_route-all-existing-stock-writers-through-the-ledger.md), [T26](./T26_bind-checkout-void-and-refund-cash-to-real-shifts.md), [T31](./T31_append-late-transaction-and-refund-closeout-amendments.md), [T52](./T52_reserve-per-terminal-product-and-lot-stock-for-offline-sales.md)

## Objective

Interrupted sync can resume safely and every local operation has a visible durable server outcome or conflict.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/lib/pos-operations.ts`
- `kodigo-ui/src/lib/closeouts.ts`
- `kodigo-ui/src/lib/offline-sync.ts`

## Files to modify

None.

## New files

- `kodigo-ui/src/lib/sync-protocol.ts`
- `supabase/tests/enhancements/T53_offline_ingest.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t53_offline_sale_ingestion.sql`. Run the pinned CLI's verified `migration new t53_offline_sale_ingestion` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M12 sync cursor/conflict rows plus immutable operation/ack metadata; unique terminal sequence and movement source; original shift references retained.

## Backend work

ingest_offline_pos_operation accepts one command per RPC/DB transaction, ordered by terminal cursor and normal sale service. Client syncPosOperations drains at most20 separate RPC calls, persisting each ack before advancing. Validate original lease/grant/price/identity/hash; gap/conflict pauses lane. Late cash invokes T31.

## Frontend work

Typed batch/result/lookup protocol; no deletion on ack until durable local recording.

## Business rules

A02/A07/B09. Synced sale uses sale_deduction offline metadata, no extra adjustment per retry; digital commands reject.

## Implementation steps

1. Implement input limits/version/sequence validation and durable result lookup.
2. Bind valid cash physical sale to escrow snapshots and normal atomic accounting in one RPC transaction; client batches are only a bounded sequence of separate requests.
3. Return per-command ack/conflict; preserve earlier commits if later command conflicts.
4. Test response loss, duplicate batch, changed payload, revoked lease, sequence gaps and late approved shift.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Original cashier revoked, supervisor recovery distinct actor, current price changed, client/server clock mismatch, server commit then timeout.

## Tests

V03,V26,V36,V38,V40–V43; one sale/receipt/stock/cash per ID. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Interrupted sync can resume safely and every local operation has a visible durable server outcome or conflict. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T53
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

