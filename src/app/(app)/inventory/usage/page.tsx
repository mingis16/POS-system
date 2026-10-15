import { requireCapability } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui/card";
import { UsageForm } from "@/components/inventory/usage-form";

export const metadata = { title: "Record stock usage" };

export default async function UsagePage() {
  const { supabase, business } = await requireCapability("usage");
  const [{ data: items }, { data: locations }] = await Promise.all([
    supabase.from("products").select("id, name, unit").eq("business_id", business.id).eq("is_active", true).neq("kind", "service").order("name"),
    supabase.from("locations").select("id, name").eq("business_id", business.id).eq("is_active", true).order("sort_order"),
  ]);
  return (
    <>
      <PageHeader
        title="Record stock usage"
        description="Ingredients, materials and consumables used in the business (not sold). Shows in reconciliation as 'used', so it is not counted as missing."
      />
      <Card>
        <UsageForm items={items ?? []} locations={locations ?? []} />
      </Card>
    </>
  );
}
