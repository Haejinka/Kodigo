# Schema baseline and migration provenance

Observed 2026-11-10 (Asia/Manila). This is a **read-only deployed snapshot plus source review**, not a migration certification. It contains no credentials or business-row contents.

## Target and environment

| Item | Evidence |
| --- | --- |
| Deployed web origin | `https://kodigo-blue.vercel.app` returned HTTP 200 during a read-only fetch. |
| Application database URL | The published JavaScript bundle contains `https://vlnucrbsgxnetdiejnwt.supabase.co`; only the project URL was inspected, not the public key or user session. |
| Supabase project | `KodiGo Database`, project ref `vlnucrbsgxnetdiejnwt`, region `ap-northeast-1`, status `ACTIVE_HEALTHY`. |
| PostgreSQL | Server reports `17.6`; project metadata reports engine `17`, build `17.6.1.084`. |
| Isolation | This project is the deployed app's database and contains existing business rows. It was queried read-only. It is **not** a test target. No development branches were listed. |
| Local tools | `supabase`, `psql`, and `docker` were not found on PATH. No CLI/server version or CLI `--help` was available. |
| User workflow | No authenticated browser session or business mutation was used for this schema snapshot. |

The application URL and Supabase project ref match, confirming which environment the deployed bundle targets. Keep all destructive, rollback, migration, and concurrency checks on a separately identified disposable database.

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

[`../../supabase/bootstrap-manifest.json`](../../supabase/bootstrap-manifest.json) contains all 60 current source files (baseline + 39 numbered root migrations + 20 timestamped migrations), their repository-relative paths, SHA-256 hashes, and a serialized candidate dependency order. Hashes are over UTF-8 text with CRLF normalized to LF so GitHub Linux and Windows worktrees share a stable fingerprint. Root migration 33 is explicitly absent. The candidate order puts the full root chain before timestamped patches; this ensures the November dynamic stock-cost patches have their root 37/receipt definitions. It is exercised by a GitHub Actions job that starts a temporary Supabase database and replays only the checksummed manifest. The first run stopped before SQL replay because the original manifest hash reflected Windows CRLF bytes; canonical hashing is now implemented and the rerun is pending. No local bootstrap was run.

The following T00 acceptance evidence is still pending and blocks any feature-write activation:

- Compare the pinned Supabase CLI 3.1.0 behavior on the isolated CI target and confirm manifest replay succeeds there. The first CI run verified that the local database starts, then stopped at the pre-replay `supabase_schema.sql` checksum; no SQL file was applied. The correction normalizes CRLF to LF before hashing; a second CI run is pending.
- Restore an isolated historical copy and compare effective RPC, trigger-order, RLS/grant, precision, and fixture fingerprints.
- Run V47, V48, and V51 on that isolated environment; preserve receipt hashes and avoid fabricated stock/cash history.
- Confirm deployed login/workflows separately with the authorized test account. Do not include its credentials in reports or screenshots.

No bootstrap correction or SQL was applied to production. If empty/restore evidence proves the candidate order wrong, make the smallest forward correction and record the changed specification paths here and in TASK_STATUS; never edit or replay the old production history to make the hashes match.
