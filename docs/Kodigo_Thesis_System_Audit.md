# Kodigo Thesis System Audit

**Audit date:** 2026-09-21  
**System baseline:** `kodigo-ui/` React/Vite application, active Supabase migration chain through migration 38 plus the timestamped MFA-assurance migrations, and the current Chapter 1–4 manuscript.  
**Purpose:** reconcile the thesis with the implemented Kodigo system without changing the research questions, research intent, or cited literature.

## 1. Scope and evidence

The audit covered the application routes, stores, components, server-side RPC and Edge Function call sites, database schema and migration history, and the manuscript’s Chapters 1–4. It included authentication, role enforcement, multi-store behavior, POS, inventory, unit and bulk handling, suppliers, purchase orders, reporting, analytics, notifications, settings, offline queueing, receipts, and security controls.

Evidence used:

- Current source under `kodigo-ui/src/`, including route guards, authentication, MFA, POS, inventory, restocking, reports, analytics, rankings, receipts, and offline synchronization.
- Root SQL migrations `migration_01_invite_codes.sql` through `migration_38_product_archiving.sql`, the timestamped Supabase migrations, and `supabase/functions/`.
- `README.md` and the source-of-truth ordering documented there: latest migrations, runtime code, architecture guide, README, then baseline schema.
- A local owner-role UI inspection using the supplied inspection account. No credentials, tokens, or account secrets are included in this audit or manuscript.
- Static validation: TypeScript typecheck, ESLint, and Vite production build completed successfully. The production build reports a non-blocking large-chunk warning.
- Existing clean UI captures in `deliverables/live_kodigo_screens/`. These are used only where they improve a manuscript figure; figures without a clean current replacement remain unchanged.

This audit does **not** claim that the production Supabase project was migrated or that end-to-end/RLS integration tests were run. Those actions could create or mutate external data and require deployment evidence or explicit test authorization.

## 2. Implementation status matrix

| Area | Status | Evidence-based finding | Thesis treatment |
|---|---|---|---|
| Authentication | Implemented | Supabase email/password authentication, invite-based owner registration, password reset, session handling, and protected routes are implemented. | Describe as implemented authentication; do not imply anonymous or passwordless access. |
| Roles and MFA | Implemented | The application recognizes `super_admin`, `admin`, `cashier`, and `inventory`. TOTP MFA and AAL2 checks protect enrolled accounts and privileged operations. RLS and server functions remain the authorization boundary. | Add the Inventory role and MFA/RLS controls to the architecture, use cases, and security discussion. |
| Multi-store operations | Implemented | Store membership, assigned-store selection, and owner/admin store scoping are implemented. Admin reporting can aggregate assigned stores where supported. | Retain the multi-store scope, but state that access is assignment- and policy-scoped. |
| POS | Implemented | Name/SKU/barcode search, cart processing, configured selling options, base-unit stock deduction, cash/GCash/card/bank-transfer payment methods, discounts, receipts, void/refund lifecycle, and optional cash-drawer opening are implemented. | Replace generic POS wording with the implemented payment, unit, receipt, and transaction controls. |
| Inventory | Implemented | Stock is maintained in base units. Products support active/archive state, stock adjustments, minimum/safety/reorder thresholds, selling options, low/critical/out-of-stock alerts, and velocity views. | Explain base stock, quantity on hand (QOH), selling options, and archiving. |
| Unit, pack, case, and bulk handling | Implemented with bounded configuration | Restocking units can be configured as pack/box/case/tray or another configured unit and converted to base units. Selling options share base stock. Bulk discounts support percentage or fixed-amount rules. | State that the system supports configured conversions and options; do not imply arbitrary automatic package inference. |
| Suppliers and purchasing | Implemented internally | Suppliers can be shared across assigned stores, linked to multiple products, scored, and used in purchase-order creation and receiving. Receiving converts to base units and records cost/suggested price. | Clarify that supplier records and deliveries are entered by authorized staff; there is no external supplier portal or supplier-system integration. |
| Pricing and historical records | Implemented | Restocking can calculate converted unit cost, margin, and suggested selling price. Live selling prices are not silently changed. Price history and sale-item/receipt snapshots preserve historical values. | Add the distinction between a suggested price and an approved live price, plus historical snapshots. |
| Sales, financial data, and reports | Implemented | Sales support tax, discounts, payment details, COGS, gross profit, margin, completed/voided/refunded/partially-refunded states, receipts, audit/event records, sales reports, inventory reports, stock movement, restock history, and price history. | Use “derived from recorded transactions” for accuracy claims; do not claim certified accounting or BIR filing. |
| Exports | Implemented | Admin sales/report workbooks export to XLSX and inventory-oriented reports can export to CSV. Export activity can generate an in-app notification. | Add XLSX/CSV export as an implemented reporting capability. |
| Dashboard and analytics | Implemented | Dashboard metrics include today’s net revenue, transactions, average order value, gross profit, stock alerts, a seven-day trend, recent transactions, and seven-day best sellers ranked by revenue. Analytics includes period, payment, and status filters plus revenue, hourly, category, selling-option, and transaction views. | Correct “top products by stock” to “best-selling products by recent net revenue” and distinguish descriptive analytics from forecasting. |
| Rankings and velocity | Implemented | Rankings support today/week/month/custom periods and show revenue, base units, gross sales, discounts/returns, and profit. Sales velocity reports base units sold, per-day/week rates, QOH, days of stock, and restock classifications over 7/30/90-day windows. | Add rankings and velocity as implemented descriptive decision-support features. |
| Notifications | Implemented | The system records stock, sale, error, daily-summary, milestone, and report-export notifications with user preference/state handling. | Expand the notification description beyond low-stock alerts. |
| Offline operation | Partial / bounded implementation | IndexedDB caches products and queues POS/generic mutations for replay when connectivity returns. The product is online-first; comprehensive offline reporting, supplier synchronization, and automatic conflict resolution are not established. | Replace the absolute “real-time only” statement with “online-first with bounded offline queueing”; retain conflict resolution as a limitation. |
| Receipts and hardware | Implemented / optional | Store branding and BIR-oriented receipt fields, thermal/A4/browser printing, PDF download, receipt snapshots/reprints, and optional Web Serial cash-drawer support are implemented. | Do not convert BIR-oriented fields into a claim of BIR certification or electronic filing. |
| Predictive AI and external operations | Not implemented / out of scope | No AI/ML forecasting, predictive demand model, external supplier portal, logistics/fleet module, raw-material procurement workflow, or full accounting integration was found. | Keep these as explicit exclusions and do not describe descriptive analytics as AI. |

