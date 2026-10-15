import type { Capabilities } from "@/lib/permissions";
import type { BusinessModules, Terminology } from "@/lib/types";
import { JOB_KIND_LABELS } from "@/lib/archetypes";

/** Icon names map to lucide components in the client (functions cannot cross the server boundary). */
export type NavIcon =
  | "dashboard"
  | "pos"
  | "sales"
  | "customers"
  | "jobs"
  | "inventory"
  | "receive"
  | "counts"
  | "production"
  | "expenses"
  | "cashup"
  | "suppliers"
  | "accounting"
  | "reports"
  | "reconciliation"
  | "alerts"
  | "audit"
  | "staff"
  | "settings";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  badge?: number;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export function buildNav(
  can: Capabilities,
  modules: BusinessModules,
  terms: Terminology,
  counts: { alerts: number; approvals: number },
): NavGroup[] {
  const jobs = modules.jobs ? terms.jobs ?? JOB_KIND_LABELS[modules.jobs].many : null;
  const groups: NavGroup[] = [
    { label: "", items: [{ href: "/dashboard", label: "Dashboard", icon: "dashboard" }] },
    {
      label: "Sell",
      items: [
        ...(can.sell ? [{ href: "/pos", label: `New ${terms.sale.toLowerCase()}`, icon: "pos" as const }] : []),
        { href: "/sales", label: terms.sales, icon: "sales", badge: can.admin ? counts.approvals : undefined },
        { href: "/customers", label: terms.customers, icon: "customers" },
        ...(jobs ? [{ href: "/jobs", label: jobs, icon: "jobs" as const }] : []),
      ],
    },
    {
      label: "Stock",
      items: [
        { href: "/inventory", label: terms.items, icon: "inventory" },
        { href: "/receiving", label: "Receive stock", icon: "receive" },
        { href: "/counts", label: "Stock counts", icon: "counts" },
        ...(can.produce ? [{ href: "/production", label: "Production", icon: "production" as const }] : []),
      ],
    },
    {
      label: "Money",
      items: [
        { href: "/expenses", label: "Expenses", icon: "expenses" },
        { href: "/cash-up", label: "Cash-up", icon: "cashup" },
        ...(can.admin
          ? [
              { href: "/suppliers", label: "Suppliers", icon: "suppliers" as const },
              { href: "/accounting", label: "Accounts", icon: "accounting" as const },
              { href: "/reports", label: "Weekly reports", icon: "reports" as const },
            ]
          : []),
      ],
    },
  ];
  if (can.admin) {
    groups.push({
      label: "Control",
      items: [
        { href: "/reconciliation", label: "Reconciliation", icon: "reconciliation" },
        { href: "/alerts", label: "Alerts", icon: "alerts", badge: counts.alerts },
        { href: "/audit", label: "Audit trail", icon: "audit" },
        { href: "/staff", label: "Staff", icon: "staff" },
        { href: "/settings", label: "Settings", icon: "settings" },
      ],
    });
  }
  return groups;
}

/** The four buttons on the phone bottom bar; everything else is under "More". */
export function bottomNav(can: Capabilities, terms: Terminology): NavItem[] {
  return [
    { href: "/dashboard", label: "Home", icon: "dashboard" },
    can.sell ? { href: "/pos", label: "Sell", icon: "pos" } : { href: "/sales", label: terms.sales, icon: "sales" },
    { href: "/inventory", label: "Stock", icon: "inventory" },
    can.admin ? { href: "/alerts", label: "Alerts", icon: "alerts" } : { href: "/cash-up", label: "Cash-up", icon: "cashup" },
  ];
}
