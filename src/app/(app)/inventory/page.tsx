import Link from "next/link";
import { Boxes, PackageMinus, Plus, Upload } from "lucide-react";
import { requireMember } from "@/lib/auth";
import { formatMoney, formatQty, safeSearch } from "@/lib/format";
import { Card, EmptyState, PageHeader, TableWrap } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonPrimary, buttonSecondary, inputClass, numClass, selectClass, tableClass, tdClass, thClass } from "@/components/ui/styles";

export const metadata = { title: "Stock" };

interface Row {
  id: string;
  name: string;
  sku: string | null;
  kind: string;
  unit: string;
  cost_price: number;
  selling_price: number;
  reorder_level: number;
  is_active: boolean;
  track_mode: string;
  categories: { name: string } | null;
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; filter?: string; added?: string }>;
}) {
  const { supabase, business, can, terms } = await requireMember();
  const sp = await searchParams;

  let query = supabase
    .from("products")
    .select("id, name, sku, kind, unit, cost_price, selling_price, reorder_level, is_active, track_mode, categories(name)")
    .eq("business_id", business.id)
    .order("name")
    .limit(1000);
  const q = safeSearch(sp.q);
  if (q) query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%,barcode.eq.${q}`);
  if (sp.category) query = query.eq("category_id", sp.category);
  if (sp.filter !== "hidden") query = query.eq("is_active", true);
  else query = query.eq("is_active", false);

  const [{ data: products }, { data: levels }, { data: locations }, { data: cats }] = await Promise.all([
    query,
    supabase.from("stock_levels").select("product_id, location_id, quantity").eq("business_id", business.id).limit(20000),
    supabase.from("locations").select("id, name").eq("business_id", business.id).eq("is_active", true).order("sort_order"),
    supabase.from("categories").select("id, name").eq("business_id", business.id).order("name"),
  ]);

  const byProduct = new Map<string, Map<string, number>>();
  for (const l of levels ?? []) {
    const m = byProduct.get(l.product_id) ?? new Map();
    m.set(l.location_id, Number(l.quantity));
    byProduct.set(l.product_id, m);
  }
  let rows = ((products ?? []) as unknown as Row[]).map((p) => {
    const perLoc = byProduct.get(p.id) ?? new Map<string, number>();
    const total = [...perLoc.values()].reduce((s, v) => s + v, 0);
    return { ...p, perLoc, total, low: p.kind !== "service" && Number(p.reorder_level) > 0 && total <= Number(p.reorder_level) };
  });
  if (sp.filter === "low") rows = rows.filter((r) => r.low);
  const stockValue = rows.reduce((s, r) => s + Math.max(0, r.total) * Number(r.cost_price), 0);
  const showLocs = (locations ?? []).length > 1 && (locations ?? []).length <= 4;

  return (
    <>
      <PageHeader
        title={terms.items}
        description={
          can.viewFinance
            ? `${rows.length} shown · stock value at cost ${formatMoney(stockValue)}`
            : `${rows.length} shown`
        }
        actions={
          <>
            {can.usage && (
              <Link href="/inventory/usage" className={buttonSecondary}>
                <PackageMinus className="h-4 w-4" /> Record usage
              </Link>
            )}
            {can.manageCatalog && (
              <>
                <Link href="/inventory/import" className={buttonSecondary}>
                  <Upload className="h-4 w-4" /> Import CSV
                </Link>
                <Link href="/inventory/new" className={buttonPrimary}>
                  <Plus className="h-4 w-4" /> Add {terms.item.toLowerCase()}
                </Link>
              </>
            )}
          </>
        }
      />
      {sp.added && <p className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-900 dark:bg-green-950/40 dark:text-green-200">Saved.</p>}

      <Card bodyClassName="p-0 sm:p-0">
        <form className="flex flex-wrap gap-2 border-b border-zinc-100 p-3 dark:border-zinc-800">
          <input name="q" defaultValue={sp.q} placeholder="Search name, code or barcode" className={`${inputClass} min-w-48 flex-1`} />
          <select name="category" defaultValue={sp.category ?? ""} className={`${selectClass} !w-auto`}>
            <option value="">All categories</option>
            {(cats ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select name="filter" defaultValue={sp.filter ?? ""} className={`${selectClass} !w-auto`}>
            <option value="">Active</option>
            <option value="low">Running low</option>
            <option value="hidden">Hidden</option>
          </select>
          <button className={buttonSecondary}>Show</button>
        </form>
        {rows.length === 0 ? (
          <EmptyState icon={Boxes} title={`No ${terms.items.toLowerCase()} found`}>
            {can.manageCatalog ? "Add items one by one or import a spreadsheet." : "Ask an admin to add items."}
          </EmptyState>
        ) : (
          <div className="px-4 sm:px-5">
            <TableWrap>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>Name</th>
                    <th className={thClass}>Category</th>
                    {showLocs && (locations ?? []).map((l) => <th key={l.id} className={`${thClass} ${numClass}`}>{l.name}</th>)}
                    <th className={`${thClass} ${numClass}`}>In stock</th>
                    <th className={`${thClass} ${numClass}`}>Price</th>
                    {can.viewFinance && <th className={`${thClass} ${numClass}`}>Cost</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                      <td className={tdClass}>
                        <Link href={`/inventory/${r.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                          {r.name}
                        </Link>
                        {r.sku && <span className="ml-2 text-xs text-zinc-400">{r.sku}</span>}
                        {r.kind !== "stock" && (
                          <Badge className="ml-2" tone="neutral">
                            {r.kind === "service" ? "service" : "material"}
                          </Badge>
                        )}
                      </td>
                      <td className={tdClass}>{r.categories?.name ?? "—"}</td>
                      {showLocs &&
                        (locations ?? []).map((l) => (
                          <td key={l.id} className={`${tdClass} ${numClass}`}>
                            {r.kind === "service" ? "" : formatQty(r.perLoc.get(l.id) ?? 0)}
                          </td>
                        ))}
                      <td className={`${tdClass} ${numClass}`}>
                        {r.kind === "service" ? (
                          "—"
                        ) : r.low ? (
                          <Badge tone={r.total <= 0 ? "critical" : "warning"}>{formatQty(r.total, r.unit)}</Badge>
                        ) : (
                          formatQty(r.total, r.unit)
                        )}
                      </td>
                      <td className={`${tdClass} ${numClass}`}>{r.kind === "raw_material" ? "—" : formatMoney(r.selling_price)}</td>
                      {can.viewFinance && <td className={`${tdClass} ${numClass}`}>{formatMoney(r.cost_price)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </div>
        )}
      </Card>
    </>
  );
}
