# Central business rules

Normative design for new implementation; current behavior is in [SYSTEM_AUDIT.md](SYSTEM_AUDIT.md). Rule IDs are acceptance-test references. Defaults below are architectural rollout decisions, not claims about an existing deployment. Unresolved commercial/legal policy is listed in HANDOFF.

## B01 — Identity, authority and audit

Every operational write carries store, operation UUID, actor, terminal, server timestamp and optional local occurrence timestamp. Server derives actor from `auth.uid()`; a recovered offline record retains original actor and separately records its authorized synchronizer. All referenced records must belong to the same store, enforced by composite keys/FKs or guarded triggers in addition to RLS. Never authorize from editable user metadata.

Admin has store capabilities; cashier may receive explicit `approve_void`, `approve_return`, `approve_refund`, or `approve_cash_adjustment` grants for an assigned store. Call that employee a supervisor in the UI. Granting capabilities remains admin-only, audited, and cannot be self-escalated. `super_admin` gets no operational authority by default. Inventory staff can inspect stock and perform allowed stock operations; `approve_inventory_adjustment` is a separate scoped grant and does not confer money authority. Requester and approver must differ, including when both are admins. Closeout review is admin-only and reviewer must differ from submitter; a lone owner requires a second authorized admin, never an implicit self-approval exception.

Reasons are trimmed, 3–500 characters for void, credit/refund, return, stock correction and manual cash/wallet adjustments. Store capability checks, membership and MFA validity run inside every RPC. Financial/inventory history is append-only. Updates to workflow status and projections are allowed only inside controlled operations and produce immutable events.

## B02 — Amounts, units and price provenance

Money: PHP, `numeric(14,2)` for settled totals; frontend transport uses decimal strings for new APIs. Internal calculations use Postgres numeric and explicit rounding to two decimals at posting. Rates are basis points (200 = 2%; 300 = 3%). Deployed receipt lots and sale allocations retain `numeric(14,6)` unit costs. The legacy `sale_items.cost_per_base_unit` is `numeric(12,4)` and `sale_items.cost_price` is unconstrained `numeric`; preserve those historical snapshots and do not claim six-decimal precision for every old sale line. New stock-cost recovery uses the immutable source-lot/allocation cost and records its provenance. No floats for canonical accounting. Quantities preserve current integer selling/base-unit policy; ledger/lot numeric columns can represent existing legacy precision, but fractional POS selling is outside scope.

Snapshot product/option/unit, `units_per_package`, base quantity, unit price, discounts, allocated VAT, cost and financial version on sale. New sale line `line_total` is already net of item discount; never deduct it a second time. Legacy formats are classified by proven receipt/line data; ambiguous records remain `legacy_unknown` and are flagged, not rewritten. Reversals use original snapshots, never current package size or price.

For ambiguous legacy line formats, immutable sale.total remains the authoritative original header charge. Unproven per-line revenue/discount/refund allocations go to an explicit Unallocated legacy amount bucket with complete=false and unclassified_count, rather than guessed product attribution. Customer/header totals can use proven header/payment facts; product rankings disclose incomplete attribution. Do not silently drop unknown records or fabricate line precision.

For VAT-inclusive stock sales, preserve current configured rule: `total = sum(net line totals)`; `VAT = round(total * rate / (100 + rate), 2)` for VAT stores; `VAT = 0` otherwise. This plan does not change senior/PWD statutory treatment. Digital principal/commission tax classification requires the deployment's approved accounting policy before financial rollout.

Deterministic allocation: compute exact positive line shares, floor each to centavos, then assign remaining centavos by descending fractional remainder and ascending sale-item UUID as tie-break. Repeated partial credits use cumulative entitlement: `credit_for_this_return = round(original_line_net * cumulative_accepted_qty / sold_qty,2) - prior_quantity_credits`. Final eligible unit receives residual cents. Allocated discount/VAT/cost use the same cumulative method. No cumulative credit exceeds original eligible line amount.

## B03 — Independent commercial and cash facts

Retain `sales` as commercial aggregate. Distinguish sale lines, commercial credit (`sale_adjustments`/lines), payment capture, confirmed refund, physical return/disposition, approved void, stock movement, physical cash movement, wallet movement, earning, and provider settlement. A return is not a refund; a refund is not proof of goods returned; a void approval is not an external reversal.

