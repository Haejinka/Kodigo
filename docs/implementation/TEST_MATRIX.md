# Verification matrix

Planning baseline: existing Node unit suite **42/42 passed** and lint passed on 2026-11-10. No new tests exist yet; no database, browser, concurrency, .NET or hardware tests were executed for this plan. Each implementation task adds its own tests; the matrix is required coverage, not a claim of completion.

## Commands and environments

Run existing `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build` from `kodigo-ui`. Current `npm run test:integration` is opt-in and mutates Auth/data; use only an isolated Supabase project. Existing SQL tests also mutate synthetic fixtures inside transactions. Never run diagnostic root scripts or infer a production target from `.env`.

T01 introduces exact commands `npm run test:db:enhancements -- --case Txx` and `npm run test:e2e -- <test-file>`. The DB runner requires `RUN_ENHANCEMENT_DB_TESTS=true`, `KODIGO_TEST_DATABASE_URL`, explicit test-project identity and a production guard; it fails closed when absent. It uses psql with credentials through environment, ON_ERROR_STOP, an allowlisted SQL test path and rollback fixture cleanup. It must not print secrets. Task-specific SQL under `supabase/tests/enhancements/` uses real authenticated roles/claims, not only service-role bypass. Browser tests import existing `playwright/test` and use a dedicated test config/server; isolated integration auth is explicitly configured. Verify CLI/psql help/version during T00–T01 before using version-sensitive commands.

Native format checks: `npm run test:print-agent`. Browser/agent tests use mock transport and controlled print fixture; actual printer output is a separate signed-off hardware check. CI must distinguish skipped integration from passed integration. T58 adds cross-connection concurrency/property cases; T59 adds maintained E2E; T60 records deployment/reconciliation rehearsal.

## Scenario acceptance cases

