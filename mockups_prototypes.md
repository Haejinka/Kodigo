# Mock-ups and Prototypes — Required Screenshots for KodiGo

This document lists the exact screenshots to capture for the "Mock-ups and Prototypes" section of the KodiGo research paper. Each screenshot entry includes: Title, Procedure, Visual Elements to Highlight, Validation Logic, and User Flow Placement. The list is organized by User Journeys and includes an Edge Cases / Error Handling section.

Summary: Capture 16 primary screenshots (one per page) plus error-case screenshots as needed. Sixteen pages provide comprehensive coverage and falls within the 10–20 page requirement.

**System Details (inferred from repository)**

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, Radix UI components, Zustand (local state), TanStack React Query (data fetching), Recharts (charts), `idb` (IndexedDB) for offline persistence.
- **Backend / Services:** Supabase (Postgres) for auth, database, storage and real-time subscriptions. Server-side constraints and RLS enforce data integrity and RBAC.
- **Core Features:** Real-time stock updates, Receipt generation and printing, User roles and RBAC, Offline sync and conflict resolution, Multi-store support, Audit logging.

---

## User Journeys

### **Sales Clerk Journey**

1) Title: Login Page

- Procedure: Navigate to the application root (open `/login` or start the app). Enter credentials and submit the login form.
- Visual Elements to Highlight: username/email field, password field, "Log in" button, brand/logo, "Forgot password" link, error banner area.
- Validation Logic: Client-side required-field checks; password minimum length enforced client-side; authentication performed via Supabase auth — server returns specific error codes (invalid credentials, disabled account) and the UI maps these to human-readable banners. Button disabled while authentication request is pending.
- User Flow Placement: On success redirect to Dashboard; on failure remain on Login showing error and suggestions.

2) Title: Dashboard — Sales Overview

- Procedure: After login the app lands on the Dashboard (default route). Alternatively, select "Dashboard" from the navigation.
- Visual Elements to Highlight: Sales summary cards (Today, MTD), quick-actions (Start New Sale), recent transactions table, low-stock alerts, realtime indicator, store selector.
- Validation Logic: Dashboard queries are fetched via React Query; empty states and loading spinners handled client-side. Protected route checks redirect unauthenticated users back to Login. Realtime updates via Supabase subscriptions update the cards and listings.
- User Flow Placement: Click "Start New Sale" or the POS tile to open the POS Terminal; click chart cards to jump to Reports.

3) Title: POS Terminal — Main Screen

- Procedure: From Dashboard click "POS" or use main navigation to open the POS Terminal.
- Visual Elements to Highlight: Product search bar (or barcode input), cart table (line items, qty, price), quantity increment/decrement controls, subtotal/tax/total panel, payment/checkout button, customer lookup, active discounts badge.
- Validation Logic: Adding items validates quantity > 0. When adding an item, the client checks cached stock and shows warnings if requested quantity exceeds stock. Offline mode allows local cart persistence to IndexedDB and displays an offline indicator. Price fields are validated for numeric values and ranges.
- User Flow Placement: Add items → modify cart → proceed to Checkout/Payment modal.

4) Title: POS — Product Search / SKU / Scanner Result

- Procedure: In the POS search bar type a SKU, product name, or scan a barcode. Select a result from the autocomplete list.
- Visual Elements to Highlight: Search input, autosuggest list, product cards with stock badges, category/supplier filters, no-results state.
- Validation Logic: Search performs client-side debouncing and server-side queries; minimum character threshold for suggestions; results prioritized by in-stock status. No-results displays a CTA to create a new product (admin-only).
- User Flow Placement: Selecting a product adds it to the cart (stays in POS) or opens the product detail modal for adjustments.

5) Title: POS — Checkout / Payment Modal

- Procedure: Click the Checkout/Pay button on the POS main screen to open the payment modal.
- Visual Elements to Highlight: Payment method selector (Cash/Card/Account), amount tendered input, change due display, receipt preview area, apply discount controls, confirm payment button.
- Validation Logic: For cash payments, `tendered >= total` validation unless store supports IOUs; card payments require successful tokenization and gateway confirmation; required payment method selected; duplicate transaction prevention (idempotency token). UI shows inline errors and disables confirm while processing.
- User Flow Placement: On successful payment show Receipt Preview; on failure show payment error modal with retry options.

