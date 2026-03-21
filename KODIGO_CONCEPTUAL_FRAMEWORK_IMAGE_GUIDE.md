# KodiGo — Conceptual Framework: AI Image Generation Guide

> **Purpose:** This document provides a precise, structured prompt and layout description for generating a high-quality conceptual framework diagram image for the KodiGo system. Use this with AI image generators (e.g., DALL·E, Midjourney, Adobe Firefly) or diagramming AI tools (e.g., Eraser.io, Napkin.ai, Whimsical AI).

---

## System Description (Context for the AI)

**KodiGo** is a cloud-based Point-of-Sale (POS) and Inventory Management System for small Philippine retail stores (sari-sari stores). It is a fully operational web application with a React/TypeScript frontend and a Supabase (PostgreSQL + Realtime) backend. It serves two user roles — Admin (store owner) and Cashier — through a role-based access system.

The conceptual framework shows **how data flows through the system** — from real-world inputs, through processing modules, to actionable outputs — with feedback loops that close the business cycle.

---

## Conceptual Framework Overview

The framework follows a **horizontal Input → Process → Output (IPO) model** divided into five horizontal bands/rows plus a persistent data layer at the bottom. It is read left-to-right, top-to-bottom.

---

## Framework Structure (Bands)

### Band 1 — ACTORS / USERS (Top Row)

Two distinct user role boxes positioned at the top center, separated from the main flow, connected downward by arrows into the processing layer.

| Box Label | Description |
|-----------|-------------|
| **Admin (Store Owner)** | Full access — all modules |
| **Cashier** | POS access only |

- Style: Rounded rectangles with a person/role icon.
- The Admin box has arrows pointing to ALL processing modules.
- The Cashier box has an arrow pointing ONLY to the POS Engine module.

---

### Band 2 — INPUTS (Left Column)

A vertical stack of input source boxes on the **left side**. Each box has an arrow pointing right into the Processing Layer.

| Input Node | Icon Suggestion |
|------------|----------------|
| **Sales Transactions** — Barcode scan, manual product search, quantity selection | Shopping cart / barcode icon |
| **Inventory Adjustments** — Restock, damaged, expired, lost, manual count | Box / clipboard icon |
| **Supplier Data** — Lead times, cost prices, purchase order outcomes (on-time / late) | Truck / handshake icon |
| **Authentication Events** — Login credentials, role assignment | Lock / key icon |

