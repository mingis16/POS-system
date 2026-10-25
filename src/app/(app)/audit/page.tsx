import { Fingerprint, ShieldAlert, ShieldCheck } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, titleCase } from "@/lib/format";
import { Card, EmptyState, PageHeader, TableWrap } from "@/components/ui/card";
import { buttonSecondary, selectClass, tableClass, tdClass, thClass } from "@/components/ui/styles";
import type { AuditEntry } from "@/lib/types";

export const metadata = { title: "Audit trail" };

const HIDDEN = new Set(["id", "business_id", "created_at", "updated_at", "created_by"]);

function describe(e: AuditEntry): string {
  if (e.summary) return e.summary;
  const data = (e.after ?? e.before ?? {}) as Record<string, unknown>;
  if (e.action === "update" && e.after) {
    return Object.keys(e.after)
      .filter((k) => !HIDDEN.has(k))
      .map((k) => `${titleCase(k)}: ${fmt(e.before?.[k])} → ${fmt(e.after?.[k])}`)
      .join("; ");
  }
  const label =
    data.name ??
    data.title ??
    (data.receipt_no
      ? `#${data.receipt_no}`
      : data.return_no
        ? `Return #${data.return_no}`
        : data.expense_no
          ? `#${data.expense_no}`
          : data.count_no
            ? `#${data.count_no}`
            : "");
  const amount = data.total ?? data.amount ?? data.total_cost ?? data.total_refund_amount ?? data.variance;
  return [label, amount !== undefined ? `Le ${Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}` : ""].filter(Boolean).join(" · ");
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 60);
  return String(v).slice(0, 60);
}

function device(ua: string | null): string {
  if (!ua) return "—";
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "";
  const model = ua.match(/;\s*([^;)]*(?:Honor|HONOR|Tecno|TECNO|itel|Infinix|SM-|Redmi|Pixel)[^;)]*)/)?.[1]?.trim();
  return [model, os].filter(Boolean).join(" · ") || ua.slice(0, 30);
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ who?: string; entity?: string }> }) {
  const { supabase, business } = await requireAdmin();
  const sp = await searchParams;
  let q = supabase.from("audit_log").select("*").eq("business_id", business.id).order("id", { ascending: false }).limit(300);
  if (sp.who) q = q.eq("actor_id", sp.who);
  if (sp.entity) q = q.eq("entity", sp.entity);
  const [{ data }, { data: members }, { data: chain }] = await Promise.all([
    q,
    supabase.from("memberships").select("user_id, display_name").eq("business_id", business.id).order("display_name"),
    supabase.rpc("verify_audit_chain", { b: business.id }),
  ]);
  const entries = (data ?? []) as AuditEntry[];
  const who = new Map((members ?? []).map((m) => [m.user_id, m.display_name]));
  const integrity = (chain as { ok: boolean; rows_checked: number; first_bad_id: number | null }[] | null)?.[0];

  return (
    <>
      <PageHeader title="Audit trail" description="Every transaction and change: who, when, what changed, from which IP address and device. Entries cannot be edited or deleted." />
      {integrity && (
        <div
          className={`mb-5 flex items-center gap-3 rounded-xl border p-3 text-sm ${integrity.ok ? "border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950/40 dark:text-green-200" : "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"}`}
        >
          {integrity.ok ? <ShieldCheck className="h-5 w-5 shrink-0 text-good" /> : <ShieldAlert className="h-5 w-5 shrink-0 text-critical" />}
          {integrity.ok
            ? `Integrity check passed: all ${integrity.rows_checked} entries are unaltered (SHA-256 hash chain).`
            : `Integrity check FAILED at entry #${integrity.first_bad_id}: the log has been tampered with at database level. Contact your administrator.`}
        </div>
      )}
      <form className="mb-4 flex flex-wrap gap-2">
        <select name="who" defaultValue={sp.who ?? ""} className={`${selectClass} !w-auto !py-1.5`}>
          <option value="">Everyone</option>
          {(members ?? []).map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.display_name}
            </option>
          ))}
        </select>
        <select name="entity" defaultValue={sp.entity ?? ""} className={`${selectClass} !w-auto !py-1.5`}>
          <option value="">All records</option>
          {["sales", "returns", "expenses", "products", "stock_receipts", "stock_counts", "cash_ups", "customers", "suppliers", "memberships", "businesses", "jobs", "alerts"].map((e) => (
            <option key={e} value={e}>
              {titleCase(e)}
            </option>
          ))}
        </select>
        <button className={buttonSecondary}>Filter</button>
      </form>
      <Card bodyClassName="px-4 py-0 sm:px-5 sm:py-0">
        {!entries.length ? (
          <EmptyState icon={Fingerprint} title="No entries" />
        ) : (
          <TableWrap>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={thClass}>When</th>
                  <th className={thClass}>Who</th>
                  <th className={thClass}>Action</th>
                  <th className={thClass}>Details</th>
                  <th className={thClass}>IP</th>
                  <th className={thClass}>Device</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className={tdClass}>{formatDateTime(e.created_at)}</td>
                    <td className={tdClass}>
                      {(e.actor_id && who.get(e.actor_id)) ?? (e.actor_id ? "Former member" : "System")}
                      {e.actor_role && <span className="ml-1 text-xs text-zinc-400">{e.actor_role}</span>}
                    </td>
                    <td className={tdClass}>
                      {titleCase(e.action)} <span className="text-zinc-400">{titleCase(e.entity)}</span>
                    </td>
                    <td className={`${tdClass} max-w-md whitespace-normal`}>{describe(e)}</td>
                    <td className={`${tdClass} font-mono text-xs`}>{e.ip ?? "—"}</td>
                    <td className={`${tdClass} text-xs`} title={e.user_agent ?? ""}>
                      {device(e.user_agent)}
                      {e.device_id && <div className="font-mono text-[10px] text-zinc-400">{e.device_id.slice(0, 8)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
