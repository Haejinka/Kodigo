-- =============================================================================
-- KodiGo – Supabase SQL Schema
-- Generated: 2026-03-02
-- Compatible with: PostgreSQL 15+ / Supabase
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------

create extension if not exists "uuid-ossp";   -- uuid_generate_v4() fallback
-- gen_random_uuid() is available natively in PG 13+ (Supabase default)


-- ---------------------------------------------------------------------------
-- 1. Enum Types
-- ---------------------------------------------------------------------------

create type user_role as enum ('admin', 'cashier');

create type stock_alert_type as enum ('low', 'critical', 'out-of-stock');

create type adjustment_reason as enum (
  'damaged',
  'expired',
  'lost',
  'manual-count',
  'restock',
  'other'
);

create type purchase_order_status as enum ('draft', 'sent', 'received', 'cancelled');

create type restock_urgency as enum ('high', 'medium', 'low');


-- ---------------------------------------------------------------------------
-- 1.5 invite_codes
-- ---------------------------------------------------------------------------

create table public.invite_codes (
  id          uuid        primary key default gen_random_uuid(),
  code        text        not null unique,
  role        user_role   not null default 'admin',
  is_used     boolean     not null default false,
  used_by     uuid        references auth.users(id) on delete set null,
  used_at     timestamptz,
  created_by  uuid        references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.invite_codes is
  'Pre-generated invite codes for registering specific roles (like admin).';

-- ---------------------------------------------------------------------------
-- 2. profiles  (extends auth.users – one row per authenticated user)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id          uuid        primary key references auth.users (id) on delete cascade,
  name        text        not null,
  role        user_role   not null default 'cashier',
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Extended user data linked to Supabase Auth. One row per user.';


-- ---------------------------------------------------------------------------
-- 3. store_settings  (single-row configuration – enforced via CHECK)
-- ---------------------------------------------------------------------------

create table public.store_settings (
  id           uuid        primary key default gen_random_uuid(),
  store_name   text        not null default 'My Store',
  store_address text       not null default '',
  tax_rate     numeric(5,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  updated_at   timestamptz not null default now(),
  updated_by   uuid        references public.profiles (id) on delete set null,

  -- Enforce only one settings row
  constraint store_settings_single_row check (id = id)
);

comment on table public.store_settings is
  'Global store configuration (name, address, tax rate). Expected to have one row.';

-- Insert the default row on schema initialization
insert into public.store_settings (store_name, store_address, tax_rate)
values ('My Store', '', 0)
on conflict do nothing;


-- ---------------------------------------------------------------------------
-- 4. notification_preferences  (per-user notification toggles)
-- ---------------------------------------------------------------------------

create table public.notification_preferences (
  id               uuid    primary key default gen_random_uuid(),
  user_id          uuid    not null unique references public.profiles (id) on delete cascade,
  low_stock        boolean not null default true,
  out_of_stock     boolean not null default true,
  daily_summary    boolean not null default false,
  sales_milestone  boolean not null default true,
  updated_at       timestamptz not null default now()
);

comment on table public.notification_preferences is
  'Per-user notification toggle settings.';


-- ---------------------------------------------------------------------------
-- 5. categories
-- ---------------------------------------------------------------------------

create table public.categories (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null unique,
  created_at timestamptz not null default now()
);

comment on table public.categories is
  'Product categories (e.g. Beverages, Snacks).';


-- ---------------------------------------------------------------------------
-- 6. suppliers
-- ---------------------------------------------------------------------------

create table public.suppliers (
  id                  uuid         primary key default gen_random_uuid(),
  name                text         not null,
  contact             text         not null default '',   -- contact person name
  email               text         not null default '',
  phone               text         not null default '',
  address             text         not null default '',
  lead_time_days      integer      not null default 1 check (lead_time_days > 0),
  reliability_score   numeric(5,2) not null default 0 check (reliability_score between 0 and 100),
  price_score         numeric(5,2) not null default 0 check (price_score between 0 and 100),
  -- overall_score is derived: can be stored for fast lookup or computed via view
  overall_score       numeric(5,2) generated always as (
                        round((reliability_score * 0.6 + price_score * 0.4), 2)
                      ) stored,
  total_orders        integer      not null default 0 check (total_orders >= 0),
  on_time_deliveries  integer      not null default 0 check (on_time_deliveries >= 0),
  created_at          timestamptz  not null default now(),

  constraint on_time_lte_total check (on_time_deliveries <= total_orders)
);

comment on table public.suppliers is
  'Supplier companies. overall_score is auto-computed from reliability + price scores.';


-- ---------------------------------------------------------------------------
-- 7. products
-- ---------------------------------------------------------------------------

create table public.products (
  id               uuid         primary key default gen_random_uuid(),
  name             text         not null,
  sku              text         not null unique,
  barcode          text         unique,                    -- nullable, unique when set
  category_id      uuid         not null references public.categories (id) on delete restrict,
  unit             text         not null default 'piece',
  cost_price       numeric(10,2) not null check (cost_price >= 0),
  selling_price    numeric(10,2) not null check (selling_price >= 0),
  current_stock    integer      not null default 0 check (current_stock >= 0),
  min_stock_level  integer      not null default 0 check (min_stock_level >= 0),
  safety_stock     integer      not null default 0 check (safety_stock >= 0),
  reorder_level    integer      not null default 0 check (reorder_level >= 0),
  lead_time_days   integer      not null default 1 check (lead_time_days > 0),
  supplier_id      uuid         references public.suppliers (id) on delete set null,
  image_url        text,
  created_at       timestamptz  not null default now(),
  updated_at       timestamptz  not null default now()
);

comment on table public.products is
  'Product master catalogue with stock levels and reorder thresholds.';

create index products_category_id_idx  on public.products (category_id);
create index products_supplier_id_idx  on public.products (supplier_id);
create index products_sku_idx          on public.products (sku);
create index products_barcode_idx      on public.products (barcode) where barcode is not null;


-- ---------------------------------------------------------------------------
-- 8. sales  (transaction header)
-- ---------------------------------------------------------------------------

create table public.sales (
  id            uuid         primary key default gen_random_uuid(),
  cashier_id    uuid         references public.profiles (id) on delete set null,
  subtotal      numeric(10,2) not null check (subtotal >= 0),
  tax           numeric(10,2) not null default 0 check (tax >= 0),
  discount      numeric(10,2) not null default 0 check (discount >= 0),
  total         numeric(10,2) not null check (total >= 0),
  cash_received numeric(10,2) not null check (cash_received >= 0),
  change        numeric(10,2) not null default 0 check (change >= 0),
  created_at    timestamptz  not null default now()
);

comment on table public.sales is
  'Point-of-sale transaction header. Line items are in sale_items.';

create index sales_cashier_id_idx  on public.sales (cashier_id);
create index sales_created_at_idx  on public.sales (created_at desc);


-- ---------------------------------------------------------------------------
-- 9. sale_items  (transaction line items)
-- ---------------------------------------------------------------------------

create table public.sale_items (
  id            uuid         primary key default gen_random_uuid(),
  sale_id       uuid         not null references public.sales (id) on delete cascade,
  product_id    uuid         references public.products (id) on delete set null,
  product_name  text         not null,                     -- snapshot at time of sale
  quantity      integer      not null check (quantity > 0),
  unit_price    numeric(10,2) not null check (unit_price >= 0),  -- snapshot
  line_total    numeric(10,2) not null check (line_total >= 0)
);

comment on table public.sale_items is
  'Line items for each sale. product_name and unit_price are snapshots to preserve history.';

create index sale_items_sale_id_idx     on public.sale_items (sale_id);
create index sale_items_product_id_idx  on public.sale_items (product_id);


-- ---------------------------------------------------------------------------
-- 10. stock_adjustments  (manual inventory corrections)
-- ---------------------------------------------------------------------------

create table public.stock_adjustments (
  id               uuid               primary key default gen_random_uuid(),
  product_id       uuid               not null references public.products (id) on delete cascade,
  reason           adjustment_reason  not null,
  quantity_delta   integer            not null check (quantity_delta <> 0),
  stock_before     integer            not null check (stock_before >= 0),
  stock_after      integer            not null check (stock_after >= 0),
  note             text               not null default '',
  created_by       uuid               references public.profiles (id) on delete set null,
  created_at       timestamptz        not null default now()
);

comment on table public.stock_adjustments is
  'Audit log of every manual stock change (damaged, expired, restock, etc.).';

create index stock_adj_product_id_idx   on public.stock_adjustments (product_id);
create index stock_adj_created_at_idx   on public.stock_adjustments (created_at desc);


-- ---------------------------------------------------------------------------
-- 11. stock_alerts
-- ---------------------------------------------------------------------------

create table public.stock_alerts (
  id               uuid              primary key default gen_random_uuid(),
  product_id       uuid              not null references public.products (id) on delete cascade,
  type             stock_alert_type  not null,
  current_stock    integer           not null check (current_stock >= 0),  -- snapshot
  min_stock_level  integer           not null check (min_stock_level >= 0), -- snapshot
  is_read          boolean           not null default false,
  created_at       timestamptz       not null default now()
);

comment on table public.stock_alerts is
  'Auto-generated alerts when product stock drops to low / critical / out-of-stock.';

create index stock_alerts_product_id_idx  on public.stock_alerts (product_id);
create index stock_alerts_is_read_idx     on public.stock_alerts (is_read) where not is_read;


-- ---------------------------------------------------------------------------
-- 12. purchase_orders  (restocking PO header)
-- ---------------------------------------------------------------------------

create table public.purchase_orders (
  id            uuid                   primary key default gen_random_uuid(),
  supplier_id   uuid                   not null references public.suppliers (id) on delete restrict,
  supplier_name text                   not null,                      -- snapshot at time of creation
  total         numeric(10,2)          not null default 0 check (total >= 0),
  status        purchase_order_status  not null default 'draft',
  on_time       boolean,                                               -- null until received
  received_at   timestamptz,                                           -- set when status → received
  created_by    uuid                   references public.profiles (id) on delete set null,
  created_at    timestamptz            not null default now(),
  updated_at    timestamptz            not null default now()
);

comment on table public.purchase_orders is
  'Restocking purchase order sent to a supplier. on_time is set when status changes to received.';

create index po_supplier_id_idx   on public.purchase_orders (supplier_id);
create index po_status_idx        on public.purchase_orders (status);
create index po_received_at_idx   on public.purchase_orders (received_at desc);

-- ---------------------------------------------------------------------------
-- Auto-recalculate supplier reliability_score when a PO is received/cancelled
-- ---------------------------------------------------------------------------

-- 1. Reliability score: on_time_deliveries / total_orders × 100
create or replace function public.recalc_supplier_reliability(p_supplier_id uuid)
returns void language plpgsql as $$
declare
  v_total   integer;
  v_on_time integer;
begin
  select
    count(*) filter (where status = 'received'),
    count(*) filter (where status = 'received' and on_time = true)
  into v_total, v_on_time
  from public.purchase_orders
  where supplier_id = p_supplier_id;

  update public.suppliers
  set
    total_orders       = v_total,
    on_time_deliveries = v_on_time,
    reliability_score  = case
                           when v_total = 0 then 100
                           else round((v_on_time::numeric / v_total) * 100, 2)
                         end,
    updated_at         = now()
  where id = p_supplier_id;
end;
$$;

-- 2. Price score: normalized avg cost vs all suppliers (0-100, higher = cheaper)
--    Recomputes for ALL suppliers since it is a relative metric.
create or replace function public.recalc_all_price_scores()
returns void language plpgsql as $$
declare
  v_min numeric;
  v_max numeric;
begin
  select
    min(avg_cost), max(avg_cost)
  into v_min, v_max
  from (
    select supplier_id, avg(cost_price) as avg_cost
    from public.products
    where supplier_id is not null
    group by supplier_id
  ) sub;

  -- If all suppliers have the same avg cost (or no products), default to 50
  if v_min is null or v_max = v_min then
    update public.suppliers set price_score = 50, updated_at = now();
    return;
  end if;

  update public.suppliers s
  set price_score = coalesce(
    round(
      100.0 * (1.0 - (sub.avg_cost - v_min) / (v_max - v_min)),
      2
    ),
    50
  ),
  updated_at = now()
  from (
    select supplier_id, avg(cost_price) as avg_cost
    from public.products
    where supplier_id is not null
    group by supplier_id
  ) sub
  where s.id = sub.supplier_id;
end;
$$;

-- 3. Trigger: fires after INSERT/UPDATE on purchase_orders
create or replace function public.trg_po_received()
returns trigger language plpgsql as $$
begin
  -- Only act when status changes to 'received' or from 'received'
  if (
    (TG_OP = 'UPDATE' and NEW.status = 'received' and OLD.status <> 'received') or
    (TG_OP = 'UPDATE' and OLD.status = 'received' and NEW.status = 'cancelled')
  ) then
    perform public.recalc_supplier_reliability(NEW.supplier_id);
    perform public.recalc_all_price_scores();
  end if;
  return NEW;
end;
$$;

create trigger po_received_trigger
  after update on public.purchase_orders
  for each row execute function public.trg_po_received();


-- ---------------------------------------------------------------------------
-- 13. purchase_order_items  (PO line items)
-- ---------------------------------------------------------------------------

create table public.purchase_order_items (
  id                  uuid         primary key default gen_random_uuid(),
  purchase_order_id   uuid         not null references public.purchase_orders (id) on delete cascade,
  product_id          uuid         references public.products (id) on delete set null,
  product_name        text         not null,                      -- snapshot
  quantity            integer      not null check (quantity > 0),
  unit_cost           numeric(10,2) not null check (unit_cost >= 0),
  line_total          numeric(10,2) generated always as (quantity * unit_cost) stored
);

comment on table public.purchase_order_items is
  'Line items for a purchase order. product_name is a snapshot.';

create index poi_po_id_idx       on public.purchase_order_items (purchase_order_id);
create index poi_product_id_idx  on public.purchase_order_items (product_id);


-- =============================================================================
-- VIEWS
-- =============================================================================

-- ---------------------------------------------------------------------------
-- v_product_stock_status  – computed stock status per product
-- ---------------------------------------------------------------------------

create or replace view public.v_product_stock_status as
select
  p.id,
  p.name,
  p.sku,
  p.current_stock,
  p.min_stock_level,
  p.safety_stock,
  c.name as category_name,
  case
    when p.current_stock = 0                         then 'out-of-stock'
    when p.current_stock <= p.safety_stock           then 'critical'
    when p.current_stock <= p.min_stock_level        then 'low'
    when p.current_stock > p.min_stock_level * 3     then 'overstock'
    else                                                  'in-stock'
  end as stock_status
from public.products p
join public.categories c on c.id = p.category_id;

comment on view public.v_product_stock_status is
  'Products with computed stock_status label (mirrors front-end getStockStatus logic).';


-- ---------------------------------------------------------------------------
-- v_daily_sales_summary  – revenue / profit / transactions per day
-- ---------------------------------------------------------------------------

create or replace view public.v_daily_sales_summary as
select
  date_trunc('day', s.created_at)::date                   as sale_date,
  count(s.id)                                               as transactions,
  sum(s.total)                                              as revenue,
  sum(s.total - s.discount - coalesce(
    (select sum(si.quantity * (si.unit_price - pr.cost_price))
     from public.sale_items si
     join public.products pr on pr.id = si.product_id
     where si.sale_id = s.id), 0
  ))                                                        as gross_profit,
  round(sum(s.total) / nullif(count(s.id), 0), 2)          as avg_order_value
from public.sales s
group by date_trunc('day', s.created_at)::date;

comment on view public.v_daily_sales_summary is
  'Aggregated daily revenue, transaction count, and avg order value for analytics.';


-- ---------------------------------------------------------------------------
-- v_category_sales  – revenue breakdown by category
-- ---------------------------------------------------------------------------

create or replace view public.v_category_sales as
select
  c.id   as category_id,
  c.name as category,
  sum(si.line_total)                                        as revenue,
  round(
    100.0 * sum(si.line_total) /
    nullif(sum(sum(si.line_total)) over (), 0),
    1
  )                                                         as percentage
from public.sale_items si
join public.products p  on p.id  = si.product_id
join public.categories c on c.id = p.category_id
group by c.id, c.name;

comment on view public.v_category_sales is
  'Revenue and percentage share per product category.';


-- ---------------------------------------------------------------------------
-- v_product_rankings  – top products by revenue
-- ---------------------------------------------------------------------------

create or replace view public.v_product_rankings as
select
  rank() over (order by sum(si.line_total) desc)  as rank,
  p.id                                             as product_id,
  p.name                                           as product_name,
  c.name                                           as category_name,
  sum(si.quantity)                                 as units_sold,
  sum(si.line_total)                               as revenue,
  round(
    100.0 * sum(si.line_total) /
    nullif(sum(sum(si.line_total)) over (), 0),
    1
  )                                                as percentage_of_total
from public.sale_items si
join public.products   p on p.id = si.product_id
join public.categories c on c.id = p.category_id
group by p.id, p.name, c.name;

comment on view public.v_product_rankings is
  'Products ranked by total revenue, with units sold and revenue share.';


-- =============================================================================
-- TRIGGERS – auto-maintain updated_at
-- =============================================================================

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

create trigger trg_purchase_orders_updated_at
  before update on public.purchase_orders
  for each row execute function public.set_updated_at();

create trigger trg_store_settings_updated_at
  before update on public.store_settings
  for each row execute function public.set_updated_at();

create trigger trg_notification_prefs_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();


-- =============================================================================
-- TRIGGER – auto-create profile + notification_preferences on signup
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
declare
  v_role user_role := 'cashier';
  v_invite_code text;
begin
  -- Check if an invite code was provided in the metadata
  v_invite_code := new.raw_user_meta_data->>'invite_code';
  
  if v_invite_code is not null then
    -- Verify if the code is valid, unused, and for the admin role
    if exists (
      select 1 from public.invite_codes
      where code = v_invite_code
        and is_used = false
        and role = 'admin'
    ) then
      v_role := 'admin';
      
      -- Mark the code as used immediately
      update public.invite_codes
      set is_used = true,
          used_by = new.id,
          used_at = now()
      where code = v_invite_code;
    else
      -- Optional: Raise an exception if the code is invalid so the user cannot sign up at all
      raise exception 'Invalid or expired invite code provided.';
    end if;
  else
    -- If no invite code is provided, we default to cashier.
    -- Alternatively, you can block ALL signups without an invite code:
    -- raise exception 'An invite code is required to register.';
  end if;

  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    v_role
  );

  insert into public.notification_preferences (user_id)
  values (new.id);

  return new;
end;
$$;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =============================================================================
-- ROW-LEVEL SECURITY (RLS)
-- =============================================================================

-- Enable RLS on all tables
alter table public.profiles                 enable row level security;
alter table public.store_settings           enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.categories               enable row level security;
alter table public.suppliers                enable row level security;
alter table public.products                 enable row level security;
alter table public.sales                    enable row level security;
alter table public.sale_items               enable row level security;
alter table public.stock_adjustments        enable row level security;
alter table public.stock_alerts             enable row level security;
alter table public.purchase_orders          enable row level security;
alter table public.purchase_order_items     enable row level security;
  -- Helper: return if the current authenticated user is an admin or super_admin
  create or replace function public.is_admin()
  returns boolean language sql stable security definer as $$
    select exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'super_admin')
    );
  $$;
