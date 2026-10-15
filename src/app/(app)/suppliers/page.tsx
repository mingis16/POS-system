import { Truck } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { PAYMENT_LABELS, formatMoney } from "@/lib/format";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { buttonSecondary, buttonSmall, inputClass, selectClass } from "@/components/ui/styles";
import { paySupplier, saveSupplier } from "./actions";
import type { PaymentMethod, Supplier } from "@/lib/types";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const { supabase, business } = await requireAdmin();
  const { data } = await supabase.from("suppliers").select("*").eq("business_id", business.id).order("balance_due", { ascending: false }).order("name");
  const suppliers = (data ?? []) as Supplier[];
  const owed = suppliers.reduce((s, x) => s + Number(x.balance_due), 0);
  const methods = ["cash", ...business.payment_methods.filter((m) => m !== "cash" && m !== "credit")] as PaymentMethod[];

  return (
    <>
      <PageHeader title="Suppliers" description={`You owe suppliers ${formatMoney(owed)} in total.`} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-3 lg:col-span-2">
          {suppliers.length === 0 ? (
            <Card>
              <EmptyState icon={Truck} title="No suppliers yet">
                They are also added automatically when stock is received.
              </EmptyState>
            </Card>
          ) : (
            suppliers.map((s) => (
              <Card key={s.id} bodyClassName="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{s.name}</p>
                    <p className="text-sm text-zinc-500">{[s.phone, s.email, s.address].filter(Boolean).join(" · ") || "No contact details"}</p>
                  </div>
                  {Number(s.balance_due) > 0 ? <Badge tone="warning">You owe {formatMoney(s.balance_due)}</Badge> : <Badge tone="good">Paid up</Badge>}
                </div>
                <div className="mt-3 flex flex-wrap gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                  {Number(s.balance_due) > 0 && (
                    <ActionForm action={paySupplier} className="flex flex-wrap gap-1.5">
                      <input type="hidden" name="supplier_id" value={s.id} />
                      <input name="amount" inputMode="decimal" required placeholder="Amount" className={`${inputClass} !w-28 !py-1.5`} />
                      <select name="method" className={`${selectClass} !w-auto !py-1.5`}>
                        {methods.map((m) => (
                          <option key={m} value={m}>
                            {PAYMENT_LABELS[m]}
                          </option>
                        ))}
                      </select>
                      <SubmitButton className={`${buttonSecondary} ${buttonSmall}`}>Pay</SubmitButton>
                    </ActionForm>
                  )}
                  <details className="text-sm">
                    <summary className="cursor-pointer py-1.5 text-zinc-500">Edit contact</summary>
                    <ActionForm action={saveSupplier} className="mt-2 grid gap-2 sm:grid-cols-2" resetOnSuccess={false}>
                      <input type="hidden" name="id" value={s.id} />
                      <input name="name" defaultValue={s.name} className={inputClass} />
                      <input name="phone" defaultValue={s.phone ?? ""} placeholder="Phone" className={inputClass} />
                      <input name="email" defaultValue={s.email ?? ""} placeholder="E-mail" className={inputClass} />
                      <input name="address" defaultValue={s.address ?? ""} placeholder="Address" className={inputClass} />
                      <input name="notes" defaultValue={s.notes ?? ""} placeholder="Notes (terms, account no.)" className={`${inputClass} sm:col-span-2`} />
                      <SubmitButton className={`${buttonSecondary} ${buttonSmall} justify-self-start`}>Save</SubmitButton>
                    </ActionForm>
                  </details>
                </div>
              </Card>
            ))
          )}
        </div>
        <Card title="Add supplier">
          <ActionForm action={saveSupplier} className="flex flex-col gap-3">
            <Field label="Name">
              <input name="name" required className={inputClass} />
            </Field>
            <Field label="Phone">
              <input name="phone" type="tel" className={inputClass} />
            </Field>
            <Field label="E-mail">
              <input name="email" type="email" className={inputClass} />
            </Field>
            <Field label="Address">
              <input name="address" className={inputClass} />
            </Field>
            <Field label="Notes">
              <input name="notes" className={inputClass} />
            </Field>
            <SubmitButton>Add supplier</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
