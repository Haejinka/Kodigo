# Kodigo speaker notes

Current presentation: **Kodigo_Pre_Defense_SWU_Refined.pptx**. 17 slides, target **14:00**. Rehearse at a natural pace and use the diagram slides for pointing and explanation. Bracketed preparation cues and source references are not spoken. All scripts are also embedded as editable PowerPoint notes.

## Slide 1: Kodigo

Presenter 1. Target 0:30.

Good day, panelists and adviser. We are Evon Christian Pahugot Vergara, Justin Comendador, and Xymmer James Nadera. We will present Kodigo, our point-of-sale and inventory application for small retail operations. The complete title here follows our current manuscript. We will begin with the research context, explain the developed system, and then move to the live demonstration. [Replace the adviser and academic-year placeholders before defense.]

Evidence: docs/Chapter 1-4 Manuscript v3.docx, title page.

## Slide 2: Agenda

Presenter 1. Target 0:20.

Our presentation follows the same overall sequence as our earlier defense. We will move from the background and research questions to the methodology and baseline findings. We will then explain Kodigo, its technical design, and the evidence that supports the live walkthrough.

Evidence: Final defense SWU 002.pptx, agenda and slide order.

## Slide 3: Background and case scenario

Presenter 1. Target 0:55.

The manuscript describes small businesses that use separate records for sales, stock, and reconciliation. A sale can be written in one place while the inventory record still waits for an update. The scenario on this slide is illustrative: staff record a sale, stock information remains unchanged until later encoding, and the owner compares several records before deciding what to order. It summarizes the kind of fragmentation discussed in Chapters 1 and 4. It is not a new respondent account or a measurement of Kodigo’s performance. The design problem is how to connect the transaction and stock records so that later reports use a consistent recorded basis.

Evidence: docs/Chapter 1-4 Manuscript v3.docx, Chapters 1 and 4.

## Slide 4: Statement of the problem

Presenter 1. Target 0:40.

The study asks three questions. What operational bottlenecks occur in manual inventory tracking and reconciliation? What framework and security controls are appropriate for the system, as assessed by qualified technical evaluators? And how acceptable is the developed system to intended users? The last question considers cost-effectiveness, reliability, efficiency, and security. The baseline results address the first question. Completed ratings for the technical and acceptability evaluations are not established by the repository evidence used for this deck.

Evidence: docs/Chapter 1-4 Manuscript v3.docx, Chapter 1: Statement of the Problem.

## Slide 5: Research goals

Presenter 1. Target 0:40.

Our general objective is to design, develop, and evaluate a cloud-based inventory and financial management framework tailored for SMEs. The specific objectives follow the research questions: identify workflow bottlenecks, determine an appropriate framework and information security measures, and evaluate system acceptability. In implementation terms, the first objective informs connected sales and inventory, the second informs the access and transaction controls, and the third requires evaluation after users interact with the prototype. These are concise paraphrases of the current manuscript, with final wording subject to adviser confirmation.

Evidence: docs/Chapter 1-4 Manuscript v3.docx, Chapter 1: Objectives of the Study.

## Slide 6: Review of related literature

Presenter 1. Target 0:40.

Chapter 2 organizes the literature around record accuracy, an integrated cloud framework, and security and acceptance. The manuscript discusses inventory inaccuracies and the burden of manual consolidation, then relates centralized records to the proposed framework. It also explains why authentication, controlled access, organizational readiness, and adoption concerns matter. We have condensed those discussions here. The references are the sources cited in the current manuscript. We are using them to explain design requirements, not claiming that these studies measured Kodigo or prove that our prototype has achieved a particular improvement.

Evidence: docs/Chapter 1-4 Manuscript v3.docx, Chapter 2: Shabani et al. (2021), Kosadi et al. (2021), Luo (2024), Mohammad (2022), Nagahawatta et al. (2024), Rashid et al. (2024).

## Slide 7: Research methodology

Presenter 1. Target 0:55.

The current manuscript uses an exploratory sequential mixed-method approach. For RQ1, interviews explain operational problems and the baseline questionnaire describes their frequency. RQ2 uses structured quantitative technical validation. RQ3 uses a quantitative acceptability survey after prototype interaction. The sampling approach is criterion-based purposive sampling with maximum variation. The development methodology is Agile Scrum. Research method and software development method serve different purposes, so we show both explicitly. Chapter 4 reports eighteen baseline respondents and five interview transcripts. The manuscript’s participant plan also includes three technical validators, but a planned validator count is not proof that validation ratings have already been completed.

Evidence: docs/Chapter 1-4 Manuscript v3.docx, Chapter 3: Research Framework and Design; Sampling; Data Gathering; Software Development Methodology; Chapter 4: Response Rate.

## Slide 8: Results and findings of RQ1

Presenter 1. Target 1:05.

