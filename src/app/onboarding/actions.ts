"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getUser } from "@/lib/auth";
import { BUSINESS_COOKIE } from "@/lib/constants";
import { describeDbError, type ActionState } from "@/lib/actions";
import { getArchetype, locationsFor } from "@/lib/archetypes";
import { onboardingSchema, type OnboardingInput } from "@/lib/validation";
import type { BusinessModules } from "@/lib/types";

async function setBusinessCookie(id: string) {
  (await cookies()).set(BUSINESS_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
}

/** Final step of the wizard: validates everything and creates the business in one transaction. */
export async function createBusiness(input: OnboardingInput): Promise<ActionState> {
  const session = await getUser();
  if (!session) return { ok: false, error: "Your session has expired. Please sign in again." };

  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue.message}${issue.path.length ? ` (${issue.path.join(" › ")})` : ""}` };
  }
  const v = parsed.data;
  const archetype = getArchetype(v.business_type);
  const itemCategories = v.items.map((i) => i.category).filter((c): c is string => Boolean(c));
  const payload = {
    name: v.name,
    owner_name: v.owner_name,
    business_type: v.business_type,
    custom_type_label: v.business_type === "custom" ? v.custom_type_label : null,
    location_city: v.location_city,
    address: v.address ?? null,
    phone: v.phone || null,
    email: v.email || null,
    terminology: v.terminology,
    units: [...new Set(v.units)],
    modules: v.modules as BusinessModules,
    storage_modes: v.storage_modes,
    sales_input_by: v.sales_input_by,
    payment_methods: [...new Set(["cash", ...v.payment_methods])],
    locations: locationsFor(archetype, v.storage_modes),
    categories: [...new Set([...archetype.categories, ...itemCategories])],
    expense_categories: archetype.expenseCategories,
    opening_cash: v.opening_cash ?? 0,
    items: v.items.map((i) => ({
      name: i.name,
      category: i.category ?? null,
      unit: i.unit,
      kind: i.kind,
      sku: i.sku ?? null,
      barcode: i.barcode ?? null,
      cost_price: i.cost_price ?? 0,
      selling_price: i.selling_price ?? 0,
      reorder_level: i.reorder_level ?? 0,
      opening_qty: i.kind === "service" ? 0 : (i.opening_qty ?? 0),
      track_mode: "none",
    })),
  };

  const { data, error } = await session.supabase.rpc("create_business", { p: payload });
  if (error) return { ok: false, error: describeDbError(error) };
  await setBusinessCookie(data as string);
  redirect("/dashboard?welcome=1");
}

const joinSchema = z.object({
  code: z.string().trim().min(4, "Enter the joining code from your manager.").max(16),
  name: z.string().trim().min(2, "Enter your name.").max(80),
  phone: z.string().trim().max(20).optional(),
});

/** A staff member asks to join an existing business. */
export async function joinBusiness(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await getUser();
  if (!session) return { ok: false, error: "Your session has expired. Please sign in again." };
  const parsed = joinSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { error } = await session.supabase.rpc("join_business", {
    p_code: parsed.data.code,
    p_name: parsed.data.name,
    p_phone: parsed.data.phone || null,
  });
  if (error) return { ok: false, error: describeDbError(error) };
  redirect("/pending");
}
