"use server";

import { z } from "zod";
import { ActionError, authorize, check, formObject, runAction, type ActionState } from "@/lib/actions";
import { ADMIN_ROLES } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { STAFF_LOGIN_DOMAIN } from "@/lib/constants";
import { staffLoginSchema } from "@/lib/validation";

export async function updateMember(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize(ADMIN_ROLES);
    const v = z
      .object({
        user_id: z.string().uuid(),
        role: z.enum(["owner", "admin", "cashier", "storekeeper"]),
        status: z.enum(["active", "pending", "suspended"]),
        display_name: z.string().trim().max(80).optional(),
      })
      .parse(formObject(form));
    const { error } = await supabase.rpc("update_member", {
      b: business.id,
      p_user: v.user_id,
      p_role: v.role,
      p_status: v.status,
      p_name: v.display_name ?? null,
    });
    check(error);
    return v.status === "active" ? "Saved." : v.status === "suspended" ? "Access suspended." : "Saved.";
  }, "/staff");
}

/**
 * Creates a login for a staff member who has no e-mail: they sign in with
 * "username.code" and the password set here. Needs SUPABASE_SERVICE_ROLE_KEY.
 */
export async function createStaffLogin(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business, membership } = await authorize(ADMIN_ROLES);
    const v = staffLoginSchema.parse(formObject(form));
    if (v.role === "admin" && membership.role !== "owner") throw new ActionError("Only the owner can add admins.");
    const admin = createAdminClient();
    if (!admin) throw new ActionError("Creating logins needs SUPABASE_SERVICE_ROLE_KEY on the server. Use the joining code instead.");

    const loginId = `${v.username}.${business.join_code.slice(0, 4).toLowerCase()}`;
    const { data, error } = await admin.auth.admin.createUser({
      email: `${loginId}@${STAFF_LOGIN_DOMAIN}`,
      password: v.password,
      email_confirm: true,
      user_metadata: { full_name: v.display_name, phone: v.phone, staff_login: loginId },
    });
    if (error) {
      throw new ActionError(error.message.toLowerCase().includes("already") ? "That username is taken. Choose another." : error.message);
    }
    const { error: addErr } = await supabase.rpc("add_member", {
      b: business.id,
      p_user: data.user.id,
      p_role: v.role,
      p_name: v.display_name,
      p_phone: v.phone ?? null,
    });
    if (addErr) {
      await admin.auth.admin.deleteUser(data.user.id);
      check(addErr);
    }
    return `Login created. Username: ${loginId} — share it with ${v.display_name} with the password.`;
  }, "/staff");
}

export async function resetStaffPassword(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize(ADMIN_ROLES);
    const userId = z.string().uuid().parse(form.get("user_id"));
    const password = z.string().min(8, "Password must be at least 8 characters.").parse(form.get("password"));
    const { data: m } = await supabase.from("memberships").select("role").eq("business_id", business.id).eq("user_id", userId).maybeSingle();
    if (!m) throw new ActionError("That person is not on this business.");
    if (m.role === "owner") throw new ActionError("Owners reset their own password.");
    const admin = createAdminClient();
    if (!admin) throw new ActionError("Password resets need SUPABASE_SERVICE_ROLE_KEY on the server.");
    const { data: u } = await admin.auth.admin.getUserById(userId);
    if (!u.user?.email?.endsWith(`@${STAFF_LOGIN_DOMAIN}`)) {
      throw new ActionError("This person signs in with their own e-mail; they can reset it themselves.");
    }
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) throw new ActionError(error.message);
    return "Password changed.";
  }, "/staff");
}

export async function regenerateJoinCode(): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize(["owner"]);
    const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
    const { error } = await supabase.from("businesses").update({ join_code: code }).eq("id", business.id);
    check(error);
    return `New joining code: ${code}. The old one no longer works.`;
  }, "/staff");
}
