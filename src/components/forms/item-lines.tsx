"use client";

import { Plus, Trash2 } from "lucide-react";
import { inputClass, selectClass } from "@/components/ui/styles";

export interface PickItem {
  id: string;
  name: string;
  unit: string;
  cost_price?: number;
  track_mode?: string;
}

export interface LineValue {
  product_id: string;
  qty: string;
}

/** Repeating "item + quantity" rows, used for stock usage and production inputs. */
export function ItemLines({
  items,
  lines,
  onChange,
  addLabel = "Add item",
}: {
  items: PickItem[];
  lines: LineValue[];
  onChange: (lines: LineValue[]) => void;
  addLabel?: string;
}) {
  const set = (i: number, patch: Partial<LineValue>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="flex flex-col gap-2">
      {lines.map((l, i) => {
        const item = items.find((x) => x.id === l.product_id);
        return (
          <div key={i} className="flex items-center gap-2">
            <select value={l.product_id} onChange={(e) => set(i, { product_id: e.target.value })} className={`${selectClass} flex-1`} aria-label="Item">
              <option value="">Choose…</option>
              {items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <input value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} inputMode="decimal" placeholder="Qty" className={`${inputClass} !w-24`} aria-label="Quantity" />
            <span className="w-14 truncate text-xs text-zinc-500">{item?.unit}</span>
            <button type="button" onClick={() => onChange(lines.filter((_, j) => j !== i))} className="p-2 text-zinc-400 hover:text-red-600" aria-label="Remove">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        );
      })}
      <button type="button" onClick={() => onChange([...lines, { product_id: "", qty: "" }])} className="flex items-center gap-1.5 self-start text-sm text-brand-700 hover:underline dark:text-brand-500">
        <Plus className="h-4 w-4" /> {addLabel}
      </button>
    </div>
  );
}
