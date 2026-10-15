"use server";

import { z } from "zod";
import { authorize, check, runAction, type ActionState } from "@/lib/actions";
import { ADMIN_ROLES } from "@/lib/permissions";

/** Staff: asks the owner to void. Admin: voids straight away. Nothing is ever deleted. */
export async function requestVoid(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize();
    const id = z.string().uuid().parse(form.get("sale_id"));
    const reason = z.string().trim().min(3, "Give a reason for the void.").max(300).parse(form.get("reason"));
    const { data, error } = await supabase.rpc("request_sale_void", { p_sale: id, p_reason: reason });
    check(error);
    return data === "voided" ? "Sale voided. Stock and books reversed." : "Void requested. The owner must approve it.";
  }, "/sales");
}

export async function reviewVoid(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(ADMIN_ROLES);
    const id = z.string().uuid().parse(form.get("sale_id"));
    const approve = form.get("decision") === "approve";
    const note = String(form.get("note") ?? "");
    const { error } = await supabase.rpc("review_sale_void", { p_sale: id, p_approve: approve, p_note: note });
    check(error);
    return approve ? "Void approved." : "Void declined; the sale stands.";
  }, "/sales");
}
