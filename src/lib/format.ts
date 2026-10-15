import type { PaymentMethod } from "./types";

/** Sierra Leone keeps GMT all year, so business days are UTC days. */
export const TIME_ZONE = "Africa/Freetown";

const money = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyShort = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const qtyFmt = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 3 });

/** Leones (SLE, the redenominated Leone). */
export function formatMoney(value: number | string | null | undefined, opts: { short?: boolean } = {}): string {
  const n = Number(value ?? 0);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}Le ${opts.short && abs >= 1000 ? moneyShort.format(abs) : money.format(abs)}`;
}

/** Many customers still think in old Leones (1 SLE = 1,000 SLL). */
export function formatOldLeones(value: number): string {
  return `${moneyShort.format(Number(value) * 1000)} old Le`;
}

export function formatUsd(value: number | string | null | undefined): string {
  return `$${money.format(Number(value ?? 0))}`;
}

export function formatQty(value: number | string | null | undefined, unit?: string): string {
  const n = Number(value ?? 0);
  return unit ? `${qtyFmt.format(n)} ${unit}` : qtyFmt.format(n);
}

export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toFixed(digits)}%`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value.length === 10 ? value + "T00:00:00Z" : value) : value;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TIME_ZONE });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  });
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE });
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + "T00:00:00Z"));
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `iso`. */
export function weekStart(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -dow);
}

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  orange_money: "Orange Money",
  afrimoney: "Afrimoney",
  qmoney: "QMoney",
  bank: "Bank / UBA transfer",
  credit: "Credit (owing)",
};

export const PAYMENT_METHODS: PaymentMethod[] = ["cash", "orange_money", "afrimoney", "qmoney", "bank", "credit"];

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/** Strips characters that have meaning in PostgREST filter strings (or/and lists, wildcards). */
export function safeSearch(q: string | undefined | null): string {
  return (q ?? "").replace(/[,()%*\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}
