# UI and interaction specifications

Use the existing Kodigo design: `kodigo-ui/src/index.css` semantic light/dark tokens, Inter text, Roboto Mono/tabular figures, blue primary, existing rounded cards, spacing and Lucide icons. Reuse shared Button/Badge/EmptyState/SearchInput/DataTable/ConfirmDialog/Toast, `layout/PageHeader` and Radix `components/ui/dialog.tsx`. Do not rewrite POS layout or product rankings. Route guards and server permission checks must agree.

## Global behavior

Every new data screen has skeleton/loading; meaningful empty text with permitted next action; retryable fetch error; permission-denied without sensitive cached data; offline/pending badges where relevant. Mutations disable only affected controls while running, preserve form on rejection, keep operation UUID for uncertain retries and display confirmed result only after server acknowledgement. Keyboard focus moves to dialog title/first invalid field; Escape closes safe forms but cannot silently discard a persisted cash operation. Numeric deltas use `+`/`−`, text and icons, not color alone. Before/after values include unit/location; money includes PHP/₱ and two decimals, never ambiguous thousands formatting.

All date filters display store timezone (default Asia/Manila). Detail timestamps can show local occurrence and server confirmation separately. Cursor pagination retains filters; empty page after filter change resets cursor. Detail links check record store and role rather than assuming a visible link authorizes read. Avoid displaying TIN/address in queues or rankings.

## POS and transaction detail

Existing files: `pages/POSPage.tsx`, `components/pos/PaymentModal.tsx`, `TransactionLifecyclePanel.tsx`, `Cart.tsx`, `ProductSearchPanel.tsx`, `stores/cartStore.ts`. Keep product/cart split, barcode behavior and F2/F9 shortcuts. Add compact top-bar shift, drawer, connection and queue indicators, with full labels available to assistive technology.

Payment preview shows net unit amounts, per-item discount, VAT-inclusive total, tender/change and optional customer. A local sale confirmation reads **“Recorded on this device — awaiting sync”** with provisional ID and pending count. A confirmed sale shows official receipt/reference. Do not show “Payment completed and saved” for queue-only success. Never automatically reprint after server sync. Stock/cash already recorded locally cannot be discarded by closing the confirmation.

Transaction detail tabs: Summary, Items, Payments, Returns/Credits, Stock movements, Activity. Header shows original receipt, immutable original total, current commercial net, net paid, refund due and separate return/refund/void states. Payment and credit rows link to their own evidence; a refund does not visually imply restock.

### Void request and independent approval

Cashier action is “Request void.” Eligibility response lists blocking reason (closed shift, previously returned, externally fulfilled, already voided) and eligible units. Full void default selects all eligible items; partial controls hidden unless store flag explicitly enabled. Require reason and held/unfulfilled-goods attestation; quote original net/tax/discount and stock to restore. Submit displays “Awaiting supervisor approval,” with no stock/cash change.

Admin/supervisor queue `/operations/voids` shows request date, cashier, original receipt, amount, reason, external settlement requirement and pending age. Detail has Approve/Reject, decision reason and evidence. Own request shows “Another authorized employee must review this request”; controls disabled and server rejects crafted call. External case offers “Record verified reversal” only to permitted reviewer; approval alone displays “Awaiting external reversal.” Applied detail shows approver/time, credit, payment reversal and exact restored source quantities. Rejected preserves reason; no effects.

### Return intake and refund

Separate “Record returned items” and “Refund payment” controls. Intake table: sold, previously physically returned, voided, reserved intake, eligible quantity; choose only returned quantity and disposition per line. Default no preselected full quantity and no blanket restock true. Explain “Restockable adds to sellable stock; damaged/inspection items remain unavailable.” Product service rows state “No physical stock return.” Fully refunded sales still permit eligible physical intake, with warning of prior credit and zero additional refund where appropriate.

