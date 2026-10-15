import Link from "next/link";
import { FileBarChart, Sparkles } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { addDays, formatDate, formatMoney, todayISO, weekStart } from "@/lib/format";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { buttonSecondary, inputClass } from "@/components/ui/styles";
import { generateReport } from "./actions";
import type { WeeklyReportData } from "@/lib/types";

export const metadata = { title: "Weekly reports" };

export default async function ReportsPage() {
  const { supabase, business } = await requireAdmin();
  const { data: reports } = await supabase
    .from("weekly_reports")
    .select("id, week_start, data, advice, generated_at")
    .eq("business_id", business.id)
    .order("week_start", { ascending: false })
    .limit(30);
  const lastWeek = weekStart(addDays(todayISO(), -7));

  return (
    <>
      <PageHeader
        title="Weekly reports"
        description="Revenue vs expenses, profit, top sellers, dead stock and shrinkage for each week, with the advisor's recommendations. Generated every Monday automatically; you can also build one now."
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Build a report">
          <ActionForm action={generateReport} className="flex flex-col gap-3" resetOnSuccess={false}>
            <label className="flex flex-col gap-1.5 text-sm">
              Any day in the week
              <input type="date" name="week" defaultValue={lastWeek} max={todayISO()} className={inputClass} />
            </label>
            <SubmitButton>
              <Sparkles className="h-4 w-4" /> Build report & advice
            </SubmitButton>
            <p className="text-xs text-zinc-500">Weeks run Monday to Sunday. Building the current week gives a week-to-date view.</p>
          </ActionForm>
        </Card>
        <div className="flex flex-col gap-3 lg:col-span-2">
          {!reports?.length ? (
            <Card>
              <EmptyState icon={FileBarChart} title="No reports yet" />
            </Card>
          ) : (
            reports.map((r) => {
              const d = r.data as WeeklyReportData;
              const net = Number(d.pl?.net_profit ?? 0);
              return (
                <Link key={r.id} href={`/reports/${r.id}`} className="block">
                  <Card bodyClassName="p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/60 rounded-2xl">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        Week of {formatDate(r.week_start)} – {formatDate(addDays(r.week_start, 6))}
                      </p>
                      <Badge tone={net >= 0 ? "good" : "critical"}>
                        {net >= 0 ? "Profit" : "Loss"} {formatMoney(Math.abs(net))}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-zinc-500">
                      Revenue {formatMoney(d.pl?.revenue)} · expenses {formatMoney(d.pl?.operating_expenses)} · {d.sales?.count ?? 0} sales
                      {Number(d.shrinkage?.value ?? 0) > 0 && <span className="text-red-600"> · shrinkage {formatMoney(d.shrinkage.value)}</span>}
                    </p>
                  </Card>
                </Link>
              );
            })
          )}
          <Link href="/accounting" className={`${buttonSecondary} self-start`}>
            Full accounts →
          </Link>
        </div>
      </div>
    </>
  );
}
