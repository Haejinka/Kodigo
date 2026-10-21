# Kodigo demonstration checklist

Current deck: **Kodigo_Pre_Defense_SWU_Refined.pptx**, 17 slides. The live sequence follows slide 17.

This is a proposed preparation and validation plan. No database reset, authentication change, configuration change, or live transaction was executed for the presentation task. The slides do not establish deployment readiness.

## Preparation by the authorized operator

- [ ] Confirm the demonstration project, store, branch, deployment, and permitted dataset with the adviser and panel. Prefer a dedicated test environment with synthetic records.
- [ ] Have the database owner review the complete current schema and dependency graph before clearing any business records. Preserve recoverable backups or exports under the owner’s normal data policy. This document deliberately contains no reset SQL.
- [ ] Define “cleared” explicitly: products, selling/restocking options, supplier links, stock, stock lots, consignment payments, orders, sale items, sales, payments, refunds/returns, receipts, reprints, stock adjustments/movements, receiving/price history, business notifications and exports may be related. Check historical snapshots and storage objects separately. Deleting only visible products or sales does not establish an empty business dataset.
- [ ] Preserve required schema, constraints, functions, triggers, policies, grants, infrastructure, Auth accounts, profiles, store membership and required store configuration. Confirm with the panel whether categories and supplier master records count as business data that must be empty.
- [ ] Retain a working **Admin** account and its required store membership. The current Super Admin route only provides invite-code governance and cannot perform normal store setup. Do not assume that keeping only a Super Admin account is sufficient. The access-change draft is not an applied solution.
- [ ] Reconcile existing browser queues before any backend clearing. Identify the dedicated demo browser profile and inspect `kodigo-pos-db` queues and cached catalog. Old queued writes could repopulate cleared records after reconnect. Preserve unresolved work for reconciliation before an authorized operator clears browser state. A fresh browser profile avoids inherited demo queues, but does not resolve old pending work elsewhere.
- [ ] Have an authorized operator perform the separately approved clearing procedure and verify empty business records independently. Do not use a production database to rehearse destructive steps.
- [ ] Verify required migrations, Edge Functions, RLS policies, and MFA assurance are deployed. Root migrations and dated migrations both redefine functions, so the baseline SQL file alone is insufficient. Exclude `supabase/drafts/` proposals from deployment assumptions.
- [ ] Confirm login, password recovery path, enrolled TOTP access if applicable, active store, role, timezone and date filters. Keep passwords, recovery codes and tokens off the projector.
- [ ] Use desktop access for the Admin POS demonstration. Inventory and Super Admin cannot enter the current POS route. Prepare a Cashier login only if a role comparison is part of the approved demo.
- [ ] Rehearse online in the approved environment. Check network, display scaling, browser zoom and report export destination. Keep the PowerPoint and checklist available locally.
- [ ] Keep receipt printing optional. The repository supports browser/PDF receipts and an optional QZ Tray printer bridge. Confirm actual device/bridge availability before demonstrating hardware.

## Illustrative synthetic fixture

These values are expected arithmetic for a planned test, not observed results. Create no real customer information.

| Field | Planned value |
|---|---|
| Product | Demo Item A |
| SKU | DEMO-001 |
| Base unit | piece |
| Opening stock | 0 pieces |
| Receiving option | case, 12 pieces per case |
| Receipt | 2 cases, 24 pieces total |
| Unit selling price | PHP 10.00 per piece |
| Bulk selling option | pack, 6 pieces, bulk enabled, PHP 60.00 per pack |
| Sale | 2 packs, 12 base pieces |
| Discounts | None |
| Store tax fixture | Non-VAT / zero configured tax, if approved for the test |
| Cash tendered | PHP 150.00 |
| Expected sale total / change | PHP 120.00 / PHP 30.00 |
| Expected remaining stock | 12 pieces |

If existing store tax settings, bulk discounts, price rules, or payment methods differ, prepare the matching expected arithmetic in advance. Do not change real store tax configuration just to match this example.

## Live sequence and evidence to collect

