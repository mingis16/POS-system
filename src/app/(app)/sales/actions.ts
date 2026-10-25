"use server";

import { z } from "zod";
import { ActionError, authorize, check, runAction, type ActionState } from "@/lib/actions";
import { ADMIN_ROLES } from "@/lib/permissions";
import { returnSchema, type ReturnPayload } from "@/lib/validation";
import type { ReturnResult } from "@/lib/types";

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

/**
 * Takes goods back from a sale (refund, exchange or damaged goods) once a
 * manager has entered their PIN. The process_return database function checks
 * the PIN, the quantities and the money, moves stock and posts the books.
 */
export async function processReturn(payload: ReturnPayload): Promise<ActionState<ReturnResult>> {
  return runAction(async () => {
    const { supabase } = await authorize();
    const v = returnSchema.parse(payload);
    const { data, error } = await supabase.rpc("process_return", { p: v });
    check(error);
    const result = data as (ReturnResult & { message?: string }) | null;
    if (!result?.ok) throw new ActionError(result?.message ?? "The return was not saved.");
    return { message: `Return #${result.return_no} recorded.`, data: result };
  });
}
