-- Goods returns, exchanges, refunds and damaged goods.
--
-- A return never edits the sale it comes from. It is its own append-only
-- record (returns + return_items) pointing back at the sale, and it posts its
-- own journal entry dated the day of the return, so earlier periods keep
-- their figures:
--
--   Dr Sales returns (contra revenue)      value given back for the goods
--   Dr Inventory    / Cr Cost of goods     goods that go back on the shelf
--   Dr Stock losses / Cr Cost of goods     damaged goods, written off
--   Cr Accounts receivable                 goods bought on credit come off the debt first
--   Cr Customer store credit               credit kept for later, or spent on an exchange
--   Cr Cash / mobile money                 money handed back
--
-- An exchange is the return plus a normal sale (record_sale) paid with the
-- value of the returned goods, so the replacement items move stock, show in
-- the sales history and carry their own receipt. Store credit is a liability
-- that record_sale can spend (payment method 'store_credit').
--
-- Every return needs a manager's 4-digit PIN, checked here. PINs are bcrypt
-- hashes in a table no client can read; five wrong PINs for a manager in 15
-- minutes lock that PIN until the window passes or the manager sets a new one.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Types, columns and accounts
-- ---------------------------------------------------------------------------

create type public.return_type as enum ('refund', 'exchange', 'damaged');
create type public.refund_method as enum ('cash', 'mobile_money', 'store_credit');

-- What the business owes the customer in goods (the opposite of balance).
alter table public.customers
  add column store_credit numeric(14, 2) not null default 0 check (store_credit >= 0);

alter table public.sale_payments drop constraint sale_payments_method_check;
alter table public.sale_payments add constraint sale_payments_method_check
  check (method in ('cash', 'orange_money', 'afrimoney', 'qmoney', 'bank', 'credit', 'store_credit'));

-- The two new system accounts, for businesses that already exist...
insert into public.accounts (business_id, code, name, type, system_key)
select b.id, x.code, x.name, x.type, x.system_key
from public.businesses b
cross join (values ('2100', 'Customer store credit', 'liability', 'store_credit'),
                   ('4900', 'Sales returns', 'revenue', 'sales_returns')) as x (code, name, type, system_key)
on conflict do nothing;

-- ...and for new ones.
create or replace function public.seed_accounts(b uuid, extra_expense_categories text[] default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare
  cat text;
  n int := 0;
begin
  insert into accounts (business_id, code, name, type, system_key) values
    (b, '1000', 'Cash on hand',          'asset',     'cash'),
    (b, '1010', 'Orange Money',          'asset',     'orange_money'),
    (b, '1020', 'Afrimoney',             'asset',     'afrimoney'),
    (b, '1030', 'QMoney',                'asset',     'qmoney'),
    (b, '1040', 'Bank',                  'asset',     'bank'),
    (b, '1100', 'Accounts receivable',   'asset',     'receivable'),
    (b, '1200', 'Inventory',             'asset',     'inventory'),
    (b, '2000', 'Accounts payable',      'liability', 'payable'),
    (b, '2100', 'Customer store credit', 'liability', 'store_credit'),
    (b, '3000', 'Owner''s equity',       'equity',    'equity'),
    (b, '3100', 'Owner''s drawings',     'equity',    'drawings'),
    (b, '4000', 'Sales of goods',        'revenue',   'sales'),
    (b, '4100', 'Service income',        'revenue',   'service_sales'),
    (b, '4900', 'Sales returns',         'revenue',   'sales_returns'),
    (b, '5000', 'Cost of goods sold',    'expense',   'cogs'),
    (b, '5100', 'Stock losses & shrinkage', 'expense', 'shrinkage');

  insert into accounts (business_id, code, name, type, is_expense_category)
  select b, '6' || lpad((row_number() over ())::text, 3, '0'), c, 'expense', true
  from unnest(array[
    'Transport & logistics',
    'Electricity (EDSA)',
    'Generator fuel',
    'Packaging materials',
    'Wages & salaries',
    'Rent',
    'Repairs & maintenance',
    'Phone & internet',
    'Taxes, levies & licences',
    'Bank & mobile money charges',
    'Staff commissions',
    'Other expenses'
  ]) as c;

  select count(*) into n from accounts where business_id = b and is_expense_category;
  foreach cat in array coalesce(extra_expense_categories, '{}') loop
    cat := trim(cat);
    continue when cat = '' or exists (
      select 1 from accounts where business_id = b and lower(name) = lower(cat));
    n := n + 1;
    insert into accounts (business_id, code, name, type, is_expense_category)
    values (b, '6' || lpad(n::text, 3, '0'), cat, 'expense', true);
  end loop;
end $$;

create or replace function public.payment_account_key(method text) returns text
language sql immutable as $$
  select case method
    when 'credit' then 'receivable'
    when 'cash' then 'cash'
    when 'orange_money' then 'orange_money'
    when 'afrimoney' then 'afrimoney'
    when 'qmoney' then 'qmoney'
    when 'bank' then 'bank'
    when 'store_credit' then 'store_credit'
  end
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  return_no bigint not null,
  -- Set by the browser so a return submitted twice is stored once.
  client_ref uuid unique,
  original_sale_id uuid not null references public.sales (id),
  customer_id uuid references public.customers (id),
  location_id uuid not null references public.locations (id),
  return_type public.return_type not null,
  reason_code text not null check (reason_code in ('changed_mind', 'defective', 'wrong_item', 'expired', 'other')),
  reason text not null check (length(trim(reason)) between 3 and 300),
  -- Value given back for the goods, then where it went.
  total_refund_amount numeric(14, 2) not null check (total_refund_amount >= 0),
  applied_to_balance numeric(14, 2) not null default 0 check (applied_to_balance >= 0),
  exchange_amount numeric(14, 2) not null default 0 check (exchange_amount >= 0),
  refund_paid numeric(14, 2) not null default 0 check (refund_paid >= 0),
  refund_method public.refund_method,
  momo_provider text check (momo_provider in ('orange_money', 'afrimoney', 'qmoney')),
  exchange_sale_id uuid references public.sales (id),
  restocked_cost numeric(14, 2) not null default 0,
  written_off_cost numeric(14, 2) not null default 0,
  processed_by uuid not null default auth.uid(),
  approved_by uuid not null,
  created_at timestamptz not null default now(),
  unique (business_id, return_no),
  check (applied_to_balance + exchange_amount + refund_paid = total_refund_amount),
  check ((refund_paid > 0) = (refund_method is not null)),
  check ((refund_method is not distinct from 'mobile_money') = (momo_provider is not null)),
  check ((return_type = 'exchange') = (exchange_sale_id is not null))
);
create index returns_business_created_idx on public.returns (business_id, created_at desc);
create index returns_sale_idx on public.returns (original_sale_id);
create index returns_exchange_sale_idx on public.returns (exchange_sale_id) where exchange_sale_id is not null;
create index returns_processor_idx on public.returns (business_id, processed_by, created_at);

