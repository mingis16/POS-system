import { requireAdmin } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui/card";
import { CsvImport } from "@/components/inventory/csv-import";

export const metadata = { title: "Import items" };

export default async function ImportPage() {
  const { supabase, business, terms } = await requireAdmin();
  const { data: locations } = await supabase
    .from("locations")
    .select("id, name, is_default_sale")
    .eq("business_id", business.id)
    .eq("is_active", true)
    .order("sort_order");
  return (
    <>
      <PageHeader title={`Import ${terms.items.toLowerCase()}`} description="Bring in your item list from Excel or another system in one go." />
      <Card>
        <CsvImport defaultUnit={business.units[0] ?? "pieces"} locations={locations ?? []} />
      </Card>
    </>
  );
}
