-- Reporting: dashboards, financial statements, the reconciliation engine,
-- weekly business reports and the metrics the AI advisor reads.
-- All are SECURITY DEFINER and check the caller's role first.

create table public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  week_start date not null,
  data jsonb not null,
  advice jsonb,
  generated_at timestamptz not null default now(),
  unique (business_id, week_start)
);

/** Start of the business-day `d` as a timestamp (Sierra Leone is GMT). */
create function public.day_start(d date) returns timestamptz language sql immutable as $$
  select d::timestamp at time zone 'Africa/Freetown'
$$;

create function public.require_reader(b uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_service_role() then
    perform require_role(b, '{owner,admin}');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Ledger reports
-- ---------------------------------------------------------------------------

create function public.account_balances(b uuid, p_from date default null, p_to date default null)
returns table (account_id uuid, code text, name text, type text, system_key text, debit numeric, credit numeric, balance numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_reader(b);
  return query
    select a.id, a.code, a.name, a.type, a.system_key,
           coalesce(sum(l.debit), 0)::numeric, coalesce(sum(l.credit), 0)::numeric,
           (case when a.type in ('asset', 'expense') then coalesce(sum(l.debit - l.credit), 0)
                 else coalesce(sum(l.credit - l.debit), 0) end)::numeric
    from accounts a
    left join (journal_lines l join journal_entries e on e.id = l.entry_id
               and (p_from is null or e.entry_date >= p_from)
               and (p_to is null or e.entry_date <= p_to))
      on l.account_id = a.id
    where a.business_id = b
    group by a.id
    order by a.code;
end $$;

create function public.profit_and_loss(b uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb;
begin
  perform require_reader(b);
  with bal as (
    select * from account_balances(b, p_from, p_to)
  ), t as (
    select
      coalesce(sum(balance) filter (where type = 'revenue'), 0) as revenue,
      coalesce(sum(balance) filter (where system_key = 'cogs'), 0) as cogs,
      coalesce(sum(balance) filter (where system_key = 'shrinkage'), 0) as shrinkage,
      coalesce(sum(balance) filter (where type = 'expense' and coalesce(system_key, '') not in ('cogs', 'shrinkage')), 0) as opex
    from bal
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'revenue', t.revenue,
    'revenue_lines', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'code', code, 'amount', balance) order by code)
                               from bal where type = 'revenue' and balance <> 0), '[]'),
    'cogs', t.cogs,
    'gross_profit', t.revenue - t.cogs,
    'expense_lines', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'code', code, 'amount', balance) order by balance desc)
                               from bal where type = 'expense' and coalesce(system_key, '') not in ('cogs', 'shrinkage')
                                 and balance <> 0), '[]'),
    'operating_expenses', t.opex,
    'shrinkage', t.shrinkage,
    'net_profit', t.revenue - t.cogs - t.opex - t.shrinkage,
    'net_margin_pct', case when t.revenue > 0 then round((t.revenue - t.cogs - t.opex - t.shrinkage) * 100 / t.revenue, 1) end
  ) into r from t;
  return r;
end $$;

/** Money in and out of cash, mobile money and bank, grouped by what caused it. */
create function public.cash_flow(b uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform require_reader(b);
  with money as (
    select a.id, a.name, a.system_key from accounts a
    where a.business_id = b and a.system_key in ('cash', 'orange_money', 'afrimoney', 'qmoney', 'bank')
  ), lines as (
    select m.system_key, m.name, e.entry_date, e.source_table, l.debit - l.credit as amount
    from journal_lines l
    join journal_entries e on e.id = l.entry_id
    join money m on m.id = l.account_id
    where e.business_id = b and e.entry_date <= p_to
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', m.system_key, 'name', m.name,
        'opening', coalesce((select sum(amount) from lines where system_key = m.system_key and entry_date < p_from), 0),
        'inflow', coalesce((select sum(amount) from lines where system_key = m.system_key and entry_date >= p_from and amount > 0), 0),
        'outflow', coalesce((select -sum(amount) from lines where system_key = m.system_key and entry_date >= p_from and amount < 0), 0),
        'closing', coalesce((select sum(amount) from lines where system_key = m.system_key), 0)
      ) order by m.system_key) from money m), '[]'),
    'by_source', coalesce((
      select jsonb_agg(jsonb_build_object('source', coalesce(source_table, 'other'), 'inflow', inflow, 'outflow', outflow)
                       order by inflow - outflow desc)
      from (select source_table,
                   sum(amount) filter (where amount > 0) as inflow,
                   coalesce(-sum(amount) filter (where amount < 0), 0) as outflow
            from lines where entry_date >= p_from group by source_table) s), '[]')
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Reconciliation engine
-- ---------------------------------------------------------------------------

