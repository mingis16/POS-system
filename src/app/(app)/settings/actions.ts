"use server";

import { z } from "zod";
import { ActionError, authorize, check, formObject, runAction, type ActionState } from "@/lib/actions";
import { ADMIN_ROLES } from "@/lib/permissions";
import { PAYMENT_METHOD, amount } from "@/lib/validation";

const list = (v: unknown) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const time = z
  .string()
  .regex(/^(\d{2}:\d{2})?$/, "Use HH:MM.")
  .optional()
  .transform((v) => v || null);

const businessSchema = z.object({
  name: z.string().trim().min(2, "Enter the business name.").max(120),
  location_city: z.string().trim().min(1).max(60),
  address: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  usd_rate: amount("Dollar rate", { allowZero: false }),
  sales_input_by: z.enum(["staff", "admin", "both"]),
  max_staff_discount_pct: amount("Staff discount limit"),
  stock_variance_tolerance_pct: amount("Stock tolerance"),
  cash_variance_tolerance: amount("Cash tolerance"),
  staff_expense_alert_amount: amount("Large expense amount"),
  staff_backdate_days: amount("Backdating days"),
  dead_stock_days: amount("Dead stock days"),
  opening_time: time,
  closing_time: time,
  units: z.string().optional(),
});

export async function saveBusiness(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize(ADMIN_ROLES);
    const raw = formObject(form);
    const v = businessSchema.parse(raw);
    const methods = z.array(PAYMENT_METHOD).parse(list(raw.payment_methods));
    if (v.max_staff_discount_pct > 100) throw new ActionError("The discount limit cannot exceed 100%.");
    if (!Number.isInteger(v.staff_backdate_days) || v.staff_backdate_days > 31) throw new ActionError("Backdating must be 0–31 days.");
    const units = (v.units ?? "")
      .split(",")
      .map((u) => u.trim().toLowerCase())
      .filter(Boolean);
    const { error } = await supabase
      .from("businesses")
      .update({
        name: v.name,
        location_city: v.location_city,
        address: v.address || null,
        phone: v.phone || null,
        email: v.email || null,
        usd_rate: v.usd_rate,
        sales_input_by: v.sales_input_by,
        payment_methods: [...new Set(["cash", ...methods])],
        max_staff_discount_pct: v.max_staff_discount_pct,
        stock_variance_tolerance_pct: v.stock_variance_tolerance_pct,
        cash_variance_tolerance: v.cash_variance_tolerance,
        staff_expense_alert_amount: v.staff_expense_alert_amount,
        staff_backdate_days: v.staff_backdate_days,
        dead_stock_days: Math.min(365, Math.max(7, Math.round(v.dead_stock_days))),
        opening_time: v.opening_time,
        closing_time: v.closing_time,
        units: units.length ? units : business.units,
      })
      .eq("id", business.id);
    check(error);
    return "Settings saved.";
  }, "/settings");
}

const termsSchema = z.object({
  item: z.string().trim().min(1).max(30),
  items: z.string().trim().min(1).max(30),
  sale: z.string().trim().min(1).max(30),
  sales: z.string().trim().min(1).max(30),
  customer: z.string().trim().min(1).max(30),
  customers: z.string().trim().min(1).max(30),
  job: z.string().trim().max(30).optional(),
  jobs: z.string().trim().max(30).optional(),
});

export async function saveTerminology(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize(ADMIN_ROLES);
    const t = termsSchema.parse(formObject(form));
    const raw = formObject(form);
    const modules = {
      ...business.modules,
      serials: raw["m.serials"] === "on",
      batches: raw["m.batches"] === "on",
      expiry: raw["m.batches"] === "on",
      services: raw["m.services"] === "on",
      commissions: raw["m.commissions"] === "on",
      production: raw["m.production"] === "on",
      usage: raw["m.usage"] === "on",
      wholesale: raw["m.wholesale"] === "on",
      tables: raw["m.tables"] === "on",
      prescriptions: raw["m.prescriptions"] === "on",
      warranty: raw["m.warranty"] === "on",
      jobs: (raw["m.jobs"] as string) || null,
      serialLabel: (raw["m.serialLabel"] as string)?.trim() || business.modules?.serialLabel,
    };
    const { error } = await supabase
      .from("businesses")
      .update({ terminology: { ...t, job: t.job || undefined, jobs: t.jobs || undefined }, modules })
      .eq("id", business.id);
    check(error);
    return "Saved.";
  }, "/settings");
}

export async function saveNotifications(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize(ADMIN_ROLES);
    const v = z
      .object({
        phone: z.string().trim().regex(/^(\+?[0-9 ]{7,16})?$/, "Enter a phone number like +23276123456.").optional(),
        channel: z.enum(["sms", "whatsapp"]),
        min_severity: z.enum(["critical", "warning"]),
      })
      .parse(formObject(form));
    const { error } = await supabase
      .from("businesses")
      .update({
        notify: {
          phone: v.phone?.replace(/\s+/g, "") || undefined,
          channel: v.channel,
          min_severity: v.min_severity,
          low_stock: form.get("low_stock") === "on",
        },
      })
      .eq("id", business.id);
    check(error);
    return v.phone ? "Alerts will be sent to " + v.phone + "." : "Outside alerts turned off.";
  }, "/settings");
}

export async function addLocation(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize(ADMIN_ROLES);
    const v = z
      .object({
        name: z.string().trim().min(1, "Enter a name.").max(60),
        kind: z.enum(["shelf", "freezer", "cold_store", "warehouse", "store_room", "vehicle", "other"]),
      })
      .parse(formObject(form));
    const { count } = await supabase.from("locations").select("id", { count: "exact", head: true }).eq("business_id", business.id);
    const { error } = await supabase.from("locations").insert({ business_id: business.id, ...v, sort_order: (count ?? 0) + 1 });
    check(error);
    return "Location added.";
  }, "/settings");
}

export async function updateLocation(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize(ADMIN_ROLES);
    const id = z.string().uuid().parse(form.get("id"));
    const op = String(form.get("op"));
    if (op === "default") {
      check((await supabase.from("locations").update({ is_default_sale: false }).eq("business_id", business.id).eq("is_default_sale", true)).error);
      check((await supabase.from("locations").update({ is_default_sale: true, is_active: true }).eq("id", id).eq("business_id", business.id)).error);
      return "Sales now come out of this location by default.";
    }
    const active = op === "activate";
    check((await supabase.from("locations").update({ is_active: active }).eq("id", id).eq("business_id", business.id).eq("is_default_sale", false)).error);
    return active ? "Location turned on." : "Location turned off (its history is kept).";
  }, "/settings");
}

export async function addCategory(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize(ADMIN_ROLES);
    const name = z.string().trim().min(1, "Enter a name.").max(60).parse(form.get("name"));
    check((await supabase.from("categories").insert({ business_id: business.id, name })).error);
    return "Category added.";
  }, "/settings");
}