create table public.return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.returns (id),
  business_id uuid not null,
  sale_item_id uuid not null references public.sale_items (id),
  product_id uuid not null references public.products (id),
  name text not null,
  kind text not null,
  quantity_returned numeric(14, 3) not null check (quantity_returned > 0),
  -- true: sellable, back in stock. false: damaged / unsellable, written off.
  restock_to_inventory boolean not null,
  unit_cost numeric(14, 2) not null default 0,
  refund_amount numeric(14, 2) not null check (refund_amount >= 0),
  serial_ids uuid[],
  batch_allocations jsonb
);
create index return_items_return_idx on public.return_items (return_id);
create index return_items_sale_item_idx on public.return_items (sale_item_id);

-- One PIN per manager per business. Only the functions below read this table.
create table public.manager_pins (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  pin_hash text not null,
  updated_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create table public.pin_failures (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  manager_id uuid not null,
  attempted_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index pin_failures_window_idx on public.pin_failures (business_id, manager_id, created_at);

create trigger returns_immutable before update or delete on public.returns
  for each row execute function public.forbid_change();
create trigger return_items_immutable before update or delete on public.return_items
  for each row execute function public.forbid_change();
create trigger pin_failures_immutable before update or delete on public.pin_failures
  for each row execute function public.forbid_change();
create trigger audit_returns after insert on public.returns
  for each row execute function public.audit_row();

/**
 * A sale with returns against it, or one that is the replacement side of an
 * exchange, can no longer be voided: the void would reverse the whole sale
 * and count the returned goods twice. Further returns are the way back.
 */
create function public.guard_sale_void_after_return() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_no bigint;
begin
  if new.status in ('void_requested', 'voided') and new.status is distinct from old.status then
    select return_no into v_no from returns where exchange_sale_id = old.id limit 1;
    if found then
      raise exception 'This sale is the exchange for return #%, so it cannot be voided. Record a return on it instead.', v_no;
    end if;
    if exists (select 1 from returns where original_sale_id = old.id) then
      raise exception 'Goods from this sale have already been returned, so it cannot be voided. Record a return for the rest instead.';
    end if;
  end if;
  return new;
end $$;
create trigger sales_guard_returns before update of status on public.sales
  for each row execute function public.guard_sale_void_after_return();

-- ---------------------------------------------------------------------------
-- Manager PINs
-- ---------------------------------------------------------------------------

/** An owner or admin sets (or replaces) their own 4-digit PIN. */
create function public.set_manager_pin(b uuid, p_pin text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_role(b, '{owner,admin}');
  if coalesce(p_pin, '') !~ '^[0-9]{4}$' then
    raise exception 'The PIN must be exactly 4 digits.';
  end if;
  if p_pin ~ '^([0-9])\1{3}$' or p_pin in ('0123', '1234', '2345', '3456', '4567', '5678', '6789',
                                           '9876', '8765', '7654', '6543', '5432', '4321', '3210') then
    raise exception 'That PIN is too easy to guess. Choose another.';
  end if;
  insert into manager_pins (business_id, user_id, pin_hash, updated_at)
  values (b, auth.uid(), extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), now())
  on conflict (business_id, user_id) do update set pin_hash = excluded.pin_hash, updated_at = now();
  perform audit_write(b, 'manager_pin_set', 'memberships', auth.uid()::text,
                      member_name(b, auth.uid()) || ' set a new manager PIN');
end $$;

/**
 * True when p_pin is the manager's PIN. A wrong PIN is logged (three in 15
 * minutes raise a critical alert); five lock the PIN out for 15 minutes.
 * Callers must not raise after a false, or the log entry is rolled back.
 */
create function public.verify_manager_pin(b uuid, p_manager uuid, p_pin text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_pin manager_pins%rowtype;
  v_fails int;
begin
  if p_manager is null then
    raise exception 'Choose the manager who is approving this.';
  end if;
  if not exists (select 1 from memberships where business_id = b and user_id = p_manager
                   and status = 'active' and role in ('owner', 'admin')) then
    raise exception 'Only an owner or admin can approve this.' using errcode = '42501';
  end if;
  select * into v_pin from manager_pins where business_id = b and user_id = p_manager;
  if not found then
    raise exception '% has not set a manager PIN yet. They can set one in Settings.', member_name(b, p_manager);
  end if;
  select count(*) into v_fails from pin_failures
  where business_id = b and manager_id = p_manager
    and created_at > greatest(now() - interval '15 minutes', v_pin.updated_at);
  if v_fails >= 5 then
    raise exception 'Too many wrong PINs for %. Wait 15 minutes, or ask them to set a new PIN.', member_name(b, p_manager)
      using errcode = '42501';
  end if;
  if coalesce(p_pin, '') ~ '^[0-9]{4}$' and extensions.crypt(p_pin, v_pin.pin_hash) = v_pin.pin_hash then
    return true;
  end if;

  insert into pin_failures (business_id, manager_id) values (b, p_manager);
  if v_fails + 1 >= 3 then
    perform raise_alert(b, 'pin_failures', 'critical',
      'Wrong manager PIN entered ' || (v_fails + 1) || ' times',
      member_name(b, auth.uid()) || ' entered a wrong PIN for ' || member_name(b, p_manager)
        || ' ' || (v_fails + 1) || ' times in 15 minutes while recording a return.',
      'pin:' || p_manager || ':' || business_today(b), null, 'memberships', null,
      jsonb_build_object('manager_id', p_manager, 'attempted_by', auth.uid(), 'failures', v_fails + 1));
  end if;
  return false;
end $$;

/** Who can approve returns, and whether the caller has a PIN of their own. */
create function public.manager_pin_status(b uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_role(b, '{owner,admin,cashier,storekeeper}');
  return jsonb_build_object(
    'my_pin_set_at', (select updated_at from manager_pins where business_id = b and user_id = auth.uid()),
    'managers', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', m.display_name, 'role', m.role,
                                          'has_pin', mp.user_id is not null)
                       order by m.role, m.display_name)
      from memberships m
      left join manager_pins mp on mp.business_id = m.business_id and mp.user_id = m.user_id
      where m.business_id = b and m.status = 'active' and m.role in ('owner', 'admin')), '[]'));
