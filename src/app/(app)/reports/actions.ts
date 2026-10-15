"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { ActionError, authorize, check, runAction, type ActionState } from "@/lib/actions";
import { ADMIN_ROLES } from "@/lib/permissions";
import { buildAdvice } from "@/lib/advisor";
import { isISODate } from "@/lib/format";

/** Builds (or rebuilds) the report for the week containing the date, with advice. */
export async function generateReport(_: ActionState, form: FormData): Promise<ActionState> {
  let id: string | null = null;
  const result = await runAction(async () => {
    const { supabase, business } = await authorize(ADMIN_ROLES);
    const date = String(form.get("week") ?? "");
    if (!isISODate(date)) throw new ActionError("Choose a date in the week.");
    const { data, error } = await supabase.rpc("generate_weekly_report", { b: business.id, p_week_start: date });
    check(error);
    id = data as string;
    const advice = await buildAdvice(supabase, business.id).catch(() => null);
    if (advice) await supabase.rpc("save_report_advice", { p_report: id, p_advice: advice });
    return "Report ready.";
  }, "/reports");
  if (result?.ok && id) redirect(`/reports/${id}`);
  return result;
}

export async function refreshAdvice(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize(ADMIN_ROLES);
    const id = z.string().uuid().parse(form.get("report_id"));
    const advice = await buildAdvice(supabase, business.id);
    const { error } = await supabase.rpc("save_report_advice", { p_report: id, p_advice: advice });
    check(error);
    return advice.source === "ai" ? "Advice refreshed with AI." : "Advice refreshed.";
  }, "/reports");
}
