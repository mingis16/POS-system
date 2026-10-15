-- Day-to-day operations: sales, expenses, stock receiving, payments, stock
-- counts, cash-ups, jobs and production.
--
-- Clients never insert these rows directly. Each operation is one SECURITY
-- DEFINER function that checks the caller's role, validates the input against
-- the database (prices come from the catalogue, not the browser), moves stock,
-- posts the journal entry, writes the audit trail and raises fraud alerts, all
-- in one transaction.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  receipt_no bigint not null,
  -- Set by the POS so a sale synced twice from offline mode is stored once.
  client_ref uuid unique,
  customer_id uuid references public.customers (id),
  location_id uuid not null references public.locations (id),
  order_type text not null default 'counter' check (order_type in ('counter', 'table', 'takeaway', 'delivery')),
  table_label text,
  subtotal numeric(14, 2) not null,
  discount numeric(14, 2) not null default 0,
  total numeric(14, 2) not null,
  cost_total numeric(14, 2) not null default 0,
  status text not null default 'completed' check (status in ('completed', 'void_requested', 'voided')),
  prescription_ref text,
  note text,
  offline boolean not null default false,
  captured_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  void_reason text,
  void_requested_by uuid,
  void_requested_at timestamptz,
  void_review_note text,
  voided_by uuid,
  voided_at timestamptz,
  unique (business_id, receipt_no)
);
create index sales_business_created_idx on public.sales (business_id, created_at desc);
create index sales_creator_idx on public.sales (business_id, created_by, created_at);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) deferrable initially deferred,
  business_id uuid not null,
  product_id uuid not null references public.products (id),
  name text not null,
  kind text not null,
  qty numeric(14, 3) not null check (qty > 0),
  unit_price numeric(14, 2) not null,
  list_price numeric(14, 2) not null,
  discount numeric(14, 2) not null default 0,
  line_total numeric(14, 2) not null,
  unit_cost numeric(14, 2) not null default 0,
  performed_by uuid,
  commission_amount numeric(14, 2) not null default 0,
  serial_ids uuid[],
  batch_allocations jsonb
);
create index sale_items_sale_idx on public.sale_items (sale_id);
create index sale_items_product_idx on public.sale_items (business_id, product_id);

create table public.sale_payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) deferrable initially deferred,
  business_id uuid not null,
  method text not null check (method in ('cash', 'orange_money', 'afrimoney', 'qmoney', 'bank', 'credit')),
  currency text not null default 'SLE' check (currency in ('SLE', 'USD')),
  amount numeric(14, 2) not null check (amount > 0),
  fx_rate numeric(12, 4) not null default 1,
  amount_base numeric(14, 2) not null,
  reference text
);
create index sale_payments_sale_idx on public.sale_payments (sale_id);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  expense_no bigint not null,
  account_id uuid not null,
  category_name text not null,
  amount numeric(14, 2) not null check (amount > 0),
  method text not null check (method in ('cash', 'orange_money', 'afrimoney', 'qmoney', 'bank')),
  paid_to text,
  note text,
  expense_date date not null,
  status text not null default 'recorded' check (status in ('recorded', 'voided')),
  void_reason text,
  voided_by uuid,
  voided_at timestamptz,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (business_id, account_id) references public.accounts (business_id, id)
);
create index expenses_business_date_idx on public.expenses (business_id, expense_date desc);

create table public.stock_receipts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  receipt_no bigint not null,
  supplier_id uuid references public.suppliers (id),
  invoice_ref text,
  location_id uuid not null references public.locations (id),
  total_cost numeric(14, 2) not null,
  amount_paid numeric(14, 2) not null default 0,
  payment_method text check (payment_method in ('cash', 'orange_money', 'afrimoney', 'qmoney', 'bank')),
  note text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index stock_receipts_business_idx on public.stock_receipts (business_id, created_at desc);

create table public.stock_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.stock_receipts (id) deferrable initially deferred,
  business_id uuid not null,
  product_id uuid not null references public.products (id),
  qty numeric(14, 3) not null check (qty > 0),
  unit_cost numeric(14, 2) not null check (unit_cost >= 0),
  line_total numeric(14, 2) not null,
  batch_no text,
  expiry_date date,
  serials text[]
);
create index stock_receipt_items_receipt_idx on public.stock_receipt_items (receipt_id);

create table public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id),
  amount numeric(14, 2) not null check (amount > 0),
  method text not null check (method in ('cash', 'orange_money', 'afrimoney', 'qmoney', 'bank')),
  note text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  customer_id uuid not null references public.customers (id),
  amount numeric(14, 2) not null check (amount > 0),
  method text not null check (method in ('cash', 'orange_money', 'afrimoney', 'qmoney', 'bank')),
  note text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.owner_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null check (kind in ('capital', 'drawing')),
  amount numeric(14, 2) not null check (amount > 0),
  method text not null check (method in ('cash', 'orange_money', 'afrimoney', 'qmoney', 'bank')),
  note text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  count_no bigint not null,
  location_id uuid not null references public.locations (id),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected')),
  note text,
  loss_value numeric(14, 2) not null default 0,
  gain_value numeric(14, 2) not null default 0,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text
);
create index stock_counts_business_idx on public.stock_counts (business_id, created_at desc);

create table public.stock_count_lines (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.stock_counts (id) on delete cascade,
  business_id uuid not null,
  product_id uuid not null references public.products (id),
  counted_qty numeric(14, 3) check (counted_qty >= 0),
  -- Filled in on submission: counters do not see the book quantity (blind count).
  expected_qty numeric(14, 3),
  unit_cost numeric(14, 2),
  variance numeric(14, 3) generated always as (counted_qty - expected_qty) stored,
  unique (count_id, product_id)
);

create table public.cash_ups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  period_start timestamptz not null,
  period_end timestamptz not null,
  opening_float numeric(14, 2) not null default 0,
  expected_cash numeric(14, 2) not null,
  expected_usd numeric(14, 2) not null default 0,
  counted_cash numeric(14, 2) not null,
  counted_usd numeric(14, 2) not null default 0,
  usd_rate numeric(12, 4) not null,
  variance numeric(14, 2) not null,
  momo_expected jsonb not null default '{}',
  note text,
  status text not null default 'submitted' check (status in ('submitted', 'reviewed')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index cash_ups_user_idx on public.cash_ups (business_id, user_id, period_end desc);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  job_no bigint not null,
  kind text not null default 'general'
    check (kind in ('repair', 'booking', 'installation', 'custom_order', 'service', 'delivery', 'general')),
  title text not null check (length(trim(title)) between 1 and 160),
  customer_id uuid references public.customers (id),
  customer_name text,
  customer_phone text,
  description text,
  -- IMEI, serial number, VIN or vehicle registration the job is about.
  item_ref text,
  status text not null default 'pending'
    check (status in ('pending', 'scheduled', 'in_progress', 'ready', 'completed', 'cancelled')),
  scheduled_for timestamptz,
  due_date date,
  assigned_to uuid,
  quoted_amount numeric(14, 2) check (quoted_amount >= 0),
  amount_paid numeric(14, 2) not null default 0,
  details jsonb not null default '{}',
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (business_id, job_no)
);
create index jobs_business_status_idx on public.jobs (business_id, status, created_at desc);

create table public.job_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  job_id uuid not null references public.jobs (id),
  amount numeric(14, 2) not null check (amount > 0),
  method text not null check (method in ('cash', 'orange_money', 'afrimoney', 'qmoney', 'bank')),
  note text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.production_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  run_no bigint not null,
  product_id uuid not null references public.products (id),
  qty numeric(14, 3) not null check (qty > 0),
  location_id uuid not null references public.locations (id),
  inputs jsonb not null default '[]',
  unit_cost numeric(14, 2) not null default 0,
  batch_no text,
  note text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

-- Money and stock records are append-only. Sales may change status (voids)
-- and nothing else.
create trigger sale_items_immutable before update or delete on public.sale_items
  for each row execute function public.forbid_change();
create trigger sale_payments_immutable before update or delete on public.sale_payments
  for each row execute function public.forbid_change();
create trigger stock_receipts_immutable before update or delete on public.stock_receipts
  for each row execute function public.forbid_change();
create trigger stock_receipt_items_immutable before update or delete on public.stock_receipt_items
  for each row execute function public.forbid_change();
create trigger supplier_payments_immutable before update or delete on public.supplier_payments
  for each row execute function public.forbid_change();
create trigger customer_payments_immutable before update or delete on public.customer_payments
  for each row execute function public.forbid_change();
create trigger owner_transactions_immutable before update or delete on public.owner_transactions
  for each row execute function public.forbid_change();
create trigger job_payments_immutable before update or delete on public.job_payments
  for each row execute function public.forbid_change();
create trigger production_runs_immutable before update or delete on public.production_runs
  for each row execute function public.forbid_change();

create function public.guard_sale_update() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Sales cannot be deleted. Ask an admin to void it.' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['status', 'void_reason', 'void_requested_by', 'void_requested_at',
                           'void_review_note', 'voided_by', 'voided_at'])
     is distinct from
     (to_jsonb(old) - array['status', 'void_reason', 'void_requested_by', 'void_requested_at',
                           'void_review_note', 'voided_by', 'voided_at']) then
    raise exception 'A recorded sale cannot be edited. Void it and record it again.' using errcode = '42501';
  end if;
  if old.status = 'voided' then
    raise exception 'This sale has already been voided.';
  end if;
  return new;
end $$;
create trigger sales_guard before update or delete on public.sales
  for each row execute function public.guard_sale_update();

create function public.guard_expense_update() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Expenses cannot be deleted. Ask an admin to void it.' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['status', 'void_reason', 'voided_by', 'voided_at'])
     is distinct from (to_jsonb(old) - array['status', 'void_reason', 'voided_by', 'voided_at']) then
    raise exception 'A recorded expense cannot be edited. Void it and record it again.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger expenses_guard before update or delete on public.expenses
  for each row execute function public.guard_expense_update();

create function public.guard_count_line() returns trigger language plpgsql as $$
declare st text;
begin
  select status into st from stock_counts where id = coalesce(new.count_id, old.count_id);
  if st <> 'draft' and current_setting('app.count_review', true) is distinct from 'on' then
    raise exception 'This count has been submitted and can no longer be changed.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger stock_count_lines_guard before update or delete on public.stock_count_lines
  for each row execute function public.guard_count_line();

create function public.jobs_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.job_no := next_counter(new.business_id, 'job');
    new.amount_paid := 0;
  else
    new.updated_at := now();
    new.job_no := old.job_no;
    new.business_id := old.business_id;
    new.created_by := old.created_by;
    -- amount_paid only moves through record_job_payment.
    if current_setting('app.job_payment', true) is distinct from 'on' then
      new.amount_paid := old.amount_paid;
    end if;
    if new.status = 'completed' and old.status <> 'completed' then
      new.completed_at := now();
    end if;
  end if;
  return new;
end $$;
create trigger jobs_before_write before insert or update on public.jobs
  for each row execute function public.jobs_before_write();

-- Audit trail for every transaction header.
create trigger audit_sales after insert or update on public.sales
  for each row execute function public.audit_row();
create trigger audit_expenses after insert or update on public.expenses
  for each row execute function public.audit_row();
