import Link from "next/link";
import { CloudOff, Receipt } from "lucide-react";
import { requireMember } from "@/lib/auth";
import { addDays, formatDateTime, formatMoney, isISODate, todayISO } from "@/lib/format";
import { Card, EmptyState, PageHeader, TableWrap } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonSecondary, inputClass, numClass, selectClass, tableClass, tdClass, thClass } from "@/components/ui/styles";
import { QueuedSalesPanel } from "@/components/pos/queued-sales";
import { ReturnButton } from "@/components/sales/return-dialog";

export const metadata = { title: "Sales" };

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; status?: string; by?: string }>;
}) {
  const { supabase, business, can, terms, user } = await requireMember();
  const sp = await searchParams;
  const to = sp.to && isISODate(sp.to) ? sp.to : todayISO();
  const from = sp.from && isISODate(sp.from) ? sp.from : addDays(to, -6);

  let q = supabase
    .from("sales")
    .select("id, receipt_no, total, discount, status, offline, created_at, created_by, order_type, table_label, customers(name), sale_payments(method, amount_base), returns!returns_original_sale_id_fkey(total_refund_amount)")
    .eq("business_id", business.id)
    .gte("created_at", `${from}T00:00:00Z`)
    .lt("created_at", `${addDays(to, 1)}T00:00:00Z`)
    .order("created_at", { ascending: false })
    .limit(500);
  if (sp.status) q = q.eq("status", sp.status);
  if (sp.by && can.admin) q = q.eq("created_by", sp.by);
  const [{ data: sales }, { data: members }] = await Promise.all([
    q,
    supabase.from("memberships").select("user_id, display_name").eq("business_id", business.id).order("display_name"),
  ]);
  const who = new Map((members ?? []).map((m) => [m.user_id, m.display_name]));
  const live = (sales ?? []).filter((s) => s.status !== "voided");
  const returnedOf = (s: { returns: unknown }) =>
    ((s.returns as { total_refund_amount: number }[] | null) ?? []).reduce((t, r) => t + Number(r.total_refund_amount), 0);
  const total = live.reduce((s, x) => s + Number(x.total) - returnedOf(x), 0);

  return (
    <>
      <PageHeader
        title={terms.sales}
        description={`${live.length} ${terms.sales.toLowerCase()} · ${formatMoney(total)} after returns${can.admin ? "" : " (yours)"}`}
      />
      <QueuedSalesPanel />
      <Card bodyClassName="p-0 sm:p-0">
        <form className="flex flex-wrap items-end gap-2 border-b border-zinc-100 p-3 dark:border-zinc-800">
          <label className="text-xs text-zinc-500">
            From
            <input type="date" name="from" defaultValue={from} className={`${inputClass} !py-1.5`} />
          </label>
          <label className="text-xs text-zinc-500">
            To
            <input type="date" name="to" defaultValue={to} className={`${inputClass} !py-1.5`} />
          </label>
          <select name="status" defaultValue={sp.status ?? ""} className={`${selectClass} !w-auto !py-1.5`}>
            <option value="">All</option>
            <option value="completed">Completed</option>
            <option value="void_requested">Void requested</option>
            <option value="voided">Voided</option>
          </select>
          {can.admin && (
            <select name="by" defaultValue={sp.by ?? ""} className={`${selectClass} !w-auto !py-1.5`}>
              <option value="">Everyone</option>
              {(members ?? []).map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          )}
          <button className={buttonSecondary}>Show</button>
        </form>
        {!sales?.length ? (
          <EmptyState icon={Receipt} title={`No ${terms.sales.toLowerCase()} in this period`} />
        ) : (
          <div className="px-4 sm:px-5">
            <TableWrap>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>#</th>
                    <th className={thClass}>When</th>
                    <th className={thClass}>{terms.customer}</th>
                    <th className={thClass}>Paid by</th>
                    <th className={`${thClass} ${numClass}`}>Total</th>
                    <th className={thClass}>Staff</th>
                    <th className={thClass}>Status</th>
                    <th className={thClass}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((s) => {
                    const pays = (s.sale_payments as unknown as { method: string }[]) ?? [];
                    const returned = returnedOf(s);
                    const hasReturns = ((s.returns as unknown[] | null) ?? []).length > 0;
                    const fullyReturned = hasReturns && returned >= Number(s.total);
                    return (
                      <tr key={s.id} className={s.status === "voided" ? "opacity-50" : "hover:bg-zinc-50 dark:hover:bg-zinc-900/60"}>
                        <td className={tdClass}>
                          <Link href={`/sales/${s.id}`} className="font-medium hover:underline">
                            {s.receipt_no}
                          </Link>
                          {s.offline && <CloudOff className="ml-1 inline h-3.5 w-3.5 text-zinc-400" aria-label="recorded offline" />}
                        </td>
                        <td className={tdClass}>{formatDateTime(s.created_at)}</td>
                        <td className={tdClass}>
                          {(s.customers as unknown as { name: string } | null)?.name ?? (s.table_label ? `Table ${s.table_label}` : "—")}
                        </td>
                        <td className={tdClass}>{[...new Set(pays.map((p) => p.method.replace("_", " ")))].join(" + ")}</td>
                        <td className={`${tdClass} ${numClass}`}>
                          {formatMoney(s.total)}
                          {Number(s.discount) > 0 && <span className="ml-1 text-xs text-amber-600">−{formatMoney(s.discount)}</span>}
                        </td>
                        <td className={tdClass}>{who.get(s.created_by) ?? "—"}</td>
                        <td className={tdClass}>
                          {s.status === "completed" ? (
                            fullyReturned ? (
                              <Badge tone="info">Returned</Badge>
                            ) : hasReturns ? (
                              <Badge tone="info">Part returned · −{formatMoney(returned)}</Badge>
                            ) : (
                              <Badge tone="good">OK</Badge>
                            )
                          ) : s.status === "void_requested" ? (
                            <Badge tone="warning">Void requested</Badge>
                          ) : (
                            <Badge tone="neutral">Voided</Badge>
                          )}
                        </td>
                        <td className={`${tdClass} text-right`}>
                          {s.status === "completed" && !fullyReturned && (
                            <ReturnButton
                              saleId={s.id}
                              receiptNo={s.receipt_no}
                              terms={terms}
                              userId={user.id}
                              canExchange={can.sell}
                              serialLabel={business.modules?.serialLabel}
                              compact
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          </div>
        )}
      </Card>
    </>
  );
}
