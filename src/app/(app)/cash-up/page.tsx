import { HandCoins } from "lucide-react";
import { requireMember } from "@/lib/auth";
import { PAYMENT_LABELS, formatDateTime, formatMoney, formatUsd } from "@/lib/format";
import { Card, EmptyState, PageHeader, TableWrap } from "@/components/ui/card";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { buttonSecondary, buttonSmall, inputClass, numClass, tableClass, tdClass, thClass } from "@/components/ui/styles";
import { reviewCashUp, submitCashUp } from "./actions";
import type { PaymentMethod } from "@/lib/types";

export const metadata = { title: "Cash-up" };

interface Expected {
  period_start: string;
  expected_cash: number;
  expected_usd: number;
  momo_expected: Record<string, number>;
  sales_count: number;
}

export default async function CashUpPage() {
  const { supabase, business, can } = await requireMember();
  const [{ data: expected }, { data: history }, { data: members }] = await Promise.all([
    supabase.rpc("cash_up_expected", { b: business.id, p_float: 0 }),
    supabase
      .from("cash_ups")
      .select("id, user_id, period_start, period_end, opening_float, expected_cash, expected_usd, counted_cash, counted_usd, variance, status, note, review_note")
      .eq("business_id", business.id)
      .order("period_end", { ascending: false })
      .limit(60),
    supabase.from("memberships").select("user_id, display_name").eq("business_id", business.id),
  ]);
  const e = (expected ?? null) as Expected | null;
  const who = new Map((members ?? []).map((m) => [m.user_id, m.display_name]));
  const momo = Object.entries(e?.momo_expected ?? {}).filter(([, v]) => Number(v) !== 0);

  return (
    <>
      <PageHeader
        title="Cash-up"
        description="At the end of your shift, count the cash in your till. The system compares it with what you recorded and tells the owner about any shortage."
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Close my till">
          {e && (
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              Since {formatDateTime(e.period_start)}: {e.sales_count} sale(s) recorded by you.
              {can.admin && (
                <>
                  {" "}
                  System expects <strong>{formatMoney(e.expected_cash)}</strong> cash plus your opening float
                  {Number(e.expected_usd) > 0 && <> and {formatUsd(e.expected_usd)}</>}.
                </>
              )}
            </p>
          )}
          <ActionForm action={submitCashUp} className="flex flex-col gap-3">
            <Field label="Opening float (Le)" hint="Cash you started the shift with.">
              <input name="opening_float" inputMode="decimal" defaultValue="0" className={inputClass} />
            </Field>
            <Field label="Leones counted now">
              <input name="counted_cash" inputMode="decimal" required className={inputClass} />
            </Field>
            <Field label="US dollars counted (if any)">
              <input name="counted_usd" inputMode="decimal" defaultValue="0" className={inputClass} />
            </Field>
            <Field label="Note">
              <input name="note" className={inputClass} placeholder="Anything the owner should know" />
            </Field>
            <SubmitButton confirm="Submit your cash-up? You cannot change it afterwards.">Submit cash-up</SubmitButton>
          </ActionForm>
          {momo.length > 0 && (
            <div className="mt-5 border-t border-zinc-100 pt-4 text-sm dark:border-zinc-800">
              <p className="mb-2 font-medium">Mobile money / bank you took this shift</p>
              <ul className="flex flex-col gap-1">
                {momo.map(([m, v]) => (
                  <li key={m} className="flex justify-between">
                    <span>{PAYMENT_LABELS[m as PaymentMethod] ?? m}</span>
                    <span className="tabular-nums">{formatMoney(v)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-zinc-500">Check these against the business phone / bank statement.</p>
            </div>
          )}
        </Card>

        <Card title={can.admin ? "All cash-ups" : "My cash-ups"} className="lg:col-span-2" bodyClassName="px-4 py-0 sm:px-5 sm:py-0">
          {!history?.length ? (
            <EmptyState icon={HandCoins} title="No cash-ups yet" />
          ) : (
            <TableWrap>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>Closed</th>
                    {can.admin && <th className={thClass}>Staff</th>}
                    <th className={`${thClass} ${numClass}`}>Expected</th>
                    <th className={`${thClass} ${numClass}`}>Counted</th>
                    <th className={`${thClass} ${numClass}`}>Difference</th>
                    <th className={thClass}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((c) => {
                    const v = Number(c.variance);
                    return (
                      <tr key={c.id}>
                        <td className={tdClass}>{formatDateTime(c.period_end)}</td>
                        {can.admin && <td className={tdClass}>{who.get(c.user_id) ?? "—"}</td>}
                        <td className={`${tdClass} ${numClass}`}>
                          {formatMoney(c.expected_cash)}
                          {Number(c.expected_usd) > 0 && <div className="text-xs text-zinc-500">+ {formatUsd(c.expected_usd)}</div>}
                        </td>
                        <td className={`${tdClass} ${numClass}`}>
                          {formatMoney(c.counted_cash)}
                          {Number(c.counted_usd) > 0 && <div className="text-xs text-zinc-500">+ {formatUsd(c.counted_usd)}</div>}
                        </td>
                        <td className={`${tdClass} ${numClass}`}>
                          {v === 0 ? (
                            <Badge tone="good">Balanced</Badge>
                          ) : v < 0 ? (
                            <Badge tone="critical">Short {formatMoney(-v)}</Badge>
                          ) : (
                            <Badge tone="info">Over {formatMoney(v)}</Badge>
                          )}
                        </td>
                        <td className={tdClass}>
                          {c.status === "reviewed" ? (
                            <span className="text-xs text-zinc-500">Reviewed{c.review_note ? `: ${c.review_note}` : ""}</span>
                          ) : can.admin ? (
                            <ActionForm action={reviewCashUp} className="flex gap-1" showSuccess={false}>
                              <input type="hidden" name="id" value={c.id} />
                              <input name="note" placeholder="Note" className={`${inputClass} !w-28 !py-1`} />
                              <SubmitButton className={`${buttonSecondary} ${buttonSmall}`}>Reviewed</SubmitButton>
                            </ActionForm>
                          ) : (
                            <span className="text-xs text-zinc-500">Submitted</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}