end $$;

-- ---------------------------------------------------------------------------
-- Sales: store credit as a way to pay
-- ---------------------------------------------------------------------------

/**
 * Records a POS sale. Payload:
 * { business_id, client_ref?, location_id?, customer_id?, order_type?, table_label?,
 *   discount?, prescription_ref?, note?, offline?, captured_at?,
 *   items: [{product_id, qty, unit_price?, discount?, serial_ids?, performed_by?}],
 *   payments: [{method, amount, currency?, reference?}] }
 *
 * method 'store_credit' spends the customer's store credit. During an
 * exchange, process_return first makes the returned goods' value available
 * (app.exchange_credit) and that is spent before any credit on the account.
 */
create or replace function public.record_sale(p jsonb) returns jsonb
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
  v_store_credit numeric := 0;
  v_exchange numeric;
  v_take numeric;
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
    v_cur := coalesce(nullif(pay ->> 'currency', ''), 'SLE');
    if v_method = 'store_credit' then
      if v_cur <> 'SLE' then
        raise exception 'Store credit is spent in Leones.';
      end if;
    else
      perform check_method(biz, v_method, true);
    end if;
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
    elsif v_method = 'store_credit' then
      v_exchange := coalesce(nullif(current_setting('app.exchange_credit', true), '')::numeric, 0);
      v_take := least(v_exchange, v_base);
      if v_take > 0 then
        perform set_config('app.exchange_credit', (v_exchange - v_take)::text, true);
      end if;
      if v_base > v_take then
        if v_customer is null then
          raise exception 'Choose the customer whose store credit is being used.';
        end if;
        v_store_credit := v_store_credit + (v_base - v_take);
      end if;
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
  if v_store_credit > 0 then
    if v_store_credit > v_cust.store_credit then
      raise exception '% has only % of store credit.', v_cust.name, fmt_money(v_cust.store_credit);
    end if;
    update customers set store_credit = store_credit - v_store_credit where id = v_customer;
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

-- A voided sale paid with store credit gives the credit back.
create or replace function public.void_sale_now(s public.sales, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  si record;
  v_credit numeric;
  v_store_credit numeric;
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
  select coalesce(sum(amount_base), 0) into v_store_credit from sale_payments where sale_id = s.id and method = 'store_credit';
  if v_store_credit > 0 then
    update customers set store_credit = store_credit + v_store_credit where id = s.customer_id;
  end if;
  perform reverse_journal(s.business_id, 'sales', s.id, 'Void of sale #' || s.receipt_no);
  update sales set status = 'voided', voided_by = auth.uid(), voided_at = now(),
                   void_reason = coalesce(void_reason, p_reason)
  where id = s.id;
  perform resolve_alert_key(s.business_id, 'void:' || s.id, 'Voided');
end $$;

-- ---------------------------------------------------------------------------
-- Returns
-- ---------------------------------------------------------------------------

create function public.return_summary(p_return uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ok', true,
    'return_id', r.id,
    'return_no', r.return_no,
    'return_type', r.return_type,
    'total', r.total_refund_amount,
    'applied_to_balance', r.applied_to_balance,
    'exchange_amount', r.exchange_amount,
    'refund_paid', r.refund_paid,
    'refund_method', r.refund_method,
    'momo_provider', r.momo_provider,
    'customer', (select name from customers where id = r.customer_id),
    'exchange_sale_id', r.exchange_sale_id,
    'exchange_receipt_no', (select receipt_no from sales where id = r.exchange_sale_id),
    'exchange_total', (select total from sales where id = r.exchange_sale_id),
    'qty_restocked', (select coalesce(sum(quantity_returned) filter (where restock_to_inventory and kind <> 'service'), 0)
                      from return_items where return_id = r.id),
    'qty_written_off', (select coalesce(sum(quantity_returned) filter (where not restock_to_inventory and kind <> 'service'), 0)
                        from return_items where return_id = r.id))
  from returns r where r.id = p_return
$$;

/**
 * What can still come back from a sale, for the return screen. Values use the
 * same formula as process_return: each line's share of what was paid, after
 * line and sale discounts.
 */
create function public.sale_return_info(p_sale uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s sales%rowtype;
  v_role public.member_role;
  r jsonb;
begin
  select * into s from sales where id = p_sale;
  if not found then
    raise exception 'Sale not found.';
  end if;
  v_role := require_role(s.business_id, '{owner,admin,cashier,storekeeper}');
  if v_role not in ('owner', 'admin') and s.created_by <> auth.uid() then
    raise exception 'You can only take returns on sales you recorded. Ask a manager.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'sale', jsonb_build_object(
      'id', s.id, 'receipt_no', s.receipt_no, 'total', s.total, 'status', s.status, 'created_at', s.created_at,
      'net_lines', (select coalesce(sum(line_total), 0) from sale_items where sale_id = s.id)),
    'customer', (select jsonb_build_object('id', c.id, 'name', c.name, 'balance', c.balance, 'store_credit', c.store_credit)
                 from customers c where c.id = s.customer_id),
    'returned_value', (select coalesce(sum(total_refund_amount), 0) from returns where original_sale_id = s.id),
    'credit_open', greatest(
      (select coalesce(sum(amount_base), 0) from sale_payments where sale_id = s.id and method = 'credit')
        - (select coalesce(sum(applied_to_balance), 0) from returns where original_sale_id = s.id), 0),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('method', method, 'amount', amount_base)), '[]')
                 from sale_payments where sale_id = s.id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'sale_item_id', i.id, 'product_id', i.product_id, 'name', i.name, 'kind', i.kind, 'unit', p.unit,
        'allow_fractional', p.allow_fractional, 'qty', i.qty, 'line_total', i.line_total,
        'returned_qty', coalesce(rq.qty, 0),
        'serials', case when i.serial_ids is not null then (
          select coalesce(jsonb_agg(jsonb_build_object('id', su.id, 'serial', su.serial) order by su.serial), '[]')
          from serial_units su
          where su.id = any (i.serial_ids)
            and not exists (select 1 from return_items ri where ri.sale_item_id = i.id and su.id = any (ri.serial_ids)))
        end
      ) order by i.name), '[]')
      from sale_items i
      join products p on p.id = i.product_id
      left join lateral (select sum(quantity_returned) as qty from return_items ri where ri.sale_item_id = i.id) rq on true
      where i.sale_id = s.id),
    'returns', (select coalesce(jsonb_agg(jsonb_build_object('return_no', return_no, 'created_at', created_at,
                                                             'total', total_refund_amount, 'return_type', return_type)
                                          order by created_at), '[]')
                from returns where original_sale_id = s.id),
    'managers', (manager_pin_status(s.business_id) -> 'managers'),
    'methods', (select to_jsonb(payment_methods) from businesses where id = s.business_id)
  ) into r;
  return r;
