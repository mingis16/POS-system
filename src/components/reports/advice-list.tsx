import { AlertOctagon, Boxes, Coins, HandCoins, Lightbulb, ShieldAlert, TrendingUp, Users } from "lucide-react";
import { clsx } from "clsx";
import type { Advice, AdviceResult } from "@/lib/types";
import { formatDateTime } from "@/lib/format";

const ICONS: Record<Advice["category"], React.ComponentType<{ className?: string }>> = {
  stock: Boxes,
  sales: TrendingUp,
  cash: HandCoins,
  fraud: ShieldAlert,
  costs: Coins,
  credit: Users,
  general: Lightbulb,
};

export function AdviceList({ advice }: { advice: AdviceResult | null }) {
  if (!advice) return <p className="text-sm text-zinc-500">No advice yet.</p>;
  return (
    <div className="flex flex-col gap-4">
      {advice.summary && <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{advice.summary}</p>}
      <ul className="flex flex-col gap-3">
        {advice.items.map((a, i) => {
          const Icon = ICONS[a.category] ?? Lightbulb;
          return (
            <li key={i} className="flex gap-3">
              <span
                className={clsx(
                  "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                  a.priority === "high"
                    ? "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300"
                    : a.priority === "medium"
                      ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 text-sm">
                <p className="font-medium text-zinc-900 dark:text-zinc-50">
                  {a.priority === "high" && <AlertOctagon aria-label="High priority" className="mr-1 inline h-3.5 w-3.5 text-critical" />}
                  {a.title}
                </p>
                <p className="text-zinc-600 dark:text-zinc-400">{a.detail}</p>
                {a.action && <p className="mt-0.5 font-medium text-brand-700 dark:text-brand-500">→ {a.action}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-zinc-400">
        {advice.source === "ai" ? `AI advisor (${advice.model})` : "Rules engine"} · {formatDateTime(advice.generated_at)}
        {advice.source === "rules" && " · add ANTHROPIC_API_KEY for AI-written advice"}
      </p>
    </div>
  );
}
