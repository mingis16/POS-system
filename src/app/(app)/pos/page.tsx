import { requireCapability } from "@/lib/auth";
import { loadCatalog } from "@/lib/catalog";
import { PosTerminal } from "@/components/pos/pos-terminal";

export const metadata = { title: "Till" };

export default async function PosPage() {
  const ctx = await requireCapability("sell");
  const { supabase, business, terms, can } = ctx;
  const [catalog, customers, staff, locations] = await Promise.all([
    loadCatalog(supabase, business.id),
    supabase
      .from("customers")
      .select("id, name, phone, balance, credit_limit, store_credit")
      .eq("business_id", business.id)
      .eq("is_active", true)
      .order("name")
      .limit(2000),
    supabase.from("memberships").select("user_id, display_name").eq("business_id", business.id).eq("status", "active").order("display_name"),
    supabase.from("locations").select("id, name, is_default_sale").eq("business_id", business.id).eq("is_active", true).order("sort_order"),
  ]);

  return (
    <PosTerminal
      business={{
        id: business.id,
        name: business.name,
        address: [business.address, business.location_city].filter(Boolean).join(", "),
        phone: business.phone,
        usd_rate: Number(business.usd_rate),
        payment_methods: business.payment_methods,
        max_staff_discount_pct: Number(business.max_staff_discount_pct),
        modules: business.modules ?? {},
      }}
      terms={terms}
      isAdmin={can.admin}
      cashierName={ctx.membership.display_name}
      catalog={catalog}
      customers={(customers.data ?? []).map((c) => ({
        ...c,
        balance: Number(c.balance),
        credit_limit: Number(c.credit_limit),
        store_credit: Number(c.store_credit),
      }))}
      staff={(staff.data ?? []).map((s) => ({ id: s.user_id, name: s.display_name }))}
      locations={locations.data ?? []}
    />
  );
}
