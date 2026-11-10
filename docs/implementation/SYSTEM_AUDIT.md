# Kodigo enhancement system audit

Audit date: 2026-11-10 (Asia/Manila). Repository HEAD: `ef2d963b681b371a7bbd103dd1b5b2a72b3f26e3`. Scope: source inspection and safe local checks; **no application implementation, database connection, database mutation, or deployed-system certification**. Existing unrelated working-tree changes were preserved. No `AGENTS.md` was found in the repository search. The user's attached enhancement request is the requirements source.

## Evidence and confidence

“Implemented” below means a concrete source path exists with the described behavior. It does not mean a live deployment or hardware was tested. Repository SQL describes multiple successive definitions; actual applied definitions remain unverified. This distinction is a release gate, not a reason to redesign working components.

## Architecture

| Area | Confirmed implementation |
| --- | --- |
| App | `kodigo-ui/package.json`: React 19.2, TypeScript 5.9, Vite 7.3; React Router 7; Zustand 5; Supabase JS 2.100; `idb` 8. No application ORM or separate HTTP application server found. |
| UI | Tailwind 4, Radix primitives, Lucide; shared components under `kodigo-ui/src/components/shared/` and `components/ui/`; semantic light/dark tokens in `src/index.css`. |
| Backend | Supabase Postgres functions called through `.rpc()`, direct Data API reads governed by RLS, Supabase Auth/Storage; Deno functions `supabase/functions/admin-users/index.ts` and `generate-invite/index.ts`. |
| Entry/routes | `kodigo-ui/src/main.tsx`, `App.tsx`; back-office `AppShell`, separate POS shell in `pages/POSPage.tsx`. |
| State | `stores/authStore.ts`, `productStore.ts`, `supplierStore.ts`, `cartStore.ts`, `alertStore.ts`; TanStack Query installed, not a reason to replace these stores. |
| Reporting | `lib/reporting.ts`, `reporting-calculations.ts`, `consignment.ts`, `consignment-calculations.ts`, `sales-velocity.ts`; Recharts, jsPDF, Excel export. |
| Hosting | `kodigo-ui/vercel.json`: SPA rewrite; Vercel intended, actual hosted configuration unverified. |
| Background work | Browser `online`/focus/visibility replay and 30-second alert polling in `App.tsx`; no maintained server queue worker, pg_cron, pgmq, or Realtime subscription found. |
| Printing | Browser iframe, PDF, **Windows .NET native ESC/POS agent**, and drawer integration. README's Web Serial-only description is outdated. |

The root `package.json` is not the app manifest. `script.js`, diagnostic `test-*.mjs` files, deliverables and old audit prose are not authoritative runtime paths. Do not run diagnostic scripts containing embedded credentials. Never copy secrets into these documents.

## Schema and migration provenance

Baseline `supabase_schema.sql` contains profiles, products, categories, suppliers, sales/items, stock adjustments/alerts, purchase orders/items and settings. Root migrations 01–40 (33 absent) extend multi-store/RBAC, sales lifecycle, selling units, snapshots, reporting, notifications, shared suppliers and base-unit purchasing. `supabase/migrations/` adds MFA, lots/consignment, VAT, item discounts, refund repair, security and precision/barcode patches through `20261107024448_deny_direct_barcode_registry_access.sql`.

**There is no proven single replay order.** Root and dated migrations replace overlapping functions. README's instruction to apply most dated migrations before root 29 conflicts with November patches that require root 37 functions. `supabase/config.toml` exists but contains email templates only; it is not a reproducible full local bootstrap. `supabase/drafts/` content is not evidence of an applied schema. Task T00 must capture function/trigger/policy/grant fingerprints and construct a validated disposable bootstrap; do not replay the baseline on populated data.

Relevant current entities:

| Entities | Relationships / constraints to preserve |
| --- | --- |
| `profiles`, `stores`, `store_users` | Profiles have admin/cashier/inventory/super_admin role; store membership and owner scope determine tenancy. |
| `products`, `product_selling_options`, `product_restocking_options`, `product_suppliers` | Products belong to stores; unit/bulk options share a base stock pool. They are packaging/pricing options, not independent variants. Product stock and sale quantities are currently integers. |
| `sales`, `sale_items` | UUID sale; line FK; completed/voided/partially_refunded/refunded statuses; immutable money/unit/cost/customer snapshots; `sales.closeout_id`. |
| `sale_payments`, `sale_events`, `receipts` | Payment rows belong to sale/store; captured positive, refunded negative; old void mutates capture status. Receipt number unique; immutable receipt payload. |
| `sale_returns`, `sale_return_items` | Return parent sale, line references original item; integer positive quantity; boolean `restocked`; current return creates refund automatically. |
| `stock_adjustments`, `inventory_movements` | Adjustments cover manual/receiving changes; movement ledger also covers sales. Delta and before/after columns already exist. |
| `inventory_stock_lots`, `sale_item_stock_allocations` | FIFO ownership/cost lots; allocations link immutable line to lots with allocation order, historical cost, consignment supplier and bounded returned quantity. Read-only deployed inspection later confirmed lot/allocation `unit_cost numeric(14,6)`; legacy `sale_items.cost_per_base_unit` is `numeric(12,4)` and `cost_price` is unconstrained `numeric` (see SCHEMA_BASELINE). |
| `consignment_supplier_payments`, `consignment_supplier_balances` | Supplier obligation accrues on goods **received**, not only goods sold. Preserve this rule. |
| `restock_history`, `product_price_history` | Receiving-unit and package-price snapshots, cost changes and explicit pricing history. |
| `cashier_closeouts` | Cashier/store/time window and totals; status closed/reopened; no real shift or drawer entity. |
| `audit_logs`, `error_logs`, notifications/preferences | Existing operational audit/error and role-scoped notification infrastructure; stock history must not be reconstructed from generic audit text. |

No customers/customer ID, wallet/service/provider ledger, actual supervisor role, serial number, batch expiry, or sub-store inventory location model was found. FIFO receipt lots already exist and must be reused.

## Exact sale and stock paths

1. `components/pos/PaymentModal.tsx` (`handleConfirm`, approximately lines 111–201) builds a UUID sale, identity, cart and payment values.
2. `lib/offline-sync.ts::processSale` → `pushSaleToSupabase` → `public.process_pos_sale_v4`.
3. Latest complete v4 source: `supabase/migrations/20261021055145_fix_pos_item_discount_snapshots.sql:3`. It checks authenticated cashier, role/store/MFA membership, duplicate cart options, archive state, prices, per-item discounts, combined base quantities, VAT-inclusive tax and tender/change. It serializes the sale UUID with an advisory transaction lock and locks product IDs in order.
4. The RPC writes `sales`, immutable `sale_items`, positive `sale_payments`, immutable receipt, `sale_events`, audit atomically. Existing same-ID replay returns its result, but **does not compare the new payload**.
5. `sale_items` BEFORE INSERT `zzz_set_sale_item_purchase_cost_trigger` (`migration_37_unit_aware_inventory_workflow.sql:289`) snapshots base-unit quantities/costs. `zzzz_allocate_sale_item_stock_lots_trigger` (`20260930130000_consignment_inventory_lots.sql:174`) consumes FIFO lots and snapshots actual costs/ownership. Trigger ordering must be fingerprinted.
6. AFTER INSERT `deduct_stock_on_sale_trigger` (installed in root 18; latest body `migration_34_bulk_purchase_base_units.sql:277`) updates `products.current_stock`, syncs derived option stock and inserts `inventory_movements` type `sale`.
7. `stores/productStore.ts::adjustStock` calls `adjust_inventory_stock` (root 34:425) for manual changes or `receive_product_stock` (`20261019130000_client_revision_fixes.sql:15`) for receiving. Receiving delegates to `restock_product_inventory_v2` (root 37:355).
8. An adjustment INSERT invokes `trg_log_stock_adjustment_movement` (root 20:190) and `private.sync_stock_lots_from_adjustment` (`20261019120000_pos_reporting_and_consignment_revisions.sql:15`). Stock/lot behavior currently depends on note prefixes. Replace that routing with structured provenance incrementally.
9. `void_pos_sale` (root 34:548) restores base stock and writes adjustments; subsequent sale status trigger `restore_sale_stock_lots_after_void_trigger` (`20261019120000...:93`) restores original allocations. Two coordinated trigger paths are involved: do not add a third restoration.
10. `return_sale_items` (root 34:687) optionally restores base stock; return-item trigger `private.restore_sale_item_stock_lots` (`20260930130000...:243`) restores source lots. `quantity_returned` currently means restored allocation quantity, not all physically returned goods.
11. Product creation writes initial stock directly; `private.create_opening_stock_lot` supplies lots, but no complete explicit opening movement was found. Baseline backfill must not fabricate historical activity.
12. `receive_purchase_order` (root 31:4) changes PO status **without stock receipt**. Preserve this separation.