`gross_billed = original pre-item-discount value`; `sale_discount = original item discounts`; `net_billed = gross_billed - sale_discount - posted commercial credits`. A return/void/refund-only allowance creates a commercial credit **once**. A refund consumes available credit and reduces net paid, never reduces net billed again. Refund-only goodwill creates a monetary credit with zero returned units. `net_paid = captured payments - confirmed outgoing payment reversals/refunds`. `refund_due = posted credits - confirmed outgoing refunds/void reversals`, bounded below by zero; show timing/settlement exceptions separately. Pending requests/refunds have no posted commercial/cash impact.

New captures remain immutable. New refund/void reversal payment rows are negative and reference the original capture and operation; `event_kind` distinguishes refund versus void reversal. Retain legacy payment statuses for compatibility, but canonical facts use event kind, accounting version and explicit legacy adapters. Never infer real historical cash returned merely from a legacy voided status. Historic unknown settlement is a reconciliation exception.

Reports expose commercial net billed, captured/refunded/net paid and pending liabilities separately. Existing legacy reports can retain their historical basis during a labeled transition; do not relabel different definitions as identical. COGS is recovered only for inventory actually accepted back as restockable; damaged returns retain realized cost/loss. Full void restores original eligible COGS. Supplier payable on consigned goods received is unchanged by retail void/return; supplier returns/payable reductions require their own authorized evidence.

For a full new void, original net minus its cancellation credit is zero: do not exclude original billed amount and then subtract the credit again. Legacy voids without explicit credit normalize directly to zero with unknown cash settlement flagged. Product/customer commercial facts and payment facts use this one normalized rule.

## B04 — Sale and void eligibility

New online sale requires open shift, assigned terminal/drawer, authenticated authorized cashier, supported tender, valid item snapshots, available unreserved stock and complete atomic accounting. Pending local records are not server-confirmed sales and have no official server receipt number.

| Sale situation | Allowed action |
| --- | --- |
| Cart/local draft, no posted sale | Abandon draft; preserve a recorded offline cash sale for reconciliation, never delete it as a cart. |
| Completed, unclosed physical sale, goods still held/not fulfilled | Request full void; separate approver; apply once after payment recovery requirements. |
| Cash captured and refundable at the same open drawer | Approved void application posts cancellation credit, cash reversal, payment reversal and stock restoration atomically, after cashier attests cash returned. |
| Noncash capture or externally settled service | Approval enters awaiting_settlement; verify external reversal first. If irreversibly fulfilled, void denied; use return/credit/refund or digital reversal workflow. |
| Partially returned/refunded/credited | Void disallowed by default; continue return/refund workflow against remaining entitlement. |
| Already voided | Repeated identical operation returns prior result; different attempt rejects. |
| Closed/submitted/approved shift | Inline void disabled; use new return/credit/refund and post-close adjustment. |

Partial voids are **disabled by default**. Schema supports requested line quantities and cumulative bounds; enabling requires D02 policy approval and the T15 flag gate. Never substitute a partial return and label it a void. If enabled, require no prior return/credit on affected units, held/unfulfilled goods, unclosed shift, independent approval, line-level payment/VAT/discount allocations and source-lot restoration. Sale lifecycle remains completed with `void_state=partial` until all units/value cancelled; it then becomes voided. Digital, partially fulfilled and externally settled services never enter automatic stock-restoring void.

Under an approved partial policy, an earlier applied partial-void credit does not itself block a later void of the remaining held units; the shared cumulative entitlement must exclude already voided/returned/credited units and cap remaining value. Other prior return/refund credits continue to block ordinary void by default.

## B05 — Returns and refunds

Return intake locks original sale/items and validates cumulative accepted quantities, including damaged and inspection items: `physically_returned + voided_units <= sold_units`. Do not block physical return merely because payment status is fully refunded. Per-line dispositions: restockable, damaged, defective, unsellable, pending_inspection. Only restockable enters sellable location. Other physical goods enter quarantine with disposition metadata; final disposal is a separate negative quarantine movement. Inspection-to-restock is a paired location transfer, once. Service lines have no physical return.