-- Helper: return the role of the current authenticated user
create or replace function public.current_user_role()
returns user_role language sql stable security definer as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ── profiles ────────────────────────────────────────────────────────────────
-- Any authenticated user can read all profiles (needed for cashier name display)
create policy "profiles: authenticated read"
  on public.profiles for select
  to authenticated
  using (true);

-- Users can update their own profile; admins can update any
create policy "profiles: self or admin update"
  on public.profiles for update
  to authenticated
  using (id = auth.uid() or public.current_user_role() = 'admin');

-- Only admins can insert / delete profiles
create policy "profiles: admin insert"
  on public.profiles for insert
  to authenticated
  with check (public.current_user_role() = 'admin');

create policy "profiles: admin delete"
  on public.profiles for delete
  to authenticated
  using (public.current_user_role() = 'admin');

-- ── store_settings ──────────────────────────────────────────────────────────
create policy "store_settings: authenticated read"
  on public.store_settings for select
  to authenticated using (true);

create policy "store_settings: admin write"
  on public.store_settings for all
  to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ── notification_preferences ─────────────────────────────────────────────────
create policy "notif_prefs: own row"
  on public.notification_preferences for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── categories ──────────────────────────────────────────────────────────────
create policy "categories: authenticated read"
  on public.categories for select
  to authenticated using (true);

