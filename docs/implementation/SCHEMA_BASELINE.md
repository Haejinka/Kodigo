# Schema baseline and migration provenance

Observed 2026-11-10 (Asia/Manila). This is a **read-only deployed snapshot plus source review**, not a migration certification. It contains no credentials or business-row contents.

## Target and environment

| Item | Evidence |
| --- | --- |
| Deployed web origin | `https://kodigo-blue.vercel.app` returned HTTP 200 during a read-only fetch. |
| Application database URL | The published JavaScript bundle contains `https://vlnucrbsgxnetdiejnwt.supabase.co`; only the project URL was inspected, not the public key or user session. |
| Supabase project | `KodiGo Database`, project ref `vlnucrbsgxnetdiejnwt`, region `ap-northeast-1`, status `ACTIVE_HEALTHY`. |
| PostgreSQL | Server reports `17.6`; project metadata reports engine `17`, build `17.6.1.084`. |
| Isolation | This project is the deployed app's database and contains existing business rows. It was queried read-only for the initial T00 snapshot. It is **not** a test target. No development branches were listed. The later T02 additive migrations are separately recorded below. |
| Local tools | `supabase`, `psql`, and `docker` were not found on PATH. The pinned Supabase CLI 3.1.0 was later invoked through `npm exec` for migration generation only. |
| User workflow | No authenticated browser session or business mutation was used for this schema snapshot. |

The application URL and Supabase project ref match, confirming which environment the deployed bundle targets. Keep destructive database, cleanup, rollback, and concurrency checks on an explicitly identified isolated database. Reviewed additive forward migrations may be applied to the existing project under the user's authorization; do not replay historical migrations there.

## Deployed migration history

Read from the project's migration-history tool on 2026-11-10:

| Version | Recorded name |
| --- | --- |
| `20260328104303` | `07_multistore` |
| `20260328104451` | `08_multistore_rls` |
| `20260429201154` | `create_product_selling_options_for_catalog` |
| `20260429201558` | `harden_product_selling_options_trigger_search_path` |
| `20260429205424` | `reporting_schema_alignment` |
| `20260429205606` | `reporting_schema_alignment_advisor_cleanup` |
| `20260430085348` | `notification_system` |
| `20260430085459` | `notification_function_privileges` |
| `20260915144026` | `product_archiving` |
| `20260923040503` | `repair_sale_item_category_snapshot` |
| `20260930130000` | `consignment_inventory_lots` |
| `20260930180000` | `fix_shared_stock_alert_scope` |
| `20261021055917` | `fix_pos_item_discount_snapshots` |
| `20261027192054` | `harden_store_creation_and_audit_logging` |
| `20261028191705` | `scope_storeless_error_notifications` |
| `20261103134720` | `invite_code_redeemer_details` |
| `20261104104950` | `preserve_fractional_product_cost` |
| `20261104110526` | `preserve_restocking_package_price` |
| `20261104111935` | `preserve_fractional_stock_lot_costs` |
| `20261104112219` | `preserve_fractional_stock_cost_precision` |
| `20261107024409` | `selling_option_barcodes` |
| `20261107024525` | `deny_direct_barcode_registry_access` |

The checkout has 39 root migration files (01–32 and 34–40; migration 33 is absent) plus 20 timestamped files. The deployed history includes only 22 records; several names are similar but their timestamps differ from the checkout, and most root migrations have no corresponding recorded version. Supabase CLI migration reconciliation compares timestamps, so linking this checkout and running `db push` could replay SQL that already affected the database. **Do not link, push, repair migration history, or apply this manifest to the deployed project.**