An authorized accepted return creates its return commercial credit; a draft/pending inspection can reserve quantity without yet granting a credit, with acceptance/credit decision explicit. Refund is a separate action against approved credit and original captured amount, less prior confirmed/reserved refunds. Check both credit capacity and capture capacity under locks. Refund to original method by default; method change requires admin reason and external evidence. Cash refund uses current performing drawer/shift, not original employee's drawer. Noncash refund is pending until confirmation; unknown provider outcome is never automatically resent. An already refunded item can still be accepted physically with zero additional credit if the prior goodwill credit is explicitly allocated to it.

Example: 5 pieces at net PHP 10 each; return 2. Record 2 accepted returns and PHP 20 credit. Restockable: +2 sellable; damaged: +2 quarantine, +0 sellable. A later PHP 20 refund consumes credit; net billed remains PHP 30, net paid becomes PHP 30. Another return of 4 rejects. A payment-only PHP 5 goodwill refund has quantity zero and no stock movement.

## B06 — Inventory

Use one centralized private mutation service for all stock paths. Each nonzero balance delta has exactly one immutable movement, arithmetic `after=before+delta`, operation/source line identity, base units and location. Product/option stock values are projections, not separately editable balances. Movement categories: opening_baseline, sale_deduction, sale_void_restoration, return_restocking, damaged_return, supplier_restocking, manual_increase, manual_decrease, stock_correction, consignment_movement, transfer_in, transfer_out, offline_sync_adjustment, disposal. Zero-stock effects are dispositions/events, not fake zero-delta movement rows.

Manual stock decreases/corrections require a reason and independent approve_inventory_adjustment decision by default; a pending request does not change stock. Routine supplier receipts/increases retain existing inventory authority. Revalidate live quantity/version on application; stale approved proposal requires new review rather than silently changing the approved delta. Shared operational approval requests carry the immutable typed proposal and decision used by stock, cash and wallet adjustment commands.

Preserve original lot ownership/cost for sale reversal; use allocation slices, not a new anonymous restock lot. Track physical returned, restocked and void-restored quantities independently. `restocked + void_restored <= allocated`; physical-return + void bounds are checked at original sale-line level. A damaged return cannot later be void-restored as if goods had never left. Compensating corrections link the original movement; do not update/delete history. No note-prefix parsing in new paths.

`available = sellable_on_hand - active offline stock allocations - online reservations`. Never negative. Lock balance rows and source lots in deterministic order. Default one sellable and one quarantine location per store. Cross-store returns/transfers require explicit product/location mapping and remain disabled until D09 is resolved; same-product within-store transfers require paired movements with conserved quantity. Preserve PO-status-only receiving.

Opening baseline starts at the cutover balance, not at zero plus reconstructed historical movements. Do not add old movements to the baseline. Product timeline uses a visible cutover boundary and labels incomplete legacy provenance.

## B07 — Physical cash and closeout

Shift opening records opening counted cash, drawer, terminal, actor and server start before sale. One active/submitting shift per drawer and one per cashier/store; drawer handover is close-and-open. A positive opening amount is one positive physical movement; zero opening cash records custody with no cash-ledger row. Closing count is an observation with `cash_delta=0`, not a cash deposit.

Signed cash deltas: cash sale `+net cash tender (tendered-change)`; cash refund/void reversal negative; GCash cash-in `+(principal+fee)`; GCash cash-out `-principal`; add positive; remove/drop negative; approved adjustment signed. Noncash retail payments produce zero drawer delta. Each actual cash effect is posted once against an explicit current shift.

`expected = opening + sum(non-opening posted cash deltas)`; `variance = counted - expected`. Nonnegative available drawer cash is enforced for outgoing cash/reservations. Large adjustments and every negative variance require admin review by default; D06 defines optional thresholds later. Never erase a deficit to make closing pass; flag it. Balance-before/after and available cash are scoped to a shift, with its counted opening. A late old-shift fact changes that shift's reconciled expected cash only; it does not increase the current shift again when the current opening already included those physical funds. Opening rollover is custody, not sales income.

Close request freezes sequence watermark, movement IDs, financial fact IDs, totals, pending offline operation IDs and schema version in one snapshot. Shift moves open → closing_pending_sync → submitted; with no pending queue it can submit immediately. Admin may submit an exception closeout with enumerated unresolved items; never silently ignore them. Review events: pending → clarification_requested/flagged → resubmitted → approved. Approved totals are immutable. Clarification appends comments; a correction is a linked amendment snapshot/review, not a changed approved row.

