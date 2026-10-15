import Link from "next/link";
import { AlertOctagon, CheckCircle2, HelpCircle, Scale, TrendingUp } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { addDays, formatDate, formatMoney, formatQty, isISODate, todayISO } from "@/lib/format";
import { Card, EmptyState, PageHeader, TableWrap } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import { buttonSecondary, inputClass, numClass, selectClass, tableClass, tdClass, thClass } from "@/components/ui/styles";

export const metadata = { title: "Reconciliation" };

interface Row {
  product_id: string;
  name: string;
  unit: string;
  category: string | null;
  beginning: number;
  purchased: number;
  sold: number;
  other: number;
  written_off: number;
  count_adjusted: number;
  expected: number;
  closing_book: number;
  counted: number | null;
  book_at_count: number | null;
  variance: number | null;
  variance_value: number;
  count_no: number | null;
  count_status: string | null;
  counted_at: string | null;
  status: "ok" | "short" | "over" | "not_counted";
}
interface Report {
  rows: Row[];
  tolerance_pct: number;
  totals: { items: number; counted: number; short_items: number; shortage_value: number; overage_value: number; written_off_value: number; sold_value: number };
  cash: { cash_ups: number; shortage: number; overage: number; by_staff: { user_id: string; name: string; cash_ups: number; variance: number }[] };
}

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; location?: string; show?: string }> }) {
  const { supabase, business } = await requireAdmin();
  const sp = await searchParams;
  const to = sp.to && isISODate(sp.to) ? sp.to : todayISO();
  const from = sp.from && isISODate(sp.from) ? sp.from : addDays(to, -6);
  const [{ data, error }, { data: locations }] = await Promise.all([
    supabase.rpc("reconciliation_report", { b: business.id, p_from: from, p_to: to, p_location: sp.location || null }),
    supabase.from("locations").select("id, name").eq("business_id", business.id).order("sort_order"),
  ]);
  const r = (data ?? { rows: [], totals: {}, cash: { by_staff: [] } }) as Report;
  const rows = sp.show === "all" ? r.rows : r.rows.filter((x) => x.status !== "ok" || x.sold > 0 || x.purchased > 0);
  const shortPct = r.totals.sold_value > 0 ? (r.totals.shortage_value / r.totals.sold_value) * 100 : null;

  return (
    <>
      <PageHeader
        title="Reconciliation"
        description="Beginning stock + purchases − recorded sales ± other movements = what should be there. Physical counts show what is. The gap is shrinkage."
      />
      {error && <p className="mb-4 text-sm text-red-700">{error.message}</p>}

      <form className="mb-5 flex flex-wrap items-end gap-2">
        <label className="text-xs text-zinc-500">
          From
          <input type="date" name="from" defaultValue={from} className={`${inputClass} !py-1.5`} />
        </label>
        <label className="text-xs text-zinc-500">
          To
          <input type="date" name="to" defaultValue={to} className={`${inputClass} !py-1.5`} />
        </label>
        <select name="location" defaultValue={sp.location ?? ""} className={`${selectClass} !w-auto !py-1.5`}>
          <option value="">All locations</option>
          {(locations ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select name="show" defaultValue={sp.show ?? ""} className={`${selectClass} !w-auto !py-1.5`}>
          <option value="">Items with activity</option>
          <option value="all">All items</option>
        </select>
        <button className={buttonSecondary}>Show</button>
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Stock missing at count"
          value={formatMoney(r.totals.shortage_value)}
          detail={`${r.totals.short_items ?? 0} item(s) short${shortPct !== null ? ` · ${shortPct.toFixed(1)}% of sales value` : ""}`}
          icon={AlertOctagon}
          tone={r.totals.shortage_value > 0 ? "critical" : undefined}
        />
        <StatTile label="Extra found at count" value={formatMoney(r.totals.overage_value)} detail="Often unrecorded deliveries or sales keyed wrongly" icon={TrendingUp} />
        <StatTile label="Written off" value={formatMoney(r.totals.written_off_value)} detail="Damaged, expired, corrected" icon={Scale} />
        <StatTile
          label="Cash short (cash-ups)"
          value={formatMoney(r.cash?.shortage ?? 0)}
          detail={`${r.cash?.cash_ups ?? 0} cash-up(s)`}
          icon={AlertOctagon}
          tone={(r.cash?.shortage ?? 0) > 0 ? "critical" : undefined}
        />
      </div>

      <Card
        title="Stock: book vs physical"
        description={`${r.totals.counted ?? 0} of ${r.totals.items ?? 0} items counted in this period. Tolerance ${r.tolerance_pct}%.`}
        className="mt-5"
        bodyClassName="px-4 py-0 sm:px-5 sm:py-0"
      >
        {rows.length === 0 ? (
          <EmptyState icon={Scale} title="No stock activity in this period" />
        ) : (
          <TableWrap>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={thClass}>Item</th>
                  <th className={`${thClass} ${numClass}`}>Beginning</th>
                  <th className={`${thClass} ${numClass}`}>+ Purchased</th>
                  <th className={`${thClass} ${numClass}`}>− Sold</th>
                  <th className={`${thClass} ${numClass}`}>± Other</th>
                  <th className={`${thClass} ${numClass}`}>= Expected</th>
                  <th className={`${thClass} ${numClass}`}>Physical</th>
                  <th className={`${thClass} ${numClass}`}>Variance</th>
                  <th className={`${thClass} ${numClass}`}>Value</th>
                  <th className={thClass}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.product_id} className={x.status === "short" ? "bg-red-50/70 dark:bg-red-950/25" : ""}>
                    <td className={tdClass}>
                      <Link href={`/inventory/${x.product_id}`} className="font-medium hover:underline">
                        {x.name}
                      </Link>
                      <span className="ml-1 text-xs text-zinc-400">{x.unit}</span>
                    </td>
                    <td className={`${tdClass} ${numClass}`}>{formatQty(x.beginning)}</td>
                    <td className={`${tdClass} ${numClass}`}>{formatQty(x.purchased)}</td>
                    <td className={`${tdClass} ${numClass}`}>{formatQty(x.sold)}</td>
                    <td className={`${tdClass} ${numClass}`} title="Transfers, usage, production, write-offs">
                      {formatQty(Number(x.other) + Number(x.written_off))}
                    </td>
                    <td className={`${tdClass} ${numClass} font-medium`}>{formatQty(x.expected)}</td>
                    <td className={`${tdClass} ${numClass}`}>
                      {x.counted === null ? (
                        <span className="text-zinc-400">—</span>
                      ) : (
                        <span title={`Count #${x.count_no}, ${formatDate(x.counted_at)}; book then ${formatQty(x.book_at_count)}`}>{formatQty(x.counted)}</span>
                      )}
                    </td>
                    <td className={`${tdClass} ${numClass}`}>
                      {x.variance === null ? "" : (
                        <span className={Number(x.variance) < 0 ? "font-semibold text-red-700 dark:text-red-400" : ""}>
                          {Number(x.variance) > 0 ? "+" : ""}
                          {formatQty(x.variance)}
                        </span>
                      )}
                    </td>
                    <td className={`${tdClass} ${numClass}`}>{x.variance ? formatMoney(x.variance_value) : ""}</td>
                    <td className={tdClass}>
                      {x.status === "short" ? (
                        <Badge tone="critical">
                          <AlertOctagon className="h-3.5 w-3.5" /> Short
                        </Badge>
                      ) : x.status === "over" ? (
                        <Badge tone="info">Over</Badge>
                      ) : x.status === "ok" ? (
                        <Badge tone="good">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Matches
                        </Badge>
                      ) : (
                        <Badge>
                          <HelpCircle className="h-3.5 w-3.5" /> Not counted
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card title="Cash: recorded vs counted, by staff" className="mt-5">
        {!r.cash?.by_staff?.length ? (
          <EmptyState title="No cash-ups in this period" />
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            {r.cash.by_staff.map((s) => (
              <li key={s.user_id} className="flex items-center justify-between py-2">
                <span>
                  {s.name} <span className="text-xs text-zinc-500">({s.cash_ups} cash-up(s))</span>
                </span>
                {Number(s.variance) < 0 ? (
                  <Badge tone="critical">Short {formatMoney(-s.variance)}</Badge>
                ) : Number(s.variance) > 0 ? (
                  <Badge tone="info">Over {formatMoney(s.variance)}</Badge>
                ) : (
                  <Badge tone="good">Balanced</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
