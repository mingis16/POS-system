import Link from "next/link";
import { BellRing } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, titleCase } from "@/lib/format";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { SeverityBadge } from "@/components/ui/badge";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { buttonGhost, buttonSecondary, buttonSmall, inputClass, selectClass } from "@/components/ui/styles";
import { scanExpiries, updateAlert } from "./actions";
import type { Alert } from "@/lib/types";

export const metadata = { title: "Alerts" };

const LINKS: Record<string, (a: Alert) => string | null> = {
  sales: (a) => (a.ref_id ? `/sales/${a.ref_id}` : null),
  stock_counts: (a) => (a.ref_id ? `/counts/${a.ref_id}` : null),
  cash_ups: () => "/cash-up",
  products: (a) => (a.product_id ? `/inventory/${a.product_id}` : null),
  stock_receipts: () => "/receiving",
  expenses: () => "/expenses",
  memberships: () => "/staff",
  stock_batches: (a) => (a.product_id ? `/inventory/${a.product_id}` : null),
};

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ status?: string; kind?: string }> }) {
  const { supabase, business } = await requireAdmin();
  const sp = await searchParams;
  const status = sp.status ?? "open";
  let q = supabase.from("alerts").select("*").eq("business_id", business.id).order("created_at", { ascending: false }).limit(200);
  if (status !== "all") q = q.eq("status", status);
  if (sp.kind) q = q.eq("kind", sp.kind);
  const { data } = await q;
  const alerts = ((data ?? []) as Alert[]).sort(
    (a, b) => ["critical", "warning", "info"].indexOf(a.severity) - ["critical", "warning", "info"].indexOf(b.severity),
  );
  const kinds = [...new Set(alerts.map((a) => a.kind))];

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Stock shortages, cash differences, voids, price changes, after-hours sales, low stock and expiry — investigate, then resolve."
        actions={
          <ActionForm action={scanExpiries} resetOnSuccess={false}>
            <SubmitButton className={buttonSecondary}>Check expiry dates</SubmitButton>
          </ActionForm>
        }
      />
      <form className="mb-4 flex flex-wrap gap-2">
        <select name="status" defaultValue={status} className={`${selectClass} !w-auto !py-1.5`}>
          <option value="open">Open</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="resolved">Resolved</option>
          <option value="all">All</option>
        </select>
        <select name="kind" defaultValue={sp.kind ?? ""} className={`${selectClass} !w-auto !py-1.5`}>
          <option value="">All types</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {titleCase(k)}
            </option>
          ))}
        </select>
        <button className={buttonSecondary}>Show</button>
      </form>
      {alerts.length === 0 ? (
        <Card>
          <EmptyState icon={BellRing} title="Nothing here">
            No {status === "all" ? "" : status} alerts.
          </EmptyState>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {alerts.map((a) => {
            const href = a.ref_table ? LINKS[a.ref_table]?.(a) : a.product_id ? `/inventory/${a.product_id}` : null;
            return (
              <li key={a.id}>
                <Card bodyClassName="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityBadge severity={a.severity} />
                        <span className="text-xs text-zinc-500">
                          {titleCase(a.kind)} · {formatDateTime(a.updated_at ?? a.created_at)}
                        </span>
                        {a.status !== "open" && <span className="text-xs text-zinc-500">· {a.status}</span>}
                      </div>
                      <p className="mt-1.5 font-medium">{a.title}</p>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">{a.message}</p>
                      {a.resolution_note && <p className="mt-1 text-xs text-zinc-500">Note: {a.resolution_note}</p>}
                      {href && (
                        <Link href={href} className={`${buttonGhost} ${buttonSmall} -ml-2 mt-1`}>
                          Investigate →
                        </Link>
                      )}
                    </div>
                    {a.status !== "resolved" && (
                      <ActionForm action={updateAlert} className="flex shrink-0 flex-wrap items-center gap-1.5" showSuccess={false}>
                        <input type="hidden" name="id" value={a.id} />
                        <input name="note" placeholder="What did you find?" className={`${inputClass} !w-44 !py-1.5`} />
                        {a.status === "open" && (
                          <SubmitButton name="status" value="acknowledged" className={`${buttonSecondary} ${buttonSmall}`}>
                            Looking into it
                          </SubmitButton>
                        )}
                        <SubmitButton name="status" value="resolved" className={`${buttonSecondary} ${buttonSmall}`}>
                          Resolve
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