Late offline cash physically belongs to its original shift. Post an append-only late movement attributed to that shift plus reconciliation adjustment linked to the frozen report. A later refund uses today's performing drawer, with reference to original sale/report. Both show original frozen totals and current reconciled totals without rewriting either.

## B08 — Digital service accounting

Initial release uses **manual external confirmation**. No authorized provider API, credentials or contract was found. Never invent one or automate consumer GCash UI. Existing GCash tender remains distinct from a GCash service.

Balances: load wallet, GCash wallet, physical drawer, and service clearing obligations are separate. New digital catalog entries are non-stock. Ordinary digital product price/cost is configured explicitly; no assumed commission. Do not fake high inventory for services.

| Service | Wallet posting | Physical cash | Retailer earning |
| --- | --- | --- | --- |
| E-load face A | load `-round(A*0.98,2)` | `+(A+explicit additional charge)` | `A-wallet_cost + additional charge` |
| GCash cash-in A, default | GCash `-A` | `+(A+round(A*0.03,2))` | fee only |
| GCash cash-out A, standard | GCash `+(A+fee)` | `-A` | fee only |

E-load examples: A=20 → cost19.60/profit0.40; 30→29.40/0.60; 50→49.00/1.00; 99→97.02/1.98; 500→490/10. Never credit commission back to load wallet. Define profit as face minus rounded deduction to conserve centavos (the displayed 2% examples all agree).

Standard cash-out fee: `A<50` unsupported; `50<=A<=100` PHP2; `A>100` PHP4. PHP500 → customer transfers504, wallet+504, drawer−500, earning4. Cash-in PHP100→cash103, wallet−100, earning3. A separately selected `percent_2` policy replaces the applicable standard/default fee: `round(A*0.02,2)`; it never stacks. Fee policy is snapshotted by version, service kind, effective dates, bounds, amount/rate and selection; overlapping ambiguous policies reject.

Before instructing external action, reserve required outgoing wallet/drawer amounts online. Holds are not posted balance movements. Cash-in/e-load normally collect cash first (post cash+service-clearing), then confirm external delivery (post wallet debit). Cash-out confirms wallet receipt first (post wallet credit+clearing), then confirms physical cash disbursement. Each independently observed step posts its own immutable events; completion/earning requires all required legs. Failure after one leg creates refund/delivery/reconciliation liability, not “failed with no effect.” Unknown outcome keeps holds and needs evidence; never automatically retry an external transfer.

Provider reference uniqueness: provider account + direction + normalized reference, across service kinds; nonblank for externally confirmed entries. Normalize surrounding whitespace only, preserve case/leading zeros, reject control characters and values over160 characters; provider-specific case folding requires explicit account policy. Reference correction is an admin reconciliation event, not overwriting the original. A duplicate reference with another operation conflicts, including a refund reusing a cash-in settlement. Manual attestation includes verifier, provider account, reference, external time, amount and evidence reference (no PIN/OTP/secrets). Earning posts exactly once on complete; confirmed external reversal posts compensating wallet/cash/earning/clearing entries for only legs actually reversed. Internal approval does not reverse external money or load delivery. Digital operations are online-only; offline UI may save a non-executable draft with no success/transfer instructions.

Retail accounting split: e-load bills face plus extra and recognizes discounted wallet cost; GCash services bill fee only, with principal reported as pass-through turnover/clearing. Cash-in103 allocates3 fee and100 principal; cash-out incoming504 allocates4 fee and500 principal. Complete service links its fee/retail payment to already observed cash/provider events and never posts a second collection/payout. An ordinary refund is capped at billed fee/retail amount; principal reversal uses the digital clearing workflow. Customer spending excludes GCash principal but includes load face/retail price and service fee. Statutory digital VAT/fiscal representation remains D05-gated; do not retrofit the existing fiscal receipt formatter without that approved specification.

## B09 — Offline authority and reconciliation

Foundation includes stable operation UUID, payload hash, original actor/terminal/shift, local time, server time and catalog/contract version for online/offline writes from the start. Ordered terminal sequence belongs to the physical checkout outbox after terminal enrollment; other operation kinds use their aggregate version and operation UUID. ID reuse with another payload is a conflict.