Return review shows credit amount versus payment refund status. Pending inspection item has Inspect action and permitted disposition transition, location and reason. Moving from quarantine to sellable shows paired −/+ quantities. Refund dialog shows available approved credit, original tender, previously refunded/reserved amount, proposed method and performing drawer. Separate submit/approve/confirm settlement actions; uncertain provider response shows “Outcome unknown — check provider before retrying.” No automatic external resubmission button. Closed-sale refund explains that cash is recorded in current shift and prior closeout receives a linked adjustment.

## Inventory movement history

Extend InventoryPage's Adjustment Log tab into “Stock movements” using `inventory_movements`, preserving manual-adjustment access and existing filters. Reuse `StockAdjustmentLog` visual conventions, but remove arbitrary note-prefix hiding. New `InventoryMovementHistory` supports product/store/location/type/date/direction/automatic-manual/employee/source filters and server cursor pages (default50, max100).

Row/timeline: action label (“Customer purchase”, “Approved sale void”, “Return held for inspection”), signed base change, before→after, unit/location, actor/approver, occurred/confirmed time and source reference link. Expand reveals selling quantity × original package conversion, source lot ownership/supplier and operation ID; advanced metadata collapsed by default. Product drawer shows current sellable, reserved offline, online available and quarantine separately. Transaction detail shows only movements linked to that sale. Cutover banner distinguishes complete current history from legacy provenance.

Manual adjustment form shows current version/quantity, add/remove/count mode, proposed result and mandatory reason. If inventory changed while editing, return conflict with refreshed balance and preserve draft; require deliberate resubmit. Pending approval is labeled without changing stock. Restock form retains receiving-unit/package-price/cost precision workflow; PO “received” action still does not add stock automatically.

## Shift opening and cash movement

`ShiftOpenDialog` appears before supported checkout for drawer-enabled stores: cashier read-only, registered terminal, authorized drawer, opening counted amount and summary. Server collision says who currently holds the drawer, without exposing unrelated staff information. Changing drawer/store requires close/handover; cannot move active shift by editing local selection.

Cash movement panel: running expected balance, last movement, “Add cash”, “Remove cash”, “Cash drop”, “Request adjustment”. Every form has amount/reason, approval requirement, before/after and confirmation. Outflow beyond available balance rejects before confirmation and server rechecks. Noncash tender shows no drawer receipt. Hardware “open drawer” remains an operational device action, not a cash balance event.

Cash history has type, signed amount, reason, actor/approver, reference, sequence and time. Opening is explicitly identified; closing count is an observation row, not green incoming cash. Pending digital/refund holds show available cash separately from expected posted cash.

## Closeout and administrator review

Cashier `/pos` close shift wizard: stop new sales → list pending offline/provider operations → count cash → preview snapshot → submit. Opening amount is locked from shift start. Summary includes required opening/cash/noncash/refunds/GCash principal+fees/movements/voids/returns/discounts/gross+net/expected/counted/variance/earnings. Display net billed and net paid distinctly. A negative variance prompts explanation and admin review; never auto-create cash adjustment.

Pending local work blocks normal final submit and offers sync/recovery; authorized exception submission enumerates unresolved operations. Once submitted, show snapshot version, watermark and “Submitted — awaiting review.” Count corrections use a new amendment/clarification, not inline editing an approved report.

Admin `/operations/closeouts` queue tabs Pending, Flagged, Clarification, Approved; filters cashier/drawer/date/variance. Review view compares frozen transaction totals to movement ledger, highlights missing/late entries, lists evidence and comments. Actions Approve, Flag, Request clarification require comment where applicable; own closeout cannot be approved. Review history has employee/timestamp/state. Late additions display columns “Original submitted”, “Adjustments”, “Reconciled”, with links and separate approval; original card never changes.

## Digital services and wallets

Add POS selection mode “Products / Digital services” without replacing physical search. Digital services are visibly online-required. Choose Digital product, E-load, GCash cash-in/out. Form: service, provider account (masked), optional customer/recipient minimum, principal, selectable fee policy, fee, customer pays/receives, wallet effect, cash effect and earning. Explicit one-policy summary prevents stacked fees. Only authorized staff can change configured policy; immutable quote after reserve.

