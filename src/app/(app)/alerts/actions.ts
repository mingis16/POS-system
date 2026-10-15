"use server";

import { z } from "zod";
import { authorize, check, runAction, type ActionState } from "@/lib/actions";
import { ADMIN_ROLES } from "@/lib/permissions";

export async function updateAlert(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase } = await authorize(ADMIN_ROLES);
    const id = z.string().uuid().parse(form.get("id"));
    const status = z.enum(["open", "acknowledged", "resolved"]).parse(form.get("status"));
    const { error } = await supabase.rpc("update_alert", { p_alert: id, p_status: status, p_note: String(form.get("note") ?? "") });
    check(error);
    return status === "resolved" ? "Alert resolved." : "Alert updated.";
  }, "/alerts");
}

export async function scanExpiries(): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize(ADMIN_ROLES);
    const { data, error } = await supabase.rpc("scan_expiries", { b: business.id });
    check(error);
    return `${data} batch(es) expired or expiring within 30 days.`;
  }, "/alerts");
}