6) Title: Receipt Preview & Print / Email

- Procedure: After a successful payment the receipt panel opens. Optionally click Print or Email receipt.
- Visual Elements to Highlight: Store header, line items, totals, tax breakdown, payment method, transaction id, timestamp, print/email buttons, QR/digital receipt indicator.
- Validation Logic: Receipt rendering is deterministic from cart data; totals are computed client-side and verified by backend. Printing triggers browser print; email triggers server dispatch and presents success/failure toast.
- User Flow Placement: After printing/emailing, return to POS main or start a new sale.

7) Title: Cart Management — Discounts, Price Overrides

- Procedure: Select a cart line item and open options (discount, price override, remove).
- Visual Elements to Highlight: Discount input (percent or fixed), price override input, reason field, manager approval prompt for overrides, confirm/cancel buttons.
- Validation Logic: Discounts limited to <=100% and not negative; price override checks threshold — overrides above configured threshold require manager authentication (prompted via modal). All changes update totals immediately and are reconciled by backend on save.
- User Flow Placement: After adjustment, totals update and user proceeds to Checkout.

---

### **Admin / Manager Journey**

8) Title: Inventory — Product List (Table View)

- Procedure: From navigation select Inventory → Products.
- Visual Elements to Highlight: Table columns (SKU, Product Name, Category, Supplier, Stock on Hand, Reorder Level), search and filters, bulk action checkboxes, pagination controls, "Add Product" button, low-stock badges.
- Validation Logic: Table queries accept filters and pagination parameters; RBAC enforced (only users with inventory permissions can access). Bulk delete or update confirmations require explicit confirmation.
- User Flow Placement: Click "Add Product" to open Add Product form; click a row to edit product details.

9) Title: Inventory — Add Product Form

- Procedure: Click "Add Product" from the Inventory page.
- Visual Elements to Highlight: Fields: Name, SKU, Category, Supplier dropdown, Cost, Price, Tax, Reorder Threshold, Image upload, Save/Cancel buttons, inline validation messages.
- Validation Logic: Required fields: Name, SKU, Price. Price must be > 0; Cost must be >= 0 and typically <= Price (business rule enforced server-side). SKU uniqueness validated server-side (Supabase unique index) and surfaced to UI. Image file type and size validated on client; server-side storage errors handled and displayed.
- User Flow Placement: On successful save, redirect to product detail or return to Product List with success toast and updated stock badge.

10) Title: Inventory — Edit Product & Conflict Detection

- Procedure: From Product List open an existing product for editing.
- Visual Elements to Highlight: Pre-populated form, `updated_at` or version indicator (if visible), change-history link, Save and Cancel, Delete action.
- Validation Logic: Same business rules as Add Product. On save, if `updated_at` differs from server value (concurrent edit), show conflict modal with options: keep local, accept remote, or merge. Server rejects conflicting updates if optimistic locking used.
- User Flow Placement: Resolve conflict -> save -> invalidate caches so inventory list reflects latest state.

11) Title: Suppliers — Supplier Detail

- Procedure: Navigate to Suppliers and select a supplier from the list.
- Visual Elements to Highlight: Contact information, list of supplied products, performance metrics (lead time, fill rate), recent purchase orders, "Create Purchase Order" button.
- Validation Logic: Supplier contact fields validated for format; deletion blocked if active products exist; create-PO flow validates product availability and supplier terms.
- User Flow Placement: Click "Create Purchase Order" to open PO workflow (noted in Inventory).

12) Title: Reports — Sales Analytics Dashboard

- Procedure: Select Reports → Sales Analytics.
- Visual Elements to Highlight: Time-range selector, sales-by-day chart, top-selling products chart, filters (store, user, category), export CSV button, comparison toggle (period over period).
- Validation Logic: Date range constraints (max interval), RBAC checks for report access, charts gracefully render empty data. Backend aggregates compute totals; cache keys include filter parameters.
- User Flow Placement: Drill down on a product to open Product Sales Detail and link back to Inventory.

