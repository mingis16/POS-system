"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { ActionError, authorize, check, runAction, type ActionState } from "@/lib/actions";
import { ADMIN_ROLES } from "@/lib/permissions";

export async function startCount(_: ActionState, form: FormData): Promise<ActionState> {
  let id: string | null = null;
  const result = await runAction(async () => {
    const { supabase, business } = await authorize();
    const location = z.string().uuid("Choose a location.").parse(form.get("location_id"));
    const category = String(form.get("category_id") ?? "") || null;
    const { data, error } = await supabase.rpc("start_stock_count", {
      b: business.id,
      p_location: location,
      p_note: String(form.get("note") ?? ""),
      p_category: category,
    });
    check(error);
    id = data as string;
    return "Count started.";
  }, "/counts");
  if (result?.ok && id) redirect(`/counts/${id}`);
  return result;
}

const linesSchema = z.array(z.object({ product_id: z.string().uuid(), counted_qty: z.string() }));

export async function saveCount(countId: string, lines: { product_id: string; counted_qty: string }[], submit: boolean): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize();
    const parsed = linesSchema.parse(lines).map((l) => ({
      product_id: l.product_id,
      counted_qty: l.counted_qty.trim() === "" ? null : Number(l.counted_qty.replace(/,/g, "")),
    }));
    if (parsed.some((l) => l.counted_qty !== null && (!Number.isFinite(l.counted_qty) || l.counted_qty < 0))) {
      throw new ActionError("Counts must be numbers of 0 or more.");
    }
    const { error } = await supabase.rpc("save_stock_count", { p_count: countId, p_lines: parsed });
    check(error);
    if (!submit) return "Progress saved.";
    const { data, error: subErr } = await supabase.rpc("submit_stock_count", { p_count: countId });
    check(subErr);
    const r = data as { lines_short: number };
    return r.lines_short > 0 ? "Count submitted. Differences were found and sent to the owner." : "Count submitted.";
  }, `/counts/${countId}`);
}

export async function reviewCount(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(ADMIN_ROLES);
    const id = z.string().uuid().parse(form.get("count_id"));
    const approve = form.get("decision") === "approve";
    const { error } = await supabase.rpc("review_stock_count", { p_count: id, p_approve: approve, p_note: String(form.get("note") ?? "") });
    check(error);
    return approve ? "Count approved: stock corrected and losses posted to the books." : "Count rejected; stock unchanged.";
  }, `/counts`);
}
