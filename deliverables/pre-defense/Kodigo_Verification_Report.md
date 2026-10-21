# Kodigo presentation verification report

Inspection date: 20 October 2026, Asia/Manila. Repository: `C:\Kodigo v0.1.0`. Commit at inspection: `7a733d03e15804940b7607f62a943c529facf177`. Working tree was clean before deliverable generation. Scope: repository analysis and presentation/document authoring only. No live database access, reset, migration application, configuration change, or application-source edit was performed.

## Evidence standard and repository coverage

“Implemented” means an active route/import/call and relevant code or migration are present. It does not prove deployment, successful live execution, user acceptance, performance, or security certification. Installed packages alone do not establish use. Documentation and SQL baselines can lag the current implementation. Root numbered migrations and dated `supabase/migrations/` files both contain later definitions. `supabase/drafts/` is a proposal area, excluded from implemented behavior.

Discovery covered root documentation, the active `kodigo-ui` app, its source/component/store/library structure, package scripts and manifest, schema baseline, both migration families, both Edge Functions, GitHub CI, operational and audit documents, the capstone manuscript, and available repository branding/screenshots. Generated historical documents, node_modules, build outputs, caches and backup source copies were inventoried as supporting material rather than treated as current implementation. Environment files and credentials were not used for the deck.

Primary research source: `docs/Chapter 1-4 Manuscript v3.docx`. Text was extracted locally from its OOXML to locate the title page, Chapter 1 objectives and scope, Chapter 3 methodology, and Chapter 4 baseline material. The revised institutional deck includes four baseline indicators from Chapter 4, Table 4.1, with counts and percentages as reported by the manuscript. It does not treat them as measured Kodigo improvements or independently re-analyzed raw survey data. The manuscript is a supplied research source, not independent validation of the code.

## Verified implementation findings

| Area | Finding | Repository evidence |
|---|---|---|
| Intended users | Multi-store small retail operations, Admin/owner, Cashier, Inventory, separate Super Admin invite governance | README; `src/App.tsx`; `src/stores/authStore.ts` |
| Frontend | React 19, TypeScript, Vite. Tailwind 4 and Inter styling, Radix UI primitives, Lucide icons | `kodigo-ui/package.json`; `src/main.tsx`; `src/index.css`; components |
| Routing/state | React Router guards, Zustand stores, actively used TanStack Query | `src/App.tsx`; `src/stores/*`; `src/pages/ReportsPage.tsx` |
| Backend | Browser Supabase JS client accesses Auth, table Data API, PostgreSQL RPC, Storage and account/invite Edge Functions | `src/lib/supabase.ts`; `src/stores/authStore.ts`; `src/lib/offline-sync.ts`; `src/lib/branding.ts`; `supabase/functions/*/index.ts` |
| Auth | Email/password, invite-based owner registration, password reset and TOTP enrollment/assurance gate | `src/stores/authStore.ts`; login/register/recovery pages; `src/lib/mfa.ts`; `src/components/auth/MfaGate.tsx` |
| Access | Route gates differ by role. Database membership/role policies and protected functions enforce store scope. Admin-users verifies caller server-side | `src/App.tsx`; migration 28; MFA migration; `supabase/functions/admin-users/index.ts` |
| MFA | Verified-factor accounts require AAL2 via `private.mfa_session_is_valid`, integrated into role/store helpers | `supabase/migrations/20260803023252_enforce_mfa_assurance.sql` |
| POS | Search/barcode, cart, payment, receipts, transaction history, lifecycle functions | `src/pages/POSPage.tsx`; `components/pos/*`; `src/lib/transactions.ts`; `src/lib/receipts.ts` |
| Authoritative sale path | Browser calls `process_pos_sale_v4`, which invokes v3. v3 validates caller/store, locks product rows, validates aggregate stock and server prices/totals. v4 validates item discounts and can return a prior committed ID | `src/lib/offline-sync.ts`; `20261019130000_client_revision_fixes.sql`; `20260930090000_vat_inclusive_pos_totals.sql` |
| Stock deduction | Current trigger uses quantity × bulk multiplier against `products.current_stock`, writes inventory movements and synchronizes selling-option projections | migration 34 `trg_deduct_stock_on_sale`; later lot-allocation migrations |
| Receiving | `receive_product_stock` calls `restock_product_inventory_v2`, validates role/store/ownership/supplier, records base quantities and received-package snapshots | `src/stores/productStore.ts`; migration 37; `20261019130000_client_revision_fixes.sql` |
| Pricing | Margin/rounding assistance, configured bulk fixed/percentage rules, line discounts; receiving suggests a price, a separate authorized action updates live price | product form; `src/lib/utils.ts`; `src/stores/productStore.ts`; migration 37; v3/v4 sale functions |
| Products | Product CRUD, supplier links, receiving/selling options, stock adjustment, import, archival, history | active inventory pages/components; `productStore.ts`; migrations 35–40 |
| Purchasing | Supplier records, purchase orders, restocking suggestions and receiving workflows | supplierStore; suppliers and restocking pages; migration 31; receiving RPCs |
| Consignment | Stock lots, allocation, received-goods payable basis, Admin-entered supplier payments/credits and balances | `ConsignmentPanel.tsx`; dated consignment migrations including `20261019120001_consignment_received_goods_accrue_payable.sql` |
| Monitoring/reporting | Dashboard, rankings, descriptive analytics, stock alerts/notifications, transaction-derived sales and inventory reports, spreadsheet/PDF-related outputs | pages; `src/lib/reporting.ts`; `reporting-calculations.ts`; alertStore |
| Replenishment | Recorded consumption/sales and losses, supplier lead time and buffers, rounded to packages, threshold fallback | `src/pages/RestockingPage.tsx`; `src/lib/sales-velocity.ts`; migration 40 |
| Local persistence | IndexedDB stores `products_cache`, `sales_queue`, `generic_mutations`. Online listeners attempt pending replay; database rejections are surfaced; failed replay is retained as error | `src/lib/offline-sync.ts`; `src/App.tsx` |
| Error behavior | Client validates inputs, re-fetches stock after failed adjustment, surfaces server rejections. Logging and pending/error queues exist | PaymentModal; productStore; offline-sync; error-logging |
| Deployment | `kodigo-ui/vercel.json` contains SPA fallback routing. Hosted deployment state was not checked | Vercel configuration only |
| Hardware | Current module imports QZ Tray for optional printer/drawer bridge. Browser/PDF receipt paths also exist | `src/lib/hardware.ts`; receipts and PaymentModal |

