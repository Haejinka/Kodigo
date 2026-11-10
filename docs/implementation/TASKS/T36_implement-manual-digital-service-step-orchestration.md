# T36 — Implement manual digital service step orchestration

**Status:** Planned; implementation has not started.  
**Task ID:** T36  
**Feature:** Digital transaction core  
**Priority:** Critical  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T33](./T33_implement-immutable-fee-policy-versions-and-exact-quotes.md), [T34](./T34_implement-wallet-ledger-holds-and-balance-conservation.md), [T25](./T25_post-append-only-physical-cash-movements-and-holds.md), [T31](./T31_append-late-transaction-and-refund-closeout-amendments.md)

## Objective

Manual record reflects externally verified and physical events separately; no fake offline/provider success.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/lib/pos-operations.ts`
- `kodigo-ui/src/lib/wallets.ts`
- `kodigo-ui/src/types/digital-services.ts`

## Files to modify

None.

## New files

- `kodigo-ui/src/lib/digital-services.ts`
- `supabase/tests/enhancements/T36_digital_steps.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t36_manual_digital_steps.sql`. Run the pinned CLI's verified `migration new t36_manual_digital_steps` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M10 service events/clearing/external evidence/earning uniqueness, normalized provider reference unique, immutable quote and step transitions.

## Backend work

create/reserve_service, record_cash_leg, verify_external_leg, complete_service and get_pending_services. Post each observed leg atomically; complete sale/service line and earning only after required legs. E-load bills face+extra; GCash bills fee only with principal clearing. Link payment slices to already posted legs, never collect/payout again. No provider API calls.

## Frontend work

Typed step/quote/evidence results; incomplete service saved separately from completed sale.

## Business rules

B08/A04. Real partial effects survive failure; unknown never automatically retried; completed service has required accounting records once.

## Implementation steps

1. Implement step state validator, holds and evidence/reference normalization.
2. Post actual wallet/cash legs with service clearing at observation time.
3. Finalize service sale/payment classification and earning once all legs satisfied.
4. Test interrupted stages, duplicate reference, missing evidence and same-operation replay.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Cash taken but provider fails, incoming transfer confirmed but payout unknown, approval not external confirmation, duplicate ref collision.

## Tests

V32–V34,V41,V52; verify no completed earning before both legs. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Manual record reflects externally verified and physical events separately; no fake offline/provider success. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T36
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