create trigger audit_stock_receipts after insert on public.stock_receipts
  for each row execute function public.audit_row();
create trigger audit_supplier_payments after insert on public.supplier_payments
  for each row execute function public.audit_row();
create trigger audit_customer_payments after insert on public.customer_payments
  for each row execute function public.audit_row();
create trigger audit_owner_transactions after insert on public.owner_transactions
  for each row execute function public.audit_row();
create trigger audit_stock_counts after insert or update on public.stock_counts
  for each row execute function public.audit_row();
create trigger audit_cash_ups after insert or update on public.cash_ups
  for each row execute function public.audit_row();
create trigger audit_jobs after insert or update on public.jobs
  for each row execute function public.audit_row();
create trigger audit_job_payments after insert on public.job_payments
  for each row execute function public.audit_row();
create trigger audit_production_runs after insert on public.production_runs
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by clients; see the security migration)
-- ---------------------------------------------------------------------------

create function public.fmt_money(v numeric) returns text language sql immutable as $$
  select 'Le ' || trim(to_char(coalesce(v, 0), 'FM999,999,999,990.00'))
$$;

create function public.fmt_qty(v numeric) returns text language sql immutable as $$
  select trim(trailing '.' from trim(to_char(coalesce(v, 0), 'FM999,999,990.###')))
$$;

create function public.member_name(b uuid, u uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select display_name from memberships where business_id = b and user_id = u),
    (select full_name from profiles where id = u),
    'Someone')
$$;

create function public.check_method(biz public.businesses, m text, allow_credit boolean default false) returns void
language plpgsql as $$
begin
  if m is null or m not in ('cash', 'orange_money', 'afrimoney', 'qmoney', 'bank', 'credit') then
    raise exception 'Choose a payment method.';
  end if;
  if m = 'credit' and not allow_credit then
    raise exception 'Credit cannot be used here.';
  end if;
  if m <> 'cash' and not (m = any (biz.payment_methods)) then
    raise exception 'That payment method is not switched on for this business. An admin can enable it in Settings.';
  end if;
end $$;

create function public.check_qty(prod public.products, q numeric) returns void
language plpgsql as $$
begin
  if q is null or q <= 0 then
    raise exception 'Enter a quantity for %.', prod.name;
  end if;
  if not prod.allow_fractional and q <> trunc(q) then
    raise exception '% is counted in whole % only.', prod.name, prod.unit;
  end if;
end $$;

create function public.resolve_location(b uuid, loc uuid, prefer_store boolean default false) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  if loc is not null then
    select id into v from locations where id = loc and business_id = b and is_active;
    if v is null then
      raise exception 'That stock location does not exist.';
    end if;
    return v;
  end if;
  if prefer_store then
    select id into v from locations
    where business_id = b and is_active and kind in ('warehouse', 'store_room', 'cold_store')
    order by sort_order limit 1;
  end if;
  if v is null then
    select id into v from locations where business_id = b and is_default_sale and is_active;
  end if;
  if v is null then
    select id into v from locations where business_id = b and is_active order by sort_order limit 1;
  end if;
  if v is null then
    raise exception 'Add a stock location in Settings first.';
  end if;
  return v;
end $$;

/** Takes qty out of a product's batches, earliest expiry first. Returns the allocation. */
create function public.consume_batches(p_product uuid, q numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  left_q numeric := q;
  bt record;
  take numeric;
  allocs jsonb := '[]';
begin
  for bt in
    select id, quantity from stock_batches
    where product_id = p_product and quantity > 0
    order by expiry_date nulls last, received_at
    for update
  loop
    exit when left_q <= 0;
    take := least(bt.quantity, left_q);
    update stock_batches set quantity = quantity - take where id = bt.id;
    allocs := allocs || jsonb_build_object('batch_id', bt.id, 'qty', take);
    left_q := left_q - take;
  end loop;
  return allocs;
end $$;

create function public.restore_batches(allocs jsonb) returns void
language sql security definer set search_path = public as $$
  update stock_batches b set quantity = b.quantity + (a ->> 'qty')::numeric
  from jsonb_array_elements(coalesce(allocs, '[]')) a
  where b.id = (a ->> 'batch_id')::uuid
$$;

/** Total stock of a product across locations. */
create function public.stock_total(p_product uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(quantity), 0) from stock_levels where product_id = p_product
$$;

/** Creates a catalogue item from JSON; resolves or creates its category by name. */
create function public.create_product_row(b uuid, it jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  cat uuid := nullif(it ->> 'category_id', '')::uuid;
  cat_name text := nullif(trim(it ->> 'category'), '');
  pid uuid;
begin
  if cat is null and cat_name is not null then
    select id into cat from categories where business_id = b and lower(name) = lower(cat_name);
    if cat is null then
      insert into categories (business_id, name) values (b, cat_name) returning id into cat;
    end if;
  end if;
  insert into products (
    business_id, name, sku, barcode, category_id, kind, unit, track_mode, attributes,
    cost_price, selling_price, wholesale_price, reorder_level, reorder_qty, preferred_supplier_id,
    warranty_months, requires_prescription, is_regulated, commission_pct, allow_fractional
  ) values (
    b, trim(it ->> 'name'), nullif(trim(it ->> 'sku'), ''), nullif(trim(it ->> 'barcode'), ''), cat,
    coalesce(nullif(it ->> 'kind', ''), 'stock'), coalesce(nullif(trim(it ->> 'unit'), ''), 'pieces'),
    coalesce(nullif(it ->> 'track_mode', ''), 'none'), coalesce(it -> 'attributes', '{}'),
    round(coalesce(nullif(it ->> 'cost_price', '')::numeric, 0), 2),
    round(coalesce(nullif(it ->> 'selling_price', '')::numeric, 0), 2),
    round(nullif(it ->> 'wholesale_price', '')::numeric, 2),
    coalesce(nullif(it ->> 'reorder_level', '')::numeric, 0),
    coalesce(nullif(it ->> 'reorder_qty', '')::numeric, 0),
    nullif(it ->> 'preferred_supplier_id', '')::uuid,
    nullif(it ->> 'warranty_months', '')::int,
    coalesce((it ->> 'requires_prescription')::boolean, false),
    coalesce((it ->> 'is_regulated')::boolean, false),
    coalesce(nullif(it ->> 'commission_pct', '')::numeric, 0),
    coalesce((it ->> 'allow_fractional')::boolean, false)
  ) returning id into pid;
  return pid;
exception when unique_violation then
  raise exception 'Another item already uses the code or barcode given for "%".', it ->> 'name';
end $$;

/**
 * Puts opening stock on the books: Dr Inventory, Cr Owner's equity.
 * Serialised items need one serial per unit; batch items may carry batch/expiry.
 */
create function public.add_opening_stock(b uuid, pid uuid, loc uuid, q numeric, cost numeric, it jsonb) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  prod products%rowtype;
  s text;
  serials text[];
begin
  select * into prod from products where id = pid;
  if prod.kind = 'service' or q is null or q = 0 then
    return 0;
  end if;
  perform check_qty(prod, q);
  if prod.track_mode = 'serial' then
    select array_agg(trim(x)) into serials
    from jsonb_array_elements_text(coalesce(it -> 'serials', '[]')) x where trim(x) <> '';
    if coalesce(array_length(serials, 1), 0) <> q then
      raise exception 'Enter % serial number(s) for %.', fmt_qty(q), prod.name;
    end if;
    foreach s in array serials loop
      begin
        insert into serial_units (business_id, product_id, serial, unit_cost) values (b, pid, s, cost);
      exception when unique_violation then
        raise exception 'Serial number % is already in stock.', s;
      end;
    end loop;
  elsif prod.track_mode = 'batch' then
    insert into stock_batches (business_id, product_id, batch_no, expiry_date, quantity, unit_cost)
    values (b, pid, nullif(trim(it ->> 'batch_no'), ''), nullif(it ->> 'expiry_date', '')::date, q, cost);
  end if;
  insert into stock_movements (business_id, product_id, location_id, qty, reason, unit_cost, ref_table, ref_id, note)
  values (b, pid, loc, q, 'opening', cost, 'products', pid, 'Opening stock');
  return round(q * cost, 2);
end $$;

-- ---------------------------------------------------------------------------
-- Onboarding and membership
-- ---------------------------------------------------------------------------

/**
 * The onboarding wizard's final step: creates the business, makes the caller
 * its owner, and sets up locations, categories, the chart of accounts and the
 * opening stock, all at once.
 */
create function public.create_business(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  b uuid;
  loc jsonb;
  default_loc uuid;
  first_loc uuid;
  loc_id uuid;
  it jsonb;
  pid uuid;
  opening_value numeric := 0;
  opening_cash numeric := round(coalesce(nullif(p ->> 'opening_cash', '')::numeric, 0), 2);
  n int := 0;
  owner_name text;
begin
  if uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if coalesce(trim(p ->> 'name'), '') = '' then
    raise exception 'Enter the business name.';
  end if;
  if coalesce(trim(p ->> 'business_type'), '') = '' then
    raise exception 'Choose the type of business.';
  end if;
  if coalesce(trim(p ->> 'location_city'), '') = '' then
    raise exception 'Choose where the business is.';
  end if;
  if opening_cash < 0 then
    raise exception 'Opening cash cannot be negative.';
  end if;

  insert into businesses (
    name, business_type, custom_type_label, location_city, address, phone, email, terminology, units,
    modules, storage_modes, sales_input_by, payment_methods, created_by
  ) values (
    trim(p ->> 'name'), trim(p ->> 'business_type'), nullif(trim(p ->> 'custom_type_label'), ''),
    trim(p ->> 'location_city'), nullif(trim(p ->> 'address'), ''), nullif(trim(p ->> 'phone'), ''),
    nullif(trim(p ->> 'email'), ''), coalesce(p -> 'terminology', '{}'),
    coalesce((select array_agg(trim(x)) from jsonb_array_elements_text(p -> 'units') x where trim(x) <> ''), '{pieces}'),
    coalesce(p -> 'modules', '{}'),
    coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'storage_modes') x), '{shelves}'),
    coalesce(nullif(p ->> 'sales_input_by', ''), 'both'),
    coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'payment_methods') x), '{cash}'),
    uid
  ) returning id into b;

  select coalesce(nullif(trim(p ->> 'owner_name'), ''), nullif(full_name, ''), 'Owner')
    into owner_name from profiles where id = uid;
  insert into memberships (business_id, user_id, role, status, display_name, phone)
  values (b, uid, 'owner', 'active', coalesce(owner_name, 'Owner'), nullif(trim(p ->> 'phone'), ''));

  for loc in select * from jsonb_array_elements(coalesce(p -> 'locations', '[]')) loop
    n := n + 1;
    insert into locations (business_id, name, kind, sort_order)
    values (b, trim(loc ->> 'name'), coalesce(nullif(loc ->> 'kind', ''), 'other'), n)
    on conflict (business_id, name) do nothing
    returning id into loc_id;
    if loc_id is not null then
      first_loc := coalesce(first_loc, loc_id);
      if coalesce((loc ->> 'is_default_sale')::boolean, false) and default_loc is null then
        default_loc := loc_id;
      end if;
    end if;
  end loop;
  if first_loc is null then
    insert into locations (business_id, name, kind, sort_order) values (b, 'Shop floor', 'shelf', 1)
    returning id into first_loc;
  end if;
  update locations set is_default_sale = true where id = coalesce(default_loc, first_loc);

  insert into categories (business_id, name)
  select distinct b, trim(x) from jsonb_array_elements_text(coalesce(p -> 'categories', '[]')) x
  where trim(x) <> ''
  on conflict do nothing;

  perform seed_accounts(b, coalesce(
    (select array_agg(x) from jsonb_array_elements_text(p -> 'expense_categories') x), '{}'));

  for it in select * from jsonb_array_elements(coalesce(p -> 'items', '[]')) loop
    continue when coalesce(trim(it ->> 'name'), '') = '';
    pid := create_product_row(b, it);
    opening_value := opening_value + add_opening_stock(
      b, pid, resolve_location(b, nullif(it ->> 'location_id', '')::uuid),
      coalesce(nullif(it ->> 'opening_qty', '')::numeric, 0),
      round(coalesce(nullif(it ->> 'cost_price', '')::numeric, 0), 2), it);
  end loop;

  perform post_journal(b, business_today(b), 'Opening balances', 'businesses', b, jsonb_build_array(
    jsonb_build_object('key', 'inventory', 'debit', opening_value),
    jsonb_build_object('key', 'cash', 'debit', opening_cash),
    jsonb_build_object('key', 'equity', 'credit', opening_value + opening_cash)
  ));

  update businesses set onboarding_completed_at = now() where id = b;
  return b;
