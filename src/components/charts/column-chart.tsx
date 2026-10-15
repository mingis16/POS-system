"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { formatMoney } from "@/lib/format";

export interface ColumnDatum {
  key: string;
  /** Short axis label, e.g. "Mon" or "14". */
  axisLabel: string;
  /** Full label for the tooltip and table, e.g. "Thu 15 Oct 2026". */
  label: string;
  value: number;
}

/** Rounds the axis up to clean steps (0 / 1K / 2K …). */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top + step / 2; t += step) ticks.push(t);
  return ticks;
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/**
 * Single-series column chart (money): columns ≤ 24px with a 4px rounded top
 * on one baseline, hairline grid, hover/focus tooltip per column, and a table
 * view so no value is hover-only. One series, so no legend: the title names it.
 */
export function ColumnChart({
  data,
  title,
  height = 176,
  highlightLast = false,
}: {
  data: ColumnDatum[];
  title: string;
  height?: number;
  highlightLast?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const ticks = niceTicks(Math.max(...data.map((d) => d.value), 0));
  const top = ticks[ticks.length - 1];
  const activeDatum = active === null ? null : data[active];

  return (
    <div>
      <div className="flex gap-2">
        <div
          className="relative w-10 shrink-0 text-right text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400"
          style={{ height }}
          aria-hidden
        >
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0"
              style={{ bottom: `${(tick / top) * 100}%`, transform: "translateY(50%)" }}
            >
              {compact.format(tick)}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative" style={{ height }} onPointerLeave={() => setActive(null)}>
            {ticks.map((tick) => (
              <div
                key={tick}
                aria-hidden
                className={clsx("absolute inset-x-0 h-px", tick === 0 ? "bg-axis" : "bg-grid")}
                style={{ bottom: `${(tick / top) * 100}%` }}
              />
            ))}

            <div className="absolute inset-0 flex items-end">
              {data.map((d, i) => (
                <button
                  key={d.key}
                  type="button"
                  aria-label={`${d.label}: ${formatMoney(d.value)}`}
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  onClick={() => setActive(i)}
                  className="group flex h-full min-w-0 flex-1 items-end justify-center px-px outline-none"
                >
                  <span
                    className={clsx(
                      "block w-full max-w-6 rounded-t-[4px] bg-series-1 transition-opacity",
                      active !== null && active !== i && "opacity-55",
                      highlightLast && active === null && i !== data.length - 1 && "opacity-70",
                      "group-focus-visible:ring-2 group-focus-visible:ring-zinc-400",
                    )}
                    style={{ height: d.value > 0 ? `max(2px, ${(d.value / top) * 100}%)` : 0 }}
                  />
                </button>
              ))}
            </div>

            {activeDatum && active !== null && (
              <div
                role="tooltip"
                className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-2 whitespace-nowrap rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
                style={{ left: `clamp(56px, ${((active + 0.5) / data.length) * 100}%, calc(100% - 56px))` }}
              >
                <p className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                  {formatMoney(activeDatum.value)}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{activeDatum.label}</p>
              </div>
            )}
          </div>

          <div className="mt-1.5 flex text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400" aria-hidden>
            {data.map((d) => (
              <span key={d.key} className="min-w-0 flex-1 truncate text-center">
                {d.axisLabel}
              </span>
            ))}
          </div>
        </div>
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50">
          Show as table
        </summary>
        <table className="mt-2 w-full text-left text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="text-xs text-zinc-500 dark:text-zinc-400">
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-1 text-zinc-700 dark:text-zinc-300">{d.label}</td>
                <td className="py-1 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{formatMoney(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/**
 * Horizontal bars for a ranked list (top items, payment mix, expenses): one
 * hue, value at the bar tip in text ink, label in front.
 */
export function RankBars({
  rows,
  format = (v) => formatMoney(v),
}: {
  rows: { key: string; label: string; value: number; note?: string }[];
  format?: (v: number) => string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.key} className="text-sm">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-zinc-700 dark:text-zinc-300">{r.label}</span>
            <span className="shrink-0 tabular-nums text-zinc-900 dark:text-zinc-100">
              {format(r.value)}
              {r.note && <span className="ml-1.5 text-xs text-zinc-500 dark:text-zinc-400">{r.note}</span>}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-series-1-wash">
            <div className="h-2 rounded-full bg-series-1" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
