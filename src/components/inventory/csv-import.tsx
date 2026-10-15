"use client";

import { useState, useTransition } from "react";
import { AlertOctagon, CheckCircle2, Download, FileUp, Loader2 } from "lucide-react";
import { CSV_TEMPLATE, csvToItems } from "@/lib/csv";
import { formatMoney } from "@/lib/format";
import { importProducts } from "@/app/(app)/inventory/actions";
import { buttonGhost, buttonPrimary, buttonSecondary, selectClass, tableClass, tdClass, thClass } from "@/components/ui/styles";

export function CsvImport({
  defaultUnit,
  locations,
}: {
  defaultUnit: string;
  locations: { id: string; name: string; is_default_sale: boolean }[];
}) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [locationId, setLocationId] = useState(locations.find((l) => l.is_default_sale)?.id ?? locations[0]?.id ?? "");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFile(file: File) {
    setResult(null);
    setFileName(file.name);
    const parsed = csvToItems(await file.text());
    setRows(parsed.rows);
    setIgnored(parsed.unknownHeaders);
  }

  const value = rows.reduce((s, r) => s + Number(r.cost_price || 0) * Number(r.opening_qty || 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className={buttonSecondary}>
          <FileUp className="h-4 w-4" /> Choose CSV file
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        <a className={buttonGhost} download="saloneledger-items-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`}>
          <Download className="h-4 w-4" /> Download template
        </a>
        {fileName && <span className="text-sm text-zinc-500">{fileName}</span>}
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Columns: <code>name</code> (required), <code>category</code>, <code>unit</code>, <code>sku</code>, <code>barcode</code>, <code>cost_price</code>,{" "}
        <code>selling_price</code>, <code>wholesale_price</code>, <code>reorder_level</code>, <code>reorder_qty</code>, <code>opening_qty</code>. Excel: File → Save
        as → CSV.
      </p>
      {ignored.length > 0 && <p className="text-sm text-amber-700">Ignored columns: {ignored.join(", ")}</p>}

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              <strong>{rows.length}</strong> items · opening stock value <strong>{formatMoney(value)}</strong>
            </span>
            <label className="flex items-center gap-2">
              Put opening stock in
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={`${selectClass} !w-auto !py-1.5`}>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="max-h-96 overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className={tableClass}>
              <thead className="sticky top-0 bg-surface">
                <tr>
                  {["name", "category", "unit", "cost_price", "selling_price", "reorder_level", "opening_qty"].map((h) => (
                    <th key={h} className={thClass}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 200).map((r, i) => (
                  <tr key={i}>
                    <td className={tdClass}>{r.name}</td>
                    <td className={tdClass}>{r.category}</td>
                    <td className={tdClass}>{r.unit || defaultUnit}</td>
                    <td className={tdClass}>{r.cost_price}</td>
                    <td className={tdClass}>{r.selling_price}</td>
                    <td className={tdClass}>{r.reorder_level}</td>
                    <td className={tdClass}>{r.opening_qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 200 && <p className="text-xs text-zinc-500">Showing the first 200 rows.</p>}
          <div>
            <button
              className={buttonPrimary}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await importProducts(rows, defaultUnit, locationId || null);
                  setResult(res?.ok ? { ok: true, text: res.message ?? "Imported." } : { ok: false, text: res?.error ?? "Import failed." });
                  if (res?.ok) setRows([]);
                })
              }
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Import {rows.length} items
            </button>
          </div>
        </>
      )}
      {result && (
        <p className={`flex items-center gap-2 text-sm ${result.ok ? "text-green-800 dark:text-green-300" : "text-red-700 dark:text-red-400"}`}>
          {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertOctagon className="h-4 w-4" />} {result.text}
        </p>
      )}
    </div>
  );
}
