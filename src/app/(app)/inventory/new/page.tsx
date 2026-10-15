import { requireAdmin } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui/card";
import { ProductForm } from "@/components/inventory/product-form";

export const metadata = { title: "Add item" };

export default async function NewProductPage() {
  const { supabase, business, terms } = await requireAdmin();
  const [{ data: cats }, { data: locations }, { data: suppliers }] = await Promise.all([
    supabase.from("categories").select("name").eq("business_id", business.id).order("name"),
    supabase.from("locations").select("id, name, is_default_sale").eq("business_id", business.id).eq("is_active", true).order("sort_order"),
    supabase.from("suppliers").select("id, name").eq("business_id", business.id).eq("is_active", true).order("name"),
  ]);
  return (
    <>
      <PageHeader title={`Add ${terms.item.toLowerCase()}`} />
      <Card>
        <ProductForm
          modules={business.modules ?? {}}
          units={business.units}
          categories={(cats ?? []).map((c) => c.name)}
          locations={locations ?? []}
          suppliers={suppliers ?? []}
          terms={terms}
        />
      </Card>
    </>
  );
}
