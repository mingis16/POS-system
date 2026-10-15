import { Users } from "lucide-react";
import { requireMember } from "@/lib/auth";
import { formatMoney, safeSearch } from "@/lib/format";
import { Card, EmptyState, PageHeader, TableWrap } from "@/components/ui/card";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { buttonSecondary, buttonSmall, inputClass, numClass, selectClass, tableClass, tdClass, thClass } from "@/components/ui/styles";
import { PAYMENT_LABELS } from "@/lib/format";
import { receiveCustomerPayment, saveCustomer } from "./actions";
import type { Customer } from "@/lib/types";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; owing?: string }> }) {
  const { supabase, business, can, terms } = await requireMember();
  const { q, owing } = await searchParams;
  let query = supabase
    .from("customers")
    .select("id, name, phone, notes, credit_limit, balance, is_active")
    .eq("business_id", business.id)
    .order("balance", { ascending: false })
    .order("name")
    .limit(500);
  if (safeSearch(q)) query = query.ilike("name", `%${safeSearch(q)}%`);
  if (owing) query = query.gt("balance", 0);
  const { data } = await query;
  const customers = (data ?? []) as Customer[];
  const totalOwed = customers.reduce((s, c) => s + Math.max(0, Number(c.balance)), 0);
  const methods = ["cash", ...business.payment_methods.filter((m) => m !== "cash" && m !== "credit")] as const;

  return (
    <>
      <PageHeader title={terms.customers} description={`${formatMoney(totalOwed)} owed to you on credit.`} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2" bodyClassName="p-0 sm:p-0">
          <form className="flex gap-2 border-b border-zinc-100 p-3 dark:border-zinc-800">
            <input name="q" defaultValue={q} placeholder={`Search ${terms.customers.toLowerCase()}`} className={inputClass} />
            <label className="flex shrink-0 items-center gap-1.5 text-sm">
              <input type="checkbox" name="owing" value="1" defaultChecked={!!owing} className="accent-brand-600" /> Owing
            </label>
            <button className={buttonSecondary}>Filter</button>
          </form>
          {customers.length === 0 ? (
            <EmptyState icon={Users} title={`No ${terms.customers.toLowerCase()} yet`}>
              Add regulars and anyone who buys on credit.
            </EmptyState>
          ) : (
            <div className="px-4 sm:px-5">
              <TableWrap>
                <table className={tableClass}>
                  <thead>
                    <tr>
                      <th className={thClass}>Name</th>
                      <th className={thClass}>Phone</th>
                      <th className={`${thClass} ${numClass}`}>Owes</th>
                      <th className={`${thClass} ${numClass}`}>Limit</th>
                      <th className={thClass}>Receive payment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((c) => (
                      <tr key={c.id}>
                        <td className={tdClass}>
                          {can.admin ? (
                            <details>
                              <summary className="cursor-pointer font-medium">{c.name}</summary>
                              <ActionForm action={saveCustomer} className="mt-2 flex w-64 flex-col gap-2" resetOnSuccess={false}>
                                <input type="hidden" name="id" value={c.id} />
                                <input name="name" defaultValue={c.name} className={inputClass} />
                                <input name="phone" defaultValue={c.phone ?? ""} placeholder="Phone" className={inputClass} />
                                <input name="credit_limit" defaultValue={c.credit_limit} inputMode="decimal" className={inputClass} aria-label="Credit limit" />
                                <input name="notes" defaultValue={c.notes ?? ""} placeholder="Notes" className={inputClass} />
                                <SubmitButton className={`${buttonSecondary} ${buttonSmall}`}>Save</SubmitButton>
                              </ActionForm>
                            </details>
                          ) : (
                            <span className="font-medium">{c.name}</span>
                          )}
                        </td>
                        <td className={tdClass}>{c.phone ?? "—"}</td>
                        <td className={`${tdClass} ${numClass}`}>
                          {Number(c.balance) > 0 ? <Badge tone="warning">{formatMoney(c.balance)}</Badge> : formatMoney(0)}
                        </td>
                        <td className={`${tdClass} ${numClass}`}>{Number(c.credit_limit) > 0 ? formatMoney(c.credit_limit) : "—"}</td>
                        <td className={tdClass}>
                          {Number(c.balance) > 0 && (
                            <ActionForm action={receiveCustomerPayment} className="flex items-center gap-1.5">
                              <input type="hidden" name="customer_id" value={c.id} />
                              <input name="amount" inputMode="decimal" placeholder="Amount" required className={`${inputClass} !w-24 !py-1.5`} />
                              <select name="method" className={`${selectClass} !w-28 !py-1.5`}>
                                {methods.map((m) => (
                                  <option key={m} value={m}>
                                    {PAYMENT_LABELS[m]}
                                  </option>
                                ))}
                              </select>
                              <SubmitButton className={`${buttonSecondary} ${buttonSmall}`}>Record</SubmitButton>
                            </ActionForm>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </div>
          )}
        </Card>
        <Card title={`Add ${terms.customer.toLowerCase()}`}>
          <ActionForm action={saveCustomer} className="flex flex-col gap-3">
            <Field label="Name">
              <input name="name" required className={inputClass} />
            </Field>
            <Field label="Phone">
              <input name="phone" type="tel" className={inputClass} />
            </Field>
            <Field label="Credit limit (Le)" hint={can.admin ? "0 = no credit allowed. Staff cannot sell above the limit." : "Only admins can set credit limits."}>
              <input name="credit_limit" defaultValue="0" inputMode="decimal" readOnly={!can.admin} className={inputClass} />
            </Field>
            <Field label="Notes">
              <input name="notes" className={inputClass} />
            </Field>
            <SubmitButton>Add</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
