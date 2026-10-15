"use client";

import { useState, useTransition } from "react";
import { AlertOctagon, CheckCircle2, Loader2 } from "lucide-react";
import { ItemLines, type LineValue, type PickItem } from "@/components/forms/item-lines";
import { Field } from "@/components/ui/field";
import { buttonPrimary, inputClass, selectClass } from "@/components/ui/styles";
import { formatMoney } from "@/lib/format";
import { recordProduction } from "@/app/(app)/production/actions";

export function ProductionForm({
  outputs,
  materials,
  locations,
  batches,
}: {
  outputs: PickItem[];
  materials: PickItem[];
  locations: { id: string; name: string }[];
  batches: boolean;
}) {
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [batchNo, setBatchNo] = useState("");
  const [expiry, setExpiry] = useState("");
  const [note, setNote] = useState("");
  const [inputs, setInputs] = useState<LineValue[]>([{ product_id: "", qty: "" }]);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const cost = inputs.reduce((s, l) => s + (materials.find((m) => m.id === l.product_id)?.cost_price ?? 0) * Number(l.qty || 0), 0);
  const unitCost = Number(qty) > 0 ? cost / Number(qty) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Product made">
          <select value={productId} onChange={(e) => setProductId(e.target.value)} className={selectClass}>
            <option value="">Choose…</option>
            {outputs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Quantity made ${outputs.find((o) => o.id === productId)?.unit ? `(${outputs.find((o) => o.id === productId)!.unit})` : ""}`}>
          <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className={inputClass} />
        </Field>
        <Field label="Put into">
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={selectClass}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        {batches && (
          <>
            <Field label="Batch no.">
              <input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Best before">
              <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={inputClass} />
            </Field>
          </>
        )}
        <Field label="Note">
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} placeholder="e.g. Morning shift, machine 2" />
        </Field>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">Materials used</p>
        <ItemLines items={materials} lines={inputs} onChange={setInputs} addLabel="Add material" />
        <p className="mt-2 text-xs text-zinc-500">
          Materials cost {formatMoney(cost)}
          {unitCost > 0 && ` → ${formatMoney(unitCost)} per unit made`}. Without materials the output is added at no cost.
        </p>
      </div>
      {result && (
        <p className={`flex items-center gap-2 text-sm ${result.ok ? "text-green-800 dark:text-green-300" : "text-red-700 dark:text-red-400"}`}>
          {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertOctagon className="h-4 w-4" />} {result.text}
        </p>
      )}
      <div>
        <button
          className={buttonPrimary}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await recordProduction({
                product_id: productId,
                qty,
                location_id: locationId,
                batch_no: batchNo || undefined,
                expiry_date: expiry || undefined,
                note: note || undefined,
                inputs: inputs.filter((l) => l.product_id).map((l) => ({ product_id: l.product_id, qty: l.qty })),
              });
              setResult(res?.ok ? { ok: true, text: res.message ?? "Saved." } : { ok: false, text: res?.error ?? "Not saved." });
              if (res?.ok) {
                setQty("");
                setInputs([{ product_id: "", qty: "" }]);
                setBatchNo("");
                setNote("");
              }
            })
          }
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />} Record production
        </button>
      </div>
    </div>
  );
}
