import Link from "next/link";
import { PackagePlus, Plus } from "lucide-react";
import { requireMember } from "@/lib/auth";
import { PAYMENT_LABELS, formatDateTime, formatMoney } from "@/lib/format";
import { Card, EmptyState, PageHeader, TableWrap } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonPrimary, numClass, tableClass, tdClass, thClass } from "@/components/ui/styles";
import type { PaymentMethod } from "@/lib/types";

export const metadata = { title: "Stock received" };

export default async function ReceivingPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const { supabase, business, can } = await requireMember();
  const { done } = await searchParams;
  const [{ data: receipts }, { data: members }] = await Promise.all([
    supabase
      .from("stock_receipts")
      .select("id, receipt_no, invoice_ref, total_cost, amount_paid, payment_method, created_at, created_by, suppliers(name), locations(name), stock_receipt_items(count)")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("memberships").select("user_id, display_name").eq("business_id", business.id),
  ]);
  const who = new Map((members ?? []).map((m) => [m.user_id, m.display_name]));

  return (
    <>
      <PageHeader
        title="Stock received"
        description={can.admin ? "Every delivery, who received it and what is still owed." : "Deliveries you have recorded."}
        actions={
          <Link href="/receiving/new" className={buttonPrimary}>
            <Plus className="h-4 w-4" /> Receive stock
          </Link>
        }
      />
      {done && <p className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-900 dark:bg-green-950/40 dark:text-green-200">Stock received and added to inventory.</p>}
      <Card bodyClassName="px-4 py-0 sm:px-5 sm:py-0">
        {!receipts?.length ? (
          <EmptyState icon={PackagePlus} title="No deliveries recorded yet" />
        ) : (
          <TableWrap>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={thClass}>#</th>
                  <th className={thClass}>When</th>
                  <th className={thClass}>Supplier</th>
                  <th className={thClass}>Into</th>
                  <th className={`${thClass} ${numClass}`}>Lines</th>
                  <th className={`${thClass} ${numClass}`}>Total</th>
                  <th className={thClass}>Paid</th>
                  <th className={thClass}>By</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => {
                  const owed = Number(r.total_cost) - Number(r.amount_paid);
                  const supplier = r.suppliers as unknown as { name: string } | null;
                  const loc = r.locations as unknown as { name: string } | null;
                  const count = (r.stock_receipt_items as unknown as { count: number }[])?.[0]?.count ?? 0;
                  return (
                    <tr key={r.id}>
                      <td className={tdClass}>{r.receipt_no}</td>
                      <td className={tdClass}>{formatDateTime(r.created_at)}</td>
                      <td className={tdClass}>
                        {supplier?.name ?? "—"}
                        {r.invoice_ref && <span className="ml-1 text-xs text-zinc-400">({r.invoice_ref})</span>}
                      </td>
                      <td className={tdClass}>{loc?.name}</td>
                      <td className={`${tdClass} ${numClass}`}>{count}</td>
                      <td className={`${tdClass} ${numClass}`}>{formatMoney(r.total_cost)}</td>
                      <td className={tdClass}>
                        {owed > 0 ? (
                          <Badge tone="warning">owes {formatMoney(owed)}</Badge>
                        ) : (
                          <span className="text-xs">{r.payment_method ? PAYMENT_LABELS[r.payment_method as PaymentMethod] : "—"}</span>
                        )}
                      </td>
                      <td className={tdClass}>{who.get(r.created_by) ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