end $$;

/**
 * Takes goods back from a sale. Payload:
 * { client_ref, sale_id,
 *   return_type: 'refund' | 'exchange' | 'damaged',
 *   reason_code: 'changed_mind' | 'defective' | 'wrong_item' | 'expired' | 'other', reason,
 *   refund_method?: 'cash' | 'mobile_money' | 'store_credit', momo_provider?,
 *   items: [{sale_item_id, qty, restock, serial_ids?}],
 *   exchange?: { items: [{product_id, qty, serial_ids?}], payments: [{method, amount, reference?}], prescription_ref? },
 *   manager_id, pin }
 *
 * Staff can take returns on their own sales; admins on any. Returns
 * {ok: false, error: 'wrong_pin'} without changing anything when the PIN is
 * wrong; otherwise {ok: true, ...} with where the money went.
 */
create function public.process_return(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ref uuid := nullif(p ->> 'client_ref', '')::uuid;
  v_dup uuid;
  s sales%rowtype;
  b uuid;
  v_role public.member_role;
  biz businesses%rowtype;
  v_cust customers%rowtype;
  v_id uuid := gen_random_uuid();
  v_no bigint;
  v_type text := p ->> 'return_type';
  v_reason_code text := coalesce(nullif(p ->> 'reason_code', ''), 'other');
  v_reason text := nullif(trim(p ->> 'reason'), '');
  v_method text := nullif(p ->> 'refund_method', '');
  v_provider text := nullif(p ->> 'momo_provider', '');
  v_manager uuid := nullif(p ->> 'manager_id', '')::uuid;
  v_ex jsonb := case when jsonb_typeof(p -> 'exchange') = 'object' then p -> 'exchange' end;
  v_loc uuid;
  v_net_lines numeric;
  v_open_value numeric;
  it jsonb;
  si sale_items%rowtype;
  prod products%rowtype;
  v_seen uuid[] := '{}';
  v_qty numeric;
  v_left numeric;
  v_restock boolean;
  v_value numeric;
  v_cost numeric;
  v_sum numeric := 0;
  v_total numeric;
  v_restock_cost numeric := 0;
  v_writeoff_cost numeric := 0;
  v_serials uuid[];
  v_n int;
  v_allocs jsonb;
  a jsonb;
  v_back numeric;
  v_need numeric;
  v_take numeric;
  v_neg text;
  v_items jsonb := '[]';
  v_all_back boolean;
  v_ex_total numeric := 0;
  v_ex_used numeric := 0;
  v_ex_sale uuid;
  v_leftover numeric;
  v_credit_open numeric := 0;
  v_applied numeric := 0;
  v_paid numeric := 0;
  v_channel text;
  v_lines jsonb;
  v_recent int;
begin
  -- A retried request (double tap, dropped connection) gets the first result.
  if v_ref is not null then
    select id into v_dup from returns where client_ref = v_ref;
    if found then
      perform require_role((select business_id from returns where id = v_dup), '{owner,admin,cashier,storekeeper}');
      return return_summary(v_dup) || jsonb_build_object('duplicate', true);
    end if;
  end if;

  -- Locking the sale serialises returns against it, so goods cannot come back twice.
  select * into s from sales where id = nullif(p ->> 'sale_id', '')::uuid for update;
  if not found then
    raise exception 'Sale not found.';
  end if;
  b := s.business_id;
  v_role := require_role(b, '{owner,admin,cashier,storekeeper}');
  if v_role not in ('owner', 'admin') and s.created_by <> auth.uid() then
    raise exception 'You can only take returns on sales you recorded. Ask a manager.' using errcode = '42501';
  end if;
  if s.status = 'voided' then
    raise exception 'This sale was voided, so there is nothing to return.';
  end if;
  if s.status = 'void_requested' then
    raise exception 'A void has been requested for this sale. The owner must approve or decline it first.';
  end if;
  if v_type is null or v_type not in ('refund', 'exchange', 'damaged') then
    raise exception 'Choose a refund, an exchange or damaged goods.';
  end if;
  if v_reason_code not in ('changed_mind', 'defective', 'wrong_item', 'expired', 'other') then
    raise exception 'Choose a reason for the return.';
  end if;
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 300 then
    raise exception 'Say why the goods are coming back.';
  end if;
  if v_method is not null and v_method not in ('cash', 'mobile_money', 'store_credit') then
    raise exception 'Choose how the money goes back.';
  end if;
  if jsonb_typeof(p -> 'items') is distinct from 'array' or jsonb_array_length(p -> 'items') = 0 then
    raise exception 'Choose the items being returned.';
  end if;
  select * into biz from businesses where id = b;

  -- The PIN is checked before anything changes. A wrong PIN is answered, not
  -- raised, so the failed attempt stays on record for the lock-out.
  if not verify_manager_pin(b, v_manager, p ->> 'pin') then
    return jsonb_build_object('ok', false, 'error', 'wrong_pin',
                              'message', 'That PIN is not right. Ask the manager to enter it again.');
  end if;

  v_loc := coalesce((select id from locations where id = s.location_id and is_active), resolve_location(b, null));
  select coalesce(sum(line_total), 0) into v_net_lines from sale_items where sale_id = s.id;
  v_open_value := greatest(s.total - (select coalesce(sum(total_refund_amount), 0) from returns where original_sale_id = s.id), 0);
  v_no := next_counter(b, 'return');

  for it in select * from jsonb_array_elements(p -> 'items') loop
    select * into si from sale_items where id = nullif(it ->> 'sale_item_id', '')::uuid and sale_id = s.id;
    if not found then
      raise exception 'An item being returned is not on sale #%.', s.receipt_no;
    end if;
    if si.id = any (v_seen) then
      raise exception '% is listed twice.', si.name;
    end if;
    v_seen := v_seen || si.id;
    select * into prod from products where id = si.product_id;
    v_qty := (it ->> 'qty')::numeric;
    perform check_qty(prod, v_qty);
    select si.qty - coalesce(sum(quantity_returned), 0) into v_left from return_items where sale_item_id = si.id;
    if v_qty > v_left then
      raise exception 'Only % of % can still be returned from this sale.', fmt_qty(v_left), si.name;
    end if;

    v_restock := si.kind <> 'service' and v_type <> 'damaged' and coalesce((it ->> 'restock')::boolean, true);
    -- The line's share of what the customer actually paid, discounts included.
    v_value := case when v_net_lines > 0
                    then round(v_qty * si.line_total * s.total / (v_net_lines * si.qty), 2) else 0 end;
    v_cost := round(v_qty * si.unit_cost, 2);
    v_serials := null;
    v_allocs := null;

    if si.kind <> 'service' then
      if si.serial_ids is not null then
        select array_agg(distinct x::uuid) into v_serials
        from jsonb_array_elements_text(coalesce(it -> 'serial_ids', '[]')) x;
        if coalesce(array_length(v_serials, 1), 0) <> v_qty then
          raise exception 'Choose the % serial number(s) of % coming back.', fmt_qty(v_qty), si.name;
        end if;
        if not (v_serials <@ si.serial_ids) or exists (
             select 1 from return_items ri where ri.sale_item_id = si.id and ri.serial_ids && v_serials) then
          raise exception 'One of those serial numbers was not sold on this sale, or has already come back.';
        end if;
        if v_restock then
          update serial_units set status = 'in_stock', sold_at = null, sale_id = null, warranty_until = null,
                                  notes = 'Returned on return #' || v_no
          where id = any (v_serials) and sale_id = s.id;
        else
          update serial_units set status = 'defective', notes = 'Returned faulty on return #' || v_no || ': ' || v_reason
          where id = any (v_serials) and sale_id = s.id;
        end if;
        get diagnostics v_n = row_count;
        if v_n <> v_qty then
          raise exception 'One of those serial numbers is no longer linked to this sale.';
        end if;
      elsif si.batch_allocations is not null and v_restock then
        -- Back into the batches it came from, never more than each one gave.
        v_allocs := '[]';
        v_need := v_qty;
        for a in select * from jsonb_array_elements(si.batch_allocations) loop
          exit when v_need <= 0;
          select coalesce(sum((x ->> 'qty')::numeric), 0) into v_back
          from return_items ri, jsonb_array_elements(coalesce(ri.batch_allocations, '[]')) x
          where ri.sale_item_id = si.id and x ->> 'batch_id' = a ->> 'batch_id';
          v_take := least(v_need, (a ->> 'qty')::numeric - v_back);
          continue when v_take <= 0;
          v_allocs := v_allocs || jsonb_build_object('batch_id', a ->> 'batch_id', 'qty', v_take);
          v_need := v_need - v_take;
        end loop;
        perform restore_batches(v_allocs);
      end if;

      insert into stock_movements (business_id, product_id, location_id, qty, reason, unit_cost, ref_table, ref_id, note)
      values (b, si.product_id, v_loc, v_qty, 'return_in', si.unit_cost, 'returns', v_id,
              'Return #' || v_no || ': ' || v_reason);
      if v_restock then
        v_restock_cost := v_restock_cost + v_cost;
      else
        -- Damaged goods come back through the stock ledger and straight out as a write-off.
        v_neg := current_setting('app.allow_negative_stock', true);
        perform set_config('app.allow_negative_stock', 'on', true);
        insert into stock_movements (business_id, product_id, location_id, qty, reason, unit_cost, ref_table, ref_id, note)
        values (b, si.product_id, v_loc, -v_qty, 'damage', si.unit_cost, 'returns', v_id,
                'Returned damaged on return #' || v_no || ': ' || v_reason);
        perform set_config('app.allow_negative_stock', coalesce(v_neg, ''), true);
        v_writeoff_cost := v_writeoff_cost + v_cost;
      end if;
    end if;

    v_items := v_items || jsonb_build_object(
      'sale_item_id', si.id, 'product_id', si.product_id, 'name', si.name, 'kind', si.kind, 'qty', v_qty,
      'restock', v_restock, 'unit_cost', si.unit_cost, 'refund', v_value,
      'serial_ids', to_jsonb(v_serials), 'batch_allocations', v_allocs);
    v_sum := v_sum + v_value;
  end loop;

  -- Lines are rounded; the return that brings everything back settles the sale to the cent.
  select not exists (
    select 1 from sale_items i
    where i.sale_id = s.id
      and i.qty > coalesce((select sum(ri.quantity_returned) from return_items ri where ri.sale_item_id = i.id), 0)
                + coalesce((select sum((x ->> 'qty')::numeric) from jsonb_array_elements(v_items) x
                            where (x ->> 'sale_item_id')::uuid = i.id), 0)
  ) into v_all_back;
  v_total := case when v_all_back then v_open_value else least(v_sum, v_open_value) end;
  if v_total <> v_sum then
    v_items := jsonb_set(v_items, array[(jsonb_array_length(v_items) - 1)::text, 'refund'],
                         to_jsonb(greatest((v_items -> -1 ->> 'refund')::numeric + v_total - v_sum, 0)));
  end if;

  -- Exchange: the replacement goods are a normal sale, paid first with the
  -- value of what came back and then with whatever the customer adds.
  if v_type = 'exchange' then
    if v_ex is null or jsonb_typeof(v_ex -> 'items') is distinct from 'array' or jsonb_array_length(v_ex -> 'items') = 0 then
      raise exception 'Choose what the customer is taking in exchange.';
    end if;
    -- Exchanges sell at the catalogue price; record_sale checks everything else.
    select coalesce(sum(round((x ->> 'qty')::numeric * p2.selling_price, 2)), 0) into v_ex_total
    from jsonb_array_elements(v_ex -> 'items') x
    join products p2 on p2.id = (x ->> 'product_id')::uuid and p2.business_id = b;
    v_ex_used := least(v_total, v_ex_total);
    perform set_config('app.exchange_credit', v_ex_used::text, true);
    v_ex_sale := (record_sale(jsonb_build_object(
      'business_id', b,
      'customer_id', s.customer_id,
      'location_id', v_loc,
      'prescription_ref', v_ex ->> 'prescription_ref',
      'note', 'Exchange for return #' || v_no || ' on sale #' || s.receipt_no,
      'items', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                  'product_id', x -> 'product_id', 'qty', x -> 'qty', 'serial_ids', x -> 'serial_ids')))
                from jsonb_array_elements(v_ex -> 'items') x),
      'payments', (case when v_ex_used > 0
                        then jsonb_build_array(jsonb_build_object('method', 'store_credit', 'amount', v_ex_used))
                        else '[]'::jsonb end)
                  || coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(v_ex -> 'payments', '[]')) x
                               where coalesce((x ->> 'amount')::numeric, 0) > 0), '[]'::jsonb)
    )) ->> 'sale_id')::uuid;
    if coalesce(nullif(current_setting('app.exchange_credit', true), '')::numeric, 0) <> 0 then
      raise exception 'The value of the returned goods was not used up by the exchange. Check the items and try again.';
    end if;
    perform set_config('app.exchange_credit', '', true);
  end if;

  -- Whatever is left goes first against a credit sale's debt, then back to the customer.
  v_leftover := v_total - v_ex_used;
  if s.customer_id is not null then
    select * into v_cust from customers where id = s.customer_id for update;
    select greatest(coalesce(sum(amount_base), 0)
                    - (select coalesce(sum(applied_to_balance), 0) from returns where original_sale_id = s.id), 0)
      into v_credit_open
    from sale_payments where sale_id = s.id and method = 'credit';
    v_applied := greatest(least(v_leftover, v_credit_open, v_cust.balance), 0);
  end if;
  v_paid := v_leftover - v_applied;
  if v_paid > 0 then
    if v_method is null then
      raise exception 'Choose how the customer gets % back.', fmt_money(v_paid);
    end if;
    if v_method = 'mobile_money' then
      if v_provider is null or v_provider not in ('orange_money', 'afrimoney', 'qmoney') then
        raise exception 'Choose the mobile money service for the refund.';
      end if;
      perform check_method(biz, v_provider);
      v_channel := v_provider;
    elsif v_method = 'store_credit' then
      if s.customer_id is null then
        raise exception 'Store credit needs a named customer. Refund in cash or mobile money instead.';
      end if;
      update customers set store_credit = store_credit + v_paid where id = s.customer_id;
      v_channel := 'store_credit';
    else
      v_channel := 'cash';
    end if;
  else
    v_method := null;
  end if;
  if v_method is distinct from 'mobile_money' then
    v_provider := null;
  end if;
  if v_applied > 0 then
    update customers set balance = balance - v_applied where id = s.customer_id;
  end if;

  insert into returns (id, business_id, return_no, client_ref, original_sale_id, customer_id, location_id, return_type,
                       reason_code, reason, total_refund_amount, applied_to_balance, exchange_amount, refund_paid,
                       refund_method, momo_provider, exchange_sale_id, restocked_cost, written_off_cost, approved_by)
  values (v_id, b, v_no, v_ref, s.id, s.customer_id, v_loc, v_type::public.return_type,
          v_reason_code, v_reason, v_total, v_applied, v_ex_used, v_paid,
          v_method::public.refund_method, v_provider, v_ex_sale, v_restock_cost, v_writeoff_cost, v_manager);
  insert into return_items (return_id, business_id, sale_item_id, product_id, name, kind, quantity_returned,
                            restock_to_inventory, unit_cost, refund_amount, serial_ids, batch_allocations)
  select v_id, b, (x ->> 'sale_item_id')::uuid, (x ->> 'product_id')::uuid, x ->> 'name', x ->> 'kind',
         (x ->> 'qty')::numeric, (x ->> 'restock')::boolean, (x ->> 'unit_cost')::numeric, (x ->> 'refund')::numeric,
         case when jsonb_typeof(x -> 'serial_ids') = 'array'
              then array(select y::uuid from jsonb_array_elements_text(x -> 'serial_ids') y) end,
         case when jsonb_typeof(x -> 'batch_allocations') = 'array' then x -> 'batch_allocations' end
  from jsonb_array_elements(v_items) x;

  v_lines := jsonb_build_array(
    jsonb_build_object('key', 'sales_returns', 'debit', v_total),
    jsonb_build_object('key', 'inventory', 'debit', v_restock_cost),
    jsonb_build_object('key', 'shrinkage', 'debit', v_writeoff_cost),
    jsonb_build_object('key', 'cogs', 'credit', v_restock_cost + v_writeoff_cost),
    jsonb_build_object('key', 'receivable', 'credit', v_applied),
    jsonb_build_object('key', 'store_credit', 'credit',
                       v_ex_used + case when v_channel = 'store_credit' then v_paid else 0 end));
  if v_channel in ('cash', 'orange_money', 'afrimoney', 'qmoney') then
    v_lines := v_lines || jsonb_build_object('key', v_channel, 'credit', v_paid);
  end if;
  perform post_journal(b, business_today(b), 'Return #' || v_no || ' on sale #' || s.receipt_no,
                       'returns', v_id, v_lines);

  -- Fraud signal: one person taking many returns in a day.
  select count(*) into v_recent from returns
  where business_id = b and processed_by = auth.uid() and created_at > now() - interval '24 hours';
  if v_recent >= 3 then
    perform raise_alert(b, 'return_pattern', 'warning',
      member_name(b, auth.uid()) || ' has taken ' || v_recent || ' returns in 24 hours',
      'Check the goods that came back against the shelf and the refunds against the till. Latest: return #'
        || v_no || ' on sale #' || s.receipt_no || ' (' || fmt_money(v_total) || ').',
      'return_pattern:' || auth.uid() || ':' || business_today(b), null, 'returns', v_id,
      jsonb_build_object('user_id', auth.uid(), 'count', v_recent));
  end if;

  return return_summary(v_id) || jsonb_build_object('duplicate', false);