These are the baseline findings reported in Chapter 4, based on eighteen pre-survey respondents. Thirteen reported that inventory updates take at least sixteen minutes after a sale or issuance. Twelve reported at least three inventory discrepancies over the preceding thirty days. Sixteen said uncertain information delayed decisions at least sometimes. All eighteen reported that records from different sources fail to match at least sometimes. The interviews explain the pattern through fragmented records, delayed visibility, and repeated correction work. These figures describe the existing workflow in this study’s sample. They are not post-implementation results, national SME estimates, or measured improvement rates for Kodigo. I will now hand over to Presenter 2 to show how the developed system responds to those requirements.

Evidence: docs/Chapter 1-4 Manuscript v3.docx, Chapter 4: Table 4.1 and qualitative themes from five interview transcripts.

## Slide 9: Developed IT solution

Presenter 2. Target 0:45.

Kodigo now implements the operational modules shown here: POS and receipts, product and base-stock control, replenishment and suppliers, reporting, and user administration. Consignment support records received goods and supplier balances, including payments or credits entered by an Admin. The roles do not receive the same access. Admin operates within assigned stores, Cashier uses POS functions, Inventory performs permitted stock work, and Super Admin uses a separate invite portal. The next diagrams show the framework and the boundaries between those roles and the data operations.

Evidence: README.md, intended users and capabilities; kodigo-ui/src/App.tsx; kodigo-ui/src/components/pos/TransactionLifecyclePanel.tsx; kodigo-ui/src/components/inventory/ConsignmentPanel.tsx; kodigo-ui/src/pages/ReportsPage.tsx.

## Slide 10: Conceptual framework

Presenter 2. Target 0:45.

The framework begins with authorized users and configured retail information. Kodigo processes sales, inventory changes, and purchasing information, then produces recorded transactions, stock history, and operational reports. Admin, Cashier, and Inventory participate in store operations according to their permissions. Super Admin handles invite-code governance separately. Supplier records are entered internally by authorized staff; there is no supplier-facing portal. Better visibility is a design purpose to evaluate, while the verifiable output of the implementation is the linked set of stored records.

Evidence: docs/Chapter 1-4 Manuscript v3.docx, Chapter 3: Conceptual Framework; kodigo-ui/src/App.tsx; kodigo-ui/src/stores/productStore.ts; kodigo-ui/src/lib/reporting.ts.

## Slide 11: Use cases and user access

Presenter 2. Target 0:45.

This use-case view replaces the old two-role diagram with the current four-role structure. Admin manages assigned-store operations and users. Cashier processes sales and uses permitted transaction tools. Inventory maintains product and stock information and uses inventory-oriented reports. Super Admin generates owner invite codes through its own portal. The interface redirects unavailable routes, while database policies and protected functions also check role and store membership. TOTP enrollment is supported, and verified-factor accounts require appropriate AAL2 assurance for protected operations. These controls are implemented in source; live authorization still requires negative tests.

Evidence: kodigo-ui/src/App.tsx, RequireAdmin/RequireBackOffice/RequirePOSAccess; kodigo-ui/src/pages/ReportsPage.tsx; migration_28_member_account_rbac_hardening.sql; supabase/migrations/20260803023252_enforce_mfa_assurance.sql; supabase/functions/admin-users/index.ts; supabase/functions/generate-invite/index.ts; supabase/drafts/super_admin_access_fix_review.md.

## Slide 12: System architecture

Presenter 2. Target 1:05.

The browser runs React and TypeScript, built with Vite. Zustand holds application state, and TanStack Query actively manages query data. Through Supabase JS, the browser authenticates with Auth, reads permitted tables through the Data API, and calls PostgreSQL RPCs for important operations. Edge Functions handle privileged account and invite tasks. Storage holds uploaded assets. PostgreSQL is the authoritative business store and runs validation, row policies, and stock triggers. IndexedDB provides a local product cache and selected queues. Reconnection attempts replay, but a queued sale does not establish a database commit. Vercel routing configuration exists, while the deployed hosting state and migration chain remain to be checked.

Evidence: kodigo-ui/src/App.tsx; kodigo-ui/src/lib/supabase.ts; kodigo-ui/src/stores/authStore.ts; kodigo-ui/src/lib/offline-sync.ts; supabase/functions/admin-users/index.ts; supabase/functions/generate-invite/index.ts; kodigo-ui/src/lib/branding.ts; kodigo-ui/vercel.json.

## Slide 13: Database design

Presenter 2. Target 0:50.

A product has configured selling options, stock history, and receiving history. Sales contain sale_items that refer to the product and an optional selling option. The current sale path deducts the required quantity from the product’s base stock. Stock changes write inventory_movements, and receiving writes restock_history. Historical sale and receipt snapshots preserve the values recorded at the time of a transaction. Store membership uses stores, profiles, and store_users. This diagram omits payment, supplier, lot, and return entities for readability, but those remain part of the implementation.

