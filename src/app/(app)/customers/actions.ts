"use server";

import { z } from "zod";
import { ActionError, authorize, check, formObject, runAction, type ActionState } from "@/lib/actions";
import { ADMIN_ROLES } from "@/lib/permissions";
import { MONEY_METHOD, amount } from "@/lib/validation";

/** Added from the till: name and phone only (credit limits are for admins). */
export async function quickAddCustomer(name: string, phone: string): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize();
    const n = z.string().trim().min(1, "Enter a name.").max(120).parse(name);
    const { data, error } = await supabase
      .from("customers")
      .insert({ business_id: business.id, name: n, phone: phone || null })
      .select("id, name, phone, balance, credit_limit")
      .single();
    check(error);
    return { message: "Customer added.", data: { ...data, balance: 0, credit_limit: 0, store_credit: 0 } };
  }, "/pos");
}

const customerSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  name: z.string().trim().min(1, "Enter a name.").max(120),
  phone: z.string().trim().max(30).optional(),
  notes: z.string().trim().max(500).optional(),
  credit_limit: amount("Credit limit"),
});

export async function saveCustomer(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business, membership } = await authorize();
    const v = customerSchema.parse(formObject(form));
    const isAdmin = ADMIN_ROLES.includes(membership.role);
    if (v.id) {
      if (!isAdmin) throw new ActionError("Only an admin can edit customers.");
      const { error } = await supabase
        .from("customers")
        .update({ name: v.name, phone: v.phone || null, notes: v.notes || null, credit_limit: v.credit_limit })
        .eq("id", v.id)
        .eq("business_id", business.id);
      check(error);
      return "Customer updated.";
    }
    if (!isAdmin && v.credit_limit > 0) throw new ActionError("Only an admin can give a credit limit.");
    const { error } = await supabase.from("customers").insert({
      business_id: business.id,
      name: v.name,
      phone: v.phone || null,
      notes: v.notes || null,
      credit_limit: v.credit_limit,
    });
    check(error);
    return "Customer added.";
  }, "/customers");
}

const paymentSchema = z.object({
  customer_id: z.string().uuid(),
  amount: amount("Amount", { allowZero: false }),
  method: MONEY_METHOD,
  note: z.string().trim().max(300).optional(),
});

/** A customer paying off what they owe. */
export async function receiveCustomerPayment(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize();
    const v = paymentSchema.parse(formObject(form));
    const { error } = await supabase.rpc("receive_customer_payment", { p: { business_id: business.id, ...v } });
    check(error);
    return "Payment recorded.";
  }, "/customers");
}
