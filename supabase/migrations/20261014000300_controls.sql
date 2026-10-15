-- Anti-fraud controls: a tamper-evident audit trail, alerts for the owner, and
-- an outbox for SMS / WhatsApp notifications.

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------
-- Append-only. Each row stores the SHA-256 of the previous row's hash plus its
-- own content, so editing or deleting a row (even with database superuser
-- rights) breaks the chain, which verify_audit_chain() reports.

create table public.audit_log (
  id bigint generated always as identity primary key,
  business_id uuid,
  actor_id uuid,
  actor_role text,
  action text not null,
  entity text not null,
  entity_id text,
  summary text,
  before jsonb,
  after jsonb,
  ip text,
  user_agent text,
  device_id text,
  created_at timestamptz not null default clock_timestamp(),
  prev_hash text,
  hash text not null
);
create index audit_log_business_idx on public.audit_log (business_id, id desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);

create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function public.forbid_change();

/**
 * Who is calling, from where. The Next.js server forwards the browser's IP,
 * user agent and device id as x-client-* headers, which PostgREST exposes in
 * request.headers.
 */
create function public.request_meta() returns jsonb
language plpgsql stable as $$
declare h jsonb;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    h := null;
  end;
  h := coalesce(h, '{}');
  return jsonb_build_object(
    'ip', coalesce(
      nullif(h ->> 'x-client-ip', ''),
      nullif(h ->> 'cf-connecting-ip', ''),
      nullif(trim(split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1)), '')
    ),
    'ua', left(coalesce(nullif(h ->> 'x-client-ua', ''), h ->> 'user-agent'), 300),
    'device', left(h ->> 'x-device-id', 64)
  );
end $$;

create function public.audit_hash(
  prev text, b uuid, actor uuid, action text, entity text, entity_id text,
  before jsonb, after jsonb, at timestamptz
) returns text
language sql immutable as $$
  select encode(sha256(convert_to(concat_ws('|',
    prev, b::text, actor::text, action, entity, entity_id, before::text, after::text,
    extract(epoch from at)::text
  ), 'UTF8')), 'hex')
$$;