/**
 * Per item, over a period (optionally one location):
 *   beginning + purchased − sold ± other movements = expected (book) stock
 * against the latest physical count in the period, whose variance is
 * counted − book quantity at the moment the count was submitted.
 */
create function public.reconciliation_report(b uuid, p_from date, p_to date, p_location uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t0 timestamptz := day_start(p_from);
  t1 timestamptz := day_start(p_to + 1);
  r jsonb;
begin
  perform require_reader(b);
  with mv as (
    select product_id,
      coalesce(sum(qty) filter (where created_at < t0), 0) as beginning,
      coalesce(sum(qty) filter (where created_at >= t0 and created_at < t1 and reason = 'purchase'), 0) as purchased,
      coalesce(-sum(qty) filter (where created_at >= t0 and created_at < t1 and reason in ('sale', 'sale_void')), 0) as sold,
      coalesce(sum(qty) filter (where created_at >= t0 and created_at < t1
                                  and reason in ('production_in', 'production_out', 'usage', 'return_in',
                                                 'transfer_in', 'transfer_out', 'opening')), 0) as other_in_out,
      coalesce(sum(qty) filter (where created_at >= t0 and created_at < t1
                                  and reason in ('adjustment', 'damage', 'expired')), 0) as written_off,
      coalesce(sum(qty) filter (where created_at >= t0 and created_at < t1 and reason = 'count_variance'), 0) as count_adjusted,
      coalesce(sum(qty) filter (where created_at < t1), 0) as closing_book
    from stock_movements
    where business_id = b and (p_location is null or location_id = p_location)
    group by product_id
  ), last_count as (
    select distinct on (l.product_id)
      l.product_id, l.counted_qty, l.expected_qty, l.variance, l.unit_cost,
      c.id as count_id, c.count_no, c.status, c.submitted_at
    from stock_count_lines l
    join stock_counts c on c.id = l.count_id
    where c.business_id = b and c.status in ('submitted', 'approved')
      and c.submitted_at >= t0 and c.submitted_at < t1
      and (p_location is null or c.location_id = p_location)
    order by l.product_id, c.submitted_at desc
  ), rows as (
    select p.id, p.name, p.unit, p.cost_price, p.selling_price, cat.name as category,
           mv.beginning, mv.purchased, mv.sold, mv.other_in_out, mv.written_off, mv.count_adjusted,
           mv.beginning + mv.purchased - mv.sold + mv.other_in_out + mv.written_off as expected,
           mv.closing_book,
           lc.counted_qty, lc.expected_qty as book_at_count, lc.variance, lc.count_no, lc.status as count_status,
           lc.submitted_at as counted_at,
           round(coalesce(lc.variance, 0) * coalesce(lc.unit_cost, p.cost_price), 2) as variance_value
    from mv
    join products p on p.id = mv.product_id
    left join categories cat on cat.id = p.category_id
    left join last_count lc on lc.product_id = p.id
    where p.kind <> 'service'
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'location_id', p_location,
    'tolerance_pct', (select stock_variance_tolerance_pct from businesses where id = b),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'product_id', id, 'name', name, 'unit', unit, 'category', category, 'cost_price', cost_price,
        'beginning', beginning, 'purchased', purchased, 'sold', sold, 'other', other_in_out,
        'written_off', written_off, 'count_adjusted', count_adjusted, 'expected', expected,
        'closing_book', closing_book, 'counted', counted_qty, 'book_at_count', book_at_count,
        'variance', variance, 'variance_value', variance_value, 'count_no', count_no,
        'count_status', count_status, 'counted_at', counted_at,
        'status', case when counted_qty is null then 'not_counted'
                       when variance < 0 then 'short'
                       when variance > 0 then 'over'
                       else 'ok' end
      ) order by variance_value asc nulls last, name) from rows), '[]'),
    'totals', (select jsonb_build_object(
        'items', count(*),
        'counted', count(*) filter (where counted_qty is not null),
        'short_items', count(*) filter (where variance < 0),
        'shortage_value', coalesce(-sum(variance_value) filter (where variance_value < 0), 0),
        'overage_value', coalesce(sum(variance_value) filter (where variance_value > 0), 0),
        'written_off_value', coalesce(-sum(written_off * cost_price) filter (where written_off < 0), 0),
        'sold_value', coalesce(sum(sold * selling_price), 0)
      ) from rows),
    'cash', (select jsonb_build_object(
        'cash_ups', count(*),
        'shortage', coalesce(-sum(variance) filter (where variance < 0), 0),
        'overage', coalesce(sum(variance) filter (where variance > 0), 0),
        'by_staff', coalesce((select jsonb_agg(jsonb_build_object('user_id', user_id, 'name', member_name(b, user_id),
                                 'cash_ups', n, 'variance', v) order by v)
                              from (select user_id, count(*) as n, sum(variance) as v from cash_ups
                                    where business_id = b and created_at >= t0 and created_at < t1
                                    group by user_id) s), '[]')
      ) from cash_ups where business_id = b and created_at >= t0 and created_at < t1)
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Dashboards
-- ---------------------------------------------------------------------------

