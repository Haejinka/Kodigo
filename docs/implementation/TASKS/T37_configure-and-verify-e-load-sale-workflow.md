# T37 — Configure and verify e-load sale workflow

**Status:** Planned; implementation has not started.  
**Task ID:** T37  
**Feature:** E-load  
**Priority:** High  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T36](./T36_implement-manual-digital-service-step-orchestration.md)

## Objective

E-load cost/profit formulas and all verified legs reconcile with no duplicate commission.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/src/lib/digital-services.ts`
- `kodigo-ui/src/lib/digital-service-quotes.ts`

## Files to modify

- `kodigo-ui/src/lib/digital-services.ts`

## New files

- `supabase/tests/enhancements/T37_eload.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t37_eload_service_rules.sql`. Run the pinned CLI's verified `migration new t37_eload_service_rules` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

Use M10 typed e-load step configuration; no separate competing commission table.

## Backend work

E-load validation: positive face in configured catalog range, load wallet hold face×0.98, actual customer cash face+explicit extra, provider delivery evidence, earning face−cost+extra once.

## Frontend work

Expose load-specific quote fields/recipient minimum; UI in T40.

## Business rules

B08 examples20/30/50/99/500. Never add commission to wallet; optional extra charge must be explicit policy snapshot.

## Implementation steps

1. Bind e-load catalog/fee policy to service orchestrator.
2. Require sufficient load hold and cash collection before provider instruction.
3. Verify delivery reference/cost then finalize earning and completed service.
4. Exercise failed/unknown delivery and recovery liability without automatic resend.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Wallet97.01 for face99, extra fee, recipient correction after cash collection, same ref under new UUID.

## Tests

V27,V31–V34,V41; exact centavo examples and inventory zero. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

E-load cost/profit formulas and all verified legs reconcile with no duplicate commission. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T37
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

