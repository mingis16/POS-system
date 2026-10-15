import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock, ShieldOff } from "lucide-react";
import { getContext } from "@/lib/auth";
import { AuthCard } from "@/components/shell/auth-card";
import { buttonSecondary } from "@/components/ui/styles";

export const metadata = { title: "Waiting for approval" };

export default async function PendingPage() {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  if (ctx.business) redirect("/dashboard");
  const waiting = ctx.memberships.filter((m) => m.status !== "active");
  return (
    <AuthCard title="Waiting for approval" subtitle="Your manager has to approve you before you can start.">
      <ul className="flex flex-col gap-3">
        {waiting.map((m) => (
          <li key={m.business_id} className="flex items-center gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            {m.status === "pending" ? (
              <Clock className="h-5 w-5 shrink-0 text-amber-500" />
            ) : (
              <ShieldOff className="h-5 w-5 shrink-0 text-red-500" />
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{m.businesses?.name ?? "Business"}</p>
              <p className="text-xs text-zinc-500">{m.status === "pending" ? "Request sent" : "Access suspended"}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex gap-2">
        <Link href="/pending" className={buttonSecondary}>
          Check again
        </Link>
        <Link href="/onboarding?new=1" className={buttonSecondary}>
          Set up my own business
        </Link>
      </div>
      <form action="/auth/signout" method="post" className="mt-4">
        <button className="text-sm text-zinc-500 hover:underline">Sign out</button>
      </form>
    </AuthCard>
  );
}
