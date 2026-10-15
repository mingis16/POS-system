import { clsx } from "clsx";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cardClass } from "./styles";

/**
 * label · value · optional delta vs a named period. The delta's colour is
 * direction × whether up is good, and always carries an arrow and words.
 */
export function StatTile({
  label,
  value,
  detail,
  icon: Icon,
  delta,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  delta?: { pct: number | null; vs: string; upIsGood?: boolean };
  tone?: "critical" | "warning";
}) {
  const hasDelta = delta && delta.pct !== null && Number.isFinite(delta.pct);
  const up = hasDelta && delta.pct! >= 0;
  const good = hasDelta ? (delta.upIsGood ?? true) === up : true;
  return (
    <div
      className={clsx(
        cardClass,
        "flex min-w-0 flex-col gap-1 p-4",
        tone === "critical" && "!border-red-300 dark:!border-red-900",
        tone === "warning" && "!border-amber-300 dark:!border-amber-900",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">{label}</span>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-zinc-400" />}
      </div>
      <div className="truncate text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{value}</div>
      {hasDelta && (
        <div className="flex items-center gap-1 text-xs">
          {up ? (
            <TrendingUp aria-hidden className={clsx("h-3.5 w-3.5", good ? "text-good" : "text-critical")} />
          ) : (
            <TrendingDown aria-hidden className={clsx("h-3.5 w-3.5", good ? "text-good" : "text-critical")} />
          )}
          <span className="text-zinc-600 dark:text-zinc-300">
            {up ? "+" : ""}
            {delta.pct!.toFixed(0)}% vs {delta.vs}
          </span>
        </div>
      )}
      {detail && <div className="text-xs text-zinc-500 dark:text-zinc-400">{detail}</div>}
    </div>
  );
}