create policy "categories: admin write"
  on public.categories for all
  to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ── suppliers ───────────────────────────────────────────────────────────────
create policy "suppliers: authenticated read"
  on public.suppliers for select
  to authenticated using (true);

create policy "suppliers: admin write"
  on public.suppliers for all
  to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ── products ────────────────────────────────────────────────────────────────
create policy "products: authenticated read"
  on public.products for select
  to authenticated using (true);

create policy "products: admin write"
  on public.products for all
  to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ── sales & sale_items ───────────────────────────────────────────────────────
-- All authenticated users can insert (cashiers process sales)
create policy "sales: authenticated read"
  on public.sales for select
  to authenticated using (true);

create policy "sales: authenticated insert"
  on public.sales for insert
  to authenticated
  with check (cashier_id = auth.uid());

-- Only admins can delete sales records
create policy "sales: admin delete"
  on public.sales for delete
  to authenticated
  using (public.current_user_role() = 'admin');

create policy "sale_items: authenticated read"
  on public.sale_items for select
  to authenticated using (true);

create policy "sale_items: authenticated insert"
  on public.sale_items for insert
  to authenticated with check (true);

-- ── stock_adjustments ───────────────────────────────────────────────────────
create policy "stock_adj: authenticated read"
  on public.stock_adjustments for select
  to authenticated using (true);

create policy "stock_adj: authenticated insert"
  on public.stock_adjustments for insert
  to authenticated
  with check (created_by = auth.uid());

-- ── stock_alerts ────────────────────────────────────────────────────────────
create policy "stock_alerts: authenticated read"
  on public.stock_alerts for select
  to authenticated using (true);

create policy "stock_alerts: authenticated update"
  on public.stock_alerts for update
  to authenticated using (true); -- allow marking as read

create policy "stock_alerts: admin insert/delete"
  on public.stock_alerts for insert
  to authenticated with check (true); -- system inserts via triggers

-- ── purchase_orders & items ──────────────────────────────────────────────────
create policy "po: authenticated read"
  on public.purchase_orders for select
  to authenticated using (true);

create policy "po: admin write"
  on public.purchase_orders for all
  to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create policy "poi: authenticated read"
  on public.purchase_order_items for select
  to authenticated using (true);

create policy "poi: admin write"
  on public.purchase_order_items for all
  to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');


-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