Historic `process_pos_sale`, v2 and v3 signatures remain in SQL/grants. All must delegate to the same new rules or be revoked after compatible rollout; guarding only v5 would leave bypasses.

## Enhancement status

| Requirement | Classification | Evidence / work needed |
| --- | --- | --- |
| Supervisor-approved void | Partially implemented | Full admin void exists with stock/lot recovery and audit. No request, independent approval, mandatory nonblank reason or external reversal confirmation. |
| Expanded offline POS | Exists but requires refactoring | IndexedDB queue/cache and replay exist. Missing status truth, safe retries, ownership, durable acknowledgements, stock allocations and recovery. |
| Opening balances and drawer movements | Partially implemented | Closeout accepts opening amount at close. No drawer/shift opening, physical cash ledger or manual movements. |
| Admin closeout review | Missing entirely | Existing closeout record/RLS reusable; no review queue, comments, approval/frozen detailed snapshot or amendment process. |
| Thermal shopping lists | Partially implemented | `RestockingPage.tsx::handleCreateShoppingList` around line 243 downloads selected items/receiving quantities/prices as text. Thermal preview/58–80 mm printing absent. |
| Customer history/ranking | Missing entirely | Optional customer name/TIN/address snapshots only. `RankingsPage.tsx` is product rankings. |
| Digital catalog/e-load/GCash services | Missing entirely | GCash is an existing **payment method** only. No service/wallet/provider accounting or provider integration. |
| Central inventory ledger | Exists but requires refactoring | `inventory_movements` already has most basic fields; missing typed operation links, locations, idempotency, append-only enforcement and complete readable UI. |
| Partial returns | Partially implemented | Sale/item locks and over-return checks exist; boolean restock, automatic refund, current-status coupling need separation. |
| Financial-only refund | Already implemented in source | Latest `20261021100000_fix_refund_pos_sale_refund_total.sql:2`; no stock recovery, admin/store/amount guards. Needs idempotency, settlement and closed-shift integration. |

## Existing lifecycle and reporting defects to characterize

- `lib/transactions.ts` wraps void/refund/return/closeout RPCs; `components/pos/TransactionLifecyclePanel.tsx` limits lifecycle buttons to admin. No requester/approver distinction. Void reason defaults to “No reason provided.”
- Returns automatically insert a negative payment and can run after closeout; refund RPC rejects closed-out sales. A fully refunded status can prevent later physical returns even when quantities remain outstanding.
- `close_cashier_shift` (root 19:968) derives a cashier/time window, uses inclusive boundaries, payment creator and current sale status, then writes totals. No concurrency lock, drawer ID, real opening event, administrator review or late adjustment model.
- `lib/reporting.ts::fetchSalesReport` around 628 fans out sales/lines/payments/returns/allocations and aggregates in browser (`buildSalesReport` around 1029); it paginates transport in batches but materializes all selected history. New history screens require keyset queries and backend aggregation.
- **Double-discount risk confirmed for latest v4:** v4 persists item-discounted `unit_price/line_total`; `reporting.ts` around 1103–1111 and 1198–1203 subtracts `sales.discount` again for line/product profit/revenue. Summary net-sales uses sale total and may disagree. Historical line formats differ; introduce explicit financial-version characterization before correction.
- `reporting-calculations.ts::allocateSaleLineAmountPaid` has useful deterministic cent allocation; do not assume its inputs represent gross lines for all historical versions.
- SQL `v_product_rankings` and `v_sales_by_selling_option` in root 34 exclude voids but do not completely handle returns/refunds. Audit every consumer when adding financial facts.
- `get_inventory_consumption_history` (root 40:8) filters existing movement category strings. Category normalization must update this consumer and sales velocity intentionally.
- Inventory UI `StockAdjustmentLog.tsx` is searchable and has before/after/direction indicators, but receives latest 250 adjustments, hides some PO-prefixed entries and omits sale movement history, actor names and typed reference links. Extend this UI over `inventory_movements`.