create function public.dashboard_summary(b uuid) returns jsonb
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

  select jsonb_build_object(
    'role', v_role,
    'today', (select jsonb_build_object(
                'sales_count', count(*), 'revenue', coalesce(sum(total), 0),
                'gross_profit', coalesce(sum(total - cost_total), 0))
              from sales where business_id = b and status <> 'voided' and created_at >= t0),
    'today_expenses', (select coalesce(sum(amount), 0) from expenses
                       where business_id = b and status = 'recorded' and expense_date = today),
    'week', (select jsonb_build_object('revenue', coalesce(sum(total), 0), 'sales_count', count(*))
             from sales where business_id = b and status <> 'voided' and created_at >= day_start(week_start)),
    'last_week_to_date', (select coalesce(sum(total), 0) from sales
                          where business_id = b and status <> 'voided'
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
    'series', coalesce((select jsonb_agg(jsonb_build_object('date', d::date, 'revenue', coalesce(s.revenue, 0),
                                                            'profit', coalesce(s.profit, 0)) order by d)
                        from generate_series(today - 13, today, interval '1 day') d
                        left join (select (created_at at time zone 'Africa/Freetown')::date as day,
                                          sum(total) as revenue, sum(total - cost_total) as profit
                                   from sales where business_id = b and status <> 'voided'
                                     and created_at >= day_start(today - 13)
                                   group by 1) s on s.day = d::date), '[]'),
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
-- Weekly report
-- ---------------------------------------------------------------------------

create function public.weekly_report_data(b uuid, p_week_start date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  ws date := p_week_start;
  we date := p_week_start + 6;
  t0 timestamptz := day_start(p_week_start);
  t1 timestamptz := day_start(p_week_start + 7);
  pl jsonb;
  prev jsonb;
  dead_days int;
  r jsonb;
begin
  perform require_reader(b);
  select dead_stock_days into dead_days from businesses where id = b;
  pl := profit_and_loss(b, ws, we);
  prev := profit_and_loss(b, ws - 7, ws - 1);

  select jsonb_build_object(
    'week_start', ws, 'week_end', we,
    'business', (select jsonb_build_object('name', name, 'type', business_type, 'city', location_city)
                 from businesses where id = b),
    'pl', pl,
    'previous', jsonb_build_object('revenue', prev -> 'revenue', 'net_profit', prev -> 'net_profit',
                                   'operating_expenses', prev -> 'operating_expenses'),
    'sales', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(total), 0),
                                        'average', coalesce(round(avg(total), 2), 0),
                                        'discounts', coalesce(sum(discount), 0),
                                        'voided', (select count(*) from sales v where v.business_id = b
                                                     and v.voided_at >= t0 and v.voided_at < t1))
              from sales where business_id = b and status <> 'voided' and created_at >= t0 and created_at < t1),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('date', d::date, 'revenue', coalesce(s.revenue, 0)) order by d)
                        from generate_series(ws, we, interval '1 day') d
                        left join (select (created_at at time zone 'Africa/Freetown')::date as day, sum(total) as revenue
                                   from sales where business_id = b and status <> 'voided'
                                     and created_at >= t0 and created_at < t1 group by 1) s
                          on s.day = d::date), '[]'),
    'payment_mix', coalesce((select jsonb_agg(jsonb_build_object('method', method, 'amount', amt) order by amt desc)
                             from (select sp.method, sum(sp.amount_base) as amt
                                   from sale_payments sp join sales s on s.id = sp.sale_id
                                   where s.business_id = b and s.status <> 'voided'
                                     and s.created_at >= t0 and s.created_at < t1
                                   group by sp.method) m), '[]'),
    'top_items', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('product_id', si.product_id, 'name', si.name, 'qty', sum(si.qty),
                                  'revenue', sum(si.line_total),
                                  'profit', sum(si.line_total - round(si.qty * si.unit_cost, 2))) as x
        from sale_items si join sales s on s.id = si.sale_id
        where s.business_id = b and s.status <> 'voided' and s.created_at >= t0 and s.created_at < t1
        group by si.product_id, si.name order by sum(si.line_total) desc limit 8) t), '[]'),
    'dead_stock', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('product_id', p.id, 'name', p.name, 'unit', p.unit, 'quantity', ps.quantity,
                                  'value', round(ps.quantity * p.cost_price, 2),
                                  'last_sold', (select max(s.created_at) from sale_items si join sales s on s.id = si.sale_id
                                                where si.product_id = p.id and s.status <> 'voided')) as x
        from products p join product_stock ps on ps.product_id = p.id
        where p.business_id = b and p.is_active and p.kind <> 'service' and ps.quantity > 0
          and p.created_at < t1 - make_interval(days => dead_days)
          and not exists (select 1 from sale_items si join sales s on s.id = si.sale_id
                          where si.product_id = p.id and s.status <> 'voided'
                            and s.created_at >= t1 - make_interval(days => dead_days) and s.created_at < t1)
        order by ps.quantity * p.cost_price desc limit 10) t), '[]'),
    'shrinkage', jsonb_build_object(
      'value', pl -> 'shrinkage',
      'lines', coalesce((select jsonb_agg(x) from (
          select jsonb_build_object('name', p.name, 'qty', sum(m.qty), 'value', round(sum(m.qty * m.unit_cost), 2),
                                    'reason', m.reason) as x
          from stock_movements m join products p on p.id = m.product_id
          where m.business_id = b and m.created_at >= t0 and m.created_at < t1 and m.qty < 0
            and m.reason in ('count_variance', 'damage', 'expired', 'adjustment')
          group by p.name, m.reason order by sum(m.qty * m.unit_cost) limit 8) t), '[]')),
    'cash', (select jsonb_build_object('cash_ups', count(*),
                                       'shortage', coalesce(-sum(variance) filter (where variance < 0), 0),
                                       'overage', coalesce(sum(variance) filter (where variance > 0), 0))
             from cash_ups where business_id = b and created_at >= t0 and created_at < t1),
    'alerts', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'severity', severity, 'count', n))
                        from (select kind, count(*) as n,
                                     (array_agg(severity order by case severity when 'critical' then 0
                                                when 'warning' then 1 else 2 end))[1] as severity
                              from alerts
                              where business_id = b and created_at >= t0 and created_at < t1
                              group by kind) a), '[]'),
    'staff', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('user_id', s.created_by, 'name', member_name(b, s.created_by),
                                  'sales', count(*), 'revenue', sum(s.total),
                                  'discounts', sum(s.discount),
                                  'commission', coalesce((select sum(si.commission_amount) from sale_items si
                                                          join sales s2 on s2.id = si.sale_id
                                                          where si.performed_by = s.created_by and s2.business_id = b
                                                            and s2.status <> 'voided'
                                                            and s2.created_at >= t0 and s2.created_at < t1), 0)) as x
        from sales s where s.business_id = b and s.status <> 'voided' and s.created_at >= t0 and s.created_at < t1
        group by s.created_by order by sum(s.total) desc) t), '[]'),
    'receivables', (select coalesce(sum(balance), 0) from customers where business_id = b and balance > 0),
    'payables', (select coalesce(sum(balance_due), 0) from suppliers where business_id = b and balance_due > 0)
  ) into r;
  return r;
