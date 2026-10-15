"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { ActionError, authorize, check, formObject, runAction, type ActionState } from "@/lib/actions";
import { ADMIN_ROLES } from "@/lib/permissions";
import { amount, csvRowSchema, productSchema, type ProductInput } from "@/lib/validation";

function productRow(v: z.output<typeof productSchema>) {
  return {
    name: v.name,
    sku: v.sku ?? null,
    barcode: v.barcode ?? null,
    kind: v.kind,
    unit: v.unit,
    track_mode: v.kind === "service" ? "none" : v.track_mode,
    attributes: Object.fromEntries(Object.entries(v.attributes).filter(([, val]) => val.trim() !== "")),
    cost_price: v.cost_price,
    selling_price: v.selling_price,
    wholesale_price: v.wholesale_price ?? null,
    reorder_level: v.reorder_level,
    reorder_qty: v.reorder_qty,
    warranty_months: v.warranty_months ?? null,
    commission_pct: v.commission_pct,
    requires_prescription: v.requires_prescription,
    is_regulated: v.is_regulated,
    allow_fractional: v.allow_fractional,
    preferred_supplier_id: v.preferred_supplier_id || null,
  };
}

/** New item, with optional opening stock (and its serial numbers / batch). */
export async function createProduct(input: ProductInput): Promise<ActionState> {
  const result = await runAction(async () => {
    const { supabase, business } = await authorize(ADMIN_ROLES);
    const v = productSchema.parse(input);
    const serials = (v.serials ?? "")
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const { error } = await supabase.rpc("create_products", {
      b: business.id,
      p_items: [
        {
          ...productRow(v),
          category: v.category ?? null,
          opening_qty: v.kind === "service" ? 0 : (v.opening_qty ?? 0),
          location_id: v.location_id || null,
          serials,
          batch_no: v.batch_no ?? null,
          expiry_date: v.expiry_date ?? null,
        },
      ],
    });
    check(error);
    return `${v.name} added.`;
  }, "/inventory");
  if (result?.ok) redirect("/inventory?added=1");
  return result;
}

export async function updateProduct(id: string, input: ProductInput): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize(ADMIN_ROLES);
    const v = productSchema.parse(input);
    let categoryId: string | null = null;
    if (v.category) {
      const { data: existing } = await supabase
        .from("categories")
        .select("id")
        .eq("business_id", business.id)
        .ilike("name", v.category)
        .maybeSingle();
      if (existing) categoryId = existing.id;
      else {
        const { data: created, error } = await supabase
          .from("categories")
          .insert({ business_id: business.id, name: v.category })
          .select("id")
          .single();
        check(error);
        categoryId = created!.id;
      }
    }
    const { error } = await supabase
      .from("products")
      .update({ ...productRow(v), category_id: categoryId })
      .eq("id", id)
      .eq("business_id", business.id);
    check(error);
    return "Saved.";
  }, `/inventory/${id}`);
}

export async function setProductActive(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize(ADMIN_ROLES);
    const id = z.string().uuid().parse(form.get("id"));
    const active = form.get("active") === "true";
    const { error } = await supabase.from("products").update({ is_active: active }).eq("id", id).eq("business_id", business.id);
    check(error);
    return active ? "Item restored." : "Item hidden from the till.";
  }, "/inventory");
}

const adjustSchema = z.object({
  product_id: z.string().uuid(),
  location_id: z.string().uuid(),
  direction: z.enum(["add", "remove"]),
  qty: amount("Quantity", { allowZero: false }),
  reason: z.enum(["adjustment", "damage", "expired", "return_in", "opening"]),
  note: z.string().trim().max(300).optional(),
  unit_cost: z.string().optional(),
  serials: z.string().optional(),
  serial_ids: z.union([z.string(), z.array(z.string())]).optional(),
});

export async function adjustStock(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize(ADMIN_ROLES);
    const v = adjustSchema.parse(formObject(form));
    const qty = v.direction === "remove" ? -v.qty : v.qty;
    if (v.reason === "opening" && qty < 0) throw new ActionError("Opening stock can only be added.");
    const { error } = await supabase.rpc("adjust_stock", {
      p: {
        business_id: business.id,
        product_id: v.product_id,
        location_id: v.location_id,
        qty,
        reason: v.reason,
        note: v.note,
        unit_cost: v.unit_cost || null,
        serials: (v.serials ?? "").split(/[\s,;]+/).filter(Boolean),
        serial_ids: v.serial_ids ? [v.serial_ids].flat() : [],
      },
    });
    check(error);
    return "Stock adjusted.";
  }, "/inventory");
}

const transferSchema = z.object({
  product_id: z.string().uuid(),
  from_location_id: z.string().uuid("Choose where it is moving from."),
  to_location_id: z.string().uuid("Choose where it is moving to."),
  qty: amount("Quantity", { allowZero: false }),
  note: z.string().trim().max(300).optional(),
});

export async function transferStock(_: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize(["owner", "admin", "storekeeper"]);
    const v = transferSchema.parse(formObject(form));
    const { error } = await supabase.rpc("transfer_stock", { p: { business_id: business.id, ...v } });
    check(error);
    return "Stock moved.";
  }, "/inventory");
}

const usageSchema = z.object({
  location_id: z.string().uuid().optional().or(z.literal("")),
  note: z.string().trim().min(2, "Say what the stock was used for.").max(300),
  items: z
    .array(z.object({ product_id: z.string().uuid("Choose an item."), qty: amount("Quantity", { allowZero: false }) }))
    .min(1, "Add the items used."),
});

export async function recordUsage(input: z.input<typeof usageSchema>): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize(["owner", "admin", "storekeeper"]);
    const v = usageSchema.parse(input);
    const { error } = await supabase.rpc("record_usage", {
      p: { business_id: business.id, location_id: v.location_id || null, note: v.note, items: v.items },
    });
    check(error);
    return "Stock usage recorded.";
  }, "/inventory");
}

/** CSV import: validated row by row, then created in one transaction. */
export async function importProducts(rows: Record<string, string>[], defaultUnit: string, locationId: string | null): Promise<ActionState> {
  return runAction(async () => {
    const { supabase, business } = await authorize(ADMIN_ROLES);
    if (rows.length === 0) throw new ActionError("The file has no items.");
    if (rows.length > 2000) throw new ActionError("Import at most 2,000 items at a time.");
    const items = rows.map((r, i) => {
      const parsed = csvRowSchema.safeParse(r);
      if (!parsed.success) throw new ActionError(`Row ${i + 2}: ${parsed.error.issues[0].message}`);
      const v = parsed.data;
      return {
        ...v,
        unit: v.unit || defaultUnit,
        kind: v.kind ?? "stock",
        location_id: locationId,
      };
    });
    const { data, error } = await supabase.rpc("create_products", { b: business.id, p_items: items });
    check(error);
    return `Imported ${data} item(s).`;
  }, "/inventory");
}
