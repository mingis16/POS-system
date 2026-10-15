-- Row level security and privileges.
--
-- Model: every table is readable only by members of the row's business, and
-- money/stock history only by admins or the staff member who recorded it.
-- Clients may write master data (items, suppliers, customers, jobs) through
-- column-limited grants; every transaction goes through the SECURITY DEFINER
-- functions in the operations migration. The anon role gets nothing.

create function public.has_membership(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where business_id = b and user_id = auth.uid())
$$;

create function public.shares_business(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships me join memberships them on them.business_id = me.business_id
    where me.user_id = auth.uid() and me.status = 'active' and them.user_id = other)
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.memberships enable row level security;
alter table public.business_counters enable row level security;
alter table public.locations enable row level security;
alter table public.categories enable row level security;
alter table public.suppliers enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.stock_levels enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_batches enable row level security;
alter table public.serial_units enable row level security;
alter table public.accounts enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
alter table public.audit_log enable row level security;
alter table public.alerts enable row level security;
alter table public.notifications enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_payments enable row level security;
alter table public.expenses enable row level security;
alter table public.stock_receipts enable row level security;
alter table public.stock_receipt_items enable row level security;
alter table public.supplier_payments enable row level security;
alter table public.customer_payments enable row level security;
alter table public.owner_transactions enable row level security;
alter table public.stock_counts enable row level security;
alter table public.stock_count_lines enable row level security;
alter table public.cash_ups enable row level security;
alter table public.jobs enable row level security;
alter table public.job_payments enable row level security;
alter table public.production_runs enable row level security;
alter table public.weekly_reports enable row level security;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or shares_business(id));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy businesses_read on public.businesses for select to authenticated
  using (has_membership(id));
create policy businesses_admin_update on public.businesses for update to authenticated
  using (is_admin(id)) with check (is_admin(id));

create policy memberships_read on public.memberships for select to authenticated
  using (user_id = auth.uid() or is_member(business_id));

-- Master data
create policy locations_read on public.locations for select to authenticated using (is_member(business_id));
create policy locations_admin_insert on public.locations for insert to authenticated with check (is_admin(business_id));
create policy locations_admin_update on public.locations for update to authenticated
  using (is_admin(business_id)) with check (is_admin(business_id));
create policy locations_admin_delete on public.locations for delete to authenticated using (is_admin(business_id));

create policy categories_read on public.categories for select to authenticated using (is_member(business_id));
create policy categories_admin_insert on public.categories for insert to authenticated with check (is_admin(business_id));
create policy categories_admin_update on public.categories for update to authenticated
  using (is_admin(business_id)) with check (is_admin(business_id));
create policy categories_admin_delete on public.categories for delete to authenticated using (is_admin(business_id));

create policy suppliers_read on public.suppliers for select to authenticated using (is_member(business_id));
create policy suppliers_member_insert on public.suppliers for insert to authenticated with check (is_member(business_id));
create policy suppliers_admin_update on public.suppliers for update to authenticated
  using (is_admin(business_id)) with check (is_admin(business_id));

create policy customers_read on public.customers for select to authenticated using (is_member(business_id));
-- Staff can add a customer at the till, but only admins grant credit.
create policy customers_member_insert on public.customers for insert to authenticated
  with check (is_member(business_id) and (credit_limit = 0 or is_admin(business_id)));
create policy customers_admin_update on public.customers for update to authenticated
  using (is_admin(business_id)) with check (is_admin(business_id));

create policy products_read on public.products for select to authenticated using (is_member(business_id));
create policy products_admin_insert on public.products for insert to authenticated with check (is_admin(business_id));
create policy products_admin_update on public.products for update to authenticated
  using (is_admin(business_id)) with check (is_admin(business_id));

create policy accounts_read on public.accounts for select to authenticated using (is_member(business_id));
create policy accounts_admin_insert on public.accounts for insert to authenticated
  with check (is_admin(business_id) and type = 'expense' and is_expense_category and system_key is null);
create policy accounts_admin_update on public.accounts for update to authenticated
  using (is_admin(business_id) and system_key is null) with check (is_admin(business_id));

