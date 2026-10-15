-- SaloneLedger core schema: businesses (tenants), members and roles, catalogue,
-- stock locations and stock levels.
--
-- Every business-owned row carries business_id, and row level security keys
-- on it (see 20261014000600_security.sql). Money is numeric(14,2) in the
-- business's base currency (SLE, the redenominated Leone); quantities are
-- numeric(14,3) so hardware and kitchen stock can hold fractions.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.member_role as enum ('owner', 'admin', 'cashier', 'storekeeper');
create type public.member_status as enum ('active', 'pending', 'suspended');

create type public.movement_reason as enum (
  'opening',          -- stock on hand when the business started using SaloneLedger
  'purchase',         -- received from a supplier
  'sale',
  'sale_void',        -- a voided sale puts stock back
  'adjustment',       -- admin correction
  'count_variance',   -- approved physical count
  'damage',
  'expired',
  'usage',            -- kitchen ingredients, salon consumables, workshop materials
  'transfer_out',
  'transfer_in',
  'production_out',   -- raw materials consumed by a production run
  'production_in',    -- finished goods from a production run
  'return_in'         -- customer return outside a void
);

-- ---------------------------------------------------------------------------
-- People and businesses
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  phone text,
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1)),
    nullif(trim(new.raw_user_meta_data ->> 'phone'), '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  -- An archetype key from src/lib/archetypes.ts, or 'custom'.
  business_type text not null,
  custom_type_label text,
  location_city text not null,
  address text,
  phone text,
  email text,
  currency_code text not null default 'SLE',
  -- Leones per US dollar, for USD payments. Admins keep it current.
  usd_rate numeric(12, 4) not null default 23.0 check (usd_rate > 0),
  -- Words the UI uses for this business: {"item":"Product","customer":"Client","job":"Repair",...}
  terminology jsonb not null default '{}',
  units text[] not null default '{pieces}',
  -- Feature switches from the archetype: {"serials":true,"expiry":false,"jobs":"repair",...}
  modules jsonb not null default '{}',
  storage_modes text[] not null default '{shelves}',
  sales_input_by text not null default 'both' check (sales_input_by in ('staff', 'admin', 'both')),
  payment_methods text[] not null default '{cash}',
  -- Anti-fraud thresholds
  max_staff_discount_pct numeric(5, 2) not null default 5 check (max_staff_discount_pct between 0 and 100),
  stock_variance_tolerance_pct numeric(5, 2) not null default 2 check (stock_variance_tolerance_pct >= 0),
  cash_variance_tolerance numeric(14, 2) not null default 0 check (cash_variance_tolerance >= 0),
  staff_expense_alert_amount numeric(14, 2) not null default 500 check (staff_expense_alert_amount >= 0),
  staff_backdate_days int not null default 1 check (staff_backdate_days between 0 and 31),
  opening_time time,
  closing_time time,
  dead_stock_days int not null default 30 check (dead_stock_days between 7 and 365),
  -- Where alerts go outside the app: {"phone":"+23276...","channel":"whatsapp","low_stock":true}
  notify jsonb not null default '{}',
  join_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  onboarding_completed_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.memberships (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  status public.member_status not null default 'active',
  display_name text not null,
  phone text,
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

-- Running numbers per business (receipts, stock receipts, counts, jobs).
create table public.business_counters (
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  value bigint not null default 0,
  primary key (business_id, name)
);

create function public.next_counter(b uuid, counter text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into business_counters (business_id, name, value) values (b, counter, 1)
  on conflict (business_id, name) do update set value = business_counters.value + 1
  returning value into v;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Access helpers. SECURITY DEFINER so RLS policies can call them without
-- recursing into memberships' own policies.
-- ---------------------------------------------------------------------------

create function public.is_service_role() returns boolean
language sql stable as $$
  select coalesce(coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    nullif(current_setting('request.jwt.claim.role', true), '')
  ) = 'service_role', false)
$$;

create function public.role_in(b uuid) returns public.member_role
language sql stable security definer set search_path = public as $$
  select role from memberships
  where business_id = b and user_id = auth.uid() and status = 'active'
$$;

create function public.is_member(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.role_in(b) is not null
$$;

create function public.is_admin(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.role_in(b) in ('owner', 'admin')
$$;

/** Raises a permission error unless the caller holds one of the roles. */
create function public.require_role(b uuid, roles public.member_role[]) returns public.member_role
language plpgsql stable security definer set search_path = public as $$
declare r public.member_role;
begin
  r := public.role_in(b);
  if r is null or not (r = any (roles)) then
    raise exception 'You do not have permission to do that.' using errcode = '42501';
  end if;
  return r;
end $$;

create function public.business_today(b uuid) returns date
language sql stable as $$
  -- Sierra Leone keeps GMT all year.
  select (now() at time zone 'Africa/Freetown')::date
$$;

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  kind text not null default 'shelf'
    check (kind in ('shelf', 'freezer', 'cold_store', 'warehouse', 'store_room', 'vehicle', 'other')),
  is_default_sale boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (business_id, name),
  unique (business_id, id)
);
create unique index locations_one_default_sale on public.locations (business_id) where is_default_sale;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (business_id, name)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  phone text,
  email text,
  address text,
  notes text,
  balance_due numeric(14, 2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, name)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  phone text,
  notes text,
  credit_limit numeric(14, 2) not null default 0 check (credit_limit >= 0),
  balance numeric(14, 2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index customers_business_idx on public.customers (business_id, name);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160),
  sku text,
  barcode text,
  category_id uuid references public.categories (id) on delete set null,
  kind text not null default 'stock' check (kind in ('stock', 'service', 'raw_material')),
  unit text not null default 'pieces',
  track_mode text not null default 'none' check (track_mode in ('none', 'serial', 'batch')),
  -- Archetype fields: size/colour, brand/model, part number, VIN make/year...
  attributes jsonb not null default '{}',
  cost_price numeric(14, 2) not null default 0 check (cost_price >= 0),   -- weighted average
  selling_price numeric(14, 2) not null default 0 check (selling_price >= 0),
  wholesale_price numeric(14, 2) check (wholesale_price >= 0),
  reorder_level numeric(14, 3) not null default 0 check (reorder_level >= 0),
  reorder_qty numeric(14, 3) not null default 0 check (reorder_qty >= 0),
  preferred_supplier_id uuid references public.suppliers (id) on delete set null,
  warranty_months int check (warranty_months between 0 and 240),
  requires_prescription boolean not null default false,
  is_regulated boolean not null default false,
  commission_pct numeric(5, 2) not null default 0 check (commission_pct between 0 and 100),
  allow_fractional boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, sku),
  unique (business_id, barcode),
  unique (business_id, id)
);
create index products_business_name_idx on public.products (business_id, lower(name));

create function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Stock
-- ---------------------------------------------------------------------------

create table public.stock_levels (
  business_id uuid not null references public.businesses (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  quantity numeric(14, 3) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (product_id, location_id)
);
create index stock_levels_business_idx on public.stock_levels (business_id);

-- The stock ledger. Rows are never changed; stock_levels is derived from it.
create table public.stock_movements (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  product_id uuid not null,
  location_id uuid not null,
  qty numeric(14, 3) not null check (qty <> 0),
  reason public.movement_reason not null,
  unit_cost numeric(14, 2) not null default 0,
  ref_table text,
  ref_id uuid,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (business_id, product_id) references public.products (business_id, id),
  foreign key (business_id, location_id) references public.locations (business_id, id)
);
create index stock_movements_product_idx on public.stock_movements (business_id, product_id, created_at);
create index stock_movements_ref_idx on public.stock_movements (ref_table, ref_id);

-- Batch / lot tracking with expiry (pharmacies, supermarkets, water factories).
create table public.stock_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  batch_no text,
  expiry_date date,
  quantity numeric(14, 3) not null check (quantity >= 0),
  unit_cost numeric(14, 2) not null default 0,
  received_at timestamptz not null default now()
);
create index stock_batches_fefo_idx on public.stock_batches (product_id, expiry_date nulls last, received_at);

-- One row per serialised unit: IMEI, serial number or VIN.
create table public.serial_units (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  serial text not null check (length(trim(serial)) between 3 and 64),
  status text not null default 'in_stock' check (status in ('in_stock', 'sold', 'returned', 'defective')),
  unit_cost numeric(14, 2) not null default 0,
  received_at timestamptz not null default now(),
  sold_at timestamptz,
  sale_id uuid,
  warranty_until date,
  notes text,
  unique (business_id, serial)
);
create index serial_units_product_idx on public.serial_units (product_id, status);

/** Applies a movement to stock_levels; refuses to go negative unless allowed. */
create function public.apply_stock_movement() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  new_qty numeric;
  p_name text;
  l_name text;
begin
  insert into stock_levels (business_id, product_id, location_id, quantity, updated_at)
  values (new.business_id, new.product_id, new.location_id, new.qty, now())
  on conflict (product_id, location_id)
  do update set quantity = stock_levels.quantity + excluded.quantity, updated_at = now()
  returning quantity into new_qty;

  if new_qty < 0 and coalesce(current_setting('app.allow_negative_stock', true), '') <> 'on' then
    select name into p_name from products where id = new.product_id;
    select name into l_name from locations where id = new.location_id;
    raise exception 'Not enough % at % (short by %).', p_name, l_name, trim(to_char(-new_qty, 'FM999999990.###'));
  end if;
  return new;
end $$;

create trigger stock_movements_apply after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

create function public.forbid_change() returns trigger language plpgsql as $$
begin
  raise exception '% records cannot be changed or deleted. Record a correcting entry instead.', tg_table_name
    using errcode = '42501';
end $$;

create trigger stock_movements_immutable before update or delete on public.stock_movements
  for each row execute function public.forbid_change();

create view public.product_stock with (security_invoker = true) as
  select p.business_id, p.id as product_id, coalesce(sum(s.quantity), 0)::numeric(14, 3) as quantity
  from public.products p
  left join public.stock_levels s on s.product_id = p.id
  group by p.business_id, p.id;
