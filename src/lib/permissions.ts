/**
 * What each role may do in the UI. The database enforces the same rules in
 * its functions and row level security; this only decides what to show.
 */
import type { Business, Role } from "./types";

export const ADMIN_ROLES: Role[] = ["owner", "admin"];
export const ALL_ROLES: Role[] = ["owner", "admin", "cashier", "storekeeper"];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin / Manager",
  cashier: "Cashier / Sales staff",
  storekeeper: "Storekeeper",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Everything, including admins, owner's money and business settings.",
  admin: "Reports, profit, stock corrections, approvals and staff — but not other admins.",
  cashier: "Records sales, expenses, stock received and their own cash-up. Cannot delete or edit history.",
  storekeeper: "Receives stock, moves it between locations, records usage and counts. Can also sell.",
};

export function isAdmin(role: Role | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function capabilities(role: Role, business: Pick<Business, "sales_input_by" | "modules">) {
  const admin = isAdmin(role);
  const store = role === "storekeeper";
  return {
    admin,
    owner: role === "owner",
    sell: business.sales_input_by === "admin" ? admin : true,
    receive: true,
    expenses: true,
    count: true,
    cashUp: true,
    transfer: admin || store,
    usage: (admin || store) && Boolean(business.modules.usage),
    produce: (admin || store) && Boolean(business.modules.production),
    jobs: Boolean(business.modules.jobs),
    manageCatalog: admin,
    adjustStock: admin,
    approve: admin,
    viewFinance: admin,
    manageStaff: admin,
    settings: admin,
    audit: admin,
    paySuppliers: admin,
    ownerMoney: role === "owner",
  };
}

export type Capabilities = ReturnType<typeof capabilities>;
