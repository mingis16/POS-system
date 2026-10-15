import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireMember } from "@/lib/auth";
import { daysUntil, formatDate, formatDateTime, formatMoney, formatQty, titleCase } from "@/lib/format";
import { Card, PageHeader, TableWrap } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { ProductForm } from "@/components/inventory/product-form";
import {
  buttonDanger,
  buttonGhost,
  buttonSecondary,
  inputClass,
  numClass,
  selectClass,
  tableClass,
  tdClass,
  thClass,
} from "@/components/ui/styles";
import { adjustStock, setProductActive, transferStock } from "../actions";
import type { Product } from "@/lib/types";

export const metadata = { title: "Item" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, business, can, terms } = await requireMember();
  const { data: product } = await supabase
    .from("products")
    .select("*, categories(name)")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle<Product & { categories: { name: string } | null }>();
  if (!product) notFound();

  const [levels, locations, serials, batches, movements, cats, suppliers, members] = await Promise.all([
    supabase.from("stock_levels").select("location_id, quantity").eq("product_id", id),
    supabase.from("locations").select("id, name, is_default_sale").eq("business_id", business.id).eq("is_active", true).order("sort_order"),
    product.track_mode === "serial"
      ? supabase.from("serial_units").select("id, serial, status, warranty_until, sold_at, unit_cost").eq("product_id", id).order("received_at", { ascending: false }).limit(300)
      : Promise.resolve({ data: [] as { id: string; serial: string; status: string; warranty_until: string | null; sold_at: string | null; unit_cost: number }[] }),
    product.track_mode === "batch"
      ? supabase.from("stock_batches").select("id, batch_no, expiry_date, quantity, unit_cost").eq("product_id", id).gt("quantity", 0).order("expiry_date")
      : Promise.resolve({ data: [] as { id: string; batch_no: string | null; expiry_date: string | null; quantity: number; unit_cost: number }[] }),
    can.admin
      ? supabase.from("stock_movements").select("id, qty, reason, unit_cost, note, created_at, created_by, location_id").eq("product_id", id).order("id", { ascending: false }).limit(60)
      : Promise.resolve({ data: [] as { id: number; qty: number; reason: string; unit_cost: number; note: string | null; created_at: string; created_by: string | null; location_id: string }[] }),
    supabase.from("categories").select("name").eq("business_id", business.id).order("name"),
    supabase.from("suppliers").select("id, name").eq("business_id", business.id).eq("is_active", true).order("name"),
    supabase.from("memberships").select("user_id, display_name").eq("business_id", business.id),
  ]);

  const locName = new Map((locations.data ?? []).map((l) => [l.id, l.name]));
  const who = new Map((members.data ?? []).map((m) => [m.user_id, m.display_name]));
  const perLoc = new Map((levels.data ?? []).map((l) => [l.location_id, Number(l.quantity)]));
  const total = [...perLoc.values()].reduce((s, v) => s + v, 0);
  const inStockSerials = (serials.data ?? []).filter((s) => s.status === "in_stock");
  const isStock = product.kind !== "service";

  return (
    <>
      <Link href="/inventory" className={`${buttonGhost} -ml-3 mb-2`}>
        <ArrowLeft className="h-4 w-4" /> {terms.items}
      </Link>
      <PageHeader
        title={product.name}
        description={[product.categories?.name, product.sku, product.barcode].filter(Boolean).join(" · ") || undefined}
        actions={
          can.admin && (
            <ActionForm action={setProductActive} showSuccess={false}>
              <input type="hidden" name="id" value={product.id} />
              <input type="hidden" name="active" value={String(!product.is_active)} />
              <SubmitButton className={product.is_active ? buttonDanger : buttonSecondary}>
                {product.is_active ? "Hide from till" : "Restore"}
              </SubmitButton>
            </ActionForm>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Mini label="In stock" value={isStock ? formatQty(total, product.unit) : "Service"} />
        <Mini label="Selling price" value={formatMoney(product.selling_price)} />
        {can.viewFinance && <Mini label="Average cost" value={formatMoney(product.cost_price)} />}
        {can.viewFinance && (
          <Mini
            label="Margin"
            value={Number(product.selling_price) > 0 ? `${(((product.selling_price - product.cost_price) / product.selling_price) * 100).toFixed(0)}%` : "—"}
          />
        )}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {isStock && (
          <Card title="Stock by location">
            <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
              {(locations.data ?? []).map((l) => (
                <li key={l.id} className="flex justify-between py-2">
                  <span>{l.name}</span>
                  <span className="tabular-nums">{formatQty(perLoc.get(l.id) ?? 0, product.unit)}</span>
                </li>
              ))}
            </ul>
            {Number(product.reorder_level) > 0 && (
              <p className="mt-3 text-xs text-zinc-500">
                Re-order at {formatQty(product.reorder_level, product.unit)}
                {Number(product.reorder_qty) > 0 && ` · usual order ${formatQty(product.reorder_qty, product.unit)}`}
              </p>
            )}
          </Card>
        )}

        {isStock && can.transfer && (locations.data ?? []).length > 1 && (
          <Card title="Move stock between locations">
            <ActionForm action={transferStock} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="product_id" value={product.id} />
              <Field label="From">
                <select name="from_location_id" className={selectClass}>
                  {(locations.data ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({formatQty(perLoc.get(l.id) ?? 0)})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="To">
                <select name="to_location_id" className={selectClass} defaultValue={(locations.data ?? [])[1]?.id}>
                  {(locations.data ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={`Quantity (${product.unit})`}>
                <input name="qty" inputMode="decimal" required className={inputClass} />
              </Field>
              <Field label="Note">
                <input name="note" className={inputClass} placeholder="e.g. restocking freezer" />
              </Field>
              <div className="sm:col-span-2">
                <SubmitButton className={buttonSecondary}>Move stock</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        )}

        {isStock && can.adjustStock && (
          <Card title="Correct stock" description="Damage, expiry, returns and corrections. Every change is logged with your name and device.">
            <ActionForm action={adjustStock} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="product_id" value={product.id} />
              <Field label="Location">
                <select name="location_id" className={selectClass}>
                  {(locations.data ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Reason">
                <select name="reason" className={selectClass}>
                  <option value="damage">Damaged / broken (remove)</option>
                  <option value="expired">Expired (remove)</option>
                  <option value="adjustment">Correction</option>
                  <option value="return_in">Customer return (add)</option>
                  <option value="opening">Opening stock (add)</option>
                </select>
              </Field>
              <Field label="Add or remove">
                <select name="direction" className={selectClass}>
                  <option value="remove">Remove</option>
                  <option value="add">Add</option>
                </select>
              </Field>
              <Field label={`Quantity (${product.unit})`}>
                <input name="qty" inputMode="decimal" required className={inputClass} />
              </Field>
              {product.track_mode === "serial" && (
                <>
                  <Field label="Serials being added" hint="Only when adding." className="sm:col-span-2">
                    <textarea name="serials" rows={2} className={`${inputClass} font-mono`} />
                  </Field>
                  {inStockSerials.length > 0 && (
                    <fieldset className="sm:col-span-2">
                      <legend className="mb-1 text-sm font-medium">Serials being removed</legend>
                      <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
                        {inStockSerials.map((s) => (
                          <label key={s.id} className="flex items-center gap-1.5 font-mono text-xs">
                            <input type="checkbox" name="serial_ids" value={s.id} className="accent-brand-600" /> {s.serial}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                </>
              )}
              <Field label="Cost per unit (opening stock only)">
                <input name="unit_cost" inputMode="decimal" className={inputClass} placeholder={String(product.cost_price)} />
              </Field>
              <Field label="Note (required)">
                <input name="note" className={inputClass} placeholder="What happened?" />
              </Field>
              <div className="sm:col-span-2">
                <SubmitButton className={buttonSecondary} confirm="Record this stock correction? It cannot be deleted.">
                  Save correction
                </SubmitButton>
              </div>
            </ActionForm>
          </Card>
        )}

        {product.track_mode === "serial" && (
          <Card title={`${business.modules?.serialLabel ?? "Serial numbers"} (${inStockSerials.length} in stock)`}>
            <TableWrap>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>{business.modules?.serialLabel ?? "Serial"}</th>
                    <th className={thClass}>Status</th>
                    <th className={thClass}>Warranty until</th>
                  </tr>
                </thead>
                <tbody>
                  {(serials.data ?? []).map((s) => (
                    <tr key={s.id}>
                      <td className={`${tdClass} font-mono`}>{s.serial}</td>
                      <td className={tdClass}>
                        <Badge tone={s.status === "in_stock" ? "good" : s.status === "sold" ? "neutral" : "warning"}>{titleCase(s.status)}</Badge>
                      </td>
                      <td className={tdClass}>{formatDate(s.warranty_until)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        )}

        {product.track_mode === "batch" && (
          <Card title="Batches in stock" description="Sold first-expiry-first-out.">
            <TableWrap>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>Batch</th>
                    <th className={thClass}>Expires</th>
                    <th className={`${thClass} ${numClass}`}>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {(batches.data ?? []).map((b) => {
                    const days = b.expiry_date ? daysUntil(b.expiry_date) : null;
                    return (
                      <tr key={b.id}>
                        <td className={tdClass}>{b.batch_no ?? "—"}</td>
                        <td className={tdClass}>
                          {formatDate(b.expiry_date)}{" "}
                          {days !== null && days <= 30 && <Badge tone={days <= 0 ? "critical" : "warning"}>{days <= 0 ? "expired" : `${days} days`}</Badge>}
                        </td>
                        <td className={`${tdClass} ${numClass}`}>{formatQty(b.quantity)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        )}

        {can.admin && (movements.data ?? []).length > 0 && (
          <Card title="Stock history" className="lg:col-span-2">
            <TableWrap>
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className={thClass}>When</th>
                    <th className={thClass}>What</th>
                    <th className={thClass}>Where</th>
                    <th className={`${thClass} ${numClass}`}>Qty</th>
                    <th className={thClass}>By</th>
                    <th className={thClass}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {(movements.data ?? []).map((m) => (
                    <tr key={m.id}>
                      <td className={tdClass}>{formatDateTime(m.created_at)}</td>
                      <td className={tdClass}>{titleCase(m.reason)}</td>
                      <td className={tdClass}>{locName.get(m.location_id) ?? "—"}</td>
                      <td className={`${tdClass} ${numClass} ${Number(m.qty) < 0 ? "text-red-700 dark:text-red-400" : "text-green-800 dark:text-green-400"}`}>
                        {Number(m.qty) > 0 ? "+" : ""}
                        {formatQty(m.qty)}
                      </td>
                      <td className={tdClass}>{(m.created_by && who.get(m.created_by)) ?? "—"}</td>
                      <td className={`${tdClass} max-w-48 truncate`}>{m.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        )}

        {can.manageCatalog && (
          <Card title="Edit details" className="lg:col-span-2">
            <ProductForm
              productId={product.id}
              initial={{
                name: product.name,
                sku: product.sku ?? "",
                barcode: product.barcode ?? "",
                category: product.categories?.name ?? "",
                kind: product.kind,
                unit: product.unit,
                track_mode: product.track_mode,
                cost_price: String(product.cost_price),
                selling_price: String(product.selling_price),
                wholesale_price: product.wholesale_price === null ? "" : String(product.wholesale_price),
                reorder_level: String(product.reorder_level),
                reorder_qty: String(product.reorder_qty),
                warranty_months: product.warranty_months === null ? "" : String(product.warranty_months),
                commission_pct: String(product.commission_pct),
                requires_prescription: product.requires_prescription,
                is_regulated: product.is_regulated,
                allow_fractional: product.allow_fractional,
                attributes: product.attributes ?? {},
                preferred_supplier_id: product.preferred_supplier_id ?? "",
              }}
              modules={business.modules ?? {}}
              units={business.units}
              categories={(cats.data ?? []).map((c) => c.name)}
              locations={locations.data ?? []}
              suppliers={suppliers.data ?? []}
              terms={terms}
            />
          </Card>
        )}
      </div>
    </>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-surface p-3 dark:border-zinc-800">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
