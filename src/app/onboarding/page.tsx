import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext, getUser } from "@/lib/auth";
import { APP_NAME } from "@/lib/constants";
import { OnboardingWizard } from "@/components/onboarding/wizard";
import { JoinForm } from "@/components/onboarding/join-form";
import { Logo } from "@/components/shell/logo";

export const metadata = { title: "Set up your business" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ new?: string; join?: string }> }) {
  const session = await getUser();
  if (!session) redirect("/login");
  const params = await searchParams;
  const ctx = await getContext();
  if (ctx?.business && !params.new) redirect("/dashboard");

  const meta = session.user.user_metadata as { full_name?: string; phone?: string };
  const joining = params.join === "1";

  return (
    <main className="min-h-dvh px-4 py-6 sm:py-10">
      <div className="mx-auto mb-6 flex max-w-3xl items-center justify-between gap-3">
        <Link href={ctx?.business ? "/dashboard" : "/onboarding"} className="flex items-center gap-2">
          <Logo />
          <span className="font-semibold tracking-tight">{APP_NAME}</span>
        </Link>
        <div className="flex rounded-lg border border-zinc-200 p-0.5 text-sm dark:border-zinc-800">
          <Link
            href={`/onboarding${params.new ? "?new=1" : ""}`}
            className={`rounded-md px-3 py-1.5 ${!joining ? "bg-brand-600 text-white" : "text-zinc-600 dark:text-zinc-400"}`}
          >
            New business
          </Link>
          <Link
            href={`/onboarding?join=1${params.new ? "&new=1" : ""}`}
            className={`rounded-md px-3 py-1.5 ${joining ? "bg-brand-600 text-white" : "text-zinc-600 dark:text-zinc-400"}`}
          >
            Join as staff
          </Link>
        </div>
      </div>
      {joining ? (
        <JoinForm defaultName={meta.full_name ?? ""} />
      ) : (
        <OnboardingWizard ownerName={meta.full_name ?? ""} ownerPhone={meta.phone ?? ""} />
      )}
    </main>
  );
}