create function public.audit_write(
  b uuid, p_action text, p_entity text, p_entity_id text, p_summary text,
  p_before jsonb default null, p_after jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  prev text;
  meta jsonb := request_meta();
  ts timestamptz := clock_timestamp();
  uid uuid := auth.uid();
begin
  -- One writer per business at a time keeps the chain linear.
  perform pg_advisory_xact_lock(hashtext('audit:' || coalesce(b::text, '-')));
  select hash into prev from audit_log
    where business_id is not distinct from b order by id desc limit 1;
  insert into audit_log (business_id, actor_id, actor_role, action, entity, entity_id, summary,
                         before, after, ip, user_agent, device_id, created_at, prev_hash, hash)
  values (b, uid, case when b is null then null else role_in(b)::text end, p_action, p_entity, p_entity_id, p_summary,
          p_before, p_after, meta ->> 'ip', meta ->> 'ua', meta ->> 'device', ts, prev,
          audit_hash(prev, b, uid, p_action, p_entity, p_entity_id, p_before, p_after, ts));
end $$;

/** Generic row trigger: records inserts, the changed columns of updates, and deletes. */
create function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  old_j jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  new_j jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  row_j jsonb := coalesce(new_j, old_j);
  b uuid;
  before_j jsonb;
  after_j jsonb;
begin
  b := case when tg_table_name = 'businesses' then (row_j ->> 'id')::uuid
            else (row_j ->> 'business_id')::uuid end;
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(key, old_j -> key), jsonb_object_agg(key, value)
      into before_j, after_j
    from jsonb_each(new_j)
    where value is distinct from old_j -> key and key <> 'updated_at';
    if after_j is null then
      return null;
    end if;
  elsif tg_op = 'INSERT' then
    after_j := new_j;
  else
    before_j := old_j;
  end if;
  perform audit_write(b, lower(tg_op), tg_table_name,
                      coalesce(row_j ->> 'id', row_j ->> 'user_id'), null, before_j, after_j);
  return null;
end $$;

/** Re-computes the chain; returns the first row whose hash does not match. */
create function public.verify_audit_chain(b uuid)
returns table (ok boolean, rows_checked bigint, first_bad_id bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  prev text := null;
  n bigint := 0;
begin
  perform require_role(b, '{owner,admin}');
  for r in select * from audit_log where business_id = b order by id loop
    n := n + 1;
    if r.prev_hash is distinct from prev
       or r.hash <> audit_hash(r.prev_hash, r.business_id, r.actor_id, r.action, r.entity, r.entity_id,
                               r.before, r.after, r.created_at) then
      return query select false, n, r.id;
      return;
    end if;
    prev := r.hash;
  end loop;
  return query select true, n, null::bigint;
end $$;

-- ---------------------------------------------------------------------------
-- Alerts
-- ---------------------------------------------------------------------------

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  -- low_stock, stock_variance, cash_shortage, cash_overage, void_request, void_pattern,
  -- price_override, large_discount, after_hours, negative_stock, large_expense,
  -- cost_spike, expiry, staff_join
  kind text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  title text not null,
  message text not null,
  product_id uuid references public.products (id) on delete set null,
  ref_table text,
  ref_id uuid,
  actor_id uuid default auth.uid(),
  data jsonb not null default '{}',
  dedupe_key text,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text
);
create index alerts_business_open_idx on public.alerts (business_id, status, created_at desc);
create unique index alerts_open_dedupe on public.alerts (business_id, dedupe_key)
  where status <> 'resolved' and dedupe_key is not null;

/**
 * Opens an alert, or refreshes the still-open one with the same dedupe key
 * (raising its severity if the new one is worse).
 */
create function public.raise_alert(
  b uuid, p_kind text, p_severity text, p_title text, p_message text,
  p_dedupe text default null, p_product uuid default null,
  p_ref_table text default null, p_ref_id uuid default null, p_data jsonb default '{}'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare a uuid;
begin
  insert into alerts (business_id, kind, severity, title, message, product_id, ref_table, ref_id, data, dedupe_key)
  values (b, p_kind, p_severity, p_title, p_message, p_product, p_ref_table, p_ref_id, coalesce(p_data, '{}'), p_dedupe)
  on conflict (business_id, dedupe_key) where status <> 'resolved' and dedupe_key is not null
  do update set
    title = excluded.title,
    message = excluded.message,
    data = excluded.data,
    severity = case
      when excluded.severity = 'critical' or alerts.severity = 'critical' then 'critical'
      when excluded.severity = 'warning' or alerts.severity = 'warning' then 'warning'
      else 'info' end,
    updated_at = now()
  returning id into a;
  return a;
end $$;

create function public.resolve_alert_key(b uuid, p_dedupe text, p_note text) returns void
language sql security definer set search_path = public as $$
  update alerts set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolution_note = p_note,
                    updated_at = now()
  where business_id = b and dedupe_key = p_dedupe and status <> 'resolved'
$$;

-- ---------------------------------------------------------------------------
-- Notification outbox (SMS / WhatsApp). /api/cron/notifications sends them.
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  alert_id uuid references public.alerts (id) on delete set null,
  channel text not null check (channel in ('sms', 'whatsapp')),
  recipient text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notifications_pending_idx on public.notifications (status, created_at) where status = 'pending';

create function public.queue_alert_notification() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n jsonb;
  biz_name text;
  min_sev text;
begin
  select notify, name into n, biz_name from businesses where id = new.business_id;
  if coalesce(n ->> 'phone', '') = '' then
    return null;
  end if;
  min_sev := coalesce(n ->> 'min_severity', 'critical');
  if (new.kind = 'low_stock' and coalesce((n ->> 'low_stock')::boolean, true))
     or new.severity = 'critical'
     or (min_sev = 'warning' and new.severity = 'warning') then
    insert into notifications (business_id, alert_id, channel, recipient, body)
    values (new.business_id, new.id, coalesce(nullif(n ->> 'channel', ''), 'sms'), n ->> 'phone',
            left(biz_name || ': ' || new.title || '. ' || new.message, 600));
  end if;
  return null;
end $$;

create trigger alerts_notify after insert on public.alerts
  for each row execute function public.queue_alert_notification();

-- ---------------------------------------------------------------------------
-- Audit the master data. Transaction tables get the same trigger in the
-- operations migration.
-- ---------------------------------------------------------------------------

create trigger audit_businesses after insert or update or delete on public.businesses
  for each row execute function public.audit_row();
create trigger audit_memberships after insert or update or delete on public.memberships
  for each row execute function public.audit_row();
create trigger audit_products after insert or update or delete on public.products
  for each row execute function public.audit_row();
create trigger audit_locations after insert or update or delete on public.locations
  for each row execute function public.audit_row();
create trigger audit_categories after insert or update or delete on public.categories
  for each row execute function public.audit_row();
create trigger audit_suppliers after insert or update or delete on public.suppliers
  for each row execute function public.audit_row();
create trigger audit_customers after insert or update or delete on public.customers
  for each row execute function public.audit_row();
create trigger audit_accounts after insert or update or delete on public.accounts
  for each row execute function public.audit_row();

-- Low stock: re-checked whenever a product's stock changes.
create function public.check_low_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  prod record;
  total numeric;
begin
  select id, name, unit, kind, is_active, reorder_level, reorder_qty into prod
  from products where id = new.product_id;
  if prod.kind = 'service' or not prod.is_active or prod.reorder_level <= 0 then
    return null;
  end if;
  select coalesce(sum(quantity), 0) into total from stock_levels where product_id = new.product_id;
  if total <= prod.reorder_level then
    perform raise_alert(
      new.business_id, 'low_stock',
      case when total <= 0 then 'critical' else 'warning' end,
      case when total <= 0 then prod.name || ' is out of stock' else prod.name || ' is running low' end,
      'Only ' || trim(to_char(total, 'FM999999990.###')) || ' ' || prod.unit || ' left (re-order level '
        || trim(to_char(prod.reorder_level, 'FM999999990.###')) || ').'
        || case when prod.reorder_qty > 0
             then ' Suggested order: ' || trim(to_char(prod.reorder_qty, 'FM999999990.###')) || ' ' || prod.unit || '.'
             else '' end,
      'low_stock:' || prod.id, prod.id, 'products', prod.id,
      jsonb_build_object('quantity', total, 'reorder_level', prod.reorder_level, 'reorder_qty', prod.reorder_qty)
    );
  else
    update alerts set status = 'resolved', resolved_at = now(), resolution_note = 'Restocked', updated_at = now()
    where business_id = new.business_id and dedupe_key = 'low_stock:' || prod.id and status <> 'resolved';
  end if;
  return null;
end $$;

create trigger stock_levels_low_stock after insert or update of quantity on public.stock_levels
  for each row execute function public.check_low_stock();
