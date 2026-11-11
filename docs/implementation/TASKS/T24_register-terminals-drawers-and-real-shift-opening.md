# T24 — Register terminals drawers and real shift opening

**Status:** In progress; additive schema and typed command adapter are prepared, but no migration or shift record has been applied/created.  
**Task ID:** T24  
**Feature:** Drawer custody  
**Priority:** Critical  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T02](./T02_add-operation-identity-and-replay-contract.md), [T03](./T03_add-scoped-supervisor-capabilities-and-approval-guards.md)

## Objective

A real shift has immutable drawer/terminal/cashier/opening start and cannot overlap custody.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `migration_19_transaction_lifecycle_auth_ops.sql`
- `kodigo-ui/src/lib/transactions.ts`
- `kodigo-ui/src/stores/authStore.ts`
- `kodigo-ui/src/components/settings/PosHardwareSettings.tsx`

## Files to modify

- `docs/implementation/API_CONTRACTS.md`
- `docs/implementation/SCHEMA_BASELINE.md`
- `docs/implementation/TASK_STATUS.md`

## New files

- `kodigo-ui/src/types/cash-drawers.ts`
- `kodigo-ui/src/lib/cash-drawers.ts`
- `kodigo-ui/scripts/unit/cash-drawers.test.mjs`
- `supabase/tests/enhancements/T24_shift_open.sql`
- CLI-generated migration: `supabase/migrations/20261110212138_t24_drawers_terminals_shifts.sql`.

### Contract correction

The original T24 API shorthand listed only business fields for terminal registration, drawer registration, and shift opening. That conflicts with the already deployed T02 requirement that every retryable write use `CommandV1` with a stable operation ID and server-derived actor. The API contract is corrected to use `CommandV1`; operation IDs and the full envelope are now mandatory, and the actor is never supplied in the payload. This is the smallest correction that preserves T02 idempotency and avoids duplicate custody on response loss.

## Database changes

M07 terminals/drawers/shifts with registered UUIDs, opening amount/start/actor/version; active-custody unique indexes. Add operation terminal/shift same-store FKs.

## Backend work

register/list_terminal_drawer and open_cashier_shift with current auth/MFA and drawer lock. Keep existing historical closeouts unconverted.

## Frontend work

Typed custody adapter only; hardware identifier remains display/config metadata, not authority.

## Business rules

B07. Opening declared at start; one active/submitting shift per drawer and cashier/store; handover close-and-open.

## Implementation steps

1. Add entities and admin registration/list RPCs.
2. Implement locked idempotent shift opening with nonnegative counted amount.
3. Keep `drawer_shifts` disabled until T25 can post the opening movement in the shift-open transaction; attach that hook after T25.
4. Test two actors/drawers and store-switch authority.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Double click, two terminals same drawer, admin no assigned store, offline open, terminal re-registration.

## Tests

V21,V22,V52; one custody record, original cashier preserved. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

A real shift has immutable drawer/terminal/cashier/opening start and cannot overlap custody. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T24
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

