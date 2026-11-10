# T60 — Rehearse staged rollout reconciliation and safe rollback

**Status:** Planned; implementation has not started.  
**Task ID:** T60  
**Feature:** Production readiness  
**Priority:** Critical  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T58](./T58_verify-cross-domain-invariants-concurrency-and-migration-compatibility.md), [T59](./T59_verify-end-to-end-roles-hardware-fallback-and-recovery.md)

## Objective

Release has reproducible evidence, restore/rollback instructions, reconciled balances and explicit owners for every unresolved gate.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `docs/production-ops.md`
- `README.md`
- `docs/implementation/SCHEMA_BASELINE.md`
- `supabase/bootstrap-manifest.json`

## Files to modify

- `docs/production-ops.md`
- `README.md`
- `docs/implementation/HANDOFF.md`
- `docs/implementation/TASK_STATUS.md`

## New files

- `docs/implementation/RELEASE_REHEARSAL.md`
- `docs/implementation/RECONCILIATION_RUNBOOK.md`

## Database changes

Apply only reviewed new migrations on staging; production execution is a separate authorized rollout, never implied by task code completion. Record backup/effective fingerprints/flag state and post-cutover balances.

## Backend work

Rehearse additive→writer→cash→digital→offline gates, old-client rejection, metrics/conflict escalation and compensating rollback. No destructive ledger down migration.

## Frontend work

Pilot supported browser/device/printer profiles with physical58/80 paper and prolonged disconnect; flags stay off for unresolved decisions.

## Business rules

A09/Migration plan. No lost offline stock allocation on rollback; no approved report rewrite; provider APIs remain out of scope.

## Implementation steps

1. Restore backup into isolated clone and execute exact upgrade/verification manifest.
2. Record counts/receipt hashes/stock-lot/cash/wallet/credits/earnings/closeout reconciliation and pending queue inventory.
3. Rehearse disabling flags/old-client rejection and forward compensating recovery, preserving posted facts.
4. Collect independent business/device/printing signoffs and document deploy evidence plus unresolved launch gates.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Only one admin, older paired agent, key loss, lost terminal held stock, production schema drift, no digital tax policy.

## Tests

V26,V35–V44,V47–V52; physical paper and extended offline scenarios documented separately from automated pass. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Release has reproducible evidence, restore/rollback instructions, reconciled balances and explicit owners for every unresolved gate. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
Use exact commands verified by T00/T01 and release manifest; npm run ci on staging; npm run test:print-agent; npm run test:e2e. Do not run mutating commands against production during rehearsal.
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Revert this task's isolated code/document changes while retaining durable queue/ack/history artifacts. Keep existing working paths covered by regression tests; disable the new entry point if dependencies cannot be safely downgraded. Do not erase posted facts, pending cash operations or device recovery data.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

