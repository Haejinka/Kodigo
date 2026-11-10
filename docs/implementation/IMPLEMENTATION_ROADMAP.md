# Implementation roadmap

This is an execution DAG, not permission to start implementation during planning. All 61 task specifications are planned. Complexity: S = focused change; M = several coherent edits; L = concurrency/cross-boundary work requiring staged review. These are relative review estimates, not delivery promises.

## Safest execution order

1. **Baseline and verification:** T00 → T01. Do not trust README replay order or run existing mutating harness against production.
2. **Shared command and permission foundation:** T02 → T03. Capture offline/identity/idempotency metadata now, before any new business path.
3. **Independent additive lanes:** inventory T04 → T05; custody T24 → T25; printing T47 → T48 → T49; encrypted outbox T50 can be developed/tested behind flags. Customer schema T43 can follow T03. These lanes must not enable new writes prematurely.
4. **Inventory and accounting cutover:** T06 → T08 → T09, with T07 after T06. After T50 and custody foundation, T51 → T52 can establish offline authority/stock contracts in isolated tests; offline selling remains disabled.
5. **Distinct lifecycle operations:** void T10 → T11 → T12 → T13 → T14 (T13 also needs cash T25); returns T16 → T17 → T18 → T19; refunds T20 → T21 → T22 → T23 (T21 needs intake, T22 cash). Optional T15 follows shared entitlement and policy D02; default remains disabled.
6. **Cashier accounting release:** T26 → T27 → T28 → T29 → T30 → T31. Core lifecycle services can be reviewed earlier but their money workflows remain off until sale/cash linkage is complete.
7. **Independent operational lanes after cash:** digital T32 → T33 → T34 → T35, then T36 with closeout foundation; e-load T37, cash-in T38 and cash-out T39 share T36 and then T40/T41/T42. Customer T44 → T45 → T46 shares financial facts and can progress independently of digital.
8. **Offline activation:** T53 (requires escrow, normal sale accounting and late-close amendment) → T54 → T55; T56 app-shell can proceed after storage/lease. T57 joins recovery with reconciliation and shell. Do not enable offline fulfillment until D03, stock grants and all failure/recovery checks pass.
9. **Release evidence:** T58 → T59 → T60. T58 also verifies partial-void flag-off; if partial enabled, T15 and its optional tests are required. Production activation is separate from completing code tasks.

## Parallel work and shared-file coordination

Safe parallel implementation is conditional on dependencies and separate file ownership; this is a future implementation option, not a requirement to spawn agents. T04/T24/T47/T50 own independent artifacts after foundation. T10–T12 and T16–T17 data/validator work can progress concurrently. T37/T38/T39 share one orchestrator file: use separate configuration/test patches or serialize integration; do not merge conflicting state-machine copies. Customer read work and printing can progress alongside digital/offline after prerequisites.

Serialize migrations that redefine the same function or trigger; T05/T06 own stock writes; T08/T09 own financial basis; T13/T18/T22/T26 integration must review the shared SQL dispatch layer. POSPage, PaymentModal, TransactionLifecyclePanel, App, Sidebar and reporting.ts require a single integration owner or sequential merges. Never edit historical migrations in separate branches to resolve conflicts. Every task depends on all prerequisite contract changes, even if task number is lower than dependency number.

## Release gates

- **G0:** proven schema/bootstrap/test target and restore evidence (T00–T01).
- **G1:** single authoritative stock writer and normalized accounting facts (T02–T09).
- **G2:** independent approvals, physical returns, actual settlement and drawer movements integrated (T10–T31; T15 optional and default off).
- **G3:** manual-only digital account/fee/tax/evidence policy and reconciled step ledgers (T32–T42, D04/D05).
- **G4:** customer privacy scope and printing device/profile verification (T43–T49; D07/D08).
- **G5:** managed-device/lease/escrow acceptance, encryption/recovery and long-disconnection acceptance (T50–T57, D03).
- **G6:** invariant/migration/E2E/physical pilot and compensating rollback rehearsal (T58–T60).

