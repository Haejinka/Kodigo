# T03 — Add scoped supervisor capabilities and approval guards

**Status:** In progress; capability controls and additive schema are implemented, but authenticated role behavior and approval replay/apply tests remain.
**Task ID:** T03  
**Feature:** Permissions  
**Priority:** Critical  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T02](./T02_add-operation-identity-and-replay-contract.md)

## Objective

Database enforces same authority as UI; revoked/foreign/self approvals cannot post effects.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `supabase/migrations/20260803023252_enforce_mfa_assurance.sql`
- `supabase/functions/admin-users/index.ts`
- `kodigo-ui/src/stores/authStore.ts`
- `kodigo-ui/src/pages/SettingsPage.tsx`

## Files to modify

- `kodigo-ui/src/pages/SettingsPage.tsx`

## New files

- `kodigo-ui/src/lib/capabilities.ts`
- `supabase/tests/enhancements/T03_capabilities.sql`
- CLI-generated migration: `supabase/migrations/<generated-timestamp>_t03_store_capabilities.sql`. Run the pinned CLI's verified `migration new t03_store_capabilities` command; record its exact returned path in SCHEMA_BASELINE/TASK_STATUS. Do not hand-invent the timestamp.

## Database changes

M01 store_capability_grants with explicit supported code list, active uniqueness, store/profile relationship and grant/revoke metadata; operational_approval_requests/decisions for manual stock/cash/wallet with immutable typed proposal/hash, expected resource version and independent decision. Typed feature flag validator.

## Backend work

assert_store_capability, list/grant/revoke RPCs and shared request/decide/apply guard for manual operational approvals. Admin owns grants, never self-escalation; requester!=approver. Reuse MFA-aware membership, deny super_admin operational access; specialized void/refund/closeout aggregates retain their own records.

## Frontend work

Settings staff capability controls with loading/permission/validation states; retain global role enum and managed-user API.

## Business rules

B01. Supervisor is scoped capability, not new global role. Admin still cannot approve own request.

## Implementation steps

1. Create capability list and grants schema/RLS.
2. Implement checked grant/revoke/list and approval identity validator.
3. Expose controls only for assigned-store admins.
4. Test direct API, stale MFA, unassigned target and self-approval denial.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Profile removed from store after grant, revoked capabilities, single owner, mobile route guard, null helper return.

## Tests

V09,V25,V52; admin/cashier/inventory/super_admin/anon and foreign-store matrix. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

Database enforces same authority as UI; revoked/foreign/self approvals cannot post effects. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run typecheck
npm run lint
npm run test:unit
npm run test:db:enhancements -- --case T03
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Disable this task's store feature flag/command route first. Before any new facts are posted, restore captured prior function definitions while retaining additive schema. After posting, retain all facts/holds and use a reviewed compensating forward fix; never delete ledger/credit/settlement rows or reset the database. Revert UI adapters only if the server still rejects incompatible clients.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