1. **Login and scope.** Show the correct role and assigned store without exposing credentials. Demonstrate the starting business state after authorized preparation. Empty report views alone do not prove every dependent table is empty.
2. **Initial product setup.** Create the synthetic product with zero opening stock. Configure the base unit, receiving option, price and bulk option. Save, refresh and confirm that the stored product appears. Admin performs this setup for the main sequence.
3. **Receive inventory.** Record 2 cases of 12 pieces each. Expect 24 base units. Compare quantity, conversion, receiving history, movement history and ownership. Use store-owned stock for the core sequence. If a supplier is required by the chosen path, create an approved synthetic supplier first.
4. **POS checkout.** Select the correct store and add 2 packs of 6. Expect 12 base units and PHP 120.00 under the fixture above. Confirm the payment once. Record the sale/receipt identifier without personal data.
5. **Persistence and deduction.** Refresh the application and inspect authorized records. Expect one sale with its lines and payment/receipt records, 12 remaining pieces, and stock movement linking the reduction to the sale. A locally queued success screen does not count as authoritative persistence evidence.
6. **Reports.** Use the same store and a date range containing the sale. Confirm quantities are expressed in the correct selling/base units and net recorded sales match the fixture. Refresh report queries after the transaction. Export an inventory or sales report only if useful to the panel.
7. **Optional role comparison.** Log into a dedicated test Cashier or Inventory account. Compare permitted routes and operations. A hidden control is only interface evidence. Backend authorization requires direct negative tests in the separate approved integration environment.

## Required scenarios before claiming readiness

| Scenario | Expected behavior from implementation | Status for this package |
|---|---|---|
| Valid online sale | SQL validates caller, store, stock, server prices and totals, then persists associated changes atomically | Source verified, live result pending |
| Bulk conversion | Quantity × configured multiplier consumes base stock | Source verified, live result pending |
| Receiving conversion | Receiving quantity × configured factor increases stock and records history | Source verified, live result pending |
| Price review | Receiving can suggest a price, an authorized action applies a live price change | Source verified, live result pending |
| Insufficient combined stock | Reject a sale that exceeds remaining base units, including multiple modes for one product | Live negative test pending |
| Tampered price/totals or line discounts | Reject inconsistent submitted amounts in the transaction path | Live negative test pending |
| Invalid or cross-store access | Role/store restrictions deny unauthorized operations | Live RLS/Edge Function tests pending |
| MFA assurance | An enrolled verified factor requires appropriate AAL2 assurance for protected operations | Live assurance test pending |
| Sale retry after timeout | v4 can return the previously committed sale for the same ID, store and authenticated cashier | Live retry/concurrency tests pending |
| Void/refund/return | Authorized lifecycle operations update their respective records and reports | Live lifecycle tests pending |
| Network loss and reconnect | Cache/selected queue paths work within their bounds, replay errors remain for reconciliation | Live queue/error recovery tests pending |
| Historical reporting | Product edits do not replace stored transaction snapshots used by reports | Live snapshot test pending |
| Reporting calculations | Seven existing Node unit tests pass locally | Passed 20 October 2026 |

Do not run the integration harness against production as part of a presentation rehearsal. It creates Auth users and business records and deletes test data during cleanup. A skipped integration stage is not a successful integration test.

## Recovery during the demonstration

- **Unexpected timeout:** pause and inspect transaction history, the sale ID and pending queue before charging again. v4 has an existing-sale return path, but a newly generated sale ID is a different request. Do not repeatedly press payment confirmation.
- **Offline or queued result:** state that the transaction is pending synchronization. Restore connectivity, reconcile replay status and refresh records. A queue entry with error status is not automatically retried by the pending-only replay loop. Do not silently present it as completed persistence.
- **Stock or price rejection:** refresh the catalog, recheck units and approved price, then start a corrected operation after verifying no earlier sale committed.
- **Authentication or MFA failure:** stop the protected operation and use the approved recovery path privately. Do not disable policies or bypass MFA for the panel.
- **Missing RPC/schema mismatch:** stop the affected scenario and show the verified architecture. Have the maintainer review deployed migrations after the session. Do not apply SQL from the projector.
- **Printer failure:** verify the sale remains committed, then use receipt preview/PDF or browser printing if available. Printing failure must not trigger a duplicate sale.
- **Report mismatch:** check store, date, status, payment filters, refunds, query refresh and base-unit interpretation. Record the discrepancy instead of editing data to force the expected outcome.
- **Application outage:** continue with the editable deck and explain that the live scenario is unverified. Use only synthetic, preapproved backup evidence and identify its capture date. Do not fabricate a successful walkthrough.

## Immediately after the demo

- [ ] Record actual results and failures separately from these expected outcomes.
- [ ] Reconcile pending and error queues, then sign out of the dedicated demonstration session.
- [ ] Store any captured evidence without passwords, tokens, real customer details or private database records.
- [ ] Follow the environment owner’s retention and restoration process. No post-demo cleanup is authorized by this checklist alone.
