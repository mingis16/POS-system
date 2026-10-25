import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowLeftRight } from "lucide-react";
import { requireMember } from "@/lib/auth";
import { PAYMENT_LABELS, formatDateTime, formatMoney, formatQty, formatUsd } from "@/lib/format";
import { Card, PageHeader, TableWrap } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { PrintButton } from "@/components/ui/print-button";
import { buttonDanger, buttonGhost, buttonPrimary, inputClass, numClass, tableClass, tdClass, thClass } from "@/components/ui/styles";
import { ReturnButton } from "@/components/sales/return-dialog";
import { requestVoid, reviewVoid } from "../actions";
import type { PaymentMethod, ReturnItem, Sale, SaleItem, SalePayment, SaleReturn } from "@/lib/types";

export const metadata = { title: "Receipt" };

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, business, can, terms, user } = await requireMember();
  const { data: sale } = await supabase
    .from("sales")
    .select("*, customers(name, phone), locations(name)")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle<Sale & { customers: { name: string; phone: string | null } | null; locations: { name: string } | null }>();
  if (!sale) notFound();

  const [{ data: items }, { data: payments }, { data: members }, { data: returns }, { data: exchangeFor }] = await Promise.all([
    supabase.from("sale_items").select("*").eq("sale_id", id).returns<SaleItem[]>(),
    supabase.from("sale_payments").select("*").eq("sale_id", id).returns<SalePayment[]>(),
    supabase.from("memberships").select("user_id, display_name").eq("business_id", business.id),
    supabase
      .from("returns")
      .select("*, return_items(*), exchange:sales!returns_exchange_sale_id_fkey(receipt_no)")
      .eq("original_sale_id", id)
      .order("created_at")
      .returns<(SaleReturn & { return_items: ReturnItem[]; exchange: { receipt_no: number } | null })[]>(),
    supabase
      .from("returns")
      .select("return_no, original_sale_id, original:sales!returns_original_sale_id_fkey(receipt_no)")
      .eq("exchange_sale_id", id)
      .maybeSingle<{ return_no: number; original_sale_id: string; original: { receipt_no: number } | null }>(),
  ]);
  const who = new Map((members ?? []).map((m) => [m.user_id, m.display_name]));
  const serialIds = (items ?? []).flatMap((i) => i.serial_ids ?? []);
  const { data: serials } = serialIds.length
    ? await supabase.from("serial_units").select("id, serial, warranty_until").in("id", serialIds)
    : { data: [] as { id: string; serial: string; warranty_until: string | null }[] };
  const serialById = new Map((serials ?? []).map((s) => [s.id, s]));
  const mine = sale.created_by === user.id;
  const profit = Number(sale.total) - Number(sale.cost_total);
  const returnedValue = (returns ?? []).reduce((t, r) => t + Number(r.total_refund_amount), 0);
  const fullyReturned = (returns ?? []).length > 0 && returnedValue >= Number(sale.total);

  return (
    <>
      <Link href="/sales" className={`${buttonGhost} no-print -ml-3 mb-2`}>
        <ArrowLeft className="h-4 w-4" /> {terms.sales}
      </Link>
      <PageHeader
        title={`${terms.sale} #${sale.receipt_no}`}
        description={`${formatDateTime(sale.created_at)} · ${who.get(sale.created_by) ?? "—"} · ${sale.locations?.name ?? ""}${sale.offline ? " · recorded offline" : ""}`}
        actions={<PrintButton />}
      />
      {exchangeFor && (
        <p className="no-print mb-4 flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
          <ArrowLeftRight aria-hidden className="h-4 w-4 shrink-0" />
          <span>
            Exchange for return #{exchangeFor.return_no} on{" "}
            <Link href={`/sales/${exchangeFor.original_sale_id}`} className="font-medium underline">
              {terms.sale.toLowerCase()} #{exchangeFor.original?.receipt_no}
            </Link>
            . Part of it was paid with the goods that came back.
          </span>
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="print-area lg:col-span-2" bodyClassName="px-4 py-0 sm:px-5 sm:py-0">
          <TableWrap>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={thClass}>{terms.item}</th>
                  <th className={`${thClass} ${numClass}`}>Qty</th>
                  <th className={`${thClass} ${numClass}`}>Price</th>
                  <th className={`${thClass} ${numClass}`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {(items ?? []).map((i) => (
                  <tr key={i.id}>
                    <td className={tdClass}>
                      {i.name}
                      {Number(i.unit_price) !== Number(i.list_price) && <Badge tone="warning" className="ml-2">price changed from {formatMoney(i.list_price)}</Badge>}
                      {i.performed_by && <span className="ml-2 text-xs text-zinc-500">by {who.get(i.performed_by)}</span>}
                      {(i.serial_ids ?? []).map((sid) => (
                        <div key={sid} className="font-mono text-xs text-zinc-500">
                          {serialById.get(sid)?.serial}
                          {serialById.get(sid)?.warranty_until && ` · warranty to ${serialById.get(sid)!.warranty_until}`}
                        </div>
                      ))}
                    </td>
                    <td className={`${tdClass} ${numClass}`}>{formatQty(i.qty)}</td>
                    <td className={`${tdClass} ${numClass}`}>{formatMoney(i.unit_price)}</td>
                    <td className={`${tdClass} ${numClass}`}>
                      {formatMoney(i.line_total)}
                      {Number(i.discount) > 0 && <div className="text-xs text-amber-600">−{formatMoney(i.discount)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <dl className="flex flex-col gap-1 border-t border-zinc-100 py-4 text-sm dark:border-zinc-800">
            {Number(sale.discount) > 0 && (
              <div className="flex justify-between">
                <dt>Discounts</dt>
                <dd className="tabular-nums">−{formatMoney(sale.discount)}</dd>
              </div>
            )}
            <div className="flex justify-between text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatMoney(sale.total)}</dd>
            </div>
            {(payments ?? []).map((p) => (
              <div key={p.id} className="flex justify-between text-zinc-600 dark:text-zinc-400">
                <dt>
                  {PAYMENT_LABELS[p.method as PaymentMethod]}
                  {p.reference && <span className="ml-1 text-xs">({p.reference})</span>}
                </dt>
                <dd className="tabular-nums">{p.currency === "USD" ? `${formatUsd(p.amount)} = ${formatMoney(p.amount_base)}` : formatMoney(p.amount)}</dd>
              </div>
            ))}
            {can.viewFinance && (
              <div className="no-print flex justify-between text-zinc-500">
                <dt>Gross profit</dt>
                <dd className="tabular-nums">{formatMoney(profit)}</dd>
              </div>
            )}
          </dl>
        </Card>

        <div className="no-print flex flex-col gap-5">
          <Card title="Details">
            <dl className="flex flex-col gap-2 text-sm">
              <Row label={terms.customer}>{sale.customers?.name ?? "Walk-in"}</Row>
              {sale.table_label && <Row label="Table">{sale.table_label}</Row>}
              {sale.prescription_ref && <Row label="Prescription">{sale.prescription_ref}</Row>}
              <Row label="Status">
                {sale.status === "completed" ? <Badge tone="good">Completed</Badge> : sale.status === "void_requested" ? <Badge tone="warning">Void requested</Badge> : <Badge>Voided</Badge>}
              </Row>
              {returnedValue > 0 && (
                <Row label="Returned">
                  <Badge tone="info">{fullyReturned ? "All returned" : `−${formatMoney(returnedValue)}`}</Badge>
                </Row>
              )}
              {sale.void_reason && <Row label="Void reason">{sale.void_reason}</Row>}
              {sale.void_review_note && <Row label="Review note">{sale.void_review_note}</Row>}
            </dl>
          </Card>

          {sale.status === "void_requested" && can.approve && (
            <Card title="Void request">
              <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
                {who.get(sale.created_by)} asked to void this sale: “{sale.void_reason}”. Approving returns the stock and reverses the books.
              </p>
              <ActionForm action={reviewVoid} className="flex flex-col gap-2">
                <input type="hidden" name="sale_id" value={sale.id} />
                <input name="note" placeholder="Note (optional)" className={inputClass} />
                <div className="flex gap-2">
                  <SubmitButton name="decision" value="approve" className={buttonDanger}>
                    Approve void
                  </SubmitButton>
                  <SubmitButton name="decision" value="decline" className={buttonPrimary}>
                    Decline
                  </SubmitButton>
                </div>
              </ActionForm>
            </Card>
          )}

          {sale.status === "completed" && (can.admin || mine) && !fullyReturned && (
            <Card title="Return or exchange" description="Refund, exchange or take back damaged goods. A manager confirms with their PIN.">
              <ReturnButton
                saleId={sale.id}
                receiptNo={sale.receipt_no}
                terms={terms}
                userId={user.id}
                canExchange={can.sell}
                serialLabel={business.modules?.serialLabel}
              />
            </Card>
          )}

          {(returns ?? []).length > 0 && (
            <Card title="Returns" bodyClassName="p-0 sm:p-0">
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {(returns ?? []).map((r) => (
                  <li key={r.id} className="px-4 py-3 text-sm sm:px-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">
                          Return #{r.return_no} <Badge className="ml-1">{RETURN_TYPE_LABELS[r.return_type]}</Badge>
                        </p>
                        <p className="text-xs text-zinc-500">
                          {formatDateTime(r.created_at)} · {who.get(r.processed_by) ?? "—"} · approved by {who.get(r.approved_by) ?? "—"}
                        </p>
                      </div>
                      <span className="shrink-0 font-semibold tabular-nums">−{formatMoney(r.total_refund_amount)}</span>
                    </div>
                    <ul className="mt-2 flex flex-col gap-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                      {r.return_items.map((ri) => (
                        <li key={ri.id}>
                          {formatQty(ri.quantity_returned)} × {ri.name}{" "}
                          {ri.kind === "service" ? null : ri.restock_to_inventory ? (
                            <span className="text-green-700 dark:text-green-400">· back on the shelf</span>
                          ) : (
                            <span className="text-red-700 dark:text-red-400">· written off</span>
                          )}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                      {r.reason}
                      {Number(r.refund_paid) > 0 && ` · ${refundLabel(r)} ${formatMoney(r.refund_paid)}`}
                      {Number(r.applied_to_balance) > 0 && ` · ${formatMoney(r.applied_to_balance)} off what they owe`}
                      {r.exchange_sale_id && (
                        <>
                          {" · exchanged for "}
                          <Link href={`/sales/${r.exchange_sale_id}`} className="underline">
                            {terms.sale.toLowerCase()} #{r.exchange?.receipt_no}
                          </Link>
                        </>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {sale.status === "completed" && (can.admin || mine) && (returns ?? []).length === 0 && !exchangeFor && (
            <Card title={can.admin ? "Void this sale" : "Ask for a void"}>
              <ActionForm action={requestVoid} className="flex flex-col gap-2">
                <input type="hidden" name="sale_id" value={sale.id} />
                <Field label="Reason">
                  <input name="reason" required className={inputClass} placeholder="e.g. customer returned goods, wrong item keyed" />
                </Field>
                <SubmitButton className={buttonDanger} confirm={can.admin ? "Void this sale now? Stock comes back and the books are reversed." : "Send a void request to the owner?"}>
                  {can.admin ? "Void now" : "Request void"}
                </SubmitButton>
              </ActionForm>
              {!can.admin && <p className="mt-2 text-xs text-zinc-500">Sales cannot be edited or deleted. The owner sees every void request.</p>}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

const RETURN_TYPE_LABELS: Record<SaleReturn["return_type"], string> = {
  refund: "Refund",
  exchange: "Exchange",
  damaged: "Damaged goods",
};

function refundLabel(r: SaleReturn): string {
  if (r.refund_method === "cash") return "cash back";
  if (r.refund_method === "mobile_money") return `back by ${r.momo_provider ? PAYMENT_LABELS[r.momo_provider] : "mobile money"}`;
  return "store credit";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
