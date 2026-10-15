"use client";

import { useMemo, useState, useTransition } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertOctagon, Loader2, Plus, Trash2 } from "lucide-react";
import { receiptSchema, type ReceiptInput } from "@/lib/validation";
import { PAYMENT_LABELS, formatMoney } from "@/lib/format";
import type { PaymentMethod } from "@/lib/types";
import { Field } from "@/components/ui/field";
import { buttonPrimary, buttonSecondary, inputClass, selectClass } from "@/components/ui/styles";
import { receiveStock } from "@/app/(app)/receiving/actions";

interface Item {
  id: string;
  name: string;
  unit: string;
  cost_price: number;
  track_mode: "none" | "serial" | "batch";
  preferred_supplier_id: string | null;
}

export function ReceiptForm({
  items,
  suppliers,
  locations,
  methods,
  serialLabel,
}: {
  items: Item[];
  suppliers: { id: string; name: string }[];
  locations: { id: string; name: string; kind: string }[];
  methods: PaymentMethod[];
  serialLabel: string;
}) {
  const storeLoc = locations.find((l) => ["warehouse", "store_room", "cold_store"].includes(l.kind)) ?? locations[0];
  const { register, control, handleSubmit, setValue, formState } = useForm<ReceiptInput, unknown, z.output<typeof receiptSchema>>({
    resolver: zodResolver(receiptSchema),
    defaultValues: {
      supplier_id: "",
      supplier_name: "",
      invoice_ref: "",
      location_id: storeLoc?.id ?? "",
      note: "",
      amount_paid: "",
      payment_method: "cash",
      items: [{ product_id: "", qty: "", unit_cost: "", batch_no: "", expiry_date: "", serials: "" }],
    },
  });
  const lines = useFieldArray({ control, name: "items" });
  const watched = useWatch({ control, name: "items" });
  const supplierId = useWatch({ control, name: "supplier_id" });
  const paid = useWatch({ control, name: "amount_paid" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const total = (watched ?? []).reduce((s, l) => s + Number(l.qty || 0) * Number(l.unit_cost || 0), 0);
  const owed = Math.max(0, total - (paid === "" || paid === undefined ? total : Number(paid)));
  const { errors } = formState;

  const onSubmit = handleSubmit((values) =>
    startTransition(async () => {
      setError(null);
      const res = await receiveStock(values as unknown as ReceiptInput);
      if (res && !res.ok) setError(res.error ?? "Not saved.");
    }),
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Supplier">
          <select {...register("supplier_id")} className={selectClass}>
            <option value="">New / not listed</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        {!supplierId && (
          <Field label="Supplier name" hint="Leave blank if bought from the market.">
            <input {...register("supplier_name")} className={inputClass} />
          </Field>
        )}
        <Field label="Invoice / waybill no.">
          <input {...register("invoice_ref")} className={inputClass} />
        </Field>
        <Field label="Received into">
          <select {...register("location_id")} className={selectClass}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex flex-col gap-3">
        {lines.fields.map((f, i) => {
          const item = byId.get(watched?.[i]?.product_id ?? "");
          const e = errors.items?.[i];
          return (
            <div key={f.id} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-12">
                <div className="col-span-2 sm:col-span-6">
                  <select
                    {...register(`items.${i}.product_id`, {
                      onChange: (ev) => {
                        const it = byId.get(ev.target.value);
                        if (it) setValue(`items.${i}.unit_cost`, String(it.cost_price));
                      },
                    })}
                    className={selectClass}
                    aria-label="Item"
                  >
                    <option value="">Choose item…</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name}
                      </option>
                    ))}
                  </select>
                  {e?.product_id && <p className="mt-1 text-xs text-red-700">{e.product_id.message}</p>}
                </div>
                <label className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-[11px] text-zinc-500">Qty {item ? `(${item.unit})` : ""}</span>
                  <input {...register(`items.${i}.qty`)} inputMode="decimal" className={inputClass} />
                  {e?.qty && <span className="text-xs text-red-700">{e.qty.message}</span>}
                </label>
                <label className="flex flex-col gap-1 sm:col-span-3">
                  <span className="text-[11px] text-zinc-500">Cost each (Le)</span>
                  <input {...register(`items.${i}.unit_cost`)} inputMode="decimal" className={inputClass} />
                  {e?.unit_cost && <span className="text-xs text-red-700">{e.unit_cost.message}</span>}
                </label>
                <div className="flex items-end justify-end sm:col-span-1">
                  <button type="button" onClick={() => lines.remove(i)} disabled={lines.fields.length === 1} className="rounded-lg p-2.5 text-zinc-400 hover:text-red-600 disabled:opacity-30" aria-label="Remove">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {item?.track_mode === "batch" && (
                  <>
                    <input {...register(`items.${i}.batch_no`)} placeholder="Batch no." className={`${inputClass} sm:col-span-6`} />
                    <label className="flex items-center gap-2 text-xs text-zinc-500 sm:col-span-6">
                      Expiry <input type="date" {...register(`items.${i}.expiry_date`)} className={inputClass} />
                    </label>
                  </>
                )}
                {item?.track_mode === "serial" && (
                  <textarea {...register(`items.${i}.serials`)} rows={2} placeholder={`${serialLabel} — one per unit, separated by spaces or new lines`} className={`${inputClass} col-span-2 font-mono sm:col-span-12`} />
                )}
              </div>
            </div>
          );
        })}
        <button type="button" onClick={() => lines.append({ product_id: "", qty: "", unit_cost: "", batch_no: "", expiry_date: "", serials: "" })} className={`${buttonSecondary} self-start`}>
          <Plus className="h-4 w-4" /> Add line
        </button>
      </div>

      <div className="grid gap-4 rounded-xl bg-zinc-50 p-4 sm:grid-cols-3 dark:bg-zinc-900">
        <div>
          <p className="text-xs text-zinc-500">Total cost</p>
          <p className="text-xl font-semibold tabular-nums">{formatMoney(total)}</p>
        </div>
        <Field label="Amount paid now (Le)" hint="Blank = paid in full.">
          <input {...register("amount_paid")} inputMode="decimal" placeholder={total.toFixed(2)} className={inputClass} />
        </Field>
        <Field label="Paid with">
          <select {...register("payment_method")} className={selectClass}>
            {methods.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_LABELS[m]}
              </option>
            ))}
          </select>
        </Field>
        {owed > 0 && <p className="text-sm text-amber-800 sm:col-span-3 dark:text-amber-300">{formatMoney(owed)} will be recorded as owed to the supplier.</p>}
      </div>
      <Field label="Note">
        <input {...register("note")} className={inputClass} />
      </Field>

      {(error || errors.items?.message) && (
        <p role="alert" className="flex items-start gap-2 text-sm text-red-700 dark:text-red-400">
          <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0" /> {error ?? errors.items?.message}
        </p>
      )}
      <div>
        <button className={buttonPrimary} disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />} Save stock received
        </button>
      </div>
    </form>
  );
}
