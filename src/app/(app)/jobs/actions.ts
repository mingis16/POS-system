"use server";

import { z } from "zod";
import { authorize, check, formObject, runAction, type ActionState } from "@/lib/actions";
import { MONEY_METHOD, amount, jobSchema } from "@/lib/validation";

export async function createJob(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business, user } = await authorize();
    const v = jobSchema.parse(formObject(form));
    const details: Record<string, string> = {};
    for (const [k, val] of form.entries()) {
      if (k.startsWith("details.") && typeof val === "string" && val.trim()) details[k.slice(8)] = val.trim();
    }
    const { error } = await supabase.from("jobs").insert({
      business_id: business.id,
      kind: v.kind,
      title: v.title,
      customer_name: v.customer_name ?? null,
      customer_phone: v.customer_phone ?? null,
      description: v.description ?? null,
      item_ref: v.item_ref ?? null,
      status: v.scheduled_for ? "scheduled" : "pending",
      scheduled_for: v.scheduled_for ? new Date(v.scheduled_for).toISOString() : null,
      due_date: v.due_date ?? null,
      assigned_to: v.assigned_to || null,
      quoted_amount: v.quoted_amount ?? null,
      details,
      created_by: user.id,
    });
    check(error);
    return "Saved.";
  }, "/jobs");
}

export async function updateJobStatus(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize();
    const id = z.string().uuid().parse(form.get("id"));
    const status = z.enum(["pending", "scheduled", "in_progress", "ready", "completed", "cancelled"]).parse(form.get("status"));
    const { error } = await supabase.from("jobs").update({ status }).eq("id", id).eq("business_id", business.id);
    check(error);
    return "Status updated.";
  }, "/jobs");
}

const paySchema = z.object({ job_id: z.string().uuid(), amount: amount("Amount", { allowZero: false }), method: MONEY_METHOD, note: z.string().trim().max(200).optional() });

/** Deposits and balances paid on a job go through the books as service income. */
export async function recordJobPayment(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize();
    const v = paySchema.parse(formObject(form));
    const { error } = await supabase.rpc("record_job_payment", { p: v });
    check(error);
    return "Payment recorded.";
  }, "/jobs");
}
