"use server";

import { z } from "zod";
import { authorize, check, formObject, runAction, type ActionState } from "@/lib/actions";
import { ADMIN_ROLES } from "@/lib/permissions";
import { amount, optionalAmount } from "@/lib/validation";
import { formatMoney } from "@/lib/format";

const schema = z.object({
  opening_float: optionalAmount("Opening float"),
  counted_cash: amount("Cash counted"),
  counted_usd: optionalAmount("Dollars counted"),
  note: z.string().trim().max(300).optional(),
});

export async function submitCashUp(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize();
    const v = schema.parse(formObject(form));
    const { data, error } = await supabase.rpc("submit_cash_up", {
      p: { business_id: business.id, opening_float: v.opening_float ?? 0, counted_cash: v.counted_cash, counted_usd: v.counted_usd ?? 0, note: v.note },
    });
    check(error);
    const variance = Number((data as { variance: number }).variance);
    if (variance < 0) return `Cash-up saved. You are short by ${formatMoney(-variance)}; the owner has been alerted.`;
    if (variance > 0) return `Cash-up saved. You have ${formatMoney(variance)} more than recorded — was a sale missed?`;
    return "Cash-up saved. Your till balances exactly.";
  }, "/cash-up");
}

export async function reviewCashUp(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(ADMIN_ROLES);
    const id = z.string().uuid().parse(form.get("id"));
    const { error } = await supabase.rpc("review_cash_up", { p_id: id, p_note: String(form.get("note") ?? "") });
    check(error);
    return "Marked as reviewed.";
  }, "/cash-up");
}
