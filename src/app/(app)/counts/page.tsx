import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { requireMember } from "@/lib/auth";
import { formatDateTime, formatMoney } from "@/lib/format";
import { Card, EmptyState, PageHeader, TableWrap } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { inputClass, numClass, selectClass, tableClass, tdClass, thClass } from "@/components/ui/styles";
import { startCount } from "./actions";

export const metadata = { title: "Stock counts" };

const STATUS = {
  draft: <Badge tone="info">In progress</Badge>,
  submitted: <Badge tone="warning">To review</Badge>,
  approved: <Badge tone="good">Approved</Badge>,
  rejected: <Badge>Rejected</Badge>,
} as const;

export default async function CountsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { supabase, business, can } = await requireMember();
  const { status } = await searchParams;
  let q = supabase
    .from("stock_counts")
    .select("id, count_no, status, note, loss_value, gain_value, created_at, submitted_at, created_by, locations(name)")
    .eq("business_id", business.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) q = q.eq("status", status);
  const [{ data: counts }, { data: locations }, { data: cats }, { data: members }] = await Promise.all([
    q,
    supabase.from("locations").select("id, name").eq("business_id", business.id).eq("is_active", true).order("sort_order"),
    supabase.from("categories").select("id, name").eq("business_id", business.id).order("name"),
    supabase.from("memberships").select("user_id, display_name").eq("business_id", business.id),
  ]);
  const who = new Map((members ?? []).map((m) => [m.user_id, m.display_name]));

  return (
    <>
      <PageHeader
        title="Stock counts"
        description="Count what is physically on the shelves, in the freezer or store. Counters do not see the system figure — the owner sees any difference."
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Start a count">
          <ActionForm action={startCount} className="flex flex-col gap-3">
            <Field label="Location">
              <select name="location_id" className={selectClass}>
                {(locations ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Only this category (optional)" hint="Spot-check one section at a time.">
              <select name="category_id" className={selectClass}>
                <option value="">Everything</option>
                {(cats ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Note">
              <input name="note" className={inputClass} placeholder="e.g. Friday closing count" />
            </Field>
            <SubmitButton>Start counting</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Counts" className="lg:col-span-2" bodyClassName="px-4 py-0 sm:px-5 sm:py-0">
          {!counts?.length ? (
            <EmptyState icon={ClipboardCheck} title="No counts yet">
              Count each location regularly — weekly at least, daily for fast-moving or valuable stock.
            </EmptyState>
          ) : (
            <TableWrap>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>#</th>
                    <th className={thClass}>Location</th>
                    <th className={thClass}>Started</th>
                    <th className={thClass}>By</th>
                    <th className={thClass}>Status</th>
                    {can.admin && <th className={`${thClass} ${numClass}`}>Missing</th>}
                  </tr>
                </thead>
                <tbody>
                  {counts.map((c) => (
                    <tr key={c.id}>
                      <td className={tdClass}>
                        <Link href={`/counts/${c.id}`} className="font-medium hover:underline">
                          {c.count_no}
                        </Link>
                      </td>
                      <td className={tdClass}>{(c.locations as unknown as { name: string } | null)?.name}</td>
                      <td className={tdClass}>{formatDateTime(c.created_at)}</td>
                      <td className={tdClass}>{who.get(c.created_by) ?? "—"}</td>
                      <td className={tdClass}>{STATUS[c.status as keyof typeof STATUS]}</td>
                      {can.admin && (
                        <td className={`${tdClass} ${numClass}`}>
                          {Number(c.loss_value) > 0 ? <span className="font-medium text-red-700 dark:text-red-400">{formatMoney(c.loss_value)}</span> : c.status === "draft" ? "" : formatMoney(0)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}