| Case | Setup/action | Required expected result | Tasks / layer |
| --- | --- | --- | --- |
| V01 sale | 30 pieces; sell2 cases×12 and3 pieces | Stock3, one sale/receipt/capture, movement−27; correct historical conversion/COGS; cash tender−change once | T05,T06,T26; SQL/integration |
| V02 failed sale | Two lines; second insufficient/inactive/wrong store | No sale, payment, receipt, movement, lot consumption or cash posting committed | T06; SQL |
| V03 payload replay | Same operation ID/body in two connections; response lost | Same result, one set of effects; changed price/actor/body with same ID rejects | T02,T06,T53; concurrent |
| V04 product race | Stock1; two online terminals each sell1 | Exactly one succeeds, other clear insufficient stock; no negative balance/lots | T05,T58 |
| V05 mixed option race | Case/piece share stock; concurrent stock correction | Combined base requirement enforced, no lost adjustment; stale version rejects | T05,T06,T58 |
| V06 full void | Completed held goods, independent approver | Source quantity/lot restored once; cancellation credit and confirmed payment/cash reversal once; original receipt unchanged | T11–T14,T26 |
| V07 duplicate/rejected void | Replay approved ID; new void ID; reject request | Replay returns original; second restoration impossible; rejection has zero stock/money effect | T12,T13,T58 |
| V08 partial void | Flag off then enabled approved subset2/5 | Disabled rejects; enabled credit/restore2, remaining3; cumulative void+return<=5 | T15 |
| V09 void authority | Requester tries self-approve; unassigned supervisor; stale MFA | All denied in RPC and direct API; no facts posted | T03,T12,T59 |
| V10 external void | Digital delivered/noncash settled/closed shift | No internal instant reversal; pending external evidence or explicit denial; closed-sale adjustment path | T11,T13,T41 |
| V11 return2/5 | Accept2 restockable with historical discount | Return2, sellable+2, exact source lots, credit per net historical units, no automatic refund | T16–T19 |
| V12 damaged/defective | Accept2 damaged/defective/unsellable | Sellable+0, quarantine+2 or disposition receipt in original lot-location balance, no duplicate supplier receipt/payable, no sellable COGS recovery; later disposal separate | T19 |
| V13 inspection | Pending inspection2 then approve restock once | Reserved return entitlement, quarantine history; paired transfer−2/+2 once; repeated inspection rejects/replays | T17,T19 |
| V14 over/duplicate return | Two concurrent returns3 each on sale5 | At most5 total physical accepted/reserved; duplicate body same ID replays; duplicate line IDs reject | T17,T18,T58 |
| V15 return after refund | Sale fully financially refunded, goods still outstanding | Eligible physical intake allowed, no second financial credit/refund | T17,T21 |
| V16 financial refund | Refund full/partial with no goods | Approved credit+negative payment, no inventory movement, cumulative amount bounded | T20–T22 |
| V17 return then refund | PHP50 original, PHP20 credit then PHP20 confirmed refund | Net billed30 before and after refund; net paid50 then30; due20 then0; no double subtraction | T08,T21,T22,T45 |
| V18 cent residual | PHP1.00 net line split3 units; sequential returns | Cumulative0.33/0.67/1.00, no overcredit; VAT/discount sums exact; last residual deterministic | T08,T21,T58 |
| V19 refund race | Two requests reserve same credit/capture | Confirmed+reserved<=remaining; one request conflicts; no negative outgoing capacity | T21,T22,T58 |
| V20 noncash unknown | External refund request times out | No automatic resend or confirmed negative movement until evidence; holds retained; duplicate reference conflicts | T22,T41 |
| V21 opening/cash | Open500; cash sale100; card200; add50; drop20; cash refund10 | Expected620; noncash200 excluded; count615→variance−5; separate count observation delta0 | T24–T30 |
| V22 drawer collision | Two cashiers open same drawer; same cashier second drawer | Partial unique constraints/locks permit only one active custody record | T24,T58 |
| V23 cash insufficiency | Available100; cash-out/refund request101 | Rejected or pending funding before disbursement; no unauthorized negative drawer or duplicate hold | T25,T39 |
| V24 closeout concurrent | Checkout and submit at cutoff; two submit clicks | Each movement either before frozen watermark or explicit late adjustment; one initial closeout; no lost sale | T28,T58 |
| V25 admin review | Independent admin flags, clarifies, resubmits, approves | Comment/reviewer/time retained; own approval denied; approved hash/totals immutable | T29,T30,T59 |
| V26 late sync/refund | Offline sale arrives after exception closeout; refund tomorrow | Original snapshot byte/hash unchanged; linked amendment; original shift for late cash, today's shift for refund. Old cash already included in next counted opening is not added to current available again | T31,T53,T57 |
| V27 e-load | Faces20/30/50/99/500 | Costs19.60/29.40/49/97.02/490 and earnings.40/.60/1/1.98/10; no second wallet commission credit | T33,T37 |
| V28 cash-in | Principal100 default3% | Cash+103, GCash−100, earning3, billed fee3/principal turnover100; completion adds no second cash collection, no inventory | T36,T38 |
| V29 cash-out bands | Amounts49.99,50,100,100.01,500 | Default49.99 unsupported; fees2,2,4,4;500 wallet+504 cash−500 profit4; billed fee4, principal500 excluded from customer spending | T33,T39 |
| V30 alternate fee | Cash-in/out200 with percent_2 selected | Fee4 replaces default/flat; never adds both; snapshot unaffected by later policy change | T33,T38,T39 |
| V31 wallet shortage | Load wallet97.01 for load99; GCash99 for cash-in100 | Reserve/delivery blocked, no fake success or unauthorized negative balance | T34,T37,T38 |
| V32 digital partial failure | Cash-in cash103 taken but provider fails; cash-out incoming504 confirmed but payout uncertain | Observed leg retained, clearing liability/reconciliation visible, no completed earning until both legs; no blind retry | T36,T39,T41 |
| V33 digital duplicate | Same provider ref on new UUID; same UUID replay; parallel verification | One settlement/earning/cash effect per observed leg; reference collision visible | T36,T58 |
| V34 reversal | Completed load cannot be reversed externally; GCash partial reversal verified | Load internal undo denied; only proven reversed legs produce compensations; earned reversal once | T41 |
| V35 wallet reconciliation | Statement differs by5 | Difference visible in case, no automatic plug; approved adjustment with evidence separate | T35,T42 |
| V36 offline multi-terminal | On-hand10; grantA4, B3; online available3 | A consumes4, B3, online sells3; final on-hand0 and no negative/resold grant | T51–T54,T58 |
| V37 offline save failure | IDB quota/write abort before queue commit | No local-success message, cart intact, no allocation decrement unless entire local tx committed | T50,T55 |
| V38 sync interruptions | Crash before RPC, after commit before ack, after ack before UI | Same ID reconciles once; durable ack resumes without duplicate sale/movement/receipt | T53,T54,T58 |
| V39 concurrent replay | Two tabs, focus+online; lease runner crash | One runner optimization; server still dedupes even if both run; retry_wait recovers | T54 |
| V40 stale offline auth | Expired lease, revoked cashier, logout/new user | New sale disabled; queued evidence retained/encrypted; no silent reassignment; supervisor recovery audited | T51,T57 |
| V41 offline digital | Disconnect during digital form/retry | Draft only, no provider-success claim/automatic transfer; unknown prior result enters reconciliation | T40,T55 |
| V42 offline sequence/conflict | Gap, wrong hash, altered price, exhausted grant | Explicit conflict; pause that lane, other terminals continue; no discard/reprice already-collected cash | T53–T55 |
| V43 lost device | Lease expires with unacknowledged stock grant | Hold not automatically released; reconciliation proof required before reallocation | T52,T57 |
| V44 cold launch/update | Installed shell offline; incompatible new app while pending queue | Unlock bounded existing lease only; pinned compatible contract; no API response/PII cached in SW | T56 |
| V45 customer net | Customer50, return credit20/refund20, void another30 | Net billed30 once, paid30 once; void30 excluded; gross/visits separate; guest not merged | T43–T46 |
| V46 customer privacy | Other-store IDs/name collisions/archive/contact edit | RLS blocks foreign reads; no auto-merge; receipts retain original snapshot; pagination stable | T43,T44,T59 |
| V47 historical formats | Legacy gross lines, current net lines, ambiguous old void settlement | No blanket discount subtraction; unknown flagged; immutable receipt hashes unchanged | T08,T09,T60 |
| V48 consignment | Received10×cost5, sold3, return/void2 | Supplier payable remains50 less supplier payments; restored lots retain supplier/cost; sales profit corrected separately | T05,T19,T42 |
| V49 shopping layout | Selected long/Unicode/control names,58/80,prices off/on |32/48-column safe wrap; label nonreceipt; quantity/unit correct; HTML/ESC injection blocked; no receipt mutation | T47–T49 |
| V50 print failure | Agent offline/old, double-click, spool timeout, explicit reprint | One active attempt, honest status, browser fallback; no duplicate auto print or drawer pulse; explicit reprint only | T48,T49,T59 |
| V51 migrations | Empty DB + restored historical snapshot + partial deployment rerun | Same effective schema, backfill checkpoints, counts/hashes, no fabricated financial/stock events; flags off until valid | T00,T58,T60 |
| V52 access/bypass | Direct writes, old RPC signatures, PUBLIC/anon, fabricated actor | Rejected or same centralized checks; no API bypass of approval/shift/ledger requirements | T03,T06,T26,T58 |

