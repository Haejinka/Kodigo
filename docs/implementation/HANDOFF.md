# Implementation handoff

**Planning only.** This package audited source and created documentation; it did not implement features or apply SQL. Start with [T00](TASKS/T00_fingerprint-schema-and-prove-bootstrap-order.md). All 61 specifications are indexed in [IMPLEMENTATION_ROADMAP](IMPLEMENTATION_ROADMAP.md). Existing 42 unit tests and lint passed during planning; all proposed-feature tests remain to be written/run.

## Reading and execution order

1. [SYSTEM_AUDIT](SYSTEM_AUDIT.md): actual architecture, reuse and dangerous compatibility paths.
2. [BUSINESS_RULES](BUSINESS_RULES.md): normative B01–B10 formulas/eligibility/accounting.
3. [ARCHITECTURE](ARCHITECTURE.md) and [API_CONTRACTS](API_CONTRACTS.md): A01–A09 services/states, exact command payloads, results, errors and offline protocol.
4. [DATABASE_MIGRATION_PLAN](DATABASE_MIGRATION_PLAN.md): M00–M12 exact schema/backfill/rollout.
5. [IMPLEMENTATION_ROADMAP](IMPLEMENTATION_ROADMAP.md): DAG and release gates.
6. Assigned TASKS file, then relevant [UI_UX_SPECIFICATIONS](UI_UX_SPECIFICATIONS.md) screen and [TEST_MATRIX](TEST_MATRIX.md) cases.

T00 is first because repository migration chronology is ambiguous and live deployed schema was not inspected. Do not repeatedly audit the repository after T00; use its captured baseline and task-specified files. Do not apply baseline SQL or historical migrations blindly. If target DB/clone is unavailable, complete source manifest and safe local work, mark dependent database verification explicitly pending and do not activate feature writes.

## Scope and coding conventions

Keep existing React19/TypeScript/Vite/Zustand, Tailwind/Radix UI and Supabase RPC stack. Use existing semantic tokens/shared components; separate POS shell remains. Implement canonical calculations and authorization in SQL, thin typed adapters in src/lib and domain types in src/types. Preserve current per-item discounts, VAT-inclusive stock prices, integer base-unit selling, six-decimal receipt-lot/allocation costs (legacy sale-line cost fields have separate precision), package snapshots, product barcode semantics, receipt immutability and receipt-based consignment supplier payable. PO receiving changes status only; explicit stock receiving remains separate.

Use minimal public SECURITY DEFINER command wrappers with blank search_path, fully qualified references and explicit auth/MFA/store/capability checks; revoke PUBLIC/anon and grant narrow authenticated execute. Low-level private helpers cannot be invoked by clients. Deny direct ledger writes and add RLS/append-only checks. Never use frontend role/metadata as authority or expose service credentials. Preserve all older entry points by routing to the same rules or upgrade-required; leaving old permissive RPCs active is a failed task.

New APIs follow A02 command/result version, decimal-string money, server canonical hash, stable operation identity and idempotent response. One DB transaction commits all required business facts per command. Actual external/manual cash events cannot be physically rolled back by SQL; ambiguous observations become reconciliation cases and must never be blindly repeated. Print after commit with honest peripheral status. Use existing browser/.NET agent, not a new print service.

All paths in task specs are precise repository-root-relative. Migration timestamp is the sole deferred path component: use installed/pinned CLI's verified migration-new workflow and record the generated filename/checksum in SCHEMA_BASELINE/TASK_STATUS. Do not invent timestamped migration names or edit historical migration files. Full reviewed function definitions replace the old dynamic string-replacement pattern. No unnecessary dependency additions; installed Node runner/Playwright/.NET patterns suffice.

## Permission contract

| Actor | Operations |
| --- | --- |
| Assigned cashier | Existing permitted POS/sales reads, request void/return/refund, operate own custody, supported cash service steps if granted; no self approval. Transaction stock drill-down can omit cost/supplier data. |
| Supervisor (scoped capability on existing role) | Relevant store approval queue/evidence only; cannot approve own request; no global-role escalation. |
| Assigned inventory staff | Existing product/receiving/stock views and permitted adjustments; no customer money/provider or closeout review authority by default. |
| Assigned admin | Store management, capabilities, independent approvals, wallet/reconciliation and closeout review; own-request/own-closeout approval remains denied. |
| super_admin | Existing invite portal; no implicit store operation authority. |

Do not broaden existing read scope merely because a new route exists. Use existing store-role permissions plus task-specific need; redact customer contact/financial cost where unnecessary. Test API calls under all roles, not only button visibility.

## Decision register

