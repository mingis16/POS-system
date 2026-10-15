import { requireMember } from "@/lib/auth";
import { APP_NAME } from "@/lib/constants";
import { ROLE_LABELS } from "@/lib/permissions";
import { AppShell } from "@/components/shell/app-shell";
import { bottomNav, buildNav } from "@/components/shell/nav";
import { SyncOnReconnect } from "@/components/pwa/sync-on-reconnect";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireMember();
  const { supabase, business, can, terms } = ctx;

  let alerts = 0;
  let approvals = 0;
  if (can.admin) {
    const [a, v] = await Promise.all([
      supabase.from("alerts").select("id", { count: "exact", head: true }).eq("business_id", business.id).eq("status", "open"),
      supabase
        .from("sales")
        .select("id", { count: "exact", head: true })
        .eq("business_id", business.id)
        .eq("status", "void_requested"),
    ]);
    alerts = a.count ?? 0;
    approvals = v.count ?? 0;
  }

  const businesses = ctx.memberships
    .filter((m) => m.status === "active")
    .map((m) => ({ id: m.business_id, name: m.businesses?.name ?? "Business" }));

  return (
    <AppShell
      appName={APP_NAME}
      businessName={business.name}
      businessId={business.id}
      roleLabel={`${ctx.membership.display_name} · ${ROLE_LABELS[ctx.role]}`}
      userName={ctx.membership.display_name}
      nav={buildNav(can, business.modules ?? {}, terms, { alerts, approvals })}
      bottom={bottomNav(can, terms)}
      businesses={businesses}
    >
      <SyncOnReconnect />
      {children}
    </AppShell>
  );
}
