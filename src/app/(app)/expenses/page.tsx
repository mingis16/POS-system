import { Wallet } from "lucide-react";
import { requireMember } from "@/lib/auth";
import { PAYMENT_LABELS, addDays, formatDate, formatMoney, todayISO } from "@/lib/format";
import { Card, EmptyState, PageHeader, TableWrap } from "@/components/ui/card";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { buttonDanger, buttonSecondary, buttonSmall, inputClass, numClass, selectClass, tableClass, tdClass, thClass } from "@/components/ui/styles";
import { RankBars } from "@/components/charts/column-chart";
import { addExpenseCategory, recordExpense, voidExpense } from "./actions";
import type { PaymentMethod } from "@/lib/types";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage() {
  const { supabase, business, can } = await requireMember();
  const [{ data: cats }, { data: expenses }, { data: members }] = await Promise.all([
    supabase.from("accounts").select("id, name").eq("business_id", business.id).eq("is_expense_category", true).eq("is_active", true).order("code"),
    supabase
      .from("expenses")
      .select("id, expense_no, category_name, amount, method, paid_to, note, expense_date, status, void_reason, created_by, created_at")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })
      .limit(150),
    supabase.from("memberships").select("user_id, display_name").eq("business_id", business.id),
  ]);
  const who = new Map((members ?? []).map((m) => [m.user_id, m.display_name]));
  const methods = ["cash", ...business.payment_methods.filter((m) => m !== "cash" && m !== "credit")] as PaymentMethod[];
  const today = todayISO();
  const minDate = can.admin ? undefined : addDays(today, -business.staff_backdate_days);

  const monthStart = today.slice(0, 8) + "01";
  const byCat = new Map<string, number>();
  for (const e of expenses ?? []) {
    if (e.status === "recorded" && e.expense_date >= monthStart) byCat.set(e.category_name, (byCat.get(e.category_name) ?? 0) + Number(e.amount));
  }
  const monthRows = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  return (
    <>
      <PageHeader title="Expenses" description="Money paid out for running the business: transport, EDSA, generator fuel, wages…" />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Record an expense">
          <ActionForm action={recordExpense} className="flex flex-col gap-3">
            <Field label="Category">
              <select name="account_id" required className={selectClass}>
                <option value="">Choose…</option>
                {(cats ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount (Le)">
              <input name="amount" inputMode="decimal" required className={inputClass} />
            </Field>
            <Field label="Paid with">
              <select name="method" className={selectClass}>
                {methods.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_LABELS[m]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Paid to">
              <input name="paid_to" className={inputClass} placeholder="e.g. Okada rider, EDSA token, Total filling station" />
            </Field>
            <Field label="Note">
              <input name="note" className={inputClass} />
            </Field>
            <Field label="Date" hint={can.admin ? undefined : `Staff can date up to ${business.staff_backdate_days} day(s) back.`}>
              <input name="expense_date" type="date" defaultValue={today} max={today} min={minDate} className={inputClass} />
            </Field>
            <SubmitButton>Save expense</SubmitButton>
          </ActionForm>
          {can.admin && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-brand-700 dark:text-brand-500">Add a category</summary>
              <ActionForm action={addExpenseCategory} className="mt-2 flex gap-2">
                <input name="name" placeholder="e.g. Security guard" className={inputClass} />
                <SubmitButton className={buttonSecondary}>Add</SubmitButton>
              </ActionForm>
            </details>
          )}
        </Card>

        <div className="flex flex-col gap-5 lg:col-span-2">
          {can.admin && monthRows.length > 0 && (
            <Card title="This month by category">
              <RankBars rows={monthRows.map(([k, v]) => ({ key: k, label: k, value: v }))} />
            </Card>
          )}
          <Card title={can.admin ? "Recent expenses" : "Your expenses"} bodyClassName="px-4 py-0 sm:px-5 sm:py-0">
            {!expenses?.length ? (
              <EmptyState icon={Wallet} title="No expenses recorded yet" />
            ) : (
              <TableWrap>
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th className={thClass}>Date</th>
                      <th className={thClass}>Category</th>
                      <th className={thClass}>Details</th>
                      <th className={`${thClass} ${numClass}`}>Amount</th>
                      <th className={thClass}>By</th>
                      {can.admin && <th className={thClass} />}
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map((e) => (
                      <tr key={e.id} className={e.status === "voided" ? "opacity-50" : ""}>
                        <td className={tdClass}>{formatDate(e.expense_date)}</td>
                        <td className={tdClass}>{e.category_name}</td>
                        <td className={`${tdClass} max-w-56 truncate`}>
                          {[e.paid_to, e.note].filter(Boolean).join(" · ") || "—"}
                          <span className="ml-1 text-xs text-zinc-400">{PAYMENT_LABELS[e.method as PaymentMethod]}</span>
                        </td>
                        <td className={`${tdClass} ${numClass}`}>
                          {e.status === "voided" ? <Badge tone="neutral">voided</Badge> : formatMoney(e.amount)}
                        </td>
                        <td className={tdClass}>{who.get(e.created_by) ?? "—"}</td>
                        {can.admin && (
                          <td className={tdClass}>
                            {e.status === "recorded" && (
                              <details>
                                <summary className="cursor-pointer text-xs text-zinc-500">Void</summary>
                                <ActionForm action={voidExpense} className="mt-1 flex gap-1">
                                  <input type="hidden" name="id" value={e.id} />
                                  <input name="reason" placeholder="Reason" required className={`${inputClass} !w-32 !py-1`} />
                                  <SubmitButton className={`${buttonDanger} ${buttonSmall}`} confirm="Void this expense? This reverses it in the books.">
                                    Void
                                  </SubmitButton>
                                </ActionForm>
                              </details>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
