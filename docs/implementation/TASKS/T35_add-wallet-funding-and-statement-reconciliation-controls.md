# T35 — Add wallet funding and statement reconciliation controls

**Status:** Planned; implementation has not started.  
**Task ID:** T35  
**Feature:** Wallet administration  
**Priority:** High  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T34](./T34_implement-wallet-ledger-holds-and-balance-conservation.md), [T27](./T27_add-shift-opening-and-authorized-cash-movement-ui.md)

## Objective

Wallet balance changes have traceable source/evidence and differences remain visible until approved resolution.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/App.tsx`
- `kodigo-ui/src/components/layout/Sidebar.tsx`
- `kodigo-ui/src/lib/wallets.ts`

## Files to modify

- `kodigo-ui/src/App.tsx`
- `kodigo-ui/src/components/layout/Sidebar.tsx`
- `kodigo-ui/src/lib/wallets.ts`

## New files

- `kodigo-ui/src/pages/WalletsPage.tsx`
- `supabase/tests/enhancements/T35_wallet_reconciliation.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t35_wallet_funding_reconciliation.sql`. Run the pinned CLI's verified `migration new t35_wallet_funding_reconciliation` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M10 reconciliation cases/statement snapshots and approved wallet adjustment events using M01 operational_approval_requests/decisions; source/counterparty FKs.

## Backend work

Request/approve wallet opening/topup/withdraw/adjustment and record statement snapshot. If physical drawer funds topup, post both cash− and wallet+ atomically with evidence; external bank funding no cash delta.

## Frontend work

/operations/wallets balances/history/holds/evidence and funding forms; independent approval and statement-difference case.

## Business rules

B01/B08. Never automatic balancing plug; sensitive provider account masked.

## Implementation steps

1. Implement evidenced source-of-funds and approval commands.
2. Add statement snapshots with immutable watermark/difference, no auto-adjust.
3. Build guarded admin wallet screen and routes.
4. Test physical versus noncash funding, unknown source and unauthorized changes.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Insufficient drawer for topup, statement timing vs pending provider leg, self-approval, duplicate external funding reference.

## Tests

V23,V31,V35,V52. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Wallet balance changes have traceable source/evidence and differences remain visible until approved resolution. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T35
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