## 3. Manuscript discrepancies and corrections

| Manuscript area | Discrepancy | Required correction |
|---|---|---|
| Chapters 1 and 3 proposal language | The manuscript frequently describes the system as only “proposed,” although the draft now documents a working prototype/application. | Preserve the proposal and research context where it describes the study, but use “developed Kodigo system” or “implemented prototype” when describing current behavior. |
| Scope and role descriptions | Several passages list only Super Admin, Admin, and Cashier. | Add Inventory as a distinct role. Super Admin manages invite-code governance; Admin manages assigned-store operations; Cashier is limited to POS; Inventory manages products, stock, and inventory-oriented reporting. |
| Scope and limitations | The manuscript says advanced analytics are excluded and describes synchronization as strictly dependent on a stable connection. | Distinguish implemented descriptive analytics, rankings, and sales velocity from excluded AI/predictive forecasting. Describe the product as online-first with bounded IndexedDB caching and mutation queueing; retain robust offline conflict resolution as a limitation. |
| Technology stack | Some text uses “a cloud provider such as Firebase or AWS.” | Name the implemented stack: React, TypeScript, Vite, Tailwind CSS, Zustand, Supabase Auth/PostgreSQL/RLS/Storage/Edge Functions, IndexedDB, jsPDF, write-excel-file, and Vercel SPA hosting configuration. |
| Definitions of terms | Generic definitions omit Supabase, PostgreSQL, RLS, MFA, base unit, restocking unit, selling option, QOH, sales velocity, and historical snapshots. | Add implementation-specific definitions and use one vocabulary throughout Chapters 1–4. |
| Conceptual framework and diagrams | The role model and data-flow descriptions omit Inventory; the context description treats Supplier as an external system/actor. | Add Inventory to the role model and diagrams. Treat Supplier as an internally recorded business entity; authorized staff record supplier, purchase-order, and delivery information. No supplier portal is implemented. |
| User management and invitations | The user-management passages describe only Cashiers. | State that Admin can manage assigned-store Admin, Cashier, and Inventory users through the protected management function, subject to authorization and MFA assurance. |
| Security settings | The security figure/text focuses on password management only. | Include password management and TOTP MFA/AAL2. Keep RLS and server-side functions as the system’s security boundary. |
| Dashboard | The manuscript says the dashboard shows top products by stock. | Correct this to seven-day best sellers ranked by recent net revenue, alongside today’s revenue, transactions, AOV, profit, stock alerts, trend, and recent transactions. |
| Inventory and product setup | The manuscript describes generic stock fields but not the implemented shared-base-stock model. | Explain base-unit QOH, configured restocking conversions, package/bulk selling options, fixed or percentage bulk discounts, margin-assisted pricing, rounding, stock adjustment logs, velocity, and archival. |
| Restocking and supplier workflow | The manuscript does not clearly separate receiving cost changes from live selling-price changes. | State that receiving converts delivery units to base units, records cost/history, and calculates a suggested price; the live selling price changes only after an authorized approval/action. |
| POS | The manuscript does not fully describe payment methods, configured units, discounts, server validation, snapshots, and offline queueing. | Add these as implemented behavior while preserving the thesis’s workflow narrative. |
| Analytics, rankings, and reporting | Existing text is too generic and can be read as forecasting. | Describe period/payment/status filters, net sales, AOV, COGS/gross profit/margin, category/hour/selling-option breakdowns, rankings, velocity, inventory reports, and XLSX/CSV export. Explicitly exclude AI prediction. |
| Chapter 4 claims | Findings and research analysis should not be rewritten as implementation evidence. | Preserve the research findings and citations. Narrow only implementation-dependent wording, especially absolute “real-time” or “accurate financial report” claims, to “derived from recorded transactions” or “supports connected synchronization.” |