## Invariant/property and concurrency strategy

Use deterministic seeded generation in existing Node runner (no property library required). Generate sale/return/credit/refund/void sequences and cent values; replay random duplicates and permute independent operations. Assert after each committed command: available stock>=0; every nonzero stock delta has one matching movement and source lot sum; post-cutover balance=baseline+subsequent deltas; projections match; accepted returns+void units<=sold; restocked+void-restored<=allocated; damaged returns add0 sellable; credits<=net entitlement; confirmed+reserved refunds<=capture/credit; cash/wallet balances equal initial plus signed movements and unauthorized negatives impossible; one earning per service leg; external reference unique; completed operation has every required fact; requester!=approver; same hash/UUID yields same result and one acknowledgement.

Cross-connection tests must use two real independent Postgres transactions with barriers, not sequential Promise mocks. Test product locks, return quantity, refund reservations, same-operation race, drawer opening and closeout watermark boundaries. After generated runs, issue reconciliation queries and retain seed/event log on failure without secrets/PII. Force errors after intermediate inserts to prove full rollback; simulate committed response loss rather than only request rejection.

Migration tests snapshot row counts, current stock/lot sums, receipt payload hashes, supplier obligations and financial classifications before and after. Approved closeout snapshot hashes must remain equal after late adjustments. Existing tests remain running; extend current v3-only integration coverage to v5 and verify older signatures cannot bypass the new contract. Pilot devices require manual paper/hardware and prolonged offline/recovery acceptance; CI success alone cannot certify them.
