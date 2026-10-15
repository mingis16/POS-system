import { requireMember } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui/card";
import { ReceiptForm } from "@/components/inventory/receipt-form";
import type { PaymentMethod } from "@/lib/types";

export const metadata = { title: "Receive stock" };

export default async function NewReceiptPage() {
  const { supabase, business } = await requireMember();
  const [{ data: items }, { data: suppliers }, { data: locations }] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, unit, cost_price, track_mode, preferred_supplier_id")
      .eq("business_id", business.id)
      .eq("is_active", true)
      .neq("kind", "service")
      .order("name"),
    supabase.from("suppliers").select("id, name").eq("business_id", business.id).eq("is_active", true).order("name"),
    supabase.from("locations").select("id, name, kind").eq("business_id", business.id).eq("is_active", true).order("sort_order"),
  ]);
  const methods = ["cash", ...business.payment_methods.filter((m) => m !== "cash" && m !== "credit")] as PaymentMethod[];
  return (
    <>
      <PageHeader title="Receive stock" description="Enter what arrived, at the price on the supplier's invoice. Unusual cost increases are flagged to the owner." />
      <Card>
        <ReceiptForm
          items={(items ?? []).map((i) => ({ ...i, cost_price: Number(i.cost_price) })) as never}
          suppliers={suppliers ?? []}
          locations={locations ?? []}
          methods={methods}
          serialLabel={business.modules?.serialLabel ?? "Serial number"}
        />
      </Card>
    </>
  );
}