- Style: Rounded rectangles with a soft yellow or warm amber fill (#FFF3CD or similar).
- Label each with bold title and a 1-line description below it in smaller text.

---

### Band 3 — PROCESSING LAYER / CORE SYSTEM (Center — largest section)

The central, dominant block labeled **"KodiGo System"** at the top with a brand-colored header bar (deep slate blue or dark indigo, e.g., `#1E293B`). Inside this main block, show **six processing engine modules** arranged in a 2×3 grid of internal boxes.

| Engine Module | Core Function |
|---------------|--------------|
| **POS Engine** | Processes sales transactions; calculates totals, tax, discounts, change; deducts stock on confirm |
| **Inventory Engine** | Tracks stock levels in smallest sellable unit; handles bulk-split conversions; triggers alerts |
| **Analytics Engine** | Aggregates revenue, profit, transaction counts, AOV, and product rankings by period |
| **Supplier Scoring Engine** | Auto-computes Reliability Score (60%), Price Score (40%), and Overall Score per supplier |
| **Forecasting Engine** | Generates restock suggestions using formula: `max(reorderLevel × 2 − stock, reorderLevel)` |
| **Alert Engine** | Monitors stock thresholds; emits Low Stock, Critical Stock, and Out-of-Stock alerts in real time |

- Style: Each module is a white or light-gray rounded box inside the main system block.
- Draw thin connecting arrows between related modules (e.g., POS Engine → Inventory Engine → Alert Engine; Forecasting Engine → Supplier Scoring Engine).
- The system block should have a subtle drop shadow and a clearly visible outer border.

---

### Band 4 — DATA LAYER (Bottom of center block)

Directly beneath the Processing Layer (visually connected by a downward bracket or double-headed arrows), show a **persistent storage block** labeled **"Supabase Data Layer"**.

Inside it, show three sub-components in a horizontal row:

| Sub-component | Description |
|---------------|-------------|
| **PostgreSQL Database** | Products, Sales, Suppliers, Users, POs, Adjustments, Alerts |
| **Supabase Auth** | JWT-based session management; stores roles (admin / cashier) |
| **Supabase Realtime** | Pushes live updates to dashboard and alert surfaces (<1s latency) |

- Style: Dark slate or navy background with white text (#0F172A fill, white labels).
- Use a cylinder icon for the database, a shield icon for Auth, and a lightning bolt for Realtime.

---

### Band 5 — OUTPUTS (Right Column)

A vertical stack of output boxes on the **right side**, mirroring the input column. Each box has an arrow coming from the Processing Layer on the left.

| Output Node | Source Module | Icon Suggestion |
|-------------|--------------|----------------|
| **Sales Receipts** — Transaction ID, cashier name, itemized total, change | POS Engine | Receipt / printer icon |
| **Dashboard Metrics** — Today's revenue, transactions, AOV, profit with trend indicators | Analytics Engine | Chart / gauge icon |
| **Stock Alerts** — Real-time badges on sidebar, topbar, and dashboard panel | Alert Engine | Bell icon |
| **Purchase Orders** — Auto-assigned to best-scored supplier with status lifecycle | Forecasting Engine + Supplier Scoring Engine | Document / order icon |
| **Supplier Scorecards** — Reliability %, Price score, Overall score per supplier | Supplier Scoring Engine | Star / scorecard icon |
| **Analytics Reports** — Revenue trend, hourly sales, category breakdown, product rankings | Analytics Engine | Bar chart / pie icon |

- Style: Rounded rectangles with a soft green or teal fill (#D1FAE5 or `#ECFDF5`).
- Label each with bold title and a 1-line description below it.

---

### Feedback Loops (Curved Arrows Overlaying the Diagram)

Draw **three dashed curved arrows** in a distinct contrast color (orange or amber, e.g., `#F59E0B`) to show feedback:

1. **Stock Alerts → Inventory Adjustments** — Alert output curves back left to the Inventory Adjustment input, labeled *"Triggers restocking decision"*
2. **Supplier Scorecards → Supplier Data** — Scorecard output curves back left to the Supplier Data input, labeled *"Informs future PO assignment"*
3. **Analytics Reports → Sales Transactions** — Analytics output curves back left toward the Sales Transactions input (or toward the Admin user), labeled *"Guides pricing & promotions"*

---

## Visual Style Guide

| Property | Value |
|----------|-------|
| **Canvas** | White background, landscape orientation (16:9 or A4 landscape) |
| **Primary brand color** | Deep slate blue — `#1E293B` |
| **Input boxes** | Warm amber fill — `#FFF3CD`, dark text |
| **Output boxes** | Soft green fill — `#D1FAE5`, dark text |
| **Processing / System block** | White interior, slate blue header, light gray border |
| **Data layer block** | Dark navy — `#0F172A`, white text |
| **Feedback arrows** | Dashed, amber — `#F59E0B`, labeled |
| **Internal engine connections** | Thin solid gray arrows |
| **Font** | Clean sans-serif (Inter, Helvetica, or similar) |
| **Title** | Top center — "KodiGo Conceptual Framework" in large bold dark text with a thin subtitle line: *"Cloud-Based POS & Inventory Management System for Sari-Sari Stores"* |

---

## Suggested AI Image Prompt (for DALL·E / Firefly / Midjourney)

Use this as a direct prompt for AI image generation:

```
A clean, professional conceptual framework diagram for a cloud-based POS and inventory management system called KodiGo. The diagram uses a horizontal Input-Process-Output layout on a white background. On the far left, a vertical stack of four yellow rounded boxes labeled: "Sales Transactions", "Inventory Adjustments", "Supplier Data", and "Authentication Events", each with a small icon and a brief description. In the center, a large rounded system block with a dark slate blue header labeled "KodiGo System" containing six internal white module boxes in a 2x3 grid: "POS Engine", "Inventory Engine", "Analytics Engine", "Supplier Scoring Engine", "Forecasting Engine", and "Alert Engine". Below the system block, a dark navy horizontal bar labeled "Supabase Data Layer" with three sub-components: "PostgreSQL Database", "Supabase Auth", and "Supabase Realtime". On the far right, a vertical stack of six green rounded boxes labeled: "Sales Receipts", "Dashboard Metrics", "Stock Alerts", "Purchase Orders", "Supplier Scorecards", and "Analytics Reports". At the top center, two user role boxes labeled "Admin (Store Owner)" and "Cashier" connected by downward arrows into the system. Three dashed amber curved arrows show feedback loops connecting output boxes back to input boxes, labeled "Triggers restocking decision", "Informs future PO assignment", and "Guides pricing and promotions". The title at the top reads "KodiGo Conceptual Framework" in bold dark text. Clean, minimal, sans-serif font, flat design with soft shadows, light and professional color scheme.
```

---

## Suggested Tool-Specific Guidance

| Tool | Approach |
|------|---------|
| **Eraser.io (AI Diagram)** | Paste the Framework Structure section above as a plain-text prompt; select "System Architecture" or "Flow Diagram" type |
| **Napkin.ai** | Paste the full system description + band descriptions; it auto-generates flowcharts from prose |
| **Whimsical AI** | Use the band descriptions as structured input; ask for an IPO flowchart with feedback arrows |
| **Lucidchart AI** | Provide the module names and connections as bullet lists and use "Generate Diagram" |
| **DALL·E 3 / GPT-4o** | Use the verbatim AI Image Prompt section above |
| **Midjourney** | Append `--ar 16:9 --style raw --v 6` to the prompt and request "flat design infographic diagram" |

---

*End of KodiGo Conceptual Framework Image Guide*
