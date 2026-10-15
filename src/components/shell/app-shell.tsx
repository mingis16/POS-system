"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, LogOut, Menu, Plus, Store, X } from "lucide-react";
import type { NavGroup, NavItem } from "./nav";
import { NAV_ICONS } from "./icons";
import { OfflineIndicator } from "./offline-indicator";
import { switchBusiness } from "@/app/(app)/shell-actions";
import { Logo } from "./logo";
import { initials } from "@/lib/format";

export interface ShellProps {
  appName: string;
  businessName: string;
  businessId: string;
  roleLabel: string;
  userName: string;
  nav: NavGroup[];
  bottom: NavItem[];
  businesses: { id: string; name: string }[];
  children: React.ReactNode;
}

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(href + "/")) || pathname === href;
}

function NavLinks({ groups, pathname, onNavigate }: { groups: NavGroup[]; pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.label || "main"}>
          {group.label && (
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {group.label}
            </p>
          )}
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const Icon = NAV_ICONS[item.icon];
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    className={clsx(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-brand-50 font-medium text-brand-800 dark:bg-brand-800/25 dark:text-brand-100"
                        : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100",
                    )}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.badge ? (
                      <span className="rounded-full bg-red-600 px-1.5 text-[11px] font-semibold leading-5 text-white">
                        {item.badge > 99 ? "99+" : item.badge}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function BusinessSwitcher({
  businessName,
  businessId,
  businesses,
  roleLabel,
}: Pick<ShellProps, "businessName" | "businessId" | "businesses" | "roleLabel">) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-left dark:border-zinc-800 dark:bg-zinc-900"
        aria-expanded={open}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white">
          {initials(businessName) || <Store className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">{businessName}</span>
          <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{roleLabel}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          {businesses
            .filter((b) => b.id !== businessId)
            .map((b) => (
              <form key={b.id} action={switchBusiness}>
                <input type="hidden" name="business_id" value={b.id} />
                <button className="block w-full truncate px-3 py-2.5 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  {b.name}
                </button>
              </form>
            ))}
          <Link
            href="/onboarding?new=1"
            className="flex items-center gap-2 border-t border-zinc-100 px-3 py-2.5 text-sm text-brand-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-brand-500 dark:hover:bg-zinc-800"
          >
            <Plus className="h-4 w-4" /> Add or join a business
          </Link>
        </div>
      )}
    </div>
  );
}

function UserFooter({ userName }: { userName: string }) {
  return (
    <form action="/auth/signout" method="post" className="flex items-center gap-2.5 px-1">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
        {initials(userName)}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-700 dark:text-zinc-300">{userName}</span>
      <button
        className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        title="Sign out"
        aria-label="Sign out"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </form>
  );
}

export function AppShell(props: ShellProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
  }, [menuOpen]);

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-4 border-r border-zinc-200 bg-zinc-50/80 p-3 lg:flex dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center gap-2 px-2 pt-1">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">{props.appName}</span>
        </div>
        <BusinessSwitcher {...props} />
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <NavLinks groups={props.nav} pathname={pathname} />
        </div>
        <UserFooter userName={props.userName} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone / tablet top bar */}
        <header className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 py-2.5 backdrop-blur lg:hidden dark:border-zinc-800 dark:bg-zinc-950/90">
          <Logo />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{props.businessName}</p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{props.roleLabel}</p>
          </div>
          <OfflineIndicator />
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </header>

        <div className="no-print hidden justify-end px-6 pt-3 lg:flex">
          <OfflineIndicator />
        </div>

        <main className="pb-safe mx-auto w-full max-w-7xl flex-1 px-4 pt-4 sm:px-6 lg:pt-2">{props.children}</main>

        {/* Phone bottom bar */}
        <nav className="no-print fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:border-zinc-800 dark:bg-zinc-950/95">
          {props.bottom.map((item) => {
            const Icon = NAV_ICONS[item.icon];
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  "flex flex-col items-center gap-0.5 py-2 text-[11px]",
                  active ? "font-medium text-brand-700 dark:text-brand-500" : "text-zinc-500 dark:text-zinc-400",
                )}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-zinc-500 dark:text-zinc-400"
          >
            <Menu className="h-5 w-5" />
            More
          </button>
        </nav>
      </div>

      {/* Phone menu sheet */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/40 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMenuOpen(false)}
            />
            <motion.div
              className="fixed inset-y-0 right-0 z-50 flex w-[86%] max-w-sm flex-col gap-4 bg-white p-4 shadow-xl lg:hidden dark:bg-zinc-950"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 36 }}
              role="dialog"
              aria-label="Menu"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Menu</span>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  aria-label="Close menu"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <BusinessSwitcher {...props} />
              <div className="min-h-0 flex-1 overflow-y-auto">
                <NavLinks groups={props.nav} pathname={pathname} onNavigate={() => setMenuOpen(false)} />
              </div>
              <UserFooter userName={props.userName} />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
