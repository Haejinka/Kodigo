# Mockups and Prototype Screenshot Guide

Updated: 2026-04-29

This guide lists the screenshots that match the current KodiGo implementation. It is intended for research-paper or validation documentation, not as a future-feature wishlist.

## Capture Preconditions

- Run the frontend from `kodigo-ui/` with `npm run dev`.
- Use a Supabase project with migrations applied through `migration_17_add_suppliers_updated_at.sql`.
- Prepare one `admin`, one `cashier`, and one `super_admin` account.
- Prepare at least one store with products, categories, suppliers, and sample sales if analytics screenshots need populated states.
- Use desktop viewport for admin screens and POS unless specifically capturing responsive behavior.

## Primary Screenshots

### 1. Login

- Route: `/login`
- Capture: email field, password field, sign-in action, error area, registration link.
- Validate: invalid credentials display an error; valid users redirect by role.

### 2. Registration With Invite Code

- Route: `/register`
- Capture: full name, email, password, invite-code field, success state.
- Validate: invite code is required for owner/admin registration.

### 3. Super Admin Portal

- Route: `/super-admin`
- Capture: invite-code generator, generated-code panel, generated-code table.
- Validate: only `super_admin` reaches this route.

### 4. Dashboard

- Route: `/dashboard`
- Capture: revenue, transactions, average order value, profit cards, stock alerts, top products by stock, recent transactions.
- Validate: data changes with active store selection.

### 5. POS Main Screen

- Route: `/pos`
- Capture: POS topbar, active store, cashier name, search/product area, cart panel, charge button.
- Validate: route requires a specific active store; `all` store view shows a blocking message.

### 6. POS Scanner/Search Result

- Route: `/pos`
- Capture: product search results after typing name, SKU, or scanning barcode.
- Validate: selecting or scanning a product adds it to the cart.

### 7. POS Pending Quantity

- Route: `/pos`
- Capture: numeric pre-entry indicator in the topbar and item added with multiplier.
- Validate: typed digits set the pending quantity; scanner input clears leaked digits.

### 8. POS Payment Modal

- Route: `/pos`
- Capture: order summary, cash received field, quick cash amounts, change display, confirm button.
- Validate: confirm is disabled until cash received covers the total.

### 9. POS Payment Success

- Route: `/pos`
- Capture: successful payment screen, transaction ID, cashier, timestamp, change, new transaction action.
- Validate: cart clears when starting a new transaction.

### 10. Inventory List

- Route: `/inventory`
- Capture: product table, search/filter controls, stock status badges, action buttons.
- Validate: products are scoped to the active store or shown in admin aggregation view.

### 11. Add or Edit Product

- Routes: `/inventory/products/new`, `/inventory/products/:id`
- Capture: product fields, category selection, pricing, stock thresholds, supplier selection, margin preview.
- Validate: required fields and store/category IDs are enforced.

### 12. Stock Adjustment

- Route: product edit or inventory action that opens the adjustment modal.
- Capture: reason selector, quantity delta, note field, before/after preview.
- Validate: stock cannot become negative; adjustment log records the change.

### 13. Restocking

- Route: `/restocking`
- Capture: products below reorder thresholds, suggested quantity, selected restock items, create PO action.
- Validate: generated POs group items by supplier/store.

### 14. Suppliers

- Route: `/suppliers`
- Capture: supplier table, scores, contact info, add/edit/delete actions.
- Validate: supplier CRUD is scoped to active store.

### 15. Supplier Detail and Purchase Orders

- Route: `/suppliers/:id`
- Capture: supplier profile, score cards, purchase order history, receive/cancel actions.
- Validate: marking a PO received refreshes supplier score data after backend triggers run.

### 16. Analytics

- Route: `/analytics`
- Capture: period selector, revenue chart, hourly sales chart, category chart, transaction list.
- Validate: changing period updates charts and stats.

### 17. Product Rankings

- Route: `/rankings`
- Capture: ranked products by units sold/revenue and period controls.
- Validate: rankings are derived from sale items.

### 18. Settings - Stores

- Route: `/settings`
- Capture: assigned stores, edit/delete controls, add-store form.
- Validate: `admin` can create/update/delete assigned stores; final policies should keep `super_admin` out of store CRUD.

### 19. Settings - User Management Scaffold

- Route: `/settings/users`
- Capture: empty or local user list, invite/create user modal.
- Validate: document this as a UI scaffold only; it is not wired to Supabase Auth admin APIs.

### 20. Settings - Security Scaffold

- Route: `/settings/security`
- Capture: current password, new password, confirm password fields.
- Validate: document this as placeholder UI until Supabase password update is wired.

## Edge Case Screenshots

- Unauthenticated route redirect to login.
- Cashier blocked from admin page.
- Super admin blocked from normal admin shell.
- POS with active store set to `all`.
- Offline POS sale queued, if browser devtools can show IndexedDB state.
- Empty inventory/suppliers/analytics states.
- RLS or permission error toast during a forbidden write.

## Annotation Notes

- Label screenshots by role and active store.
- Do not annotate future features that are not present in the current UI.
- Call out scaffolds honestly: user management and password changes are placeholders.
- If screenshots are used in academic documentation, state that Supabase migrations must be applied for backend behavior to match the UI.
