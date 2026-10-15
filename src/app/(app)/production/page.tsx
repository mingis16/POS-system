import { Factory } from "lucide-react";
import { requireCapability } from "@/lib/auth";
import { formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { Card, EmptyState, PageHeader, TableWrap } from "@/components/ui/card";
import { ProductionForm } from "@/components/inventory/production-form";
import { numClass, tableClass, tdClass, thClass } from "@/components/ui/styles";

export const metadata = { title: "Production" };

export default async function ProductionPage() {
  const { supabase, business, can } = await requireCapability("produce");
  const [{ data: products }, { data: locations }, { data: runs }, { data: members }] = await Promise.all([
    supabase.from("products").select("id, name, unit, kind, cost_price").eq("business_id", business.id).eq("is_active", true).neq("kind", "service").order("name"),
    supabase.from("locations").select("id, name").eq("business_id", business.id).eq("is_active", true).order("sort_order"),
    supabase
      .from("production_runs")
      .select("id, run_no, qty, unit_cost, batch_no, note, created_at, created_by, inputs, products(name, unit)")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })
      .limit(60),
    supabase.from("memberships").select("user_id, display_name").eq("business_id", business.id),
  ]);
  const who = new Map((members ?? []).map((m) => [m.user_id, m.display_name]));
  const all = (products ?? []).map((p) => ({ ...p, cost_price: Number(p.cost_price) }));

  return (
    <>
      <PageHeader
        title="Production"
        description="Record each batch you make (sachet bags, bottles, furniture…). Materials come out of stock; finished goods go in at the cost of what was used."
      />
      <Card title="Record a production run">
        <ProductionForm
          outputs={all.filter((p) => p.kind === "stock")}
          materials={all.filter((p) => p.kind === "raw_material" || p.kind === "stock")}
          locations={locations ?? []}
          batches={Boolean(business.modules?.batches)}
        />
      </Card>
      <Card title="Recent runs" className="mt-5" bodyClassName="px-4 py-0 sm:px-5 sm:py-0">
        {!runs?.length ? (
          <EmptyState icon={Factory} title="No production recorded yet" />
        ) : (
          <TableWrap>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className={thClass}>#</th>
                  <th className={thClass}>When</th>
                  <th className={thClass}>Made</th>
                  <th className={`${thClass} ${numClass}`}>Qty</th>
                  {can.viewFinance && <th className={`${thClass} ${numClass}`}>Unit cost</th>}
                  <th className={thClass}>Batch</th>
                  <th className={thClass}>By</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const p = r.products as unknown as { name: string; unit: string } | null;
                  return (
                    <tr key={r.id}>
                      <td className={tdClass}>{r.run_no}</td>
                      <td className={tdClass}>{formatDateTime(r.created_at)}</td>
                      <td className={tdClass}>{p?.name}</td>
                      <td className={`${tdClass} ${numClass}`}>{formatQty(r.qty, p?.unit)}</td>
                      {can.viewFinance && <td className={`${tdClass} ${numClass}`}>{formatMoney(r.unit_cost)}</td>}
                      <td className={tdClass}>{r.batch_no ?? "—"}</td>
                      <td className={tdClass}>{who.get(r.created_by) ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