Evidence: supabase_schema.sql, products/sales/sale_items; migration_20_product_selling_options.sql; migration_27_inventory_branding_receipts.sql, inventory_movements; migration_29_base_unit_inventory_margin_velocity.sql, restock_history; migration_34_bulk_purchase_base_units.sql; migration_37_unit_aware_inventory_workflow.sql.

## Slide 14: Core system logic

Presenter 2. Target 1:00.

Online checkout calls process_pos_sale_v4. It delegates sale processing to version three and checks line discounts. The database validates the caller and assigned store, checks combined stock requirements, and recalculates prices and totals. Product locks protect concurrent stock consumption, while exceptions roll back the transaction. The stock trigger converts a bulk quantity into base units. For example, two packs of six consume twelve pieces from a stock of twenty-four, leaving twelve. That is illustrative arithmetic, not a recorded test outcome. Receiving also converts configured packages into base units and records cost and stock history. A separate authorized action applies a reviewed selling-price change. I will now hand over to Presenter 3 for the development platform, testing evidence, and demonstration plan.

Evidence: kodigo-ui/src/lib/offline-sync.ts, pushSaleToSupabase; supabase/migrations/20261019130000_client_revision_fixes.sql, process_pos_sale_v4/receive_product_stock; supabase/migrations/20260930090000_vat_inclusive_pos_totals.sql, process_pos_sale_v3; migration_34_bulk_purchase_base_units.sql, trg_deduct_stock_on_sale; migration_37_unit_aware_inventory_workflow.sql, restock_product_inventory_v2; kodigo-ui/src/stores/productStore.ts, adjustStock/updateSellingPrice.

## Slide 15: Development platform

Presenter 3. Target 0:55.

The platform overview follows the same progression as our earlier deck. A desktop browser is used for the main POS flow. Barcode input is implemented, while receipt and drawer hardware are optional and depend on actual device availability. Git and the CI workflow support the development process. The frontend uses React, TypeScript, Vite, Tailwind, Zustand, and TanStack Query. Backend responsibilities use Supabase Auth, PostgreSQL, RLS, Storage, and Edge Functions. The repository contains Vercel SPA routing configuration. The current hardware module uses a QZ Tray bridge for supported printer and drawer operations. We should verify that connection separately before a live hardware demonstration.

Evidence: kodigo-ui/package.json; kodigo-ui/src/lib/hardware.ts; kodigo-ui/src/App.tsx; kodigo-ui/vercel.json; .github/workflows/ci.yml.

## Slide 16: Testing, readiness and limitations

Presenter 3. Target 1:05.

The seven existing reporting unit tests passed during the repository checks for this package. They cover allocations, refunds, calendar ranges, rankings, hardware-action separation, and historical unit-price calculations. TypeScript and ESLint also passed. Those results establish narrow local checks, not whole-system acceptance. The checkout, stock, and RLS integration harness was inspected but not run because it provisions and removes records. Live migration, MFA, role-isolation, concurrency, and transaction checks remain pending. Kodigo is online-first with bounded queues rather than complete offline operation. Error entries require reconciliation. Its descriptive calculations are deterministic, and neither receipt OCR nor predictive machine learning is implemented. It also does not replace a full accounting or tax-filing system.

Evidence: docs/Chapter 1-4 Manuscript v3.docx, Software Development Methodology; kodigo-ui/package.json; kodigo-ui/scripts/unit/reporting-calculations.test.mjs; kodigo-ui/scripts/integration-checkout-stock-rls.mjs; .github/workflows/ci.yml; outputs/pre-defense-build, local check record dated 2026-10-20; docs/Chapter 1-4 Manuscript v3.docx, Limitations of the System; kodigo-ui/src/lib/offline-sync.ts; kodigo-ui/src/lib/sales-velocity.ts; kodigo-ui/src/pages/RestockingPage.tsx; supabase/drafts/super_admin_access_fix_review.md.

## Slide 17: System walkthrough

Presenter 3. Target 1:05.

We will now move to the application. An authorized operator must prepare and independently verify the cleared demonstration business state while preserving required schema, authentication, store membership, and configuration. No reset was executed for this presentation task. A working store Admin must remain available because the current Super Admin portal cannot perform normal store setup. Browser queues must also be reconciled so old pending writes do not repopulate cleared data. The sequence is login, product setup, receiving, POS checkout, stock verification, and reports. We will compare the stored sale, stock movement, and report values. If connectivity fails, we will identify a queued transaction as pending rather than claim completed persistence. The detailed checklist contains the expected arithmetic and recovery steps.

Evidence: User task brief, demo requirements and prohibition on reset execution; kodigo-ui/src/stores/authStore.ts; kodigo-ui/src/stores/productStore.ts; kodigo-ui/src/lib/offline-sync.ts; kodigo-ui/src/pages/ReportsPage.tsx.

