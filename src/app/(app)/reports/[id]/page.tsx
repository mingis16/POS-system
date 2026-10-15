import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertOctagon, ArrowLeft, Banknote, MessageCircle, ShieldAlert, TrendingUp, Wallet } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { PAYMENT_LABELS, addDays, formatDate, formatMoney, formatPct, formatQty, titleCase } from "@/lib/format";
import { Card, EmptyState, PageHeader, TableWrap } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { SeverityBadge } from "@/components/ui/badge";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { PrintButton } from "@/components/ui/print-button";
import { ColumnChart, RankBars } from "@/components/charts/column-chart";
import { AdviceList } from "@/components/reports/advice-list";
import { buttonGhost, buttonSecondary, numClass, tableClass, tdClass, thClass } from "@/components/ui/styles";
import { refreshAdvice } from "../actions";
import type { AdviceResult, WeeklyReportData } from "@/lib/types";

export const metadata = { title: "Weekly report" };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, business } = await requireAdmin();
  const { data: report } = await supabase.from("weekly_reports").select("*").eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!report) notFound();
  const d = report.data as WeeklyReportData;
  const advice = report.advice as AdviceResult | null;
  const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
  const revenue = Number(d.pl.revenue);
  const net = Number(d.pl.net_profit);

  const share = [
    `${business.name} — week of ${formatDate(d.week_start)}`,
    `Revenue: ${formatMoney(revenue)}`,
    `Expenses: ${formatMoney(d.pl.operating_expenses)}`,
    `Net ${net >= 0 ? "profit" : "loss"}: ${formatMoney(Math.abs(net))} (${formatPct(d.pl.net_margin_pct)})`,
    d.top_items.length ? `Top seller: ${d.top_items[0].name}` : "",
    Number(d.shrinkage.value) > 0 ? `Shrinkage: ${formatMoney(d.shrinkage.value)}` : "",
    Number(d.cash.shortage) > 0 ? `Cash short: ${formatMoney(d.cash.shortage)}` : "",
    ...(advice?.items.slice(0, 3).map((a) => `• ${a.title}`) ?? []),
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <>
      <Link href="/reports" className={`${buttonGhost} no-print -ml-3 mb-2`}>
        <ArrowLeft className="h-4 w-4" /> Weekly reports
      </Link>
      <PageHeader
        title={`Week of ${formatDate(d.week_start)} – ${formatDate(d.week_end)}`}
        description={`${business.name} · ${business.location_city}`}
        actions={
          <>
            <a className={`${buttonSecondary} no-print`} target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(share)}`}>
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </a>
            <PrintButton />
          </>
        }
      />

      <div className="print-area flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Total revenue" value={formatMoney(revenue, { short: true })} delta={{ pct: pct(revenue, Number(d.previous.revenue)), vs: "previous week" }} icon={Banknote} />
          <StatTile
            label="Operating expenses"
            value={formatMoney(d.pl.operating_expenses, { short: true })}
            delta={{ pct: pct(Number(d.pl.operating_expenses), Number(d.previous.operating_expenses)), vs: "previous week", upIsGood: false }}
            icon={Wallet}
          />
          <StatTile
            label={net >= 0 ? "Net profit" : "Net loss"}
            value={formatMoney(net, { short: true })}
            detail={`Margin ${formatPct(d.pl.net_margin_pct)}`}
            icon={TrendingUp}
            tone={net < 0 ? "critical" : undefined}
          />
          <StatTile
            label="Shrinkage & cash short"
            value={formatMoney(Number(d.shrinkage.value) + Number(d.cash.shortage), { short: true })}
            detail={`Stock ${formatMoney(d.shrinkage.value)} · cash ${formatMoney(d.cash.shortage)}`}
            icon={ShieldAlert}
            tone={Number(d.shrinkage.value) + Number(d.cash.shortage) > 0 ? "critical" : undefined}
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          <Card title="Advisor" className="lg:col-span-2" action={
            <ActionForm action={refreshAdvice} showSuccess={false}>
              <input type="hidden" name="report_id" value={report.id} />
              <SubmitButton className={`${buttonGhost} no-print !py-1 text-xs`}>Refresh</SubmitButton>
            </ActionForm>
          }>
            <AdviceList advice={advice} />
          </Card>
          <Card title="Profit & loss">
            <dl className="flex flex-col gap-1.5 text-sm">
              <PL label="Revenue" value={revenue} strong />
              <PL label="Cost of goods sold" value={-Number(d.pl.cogs)} />
              <PL label="Gross profit" value={Number(d.pl.gross_profit)} strong />
              {d.pl.expense_lines
                .filter((e) => Number(e.amount) !== 0)
                .map((e) => (
                  <PL key={e.name} label={e.name} value={-Number(e.amount)} muted />
                ))}
              {Number(d.pl.shrinkage) !== 0 && <PL label="Stock losses" value={-Number(d.pl.shrinkage)} />}
              <PL label={net >= 0 ? "Net profit" : "Net loss"} value={net} strong />
            </dl>
          </Card>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Revenue by day">
            <ColumnChart
              title="Revenue by day"
              height={150}
              data={d.by_day.map((x) => {
                const dt = new Date(x.date + "T00:00:00Z");
                return {
                  key: x.date,
                  axisLabel: dt.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
                  label: dt.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }),
                  value: Number(x.revenue),
                };
              })}
            />
            <p className="mt-3 text-sm text-zinc-500">
              {d.sales.count} sales · average {formatMoney(d.sales.average)} · discounts {formatMoney(d.sales.discounts)} · {d.sales.voided} voided
            </p>
          </Card>
          <Card title="Top-selling items">
            {d.top_items.length ? (
              <RankBars rows={d.top_items.map((t) => ({ key: t.product_id, label: t.name, value: Number(t.revenue), note: `× ${formatQty(t.qty)}` }))} />
            ) : (
              <EmptyState title="No sales this week" />
            )}
          </Card>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Slow-moving & dead stock" description="In stock but not sold for a while — money sitting on the shelf." bodyClassName="px-4 py-0 sm:px-5 sm:py-0">
            {d.dead_stock.length ? (
              <TableWrap>
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th className={thClass}>Item</th>
                      <th className={`${thClass} ${numClass}`}>Qty</th>
                      <th className={`${thClass} ${numClass}`}>Value</th>
                      <th className={thClass}>Last sold</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.dead_stock.map((x) => (
                      <tr key={x.product_id}>
                        <td className={tdClass}>{x.name}</td>
                        <td className={`${tdClass} ${numClass}`}>{formatQty(x.quantity, x.unit)}</td>
                        <td className={`${tdClass} ${numClass}`}>{formatMoney(x.value)}</td>
                        <td className={tdClass}>{x.last_sold ? formatDate(x.last_sold) : "Never"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <EmptyState title="No dead stock" />
            )}
          </Card>
          <Card title="Discrepancy warnings">
            <div className="flex flex-col gap-3 text-sm">
              {d.shrinkage.lines.length > 0 && (
                <div>
                  <p className="mb-1 flex items-center gap-1.5 font-medium">
                    <AlertOctagon className="h-4 w-4 text-critical" /> Stock losses
                  </p>
                  <ul className="flex flex-col gap-1">
                    {d.shrinkage.lines.map((s, i) => (
                      <li key={i} className="flex justify-between">
                        <span>
                          {s.name} <span className="text-xs text-zinc-500">({titleCase(s.reason)})</span>
                        </span>
                        <span className="tabular-nums">{formatMoney(Math.abs(Number(s.value)))}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {Number(d.cash.shortage) > 0 && (
                <p className="flex items-center gap-1.5">
                  <AlertOctagon className="h-4 w-4 text-critical" /> Cash short {formatMoney(d.cash.shortage)} across {d.cash.cash_ups} cash-up(s)
                </p>
              )}
              {d.alerts.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {d.alerts.map((a) => (
                    <li key={a.kind} className="flex items-center gap-1.5">
                      <SeverityBadge severity={a.severity} /> {titleCase(a.kind)} × {a.count}
                    </li>
                  ))}
                </ul>
              )}
              {!d.shrinkage.lines.length && Number(d.cash.shortage) === 0 && !d.alerts.length && <EmptyState title="No discrepancies this week" />}
            </div>
          </Card>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Payment methods">
            {d.payment_mix.length ? (
              <RankBars rows={d.payment_mix.map((p) => ({ key: p.method, label: PAYMENT_LABELS[p.method], value: Number(p.amount) }))} />
            ) : (
              <EmptyState title="No payments" />
            )}
          </Card>
          <Card title="Staff" bodyClassName="px-4 py-0 sm:px-5 sm:py-0">
            {d.staff.length ? (
              <TableWrap>
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th className={thClass}>Name</th>
                      <th className={`${thClass} ${numClass}`}>Sales</th>
                      <th className={`${thClass} ${numClass}`}>Revenue</th>
                      <th className={`${thClass} ${numClass}`}>Discounts</th>
                      <th className={`${thClass} ${numClass}`}>Commission</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.staff.map((s) => (
                      <tr key={s.user_id}>
                        <td className={tdClass}>{s.name}</td>
                        <td className={`${tdClass} ${numClass}`}>{s.sales}</td>
                        <td className={`${tdClass} ${numClass}`}>{formatMoney(s.revenue)}</td>
                        <td className={`${tdClass} ${numClass}`}>{formatMoney(s.discounts)}</td>
                        <td className={`${tdClass} ${numClass}`}>{formatMoney(s.commission)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <EmptyState title="No staff sales" />
            )}
          </Card>
        </div>
        <p className="text-xs text-zinc-500">
          Customers owe {formatMoney(d.receivables)} · you owe suppliers {formatMoney(d.payables)} · generated {formatDate(report.generated_at)} for{" "}
          {formatDate(d.week_start)}–{formatDate(addDays(d.week_start, 6))}
        </p>
      </div>
    </>
  );
}

function PL({ label, value, strong, muted }: { label: string; value: number; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "border-t border-zinc-100 pt-1.5 font-semibold dark:border-zinc-800" : ""} ${muted ? "pl-3 text-zinc-500" : ""}`}>
      <dt>{label}</dt>
      <dd className={`tabular-nums ${value < 0 && !muted ? "text-zinc-600 dark:text-zinc-400" : ""}`}>{formatMoney(value)}</dd>
    </div>
  );
}
