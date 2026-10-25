import Link from "next/link";
import {
  AlertOctagon,
  ArrowRight,
  Banknote,
  ClipboardCheck,
  HandCoins,
  PackagePlus,
  Receipt,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { requireMember } from "@/lib/auth";
import { formatMoney, formatQty, formatDateTime, formatDate } from "@/lib/format";
import { Card, PageHeader, EmptyState } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { SeverityBadge } from "@/components/ui/badge";
import { ColumnChart, RankBars } from "@/components/charts/column-chart";
import { buttonPrimary, buttonSecondary, cardClass } from "@/components/ui/styles";
import type { AlertSeverity } from "@/lib/types";

export const metadata = { title: "Dashboard" };

interface AdminSummary {
  /** revenue and gross_profit are net of today's returns. */
  today: { sales_count: number; revenue: number; gross_profit: number; returns?: { count: number; total: number } };
  today_expenses: number;
  week: { revenue: number; sales_count: number };
  last_week_to_date: number;
  money: { key: string; name: string; balance: number }[];
  alerts: { critical: number; warning: number; info: number };
  recent_alerts: { id: string; kind: string; severity: AlertSeverity; title: string; message: string; created_at: string }[];
  low_stock: { id: string; name: string; unit: string; quantity: number; reorder_level: number; reorder_qty: number }[];
  low_stock_count: number;
  series: { date: string; revenue: number; profit: number }[];
  top_today: { name: string; qty: number; revenue: number }[];
  pending: { void_requests: number; counts_to_review: number; cash_ups_to_review: number; staff_requests: number };
}

interface StaffSummary {
  my_sales_today: { count: number; total: number };
  my_expenses_today: number;
  last_cash_up: { at: string; variance: number } | null;
  open_void_requests: number;
  draft_counts: number;
  low_stock: { id: string; name: string; unit: string; quantity: number; reorder_level: number }[];
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ welcome?: string; denied?: string }> }) {
  const ctx = await requireMember();
  const { supabase, business, can, terms } = ctx;
  const params = await searchParams;
  const { data, error } = await supabase.rpc("dashboard_summary", { b: business.id });

  const banner = (
    <>
      {params.denied && (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          That page is for owners and admins.
        </p>
      )}
      {params.welcome && can.admin && <Welcome joinCode={business.join_code} />}
      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">Could not load the dashboard: {error.message}</p>}
    </>
  );

  if (!can.admin) {
    const s = (data ?? {}) as StaffSummary;
    return (
      <>
        <PageHeader title={`Hello, ${ctx.membership.display_name.split(" ")[0]}`} description={`${business.name} · ${formatDate(new Date())}`} />
        {banner}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {can.sell && <QuickAction href="/pos" icon={ShoppingCart} label={`New ${terms.sale.toLowerCase()}`} primary />}
          <QuickAction href="/expenses" icon={Wallet} label="Record expense" />
          <QuickAction href="/receiving/new" icon={PackagePlus} label="Receive stock" />
          <QuickAction href="/counts" icon={ClipboardCheck} label="Count stock" />
          <QuickAction href="/cash-up" icon={HandCoins} label="Cash-up" />
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <StatTile label={`My ${terms.sales.toLowerCase()} today`} value={formatMoney(s.my_sales_today?.total)} detail={`${s.my_sales_today?.count ?? 0} receipts`} icon={Receipt} />
          <StatTile label="My expenses today" value={formatMoney(s.my_expenses_today)} icon={Wallet} />
          <StatTile
            label="Last cash-up"
            value={s.last_cash_up ? formatMoney(s.last_cash_up.variance) : "None yet"}
            detail={s.last_cash_up ? `Difference · ${formatDateTime(s.last_cash_up.at)}` : "Count your till at the end of your shift"}
            icon={HandCoins}
            tone={s.last_cash_up && s.last_cash_up.variance < 0 ? "critical" : undefined}
          />
        </div>
        {(s.open_void_requests > 0 || s.draft_counts > 0) && (
          <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
            {s.open_void_requests > 0 && `${s.open_void_requests} void request(s) waiting for approval. `}
            {s.draft_counts > 0 && (
              <Link href="/counts" className="text-brand-700 underline dark:text-brand-500">
                {s.draft_counts} stock count(s) not yet submitted.
              </Link>
            )}
          </p>
        )}
        <Card title="Running low" className="mt-5">
          <LowStockList items={s.low_stock ?? []} />
        </Card>
      </>
    );
  }

  const s = (data ?? {}) as AdminSummary;
  const weekDelta = s.last_week_to_date > 0 ? ((s.week?.revenue - s.last_week_to_date) / s.last_week_to_date) * 100 : null;
  const money = Object.fromEntries((s.money ?? []).map((m) => [m.key, m]));
  const cashLike = ["cash", "orange_money", "afrimoney", "qmoney", "bank"]
    .map((k) => money[k])
    .filter((m) => m && (m.balance !== 0 || m.key === "cash"));
  const pending = s.pending ?? { void_requests: 0, counts_to_review: 0, cash_ups_to_review: 0, staff_requests: 0 };
  const pendingItems = [
    { n: pending.void_requests, label: "void request(s)", href: "/sales?status=void_requested" },
    { n: pending.counts_to_review, label: "stock count(s) to review", href: "/counts?status=submitted" },
    { n: pending.cash_ups_to_review, label: "cash-up(s) to review", href: "/cash-up" },
    { n: pending.staff_requests, label: "staff waiting to join", href: "/staff" },
  ].filter((p) => p.n > 0);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${business.name} · ${formatDate(new Date())}`}
        actions={
          <>
            {can.sell && (
              <Link href="/pos" className={buttonPrimary}>
                <ShoppingCart className="h-4 w-4" /> New {terms.sale.toLowerCase()}
              </Link>
            )}
            <Link href="/reports" className={buttonSecondary}>
              <Sparkles className="h-4 w-4" /> Advisor
            </Link>
          </>
        }
      />
      {banner}

      {(s.alerts?.critical > 0 || pendingItems.length > 0) && (
        <div className="mb-5 flex flex-col gap-2">
          {s.alerts?.critical > 0 && (
            <Link
              href="/alerts"
              className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
            >
              <AlertOctagon className="h-5 w-5 shrink-0 text-critical" />
              <span className="flex-1">
                <strong>{s.alerts.critical} critical alert(s)</strong> — stock or cash discrepancies need your attention.
              </span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
          {pendingItems.length > 0 && (
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="text-zinc-500">Waiting for you:</span>
              {pendingItems.map((p) => (
                <Link key={p.href} href={p.href} className="rounded-full bg-amber-50 px-2.5 py-0.5 font-medium text-amber-900 hover:underline dark:bg-amber-950/60 dark:text-amber-200">
                  {p.n} {p.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={`${terms.sales} today`}
          value={formatMoney(s.today?.revenue, { short: true })}
          detail={
            s.today?.returns?.count
              ? `${s.today.sales_count} receipts · ${formatMoney(s.today.returns.total, { short: true })} returned`
              : `${s.today?.sales_count ?? 0} receipts`
          }
          icon={Receipt}
        />
        <StatTile label="Gross profit today" value={formatMoney(s.today?.gross_profit, { short: true })} detail="Sales minus cost of goods" icon={TrendingUp} />
        <StatTile label="Expenses today" value={formatMoney(s.today_expenses, { short: true })} icon={Wallet} />
        <StatTile
          label="This week"
          value={formatMoney(s.week?.revenue, { short: true })}
          delta={{ pct: weekDelta, vs: "same days last week" }}
          icon={Banknote}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card title="Revenue, last 14 days" className="lg:col-span-2">
          <ColumnChart
            title="Revenue, last 14 days"
            highlightLast
            data={(s.series ?? []).map((d) => {
              const dt = new Date(d.date + "T00:00:00Z");
              return {
                key: d.date,
                axisLabel: dt.toLocaleDateString("en-GB", { day: "numeric", timeZone: "UTC" }),
                label: dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }),
                value: Number(d.revenue),
              };
            })}
          />
        </Card>
        <Card title="Money position" description="From the books, right now">
          <ul className="flex flex-col divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            {cashLike.map((m) => (
              <li key={m.key} className="flex justify-between py-2">
                <span className="text-zinc-600 dark:text-zinc-400">{m.name}</span>
                <span className="tabular-nums font-medium">{formatMoney(m.balance)}</span>
              </li>
            ))}
            {money.receivable && (
              <li className="flex justify-between py-2">
                <Link href="/customers" className="text-zinc-600 hover:underline dark:text-zinc-400">
                  Customers owe you
                </Link>
                <span className="tabular-nums font-medium">{formatMoney(money.receivable.balance)}</span>
              </li>
            )}
            {money.payable && (
              <li className="flex justify-between py-2">
                <Link href="/suppliers" className="text-zinc-600 hover:underline dark:text-zinc-400">
                  You owe suppliers
                </Link>
                <span className="tabular-nums font-medium">{formatMoney(money.payable.balance)}</span>
              </li>
            )}
            {money.inventory && (
              <li className="flex justify-between py-2">
                <span className="text-zinc-600 dark:text-zinc-400">Stock at cost</span>
                <span className="tabular-nums font-medium">{formatMoney(money.inventory.balance)}</span>
              </li>
            )}
          </ul>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card
          title="Alerts"
          action={
            <Link href="/alerts" className="text-sm text-brand-700 hover:underline dark:text-brand-500">
              All alerts
            </Link>
          }
        >
          {s.recent_alerts?.length ? (
            <ul className="flex flex-col gap-3">
              {s.recent_alerts.map((a) => (
                <li key={a.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={a.severity} />
                    <span className="text-xs text-zinc-500">{formatDateTime(a.created_at)}</span>
                  </div>
                  <p className="mt-1 font-medium">{a.title}</p>
                  <p className="text-zinc-600 dark:text-zinc-400">{a.message}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No open alerts">Stock and cash look in order.</EmptyState>
          )}
        </Card>
        <Card
          title={`Running low (${s.low_stock_count ?? 0})`}
          action={
            <Link href="/inventory?filter=low" className="text-sm text-brand-700 hover:underline dark:text-brand-500">
              View all
            </Link>
          }
        >
          <LowStockList items={s.low_stock ?? []} />
        </Card>
        <Card title="Top sellers today">
          {s.top_today?.length ? (
            <RankBars rows={s.top_today.map((t) => ({ key: t.name, label: t.name, value: Number(t.revenue), note: `× ${formatQty(t.qty)}` }))} />
          ) : (
            <EmptyState title={`No ${terms.sales.toLowerCase()} yet today`} />
          )}
        </Card>
      </div>
    </>
  );
}

function QuickAction({
  href,
  icon: Icon,
  label,
  primary,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        primary
          ? "flex flex-col items-start gap-3 rounded-2xl bg-brand-600 p-4 text-white shadow-sm hover:bg-brand-700"
          : `${cardClass} flex flex-col items-start gap-3 p-4 hover:border-zinc-300 dark:hover:border-zinc-700`
      }
    >
      <Icon className="h-6 w-6" />
      <span className="text-sm font-medium">{label}</span>
    </Link>
  );
}

function LowStockList({ items }: { items: { id: string; name: string; unit: string; quantity: number; reorder_level: number }[] }) {
  if (!items.length) return <EmptyState title="Nothing below its re-order level" />;
  return (
    <ul className="flex flex-col divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
      {items.map((i) => (
        <li key={i.id} className="flex items-center justify-between gap-3 py-2">
          <Link href={`/inventory/${i.id}`} className="min-w-0 truncate hover:underline">
            {i.name}
          </Link>
          <span className={`shrink-0 tabular-nums ${Number(i.quantity) <= 0 ? "font-semibold text-red-700 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"}`}>
            {formatQty(i.quantity, i.unit)} <span className="text-xs text-zinc-400">/ {formatQty(i.reorder_level)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Welcome({ joinCode }: { joinCode: string }) {
  return (
    <div className="mb-5 rounded-2xl border border-brand-100 bg-brand-50 p-4 text-sm text-brand-800 dark:border-brand-800/40 dark:bg-brand-800/20 dark:text-brand-100">
      <p className="font-semibold">Your business is ready.</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>
          Add staff: give them the joining code <code className="rounded bg-white px-1.5 py-0.5 font-mono font-semibold dark:bg-zinc-900">{joinCode}</code>, or create logins on the{" "}
          <Link href="/staff" className="underline">
            Staff
          </Link>{" "}
          page.
        </li>
        <li>
          Check your{" "}
          <Link href="/inventory" className="underline">
            items and prices
          </Link>
          , then make a test sale on the{" "}
          <Link href="/pos" className="underline">
            till
          </Link>
          .
        </li>
        <li>Each evening: staff do a cash-up; once a week, count stock. Discrepancies show up here in red.</li>
      </ol>
    </div>
  );
}
