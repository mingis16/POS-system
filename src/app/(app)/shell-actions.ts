"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BUSINESS_COOKIE } from "@/lib/constants";
import { getMemberships } from "@/lib/auth";

/** Switches the business being worked in (only to one the user is an active member of). */
export async function switchBusiness(form: FormData) {
  const id = String(form.get("business_id") ?? "");
  const memberships = await getMemberships();
  if (memberships.some((m) => m.business_id === id && m.status === "active")) {
    (await cookies()).set(BUSINESS_COOKIE, id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
  }
  redirect("/dashboard");
}