Manual processing steps are visible: Reserve funds → Collect cash / Verify incoming transfer → Record external delivery/reference → Confirm physical cash exchange where required → Completed. Highlight exact amount and direction; cash-out PHP500 example shows wallet+504, cash−500, fee4. E-load PHP99 shows load wallet−97.02, cash+99, earning1.98 and no second commission credit.

No “Success” before required legs. Duplicate reference, insufficient wallet/drawer, mismatched amount, expired policy, unknown provider outcome and interrupted flow retain entered data and provide reconciliation link. Unknown outcome disables repeat transfer; allowed actions are check evidence/escalate/record verified result. Offline form can save a draft marked “No transfer performed”; it cannot reserve/confirm.

Admin `/operations/wallets` shows separate load/GCash accounts, posted/reserved/available, movements, provider references and reconciliation statements. Topup/withdraw/adjustment requires source/destination/reason and independent approval when required. `/operations/reconciliation` lists unresolved wallet/cash/provider/legacy cases; recording statement difference never silently changes wallet. Earnings reports show principal turnover, fees, load cost/commission, refunds/reversals, net earning and unsettled clearing separately.

## Customer screens

Store-scoped `/customers` list/search with cursor pages; create minimal name and optional contact, no forced PII for checkout. Checkout customer selector has explicit Guest default, recent/search/create actions and clear selected identity. Preserve sale receipt snapshots; later customer edits change profile only. Access-denied after store/role change clears cached details.

Customer detail: profile, gross billed, discounts, net billed, net paid, refunds due; dated transaction history with quantity/net line values, credit/refund/return/void badges and source links; most purchased by net base units. Date basis shown. Archived customer history remains accessible to authorized viewers with minimal contact. No inferred matching old sales.

`/customers/rankings`: metric dropdown Net spending / Purchase frequency / Transaction count / Net quantity / Recent purchase; store/date filters, deterministic ties and cursor paging. Guest aggregate in separate card; never rank all guests as a real customer. Keep `/rankings` product rankings unchanged. Commercial net ranking can differ from cash collected; concise explanation links to metric definition.

## Shopping-list print

Keep RestockingPage selection and existing text download. Add “Preview shopping list” opening separate nonreceipt dialog. Controls: paper58/80, show prices yes/no, printer/browser selection; estimated cost label when source cost is estimated. Snapshot selection at preview; later edits require explicit Refresh preview/new document ID.

Preview shows SHOPPING LIST — NOT A SALES RECEIPT, date/store, long-name wrapping, receiving quantity/unit, optional estimated unit/subtotal/total. No receipt number or fiscal invoice block. Print disables while active, reuses document/attempt IDs and never pulses drawer. Paired agent absent/old/unreachable gives install/update guidance plus browser fallback; no forced new printer subsystem. Show “Submitted to Windows” or “Print dialog opened.” Ambiguous submission gives explicit “Check printer, then Reprint if needed”; do not auto-retry physical printing. Receipt layouts/tests remain unchanged.

## Synchronization queue and recovery

POS badge counts pending/blocked separately; click opens `SyncQueuePanel` with local ID, local/server time, cashier, shift, amount, state, attempts, last error, next retry and server receipt after ack. Tabs Pending, Synchronized, Failed/Conflicted, Recovery. New cashier cannot inspect prior employee's encrypted payload. Active original cashier can unlock and retry safe network failures; supervisor recovery requires current authority and separate attribution.

Storage quota/corruption means “Sale not saved” and cart remains; no false success. Offline allocation/cash authorization exhausted disables completion and explains reconnect requirement. Lease expiry stops new sales, preserves work. Stale catalog displays cached-at time and allowed scope. Recovery export is encrypted with confirmation of retained local data; delete is unavailable for unacknowledged cash operations. Approved resolution records outcome/evidence without overwriting original payload. Offline cold launch after prior installation is tested separately from an already open session; no fresh login offline.
