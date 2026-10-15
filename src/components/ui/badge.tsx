import { clsx } from "clsx";
import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { AlertSeverity } from "@/lib/types";

export type Tone = "neutral" | "good" | "warning" | "critical" | "info" | "brand";

const tones: Record<Tone, string> = {
  neutral: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  good: "bg-green-50 text-green-800 dark:bg-green-950/60 dark:text-green-300",
  warning: "bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  critical: "bg-red-50 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  info: "bg-sky-50 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
  brand: "bg-brand-50 text-brand-800 dark:bg-brand-800/30 dark:text-brand-100",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Severity is never colour alone: icon + word + colour. */
export function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const Icon = severity === "critical" ? AlertOctagon : severity === "warning" ? AlertTriangle : Info;
  const tone: Tone = severity === "critical" ? "critical" : severity === "warning" ? "warning" : "info";
  const label = severity === "critical" ? "Critical" : severity === "warning" ? "Warning" : "Info";
  return (
    <Badge tone={tone}>
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {label}
    </Badge>
  );
}

export function OkBadge({ ok, okLabel, badLabel }: { ok: boolean; okLabel: string; badLabel: string }) {
  return ok ? (
    <Badge tone="good">
      <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
      {okLabel}
    </Badge>
  ) : (
    <Badge tone="critical">
      <AlertOctagon aria-hidden className="h-3.5 w-3.5" />
      {badLabel}
    </Badge>
  );
}