-- Stock
create policy stock_levels_read on public.stock_levels for select to authenticated using (is_member(business_id));
create policy stock_batches_read on public.stock_batches for select to authenticated using (is_member(business_id));
create policy serial_units_read on public.serial_units for select to authenticated using (is_member(business_id));
create policy stock_movements_admin_read on public.stock_movements for select to authenticated using (is_admin(business_id));

-- Books and controls: admins only
create policy journal_entries_admin_read on public.journal_entries for select to authenticated using (is_admin(business_id));
create policy journal_lines_admin_read on public.journal_lines for select to authenticated using (is_admin(business_id));
create policy audit_log_admin_read on public.audit_log for select to authenticated using (is_admin(business_id));
create policy alerts_admin_read on public.alerts for select to authenticated using (is_admin(business_id));
create policy notifications_admin_read on public.notifications for select to authenticated using (is_admin(business_id));
create policy weekly_reports_admin_read on public.weekly_reports for select to authenticated using (is_admin(business_id));
create policy supplier_payments_admin_read on public.supplier_payments for select to authenticated using (is_admin(business_id));
create policy owner_transactions_admin_read on public.owner_transactions for select to authenticated using (is_admin(business_id));

-- Transactions: admins see all; staff see what they recorded
create policy sales_read on public.sales for select to authenticated
  using (is_admin(business_id) or (created_by = auth.uid() and is_member(business_id)));
create policy sale_items_read on public.sale_items for select to authenticated
  using (is_admin(business_id) or exists (select 1 from public.sales s where s.id = sale_id and s.created_by = auth.uid()));
create policy sale_payments_read on public.sale_payments for select to authenticated
  using (is_admin(business_id) or exists (select 1 from public.sales s where s.id = sale_id and s.created_by = auth.uid()));
create policy expenses_read on public.expenses for select to authenticated
  using (is_admin(business_id) or (created_by = auth.uid() and is_member(business_id)));
create policy stock_receipts_read on public.stock_receipts for select to authenticated
  using (is_admin(business_id) or (created_by = auth.uid() and is_member(business_id)));
create policy stock_receipt_items_read on public.stock_receipt_items for select to authenticated
  using (is_admin(business_id) or exists (select 1 from public.stock_receipts r where r.id = receipt_id and r.created_by = auth.uid()));
create policy customer_payments_read on public.customer_payments for select to authenticated
  using (is_admin(business_id) or (created_by = auth.uid() and is_member(business_id)));
create policy job_payments_read on public.job_payments for select to authenticated
  using (is_admin(business_id) or (created_by = auth.uid() and is_member(business_id)));
create policy stock_counts_read on public.stock_counts for select to authenticated
  using (is_admin(business_id) or (created_by = auth.uid() and is_member(business_id)));
create policy stock_count_lines_read on public.stock_count_lines for select to authenticated
  using (is_admin(business_id) or exists (select 1 from public.stock_counts c where c.id = count_id and c.created_by = auth.uid()));
create policy cash_ups_read on public.cash_ups for select to authenticated
  using (is_admin(business_id) or (user_id = auth.uid() and is_member(business_id)));

-- Jobs are shared work: any member can open and update them
create policy jobs_read on public.jobs for select to authenticated using (is_member(business_id));
create policy jobs_member_insert on public.jobs for insert to authenticated
  with check (is_member(business_id) and created_by = auth.uid());
create policy jobs_member_update on public.jobs for update to authenticated
  using (is_member(business_id)) with check (is_member(business_id));
create policy production_runs_read on public.production_runs for select to authenticated using (is_member(business_id));

-- ---------------------------------------------------------------------------
-- Table privileges (column-limited writes)
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;

grant update (full_name, phone) on public.profiles to authenticated;

grant update (name, custom_type_label, location_city, address, phone, email, usd_rate, terminology, units, modules,
              storage_modes, sales_input_by, payment_methods, max_staff_discount_pct, stock_variance_tolerance_pct,
              cash_variance_tolerance, staff_expense_alert_amount, staff_backdate_days, opening_time, closing_time,
              dead_stock_days, notify, join_code)
  on public.businesses to authenticated;

