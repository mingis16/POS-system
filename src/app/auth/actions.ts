"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/auth";
import type { ActionState } from "@/lib/actions";
import { STAFF_LOGIN_DOMAIN } from "@/lib/constants";

const loginSchema = z.object({
  login: z.string().trim().min(3, "Enter your e-mail or staff username."),
  password: z.string().min(1, "Enter your password."),
  next: z.string().optional(),
});

/** Staff created by the owner sign in with a username; it maps to a synthetic e-mail. */
function loginToEmail(login: string): string {
  const l = login.toLowerCase();
  return l.includes("@") ? l : `${l}@${STAFF_LOGIN_DOMAIN}`;
}

function safeNext(next: string | undefined) {
  return next && /^\/(?!\/)[\w\-/?=&.]*$/.test(next) ? next : "/dashboard";
}

export async function signIn(_: ActionState, form: FormData): Promise<ActionState> {
  if (!isConfigured()) return { ok: false, error: "Supabase is not configured yet. See README → Setup." };
  const parsed = loginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: loginToEmail(parsed.data.login),
    password: parsed.data.password,
  });
  if (error) {
    return {
      ok: false,
      error: error.message.includes("Email not confirmed")
        ? "Confirm your e-mail first: open the link we sent you."
        : "Wrong e-mail/username or password.",
    };
  }
  redirect(safeNext(parsed.data.next));
}

const signupSchema = z.object({
  full_name: z.string().trim().min(2, "Enter your full name.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid e-mail address."),
  phone: z.string().trim().max(20).optional(),
  password: z.string().min(8, "Use at least 8 characters for your password."),
});

export async function signUp(_: ActionState, form: FormData): Promise<ActionState> {
  if (!isConfigured()) return { ok: false, error: "Supabase is not configured yet. See README → Setup." };
  const parsed = signupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_APP_URL || `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.full_name, phone: parsed.data.phone },
      emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
    },
  });
  if (error) return { ok: false, error: error.message };
  if (!data.session) {
    return { ok: true, message: "Check your e-mail and open the confirmation link to continue setting up." };
  }
  redirect("/onboarding");
}