## Offline, permissions and printing

`offline-sync.ts` opens IDB v1 (`products_cache`, `sales_queue`, `generic_mutations`). Cache replacement is global. The source baseline returned a locally queued sale as an ordinary sale, and `PaymentModal` displayed completion. The v4 sale RPC in `20261021055145_fix_pos_item_discount_snapshots.sql` serializes by sale ID and returns an existing row for the same sale/store/actor, but does not compare a retry payload. The current T50/T55 safety increment blocks disconnected sale completion, keeps the payment/cart open after an uncertain response and retries the same frozen sale payload/ID, and leaves legacy sale rows untouched instead of replaying them automatically. The new v2 encrypted outbox is still not connected to POS checkout; legacy v1 queue data remains plaintext on-device and requires a later, audited recovery path. Generic mutation queues and their replay behavior remain unchanged. No service worker or offline cold launch guarantee exists.

Auth roles are `admin`, `cashier`, `inventory`, `super_admin` (`types/index.ts:37`). `authStore.ts` uses profiles/server app metadata; `App.tsx` guards routes; `MfaGate`/`lib/mfa.ts` and `20260803023252_enforce_mfa_assurance.sql` enforce MFA. Preserve MFA-aware `user_belongs_to_store` and null-safe checks. `super_admin` operates invite issuance, not store approvals. `admin-users` restricts staff management to caller stores; do not repurpose it as a store transaction engine.

Receipts: `lib/receipts.ts::printReceipt` → `hardware.ts::printThermalReceipt` → agent `Program.cs:/v1/receipts/print`; standard layout → `receipt-print.ts::printReceiptHtml`; PDF remains available. `print-agent/ReceiptFormatter.cs` uses 32 columns/58 mm, separate origin/pairing and RAW Windows spool transport. Durable attempted-sale dedupe is bounded and claims before spool: an acknowledgement is **not proof of physical output**. A shopping list needs its own typed document ID/endpoint/formatter, never a fake sale/receipt.

## Verification actually performed

- `npm run test:unit` in `kodigo-ui`: **42 passed, 0 failed** on 2026-11-10; Node v24.11.0, npm 11.6.1. Existing tests do not prove the proposed features.
- `npm run lint`: **passed**, exit 0.
- Planning-package validation: **passed** for all71 Markdown files,61 task specifications, required task sections, local document links, existing/proposed source paths and an acyclic61-task dependency graph. This validates documentation structure, not feature correctness.
- Application build/typecheck, .NET printer tests, database/SQL/integration, authorization, concurrency, browser E2E and physical hardware tests: **not run** during this planning audit.
- CI `.github/workflows/ci.yml` uses Node 22, npm ci, typecheck/lint/build/unit and opt-in integration. Existing integration harness calls v3, creates/deletes users/data, and must run only on an isolated project. SQL tests also write synthetic data even where rolled back.
- No maintained browser E2E config found despite Playwright being installed. No CI SQL or .NET job found.

## Explicit unresolved facts / business decisions

See [HANDOFF.md](HANDOFF.md#decision-register) for owners, safe defaults and blocked tasks. In particular: deployed schema/Postgres/CLI and migration history; partial-void policy; offline escrow acceptance and device protection; provider/account availability; digital tax treatment; approval thresholds; customer retention and owner-wide identity; inter-store physical return/transfer mapping; paper/printer capabilities. Do not invent live balances, provider APIs, statutory tax treatment or historical cash evidence.
