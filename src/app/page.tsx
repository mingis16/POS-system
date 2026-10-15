import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BellRing,
  BookOpen,
  Fingerprint,
  HandCoins,
  Scale,
  ShoppingCart,
  Smartphone,
  Sparkles,
  WifiOff,
} from "lucide-react";
import { getUser } from "@/lib/auth";
import { APP_NAME } from "@/lib/constants";
import { ARCHETYPES } from "@/lib/archetypes";
import { Logo } from "@/components/shell/logo";
import { ARCHETYPE_ICONS } from "@/components/onboarding/archetype-icons";
import { buttonPrimary, buttonSecondary } from "@/components/ui/styles";

const FEATURES = [
  { icon: ShoppingCart, title: "Fast till", text: "Search or scan, split payments across cash, Orange Money, Afrimoney, QMoney, bank and US dollars." },
  { icon: WifiOff, title: "Works offline", text: "No network? Keep selling. Sales are saved on the phone and sent when data returns." },
  { icon: Scale, title: "Stock reconciliation", text: "Opening + purchases − sales vs what is on the shelf, in the freezer and the store. Shortages flagged in red." },
  { icon: HandCoins, title: "Daily cash-up", text: "Each cashier counts their till; the system knows what should be there." },
  { icon: Fingerprint, title: "Theft-proof records", text: "Staff cannot delete or edit sales. Every action is logged with name, time, IP and device — tamper-evident." },
  { icon: BookOpen, title: "Books kept for you", text: "Double-entry ledger, profit & loss, cash flow, debtors and creditors — automatically." },
  { icon: BellRing, title: "Alerts", text: "Low stock, expiry, voids, big discounts, after-hours sales — in the app, by SMS or WhatsApp." },
  { icon: Sparkles, title: "Weekly advisor", text: "Every Monday: revenue vs expenses, profit, best sellers, dead stock and what to re-order before you run out." },
];

export default async function Home() {
  const session = await getUser();
  if (session) redirect("/dashboard");

  return (
    <main className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <span className="flex items-center gap-2">
          <Logo />
          <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
        </span>
        <nav className="flex gap-2">
          <Link href="/login" className={buttonSecondary}>
            Sign in
          </Link>
          <Link href="/signup" className={`${buttonPrimary} max-sm:hidden`}>
            Start free
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-12 pt-8 sm:px-6 sm:pt-16">
        <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-800 dark:bg-brand-800/30 dark:text-brand-100">
          <Smartphone className="h-3.5 w-3.5" /> Made for businesses in Sierra Leone
        </p>
        <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">
          Know every Leone and every item — even when you are not in the shop.
        </h1>
        <p className="mt-4 max-w-2xl text-base text-zinc-600 sm:text-lg dark:text-zinc-400">
          Sales, stock, bookkeeping and anti-theft controls for provision shops, supermarkets, bars, pharmacies, hardware stores, water factories, salons and more. Works on
          any phone, tablet or laptop.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/signup" className={`${buttonPrimary} !px-6 !py-3 text-base`}>
            Set up my business
          </Link>
          <Link href="/login" className={`${buttonSecondary} !px-6 !py-3 text-base`}>
            I work here — sign in
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-14 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-zinc-200 bg-surface p-5 dark:border-zinc-800">
              <f.icon className="h-6 w-6 text-brand-600" />
              <h2 className="mt-3 font-semibold">{f.title}</h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <h2 className="mb-4 text-xl font-semibold">Set up for your kind of business</h2>
        <ul className="flex flex-wrap gap-2">
          {ARCHETYPES.map((a) => {
            const Icon = ARCHETYPE_ICONS[a.icon];
            return (
              <li key={a.key} className="flex items-center gap-2 rounded-full border border-zinc-200 bg-surface px-3 py-1.5 text-sm dark:border-zinc-800">
                <Icon className="h-4 w-4 text-brand-600" /> {a.label}
              </li>
            );
          })}
        </ul>
      </section>

      <footer className="border-t border-zinc-200 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800">
        {APP_NAME} · Leones (SLE) · Freetown · Bo · Kenema · Makeni · Lungi
      </footer>
    </main>
  );
}