Paths beginning `src/` in this table are relative to `kodigo-ui/`. Slides contain traceable repository references in their speaker notes.

## Simplified data model used in slide 13

The diagram uses real table names: `products`, `product_selling_options`, `sales`, `sale_items`, `restock_history`, and `inventory_movements`. Products have selling options and receiving/movement histories. Sales contain sale items, whose product and optional selling-option references connect the transaction to catalog configuration. Store scope comes from `stores`, `profiles` and `store_users`. The diagram intentionally omits the many supplier/order, payment, receipt, return, notification, stock-lot and consignment entities. It does not claim to be a full ERD. Current stock lives on products rather than a fictional generic `inventory` table.

## Documentation discrepancies resolved for the deck

- README calls TanStack Query installed in its stack table. Current App and reporting pages actively use it, so the architecture includes it.
- Older audit prose describes a seven-day best-seller panel. Current manuscript and code use revised dashboard/report behavior, so no seven-day ranking claim appears in the deck.
- Older documents mention Web Serial hardware. Current `hardware.ts` imports QZ Tray, so the deck/checklist names the optional local bridge without asserting hardware verification.
- Some older migration functions allow independent selling-option stock streams. The current trigger in migration 34 deducts from the product’s base stock. The main technical explanation follows that current path. Legacy/nonshared option migration compatibility requires live verification if such records remain.
- The schema baseline and older documentation do not fully describe recent consignment and v4 checkout changes. Current dated migrations and active RPC calls take precedence for implemented source behavior. Actual applied order is unverified.
- The Super Admin access review proposes broader scoped store operations. Current App guards still send that role to the invite portal. The proposed access fix is not shown as completed.
- Manuscript language includes “financial management.” The deck preserves the official title while describing actual operational reporting and consignment boundaries. It makes no full-ledger, tax-filing or certification claim.

## Testing evidence

Checks run locally for this task on 20 October 2026:

| Check | Result | Interpretation |
|---|---|---|
| Existing Node unit suite `scripts/unit/reporting-calculations.test.mjs` | 7 tests passed, 0 failed, 0 skipped | Narrow calculation and hardware-action logic coverage |
| TypeScript `tsc -b --pretty false` | Exit 0 | Project typecheck completed |
| ESLint `eslint .` | Exit 0 | Configured static lint checks completed |
| Production build | Not rerun in this task | Do not present an old build result as a current result |
| Checkout/stock/RLS integration harness | Inspected, not executed | It provisions users/business records and deletes them, outside the task’s non-mutating scope |
| Live manual walkthrough, RLS, MFA, migration verification | Not executed | Required before claiming live readiness |
| Intended-user acceptability / ISO compliance | No completed result asserted | Questionnaire/manuscript material does not establish such an outcome |

The seven unit tests cover: payment allocation after discounts and cent remainders; item/manual refund allocation; partial captures and voided events; calendar date ranges; monthly ranking by net base units and excluded statuses; independent receipt/drawer actions; historical base-unit price normalization. These checks do not cover the entire POS or database.

CI configuration runs typechecking, linting, build and an integration command. The integration harness returns successfully without running scenarios unless `RUN_INTEGRATION_TESTS=true`. Merely having the workflow or a skip is not proof of a successful backend test. No ISO certification, numerical acceptance rating, performance rate, sample improvement, or security certification is invented.

## Academic information

Verified from manuscript title page:

- Official title: **Architecting a Lightweight Cloud-Based Inventory and Financial Management System: A Mixed-Methods Evaluation of Decision-Making Efficiency in Philippine SMEs**.
- Proponents: Evon Christian Pahugot Vergara, Justin Comendador, Xymmer James Nadera.
- Institution: Southwestern University – PHINMA.
- College: College of Information Technology and Engineering.
- Program: Bachelor of Science in Information Technology.
- Title page year: 2026.

Missing/confirm before presentation: adviser name, official academic-year range, final approved title wording and spelling of names. Cover fields `[Adviser name]` and `[Academic year]` intentionally remain editable placeholders. Do not infer an academic-year range from a single calendar year.

Objectives are concise paraphrases of Chapter 1’s general objective and three specific objectives. Adviser confirmation of the final condensed wording remains appropriate. The deck retains “Agile Scrum” from Chapter 3. Repository files do not prove sprint events, respondent-level findings or completed acceptance evaluation. Presenter assignments do not imply individual code authorship.

## Outstanding technical uncertainties and manual checks

1. Exact migration application order and current function definitions on the demonstration backend. Two migration families contain redefinitions, so filename presence alone is insufficient.
2. Live role/store isolation, privileged function grants, enrolled-factor assurance and account-management behavior.
3. Checkout concurrency, duplicate/retry behavior, refund/return stock restoration, lot allocation and report reconciliation using synthetic data.
4. Queue conflicts, failed replay recovery and the interaction of existing browser queues with a cleared backend. Pending-only replay does not automatically retry error entries.
5. Legacy option-stock configurations, rounding rules and existing datasets after the shared-base-stock migration.
6. Actual network, hosting, Edge Function and optional QZ Tray/hardware availability.
7. An approved reset plan, independently verified initial business state, and retained Admin login/membership. No reset readiness is asserted by the deck.
8. Acceptability and technical-validator results, and final institutional sign-off.

AI/ML forecasting, receipt OCR, a supplier portal, logistics/fleet workflows, general accounting and BIR filing are not presented as implemented. Rule-based conversion and replenishment do not constitute machine learning.

## Privacy and screenshot decisions

The revised deck uses the existing application icon and original institutional artwork extracted from the supplied PowerPoint. All presentation text, diagrams and the permission table are editable. Existing repository screenshots may contain business/user records and earlier UI states, so none were embedded. No authenticated application or backend was opened for screenshot capture. No fabricated screenshot or generated interface is used. No password, token, project credential, service-role key, private row, real customer data or production screenshot belongs in the deliverables.

## Institutional-template revision

The user requested the prior defense’s design and sequence, and approved about 17 main slides. The revised deck is **Kodigo_Pre_Defense_SWU_Refined.pptx**, with **17 main slides** and **14:00** target delivery time. Earlier 12-slide numbering is superseded for this version. The original source PowerPoint is unchanged.

### Template handling

