"use client";

import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertOctagon, CheckCircle2, Loader2 } from "lucide-react";
import { productSchema, type ProductInput } from "@/lib/validation";
import type { BusinessModules, Terminology } from "@/lib/types";
import { Field } from "@/components/ui/field";
import { buttonPrimary, inputClass, selectClass } from "@/components/ui/styles";
import { createProduct, updateProduct } from "@/app/(app)/inventory/actions";
import { z } from "zod";

type Output = z.output<typeof productSchema>;

/** Create or edit a catalogue item. Fields adapt to the business's modules (IMEI, expiry, commission…). */
export function ProductForm({
  productId,
  initial,
  modules,
  units,
  categories,
  locations,
  suppliers,
  terms,
}: {
  productId?: string;
  initial?: Partial<ProductInput>;
  modules: BusinessModules;
  units: string[];
  categories: string[];
  locations: { id: string; name: string; is_default_sale: boolean }[];
  suppliers: { id: string; name: string }[];
  terms: Terminology;
}) {
  const editing = Boolean(productId);
  const { register, handleSubmit, control, formState } = useForm<ProductInput, unknown, Output>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: "",
      sku: "",
      barcode: "",
      category: "",
      kind: "stock",
      unit: units[0] ?? "pieces",
      track_mode: modules.serials ? "serial" : modules.batches ? "batch" : "none",
      cost_price: "0",
      selling_price: "",
      wholesale_price: "",
      reorder_level: "0",
      reorder_qty: "0",
      warranty_months: "",
      commission_pct: "0",
      requires_prescription: false,
      is_regulated: false,
      allow_fractional: false,
      attributes: {},
      preferred_supplier_id: "",
      opening_qty: "",
      location_id: locations.find((l) => l.is_default_sale)?.id ?? "",
      serials: "",
      batch_no: "",
      expiry_date: "",
      ...initial,
    },
  });
  const { errors } = formState;
  const kind = useWatch({ control, name: "kind" });
  const track = useWatch({ control, name: "track_mode" });
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const onSubmit = handleSubmit((values) => {
    setResult(null);
    startTransition(async () => {
      // Validated values re-validate cleanly on the server (numbers pass the same schema).
      const input = values as unknown as ProductInput;
      const res = editing ? await updateProduct(productId!, input) : await createProduct(input);
      if (res) setResult(res.ok ? { ok: true, text: res.message ?? "Saved." } : { ok: false, text: res.error ?? "Not saved." });
    });
  });

  const err = (k: keyof ProductInput) => (errors[k]?.message as string | undefined) ?? undefined;
  const allUnits = [...new Set([...units, initial?.unit].filter(Boolean) as string[])];

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={err("name")} className="sm:col-span-2">
          <input {...register("name")} className={inputClass} autoFocus={!editing} />
        </Field>
        <Field label="Type">
          <select {...register("kind")} className={selectClass}>
            <option value="stock">{terms.item} for sale</option>
            <option value="raw_material">Material / ingredient (not sold at the till)</option>
            <option value="service">Service (no stock)</option>
          </select>
        </Field>
        <Field label="Category" hint="Pick or type a new one.">
          <input {...register("category")} list="product-categories" className={inputClass} />
          <datalist id="product-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Unit" error={err("unit")}>
          <select {...register("unit")} className={selectClass}>
            {allUnits.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </Field>
        <Field label="Code / SKU (optional)" error={err("sku")}>
          <input {...register("sku")} className={inputClass} />
        </Field>
        <Field label="Barcode (optional)" hint="Scan into this box with a barcode scanner." error={err("barcode")}>
          <input {...register("barcode")} className={inputClass} inputMode="numeric" />
        </Field>
        {kind !== "service" && (modules.serials || modules.batches || track !== "none") && (
          <Field label="Tracking">
            <select {...register("track_mode")} className={selectClass}>
              <option value="none">Quantity only</option>
              <option value="serial">One {modules.serialLabel ?? "serial number"} per unit</option>
              <option value="batch">Batches with expiry dates</option>
            </select>
          </Field>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Field label="Cost price (Le)" hint="What you pay per unit. Updated automatically when stock is received." error={err("cost_price")}>
          <input {...register("cost_price")} inputMode="decimal" className={inputClass} />
        </Field>
        {kind !== "raw_material" && (
          <Field label="Selling price (Le)" error={err("selling_price")}>
            <input {...register("selling_price")} inputMode="decimal" className={inputClass} />
          </Field>
        )}
        {kind !== "raw_material" && modules.wholesale && (
          <Field label="Wholesale price (Le)" hint="Staff may sell at this price." error={err("wholesale_price")}>
            <input {...register("wholesale_price")} inputMode="decimal" className={inputClass} />
          </Field>
        )}
        {kind !== "service" && (
          <>
            <Field label="Re-order level" hint="Alert when total stock falls to this." error={err("reorder_level")}>
              <input {...register("reorder_level")} inputMode="decimal" className={inputClass} />
            </Field>
            <Field label="Re-order quantity" hint="How much you usually order." error={err("reorder_qty")}>
              <input {...register("reorder_qty")} inputMode="decimal" className={inputClass} />
            </Field>
          </>
        )}
        {suppliers.length > 0 && kind !== "service" && (
          <Field label="Usual supplier">
            <select {...register("preferred_supplier_id")} className={selectClass}>
              <option value="">—</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {modules.warranty && kind !== "service" && (
          <Field label="Warranty (months)" error={err("warranty_months")}>
            <input {...register("warranty_months")} inputMode="numeric" className={inputClass} />
          </Field>
        )}
        {modules.commissions && (
          <Field label="Staff commission (%)" hint="Paid to whoever does the service." error={err("commission_pct")}>
            <input {...register("commission_pct")} inputMode="decimal" className={inputClass} />
          </Field>
        )}
      </section>

      <section className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {kind !== "service" && (
          <label className="flex items-center gap-2">
            <input type="checkbox" {...register("allow_fractional")} className="accent-brand-600" /> Can be sold in fractions (e.g. 2.5 kg)
          </label>
        )}
        {modules.prescriptions && (
          <>
            <label className="flex items-center gap-2">
              <input type="checkbox" {...register("requires_prescription")} className="accent-brand-600" /> Prescription only (Rx)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" {...register("is_regulated")} className="accent-brand-600" /> Controlled / regulated
            </label>
          </>
        )}
      </section>

      {(modules.attributes?.length ?? 0) > 0 && (
        <section className="grid gap-4 sm:grid-cols-4">
          {modules.attributes!.map((a) => (
            <Field key={a.key} label={a.label}>
              <input {...register(`attributes.${a.key}` as const)} placeholder={a.placeholder} className={inputClass} />
            </Field>
          ))}
        </section>
      )}

      {!editing && kind !== "service" && (
        <section className="grid gap-4 rounded-xl border border-zinc-200 p-4 sm:grid-cols-3 dark:border-zinc-800">
          <p className="text-sm font-medium sm:col-span-3">Stock you have now (optional)</p>
          <Field label="Quantity" error={err("opening_qty")}>
            <input {...register("opening_qty")} inputMode="decimal" className={inputClass} />
          </Field>
          <Field label="Kept at">
            <select {...register("location_id")} className={selectClass}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          {track === "batch" && (
            <>
              <Field label="Batch no.">
                <input {...register("batch_no")} className={inputClass} />
              </Field>
              <Field label="Expiry date">
                <input type="date" {...register("expiry_date")} className={inputClass} />
              </Field>
            </>
          )}
          {track === "serial" && (
            <Field label={`${modules.serialLabel ?? "Serial numbers"} (one per unit)`} hint="Separate with spaces, commas or new lines." className="sm:col-span-3">
              <textarea {...register("serials")} rows={3} className={`${inputClass} font-mono`} />
            </Field>
          )}
        </section>
      )}

      {result && (
        <p role={result.ok ? "status" : "alert"} className={`flex items-center gap-2 text-sm ${result.ok ? "text-green-800 dark:text-green-300" : "text-red-700 dark:text-red-400"}`}>
          {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertOctagon className="h-4 w-4" />}
          {result.text}
        </p>
      )}
      <div>
        <button className={buttonPrimary} disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {editing ? "Save changes" : `Add ${terms.item.toLowerCase()}`}
        </button>
      </div>
    </form>
  );
}
