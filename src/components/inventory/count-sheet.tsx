"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertOctagon, CheckCircle2, Loader2, Search } from "lucide-react";
import { buttonPrimary, buttonSecondary, inputClass } from "@/components/ui/styles";
import { saveCount } from "@/app/(app)/counts/actions";

interface Line {
  product_id: string;
  name: string;
  unit: string;
  category: string | null;
  counted_qty: number | null;
}

/** The blind count sheet: item names only, no system quantities. Works well on a phone in the store room. */
export function CountSheet({ countId, lines }: { countId: string; lines: Line[] }) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(lines.map((l) => [l.product_id, l.counted_qty === null ? "" : String(l.counted_qty)])),
  );
  const [q, setQ] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const visible = useMemo(() => lines.filter((l) => !q || l.name.toLowerCase().includes(q.toLowerCase())), [lines, q]);
  const done = Object.values(values).filter((v) => v.trim() !== "").length;

  function save(submit: boolean) {
    if (submit && !window.confirm(`Submit ${done} counted item(s)? Items left blank are not counted. You cannot change it afterwards.`)) return;
    startTransition(async () => {
      const res = await saveCount(
        countId,
        Object.entries(values).map(([product_id, counted_qty]) => ({ product_id, counted_qty })),
        submit,
      );
      setResult(res?.ok ? { ok: true, text: res.message ?? "Saved." } : { ok: false, text: res?.error ?? "Not saved." });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find item" className={`${inputClass} pl-9`} />
      </div>
      <p className="text-sm text-zinc-500">
        {done} of {lines.length} counted. Leave an item blank if you did not count it.
      </p>
      <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {visible.map((l) => (
          <li key={l.product_id} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{l.name}</p>
              {l.category && <p className="text-xs text-zinc-500">{l.category}</p>}
            </div>
            <input
              value={values[l.product_id] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [l.product_id]: e.target.value }))}
              inputMode="decimal"
              className={`${inputClass} !w-24 text-right tabular-nums`}
              aria-label={`Counted ${l.name}`}
            />
            <span className="w-14 truncate text-xs text-zinc-500">{l.unit}</span>
          </li>
        ))}
      </ul>
      {result && (
        <p className={`flex items-center gap-2 text-sm ${result.ok ? "text-green-800 dark:text-green-300" : "text-red-700 dark:text-red-400"}`}>
          {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertOctagon className="h-4 w-4" />} {result.text}
        </p>
      )}
      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] flex gap-2 rounded-xl bg-background/95 py-2 backdrop-blur lg:bottom-0">
        <button className={buttonSecondary} onClick={() => save(false)} disabled={pending}>
          Save progress
        </button>
        <button className={buttonPrimary} onClick={() => save(true)} disabled={pending || done === 0}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />} Submit count
        </button>
      </div>
    </div>
  );
}
