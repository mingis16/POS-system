import Link from "next/link";
import { APP_NAME } from "@/lib/constants";
import { Logo } from "./logo";

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-6 flex items-center gap-2">
        <Logo />
        <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
      </Link>
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-surface p-6 shadow-sm dark:border-zinc-800">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
      {footer && <div className="mt-5 text-sm text-zinc-600 dark:text-zinc-400">{footer}</div>}
    </main>
  );
}

export function NotConfigured() {
  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
      Supabase is not connected yet. Copy <code>.env.example</code> to <code>.env.local</code>, add your project URL and
      anon key, apply the migrations, then restart. See the README.
    </div>
  );
}