end $$;

-- ---------------------------------------------------------------------------
-- Cash-up and dashboard: refunds leave the till; sales are shown net of returns
-- ---------------------------------------------------------------------------

/** What the caller's till should hold since their last cash-up. Used for the preview and the submission. */
create or replace function public.cash_up_expected(b uuid, p_float numeric default 0) returns jsonb
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
    union all
    select case refund_method when 'cash' then 'cash' else momo_provider end, refund_paid from returns
    where business_id = b and processed_by = uid and refund_method in ('cash', 'mobile_money')
      and created_at > v_start and created_at <= v_end
  )
  select
    coalesce((select sum(amount) from money_in where method = 'cash' and currency = 'SLE'), 0)
      - coalesce((select sum(amount) from money_out where method = 'cash'), 0),
    coalesce((select sum(amount) from money_in where method = 'cash' and currency = 'USD'), 0),
    coalesce((select jsonb_object_agg(m, total) from (
      select m, sum(v) as total from (
        select method as m, amount_base as v from money_in where method not in ('cash', 'credit', 'store_credit')
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

create or replace function public.dashboard_summary(b uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_role public.member_role;
  today date;
  t0 timestamptz;
  week_start date;
  r jsonb;
begin
  v_role := require_role(b, '{owner,admin,cashier,storekeeper}');
  today := business_today(b);
  t0 := day_start(today);
  week_start := today - ((extract(isodow from today)::int) - 1);

  if v_role in ('cashier', 'storekeeper') then
    select jsonb_build_object(
      'role', v_role,
      'my_sales_today', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(total), 0))
                         from sales where business_id = b and created_by = auth.uid() and status <> 'voided'
                           and created_at >= t0),
      'my_expenses_today', (select coalesce(sum(amount), 0) from expenses
                            where business_id = b and created_by = auth.uid() and status = 'recorded'
                              and created_at >= t0),
      'last_cash_up', (select jsonb_build_object('at', period_end, 'variance', variance) from cash_ups
                       where business_id = b and user_id = auth.uid() order by period_end desc limit 1),
      'open_void_requests', (select count(*) from sales where business_id = b and created_by = auth.uid()
                               and status = 'void_requested'),
      'draft_counts', (select count(*) from stock_counts where business_id = b and created_by = auth.uid()
                         and status = 'draft'),
      'low_stock', coalesce((select jsonb_agg(x) from (
          select jsonb_build_object('id', p.id, 'name', p.name, 'unit', p.unit, 'quantity', ps.quantity,
                                    'reorder_level', p.reorder_level) as x
          from products p join product_stock ps on ps.product_id = p.id
          where p.business_id = b and p.is_active and p.kind <> 'service' and p.reorder_level > 0
            and ps.quantity <= p.reorder_level
          order by ps.quantity / nullif(p.reorder_level, 0) limit 8) s), '[]')
    ) into r;
    return r;
  end if;

  -- Revenue and gross profit are net of returns taken in the same period:
  -- a return gives back its value and puts its cost of goods back.
  select jsonb_build_object(
    'role', v_role,
    'today', (select jsonb_build_object(
                'sales_count', count(*),
                'revenue', coalesce(sum(total), 0)
                  - (select coalesce(sum(total_refund_amount), 0) from returns where business_id = b and created_at >= t0),
                'gross_profit', coalesce(sum(total - cost_total), 0)
                  - (select coalesce(sum(total_refund_amount - restocked_cost - written_off_cost), 0)
                     from returns where business_id = b and created_at >= t0),
                'returns', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(total_refund_amount), 0))
                            from returns where business_id = b and created_at >= t0))
              from sales where business_id = b and status <> 'voided' and created_at >= t0),
    'today_expenses', (select coalesce(sum(amount), 0) from expenses
                       where business_id = b and status = 'recorded' and expense_date = today),
    'week', (select jsonb_build_object(
               'revenue', coalesce(sum(total), 0)
                 - (select coalesce(sum(total_refund_amount), 0) from returns
                    where business_id = b and created_at >= day_start(week_start)),
               'sales_count', count(*))
             from sales where business_id = b and status <> 'voided' and created_at >= day_start(week_start)),
    'last_week_to_date', (select coalesce(sum(total), 0) from sales
                          where business_id = b and status <> 'voided'
                            and created_at >= day_start(week_start - 7) and created_at < t0 - interval '7 days' + interval '1 day')
                         - (select coalesce(sum(total_refund_amount), 0) from returns
                            where business_id = b
                              and created_at >= day_start(week_start - 7) and created_at < t0 - interval '7 days' + interval '1 day'),
    'money', coalesce((select jsonb_agg(jsonb_build_object('key', system_key, 'name', name, 'balance', balance)
                                        order by code)
                       from account_balances(b) where system_key in ('cash', 'orange_money', 'afrimoney', 'qmoney', 'bank', 'receivable', 'payable', 'inventory')), '[]'),
    'alerts', (select jsonb_build_object(
                 'critical', count(*) filter (where severity = 'critical'),
                 'warning', count(*) filter (where severity = 'warning'),
                 'info', count(*) filter (where severity = 'info'))
               from alerts where business_id = b and status = 'open'),
    'recent_alerts', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', id, 'kind', kind, 'severity', severity, 'title', title, 'message', message,
                                  'created_at', created_at) as x
        from alerts where business_id = b and status = 'open'
        order by case severity when 'critical' then 0 when 'warning' then 1 else 2 end, created_at desc limit 6) s), '[]'),
    'low_stock', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', p.id, 'name', p.name, 'unit', p.unit, 'quantity', ps.quantity,
                                  'reorder_level', p.reorder_level, 'reorder_qty', p.reorder_qty) as x
        from products p join product_stock ps on ps.product_id = p.id
        where p.business_id = b and p.is_active and p.kind <> 'service' and p.reorder_level > 0
          and ps.quantity <= p.reorder_level
        order by ps.quantity / nullif(p.reorder_level, 0) limit 8) s), '[]'),
    'low_stock_count', (select count(*) from products p join product_stock ps on ps.product_id = p.id
                        where p.business_id = b and p.is_active and p.kind <> 'service' and p.reorder_level > 0
                          and ps.quantity <= p.reorder_level),
    'series', coalesce((select jsonb_agg(jsonb_build_object('date', d::date,
                                                            'revenue', coalesce(s.revenue, 0) - coalesce(rt.value, 0),
                                                            'profit', coalesce(s.profit, 0) - coalesce(rt.profit, 0))
                                         order by d)
                        from generate_series(today - 13, today, interval '1 day') d
                        left join (select (created_at at time zone 'Africa/Freetown')::date as day,
                                          sum(total) as revenue, sum(total - cost_total) as profit
                                   from sales where business_id = b and status <> 'voided'
                                     and created_at >= day_start(today - 13)
                                   group by 1) s on s.day = d::date
                        left join (select (created_at at time zone 'Africa/Freetown')::date as day,
                                          sum(total_refund_amount) as value,
                                          sum(total_refund_amount - restocked_cost - written_off_cost) as profit
                                   from returns where business_id = b and created_at >= day_start(today - 13)
                                   group by 1) rt on rt.day = d::date), '[]'),
    'top_today', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('name', si.name, 'qty', sum(si.qty), 'revenue', sum(si.line_total)) as x
        from sale_items si join sales s on s.id = si.sale_id
        where s.business_id = b and s.status <> 'voided' and s.created_at >= t0
        group by si.name order by sum(si.line_total) desc limit 5) s), '[]'),
    'pending', jsonb_build_object(
      'void_requests', (select count(*) from sales where business_id = b and status = 'void_requested'),
      'counts_to_review', (select count(*) from stock_counts where business_id = b and status = 'submitted'),
      'cash_ups_to_review', (select count(*) from cash_ups where business_id = b and status = 'submitted'),
      'staff_requests', (select count(*) from memberships where business_id = b and status = 'pending'))
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------