Safe offline scope: already authorized open-shift physical-product cash sales using preallocated product/lot stock. No new login, shift opening, approvals, refund/void/return, stock edits, wallet/digital or noncash-provider completion offline. A pre-issued server lease binds cashier, terminal, shift, permissions and stock allocations. Default maximum lease 8 hours and fresh catalog at issuance; expiry disables new local sales, preserves queue and holds for reconciliation. Browser clock is untrusted; server checks grant/sequence/capacity and flags implausible occurrence time. Offline cannot guarantee immediate revocation; disclose bounded authority and require D03 signoff.

Offline stock escrow is required to guarantee multi-terminal nonnegative availability: split sellable lots into terminal allocations online and subtract outstanding allocations from online availability. Local sales consume allocation once. On synchronization decrement on-hand and reduce allocation by the same quantity atomically, leaving online availability unchanged. Unused allocation release requires reconciled terminal sequence; **expiry alone never releases uncertain stock**. Lost-device allocation requires admin reconciliation of goods/cash before release. If the business rejects escrow, scope falls back to offline cart capture; do not promise fulfilled multi-terminal cash sales with guaranteed stock using stale caches.

Persist a sale/queue/terminal sequence and local allocation consumption in one IDB transaction **before** clearing cart or success. Result is “Recorded on this device — awaiting sync,” with provisional ID, never official receipt number. Local storage failure keeps cart and shows unsaved status. Sales retry same ID/body; no new IDs after uncertain timeout.

Queue states: local_pending → syncing → synchronized; transport errors → retry_wait; validation/stock/version mismatches → conflicted; authorization failures → blocked_auth; corruption/storage issues → needs_recovery. Persist attempts, next retry, last error, server acknowledgement and result; do not silently delete records. Automatic transient retry uses full-jitter exponential delay 1s–60s, honors server delay and stops hot looping; retry continues when app is open. Per-terminal sequence replay and cross-tab lease avoid client duplicates; database idempotency is authoritative. Synchronized summaries retained 30 days, sensitive payload purged only after verified ack and configured retention.

Use encrypted payload storage and a device unlock secret not stored beside ciphertext; no claim that a key in localStorage protects data. WebCrypto PBKDF2/AES-GCM device envelope is specified in architecture; PIN strength/recovery requires D03. Minimize offline PII, omit TIN/address by default. Same cashier reconnects before automatic replay; authorized supervisor recovery uses a separate audited RPC, never reassigns cashier. Server rejects revoked or invalid leases into a review path without dropping evidence.

## B10 — Customer metrics and printing

Customer identity is store-scoped UUID. Link optionally at checkout; guest and old unlinked sales remain unlinked, with aggregate guest totals separate. Do not merge by name/TIN/phone. Preserve receipt identity snapshots even if profile is changed/archived. Retroactive association is an audited link event and cannot rewrite receipt payload.

Customer net spending = sum canonical net billed in filtered original-sale period, excluding fully voided sales; net paid shown separately. Frequency/transaction count counts distinct confirmed sales with at least one nonvoided line; fully returned transactions remain historical visits, labeled as returned. Net quantity subtracts accepted returns/voided units; monetary-only refunds do not remove units. Recent activity uses last confirmed nonvoid sale; show return/refund dates separately. Ranking metric, period, timezone (Asia/Manila default), store and tie-break customer UUID are explicit; server keyset pagination. A separate cash-flow report dates refunds by posting date. Product rankings and customer rankings share facts but remain separate screens.

Shopping list is a nonfiscal document: “SHOPPING LIST — NOT A SALES RECEIPT.” Selected receiving quantity/unit; optional estimated unit price/subtotal; no receipt sequence, payment, tax invoice wording, sale write, stock write or drawer pulse. Reuse selected-item calculations; snapshot once per preview. Thermal profiles 58mm/32 columns, 80mm/48 columns only for compatible printer settings. Long text wraps and control characters/HTML are escaped. Browser acknowledges dialog opening; native agent acknowledges spool submission. Neither guarantees physical print. Disable active duplicate submissions, retain document/attempt ID, require explicit reprint after uncertain outcome. Never automatically reprint when a pending sale synchronizes.