grant insert (business_id, name, kind, is_default_sale, is_active, sort_order) on public.locations to authenticated;
grant update (name, kind, is_default_sale, is_active, sort_order) on public.locations to authenticated;
grant delete on public.locations to authenticated;

grant insert (business_id, name) on public.categories to authenticated;
grant update (name) on public.categories to authenticated;
grant delete on public.categories to authenticated;

grant insert (business_id, name, phone, email, address, notes) on public.suppliers to authenticated;
grant update (name, phone, email, address, notes, is_active) on public.suppliers to authenticated;

grant insert (business_id, name, phone, notes, credit_limit) on public.customers to authenticated;
grant update (name, phone, notes, credit_limit, is_active) on public.customers to authenticated;

grant insert (business_id, name, sku, barcode, category_id, kind, unit, track_mode, attributes, cost_price,
              selling_price, wholesale_price, reorder_level, reorder_qty, preferred_supplier_id, warranty_months,
              requires_prescription, is_regulated, commission_pct, allow_fractional, is_active)
  on public.products to authenticated;
grant update (name, sku, barcode, category_id, kind, unit, track_mode, attributes, cost_price, selling_price,
              wholesale_price, reorder_level, reorder_qty, preferred_supplier_id, warranty_months,
              requires_prescription, is_regulated, commission_pct, allow_fractional, is_active)
  on public.products to authenticated;

grant insert (business_id, code, name, type, is_expense_category) on public.accounts to authenticated;
grant update (name, is_active) on public.accounts to authenticated;

grant insert (business_id, kind, title, customer_id, customer_name, customer_phone, description, item_ref, status,
              scheduled_for, due_date, assigned_to, quoted_amount, details)
  on public.jobs to authenticated;
grant update (kind, title, customer_id, customer_name, customer_phone, description, item_ref, status,
              scheduled_for, due_date, assigned_to, quoted_amount, details)
  on public.jobs to authenticated;

-- ---------------------------------------------------------------------------
-- Function privileges: only the public API is callable
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.role_in(uuid),
  public.is_member(uuid),
  public.is_admin(uuid),
  public.has_membership(uuid),
  public.shares_business(uuid),
  public.create_business(jsonb),
  public.join_business(text, text, text),
  public.add_member(uuid, uuid, public.member_role, text, text),
  public.update_member(uuid, uuid, public.member_role, public.member_status, text),
  public.create_products(uuid, jsonb),
  public.record_sale(jsonb),
  public.request_sale_void(uuid, text),
  public.review_sale_void(uuid, boolean, text),
  public.record_expense(jsonb),
  public.void_expense(uuid, text),
  public.receive_customer_payment(jsonb),
  public.pay_supplier(jsonb),
  public.record_owner_transaction(jsonb),
  public.receive_stock(jsonb),
  public.adjust_stock(jsonb),
  public.transfer_stock(jsonb),
  public.record_usage(jsonb),
  public.record_production(jsonb),
  public.start_stock_count(uuid, uuid, text, uuid),
  public.save_stock_count(uuid, jsonb),
  public.submit_stock_count(uuid),
  public.review_stock_count(uuid, boolean, text),
  public.cash_up_expected(uuid, numeric),
  public.submit_cash_up(jsonb),
  public.review_cash_up(uuid, text),
  public.record_job_payment(jsonb),
  public.update_alert(uuid, text, text),
  public.scan_expiries(uuid),
  public.verify_audit_chain(uuid),
  public.account_balances(uuid, date, date),
  public.profit_and_loss(uuid, date, date),
  public.cash_flow(uuid, date, date),
  public.reconciliation_report(uuid, date, date, uuid),
  public.dashboard_summary(uuid),
  public.weekly_report_data(uuid, date),
  public.generate_weekly_report(uuid, date),
  public.save_report_advice(uuid, jsonb),
  public.advisor_metrics(uuid)
to authenticated;

-- Live updates for alert badges and the dashboard.
alter publication supabase_realtime add table public.alerts, public.sales;
