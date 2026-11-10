# Task status

Implementation began 2026-11-10. The earlier planning audit reported 42 unit tests and lint passing, but those results have not yet been re-run against this working tree. T00 is being implemented with a read-only deployed fingerprint and source manifest; isolated empty/restore verification is pending. No new-feature/database/E2E/native/hardware checks have passed. Status vocabulary: Planned, In progress, Blocked (with explicit dependency/decision), In review, Done. Record actual commands/environment/results in the Evidence cell or a linked task log; never replace a skipped test with pass.

| Task | Status | Owner / branch | Exact migration / changed artifacts | Evidence / date | Gate / limitation |
| --- | --- | --- | --- | --- | --- |
| [T00](TASKS/T00_fingerprint-schema-and-prove-bootstrap-order.md) | In progress | Codex / main working tree | `supabase/bootstrap-manifest.json`; `docs/implementation/SCHEMA_BASELINE.md`; README; production-ops; schema/precision contract corrections in HANDOFF, SYSTEM_AUDIT, BUSINESS_RULES, ARCHITECTURE, DATABASE_MIGRATION_PLAN, T04/T05/T08. No migration created. | Read-only Supabase project snapshot: PostgreSQL 17.6; 45 relations, 87 routines, 41 triggers, 77 policies; exact hashes/history and relevant precision recorded in SCHEMA_BASELINE. Published site HTTP 200 and bundle project ref matches. Manifest integrity: 60/60 paths and SHA-256 hashes valid; dependency order/counts valid; migration 33 explicitly absent. Before T01 edits, `npm run test:unit`: 42 passed, 0 failed; `npm run lint`: passed; `git diff --check`: passed. | Empty isolated bootstrap, restored-clone comparison and V47/V48/V51 remain pending. User selected the populated deployed project and declined a separate database branch; destructive bootstrap/restore checks were not run there. Workspace has no Supabase CLI, psql or Docker. No SQL/write applied. T01 scaffolding can proceed, but database-backed T01 verification and T02+ feature work remain gated on T00. |
| [T01](TASKS/T01_add-guarded-enhancement-test-harness.md) | In progress | Codex / main working tree | `kodigo-ui/scripts/enhancement-test-target.mjs`; `scripts/run-enhancement-db-tests.mjs`; `scripts/unit/enhancement-test-target.test.mjs`; `scripts/integration-checkout-stock-rls.mjs`; `playwright.config.ts`; `tests/e2e/harness.spec.ts`; `supabase/tests/enhancements/fixtures.sql`; `T01_harness.sql`; package scripts; CI workflow; README and task specification. No migration created. | Static review only. The SQL runner requires explicit isolated database identity, rejects the deployed ref and runs a rollback-only transaction. Existing cleanup-based integration harness no longer falls back to `VITE_*` credentials. CI separates opt-in database jobs from standard checks; remote browser smoke is HTTPS/read-only opt-in. No tests run after the user's instruction to avoid local testing. Read-only deployed browser check confirmed the authenticated JP Store POS, rendered an existing product in cart, then removed it and confirmed an empty cart; no checkout was submitted. | T00 is incomplete, so T01's declared dependency is not satisfied. No explicitly isolated project is available; SQL, integration, unit and Playwright checks have not been executed. New shopping-list UI has not yet been deployed or checked. |
| [T02](TASKS/T02_add-operation-identity-and-replay-contract.md) | Planned | — | — | — | — |
| [T03](TASKS/T03_add-scoped-supervisor-capabilities-and-approval-guards.md) | Planned | — | — | — | — |
| [T04](TASKS/T04_add-inventory-locations-and-structured-ledger-fields.md) | Planned | — | — | — | — |
| [T05](TASKS/T05_implement-the-centralized-stock-mutation-service.md) | Planned | — | — | — | — |
| [T06](TASKS/T06_route-all-existing-stock-writers-through-the-ledger.md) | Planned | — | — | — | — |
| [T07](TASKS/T07_show-complete-product-and-transaction-stock-history.md) | Planned | — | — | — | — |
| [T08](TASKS/T08_add-commercial-credit-and-normalized-financial-fact-models.md) | Planned | — | — | — | — |
| [T09](TASKS/T09_correct-reporting-discount-basis-and-share-financial-facts.md) | Planned | — | — | — | — |
| [T10](TASKS/T10_add-void-requests-decisions-and-application-records.md) | Planned | — | — | — | — |
| [T11](TASKS/T11_implement-void-eligibility-and-exact-reversal-quote.md) | Planned | — | — | — | — |
| [T12](TASKS/T12_implement-void-request-and-independent-decision-endpoints.md) | Planned | — | — | — | — |
| [T13](TASKS/T13_apply-full-void-with-source-stock-and-confirmed-money-reversal.md) | Planned | — | — | — | — |
| [T14](TASKS/T14_add-cashier-void-requests-and-supervisor-review-ui.md) | Planned | — | — | — | — |
| [T15](TASKS/T15_gate-optional-partial-void-policy-and-bounded-execution.md) | Planned | — | — | — | D02 gates enablement; flag-off test required |
| [T16](TASKS/T16_extend-return-intake-and-disposition-schema.md) | Planned | — | — | — | — |
| [T17](TASKS/T17_validate-physical-return-quantity-and-monetary-entitlement.md) | Planned | — | — | — | — |
| [T18](TASKS/T18_record-accepted-returns-and-credits-without-automatic-refund.md) | Planned | — | — | — | — |
| [T19](TASKS/T19_apply-return-disposition-and-inspection-transfers-to-source-lots.md) | Planned | — | — | — | — |
| [T20](TASKS/T20_add-refund-reservations-approval-and-settlement-schema.md) | Planned | — | — | — | — |
| [T21](TASKS/T21_implement-credit-and-capture-allocation-for-refunds.md) | Planned | — | — | — | — |
| [T22](TASKS/T22_confirm-refunds-with-independent-cash-or-external-settlement.md) | Planned | — | — | — | — |
| [T23](TASKS/T23_separate-return-disposition-and-refund-controls-in-pos.md) | Planned | — | — | — | — |
| [T24](TASKS/T24_register-terminals-drawers-and-real-shift-opening.md) | Planned | — | — | — | — |
| [T25](TASKS/T25_post-append-only-physical-cash-movements-and-holds.md) | Planned | — | — | — | — |
| [T26](TASKS/T26_bind-checkout-void-and-refund-cash-to-real-shifts.md) | Planned | — | — | — | — |
| [T27](TASKS/T27_add-shift-opening-and-authorized-cash-movement-ui.md) | Planned | — | — | — | — |
| [T28](TASKS/T28_freeze-watermarked-cashier-closeout-snapshots.md) | Planned | — | — | — | — |
| [T29](TASKS/T29_add-independent-closeout-review-comments-and-decisions.md) | Planned | — | — | — | — |
| [T30](TASKS/T30_build-cashier-closeout-and-administrator-review-screens.md) | Planned | — | — | — | — |
| [T31](TASKS/T31_append-late-transaction-and-refund-closeout-amendments.md) | Planned | — | — | — | — |
| [T32](TASKS/T32_add-nonstock-service-catalog-and-digital-account-models.md) | Planned | — | — | — | — |
| [T33](TASKS/T33_implement-immutable-fee-policy-versions-and-exact-quotes.md) | Planned | — | — | — | — |
| [T34](TASKS/T34_implement-wallet-ledger-holds-and-balance-conservation.md) | Planned | — | — | — | — |
| [T35](TASKS/T35_add-wallet-funding-and-statement-reconciliation-controls.md) | Planned | — | — | — | — |
| [T36](TASKS/T36_implement-manual-digital-service-step-orchestration.md) | Planned | — | — | — | — |
| [T37](TASKS/T37_configure-and-verify-e-load-sale-workflow.md) | Planned | — | — | — | — |
| [T38](TASKS/T38_configure-and-verify-gcash-cash-in-workflow.md) | Planned | — | — | — | — |
| [T39](TASKS/T39_configure-and-verify-gcash-cash-out-workflow.md) | Planned | — | — | — | — |
| [T40](TASKS/T40_build-digital-service-pos-forms-and-progress-states.md) | Planned | — | — | — | — |
| [T41](TASKS/T41_implement-evidence-based-digital-reversal-cases.md) | Planned | — | — | — | — |
| [T42](TASKS/T42_add-digital-earnings-and-reconciliation-reporting.md) | Planned | — | — | — | — |
| [T43](TASKS/T43_add-store-scoped-customer-identity-without-rewriting-history.md) | Planned | — | — | — | — |
| [T44](TASKS/T44_add-customer-profile-screens-and-optional-checkout-selection.md) | Planned | — | — | — | — |
| [T45](TASKS/T45_expose-paginated-customer-purchase-history-and-totals.md) | Planned | — | — | — | — |
| [T46](TASKS/T46_add-configurable-customer-rankings-using-shared-facts.md) | Planned | — | — | — | — |
| [T47](TASKS/T47_create-nonfiscal-shopping-list-snapshots-and-browser-layout.md) | In progress | Codex / main working tree | `src/types/shopping-lists.ts`; `src/lib/shopping-lists.ts`; `src/lib/shopping-list-markup.ts`; `src/lib/document-print.ts`; `src/lib/receipt-print.ts`; `src/pages/RestockingPage.tsx`; `scripts/unit/shopping-list-print.test.mjs`. No migration. | Source review only. Added immutable versioned snapshots, existing TXT download now uses the snapshot, sanitized 58/80 mm markup with optional prices, dynamic page sizing, and shared iframe transport while retaining receipt IDs/selector/page rules. New snapshot/markup/hash/transport unit tests authored. No tests run locally per instruction; remote CI/deployed checks pending. | T01 dependency remains unverified. User-visible preview is tracked under T49. Preserve fiscal receipt output via the unchanged receipt markup; not yet regression-tested after extraction. |
| [T48](TASKS/T48_extend-existing-native-agent-with-a-shopping-list-endpoint.md) | In progress | Codex / main working tree | `print-agent/Program.cs`; `ShoppingListFormatter.cs`; `ShoppingListAttemptLedger.cs`; `print-agent-tests/Program.cs`; test project links; `src/lib/hardware.ts`; agent README; agent version 1.0.2; API contract and T48 spec. No migration. | Source review only. Added authenticated capability advertisement, 58/80 mm ESC/POS formatter, recomputed content/profile hash, separate bounded fail-closed document/attempt ledger, explicit reprint semantics, and client adapter. Formatter/dedupe tests authored for remote CI. No local tests/build per instruction; no physical printer job submitted. | T47/T01 verification remains open. Actual paper width is user-selected and cannot be detected from Windows printer metadata; UI warns to match loaded paper. |
| [T49](TASKS/T49_add-shopping-list-preview-print-and-explicit-reprint-ui.md) | In progress | Codex / main working tree | `src/pages/RestockingPage.tsx`; `src/components/shopping/ShoppingListPreviewDialog.tsx`; `tests/e2e/shopping-list-print.spec.ts`. No migration. | Source review only. Added frozen preview, refresh-to-new-document behavior, paper/price controls, capability-aware native option, browser fallback, active-submit guard, separate attempt IDs, explicit reprint wording, and honest spool/dialog status. E2E authored to avoid sale, receipt, drawer, or inventory writes. No local tests; deployed verification pending. | T01 remains incomplete. Authenticated deployed restocking flow has not been checked against these changes yet; test requires an existing restock item or explicit admin browser state and skips otherwise. |
| [T50](TASKS/T50_migrate-indexeddb-to-a-durable-encrypted-operation-outbox.md) | Planned | — | — | — | — |
| [T51](TASKS/T51_issue-bounded-offline-cashier-authorization-leases.md) | Planned | — | — | — | — |
| [T52](TASKS/T52_reserve-per-terminal-product-and-lot-stock-for-offline-sales.md) | Planned | — | — | — | — |
| [T53](TASKS/T53_add-ordered-idempotent-server-synchronization-protocol.md) | Planned | — | — | — | — |
| [T54](TASKS/T54_unify-retry-scheduling-and-multi-tab-synchronization.md) | Planned | — | — | — | — |
| [T55](TASKS/T55_expose-offline-queue-truth-and-scoped-offline-checkout.md) | Planned | — | — | — | — |
| [T56](TASKS/T56_add-compatible-offline-app-shell-caching-and-update-gating.md) | Planned | — | — | — | — |
| [T57](TASKS/T57_recover-legacy-queues-and-unresolved-offline-operations-safely.md) | Planned | — | — | — | — |
| [T58](TASKS/T58_verify-cross-domain-invariants-concurrency-and-migration-compatibility.md) | Planned | — | — | — | — |
| [T59](TASKS/T59_verify-end-to-end-roles-hardware-fallback-and-recovery.md) | Planned | — | — | — | — |
| [T60](TASKS/T60_rehearse-staged-rollout-reconciliation-and-safe-rollback.md) | Planned | — | — | — | — |

