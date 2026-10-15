"use server";

import { z } from "zod";
import { authorize, check, formObject, runAction, type ActionState } from "@/lib/actions";
import { ADMIN_ROLES } from "@/lib/permissions";
import { MONEY_METHOD, amount } from "@/lib/validation";

const supplierSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  name: z.string().trim().min(1, "Enter a name.").max(120),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email("Enter a valid e-mail.").optional().or(z.literal("")),
  address: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function saveSupplier(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize(ADMIN_ROLES);
    const v = supplierSchema.parse(formObject(form));
    const row = { name: v.name, phone: v.phone || null, email: v.email || null, address: v.address || null, notes: v.notes || null };
    const { error } = v.id
      ? await supabase.from("suppliers").update(row).eq("id", v.id).eq("business_id", business.id)
      : await supabase.from("suppliers").insert({ ...row, business_id: business.id });
    check(error);
    return v.id ? "Supplier updated." : "Supplier added.";
  }, "/suppliers");
}

const paySchema = z.object({
  supplier_id: z.string().uuid(),
  amount: amount("Amount", { allowZero: false }),
  method: MONEY_METHOD,
  note: z.string().trim().max(300).optional(),
});

export async function paySupplier(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize(ADMIN_ROLES);
    const v = paySchema.parse(formObject(form));
    const { error } = await supabase.rpc("pay_supplier", { p: { business_id: business.id, ...v } });
    check(error);
    return "Payment recorded.";
  }, "/suppliers");
}