13) Title: Settings — User Management & Roles

- Procedure: Settings → Users / Access Control.
- Visual Elements to Highlight: User list, role badges, invite button, role-edit modal, last-login timestamp, active sessions indicator.
- Validation Logic: Role assignment validated server-side and enforced by RLS. Cannot remove last super-admin; changes recorded in audit log. Invitation links expire and are validated on use.
- User Flow Placement: After role change the affected user's available navigation is updated on next session or via token invalidation.

14) Title: Settings — Store Configuration / Multi-store

- Procedure: Settings → Stores.
- Visual Elements to Highlight: Store list with address, timezone, currency, default tax rates, active toggle, "Switch Store" control, add/edit store modal.
- Validation Logic: Currency and timezone inputs validated against allowed values; only permitted roles can add or modify stores; changing default store updates POS and Dashboard context.
- User Flow Placement: Switch store -> Dashboard and POS context refresh to reflect selected store.

15) Title: Audit Log / Transaction History

- Procedure: Reports → Audit Log (or Settings → Audit).
- Visual Elements to Highlight: Chronological table with actor, action, resource, timestamp, search and filter controls, export option.
- Validation Logic: Audit events are immutable; server-side enforces append-only semantics; UI paginates results. Access restricted by role.
- User Flow Placement: Click entry -> open modal with full payload and links to associated resources.

16) Title: Offline Sync Status & Conflict Resolution

- Procedure: Work offline (disable network), perform operations (sales, product edits) then re-enable network and inspect Sync UI / status indicator.
- Visual Elements to Highlight: Offline indicator (banner or icon), queued operations list, sync progress, conflict dialog showing local vs remote values, resolution actions (Accept Local/Accept Remote/Merge), retry/backoff indicator.
- Validation Logic: Sync engine uses timestamps/operation logs to detect conflicts; conflict detection algorithm compares `updated_at` and operation type. Retried operations use exponential backoff. UI blocks destructive resolution actions to authorized roles only.
- User Flow Placement: Resolve conflicts -> operations replay to server -> inventory and reports updated on success.

---

## Edge Cases & Error Handling (screenshots)

Capture these additional images to document error handling and validation behavior. These can be presented as a short sequence or appended as supplementary pages.

- A) Login Failure — Invalid credentials banner and suggested remedial actions.
- B) Add Product Validation Error — Inline validation under Price or SKU (price <= 0 or missing SKU).
- C) POS Add-to-Cart — Out-of-stock warning modal when attempting to add beyond stock.
- D) Payment Failure — Card declined modal showing gateway code and retry options.
- E) Permission Denied — Attempt to access Settings as Clerk shows restricted access screen.
- F) Sync Conflict — Conflict resolution modal showing differing stock quantities and resolution controls.
- G) Concurrent Edit Conflict — Save attempt returns conflict; show merge/resolution UI.

---

## Appendix — Capture & annotation guidelines

- Capture resolution: prefer 1920×1080 (desktop) — crop only when focusing on component-level screenshots.
- Use numbered callouts (1–6) per screenshot to reference elements listed under "Visual Elements to Highlight" in the figure caption.
- Use consistent file naming: `01_Login.png`, `02_Dashboard.png`, …, `16_Offline_Sync.png` and `Error_A_LoginFailure.png`, etc.
- Each screenshot page in the paper should include: full screenshot, 3–6 annotations, 1-paragraph caption explaining validation and a short note describing the prototype transition (what user does next).

---

## Notes and assumptions

- Tech stack and features inferred from `kodigo-ui/package.json` and project layout; adjust validation specifics if your backend rules differ.
- The Validation Logic entries differentiate client-side form checks from authoritative server-side checks (Supabase/Postgres). Mention in the paper that server-side RLS and constraints provide the final validation layer.

---

If you want, I can also generate a PowerPoint (PPTX) or PDF with placeholders for each screenshot (annotated callouts and captions). Tell me which format you prefer.