## 4. Figure and screenshot audit

The manuscript’s original screenshot series is generally readable but predates the current owner-role interface. The following figures are refreshed from clean current captures, cropped to the manuscript’s existing wide layout:

- Figure 3.7: Login.
- Figure 3.12: Security settings, including MFA controls.
- Figure 3.13: Dashboard.
- Figure 3.14: Inventory.
- Figure 3.16: Suppliers.
- Figure 3.19: POS.

The refreshed captures show application UI only. No password, token, or secret is placed in the thesis. The remaining screenshots are retained where a clean current replacement was not available or where the existing figure still accurately communicates the workflow.

The UML/context/DFD figures are also revised to match the four-role model and the internal supplier-record workflow. Captions retain the existing figure numbering so in-text references remain stable.

## 5. Standardized terminology

The revised manuscript uses the following terms consistently:

- **Kodigo system (KodiGo application):** first-use clarification; “Kodigo system” is used thereafter in the thesis.
- **Super Admin, Admin, Cashier, Inventory:** human-facing role names; database role values remain `super_admin`, `admin`, `cashier`, and `inventory` where code identifiers are shown.
- **Base unit:** the canonical stock unit used for QOH and stock deduction.
- **Restocking unit:** a package format received from a supplier, converted to base units by a configured factor.
- **Selling option:** a configured way to sell the same base stock, including unit or bulk/package options.
- **Quantity on hand (QOH):** current available base-unit stock.
- **Sales velocity:** descriptive rate of completed net base units sold over a selected period.
- **Historical snapshot:** sale, receipt, cost, or price values stored at transaction time so later edits do not rewrite history.
- **Online-first with bounded offline queueing:** the supported connectivity model; queued operations replay when connectivity returns, but comprehensive offline conflict resolution is outside scope.

## 6. Explicit non-claims and unresolved verification items

The revised thesis should not claim:

- AI/ML demand forecasting or predictive replenishment.
- A supplier-facing portal, external supplier integration, logistics/fleet management, or raw-material procurement.
- BIR certification, electronic tax filing, or replacement of a full accounting system.
- Comprehensive offline reporting or automatic conflict resolution.
- Production migration completion or successful end-to-end RLS tests unless deployment/test evidence is supplied.

The following items remain deployment or institution-level confirmations rather than source-code findings:

1. Whether the latest migration chain has been applied to the production Supabase project in the stated order.
2. Whether the institution wants “offline queueing” presented as an accepted capability or as a prototype limitation in the final defense copy.
3. Whether the final thesis should use “Kodigo” or the application’s branded “KodiGo” beyond the first-use clarification.
4. Final page numbering and table-of-contents refresh after the edited DOCX is opened in the institution’s preferred Word/LibreOffice environment.
5. Full production RLS, MFA-assurance, and transaction-lifecycle integration verification using a non-production test dataset.

## 7. Validation record

The source baseline passed TypeScript typechecking, ESLint, and the Vite production build on 2026-09-21. The build emitted a non-blocking large-chunk warning. The edited DOCX passed OOXML/ZIP integrity validation, retained all 35 body image relationships plus the header media, and was checked for the corrected/removed claims listed above. Page-level PDF rasterization could not be completed on this host because the bundled document renderer requires LibreOffice and neither LibreOffice nor Word is installed; the final institutional Word/LibreOffice opening should therefore include a visual pagination check. No production data was created, edited, deleted, or exported during the audit.