Unresolved facts are not invitations to improvise. Safe defaults permit independent implementation and tests while restricting activation. Record actual decision/evidence/owner/date here when resolved.

| ID | Decision / owner | Source-confirmed or safe default | Gate |
| --- | --- | --- | --- |
| D01 | Actual schema/history/Postgres/CLI, authorized test clone / maintainer | Unknown deployed state; T00 fingerprints/topological bootstrap; never replay baseline over live DB | All schema deployment and verification |
| D02 | Eligible partial voids/window/fulfillment / store owner | Full held-goods voids only; partial_voids false; required line schema and flag-off tests still implemented | T15 enablement only |
| D03 | Offline escrow/device policy, unlock/recovery strength,8h duration / owner+security lead | Cash physical sales only under per-terminal product/lot allocations; encrypted device unlock; no offline fulfillment if escrow/protection rejected | T51–T57 activation, G5 |
| D04 | Provider account/evidence authority, future API contract / owner | Initial release manual recording after external verification; no provider API exists in repo; use masked configured accounts, never consumer UI automation | Digital account onboarding; API integration excluded |
| D05 | Digital principal/commission/fee VAT and statutory document treatment / qualified accounting owner | Operational ledger formulas fixed by request; current physical VAT logic preserved; no invented digital tax classification/fiscal receipt changes | Digital financial/fiscal launch |
| D06 | Adjustment/variance thresholds and single-owner reviewer staffing / owner | Independent approval for all manual cash/wallet adjustments and negative-variance review; no self approvals; assign second admin for closeout | Optional threshold relaxation; review staffing before pilot |
| D07 | Customer consent/contact retention/redaction and cross-store identity / privacy owner | Store-local optional minimal profile, guest allowed, no auto merge, no owner-wide identity, offline TIN/address omitted;30d ack summaries proposed | Customer production privacy signoff |
| D08 | Printer models/paper/codepage/browser/device / operator | Reuse existing native agent/browser;32-column58mm and48-column80mm only after device test; honest spool/dialog status | T48–T49 hardware acceptance |
| D09 | Cross-store return/transfer product mapping/custody / owner | Within-store default sellable/quarantine only; inter-store automated changes disabled | Any later inter-store expansion |
| D10 | Alternative2% service applicability/minimum and additional load charges / owner |2% replaces selected standard policy; default cashout minimum50 retained; extra load charge0 unless explicit versioned configuration | Only nondefault ranges/fees |

D01/D03/D05 require evidence before affected launch. T15 can remain disabled without blocking unrelated work. D04 does not block manual orchestration tests with synthetic accounts. Documentation approval is not approval to send money, deploy provider integrations, change production balances or weaken authorization.

## Verification and task completion

Use existing commands from kodigo-ui: npm run typecheck, npm run lint, npm run test:unit, npm run build. T01 introduces guarded test:db:enhancements and test:e2e. Native format verification is npm run test:print-agent. Existing integration creates/deletes users/business rows and runs only with explicit isolated credentials; a skipped harness is not passed validation. Do not run npm run ci with ambient production credentials. Do not expose secrets in command output/test artifacts.

Before each task: confirm dependencies Done, current schema fingerprint, applicable decision gate and working-tree ownership. Update [TASK_STATUS](TASK_STATUS.md) to In progress and record assigned agent/branch. Complete only the declared responsibility; if source contradicts normative contract, capture exact path/symbol/evidence, propose minimal compatible change and update affected specs/dependencies together. Do not hide the conflict in a new abstraction or silently widen scope. Raise a genuine unresolved business decision to owner while continuing unrelated tasks.

Done means implemented files/migration path+checksum recorded, relevant unit/database/auth/rollback/concurrency/UI tests actually pass, accepted cases demonstrate outcome, historical/receipt/consignment compatibility verified, peer review complete and limitations documented. Record command/environment/result with date, including skipped tests. Financial/inventory task with only frontend test or mocked locks is not Done. All required checks must pass before broadening tests; repeat only for new changes/failures or unresolved risks.

## Rollback and activation rules

Flags default off; dependent writes activate only after roadmap gates. Public API enforces required versions/shift/approvals even for old clients. Disable new writes first on failure. Preserve ledgers, holds, encrypted queues and acks; after posting use compensating forward operations/migrations. Frozen closeout totals and historical receipt snapshots never rewritten. Do not release uncertain expired offline stock allocations merely to restore online capacity. Restore incidents use a verified replacement project, not destructive down migration on live history.

T60 produces exact release/reconciliation runbooks and staging evidence before production activation. This planning package does not claim production readiness or external integration certification.