- Inspected all 27 source slides and their masters, layouts, actual dimensions, colors, fonts, image relationships and available assets.
- Imported the source deck and retained 17 source slide objects in sequence. Retained the original theme, source master/layout structure, white canvas, blue headings, large PHINMA cover mark and four colored footer dots.
- The source’s actual size is 10 × 5.625 inches, or 960 × 540 CSS pixels. It remains 16:9. Final review renders are 1920 × 1080.
- Raleway headings, Cambria cover title and Arial content follow fonts encoded in the supplied deck and available on this host. The final font policy verifies them against the actual source file.
- SWU and PHINMA wordmarks are original source artwork. They were extracted from the source’s branded background assets, without redrawing or changing the logos. SWU appears only on the cover; PHINMA appears on the cover and in content headers. The repeated SWU footer logos were removed following user feedback.
- The old dense paragraphs, obsolete research title, two-role diagram, screenshots and proposal-era technical claims are not factual authority for the revision. Native shapes, connectors, text and tables replace the old content. The use-case section uses an editable role/use-case matrix for readability.
- Source file SHA-256: `e7456a215ce1b1989fc8bbd7e9c08a6ee65d15dc7f79866c748f0680cc8c10e3`.

### Flow mapping

| Prior defense sequence | Revised slides |
|---|---|
| Title and agenda | 1–2 |
| Background and case-based scenario | 3 |
| Statement of the problem and research goals | 4–5 |
| Review of related literature | 6 |
| Research methodology | 7 |
| Results and findings of RQ1 | 8 |
| IT solution | 9, updated to developed system |
| Conceptual framework and use cases | 10–11, updated for four roles |
| Technical implementation | 12–14, architecture, database and core logic |
| Development platform | 15, hardware/software/frontend/backend/deployment |
| Evaluation and readiness | 16, local evidence and limitations |
| System walkthrough | 17 |

### Research content updated from the manuscript

Slide 6 condenses literature themes and author-year references already present in Chapter 2. These are manuscript-level attributions, not newly sourced papers or claims that the literature evaluated Kodigo. Bibliographic details should receive the same adviser review as the manuscript.

Slide 7 uses the current exploratory sequential mixed-method framework. It distinguishes RQ1 mixed methods, RQ2 quantitative technical validation, RQ3 quantitative acceptability, criterion-based purposive sampling with maximum variation, and Agile Scrum for software development.

Slide 8 reproduces four manuscript-reported baseline indicators from Table 4.1:

| Indicator | Count | Manuscript percent |
|---|---|---|
| Inventory update takes 16 minutes or more | 13 / 18 | 72.2% |
| At least three discrepancies in the preceding 30 days | 12 / 18 | 66.7% |
| Uncertain information delays decisions at least sometimes | 16 / 18 | 88.9% |
| Sources mismatch at least sometimes | 18 / 18 | 100.0% |

The counts reproduce the displayed percentages to one decimal place. They describe this sample’s baseline, not national prevalence, successful system tests, acceptance ratings or measured post-implementation improvement. Five interview transcripts support the qualitative synthesis according to Chapter 4. The planned technical-validator count is not presented as completed evaluation. Raw survey/interview data were not independently re-analyzed for this revision.

## Presentation quality assurance

- 17 slides and 17 embedded editable note parts. Presenter 1: slides 1–8. Presenter 2: slides 9–14. Presenter 3: slides 15–17. Target total: 14:00.
- Final OOXML package and layout checks pass with zero findings and zero warnings. The exported file successfully reimports through Artifact Tool with 17 slides. Microsoft PowerPoint itself was not launched.
- Every slide rendered at 1920 × 1080 for individual visual review. Source/template comparison covered branding, dimensions, fonts, layout, sequence and recurring footer elements. Diagram fit, logo crops, connector layering and footer spacing were repaired during review.
- Native evidence includes the baseline-results table on slide 8, role/use-case matrix on slide 11, and editable diagrams on slides 3, 10, 12, 13 and 14. Content slides are not flattened images.
- Speaker notes include conversational scripts, presenter transitions, time targets and repository/manuscript references. No personal implementation contributions are invented.
- Adviser and academic year remain intentional placeholders. Live readiness remains unverified. No database reset or source-code modification was performed.
- Sensitive-value scanning and final artifact checks are recorded in the private QA report. The original old deck’s screenshot, scenario photographs and outdated charts are excluded from the revised slides.
- Final deck SHA-256: `fe7b34d27dc1b7165b632d70fc5a66016c959c0c8252fa52a070b81492bceff7`. Private validation evidence: `outputs/pre-defense-swu-build/validation-v5.json`, `qa-v5.json` and `renders-v5/slide-01.png` through `slide-17.png`.

Current supporting files are the updated outline, speaker notes, demonstration checklist and this report. The previous dark 12-slide deck is a prior version. Use the SWU Refined deck for the revised defense sequence.
