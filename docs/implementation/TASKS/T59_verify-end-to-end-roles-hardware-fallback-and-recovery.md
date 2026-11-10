# T59 — Verify end-to-end roles hardware fallback and recovery

**Status:** Planned; implementation has not started.  
**Task ID:** T59  
**Feature:** Operational acceptance  
**Priority:** High  
**Estimated complexity:** L (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T58](./T58_verify-cross-domain-invariants-concurrency-and-migration-compatibility.md)

## Objective

Maintained E2E demonstrates complete workflows and honest pending/error states with role/server enforcement.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/playwright.config.ts`
- `kodigo-ui/tests/e2e/`
- `.github/workflows/ci.yml`
- `kodigo-ui/print-agent-tests/Program.cs`

## Files to modify

- `.github/workflows/ci.yml`

## New files

- `kodigo-ui/tests/e2e/enhancement-acceptance.spec.ts`

## Database changes

Isolated fixture setup only, no production changes.

## Backend work

Exercise real server permissions and API bypass negatives under appropriate isolated auth roles; never test only hidden buttons.

## Frontend work

Maintain E2E for cashier/supervisor/admin/inventory/foreign-store, all empty/loading/denied/pending states, multi-tab/offline/resume and print fallback. Physical device acceptance belongs T60.

## Business rules

UI_UX_SPECIFICATIONS and all matrix outcomes. Printer ack not physical proof; provider verification fixture not live integration.

## Implementation steps

1. Run dedicated role fixtures through each workflow with real RPCs.
2. Add multi-terminal offline reload/update/recovery and late closeout scenarios.
3. Mock browser/agent boundaries for duplicate/unknown/failure behavior and test no drawer pulse for lists.
4. Wire CI browser/SQL/native jobs with explicit prerequisites and skip result reporting.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Admin mobile POS gate, new user session, long text/dark theme/keyboard-only, no hardware, absent integration secrets.

## Tests

V01–V52 user-facing/authorization outcomes; existing42 unit tests retained. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Maintained E2E demonstrates complete workflows and honest pending/error states with role/server enforcement. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck; npm run lint; npm run build; npm run test:unit; npm run test:print-agent; npm run test:e2e
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Revert this task's isolated code/document changes while retaining durable queue/ack/history artifacts. Keep existing working paths covered by regression tests; disable the new entry point if dependencies cannot be safely downgraded. Do not erase posted facts, pending cash operations or device recovery data.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

