"use client";

import { useState, useTransition } from "react";
import { AlertOctagon, CheckCircle2, Loader2 } from "lucide-react";
import { ItemLines, type LineValue, type PickItem } from "@/components/forms/item-lines";
import { Field } from "@/components/ui/field";
import { buttonPrimary, inputClass, selectClass } from "@/components/ui/styles";
import { recordUsage } from "@/app/(app)/inventory/actions";

export function UsageForm({ items, locations }: { items: PickItem[]; locations: { id: string; name: string }[] }) {
  const [lines, setLines] = useState<LineValue[]>([{ product_id: "", qty: "" }]);
  const [note, setNote] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Taken from">
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={selectClass}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Used for" hint="e.g. Kitchen – Friday dinner, Repair job #12, Salon – relaxers">
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <ItemLines items={items} lines={lines} onChange={setLines} />
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
              const res = await recordUsage({
                location_id: locationId,
                note,
                items: lines.filter((l) => l.product_id).map((l) => ({ product_id: l.product_id, qty: l.qty })),
              });
              setResult(res?.ok ? { ok: true, text: res.message ?? "Recorded." } : { ok: false, text: res?.error ?? "Not saved." });
              if (res?.ok) {
                setLines([{ product_id: "", qty: "" }]);
                setNote("");
              }
            })
          }
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />} Record usage
        </button>
      </div>
    </div>
  );
}