A flag requires its dependency flags and server checks. A UI hiding controls cannot enforce a release gate. Old clients receive upgrade-required where needed. Read/history can ship before new writes if it does not mislabel legacy values. Foundation does not require an external provider API or architecture rewrite.

## Task index and dependencies

| Task | Responsibility | Priority | Complexity | Direct dependencies |
| --- | --- | --- | --- | --- |
| [T00](TASKS/T00_fingerprint-schema-and-prove-bootstrap-order.md) | Fingerprint schema and prove bootstrap order | Critical | L | — |
| [T01](TASKS/T01_add-guarded-enhancement-test-harness.md) | Add guarded enhancement test harness | Critical | M | T00 |
| [T02](TASKS/T02_add-operation-identity-and-replay-contract.md) | Add operation identity and replay contract | Critical | L | T01 |
| [T03](TASKS/T03_add-scoped-supervisor-capabilities-and-approval-guards.md) | Add scoped supervisor capabilities and approval guards | Critical | M | T02 |
| [T04](TASKS/T04_add-inventory-locations-and-structured-ledger-fields.md) | Add inventory locations and structured ledger fields | Critical | L | T02, T03 |
| [T05](TASKS/T05_implement-the-centralized-stock-mutation-service.md) | Implement the centralized stock mutation service | Critical | L | T04 |
| [T06](TASKS/T06_route-all-existing-stock-writers-through-the-ledger.md) | Route all existing stock writers through the ledger | Critical | L | T05 |
| [T07](TASKS/T07_show-complete-product-and-transaction-stock-history.md) | Show complete product and transaction stock history | High | M | T06 |
| [T08](TASKS/T08_add-commercial-credit-and-normalized-financial-fact-models.md) | Add commercial credit and normalized financial fact models | Critical | L | T02, T03, T06 |
| [T09](TASKS/T09_correct-reporting-discount-basis-and-share-financial-facts.md) | Correct reporting discount basis and share financial facts | Critical | M | T08 |
| [T10](TASKS/T10_add-void-requests-decisions-and-application-records.md) | Add void requests decisions and application records | High | M | T03, T08 |
| [T11](TASKS/T11_implement-void-eligibility-and-exact-reversal-quote.md) | Implement void eligibility and exact reversal quote | High | M | T10 |
| [T12](TASKS/T12_implement-void-request-and-independent-decision-endpoints.md) | Implement void request and independent decision endpoints | High | M | T11 |
| [T13](TASKS/T13_apply-full-void-with-source-stock-and-confirmed-money-reversal.md) | Apply full void with source stock and confirmed money reversal | Critical | L | T12, T05, T08, T25 |
| [T14](TASKS/T14_add-cashier-void-requests-and-supervisor-review-ui.md) | Add cashier void requests and supervisor review UI | High | M | T12, T13 |
| [T15](TASKS/T15_gate-optional-partial-void-policy-and-bounded-execution.md) | Gate optional partial void policy and bounded execution | Medium | L | T13, T14, T17, T21 |
| [T16](TASKS/T16_extend-return-intake-and-disposition-schema.md) | Extend return intake and disposition schema | High | M | T03, T08 |
| [T17](TASKS/T17_validate-physical-return-quantity-and-monetary-entitlement.md) | Validate physical return quantity and monetary entitlement | Critical | M | T16 |
| [T18](TASKS/T18_record-accepted-returns-and-credits-without-automatic-refund.md) | Record accepted returns and credits without automatic refund | High | L | T17, T05, T08 |
| [T19](TASKS/T19_apply-return-disposition-and-inspection-transfers-to-source-lots.md) | Apply return disposition and inspection transfers to source lots | Critical | L | T18 |
| [T20](TASKS/T20_add-refund-reservations-approval-and-settlement-schema.md) | Add refund reservations approval and settlement schema | High | M | T03, T08, T16 |
| [T21](TASKS/T21_implement-credit-and-capture-allocation-for-refunds.md) | Implement credit and capture allocation for refunds | Critical | M | T20, T18 |
| [T22](TASKS/T22_confirm-refunds-with-independent-cash-or-external-settlement.md) | Confirm refunds with independent cash or external settlement | Critical | L | T21, T25 |
| [T23](TASKS/T23_separate-return-disposition-and-refund-controls-in-pos.md) | Separate return disposition and refund controls in POS | High | M | T19, T22 |
| [T24](TASKS/T24_register-terminals-drawers-and-real-shift-opening.md) | Register terminals drawers and real shift opening | Critical | M | T02, T03 |
| [T25](TASKS/T25_post-append-only-physical-cash-movements-and-holds.md) | Post append-only physical cash movements and holds | Critical | L | T24 |
| [T26](TASKS/T26_bind-checkout-void-and-refund-cash-to-real-shifts.md) | Bind checkout void and refund cash to real shifts | Critical | L | T06, T08, T13, T22, T25 |
| [T27](TASKS/T27_add-shift-opening-and-authorized-cash-movement-ui.md) | Add shift opening and authorized cash movement UI | High | M | T25, T26 |
| [T28](TASKS/T28_freeze-watermarked-cashier-closeout-snapshots.md) | Freeze watermarked cashier closeout snapshots | Critical | L | T26, T27 |
| [T29](TASKS/T29_add-independent-closeout-review-comments-and-decisions.md) | Add independent closeout review comments and decisions | High | M | T28, T03 |
| [T30](TASKS/T30_build-cashier-closeout-and-administrator-review-screens.md) | Build cashier closeout and administrator review screens | High | M | T29 |
| [T31](TASKS/T31_append-late-transaction-and-refund-closeout-amendments.md) | Append late transaction and refund closeout amendments | Critical | L | T28, T29, T22, T30 |
| [T32](TASKS/T32_add-nonstock-service-catalog-and-digital-account-models.md) | Add nonstock service catalog and digital account models | High | M | T03, T08, T25 |
| [T33](TASKS/T33_implement-immutable-fee-policy-versions-and-exact-quotes.md) | Implement immutable fee policy versions and exact quotes | Critical | M | T32 |
| [T34](TASKS/T34_implement-wallet-ledger-holds-and-balance-conservation.md) | Implement wallet ledger holds and balance conservation | Critical | L | T32, T33 |
| [T35](TASKS/T35_add-wallet-funding-and-statement-reconciliation-controls.md) | Add wallet funding and statement reconciliation controls | High | M | T34, T27 |
| [T36](TASKS/T36_implement-manual-digital-service-step-orchestration.md) | Implement manual digital service step orchestration | Critical | L | T33, T34, T25, T31 |
| [T37](TASKS/T37_configure-and-verify-e-load-sale-workflow.md) | Configure and verify e-load sale workflow | High | M | T36 |
| [T38](TASKS/T38_configure-and-verify-gcash-cash-in-workflow.md) | Configure and verify GCash cash-in workflow | High | M | T36 |
| [T39](TASKS/T39_configure-and-verify-gcash-cash-out-workflow.md) | Configure and verify GCash cash-out workflow | High | M | T36 |
| [T40](TASKS/T40_build-digital-service-pos-forms-and-progress-states.md) | Build digital service POS forms and progress states | High | M | T37, T38, T39 |
| [T41](TASKS/T41_implement-evidence-based-digital-reversal-cases.md) | Implement evidence-based digital reversal cases | Critical | L | T37, T38, T39, T22 |
| [T42](TASKS/T42_add-digital-earnings-and-reconciliation-reporting.md) | Add digital earnings and reconciliation reporting | High | M | T35, T41, T09 |
| [T43](TASKS/T43_add-store-scoped-customer-identity-without-rewriting-history.md) | Add store-scoped customer identity without rewriting history | Medium | M | T02, T03 |
| [T44](TASKS/T44_add-customer-profile-screens-and-optional-checkout-selection.md) | Add customer profile screens and optional checkout selection | Medium | M | T43, T26 |
| [T45](TASKS/T45_expose-paginated-customer-purchase-history-and-totals.md) | Expose paginated customer purchase history and totals | Medium | M | T43, T09, T18, T22, T44 |
| [T46](TASKS/T46_add-configurable-customer-rankings-using-shared-facts.md) | Add configurable customer rankings using shared facts | Medium | M | T45 |
| [T47](TASKS/T47_create-nonfiscal-shopping-list-snapshots-and-browser-layout.md) | Create nonfiscal shopping-list snapshots and browser layout | Medium | M | T01 |
| [T48](TASKS/T48_extend-existing-native-agent-with-a-shopping-list-endpoint.md) | Extend existing native agent with a shopping-list endpoint | Medium | M | T47 |
| [T49](TASKS/T49_add-shopping-list-preview-print-and-explicit-reprint-ui.md) | Add shopping-list preview print and explicit reprint UI | Medium | S | T47, T48 |
| [T50](TASKS/T50_migrate-indexeddb-to-a-durable-encrypted-operation-outbox.md) | Migrate IndexedDB to a durable encrypted operation outbox | Critical | L | T02, T01 |
| [T51](TASKS/T51_issue-bounded-offline-cashier-authorization-leases.md) | Issue bounded offline cashier authorization leases | Critical | M | T03, T24, T50 |
| [T52](TASKS/T52_reserve-per-terminal-product-and-lot-stock-for-offline-sales.md) | Reserve per-terminal product and lot stock for offline sales | Critical | L | T05, T51 |
| [T53](TASKS/T53_add-ordered-idempotent-server-synchronization-protocol.md) | Add ordered idempotent server synchronization protocol | Critical | L | T06, T26, T31, T52 |
| [T54](TASKS/T54_unify-retry-scheduling-and-multi-tab-synchronization.md) | Unify retry scheduling and multi-tab synchronization | Critical | L | T50, T53 |
| [T55](TASKS/T55_expose-offline-queue-truth-and-scoped-offline-checkout.md) | Expose offline queue truth and scoped offline checkout | High | M | T54, T26, T52 |
| [T56](TASKS/T56_add-compatible-offline-app-shell-caching-and-update-gating.md) | Add compatible offline app-shell caching and update gating | Medium | M | T50, T51 |
| [T57](TASKS/T57_recover-legacy-queues-and-unresolved-offline-operations-safely.md) | Recover legacy queues and unresolved offline operations safely | Critical | L | T31, T53, T54, T55, T56, T42 |
| [T58](TASKS/T58_verify-cross-domain-invariants-concurrency-and-migration-compatibility.md) | Verify cross-domain invariants concurrency and migration compatibility | Critical | L | T13, T19, T22, T31, T42, T46, T49, T57 |
| [T59](TASKS/T59_verify-end-to-end-roles-hardware-fallback-and-recovery.md) | Verify end-to-end roles hardware fallback and recovery | High | L | T58 |
| [T60](TASKS/T60_rehearse-staged-rollout-reconciliation-and-safe-rollback.md) | Rehearse staged rollout reconciliation and safe rollback | Critical | L | T58, T59 |

## Requirement traceability

| Requested enhancement | Main task IDs |
| --- | --- |
| Supervisor void | T03,T10–T15,T25–T26,T31 |
| Expanded offline | T02,T04–T06,T24–T26,T31,T50–T57 |
| Drawer opening/movements | T24–T27 |
| Closeout review | T28–T31 |
| Thermal shopping lists | T47–T49 |
| Customer history/rankings | T08–T09,T43–T46 |
| Digital catalog/load/GCash | T32–T42 |
| Central inventory/reversal | T04–T07,T13,T16–T19,T52 |
| Unified operation/financial rules | T02–T03,T08–T09,T20–T22,T26,T36 |
| Data-integrity/migration/acceptance | T00–T01,T58–T60 and every owning task's tests |