end $$;

/** A staff member asks to join with the code the owner gave them. */
create function public.join_business(p_code text, p_name text, p_phone text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  b uuid;
  biz_name text;
begin
  if uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Enter your name.';
  end if;
  select id, name into b, biz_name from businesses where join_code = upper(trim(p_code));
  if b is null then
    raise exception 'No business has that code. Check it with your manager.';
  end if;
  if exists (select 1 from memberships where business_id = b and user_id = uid) then
    return b;
  end if;
  insert into memberships (business_id, user_id, role, status, display_name, phone)
  values (b, uid, 'cashier', 'pending', trim(p_name), nullif(trim(p_phone), ''));
  perform raise_alert(b, 'staff_join', 'info', trim(p_name) || ' wants to join ' || biz_name,
    'Approve or decline them on the Staff page.', 'join:' || uid, null, 'memberships', null,
    jsonb_build_object('user_id', uid));
  return b;
end $$;

/** Adds an existing login (created by the owner through the admin API) as staff. */
create function public.add_member(b uuid, p_user uuid, p_role public.member_role, p_name text, p_phone text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare caller public.member_role;
begin
  caller := require_role(b, '{owner,admin}');
  if p_role in ('owner', 'admin') and caller <> 'owner' then
    raise exception 'Only the owner can add admins.' using errcode = '42501';
  end if;
  insert into memberships (business_id, user_id, role, status, display_name, phone)
  values (b, p_user, p_role, 'active', trim(p_name), nullif(trim(p_phone), ''))
  on conflict (business_id, user_id) do update
    set role = excluded.role, status = 'active', display_name = excluded.display_name;
end $$;

/** Approves, re-roles or suspends a member. Owners are protected. */
create function public.update_member(
  b uuid, p_user uuid, p_role public.member_role, p_status public.member_status, p_name text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  caller public.member_role;
  target memberships%rowtype;
begin
  caller := require_role(b, '{owner,admin}');
  select * into target from memberships where business_id = b and user_id = p_user for update;
  if not found then
    raise exception 'That person is not on this business.';
  end if;
  if (target.role in ('owner', 'admin') or p_role in ('owner', 'admin')) and caller <> 'owner' then
    raise exception 'Only the owner can change admins.' using errcode = '42501';
  end if;
  if target.role = 'owner' and (p_role <> 'owner' or p_status <> 'active')
     and (select count(*) from memberships where business_id = b and role = 'owner' and status = 'active') <= 1 then
    raise exception 'The business needs at least one active owner.';
  end if;
  update memberships
     set role = p_role, status = p_status, display_name = coalesce(nullif(trim(p_name), ''), display_name)
   where business_id = b and user_id = p_user;
  if target.status = 'pending' then
    perform resolve_alert_key(b, 'join:' || p_user,
      case when p_status = 'active' then 'Approved' else 'Declined' end);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------

/** Adds items (from the item form or a CSV import) with optional opening stock. */
create function public.create_products(b uuid, p_items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  pid uuid;
  value numeric := 0;
  n int := 0;
begin
  perform require_role(b, '{owner,admin}');
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    continue when coalesce(trim(it ->> 'name'), '') = '';
    pid := create_product_row(b, it);
    value := value + add_opening_stock(
      b, pid, resolve_location(b, nullif(it ->> 'location_id', '')::uuid),
      coalesce(nullif(it ->> 'opening_qty', '')::numeric, 0),
      round(coalesce(nullif(it ->> 'cost_price', '')::numeric, 0), 2), it);
    n := n + 1;
  end loop;
  perform post_journal(b, business_today(b), 'Opening stock for new items', 'products', null, jsonb_build_array(
    jsonb_build_object('key', 'inventory', 'debit', value),
    jsonb_build_object('key', 'equity', 'credit', value)));
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Sales
-- ---------------------------------------------------------------------------

/**
 * Records a POS sale. Payload:
 * { business_id, client_ref?, location_id?, customer_id?, order_type?, table_label?,
 *   discount?, prescription_ref?, note?, offline?, captured_at?,
 *   items: [{product_id, qty, unit_price?, discount?, serial_ids?, performed_by?}],
 *   payments: [{method, amount, currency?, reference?}] }
 */
create function public.record_sale(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := (p ->> 'business_id')::uuid;
  v_role public.member_role;
  biz businesses%rowtype;
  v_sale uuid := gen_random_uuid();
  v_ref uuid := nullif(p ->> 'client_ref', '')::uuid;
  v_existing record;
  v_loc uuid;
  v_customer uuid := nullif(p ->> 'customer_id', '')::uuid;
  v_cust customers%rowtype;
  v_offline boolean := coalesce((p ->> 'offline')::boolean, false);
  v_captured timestamptz := least(coalesce(nullif(p ->> 'captured_at', '')::timestamptz, now()), now());
  v_order_type text := coalesce(nullif(p ->> 'order_type', ''), 'counter');
  it jsonb;
  pay jsonb;
  prod products%rowtype;
  v_qty numeric;
  v_price numeric;
  v_list numeric;
  v_ldisc numeric;
  v_ltotal numeric;
  v_ucost numeric;
  v_subtotal numeric := 0;
  v_line_disc numeric := 0;
  v_sale_disc numeric := round(coalesce(nullif(p ->> 'discount', '')::numeric, 0), 2);
  v_goods numeric := 0;
  v_services numeric := 0;
  v_cost_total numeric := 0;
  v_total numeric;
  v_paid numeric := 0;
  v_credit numeric := 0;
  v_has_usd boolean := false;
  v_method text;
  v_cur text;
  v_amt numeric;
  v_fx numeric;
  v_base numeric;
  v_serials uuid[];
  v_n int;
  v_performer uuid;
  v_commission numeric;
  v_allocs jsonb;
  v_price_changed text[] := '{}';
  v_rx boolean := false;
  v_lines jsonb := '[]';
  v_receipt bigint;
  v_local_time time;
  v_short record;
begin
  if b is null then
    raise exception 'Choose a business.';
  end if;
  v_role := require_role(b, '{owner,admin,cashier,storekeeper}');
  select * into biz from businesses where id = b;
  if biz.sales_input_by = 'admin' and v_role not in ('owner', 'admin') then
    raise exception 'In this business only admins record sales.' using errcode = '42501';
  end if;

  -- Idempotency for offline sync.
  if v_ref is not null then
    select id, business_id, receipt_no, total into v_existing from sales where client_ref = v_ref;
    if found then
      if v_existing.business_id <> b then
        raise exception 'Duplicate sale reference.';
      end if;
      return jsonb_build_object('sale_id', v_existing.id, 'receipt_no', v_existing.receipt_no,
                                'total', v_existing.total, 'duplicate', true);
    end if;
  end if;

  if v_order_type not in ('counter', 'table', 'takeaway', 'delivery') then
    raise exception 'Unknown order type.';
  end if;
  v_loc := resolve_location(b, nullif(p ->> 'location_id', '')::uuid);
  if jsonb_typeof(p -> 'items') is distinct from 'array' or jsonb_array_length(p -> 'items') = 0 then
    raise exception 'Add at least one item to the sale.';
  end if;
  if v_customer is not null then
    select * into v_cust from customers where id = v_customer and business_id = b for update;
    if not found then
      raise exception 'That customer does not exist.';
    end if;
  end if;

  -- A sale made while offline already happened; record it even if the
  -- book stock is short, and flag the shortfall below.
  if v_offline then
    perform set_config('app.allow_negative_stock', 'on', true);
  end if;

  for it in select * from jsonb_array_elements(p -> 'items') loop
    select * into prod from products where id = (it ->> 'product_id')::uuid and business_id = b;
    if not found or not prod.is_active then
      raise exception 'An item in this sale is no longer in the catalogue.';
    end if;
    v_qty := (it ->> 'qty')::numeric;
    perform check_qty(prod, v_qty);

    v_list := prod.selling_price;
    v_price := round(coalesce(nullif(it ->> 'unit_price', '')::numeric, v_list), 2);
    if v_price < 0 then
      raise exception 'The price of % cannot be negative.', prod.name;
    end if;
    if v_price <> v_list then
      if prod.wholesale_price is not null and v_price = prod.wholesale_price then
        null; -- wholesale price is allowed for everyone
      elsif v_role in ('owner', 'admin') then
        v_price_changed := v_price_changed || (prod.name || ' ' || fmt_money(v_list) || ' → ' || fmt_money(v_price));
      else
        raise exception 'Only an admin can change the price of %.', prod.name using errcode = '42501';
      end if;
    end if;

    v_ldisc := round(coalesce(nullif(it ->> 'discount', '')::numeric, 0), 2);
    if v_ldisc < 0 or v_ldisc > round(v_qty * v_price, 2) then
      raise exception 'The discount on % is not valid.', prod.name;
    end if;
    v_ltotal := round(v_qty * v_price, 2) - v_ldisc;
    v_subtotal := v_subtotal + round(v_qty * v_price, 2);
    v_line_disc := v_line_disc + v_ldisc;
    v_rx := v_rx or prod.requires_prescription;

    v_serials := null;
    v_allocs := null;
    v_ucost := prod.cost_price;
    if prod.kind <> 'service' then
      if prod.track_mode = 'serial' then
        select array_agg(x::uuid) into v_serials
        from jsonb_array_elements_text(coalesce(it -> 'serial_ids', '[]')) x;
        if coalesce(array_length(v_serials, 1), 0) <> v_qty then
          raise exception 'Choose % serial number(s) / IMEI for %.', fmt_qty(v_qty), prod.name;
        end if;
        update serial_units
           set status = 'sold', sold_at = now(), sale_id = v_sale,
               warranty_until = case when coalesce(prod.warranty_months, 0) > 0
                                     then (business_today(b) + make_interval(months => prod.warranty_months))::date end
         where id = any (v_serials) and product_id = prod.id and business_id = b and status = 'in_stock';
        get diagnostics v_n = row_count;
        if v_n <> v_qty then
          raise exception 'One of the serial numbers for % is not in stock.', prod.name;
        end if;
        select coalesce(nullif(avg(unit_cost), 0), prod.cost_price) into v_ucost
        from serial_units where id = any (v_serials);
      elsif prod.track_mode = 'batch' then
        v_allocs := consume_batches(prod.id, v_qty);
      end if;
      insert into stock_movements (business_id, product_id, location_id, qty, reason, unit_cost, ref_table, ref_id)
      values (b, prod.id, v_loc, -v_qty, 'sale', v_ucost, 'sales', v_sale);
      v_cost_total := v_cost_total + round(v_qty * v_ucost, 2);
      v_goods := v_goods + v_ltotal;
    else
      v_ucost := 0;
      v_services := v_services + v_ltotal;
    end if;

    v_performer := nullif(it ->> 'performed_by', '')::uuid;
    if v_performer is not null and not exists (
      select 1 from memberships where business_id = b and user_id = v_performer and status = 'active') then
      raise exception 'The staff member chosen for % is not on this business.', prod.name;
    end if;
    v_commission := case when v_performer is not null then round(v_ltotal * prod.commission_pct / 100, 2) else 0 end;

    insert into sale_items (sale_id, business_id, product_id, name, kind, qty, unit_price, list_price, discount,
                            line_total, unit_cost, performed_by, commission_amount, serial_ids, batch_allocations)
    values (v_sale, b, prod.id, prod.name, prod.kind, v_qty, v_price, v_list, v_ldisc,
            v_ltotal, v_ucost, v_performer, v_commission, v_serials, v_allocs);
  end loop;

  if v_sale_disc < 0 or v_sale_disc > v_subtotal - v_line_disc then
    raise exception 'The discount is more than the sale.';
  end if;
  v_total := v_subtotal - v_line_disc - v_sale_disc;
  if v_role in ('cashier', 'storekeeper') and v_subtotal > 0
     and (v_line_disc + v_sale_disc) > round(v_subtotal * biz.max_staff_discount_pct / 100, 2) then
    raise exception 'Discounts above % percent need an admin.', fmt_qty(biz.max_staff_discount_pct)
      using errcode = '42501';
  end if;
  if v_sale_disc > 0 and (v_goods + v_services) > 0 then
    v_services := v_services - round(v_sale_disc * v_services / (v_goods + v_services), 2);
  end if;
  if v_rx and coalesce(trim(p ->> 'prescription_ref'), '') = '' then
    raise exception 'This sale includes prescription-only medicine. Enter the prescription reference.';
  end if;

  -- Payments
  if v_total > 0 and (jsonb_typeof(p -> 'payments') is distinct from 'array' or jsonb_array_length(p -> 'payments') = 0) then
    raise exception 'Add how the customer paid.';
  end if;
  for pay in select * from jsonb_array_elements(coalesce(p -> 'payments', '[]')) loop
    v_method := pay ->> 'method';
    perform check_method(biz, v_method, true);
    v_cur := coalesce(nullif(pay ->> 'currency', ''), 'SLE');
    if v_cur not in ('SLE', 'USD') then
      raise exception 'Payments must be in Leones or US dollars.';
    end if;
    v_amt := round((pay ->> 'amount')::numeric, 2);
    if v_amt is null or v_amt <= 0 then
      raise exception 'Enter the amount paid.';
    end if;
    v_fx := case when v_cur = 'USD' then biz.usd_rate else 1 end;
    v_has_usd := v_has_usd or v_cur = 'USD';
    v_base := round(v_amt * v_fx, 2);
    if v_method = 'credit' then
      if v_customer is null then
        raise exception 'Choose the customer who is buying on credit.';
      end if;
      v_credit := v_credit + v_base;
    end if;
    v_paid := v_paid + v_base;
    insert into sale_payments (sale_id, business_id, method, currency, amount, fx_rate, amount_base, reference)
    values (v_sale, b, v_method, v_cur, v_amt, v_fx, v_base, nullif(trim(pay ->> 'reference'), ''));
    v_lines := v_lines || jsonb_build_object('key', payment_account_key(v_method), 'debit', v_base);
  end loop;
  -- Dollar payments rarely convert to the exact Leone; allow up to Le 1 of rounding.
  if abs(v_paid - v_total) > (case when v_has_usd then 1 else 0.009 end) then
    raise exception 'Payments (%) do not match the sale total (%). Enter only the amount applied; give change separately.',
      fmt_money(v_paid), fmt_money(v_total);
  end if;

  if v_credit > 0 then
    if v_cust.credit_limit > 0 and v_cust.balance + v_credit > v_cust.credit_limit
       and v_role not in ('owner', 'admin') then
      raise exception '% would go over their credit limit of %.', v_cust.name, fmt_money(v_cust.credit_limit);
    end if;
    update customers set balance = balance + v_credit where id = v_customer;
  end if;

  insert into sales (id, business_id, receipt_no, client_ref, customer_id, location_id, order_type, table_label,
                     subtotal, discount, total, cost_total, prescription_ref, note, offline, captured_at)
  values (v_sale, b, next_counter(b, 'sale'), v_ref, v_customer, v_loc, v_order_type,
          nullif(trim(p ->> 'table_label'), ''), v_subtotal, v_line_disc + v_sale_disc, v_total, v_cost_total,
          nullif(trim(p ->> 'prescription_ref'), ''), nullif(trim(p ->> 'note'), ''), v_offline, v_captured)
  returning receipt_no into v_receipt;

  -- Revenue is credited with what was actually received so the entry balances
  -- to the cent even when a dollar payment rounds.
  v_lines := v_lines
    || jsonb_build_object('key', 'sales', 'credit', v_paid - v_services)
    || jsonb_build_object('key', 'service_sales', 'credit', v_services)
    || jsonb_build_object('key', 'cogs', 'debit', v_cost_total)
    || jsonb_build_object('key', 'inventory', 'credit', v_cost_total);
  perform post_journal(b, (v_captured at time zone 'Africa/Freetown')::date, 'Sale #' || v_receipt,
                       'sales', v_sale, v_lines);

  -- Fraud signals
  if array_length(v_price_changed, 1) > 0 then
    perform raise_alert(b, 'price_override', 'info', 'Price changed on sale #' || v_receipt,
      member_name(b, auth.uid()) || ' sold at a non-catalogue price: ' || array_to_string(v_price_changed, '; ') || '.',
      null, null, 'sales', v_sale);
  end if;
  if v_subtotal > 0 and (v_line_disc + v_sale_disc) >= v_subtotal * 0.2 then
    perform raise_alert(b, 'large_discount', 'warning', 'Large discount on sale #' || v_receipt,
      member_name(b, auth.uid()) || ' gave ' || fmt_money(v_line_disc + v_sale_disc) || ' off a '
        || fmt_money(v_subtotal) || ' sale.', null, null, 'sales', v_sale);
  end if;
  if biz.opening_time is not null and biz.closing_time is not null then
    v_local_time := (v_captured at time zone 'Africa/Freetown')::time;
    if (biz.opening_time < biz.closing_time and (v_local_time < biz.opening_time or v_local_time > biz.closing_time))
       or (biz.opening_time > biz.closing_time and v_local_time > biz.closing_time and v_local_time < biz.opening_time) then
      perform raise_alert(b, 'after_hours', 'warning', 'Sale outside business hours',
        member_name(b, auth.uid()) || ' recorded sale #' || v_receipt || ' (' || fmt_money(v_total) || ') at '
          || to_char(v_local_time, 'HH24:MI') || '.', 'after_hours:' || auth.uid() || ':' || business_today(b),
        null, 'sales', v_sale);
    end if;
  end if;
  if v_offline then
    for v_short in
      select p2.id, p2.name, sl.quantity, l.name as loc
      from sale_items si
      join products p2 on p2.id = si.product_id
      join stock_levels sl on sl.product_id = si.product_id and sl.location_id = v_loc
      join locations l on l.id = v_loc
      where si.sale_id = v_sale and sl.quantity < 0
    loop
      perform raise_alert(b, 'negative_stock', 'critical', v_short.name || ' sold below zero stock',
        'An offline sale (#' || v_receipt || ') took ' || v_short.name || ' at ' || v_short.loc
          || ' to ' || fmt_qty(v_short.quantity) || '. Stock may not have been received on the system.',
        'negative:' || v_short.id, v_short.id, 'sales', v_sale);
    end loop;
  end if;

  return jsonb_build_object('sale_id', v_sale, 'receipt_no', v_receipt, 'total', v_total, 'duplicate', false);
end $$;

create function public.void_sale_now(s public.sales, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  si record;
  v_credit numeric;
begin
  for si in
    select i.*, p.kind as prod_kind from sale_items i join products p on p.id = i.product_id
    where i.sale_id = s.id
  loop
    continue when si.kind = 'service';
    insert into stock_movements (business_id, product_id, location_id, qty, reason, unit_cost, ref_table, ref_id, note)
    values (s.business_id, si.product_id, s.location_id, si.qty, 'sale_void', si.unit_cost, 'sales', s.id, p_reason);
    perform restore_batches(si.batch_allocations);
  end loop;
  update serial_units set status = 'in_stock', sold_at = null, sale_id = null, warranty_until = null
  where sale_id = s.id;
  select coalesce(sum(amount_base), 0) into v_credit from sale_payments where sale_id = s.id and method = 'credit';
  if v_credit > 0 then
    update customers set balance = balance - v_credit where id = s.customer_id;
  end if;
  perform reverse_journal(s.business_id, 'sales', s.id, 'Void of sale #' || s.receipt_no);
  update sales set status = 'voided', voided_by = auth.uid(), voided_at = now(),
                   void_reason = coalesce(void_reason, p_reason)
  where id = s.id;
  perform resolve_alert_key(s.business_id, 'void:' || s.id, 'Voided');
end $$;

/**
 * Staff ask for a void (the owner approves it); admins void immediately.
 * Returns 'voided' or 'requested'.
 */
create function public.request_sale_void(p_sale uuid, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare
  s sales%rowtype;
  v_role public.member_role;
  recent int;
begin
  select * into s from sales where id = p_sale for update;
  if not found then
    raise exception 'Sale not found.';
  end if;
  v_role := require_role(s.business_id, '{owner,admin,cashier,storekeeper}');
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason for the void.';
  end if;
  if s.status = 'voided' then
    raise exception 'This sale has already been voided.';
  end if;

  if v_role in ('owner', 'admin') then
    update sales set void_reason = trim(p_reason), void_requested_by = coalesce(void_requested_by, auth.uid()),
                     void_requested_at = coalesce(void_requested_at, now())
    where id = s.id;
    select * into s from sales where id = p_sale;
    perform void_sale_now(s, trim(p_reason));
    return 'voided';
  end if;

  if s.created_by <> auth.uid() then
    raise exception 'You can only ask to void your own sales.' using errcode = '42501';
  end if;
  if s.status = 'void_requested' then
    return 'requested';
  end if;
  update sales set status = 'void_requested', void_reason = trim(p_reason), void_requested_by = auth.uid(),
                   void_requested_at = now(), void_review_note = null
  where id = s.id;
  perform raise_alert(s.business_id, 'void_request', 'warning', 'Void requested for sale #' || s.receipt_no,
    member_name(s.business_id, auth.uid()) || ' asked to void sale #' || s.receipt_no || ' (' || fmt_money(s.total)
      || '): ' || trim(p_reason), 'void:' || s.id, null, 'sales', s.id);

  select count(*) into recent from sales
  where business_id = s.business_id and void_requested_by = auth.uid()
    and void_requested_at > now() - interval '24 hours';
  if recent >= 3 then
    perform raise_alert(s.business_id, 'void_pattern', 'critical',
      member_name(s.business_id, auth.uid()) || ' asked for ' || recent || ' voids today',
      'Repeated voids can hide sales that were paid for. Check the receipts with the customer copies.',
      'void_pattern:' || auth.uid() || ':' || business_today(s.business_id), null, 'memberships', null,
      jsonb_build_object('user_id', auth.uid(), 'count', recent));
  end if;
  return 'requested';
end $$;

create function public.review_sale_void(p_sale uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s sales%rowtype;
begin
  select * into s from sales where id = p_sale for update;
  if not found then
    raise exception 'Sale not found.';
  end if;
  perform require_role(s.business_id, '{owner,admin}');
  if s.status <> 'void_requested' then
    raise exception 'There is no void request on this sale.';
  end if;
  if p_approve then
    update sales set void_review_note = nullif(trim(p_note), '') where id = s.id;
    perform void_sale_now(s, s.void_reason);
  else
    update sales set status = 'completed', void_review_note = coalesce(nullif(trim(p_note), ''), 'Declined')
    where id = s.id;
    perform resolve_alert_key(s.business_id, 'void:' || s.id, 'Declined');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Expenses and payments
-- ---------------------------------------------------------------------------

create function public.record_expense(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  b uuid := (p ->> 'business_id')::uuid;
  v_role public.member_role;
  biz businesses%rowtype;
  acc accounts%rowtype;
  v_id uuid := gen_random_uuid();
  v_amount numeric := round((p ->> 'amount')::numeric, 2);
  v_method text := coalesce(nullif(p ->> 'method', ''), 'cash');
  v_date date := coalesce(nullif(p ->> 'expense_date', '')::date, business_today(b));
  v_no bigint;
begin
  v_role := require_role(b, '{owner,admin,cashier,storekeeper}');
  select * into biz from businesses where id = b;
  select * into acc from accounts
  where id = (p ->> 'account_id')::uuid and business_id = b and is_expense_category and is_active;
  if not found then
    raise exception 'Choose an expense category.';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Enter the amount spent.';
  end if;
  perform check_method(biz, v_method);
  if v_date > business_today(b) then
    raise exception 'An expense cannot be dated in the future.';
  end if;
  if v_role in ('cashier', 'storekeeper') and v_date < business_today(b) - biz.staff_backdate_days then
    raise exception 'Staff can only record expenses from the last % day(s). Ask an admin.', biz.staff_backdate_days;
  end if;

  v_no := next_counter(b, 'expense');
  insert into expenses (id, business_id, expense_no, account_id, category_name, amount, method, paid_to, note, expense_date)
  values (v_id, b, v_no, acc.id, acc.name, v_amount, v_method, nullif(trim(p ->> 'paid_to'), ''),
          nullif(trim(p ->> 'note'), ''), v_date);
  perform post_journal(b, v_date, 'Expense #' || v_no || ': ' || acc.name, 'expenses', v_id, jsonb_build_array(
    jsonb_build_object('account_id', acc.id, 'debit', v_amount),
    jsonb_build_object('key', payment_account_key(v_method), 'credit', v_amount)));

  if v_role in ('cashier', 'storekeeper') and biz.staff_expense_alert_amount > 0
     and v_amount >= biz.staff_expense_alert_amount then
    perform raise_alert(b, 'large_expense', 'warning', 'Large expense by staff: ' || fmt_money(v_amount),
      member_name(b, auth.uid()) || ' recorded ' || fmt_money(v_amount) || ' for ' || acc.name
        || coalesce(' (' || nullif(trim(p ->> 'note'), '') || ')', '') || '.',
      null, null, 'expenses', v_id);
  end if;
  return v_id;
end $$;

create function public.void_expense(p_expense uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare e expenses%rowtype;
begin
  select * into e from expenses where id = p_expense for update;
  if not found then
    raise exception 'Expense not found.';
  end if;
  perform require_role(e.business_id, '{owner,admin}');
  if e.status = 'voided' then
    raise exception 'This expense has already been voided.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason for the void.';
  end if;
  update expenses set status = 'voided', void_reason = trim(p_reason), voided_by = auth.uid(), voided_at = now()
  where id = e.id;
  perform reverse_journal(e.business_id, 'expenses', e.id, 'Void of expense #' || e.expense_no);
end $$;

create function public.receive_customer_payment(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  b uuid := (p ->> 'business_id')::uuid;
  biz businesses%rowtype;
  c customers%rowtype;
  v_amount numeric := round((p ->> 'amount')::numeric, 2);
  v_method text := coalesce(nullif(p ->> 'method', ''), 'cash');
  v_id uuid;
begin
  perform require_role(b, '{owner,admin,cashier,storekeeper}');
  select * into biz from businesses where id = b;
  select * into c from customers where id = (p ->> 'customer_id')::uuid and business_id = b for update;
  if not found then
    raise exception 'Choose the customer who is paying.';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Enter the amount received.';
  end if;
  if v_amount > c.balance then
    raise exception '% only owes %.', c.name, fmt_money(c.balance);
  end if;
  perform check_method(biz, v_method);
  insert into customer_payments (business_id, customer_id, amount, method, note)
  values (b, c.id, v_amount, v_method, nullif(trim(p ->> 'note'), ''))
  returning id into v_id;
  update customers set balance = balance - v_amount where id = c.id;
  perform post_journal(b, business_today(b), 'Payment from ' || c.name, 'customer_payments', v_id, jsonb_build_array(
    jsonb_build_object('key', payment_account_key(v_method), 'debit', v_amount),
    jsonb_build_object('key', 'receivable', 'credit', v_amount)));
  return v_id;
end $$;

create function public.pay_supplier(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  b uuid := (p ->> 'business_id')::uuid;
  biz businesses%rowtype;
  s suppliers%rowtype;
  v_amount numeric := round((p ->> 'amount')::numeric, 2);
  v_method text := coalesce(nullif(p ->> 'method', ''), 'cash');
  v_id uuid;
begin
  perform require_role(b, '{owner,admin}');
  select * into biz from businesses where id = b;
  select * into s from suppliers where id = (p ->> 'supplier_id')::uuid and business_id = b for update;
  if not found then
    raise exception 'Choose the supplier you are paying.';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Enter the amount paid.';
  end if;
  if v_amount > s.balance_due then
    raise exception 'You owe % only %.', s.name, fmt_money(s.balance_due);
  end if;
  perform check_method(biz, v_method);
  insert into supplier_payments (business_id, supplier_id, amount, method, note)
  values (b, s.id, v_amount, v_method, nullif(trim(p ->> 'note'), ''))
  returning id into v_id;
  update suppliers set balance_due = balance_due - v_amount where id = s.id;
  perform post_journal(b, business_today(b), 'Payment to ' || s.name, 'supplier_payments', v_id, jsonb_build_array(
    jsonb_build_object('key', 'payable', 'debit', v_amount),
    jsonb_build_object('key', payment_account_key(v_method), 'credit', v_amount)));
  return v_id;
end $$;

create function public.record_owner_transaction(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  b uuid := (p ->> 'business_id')::uuid;
  biz businesses%rowtype;
  v_kind text := p ->> 'kind';
  v_amount numeric := round((p ->> 'amount')::numeric, 2);
  v_method text := coalesce(nullif(p ->> 'method', ''), 'cash');
  v_id uuid;
begin
  perform require_role(b, '{owner}');
  select * into biz from businesses where id = b;
  if v_kind not in ('capital', 'drawing') then
    raise exception 'Choose money in (capital) or money out (drawing).';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Enter the amount.';
  end if;
  perform check_method(biz, v_method);
  insert into owner_transactions (business_id, kind, amount, method, note)
  values (b, v_kind, v_amount, v_method, nullif(trim(p ->> 'note'), ''))
  returning id into v_id;
  perform post_journal(b, business_today(b),
    case when v_kind = 'capital' then 'Owner capital' else 'Owner drawing' end, 'owner_transactions', v_id,
    case when v_kind = 'capital' then jsonb_build_array(
      jsonb_build_object('key', payment_account_key(v_method), 'debit', v_amount),
      jsonb_build_object('key', 'equity', 'credit', v_amount))
    else jsonb_build_array(
      jsonb_build_object('key', 'drawings', 'debit', v_amount),
      jsonb_build_object('key', payment_account_key(v_method), 'credit', v_amount)) end);
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Stock in, stock moves
-- ---------------------------------------------------------------------------

/**
 * Goods received from a supplier. Payload:
 * { business_id, supplier_id? | supplier_name?, invoice_ref?, location_id?, note?,
 *   amount_paid?, payment_method?,
 *   items: [{product_id, qty, unit_cost, batch_no?, expiry_date?, serials?}] }
 */
create function public.receive_stock(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  b uuid := (p ->> 'business_id')::uuid;
  biz businesses%rowtype;
  v_id uuid := gen_random_uuid();
  v_supplier uuid := nullif(p ->> 'supplier_id', '')::uuid;
  v_supplier_name text := nullif(trim(p ->> 'supplier_name'), '');
  v_loc uuid;
  it jsonb;
  prod products%rowtype;
  v_qty numeric;
  v_cost numeric;
  v_old_qty numeric;
  v_total numeric := 0;
  v_paid numeric;
  v_method text := nullif(p ->> 'payment_method', '');
  v_serials text[];
  s text;
  v_no bigint;
begin
  perform require_role(b, '{owner,admin,cashier,storekeeper}');
  select * into biz from businesses where id = b;
  v_loc := resolve_location(b, nullif(p ->> 'location_id', '')::uuid, true);

  if v_supplier is not null then
    perform 1 from suppliers where id = v_supplier and business_id = b;
    if not found then
      raise exception 'That supplier does not exist.';
    end if;
  elsif v_supplier_name is not null then
    select id into v_supplier from suppliers where business_id = b and lower(name) = lower(v_supplier_name);
    if v_supplier is null then
      insert into suppliers (business_id, name) values (b, v_supplier_name) returning id into v_supplier;
    end if;
  end if;

  if jsonb_typeof(p -> 'items') is distinct from 'array' or jsonb_array_length(p -> 'items') = 0 then
    raise exception 'Add the items received.';
  end if;

  for it in select * from jsonb_array_elements(p -> 'items') loop
    select * into prod from products where id = (it ->> 'product_id')::uuid and business_id = b for update;
    if not found then
      raise exception 'An item received is not in the catalogue.';
    end if;
    if prod.kind = 'service' then
      raise exception '% is a service and has no stock.', prod.name;
    end if;
    v_qty := (it ->> 'qty')::numeric;
    perform check_qty(prod, v_qty);
    v_cost := round(coalesce(nullif(it ->> 'unit_cost', '')::numeric, prod.cost_price), 2);
    if v_cost < 0 then
      raise exception 'The cost of % cannot be negative.', prod.name;
    end if;

    if prod.cost_price > 0 and v_cost > prod.cost_price * 1.25 then
      perform raise_alert(b, 'cost_spike', 'warning', 'Cost of ' || prod.name || ' up '
          || round((v_cost / prod.cost_price - 1) * 100) || '%',
        member_name(b, auth.uid()) || ' received ' || prod.name || ' at ' || fmt_money(v_cost) || ' each; the average cost was '
          || fmt_money(prod.cost_price) || '. Check the supplier invoice.',
        null, prod.id, 'stock_receipts', v_id);
    end if;

    -- Weighted average cost
    v_old_qty := greatest(stock_total(prod.id), 0);
    update products
       set cost_price = case when v_old_qty + v_qty > 0
                             then round((v_old_qty * prod.cost_price + v_qty * v_cost) / (v_old_qty + v_qty), 2)
                             else v_cost end
     where id = prod.id;

    v_serials := null;
    if prod.track_mode = 'serial' then
      select array_agg(trim(x)) into v_serials
      from jsonb_array_elements_text(coalesce(it -> 'serials', '[]')) x where trim(x) <> '';
      if coalesce(array_length(v_serials, 1), 0) <> v_qty then
        raise exception 'Enter % serial number(s) / IMEI for %.', fmt_qty(v_qty), prod.name;
      end if;
      foreach s in array v_serials loop
        begin
          insert into serial_units (business_id, product_id, serial, unit_cost) values (b, prod.id, s, v_cost);
        exception when unique_violation then
          raise exception 'Serial number % is already recorded.', s;
        end;
      end loop;
    elsif prod.track_mode = 'batch' then
      insert into stock_batches (business_id, product_id, batch_no, expiry_date, quantity, unit_cost)
      values (b, prod.id, nullif(trim(it ->> 'batch_no'), ''), nullif(it ->> 'expiry_date', '')::date, v_qty, v_cost);
    end if;

    insert into stock_movements (business_id, product_id, location_id, qty, reason, unit_cost, ref_table, ref_id)
    values (b, prod.id, v_loc, v_qty, 'purchase', v_cost, 'stock_receipts', v_id);
    insert into stock_receipt_items (receipt_id, business_id, product_id, qty, unit_cost, line_total, batch_no, expiry_date, serials)
    values (v_id, b, prod.id, v_qty, v_cost, round(v_qty * v_cost, 2), nullif(trim(it ->> 'batch_no'), ''),
            nullif(it ->> 'expiry_date', '')::date, v_serials);
    v_total := v_total + round(v_qty * v_cost, 2);
  end loop;

  v_paid := round(coalesce(nullif(p ->> 'amount_paid', '')::numeric, v_total), 2);
  if v_paid < 0 or v_paid > v_total then
    raise exception 'Amount paid must be between Le 0 and the total of %.', fmt_money(v_total);
  end if;
  if v_paid > 0 then
    v_method := coalesce(v_method, 'cash');
    perform check_method(biz, v_method);
  else
    v_method := null;
  end if;
  if v_total - v_paid > 0 then
    if v_supplier is null then
      raise exception 'Choose the supplier you owe the balance to.';
    end if;
    update suppliers set balance_due = balance_due + (v_total - v_paid) where id = v_supplier;
  end if;

  v_no := next_counter(b, 'receipt');
  insert into stock_receipts (id, business_id, receipt_no, supplier_id, invoice_ref, location_id, total_cost,
                              amount_paid, payment_method, note)
  values (v_id, b, v_no, v_supplier, nullif(trim(p ->> 'invoice_ref'), ''), v_loc, v_total, v_paid, v_method,
          nullif(trim(p ->> 'note'), ''));

  perform post_journal(b, business_today(b), 'Stock received #' || v_no, 'stock_receipts', v_id, jsonb_build_array(
    jsonb_build_object('key', 'inventory', 'debit', v_total),
    jsonb_build_object('key', coalesce(payment_account_key(v_method), 'cash'), 'credit', v_paid),
    jsonb_build_object('key', 'payable', 'credit', v_total - v_paid)));
  return v_id;
end $$;

/**
 * Admin stock correction. reason: adjustment | damage | expired | return_in | opening.
 * Losses go to "Stock losses & shrinkage"; opening stock to owner's equity.
 */
create function public.adjust_stock(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  b uuid := (p ->> 'business_id')::uuid;
  prod products%rowtype;
  v_loc uuid;
  v_qty numeric := (p ->> 'qty')::numeric;
  v_reason text := coalesce(nullif(p ->> 'reason', ''), 'adjustment');
  v_note text := nullif(trim(p ->> 'note'), '');
  v_cost numeric;
  v_value numeric;
  v_serials uuid[];
  v_n int;
  v_ref uuid := gen_random_uuid();
begin
  perform require_role(b, '{owner,admin}');
  select * into prod from products where id = (p ->> 'product_id')::uuid and business_id = b for update;
  if not found or prod.kind = 'service' then
    raise exception 'Choose an item that holds stock.';
  end if;
  if v_reason not in ('adjustment', 'damage', 'expired', 'return_in', 'opening') then
    raise exception 'Choose a reason for the adjustment.';
  end if;
  if v_qty is null or v_qty = 0 then
    raise exception 'Enter how much to add or remove.';
  end if;
  perform check_qty(prod, abs(v_qty));
  if v_reason in ('damage', 'expired') and v_qty > 0 then
    v_qty := -v_qty;
  end if;
  if v_reason in ('return_in', 'opening') and v_qty < 0 then
    raise exception 'Returns and opening stock add to stock.';
  end if;
  if v_note is null and v_reason <> 'opening' then
    raise exception 'Explain the adjustment in the note.';
  end if;
  v_loc := resolve_location(b, nullif(p ->> 'location_id', '')::uuid);

  if v_reason = 'opening' then
    v_value := add_opening_stock(b, prod.id, v_loc, v_qty,
      round(coalesce(nullif(p ->> 'unit_cost', '')::numeric, prod.cost_price), 2), p);
    if prod.cost_price = 0 and nullif(p ->> 'unit_cost', '') is not null then
      update products set cost_price = round((p ->> 'unit_cost')::numeric, 2) where id = prod.id;
    end if;
    perform post_journal(b, business_today(b), 'Opening stock: ' || prod.name, 'stock_movements', v_ref,
      jsonb_build_array(jsonb_build_object('key', 'inventory', 'debit', v_value),
                        jsonb_build_object('key', 'equity', 'credit', v_value)));
  else
    v_cost := prod.cost_price;
    if prod.track_mode = 'serial' then
      if v_qty < 0 then
        select array_agg(x::uuid) into v_serials from jsonb_array_elements_text(coalesce(p -> 'serial_ids', '[]')) x;
        if coalesce(array_length(v_serials, 1), 0) <> -v_qty then
          raise exception 'Choose the % serial number(s) being removed.', fmt_qty(-v_qty);
        end if;
        update serial_units set status = 'defective', notes = v_note
        where id = any (v_serials) and product_id = prod.id and status = 'in_stock';
        get diagnostics v_n = row_count;
        if v_n <> -v_qty then
          raise exception 'One of those serial numbers is not in stock.';
        end if;
      else
        if (select count(*) from jsonb_array_elements_text(coalesce(p -> 'serials', '[]')) x where trim(x) <> '') <> v_qty then
          raise exception 'Enter % serial number(s).', fmt_qty(v_qty);
        end if;
        begin
          insert into serial_units (business_id, product_id, serial, unit_cost)
          select b, prod.id, trim(x), v_cost
          from jsonb_array_elements_text(p -> 'serials') x where trim(x) <> '';
        exception when unique_violation then
          raise exception 'One of those serial numbers is already in stock.';
        end;
      end if;
    elsif prod.track_mode = 'batch' then
      if v_qty < 0 then
        perform consume_batches(prod.id, -v_qty);
      else
        insert into stock_batches (business_id, product_id, batch_no, expiry_date, quantity, unit_cost)
        values (b, prod.id, nullif(trim(p ->> 'batch_no'), ''), nullif(p ->> 'expiry_date', '')::date, v_qty, v_cost);
      end if;
    end if;
    insert into stock_movements (business_id, product_id, location_id, qty, reason, unit_cost, ref_table, ref_id, note)
    values (b, prod.id, v_loc, v_qty, v_reason::public.movement_reason, v_cost, 'stock_movements', v_ref, v_note);
    v_value := round(abs(v_qty) * v_cost, 2);
    perform post_journal(b, business_today(b), initcap(replace(v_reason, '_', ' ')) || ': ' || prod.name,
      'stock_movements', v_ref,
      case when v_qty < 0 then jsonb_build_array(
        jsonb_build_object('key', 'shrinkage', 'debit', v_value),
        jsonb_build_object('key', 'inventory', 'credit', v_value))
      else jsonb_build_array(
        jsonb_build_object('key', 'inventory', 'debit', v_value),
        jsonb_build_object('key', 'shrinkage', 'credit', v_value)) end);
  end if;

  perform audit_write(b, 'stock_' || v_reason, 'products', prod.id::text,
    member_name(b, auth.uid()) || ' ' || case when v_qty < 0 then 'removed ' else 'added ' end
      || fmt_qty(abs(v_qty)) || ' ' || prod.unit || ' of ' || prod.name || coalesce(': ' || v_note, ''),
    null, jsonb_build_object('qty', v_qty, 'reason', v_reason, 'location_id', v_loc, 'note', v_note));
end $$;

create function public.transfer_stock(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  b uuid := (p ->> 'business_id')::uuid;
  prod products%rowtype;
  v_from uuid;
  v_to uuid;
  v_qty numeric := (p ->> 'qty')::numeric;
  v_ref uuid := gen_random_uuid();
begin
  perform require_role(b, '{owner,admin,storekeeper}');
  select * into prod from products where id = (p ->> 'product_id')::uuid and business_id = b;
  if not found or prod.kind = 'service' then
    raise exception 'Choose an item that holds stock.';
  end if;
  perform check_qty(prod, v_qty);
  v_from := resolve_location(b, (p ->> 'from_location_id')::uuid);
  v_to := resolve_location(b, (p ->> 'to_location_id')::uuid);
  if v_from = v_to then
    raise exception 'Choose two different locations.';
  end if;
  insert into stock_movements (business_id, product_id, location_id, qty, reason, unit_cost, ref_table, ref_id, note)
  values (b, prod.id, v_from, -v_qty, 'transfer_out', prod.cost_price, 'transfer', v_ref, nullif(trim(p ->> 'note'), '')),
         (b, prod.id, v_to, v_qty, 'transfer_in', prod.cost_price, 'transfer', v_ref, nullif(trim(p ->> 'note'), ''));
  perform audit_write(b, 'stock_transfer', 'products', prod.id::text,
    member_name(b, auth.uid()) || ' moved ' || fmt_qty(v_qty) || ' ' || prod.unit || ' of ' || prod.name,
    null, jsonb_build_object('qty', v_qty, 'from', v_from, 'to', v_to));
end $$;

/** Stock used up in the business: kitchen ingredients, salon products, workshop parts. */
create function public.record_usage(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  b uuid := (p ->> 'business_id')::uuid;
  v_loc uuid;
  it jsonb;
  prod products%rowtype;
  v_qty numeric;
  v_value numeric := 0;
  v_ref uuid := gen_random_uuid();
  v_note text := nullif(trim(p ->> 'note'), '');
begin
  perform require_role(b, '{owner,admin,storekeeper}');
  v_loc := resolve_location(b, nullif(p ->> 'location_id', '')::uuid);
  if v_note is null then
    raise exception 'Say what the stock was used for.';
  end if;
  for it in select * from jsonb_array_elements(coalesce(p -> 'items', '[]')) loop
    select * into prod from products where id = (it ->> 'product_id')::uuid and business_id = b;
    if not found or prod.kind = 'service' then
      raise exception 'Choose items that hold stock.';
    end if;
    v_qty := (it ->> 'qty')::numeric;
    perform check_qty(prod, v_qty);
    if prod.track_mode = 'batch' then
      perform consume_batches(prod.id, v_qty);
    end if;
    insert into stock_movements (business_id, product_id, location_id, qty, reason, unit_cost, ref_table, ref_id, note)
    values (b, prod.id, v_loc, -v_qty, 'usage', prod.cost_price, 'usage', v_ref, v_note);
    v_value := v_value + round(v_qty * prod.cost_price, 2);
  end loop;
  if v_value = 0 and not exists (select 1 from stock_movements where ref_id = v_ref) then
    raise exception 'Add the items used.';
  end if;
  perform post_journal(b, business_today(b), 'Stock used: ' || v_note, 'usage', v_ref, jsonb_build_array(
    jsonb_build_object('key', 'cogs', 'debit', v_value),
    jsonb_build_object('key', 'inventory', 'credit', v_value)));
  perform audit_write(b, 'stock_usage', 'stock_movements', v_ref::text,
    member_name(b, auth.uid()) || ' recorded stock used: ' || v_note, null, p - 'business_id');
end $$;

/**
 * A production run (sachet water, furniture, baked goods): raw materials out,
 * finished goods in at the cost of the materials used.
 */
create function public.record_production(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  b uuid := (p ->> 'business_id')::uuid;
  v_id uuid := gen_random_uuid();
  out_prod products%rowtype;
  prod products%rowtype;
  v_loc uuid;
  v_qty numeric := (p ->> 'qty')::numeric;
  it jsonb;
  v_in_qty numeric;
  v_input_cost numeric := 0;
  v_unit_cost numeric;
  v_old_qty numeric;
begin
  perform require_role(b, '{owner,admin,storekeeper}');
  select * into out_prod from products where id = (p ->> 'product_id')::uuid and business_id = b for update;
  if not found or out_prod.kind = 'service' then
    raise exception 'Choose the product made.';
  end if;
  perform check_qty(out_prod, v_qty);
  v_loc := resolve_location(b, nullif(p ->> 'location_id', '')::uuid);

  for it in select * from jsonb_array_elements(coalesce(p -> 'inputs', '[]')) loop
    select * into prod from products where id = (it ->> 'product_id')::uuid and business_id = b;
    if not found or prod.kind = 'service' then
      raise exception 'Choose the materials used.';
    end if;
    if prod.id = out_prod.id then
      raise exception 'A product cannot be made from itself.';
    end if;
    v_in_qty := (it ->> 'qty')::numeric;
    perform check_qty(prod, v_in_qty);
    if prod.track_mode = 'batch' then
      perform consume_batches(prod.id, v_in_qty);
    end if;
    insert into stock_movements (business_id, product_id, location_id, qty, reason, unit_cost, ref_table, ref_id)
    values (b, prod.id, resolve_location(b, nullif(it ->> 'location_id', '')::uuid), -v_in_qty, 'production_out',
            prod.cost_price, 'production_runs', v_id);
    v_input_cost := v_input_cost + round(v_in_qty * prod.cost_price, 2);
  end loop;

  v_unit_cost := round(v_input_cost / v_qty, 2);
  v_old_qty := greatest(stock_total(out_prod.id), 0);
  update products
     set cost_price = case when v_old_qty + v_qty > 0
                           then round((v_old_qty * out_prod.cost_price + v_qty * v_unit_cost) / (v_old_qty + v_qty), 2)
                           else v_unit_cost end
   where id = out_prod.id;
  if out_prod.track_mode = 'batch' then
    insert into stock_batches (business_id, product_id, batch_no, expiry_date, quantity, unit_cost)
    values (b, out_prod.id, nullif(trim(p ->> 'batch_no'), ''), nullif(p ->> 'expiry_date', '')::date, v_qty, v_unit_cost);
  end if;
  insert into stock_movements (business_id, product_id, location_id, qty, reason, unit_cost, ref_table, ref_id)
  values (b, out_prod.id, v_loc, v_qty, 'production_in', v_unit_cost, 'production_runs', v_id);
  insert into production_runs (id, business_id, run_no, product_id, qty, location_id, inputs, unit_cost, batch_no, note)
  values (v_id, b, next_counter(b, 'production'), out_prod.id, v_qty, v_loc, coalesce(p -> 'inputs', '[]'),
          v_unit_cost, nullif(trim(p ->> 'batch_no'), ''), nullif(trim(p ->> 'note'), ''));
  -- Materials cost and finished-goods value are equal; the inventory account is unchanged.
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Physical stock counts (blind) and reconciliation
-- ---------------------------------------------------------------------------

create function public.start_stock_count(b uuid, p_location uuid, p_note text default null, p_category uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_loc uuid;
begin
  perform require_role(b, '{owner,admin,cashier,storekeeper}');
  v_loc := resolve_location(b, p_location);
  insert into stock_counts (business_id, count_no, location_id, note)
  values (b, next_counter(b, 'count'), v_loc, nullif(trim(p_note), ''))
  returning id into v_id;
  insert into stock_count_lines (count_id, business_id, product_id)
  select v_id, b, p.id from products p
  where p.business_id = b and p.is_active and p.kind <> 'service'
    and (p_category is null or p.category_id = p_category)
  order by p.name;
  return v_id;
end $$;

create function public.save_stock_count(p_count uuid, p_lines jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  c stock_counts%rowtype;
  v_role public.member_role;
begin
  select * into c from stock_counts where id = p_count;
  if not found then
    raise exception 'Count not found.';
  end if;
  v_role := require_role(c.business_id, '{owner,admin,cashier,storekeeper}');
  if c.created_by <> auth.uid() and v_role not in ('owner', 'admin') then
    raise exception 'Only the person who started this count can fill it in.' using errcode = '42501';
  end if;
  if c.status <> 'draft' then
    raise exception 'This count has already been submitted.';
  end if;
  update stock_count_lines l
     set counted_qty = case when x ->> 'counted_qty' is null or x ->> 'counted_qty' = '' then null
                            else (x ->> 'counted_qty')::numeric end
    from jsonb_array_elements(coalesce(p_lines, '[]')) x
   where l.count_id = p_count and l.product_id = (x ->> 'product_id')::uuid;
end $$;

create function public.submit_stock_count(p_count uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c stock_counts%rowtype;
  biz businesses%rowtype;
  v_role public.member_role;
  v_loss numeric;
  v_gain numeric;
  v_expected_value numeric;
  v_short_lines int;
  v_loc_name text;
begin
  select * into c from stock_counts where id = p_count for update;
  if not found then
    raise exception 'Count not found.';
  end if;
  v_role := require_role(c.business_id, '{owner,admin,cashier,storekeeper}');
  if c.created_by <> auth.uid() and v_role not in ('owner', 'admin') then
    raise exception 'Only the person who started this count can submit it.' using errcode = '42501';
  end if;
  if c.status <> 'draft' then
    raise exception 'This count has already been submitted.';
  end if;
  select * into biz from businesses where id = c.business_id;

  delete from stock_count_lines where count_id = p_count and counted_qty is null;
  if not exists (select 1 from stock_count_lines where count_id = p_count) then
    raise exception 'Enter at least one counted quantity.';
  end if;
  update stock_count_lines l
     set expected_qty = coalesce((select quantity from stock_levels s
                                  where s.product_id = l.product_id and s.location_id = c.location_id), 0),
         unit_cost = p.cost_price
    from products p
   where l.count_id = p_count and p.id = l.product_id;

  select coalesce(sum(-least(variance, 0) * unit_cost), 0), coalesce(sum(greatest(variance, 0) * unit_cost), 0),
         coalesce(sum(greatest(expected_qty, 0) * unit_cost), 0),
         count(*) filter (where variance < 0
                            and -variance * 100 > greatest(expected_qty, 1) * biz.stock_variance_tolerance_pct)
    into v_loss, v_gain, v_expected_value, v_short_lines
  from stock_count_lines where count_id = p_count;

  update stock_counts set status = 'submitted', submitted_at = now(),
                          loss_value = round(v_loss, 2), gain_value = round(v_gain, 2)
  where id = p_count;

  select name into v_loc_name from locations where id = c.location_id;
  if v_short_lines > 0 and v_loss > 0 then
    perform raise_alert(c.business_id, 'stock_variance',
      case when v_expected_value > 0 and v_loss * 100 / v_expected_value > biz.stock_variance_tolerance_pct
           then 'critical' else 'warning' end,
      'Stock missing at ' || v_loc_name || ': ' || fmt_money(v_loss),
      'Count #' || c.count_no || ' by ' || member_name(c.business_id, c.created_by) || ' found ' || v_short_lines
        || ' item(s) short of the book stock. Review the count before approving it.',
      'count:' || p_count, null, 'stock_counts', p_count,
      jsonb_build_object('loss_value', v_loss, 'gain_value', v_gain, 'lines_short', v_short_lines));
  end if;
  return jsonb_build_object('loss_value', round(v_loss, 2), 'gain_value', round(v_gain, 2), 'lines_short', v_short_lines);
end $$;

create function public.review_stock_count(p_count uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  c stock_counts%rowtype;
  l record;
  v_net numeric := 0;
begin
  select * into c from stock_counts where id = p_count for update;
  if not found then
    raise exception 'Count not found.';
  end if;
  perform require_role(c.business_id, '{owner,admin}');
  if c.status <> 'submitted' then
    raise exception 'Only submitted counts can be reviewed.';
  end if;

  if p_approve then
    -- Sales since the count may already have taken the shelf lower.
    perform set_config('app.allow_negative_stock', 'on', true);
    for l in
      select cl.*, p.track_mode from stock_count_lines cl join products p on p.id = cl.product_id
      where cl.count_id = p_count and cl.variance <> 0
    loop
      insert into stock_movements (business_id, product_id, location_id, qty, reason, unit_cost, ref_table, ref_id, note)
      values (c.business_id, l.product_id, c.location_id, l.variance, 'count_variance', l.unit_cost,
              'stock_counts', c.id, 'Count #' || c.count_no);
      if l.track_mode = 'batch' and l.variance < 0 then
        perform consume_batches(l.product_id, -l.variance);
      end if;
      v_net := v_net + round(l.variance * l.unit_cost, 2);
    end loop;
    perform post_journal(c.business_id, business_today(c.business_id), 'Stock count #' || c.count_no,
      'stock_counts', c.id,
      case when v_net < 0 then jsonb_build_array(
        jsonb_build_object('key', 'shrinkage', 'debit', -v_net),
        jsonb_build_object('key', 'inventory', 'credit', -v_net))
      else jsonb_build_array(
        jsonb_build_object('key', 'inventory', 'debit', v_net),
        jsonb_build_object('key', 'shrinkage', 'credit', v_net)) end);
    update alerts set status = 'acknowledged', updated_at = now()
    where business_id = c.business_id and dedupe_key = 'count:' || c.id and status = 'open';
  end if;

  update stock_counts set status = case when p_approve then 'approved' else 'rejected' end,
                          reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(trim(p_note), '')
  where id = p_count;
end $$;

-- ---------------------------------------------------------------------------
-- Cash-up: what the till should hold vs what was counted
-- ---------------------------------------------------------------------------

/** What the caller's till should hold since their last cash-up. Used for the preview and the submission. */
create function public.cash_up_expected(b uuid, p_float numeric default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_start timestamptz;
  v_end timestamptz := now();
  v_cash numeric;
  v_usd numeric;
  v_momo jsonb;
  v_sales_count int;
begin
  perform require_role(b, '{owner,admin,cashier,storekeeper}');
  select max(period_end) into v_start from cash_ups where business_id = b and user_id = uid;
  v_start := coalesce(v_start, (business_today(b)::timestamp at time zone 'Africa/Freetown'));

  with money_in as (
    select sp.method, sp.currency, sp.amount, sp.amount_base
    from sale_payments sp join sales s on s.id = sp.sale_id
    where s.business_id = b and s.created_by = uid and s.status <> 'voided'
      and s.created_at > v_start and s.created_at <= v_end
    union all
    select method, 'SLE', amount, amount from customer_payments
    where business_id = b and created_by = uid and created_at > v_start and created_at <= v_end
    union all
    select method, 'SLE', amount, amount from job_payments
    where business_id = b and created_by = uid and created_at > v_start and created_at <= v_end
    union all
    select method, 'SLE', amount, amount from owner_transactions
    where business_id = b and created_by = uid and kind = 'capital' and created_at > v_start and created_at <= v_end
  ), money_out as (
    select method, amount from expenses
    where business_id = b and created_by = uid and status = 'recorded' and created_at > v_start and created_at <= v_end
    union all
    select payment_method, amount_paid from stock_receipts
    where business_id = b and created_by = uid and amount_paid > 0 and created_at > v_start and created_at <= v_end
    union all
    select method, amount from supplier_payments
    where business_id = b and created_by = uid and created_at > v_start and created_at <= v_end
    union all
    select method, amount from owner_transactions
    where business_id = b and created_by = uid and kind = 'drawing' and created_at > v_start and created_at <= v_end
  )
  select
    coalesce((select sum(amount) from money_in where method = 'cash' and currency = 'SLE'), 0)
      - coalesce((select sum(amount) from money_out where method = 'cash'), 0),
    coalesce((select sum(amount) from money_in where method = 'cash' and currency = 'USD'), 0),
    coalesce((select jsonb_object_agg(m, total) from (
      select m, sum(v) as total from (
        select method as m, amount_base as v from money_in where method not in ('cash', 'credit')
        union all
        select method, -amount from money_out where method <> 'cash'
      ) x group by m) y), '{}')
  into v_cash, v_usd, v_momo;

  select count(*) into v_sales_count from sales
  where business_id = b and created_by = uid and status <> 'voided' and created_at > v_start and created_at <= v_end;

  return jsonb_build_object(
    'period_start', v_start, 'period_end', v_end,
    'opening_float', round(coalesce(p_float, 0), 2),
    'expected_cash', round(coalesce(p_float, 0) + v_cash, 2),
    'expected_usd', round(v_usd, 2),
    'momo_expected', v_momo,
    'sales_count', v_sales_count);
end $$;

create function public.submit_cash_up(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := (p ->> 'business_id')::uuid;
  biz businesses%rowtype;
  e jsonb;
  v_counted numeric := round((p ->> 'counted_cash')::numeric, 2);
  v_counted_usd numeric := round(coalesce(nullif(p ->> 'counted_usd', '')::numeric, 0), 2);
  v_variance numeric;
  v_id uuid;
begin
  perform require_role(b, '{owner,admin,cashier,storekeeper}');
  select * into biz from businesses where id = b;
  if v_counted is null or v_counted < 0 or v_counted_usd < 0 then
    raise exception 'Enter the cash you counted.';
  end if;
  e := cash_up_expected(b, coalesce(nullif(p ->> 'opening_float', '')::numeric, 0));
  v_variance := round((v_counted + v_counted_usd * biz.usd_rate)
                      - ((e ->> 'expected_cash')::numeric + (e ->> 'expected_usd')::numeric * biz.usd_rate), 2);

  insert into cash_ups (business_id, period_start, period_end, opening_float, expected_cash, expected_usd,
                        counted_cash, counted_usd, usd_rate, variance, momo_expected, note)
  values (b, (e ->> 'period_start')::timestamptz, (e ->> 'period_end')::timestamptz,
          (e ->> 'opening_float')::numeric, (e ->> 'expected_cash')::numeric, (e ->> 'expected_usd')::numeric,
          v_counted, v_counted_usd, biz.usd_rate, v_variance, e -> 'momo_expected', nullif(trim(p ->> 'note'), ''))
  returning id into v_id;

  if v_variance < -biz.cash_variance_tolerance then
    perform raise_alert(b, 'cash_shortage', 'critical',
      'Cash short by ' || fmt_money(-v_variance) || ': ' || member_name(b, auth.uid()),
      'Expected ' || fmt_money((e ->> 'expected_cash')::numeric)
        || case when (e ->> 'expected_usd')::numeric > 0 then ' + $' || (e ->> 'expected_usd') else '' end
        || ', counted ' || fmt_money(v_counted)
        || case when v_counted_usd > 0 then ' + $' || v_counted_usd else '' end || '.',
      'cashup:' || v_id, null, 'cash_ups', v_id, jsonb_build_object('variance', v_variance, 'user_id', auth.uid()));
  elsif v_variance > biz.cash_variance_tolerance then
    perform raise_alert(b, 'cash_overage', 'info',
      'Cash over by ' || fmt_money(v_variance) || ': ' || member_name(b, auth.uid()),
      'More cash than recorded sales. A sale may not have been entered.',
      'cashup:' || v_id, null, 'cash_ups', v_id, jsonb_build_object('variance', v_variance, 'user_id', auth.uid()));
  end if;
  return e || jsonb_build_object('id', v_id, 'variance', v_variance, 'counted_cash', v_counted,
                                 'counted_usd', v_counted_usd);
end $$;

create function public.review_cash_up(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c cash_ups%rowtype;
begin
  select * into c from cash_ups where id = p_id for update;
  if not found then
    raise exception 'Cash-up not found.';
  end if;
  perform require_role(c.business_id, '{owner,admin}');
  update cash_ups set status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now(),
                      review_note = nullif(trim(p_note), '')
  where id = p_id;
  perform resolve_alert_key(c.business_id, 'cashup:' || p_id, coalesce(nullif(trim(p_note), ''), 'Reviewed'));
end $$;

-- ---------------------------------------------------------------------------
-- Jobs, alerts, expiry scan
-- ---------------------------------------------------------------------------

create function public.record_job_payment(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  j jobs%rowtype;
  biz businesses%rowtype;
  v_amount numeric := round((p ->> 'amount')::numeric, 2);
  v_method text := coalesce(nullif(p ->> 'method', ''), 'cash');
  v_id uuid;
begin
  select * into j from jobs where id = (p ->> 'job_id')::uuid for update;
  if not found then
    raise exception 'Job not found.';
  end if;
  perform require_role(j.business_id, '{owner,admin,cashier,storekeeper}');
  select * into biz from businesses where id = j.business_id;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Enter the amount received.';
  end if;
  perform check_method(biz, v_method);
  insert into job_payments (business_id, job_id, amount, method, note)
  values (j.business_id, j.id, v_amount, v_method, nullif(trim(p ->> 'note'), ''))
  returning id into v_id;
  perform set_config('app.job_payment', 'on', true);
  update jobs set amount_paid = amount_paid + v_amount where id = j.id;
  perform set_config('app.job_payment', 'off', true);
  perform post_journal(j.business_id, business_today(j.business_id), 'Payment for job #' || j.job_no || ': ' || j.title,
    'job_payments', v_id, jsonb_build_array(
      jsonb_build_object('key', payment_account_key(v_method), 'debit', v_amount),
      jsonb_build_object('key', 'service_sales', 'credit', v_amount)));
  return v_id;
end $$;

create function public.update_alert(p_alert uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a alerts%rowtype;
begin
  select * into a from alerts where id = p_alert for update;
  if not found then
    raise exception 'Alert not found.';
  end if;
  perform require_role(a.business_id, '{owner,admin}');
  if p_status not in ('open', 'acknowledged', 'resolved') then
    raise exception 'Unknown alert status.';
  end if;
  update alerts set status = p_status, updated_at = now(),
                    resolved_by = case when p_status = 'resolved' then auth.uid() end,
                    resolved_at = case when p_status = 'resolved' then now() end,
                    resolution_note = coalesce(nullif(trim(p_note), ''), resolution_note)
  where id = p_alert;
  perform audit_write(a.business_id, 'alert_' || p_status, 'alerts', a.id::text, a.title,
    jsonb_build_object('status', a.status), jsonb_build_object('status', p_status, 'note', p_note));
end $$;

/** Raises alerts for batches expired or expiring within 30 days. Returns how many. */
create function public.scan_expiries(b uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n int := 0;
begin
  if not is_service_role() then
    perform require_role(b, '{owner,admin}');
  end if;
  for r in
    select sb.id, sb.batch_no, sb.expiry_date, sb.quantity, p.id as product_id, p.name, p.unit
    from stock_batches sb join products p on p.id = sb.product_id
    where sb.business_id = b and sb.quantity > 0 and sb.expiry_date is not null
      and sb.expiry_date <= business_today(b) + 30
  loop
    perform raise_alert(b, 'expiry',
      case when r.expiry_date <= business_today(b) then 'critical' else 'warning' end,
      case when r.expiry_date <= business_today(b) then r.name || ' has expired'
           else r.name || ' expires ' || to_char(r.expiry_date, 'DD Mon') end,
      fmt_qty(r.quantity) || ' ' || r.unit || coalesce(' in batch ' || r.batch_no, '') || ' expire'
        || case when r.expiry_date <= business_today(b) then 'd' else 's' end || ' on '
        || to_char(r.expiry_date, 'DD Mon YYYY') || '. Sell first, return to the supplier, or write off.',
      'expiry:' || r.id, r.product_id, 'stock_batches', r.id,
      jsonb_build_object('expiry_date', r.expiry_date, 'quantity', r.quantity));
    n := n + 1;
  end loop;
  return n;
end $$;