Supabase's current CLI v3 migration guide states that database commands target the local stack by default, use `--remote` for hosted projects, and require confirmation before hosted changes. The migration-list reference says only timestamps are compared. Check the pinned version's own `--help` before choosing any command: [CLI v3 migration guide](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3), [migration list reference](https://supabase.com/docs/reference/cli/supabase-migration-list).

## Effective schema fingerprints

Read-only catalog query against public/private schemas. The fingerprints are MD5 checksums of sorted catalog descriptions; they are drift identifiers, not security hashes. Counts and checksums:

| Catalog | Count | Fingerprint |
| --- | ---: | --- |
| Relations | 45 | `d36cf2733da53b3841c02e7e588c03de` |
| Columns | 547 | `8894f8045112443a0a243448d1c04420` |
| Constraints | 244 | `c2c037133966dcd81cc5c909c7b956ff` |
| Indexes | 122 | `3697810bef84f967bc8f0aec22a0effe` |
| Routines | 87 | `173c73ffd08a852812c7eb107218949c` |
| Triggers | 41 | `30fd85d22ab4114e24c48dd701726ec7` |
| Policies | 77 | `00e8aca5e24c57f73f9500504694b99a` |
| Table grants | 1,013 | `b121dfce676f23e1839141435a2b2c74` |
| Routine grants | 240 | `4954ed1a09e9200e9b2fbbeabb85d4a0` |

Selected deployed precision (exact information-schema values):

| Column | Type |
| --- | --- |
| `products.current_stock` | `integer` |
| `products.cost_price` | `numeric(14,6)` |
| `products.selling_price` | `numeric(10,2)` |
| `sale_items.quantity` | `integer` |
| `sale_items.base_unit_quantity` | `numeric(12,3)` |
| `sale_items.cost_price` | unconstrained `numeric` |
| `sale_items.cost_per_base_unit` | `numeric(12,4)` |
| `inventory_stock_lots.unit_cost` | `numeric(14,6)` |
| `sale_item_stock_allocations.unit_cost` | `numeric(14,6)` |
| `sale_item_stock_allocations.quantity_base_units` | `numeric(14,3)` |
| `sale_item_stock_allocations.quantity_returned` | `numeric(14,3)` |
| `inventory_movements.quantity_delta` | `numeric(12,3)` |
| `stock_adjustments.quantity_delta` | `numeric(12,3)` |
| `sales.total` | `numeric(10,2)` |
| `consignment_supplier_payments.amount` | `numeric(14,2)` |

This narrows the plan's historical-cost statement: deployed receipt lots and sale allocations preserve six decimal places, while the older sale-line `cost_per_base_unit` snapshot is four decimal places and `cost_price` is unconstrained. Do not rewrite or reinterpret existing line/receipt snapshots. New canonical stock-cost recovery must use the original allocation/lot precision and retain the legacy line basis as provenance. This correction is reflected in BUSINESS_RULES, ARCHITECTURE, DATABASE_MIGRATION_PLAN, and T04/T05/T08 specifications.

### Effective RPC fingerprints

`pg_get_functiondef` checksums for selected deployed overloads. `definer=yes` means `SECURITY DEFINER`; function configuration is recorded so later changes can be compared exactly.

| Routine | Signature | MD5 | Definer | Configuration |
| --- | --- | --- | --- | --- |
| `public.process_pos_sale` | legacy 10-argument | `3ebd7d60efd1d5fa55c8fb475f2b3918` | yes | `search_path=public` |
| `public.process_pos_sale_v2` | legacy v2 | `cb03fefb056ea7cbd940a34f602a8cbb` | yes | `search_path=public` |
| `public.process_pos_sale_v3` | customer/tax v3 | `9414a19d7e87cc884d9ae419dd10f7e9` | yes | `search_path=public, private` |
| `public.process_pos_sale_v4` | customer/tax/discount v4 | `c9cd5a6933b4aa0b70cc62ae6df8b7e6` | yes | blank search path |
| `public.trg_deduct_stock_on_sale` | trigger | `b8a91055243ec28c36dcee46b1127f4d` | yes | `search_path=public, private` |
| `public.adjust_inventory_stock` | product/option/delta/reason/note | `55885c7ca038e4a3c1a8542b09694685` | yes | `search_path=public, private` |
| `public.receive_product_stock` | 9-argument receipt | `5203cd0526731157d1c00e90d5c76197` | yes | blank search path |
| `public.restock_product_inventory_v2` | 7-argument receipt | `77187dacb6cc7d5cc7cf2870f18ed2a6` | yes | `search_path=public, private` |
| `public.void_pos_sale` | sale/reason | `5b86c50a9b25009cae889e1d19184226` | yes | `search_path=public, private` |
| `public.return_sale_items` | sale/items/reason/method/reference | `c6e3ddd8a01a570c61b9fc9cfde73748` | yes | `search_path=public, private` |
| `public.refund_pos_sale` | sale/amount/method/reason/reference | `aa12108ef57c2880aa1449f81ff3c852` | yes | `search_path=public` |
| `public.close_cashier_shift` | legacy window closeout | `a14e801111151b35461f985011f8b9e9` | yes | `search_path=public` |
| `public.user_belongs_to_store` | store ID | `6757e4eb57830c20a5887180ea8d2665` | yes | `search_path=public` |
| `private.mfa_session_is_valid` | no arguments | `2c215ee2d35ce272bd628b51ab2a026b` | yes | blank search path |
| `private.sync_stock_lots_from_adjustment` | trigger | `ad9c855ebe9a3e18cb30416008fe8342` | yes | blank search path |
| `private.restore_sale_stock_lots_after_void` | trigger | `a6097a45e10fd7e97f6153875433e7fd` | yes | blank search path |
| `public.create_store_with_owner` | name/address/tax rate | `a5174d70b66c5e340db89cdcd030d41d` | yes | blank search path |

The exact argument lists for every selected overload, trigger definitions, relevant grants, and precision were read from catalogs. The live function checksums are fingerprints only; no deployed function body was modified.

### Trigger order that affects stock and cost

PostgreSQL fires same-event triggers alphabetically by trigger name. The deployed definitions confirm:

1. `sale_items` BEFORE INSERT: `zzz_set_sale_item_purchase_cost_trigger` snapshots unit/cost data, followed by `zzzz_allocate_sale_item_stock_lots_trigger` allocating original FIFO lots.
2. `sale_items` AFTER INSERT: `deduct_stock_on_sale_trigger` updates the product stock projection.
3. `sales` AFTER status UPDATE: `restore_sale_stock_lots_after_void_trigger` restores the original lot allocations on void.
4. `sale_return_items` AFTER INSERT: `restore_sale_item_stock_lots_trigger` restores source allocations under the existing return contract.
5. `stock_adjustments` AFTER INSERT: movement logging, notification, and lot synchronization triggers all fire; their alphabetical order is `log_stock_adjustment_movement_trigger`, `notify_stock_adjustment_trigger`, `sync_stock_lots_from_adjustment_trigger`.

Do not add a second stock or lot restoration path around these existing trigger paths. Keep purchase-order status changes distinct from receiving stock.

## Source manifest and unresolved verification

### T02 additive schema deployment

The existing project was confirmed as `vlnucrbsgxnetdiejnwt`, the database used by the deployed app. Its migration head before T02 was `20261107024525`; PostgreSQL reported version 17.6, `private.mfa_session_is_valid()` and `public.user_belongs_to_store(uuid)` existed, and `extensions.digest(bytea,text)` was available. The new tables and `public.get_pos_operation(uuid,uuid)` did not exist before deployment.

| CLI-generated file | Applied migration history / checked-in path | Canonical LF SHA-256 | Change |
| --- | --- | --- | --- |
| `20261110191636_t02_pos_operations.sql` | `20261110193226` / `t02_pos_operations` / `20261110193226_t02_pos_operations.sql` | `375bc4aa0d33721101dbf072497d0d637b8f42afd855852fe7b7631ed861141c` | Operation and event tables, server-side semantic request hashing, scoped idempotency helpers, persisted responses, guarded read RPC, and immutable/deferred integrity triggers. |
| `20261110193502_t02_operation_event_guards.sql` | `20261110193519` / `t02_operation_event_guards` / `20261110193519_t02_operation_event_guards.sql` | `992d7353135516539277986e26866274becf8fd11b67cee2d3b1c326029b1bc4` | Composite event foreign-key index and explicit deny policies for direct API table access. |
| `20261111064855_t02_fix_pos_operation_commit_trigger_context.sql` | `20261111064952` / `t02_fix_pos_operation_commit_trigger_context` / `20261111064952_t02_fix_pos_operation_commit_trigger_context.sql` | `c09092842adb9398e78cd931c8d7a7aef346fc3bd095a91800a1e33907a2c391` | Forward fix: deferred operation-integrity trigger uses blank-search-path `SECURITY DEFINER`; no direct function or table access granted to API roles. |

Supabase assigned migration-history timestamps different from the pinned-CLI generated timestamps. The checked-in filenames use the versions returned by migration history to prevent a later CLI deployment from replaying these migrations. The exact CLI paths are retained above. These additive migrations were applied directly to the existing project; the historical manifest was not replayed. Initial T02 catalog checks returned true for RLS, grants, RPC configuration, private-helper access, immutable/deferred triggers, unique sequence index, composite event foreign-key index and deny policies. The first authenticated customer command later exposed that the invoker-context deferred trigger could not read `pos_operations` at commit; the command transaction rolled back. Migration `20261111064952` changed only that trigger function to a blank-search-path security definer. Post-fix catalog checks confirmed the trigger remains deferred, the function has no anon/authenticated/service_role execute grant, and those API roles still have no direct table SELECT. Deployed customer create/update/archive then succeeded. At initial T02 deployment no user, sale, inventory, cash or financial record changed; one separately labeled no-contact customer test record remains archived and is documented in TASK_STATUS.

The manifest [`../../supabase/bootstrap-manifest.json`](../../supabase/bootstrap-manifest.json) remains the dated baseline snapshot at source revision `ef2d963b681b371a7bbd103dd1b5b2a72b3f26e3`, containing 60 candidate historical SQL files (baseline + 39 numbered root migrations + 20 timestamped migrations). The two T02 forward migrations were added later and are recorded separately above. Root migration 33 is explicitly absent. The candidate order puts all root migrations before timestamped patches so November stock-cost patches follow root 37/receipt definitions. Exploratory GitHub Actions runs #109–#111 used temporary runner-local PostgreSQL containers, not Supabase projects/branches, and never contacted the deployed database. Run #109 stopped at the original CRLF-sensitive checksum. Run #110 passed normalized hashing and exposed the baseline `is_admin()` enum-label issue; the baseline now compares `role::text` against the same `admin`/`super_admin` values. Run #111 replayed the baseline through root migration 20, then failed in root migration 21 because PostgreSQL 17 has no `MIN(uuid)` aggregate. The user has directed that no fresh database be created; the auto-starting CI job and runner script have been removed, and no further bootstrap replay will run. T00 remains blocked. The populated deployed database was read-only for T00; the later T02 feature migrations were applied separately under the user's authorization.

### T03 additive capabilities and approval schema

Before deployment, the existing project was checked for the T03 tables and RPCs; they were absent. The live `store_users` table has a unique `(store_id, profile_id)` key, and the project has the expected MFA/membership helpers and PostgreSQL 17.6 behavior. The pinned CLI generated `20261110194941_t03_store_capabilities.sql`; Supabase recorded `20261110201017 / t03_store_capabilities`, so the checked-in filename follows applied history.

| CLI-generated file | Applied migration history / checked-in path | Canonical LF SHA-256 | Change |
| --- | --- | --- | --- |
| `20261110194941_t03_store_capabilities.sql` | `20261110201017` / `t03_store_capabilities` / `20261110201017_t03_store_capabilities.sql` | `13b6a0eaf1d88f8a212dd870340083b143c542a56c9b050d2d0cf6e56ef8b0de` | Store-scoped capability grants, membership revocation history, typed all-false feature settings, capability assertion, admin-only list/grant/revoke RPCs, immutable typed approval request/decision/application records, independent decision checks, and shared apply-time version guard. |
| `20261110201431_t03_approval_revocation_guard.sql` | `20261110201551` / `t03_approval_revocation_guard` / `20261110201551_t03_approval_revocation_guard.sql` | `0601589ca25e3fd2c1ff80f5f242debea482f4f7dde8d3f1895cc731d1b9ca0c` | Forward hardening: apply-time checks revalidate that the requester and approver still have store membership, the approver still has the required capability, and wallet approval remains with a current admin. |

Post-deployment read-only checks passed for RLS on all five tables, no direct `anon`/`authenticated`/`service_role` table access, authenticated-only blank-search-path public wrappers, private helper denial, active grant uniqueness, and feature flag allowlist/type checks. The dedicated catalog script returned `T03 capability and approval catalog checks OK` before and after the follow-up. Capability grants, store settings, approval requests, decisions and applications all remain empty. After the follow-up, the catalog contains 52 relations, 116 routines, 54 user triggers and 84 policies. Supabase security advisors still report the project's existing broad SECURITY DEFINER warnings and expected warnings for signed-in command RPCs; the new T03 wrappers have no `anon` or `service_role` execute grant. The T03 migrations did not insert or update business records.

### T04 inventory deployment and shadow reconciliation

The 2026-11-10 preflight found 32 products, 34 source lots, 10 sale-item lot allocations, 15 inventory movements, eight sales and seven stock adjustments. On 2026-11-11, a fresh read-only preflight reconfirmed the same counts, zero negative products/lots, zero product/source-lot stock mismatches and zero cross-store lots or allocations. Deployed precision remains `inventory_stock_lots.unit_cost numeric(14,6)` and `sale_items.cost_per_base_unit numeric(12,4)`.

The additive T04 schema and shadow snapshot were applied to the existing project `vlnucrbsgxnetdiejnwt` in this order. Supabase migration history assigned versions that differ from the local CLI-generated names; checked-in filenames below are aligned with the applied history so a later `db push` cannot replay them.

| CLI-generated file | Applied history / checked-in file | Canonical LF SHA-256 | Result |
| --- | --- | --- | --- |
| `20261110203314_t04_inventory_ledger_structure.sql` | `20261111043255` / `t04_inventory_ledger_structure` / `20261111043255_t04_inventory_ledger_structure.sql` | `b173ad6142c6a950b4f2fea6df0d13820f507dee04442593dd28c5e1fd1b3b33` | Applied; additive schema, triggers, private bounded helpers, RLS and deny grants |
| `20261111043350_t04_fix_uuid_batch_cursors.sql` | `20261111043438` / `t04_fix_uuid_batch_cursors` / `20261111043438_t04_fix_uuid_batch_cursors.sql` | `5e8b40ea23068e4ac4d07d1454089e225b9b80a4504f69b105e59842eb76f67e` | Applied forward fix for three unsupported `max(uuid)` batch cursors |
| `20261110205156_t04_inventory_shadow_constraints.sql` | `20261111043523` / `t04_inventory_shadow_constraints` / `20261111043523_t04_inventory_shadow_constraints.sql` | `786718bb33f206768c303d257879f56abe633e35e1f3d6f03623c8fe2127564c` | Applied after preflight; required constraints validated |
| `supabase/tests/enhancements/T04_inventory_schema.sql` | — | `e73f158c2004848ada36fd2dc53ab2c81e255f0dd42420d87aa6c3e0f75aaa74` | Executed on the existing project; catalog assertions completed without error |

The first live backfill call failed before changing any lot row because PostgreSQL does not implement `max(uuid)`. A forward-only migration replaced that cursor expression in all three helpers with ordered UUID selection. The failed statement rolled back; the corrected bounded batches then assigned locations to 34 legacy lots, inserted 64 product/location balance snapshots and 68 lot/location snapshots, all marked `shadow`. Reconciliation checked all 32 products and reported zero mismatches. All 15 existing movements remain `legacy`, all 10 allocations remain `legacy`, and no baseline movement or cutover row was fabricated. No product or source-lot quantity was changed.

The user explicitly authorized additive migrations on this existing project and prohibited creating a separate database or backup database. Accordingly, no backup database, branch or isolated project was created. Destructive rollback, write-path, and concurrency checks remain unrun because they require an isolated target; T05/T06 writers and cutover remain the next gates.

### T05 private inventory mutation service

The pinned Supabase CLI generated `20261111045323_t05_inventory_mutation_service.sql`. The existing project recorded the migration as `20261111052012 / t05_inventory_mutation_service`; the checked-in migration filename follows the applied history so a later migration push will not replay the definitions.

| CLI-generated file | Applied history / checked-in file | Canonical LF SHA-256 | Result |
| --- | --- | --- | --- |
| `20261111045323_t05_inventory_mutation_service.sql` | `20261111052012` / `t05_inventory_mutation_service` / `20261111052012_t05_inventory_mutation_service.sql` | `DEEB10173BBA4A46A1751C10786743DB420FA624A9C3A54F317EEA53FFD98AAB` | Applied additively to the existing deployed project; private service definitions only |
| `20261111052420_t05_fix_quarantine_release_recovery.sql` | `20261111052533` / `t05_fix_quarantine_release_recovery` / `20261111052533_t05_fix_quarantine_release_recovery.sql` | `EF4019117647056AEB48ABA4643ABCF388A20109821885D3BA8FBD1CE8307D01` | Forward fix; paired quarantine-release transfer records COGS recovery without decreasing net sold quantity twice |
| `supabase/tests/enhancements/T05_inventory_service.sql` | — | `AF0740F74C52AFC3FDE8471299479A9B5E87308CE4192237FACE7D98A03755EE` | Deployed read-only catalog assertions passed |

The private layer defines `apply_inventory_movement`, `allocate_sale_lots`, `restore_allocation_slices`, `transfer_inventory`, and `dispose_quarantined_stock`. It locks balance/source rows in deterministic order, requires an active processing operation and completed store cutover, uses FIFO for sale allocation, links restorations to source allocations, snapshots six-decimal source-lot costs, updates product and selling-option projections, and uses paired same-store transfer movements. The helpers are SECURITY DEFINER with an empty search path; direct execute grants to `anon`, `authenticated`, and `service_role` are revoked. No legacy sale/adjustment/return/void trigger or application call site is connected in T05; T06 owns that cutover.

The first hosted apply attempt was rejected before its migration recorded because `allocate_sale_lots` used an undeclared loop record; the declaration was added and the migration then applied successfully. During review, the quarantine inspection-release path was corrected in a separate generated forward fix: it uses paired transfer movement types, adds COGS recovery from source-lot cost, and does not decrement net sold quantity a second time. The first forward-fix apply was rejected before commit due to a CASE-expression parse error; the corrected migration applied successfully. The deployed catalog test passed after both migrations. Read-only counts before and after remain 32 products, 34 lots, 10 allocations, 15 movements, eight sales, and seven adjustments. There are still zero cutovers, POS operations/events, and movement-lot slices. No business record was created or updated by T05.

FIFO allocation, source restoration, paired transfer, quarantine disposal, injected rollback, wrong-scope denial, and two-connection concurrency were not executed against the populated deployed database. They remain acceptance gaps because the user prohibited a fresh database and destructive/write/concurrency tests are limited to an explicitly isolated target. T05 remains in progress, feature-gated and unconnected; T06 must establish the reconciled cutover before routing any writer.

### T06 gated inventory writer migration

The CLI generated `20261111085103_t06_centralize_stock_writers.sql`; the existing project recorded it as `20261111102228 / t06_centralize_stock_writers`, so the checked-in path follows deployed history. It adds the zero-inclusive immutable cutover snapshot and RPC/trigger wrappers while leaving every store's inventory ledger gate off. The migration does not run the cutover.

| CLI-generated file | Applied history / checked-in file | Canonical LF SHA-256 | Result |
| --- | --- | --- | --- |
| `20261111085103_t06_centralize_stock_writers.sql` | `20261111102228` / `t06_centralize_stock_writers` / `20261111102228_t06_centralize_stock_writers.sql` | `0FB3FAE34D3E135CBAB1C8EAD814B84A4EE3FEDADFE8CACAC76FB0319994EED6` | Applied; additive functions/triggers and compatibility wrappers only |
| `20261111102410_t06_revoke_service_role_execute_grants.sql` | `20261111102435` / `t06_revoke_service_role_execute_grants` / `20261111102435_t06_revoke_service_role_execute_grants.sql` | `C371EB3814B3D18A67239A0DBD9BEC8E57CF90A8EF3751938F8545264E09D6D2` | Forward fix removes inherited explicit `service_role` execution grants; authenticated remains the callable API role |
| `supabase/tests/enhancements/T06_stock_cutover.sql` | — | `735847ACF9F0A1DB94525E250F46BC682EB9CF19DF719871EFDE27515BE04197` | Read-only deployed catalog/release-gate assertions passed after the ACL fix |

The first deployed T06 catalog assertion caught explicit historical `service_role` grants preserved by `CREATE OR REPLACE`. The forward fix revoked only those function grants. The T06 catalog assertions then passed. Read-only counts remain 32 products, 34 lots, 10 sale-item stock allocations, 15 inventory movements, eight sales, seven stock adjustments, zero inventory cutovers and zero stores with `inventory_ledger_v2` enabled. Three prior POS operations and six prior events remain unchanged; no T06 business operation or stock row was created. Hosted run [#148](https://github.com/Haejinka/Kodigo/actions/runs/43004003019) passed typecheck, lint, build, 81/81 units, 13 Chromium offline-storage tests, two production app-shell tests, two deployed-origin read-only smoke tests, and print-agent checks; both Vercel contexts succeeded. The deployed admin session opened Dashboard and Product Management at `https://kodigo-blue.vercel.app` without issuing any business write. Write-path, rollback, replay and two-connection concurrency tests remain unrun because the live database is not an isolated test target. Keep cutover off.

### T24 cash-custody schema deployment

Before T24, read-only inspection found no `pos_terminals`, `cash_drawers`, or `cashier_shifts` relations; `public.pos_operations` and historical `public.cashier_closeouts` contained zero rows. Existing closeouts remain untouched. T02/T03 operation identity, MFA, store membership, admin assertion, and the existing `drawer_shifts` default-off feature flag are the implementation baseline.

The T24 API shorthand originally omitted the operation ID/envelope for writes, conflicting with the deployed T02 replay contract. The smallest correction is to require `CommandV1` for terminal registration, drawer registration, and shift opening, with actor identity derived from the authenticated session. This correction is reflected in `API_CONTRACTS.md` and the T24 task specification.

| CLI-generated file | Applied history / checked-in file | Canonical LF SHA-256 | Result |
| --- | --- | --- |
| `20261110212138_t24_drawers_terminals_shifts.sql` | `20261111043135` / `t24_drawers_terminals_shifts` / `20261111043135_t24_drawers_terminals_shifts.sql` | `055845a95f1f40951312d97355d2fc45d2831a287246e7e18d77c4563098813a` | Applied to existing project |
| `supabase/tests/enhancements/T24_shift_open.sql` | — | `e77dc0a86e3d1ae68b3b7b407c320d041bcea47c1cbdf0cd4992f2dfc2da41ff` | Read-only catalog assertions executed successfully |

The T24 opening RPC checks the existing `drawer_shifts` flag, which defaults off; it cannot create an active shift until the application enables the complete T24–T30 workflow. The post-migration snapshot has zero terminal, drawer, shift and closeout rows. No flag was enabled and no business record was created.

### T25 cash-ledger schema deployment

Before T25, `cash_movements`, `cash_reservations`, `cash_reservation_events`, `payment_cash_links`, and `payment_service_links` did not exist. The deployed `sale_payments` table has `id`, `store_id`, `method`, `status`, and `amount`, with `id` as its primary key but no `(store_id,id)` unique key. T25 therefore uses the existing payment ID FK plus a locked store/method scope trigger rather than adding an unnecessary uniqueness index to historical payment rows. Before the new schema, there were no cashier shifts or historical closeouts.

Two exact specification conflicts were corrected before SQL application. First, M07 originally sent reservation lifecycle events to `pos_operation_events`, but the deployed T02 `event_type` constraint is exactly `started|committed` and that table is a command lifecycle log. T25 adds a dedicated immutable `cash_reservation_events` table linked to operation IDs. Second, T24 explicitly accepts `opening_cash = 0`, while B07/M07 reserve zero-delta movements for close counts. T25 preserves both contracts: positive opening cash posts one opening movement; a zero opening records shift custody only and produces no cash-ledger row. These are documented in the database plan, API contract, and T24/T25 specifications.

The pinned Supabase CLI `3.1.0` generated the original migration file `20261111040311_t25_cash_movements_and_reservations.sql`. Supabase applied migration history version `20261111043143`; the checked-in migration filename is aligned to that applied version.

| CLI-generated file | Applied history / checked-in file | Canonical LF SHA-256 | Result |
| --- | --- | --- |
| `20261111040311_t25_cash_movements_and_reservations.sql` | `20261111043143` / `t25_cash_movements_and_reservations` / `20261111043143_t25_cash_movements_and_reservations.sql` | `22a5c5a9095255f960d2b9c6b7a54e79d68e6ba5e7aaa02cb9db52acda48f5ec` | Applied to existing project |
| `supabase/tests/enhancements/T25_cash_ledger.sql` | — | `4c739e4394d3b8b9b68bde0dab15aab616b1a55dc60a7cea762d787c6901322f` | Executed without SQL error; it returned no result rows |

Post-migration read-only counts are zero for terminals, drawers, shifts, cash movements, reservations, reservation events and payment links. No shift, cash movement or hold was created; the schemas are not enabled in the cashier UI. The catalog test does not prove cash-flow behavior, authorization replay or concurrent reservation behavior.

The following T00 acceptance evidence is still pending and blocks any feature-write activation:

- Confirm the checksummed manifest replays successfully on the approved isolated target. This remains blocked by the user's instruction not to create a fresh database. Run #111 demonstrates that the candidate order reaches `migration_21_reporting_snapshots_and_reports.sql`, where `MIN(si.category_id)` fails with `function min(uuid) does not exist`; no source correction to this historical migration has been made. The populated deployed project has no `min(uuid)` aggregate and has a different `v_category_sales` definition, confirmed by read-only catalog query. Do not run the candidate manifest or historical SQL on the deployed project.
- Restore an isolated historical copy and compare effective RPC, trigger-order, RLS/grant, precision, and fixture fingerprints.
- Run V47, V48, and V51 on that isolated environment; preserve receipt hashes and avoid fabricated stock/cash history.
- Confirm deployed login/workflows separately with the authorized test account. Do not include its credentials in reports or screenshots.

No bootstrap correction or historical SQL was applied to the deployed project. The additive T02, T03, T04, T24 and T25 migrations above are separate forward changes and did not replay the candidate manifest. If empty/restore evidence proves the candidate order wrong, make the smallest forward correction and record the changed specification paths here and in TASK_STATUS; never edit or replay the old deployed history to make the hashes match.

### T43 customer schema and RPC deployment

Before applying T43 on 2026-11-11, the deployed project had no customer tables. The existing `sales` table had eight rows, retained its `customer_name`, `customer_tin`, and `customer_address` receipt snapshots, and had only its existing `id` primary key; the applied T05 migration was the latest history entry. The T43 migration adds a nullable `sales.customer_id`, same-store composite foreign keys, store-local customer profiles, immutable sale-link events, restricted command/search RPCs, and lookup indexes. It does not backfill or edit any sale or receipt snapshot.

The pinned Supabase CLI `3.1.0` generated `20261111055259_t43_store_customers.sql`. Supabase recorded the applied migration as `20261111060332 / t43_store_customers`; the checked-in migration filename is aligned with the deployed history so a later push will not replay it.

| CLI-generated file | Applied history / checked-in file | Canonical LF SHA-256 | Result |
| --- | --- | --- | --- |
| `20261111055259_t43_store_customers.sql` | `20261111060332` / `t43_store_customers` / `20261111060332_t43_store_customers.sql` | `c6810546324b7f0f9f9bbc9d994d27018797078f25856d4b25ae9472e1ce94f9` | Applied additively to the existing project; no customer or sale data was written |
| `supabase/tests/enhancements/T43_customer_schema.sql` | — | `47265094ddc9524d309f8ba8133a5869c3843419c58bf7392429ff7432e4f4bc` | Executed read-only against the deployed project; catalog assertions passed |

Post-migration catalog verification confirmed that both customer tables have RLS and no direct table privileges for `anon`, `authenticated`, or `service_role`; all six public customer RPCs have blank search paths, are executable by `authenticated` only, and validate store membership/MFA, with `manage_customers` required for profile/contact writes. The immutable customer-link trigger and same-store foreign keys are present. Read-only counts remain eight sales, zero customer-linked sales, zero customer profiles, zero customer-link events, and zero POS operations. No customer PII was created.

The security advisor reports authenticated SECURITY DEFINER warnings for the six intentionally exposed RPCs. These routines are the narrow API boundary because direct table access is denied; each write path checks the authenticated actor, store capability, command envelope and operation identity. No new anon-executable customer definer function or mutable-search-path finding appeared. Performance advice reports the new indexes unused while customer tables are empty. The project already has unrelated pre-existing security/performance findings.

T43 remains in progress. The catalog check does not exercise authenticated profile writes, foreign-store denial, version conflicts, archive, identical-operation replay, or two-connection races. Those need an isolated integration target or authorized role-specific workflow tests. Contact retention/redaction remains gated by D07; the optional customer UI is T44 and is not connected yet.

### T08 financial facts and commercial credits

Before T08, the existing `KodiGo Database` project (`vlnucrbsgxnetdiejnwt`, PostgreSQL `17.6.1.084`) had migration history through `20261111102435`. Read-only schema inspection confirmed legacy `sale_returns` and `sale_return_items`; the existing return RPC writes both `sale_returns.refund_amount` and a negative `sale_payments` row, while the legacy void RPC only changes payment status. T08 therefore keeps legacy return value and cash refund as separate facts and never infers a reversal from `voided` status.

The pinned Supabase CLI `3.1.0` generated `20261111104446_t08_sale_credits_and_financial_facts.sql`; Supabase applied it to the same existing project as history version `20261111110225`. The checked-in migration file is aligned to applied history.

| CLI-generated file | Applied history / checked-in file | Canonical LF SHA-256 | Result |
| --- | --- | --- | --- |
| `20261111104446_t08_sale_credits_and_financial_facts.sql` | `20261111110225` / `t08_sale_credits_and_financial_facts` / `20261111110225_t08_sale_credits_and_financial_facts.sql` | `4acb950cb2e0954b33ca687bcf2f9e9e440f05ba1a1a2dd6d22b788df2a9dd23` | Applied additively; existing sales, receipt snapshots, payment rows, returns and sale statuses were not updated |
| `supabase/tests/enhancements/T08_financial_facts.sql` | — | `22e0f6a15ddff57561aa18bebee711bcf8ee85b3e0ed52b56996b3d811269a9` | Deployed catalog/permission assertions passed; read-only legacy fact adapter check passed |

The test confirmed RLS and no direct table privileges for the four new tables, the authenticated-only public read RPC, the private-only credit writer, sign/source constraints, and deferred header/line total enforcement. Counts remain eight sales, eight sale items, eleven payments, and two legacy returns; all new adjustment, payment-allocation, and classification tables remain empty. No business data was changed. Focused centavo allocation tests passed 3/3 and `npm run typecheck` passed. Credit posting remains private and version-5-only, with no user-facing operation enabled. Full authenticated workflow, rollback/replay, and concurrency verification remains pending.

### T51 bounded offline lease schema

Before the T51 migration on 2026-11-11, the deployed project had no lease or cursor tables, zero cashier shifts, and zero stores with `offline_escrow` enabled. Migration history ended at `20261111064952`. The pinned Supabase CLI 3.1.0 generated `20261111071449_t51_offline_authorization_leases.sql`; Supabase recorded migration `20261111073628 / t51_offline_authorization_leases`, and the checked-in filename is aligned to that applied version.

| CLI-generated file | Applied history / checked-in file | Canonical LF SHA-256 | Result |
| --- | --- | --- | --- |
| `20261111071449_t51_offline_authorization_leases.sql` | `20261111073628` / `t51_offline_authorization_leases` / `20261111073628_t51_offline_authorization_leases.sql` | `515bf6066eab50eeef593b25185ed98ef039b4fa4400184479925dc169eb3c25` | Applied additively to the existing project; no lease, cursor or test-shift rows were written |
| `supabase/tests/enhancements/T51_offline_leases.sql` | — | — | Read-only catalog assertions executed against the deployed project; passed |

Read-only verification confirmed RLS on all three tables, no direct privileges for `anon`, `authenticated`, or `service_role`, and authenticated-only blank-search-path SECURITY DEFINER wrappers for issue/revoke/get. Lease lifecycle and event immutability triggers are enabled. Post-migration counts remain zero for leases, lease events, cursors, and shifts; `offline_escrow` remains disabled everywhere. Health advisors remain clear; security advisors reported only pre-existing table/function/auth findings, with no missing-policy finding on the new tables.

This verifies deployed schema, function grants and safety gates, not authenticated issuance/revocation. The live project has no active shift, and the cashier shift UI is not connected. No lease, cursor, shift or sale was created for this check. Role/foreign-store behavior, duplicate replay, rollback and concurrency checks remain unrun because they require a separate isolated database, which the user has instructed us not to create. D03 and T06/T24 UI/T26/T31/T52–T59 still gate activation.

### T32–T42 manual digital services schema (applied; feature disabled)

The pinned Supabase CLI 3.1.0 generated `20261111120227_t32_t42_manual_digital_services.sql`. At the user's direct request, it was applied to the existing `KodiGo Database` project (`vlnucrbsgxnetdiejnwt`) as history version `20261111130705 / t32_t42_manual_digital_services`. The checked-in migration source SHA-256 after the trigger-function ordering correction is `12f27203a733a043d0e423638cacd711e6210f925ab6743dc01fb328cd079d2a` (canonical LF). The first apply attempt failed before applying because a privilege revoke preceded its function definition; the transaction left no partial schema. The ordering was corrected and the retry succeeded.

Read-only checks confirm the migration is in history, all 18 new tables have RLS and no direct SELECT privilege for `anon`, `authenticated`, or `service_role`, and the eight public RPCs use blank-search-path SECURITY DEFINER with execute granted only to `authenticated`. Counts are zero for provider accounts, wallets, service records and wallet movements; no business data was written. The one store has `digital_services` disabled. Health advisor returned no findings. Security advisor reported no missing-policy finding for these new tables; it did report five RLS/no-policy findings on other existing/T08 tables, plus unrelated existing function/auth warnings.

The schema/source includes e-load at rounded 98% wallet cost with an explicit optional extra charge; cash-in at a default 3% or selectable 2%; and cash-out at ₱2 for ₱50–₱100, ₱4 above ₱100, or selectable 2%. References and evidence are manual; no GCash API is integrated. `npm run typecheck` in `kodigo-ui/` found only unrelated errors in `src/lib/reporting.ts:1304` (two arguments supplied where one is expected) and `:1764` (unused helper), with no digital-service diagnostics. No task tests or financial operations were run. T00 restore/bootstrap equivalence remains blocked and D05 accounting/fiscal classification is unresolved; applying schema did not satisfy those gates or enable the feature. See the T32–T42 rows in `TASK_STATUS.md` for remaining implementation and verification work.
