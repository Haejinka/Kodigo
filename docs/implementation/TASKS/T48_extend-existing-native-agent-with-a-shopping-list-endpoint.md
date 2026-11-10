# T48 — Extend existing native agent with a shopping-list endpoint

**Status:** In progress; the capability route, formatter, attempt ledger, and client adapter are implemented, pending verification.  
**Task ID:** T48  
**Feature:** Native shopping-list printing  
**Priority:** Medium  
**Estimated complexity:** M (S: one focused review; M: several coherent edits; L: transactional or cross-boundary work requiring staged review).  
**Dependencies:** [T47](./T47_create-nonfiscal-shopping-list-snapshots-and-browser-layout.md)

## Objective

One agent handles both document types with distinct IDs/layouts and honest failure/duplicate behavior.

## Required contracts

Read [HANDOFF](../HANDOFF.md), the relevant [architecture](../ARCHITECTURE.md) service/state contract, exact [API payloads/results](../API_CONTRACTS.md), [business rules](../BUSINESS_RULES.md), [database dictionary](../DATABASE_MIGRATION_PLAN.md), and [test matrix](../TEST_MATRIX.md) cases below. These are normative decisions; do not redesign them within this task. All paths below are repository-root-relative. Execute commands from `kodigo-ui/` unless stated otherwise. The task may inspect its declared dependency artifacts without repeating the full repository audit.

## Existing files to inspect

- `kodigo-ui/print-agent/Program.cs`
- `kodigo-ui/print-agent/ReceiptFormatter.cs`
- `kodigo-ui/print-agent/WindowsPrinter.cs`
- `kodigo-ui/print-agent/AgentOriginPolicy.cs`
- `kodigo-ui/print-agent/Program.cs`
- `kodigo-ui/print-agent-tests/Program.cs`
- `kodigo-ui/src/lib/hardware.ts`

## Files to modify

- `kodigo-ui/print-agent/Program.cs`
- `kodigo-ui/print-agent-tests/Program.cs`
- `kodigo-ui/src/lib/hardware.ts`
- `kodigo-ui/print-agent/README.md`
- `kodigo-ui/print-agent/Kodigo.PrintAgent.csproj`
- `kodigo-ui/print-agent-tests/Kodigo.PrintAgent.FormatTests.csproj`

## New files

- `kodigo-ui/print-agent/ShoppingListFormatter.cs`
- `kodigo-ui/print-agent/ShoppingListAttemptLedger.cs`

## Database changes

None. Separate local document-attempt ledger; never fabricate sale UUID or mutate receipt printed_count.

## Backend work

POST `/v1/documents/shopping-list/print` uses the existing paired bearer/origin/RAW transport; GET `/v1/capabilities` advertises supported document/paper profiles and a 50-item limit. Separate durable document hash/attempt dedupe, explicit reprint and bounded size. Hash includes the selected profile and `show_prices` flag so a document ID cannot silently change its output. No drawer pulse. The local ledger fails closed on malformed history and retains up to 5,000 documents and 5,000 attempts.

## Frontend work

Typed printShoppingList adapter with old-agent unsupported response and browser fallback.

## Business rules

B10.58mm32cols/80mm48cols only compatible device; accepted spool submission not physical proof. Receipt endpoint/schema unchanged.

## Implementation steps

1. Add typed bounded payload and dedicated sanitized formatter with selectable profile.
2. Reuse auth/origin/printer gates and durable claim-before-spool policy; document uncertain outcome.
3. Advertise capabilities and reject same document ID with changed hash.
4. Extend native tests for both widths, injection, unsupported paper, dedupe and no drawer action.
5. Run this task's checks against the declared environment; record actual results, skipped checks and unresolved gates in TASK_STATUS. Do not enable a dependent feature while its accounting/authorization prerequisites are incomplete.

## Edge cases

Old agent, corrupt dedupe file, spool failure after claim, long payload, unpaired browser, ESC/POS control injection.

## Tests

V49,V50; npm run test:print-agent plus hardware trust unit regression; physical output left to T60. Add the named SQL/unit/browser tests above rather than only manual button checks. Where SQL is involved, include migration compatibility, wrong-role/foreign-store rejection, rollback after injected failure and identical-operation replay. Use the real database harness for locks/constraints, with at least two independent connections for declared concurrency cases. UI-only and printing tasks retain existing unit regressions and exercise the user-visible states specified for that screen.

## Acceptance criteria

One agent handles both document types with distinct IDs/layouts and honest failure/duplicate behavior. All declared test cases produce the specified results; errors are visible and existing historical/tenant behavior remains compatible. A test skip does not satisfy a required integration acceptance criterion.

## Verification commands

Commands involving new harnesses/tests become available through T01 or this task; they are future verification instructions, not evidence they ran in planning. Set isolated test variables according to TEST_MATRIX; never use production credentials.

```text
npm run test:print-agent; npm run test:unit; npm run typecheck
```

For SQL tasks, create the migration only after T00 has established the installed CLI workflow. Use `--help` to confirm commands/target; apply only to the explicit disposable target. Review the complete migration and execute its task-specific test before changing TASK_STATUS.

## Rollback plan

Revert this task's isolated code/document changes while retaining durable queue/ack/history artifacts. Keep existing working paths covered by regression tests; disable the new entry point if dependencies cannot be safely downgraded. Do not erase posted facts, pending cash operations or device recovery data.

## Completion checklist

- [ ] Dependencies and any referenced decision gates are satisfied; exact changed paths/migration checksum recorded.
- [ ] Objective, backend/frontend behavior and listed edge cases are demonstrated by this task's tests.
- [ ] Relevant tenant/role/MFA/idempotency and historical-data checks pass; no unsupported success claim.
- [ ] Verification output/environment and any remaining limitations are recorded; review completed; feature enablement follows HANDOFF release gates.

