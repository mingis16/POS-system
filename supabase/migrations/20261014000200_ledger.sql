-- Double-entry bookkeeping. Every money event (sale, expense, stock receipt,
-- payment, stock loss) posts a balanced journal entry through post_journal().
-- Nothing writes journal rows directly; corrections are reversing entries.

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  code text not null,
  name text not null check (length(trim(name)) between 1 and 80),
  type text not null check (type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  -- Accounts the system posts to by name: cash, orange_money, receivable, inventory...
  system_key text,
  -- Operating expense accounts appear as categories in the expense form.
  is_expense_category boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, code),
  unique (business_id, system_key),
  unique (business_id, id)
);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  entry_no bigint not null,
  entry_date date not null,
  memo text not null,
  source_table text,
  source_id uuid,
  reverses uuid references public.journal_entries (id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (business_id, entry_no)
);
create index journal_entries_source_idx on public.journal_entries (source_table, source_id);
create index journal_entries_date_idx on public.journal_entries (business_id, entry_date);

create table public.journal_lines (
  id bigint generated always as identity primary key,
  entry_id uuid not null references public.journal_entries (id) on delete cascade,
  business_id uuid not null,
  account_id uuid not null,
  debit numeric(14, 2) not null default 0 check (debit >= 0),
  credit numeric(14, 2) not null default 0 check (credit >= 0),
  check (debit = 0 or credit = 0),
  check (debit + credit > 0),
  foreign key (business_id, account_id) references public.accounts (business_id, id)
);
create index journal_lines_account_idx on public.journal_lines (business_id, account_id);

create trigger journal_entries_immutable before update or delete on public.journal_entries
  for each row execute function public.forbid_change();
create trigger journal_lines_immutable before update or delete on public.journal_lines
  for each row execute function public.forbid_change();

-- Standard chart of accounts for a new business. Expense categories come from
-- the archetype (passed in by create_business) on top of the common ones.
create function public.seed_accounts(b uuid, extra_expense_categories text[] default '{}') returns void
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
    (b, '3000', 'Owner''s equity',       'equity',    'equity'),
    (b, '3100', 'Owner''s drawings',     'equity',    'drawings'),
    (b, '4000', 'Sales of goods',        'revenue',   'sales'),
    (b, '4100', 'Service income',        'revenue',   'service_sales'),
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

create function public.account_id_for(b uuid, key text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare a uuid;
begin
  select id into a from accounts where business_id = b and system_key = key;
  if a is null then
    raise exception 'Account "%" is missing from the chart of accounts.', key;
  end if;
  return a;
end $$;

/** The asset account a payment method lands in. Credit sales are receivables. */
create function public.payment_account_key(method text) returns text
language sql immutable as $$
  select case method
    when 'credit' then 'receivable'
    when 'cash' then 'cash'
    when 'orange_money' then 'orange_money'
    when 'afrimoney' then 'afrimoney'
    when 'qmoney' then 'qmoney'
    when 'bank' then 'bank'
  end
$$;

/**
 * Posts a balanced journal entry. lines is a JSON array of
 *   {"key": "cash" | "account_id": uuid, "debit": n, "credit": n}
 * Zero lines are dropped; the remaining debits must equal the credits.
 */
create function public.post_journal(
  b uuid, d date, memo text, src_table text, src_id uuid, lines jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  entry uuid;
  l jsonb;
  acc uuid;
  dr numeric;
  cr numeric;
  total_dr numeric := 0;
  total_cr numeric := 0;
begin
  for l in select * from jsonb_array_elements(lines) loop
    total_dr := total_dr + round(coalesce((l ->> 'debit')::numeric, 0), 2);
    total_cr := total_cr + round(coalesce((l ->> 'credit')::numeric, 0), 2);
  end loop;
  if total_dr = 0 and total_cr = 0 then
    return null;
  end if;
  if total_dr <> total_cr then
    raise exception 'Journal entry "%" does not balance (debits %, credits %).', memo, total_dr, total_cr;
  end if;

  insert into journal_entries (business_id, entry_no, entry_date, memo, source_table, source_id)
  values (b, next_counter(b, 'journal'), d, memo, src_table, src_id)
  returning id into entry;

  for l in select * from jsonb_array_elements(lines) loop
    dr := round(coalesce((l ->> 'debit')::numeric, 0), 2);
    cr := round(coalesce((l ->> 'credit')::numeric, 0), 2);
    continue when dr = 0 and cr = 0;
    if dr < 0 or cr < 0 then
      -- A negative amount is the same entry on the other side.
      select greatest(dr, 0) + greatest(-cr, 0), greatest(cr, 0) + greatest(-dr, 0) into dr, cr;
    end if;
    acc := coalesce((l ->> 'account_id')::uuid, account_id_for(b, l ->> 'key'));
    insert into journal_lines (entry_id, business_id, account_id, debit, credit)
    values (entry, b, acc, dr, cr);
  end loop;
  return entry;
end $$;

/** Posts the mirror image of every not-yet-reversed entry for a source record. */
create function public.reverse_journal(b uuid, src_table text, src_id uuid, memo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  e record;
  rev uuid;
begin
  for e in
    select je.* from journal_entries je
    where je.business_id = b and je.source_table = src_table and je.source_id = src_id
      and je.reverses is null
      and not exists (select 1 from journal_entries r where r.reverses = je.id)
  loop
    insert into journal_entries (business_id, entry_no, entry_date, memo, source_table, source_id, reverses)
    values (b, next_counter(b, 'journal'), business_today(b), memo, src_table, src_id, e.id)
    returning id into rev;
    insert into journal_lines (entry_id, business_id, account_id, debit, credit)
    select rev, business_id, account_id, credit, debit from journal_lines where entry_id = e.id;
  end loop;
end $$;
