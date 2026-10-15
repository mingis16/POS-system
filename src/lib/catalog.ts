import "server-only";
import type { Supabase } from "@/lib/supabase/server";
import type { CatalogItem, TrackMode, ProductKind } from "@/lib/types";

/** Everything the till needs to sell, including in-stock serial numbers. */
export async function loadCatalog(supabase: Supabase, businessId: string): Promise<CatalogItem[]> {
  const [products, stock, serials] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, name, sku, barcode, kind, unit, track_mode, selling_price, wholesale_price, requires_prescription, allow_fractional, commission_pct, categories(name)",
      )
      .eq("business_id", businessId)
      .eq("is_active", true)
      .neq("kind", "raw_material")
      .order("name")
      .limit(5000),
    supabase.from("product_stock").select("product_id, quantity").eq("business_id", businessId).limit(10000),
    supabase
      .from("serial_units")
      .select("id, serial, product_id")
      .eq("business_id", businessId)
      .eq("status", "in_stock")
      .order("received_at")
      .limit(5000),
  ]);
  if (products.error) throw products.error;

  const stockBy = new Map((stock.data ?? []).map((s) => [s.product_id as string, Number(s.quantity)]));
  const serialsBy = new Map<string, { id: string; serial: string }[]>();
  for (const s of serials.data ?? []) {
    const list = serialsBy.get(s.product_id) ?? [];
    list.push({ id: s.id, serial: s.serial });
    serialsBy.set(s.product_id, list);
  }

  return (products.data ?? []).map((p) => {
    const cat = p.categories as unknown as { name: string } | null;
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      category: cat?.name ?? null,
      kind: p.kind as ProductKind,
      unit: p.unit,
      track_mode: p.track_mode as TrackMode,
      selling_price: Number(p.selling_price),
      wholesale_price: p.wholesale_price === null ? null : Number(p.wholesale_price),
      requires_prescription: p.requires_prescription,
      allow_fractional: p.allow_fractional,
      commission_pct: Number(p.commission_pct),
      stock: stockBy.get(p.id) ?? 0,
      serials: p.track_mode === "serial" ? serialsBy.get(p.id) ?? [] : undefined,
    };
  });
}