end $$;

create function public.generate_weekly_report(b uuid, p_week_start date) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  ws date := p_week_start - ((extract(isodow from p_week_start)::int) - 1);
begin
  perform require_reader(b);
  insert into weekly_reports (business_id, week_start, data)
  values (b, ws, weekly_report_data(b, ws))
  on conflict (business_id, week_start) do update set data = excluded.data, generated_at = now()
  returning id into v_id;
  return v_id;
end $$;

create function public.save_report_advice(p_report uuid, p_advice jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare b uuid;
begin
  select business_id into b from weekly_reports where id = p_report;
  if b is null then
    raise exception 'Report not found.';
  end if;
  perform require_reader(b);
  update weekly_reports set advice = p_advice where id = p_report;
end $$;

-- ---------------------------------------------------------------------------
-- Advisor metrics: velocity, trend, cover and patterns per item
-- ---------------------------------------------------------------------------

create function public.advisor_metrics(b uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  today date;
  t_now timestamptz := now();
  r jsonb;
begin
  perform require_reader(b);
  today := business_today(b);
  with sold as (
    select si.product_id,
      coalesce(sum(si.qty) filter (where s.created_at >= t_now - interval '7 days'), 0) as sold_7d,
      coalesce(sum(si.qty) filter (where s.created_at >= t_now - interval '14 days'
                                     and s.created_at < t_now - interval '7 days'), 0) as sold_prev_7d,
      coalesce(sum(si.qty), 0) as sold_28d,
      coalesce(sum(si.qty) filter (where extract(isodow from s.created_at at time zone 'Africa/Freetown') in (5, 6, 7)), 0) as weekend_28d,
      coalesce(sum(si.line_total) filter (where s.created_at >= t_now - interval '7 days'), 0) as revenue_7d,
      coalesce(sum(si.line_total - round(si.qty * si.unit_cost, 2)) filter (where s.created_at >= t_now - interval '7 days'), 0) as profit_7d,
      max(s.created_at) as last_sold_at
    from sale_items si join sales s on s.id = si.sale_id
    where s.business_id = b and s.status <> 'voided' and s.created_at >= t_now - interval '28 days'
    group by si.product_id
  ), items as (
    select p.id, p.name, p.unit, p.kind, p.cost_price, p.selling_price, p.reorder_level, p.reorder_qty,
           coalesce(ps.quantity, 0) as stock,
           coalesce(sd.sold_7d, 0) as sold_7d, coalesce(sd.sold_prev_7d, 0) as sold_prev_7d,
           coalesce(sd.sold_28d, 0) as sold_28d, coalesce(sd.weekend_28d, 0) as weekend_28d,
           coalesce(sd.revenue_7d, 0) as revenue_7d, coalesce(sd.profit_7d, 0) as profit_7d,
           sd.last_sold_at, p.created_at,
           (select max(created_at) from stock_movements m where m.product_id = p.id and m.reason = 'purchase') as last_received_at
    from products p
    left join product_stock ps on ps.product_id = p.id
    left join sold sd on sd.product_id = p.id
    where p.business_id = b and p.is_active
  )
  select jsonb_build_object(
    'as_of', t_now, 'today', today,
    'business', (select jsonb_build_object('name', name, 'type', business_type, 'custom_type', custom_type_label,
                                           'city', location_city, 'terminology', terminology)
                 from businesses where id = b),
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.revenue_7d desc, i.stock * i.cost_price desc)
                       from (select * from items
                             where sold_28d > 0 or (kind <> 'service' and stock > 0)
                             order by revenue_7d desc, stock * cost_price desc limit 80) i), '[]'),
    'revenue_7d', (select coalesce(sum(total), 0) from sales where business_id = b and status <> 'voided'
                     and created_at >= t_now - interval '7 days'),
    'revenue_prev_7d', (select coalesce(sum(total), 0) from sales where business_id = b and status <> 'voided'
                          and created_at >= t_now - interval '14 days' and created_at < t_now - interval '7 days'),
    'expenses', coalesce((select jsonb_agg(jsonb_build_object('category', category_name, 'last_7d', l7, 'avg_prev_4w', a4)
                                           order by l7 desc)
                          from (select category_name,
                                       coalesce(sum(amount) filter (where expense_date > today - 7), 0) as l7,
                                       round(coalesce(sum(amount) filter (where expense_date <= today - 7), 0) / 4, 2) as a4
                                from expenses where business_id = b and status = 'recorded' and expense_date > today - 35
                                group by category_name) e), '[]'),
    'shrinkage_7d', (select coalesce(-sum(qty * unit_cost), 0) from stock_movements
                     where business_id = b and qty < 0 and reason in ('count_variance', 'damage', 'expired')
                       and created_at >= t_now - interval '7 days'),
    'shrinkage_items', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('name', p.name, 'location', l.name, 'qty', -sum(m.qty),
                                  'value', round(-sum(m.qty * m.unit_cost), 2)) as x
        from stock_movements m join products p on p.id = m.product_id join locations l on l.id = m.location_id
        where m.business_id = b and m.qty < 0 and m.reason = 'count_variance' and m.created_at >= t_now - interval '28 days'
        group by p.name, l.name order by sum(m.qty * m.unit_cost) limit 5) t), '[]'),
    'cash_variance_7d', coalesce((select jsonb_agg(jsonb_build_object('name', member_name(b, user_id), 'variance', v))
                                  from (select user_id, sum(variance) as v from cash_ups
                                        where business_id = b and created_at >= t_now - interval '7 days'
                                        group by user_id having sum(variance) <> 0) c), '[]'),
    'receivables', (select coalesce(sum(balance), 0) from customers where business_id = b and balance > 0),
    'top_debtors', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'phone', phone, 'balance', balance)
                                              order by balance desc)
                             from (select * from customers where business_id = b and balance > 0
                                   order by balance desc limit 5) c), '[]'),
    'payables', (select coalesce(sum(balance_due), 0) from suppliers where business_id = b and balance_due > 0),
    'expiring_30d', (select jsonb_build_object('batches', count(*), 'value', coalesce(sum(sb.quantity * sb.unit_cost), 0))
                     from stock_batches sb where sb.business_id = b and sb.quantity > 0
                       and sb.expiry_date is not null and sb.expiry_date <= today + 30),
    'voids_7d', (select count(*) from sales where business_id = b and voided_at >= t_now - interval '7 days'),
    'discounts_7d', (select coalesce(sum(discount), 0) from sales where business_id = b and status <> 'voided'
                       and created_at >= t_now - interval '7 days')
  ) into r;
  return r;
end $$;
