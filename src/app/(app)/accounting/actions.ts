"use server";

import { z } from "zod";
import { authorize, check, formObject, runAction, type ActionState } from "@/lib/actions";
import { MONEY_METHOD, amount } from "@/lib/validation";

const schema = z.object({
  kind: z.enum(["capital", "drawing"]),
  amount: amount("Amount", { allowZero: false }),
  method: MONEY_METHOD,
  note: z.string().trim().max(300).optional(),
});

/** Owner putting money into, or taking money out of, the business. */
export async function ownerTransaction(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize(["owner"]);
    const v = schema.parse(formObject(form));
    const { error } = await supabase.rpc("record_owner_transaction", { p: { business_id: business.id, ...v } });
    check(error);
    return v.kind === "capital" ? "Capital recorded." : "Drawing recorded.";
  }, "/accounting");
}
