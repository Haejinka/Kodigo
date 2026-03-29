# KodiGo

**KodiGo** is a cloud-based Point-of-Sale (POS) and Inventory Management System designed specifically for high-volume *sari-sari* stores (small retail stores common in the Philippines). It focuses on rapid transaction processing, real-time inventory visibility, and accessible remote monitoring for store owners.

---

## Table of Contents

1. [Overview of the Application](#overview-of-the-application)
2. [Features and Functionality](#features-and-functionality)
3. [Setup and Installation Instructions](#setup-and-installation-instructions)
4. [System Architecture](#system-architecture)
5. [Usage Guidelines](#usage-guidelines)
6. [Known Issues or Limitations](#known-issues-or-limitations)

---

## Overview of the Application

KodiGo provides two main pillars of functionality based on user roles:
- **Cashier Mode:** Provides a clean, touch-and-scanner optimized POS interface operating at high speed. It avoids visual clutter, offering single-key transactions and hardware integrations like opening the cash drawer.
- **Admin / Owner Mode:** A full dashboard offering real-time data on daily revenue, transaction volume, low stock alerts, supplier metrics, and sales forecasting. 

The application is built to be resilient, lightning-fast on desktop/tablet interfaces, and seamlessly handles custom behaviors unique to sari-sari stores, such as buying products in bulk and selling them per-piece (e.g., cigarette packs vs. sticks).

---

## Features and Functionality

### Core Features
- **Point of Sale (POS):** Full-screen terminal featuring barcode scanner support (via USB/Bluetooth sequential keystrokes), cart management, adjustable quantities, auto-calculating tax and discount fields, and payment modal integration.
- **Hardware Integration:** Connects directly with EPS/POS receipt printers and RJ11 cash drawers explicitly from the browser using the Web Serial API.
- **Keyboard Optimization:** Keyboard-first transactional flow (e.g. `F2` for search, `Enter` to select product, `F9` for quick charge).
- **Inventory Management:** Full product catalog supporting SKUs, categorizations, minimal stock levels, and bulk unit conversion logic (e.g., buying in packs, tracking and selling in pieces).
- **Stock Auditing & Logs:** Logs for every stock adjustment categorized by reason (Restock, Damaged, Expired, Lost, Manual Count).
- **Dashboard & Analytics:** Real-time summary stat cards, daily revenue curves, top-ranked products, and pending restock alerts.
- **Restocking & Forecasting:** Intelligent algorithm suggesting restock quantities based on `reorderLevel * 2 - currentStock`. 
- **Supplier Scoring System:** Automatically grades suppliers on reliability (on-time deliveries) and pricing variations vs. market average.
- **Role-based Authentication & Admin Control:** Secure admin portal allowing users to create fully managed user accounts equipped with on-device (mocked) or database-supported password hashing out-the-gate. Admins manage all system settings, while cashiers face POS boundaries.

---

## Setup and Installation Instructions

The current build operates primarily on mock data stored within Zustand, preparing the grounds for full Supabase integration.

### Prerequisites
- Node.js (v18 or higher)
- npm or pnpm
- (Optional) A Supabase project for future deployment using `supabase_schema.sql`.

### Local Installation

1. **Clone the repository:**
   ```bash
   git clone <repository_url>
   cd "Kodigo v0.1.0"
   ```

2. **Navigate to the UI directory:**
   ```bash
   cd kodigo-ui
   ```

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Run the development server:**
   ```bash
   npm run dev
   ```

5. **Open your browser:** Visit `http://localhost:5173` to view the application.

---

## System Architecture

The application is structured into a modern Single-Page Application (SPA) architecture utilizing an external real-time Database Layer. 

### Tech Stack
- **Frontend Framework:** React 19 operating on Vite 7.
- **Styling:** Tailwind CSS v4, utilizing `@tailwindcss/vite` without additional PostCSS configurations.
- **UI & Icons:** Custom components styled leveraging `Radix UI` primitives. Icons by `Lucide React`.
- **State Management:** 
  - `Zustand v5` for global application state (currently housing the frontend mock databases).
  - `TanStack Query v5` prepared for handling asynchronous server states.
- **Routing:** React Router v7 for client-side navigation.
- **Backend (Target):** Supabase (PostgreSQL, Supabase Auth, and Supabase Realtime).

### Data Flow (Conceptual Framework)
The system receives inputs (`Sales Transactions`, `Inventory Adjustments`, `Supplier Data`) which are channeled through six Core System Engines:
1. **POS Engine** (Handles cart, cash drawer signals, stock requests)
2. **Inventory Engine** (Manages bulk conversions, thresholds)
3. **Analytics Engine** (Aggregates periods, calculates AOV, margin predictions)
4. **Supplier Scoring Engine** (Averages reliability index vs price index)
5. **Forecasting Engine** (Yields restock suggestions)
6. **Alert Engine** (Issues low-stock and out-of-stock notices)

These processes store records persistently in the **Supabase Data Layer** and project final summaries onto output nodes (Receipts, Dashboards, PO sheets).

---

## Usage Guidelines

### As an Admin
- Navigate through `/dashboard` to monitor overall sales in real-time.
- Go to **Inventory** to add new products correctly selecting whether they are bulk items (and declaring the correct conversion factors).
- Visit **Restocking** to view items that have triggered safe-minimum thresholds. You can spawn a Purchase Order (PO) natively from this screen.
- Manage **Suppliers** to keep track of their auto-computed grading, allowing you to favor higher-scoring suppliers.

### As a Cashier
- The default screen upon login is `/pos`. 
- **Selling flow:** Ensure focus is active (or use `F2`), type or scan barcode. The corresponding products enter the cart.
- You can change quantities inside the cart manually before checking out.
- Press `F9` or the `Charge` button, enter the cash sum given by the customer, then press `Enter` to confirm payment and visually spawn receipt tracking.
- Important: To successfully switch from Cashier to Admin, you must `Log Out` (top-right button) to terminate the current session context.

---

## Known Issues or Limitations

1. **Backend Integration (Phase 1 Incomplete):**
   - The UI is currently relying on Zustand-driven mock data mechanisms.
   - Live Supabase database wiring (writes, deletes, syncs) has deferred completion. Real writes are substituted by mock timeouts. Changes will not persist upon a full browser hard refresh.
2. **TypeScript Compilation Warnings:**
   - Minor structural warnings exist regarding unused imports in React Components under the `kodigo-ui/src/components` directory (e.g., `Topbar.tsx`, `Sidebar.tsx`).
3. **Hardware Constraints limitations:**
   - Web Serial API interactions for opening the cash drawer are restricted natively by modern browsers to secure local contexts (`localhost`) or HTTPS environments. It requires explicit user interaction gesture (a click) to trigger `navigator.serial`.
4. **Multi-Session Isolation:**
   - As data relies on Local/Memory state currently, simultaneous user usage across different devices will not synchronize. Realtime subscriptions via Supabase are required to solve this. 
