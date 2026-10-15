import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertOctagon, ArrowLeft, CheckCircle2 } from "lucide-react";
import { requireMember } from "@/lib/auth";
import { formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { Card, PageHeader, TableWrap } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { CountSheet } from "@/components/inventory/count-sheet";
import { buttonDanger, buttonGhost, buttonPrimary, inputClass, numClass, tableClass, tdClass, thClass } from "@/components/ui/styles";
import { reviewCount } from "../actions";

export const metadata = { title: "Stock count" };

export default async function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, business, can, user } = await requireMember();
  const { data: count } = await supabase
    .from("stock_counts")
    .select("*, locations(name)")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!count) notFound();
  const { data: lines } = await supabase
    .from("stock_count_lines")
    .select("product_id, counted_qty, expected_qty, variance, unit_cost, products(name, unit, categories(name))")
    .eq("count_id", id);
  const { data: members } = await supabase.from("memberships").select("user_id, display_name").eq("business_id", business.id);
  const who = new Map((members ?? []).map((m) => [m.user_id, m.display_name]));

  type L = {
    product_id: string;
    counted_qty: number | null;
    expected_qty: number | null;
    variance: number | null;
    unit_cost: number | null;
    products: { name: string; unit: string; categories: { name: string } | null };
  };
  const rows = ((lines ?? []) as unknown as L[]).sort((a, b) => a.products.name.localeCompare(b.products.name));
  const canEdit = count.status === "draft" && (count.created_by === user.id || can.admin);
  const locName = (count.locations as { name: string } | null)?.name;

  return (
    <>
      <Link href="/counts" className={`${buttonGhost} -ml-3 mb-2`}>
        <ArrowLeft className="h-4 w-4" /> Stock counts
      </Link>
      <PageHeader
        title={`Count #${count.count_no} · ${locName}`}
        description={`Started ${formatDateTime(count.created_at)} by ${who.get(count.created_by) ?? "—"}${count.note ? ` · ${count.note}` : ""}`}
      />

      {canEdit ? (
        <Card>
          <CountSheet
            countId={count.id}
            lines={rows.map((r) => ({
              product_id: r.product_id,
              name: r.products.name,
              unit: r.products.unit,
              category: r.products.categories?.name ?? null,
              counted_qty: r.counted_qty === null ? null : Number(r.counted_qty),
            }))}
          />
        </Card>
      ) : count.status === "draft" ? (
        <Card>
          <p className="text-sm text-zinc-600">This count is being done by {who.get(count.created_by)}.</p>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2" title="Counted vs system" bodyClassName="px-4 py-0 sm:px-5 sm:py-0">
            <TableWrap>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>Item</th>
                    <th className={`${thClass} ${numClass}`}>System</th>
                    <th className={`${thClass} ${numClass}`}>Counted</th>
                    <th className={`${thClass} ${numClass}`}>Difference</th>
                    {can.viewFinance && <th className={`${thClass} ${numClass}`}>Value</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const v = Number(r.variance ?? 0);
                    return (
                      <tr key={r.product_id} className={v < 0 ? "bg-red-50/60 dark:bg-red-950/20" : ""}>
                        <td className={tdClass}>{r.products.name}</td>
                        <td className={`${tdClass} ${numClass}`}>{formatQty(r.expected_qty)}</td>
                        <td className={`${tdClass} ${numClass}`}>{formatQty(r.counted_qty)}</td>
                        <td className={`${tdClass} ${numClass}`}>
                          {v === 0 ? (
                            <span className="text-zinc-400">0</span>
                          ) : (
                            <span className={v < 0 ? "font-semibold text-red-700 dark:text-red-400" : "text-green-800 dark:text-green-400"}>
                              {v > 0 ? "+" : ""}
                              {formatQty(v, r.products.unit)}
                            </span>
                          )}
                        </td>
                        {can.viewFinance && <td className={`${tdClass} ${numClass}`}>{v ? formatMoney(v * Number(r.unit_cost ?? 0)) : ""}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          </Card>
          <div className="flex flex-col gap-5">
            <Card title="Result">
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <dt>Status</dt>
                  <dd>
                    {count.status === "submitted" ? <Badge tone="warning">To review</Badge> : count.status === "approved" ? <Badge tone="good">Approved</Badge> : <Badge>Rejected</Badge>}
                  </dd>
                </div>
                {can.viewFinance && (
                  <>
                    <div className="flex justify-between">
                      <dt className="flex items-center gap-1.5">
                        <AlertOctagon className="h-4 w-4 text-critical" /> Missing
                      </dt>
                      <dd className="font-semibold tabular-nums">{formatMoney(count.loss_value)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-good" /> Extra found
                      </dt>
                      <dd className="tabular-nums">{formatMoney(count.gain_value)}</dd>
                    </div>
                  </>
                )}
                {count.review_note && (
                  <div>
                    <dt className="text-zinc-500">Review note</dt>
                    <dd>{count.review_note}</dd>
                  </div>
                )}
              </dl>
            </Card>
            {count.status === "submitted" && can.approve && (
              <Card title="Review">
                <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
                  Approving sets the system stock to what was counted and books any shortage as a loss. Investigate large shortages first (check
                  receipts, voids and the audit trail).
                </p>
                <ActionForm action={reviewCount} className="flex flex-col gap-2">
                  <input type="hidden" name="count_id" value={count.id} />
                  <input name="note" placeholder="Note (e.g. explained / staff warned)" className={inputClass} />
                  <div className="flex gap-2">
                    <SubmitButton name="decision" value="approve" className={buttonPrimary}>
                      Approve
                    </SubmitButton>
                    <SubmitButton name="decision" value="reject" className={buttonDanger}>
                      Reject (recount)
                    </SubmitButton>
                  </div>
                </ActionForm>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