alter table public.returns enable row level security;
alter table public.return_items enable row level security;
alter table public.manager_pins enable row level security;
alter table public.pin_failures enable row level security;

-- Admins see every return; staff see the ones they took and those on their own sales.
create policy returns_read on public.returns for select to authenticated
  using (is_admin(business_id) or (is_member(business_id) and (
    processed_by = auth.uid()
    or exists (select 1 from public.sales s where s.id = original_sale_id and s.created_by = auth.uid()))));
create policy return_items_read on public.return_items for select to authenticated
  using (is_admin(business_id) or exists (select 1 from public.returns r where r.id = return_id));
create policy pin_failures_admin_read on public.pin_failures for select to authenticated
  using (is_admin(business_id));
-- manager_pins has no policy and no grant: only the PIN functions read it.

revoke all on public.returns, public.return_items, public.manager_pins, public.pin_failures from anon, authenticated;
grant select on public.returns, public.return_items, public.pin_failures to authenticated;
grant all on public.returns, public.return_items, public.manager_pins, public.pin_failures to service_role;

-- New functions are executable by everyone unless revoked; only the API is granted back.
revoke execute on function
  public.set_manager_pin(uuid, text),
  public.verify_manager_pin(uuid, uuid, text),
  public.manager_pin_status(uuid),
  public.return_summary(uuid),
  public.sale_return_info(uuid),
  public.process_return(jsonb),
  public.guard_sale_void_after_return()
from public, anon, authenticated;
grant execute on function
  public.set_manager_pin(uuid, text),
  public.manager_pin_status(uuid),
  public.sale_return_info(uuid),
  public.process_return(jsonb)
to authenticated;
grant execute on all functions in schema public to service_role;
