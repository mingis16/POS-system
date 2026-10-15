import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BUSINESS_COOKIE } from "@/lib/constants";
import { capabilities, isAdmin } from "@/lib/permissions";
import { getArchetype } from "@/lib/archetypes";
import type { Business, Membership, Role, Terminology } from "@/lib/types";

export const isConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

/** The signed-in user, memoised per request. */
export const getUser = cache(async () => {
  // Always per request: the answer depends on the session and on runtime env vars.
  await connection();
  if (!isConfigured()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase, user } : null;
});

/** Every business the user belongs to (any status), memoised per request. */
export const getMemberships = cache(async () => {
  const session = await getUser();
  if (!session) return [];
  const { data } = await session.supabase
    .from("memberships")
    .select("business_id, user_id, role, status, display_name, phone, created_at, businesses(name, business_type)")
    .eq("user_id", session.user.id)
    .order("created_at");
  return (data ?? []) as unknown as (Membership & { businesses: { name: string; business_type: string } | null })[];
});

/**
 * The business being worked in: the one in the sl_business cookie if the user
 * is an active member, else their first active membership.
 */
export const getContext = cache(async () => {
  const session = await getUser();
  if (!session) return null;
  const memberships = await getMemberships();
  const active = memberships.filter((m) => m.status === "active");
  const wanted = (await cookies()).get(BUSINESS_COOKIE)?.value;
  const membership = active.find((m) => m.business_id === wanted) ?? active[0];
  if (!membership) return { ...session, memberships, membership: null, business: null } as const;

  const { data: business } = await session.supabase
    .from("businesses")
    .select("*")
    .eq("id", membership.business_id)
    .single<Business>();
  if (!business) return { ...session, memberships, membership: null, business: null } as const;

  return {
    ...session,
    memberships,
    membership,
    business,
    role: membership.role as Role,
    can: capabilities(membership.role, business),
    terms: terminology(business),
  } as const;
});

export type Context = NonNullable<Awaited<ReturnType<typeof requireMember>>>;

/** For pages: an active member of a business. Sends others to sign-in, onboarding or the pending page. */
export async function requireMember() {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  if (!ctx.business || !ctx.membership) {
    if (ctx.memberships.some((m) => m.status === "pending" || m.status === "suspended")) redirect("/pending");
    redirect("/onboarding");
  }
  return ctx as typeof ctx & { business: Business; membership: Membership; role: Role };
}

/** For pages: owners and admins only. */
export async function requireAdmin() {
  const ctx = await requireMember();
  if (!isAdmin(ctx.role)) redirect("/dashboard?denied=1");
  return ctx;
}

export async function requireCapability(key: keyof ReturnType<typeof capabilities>) {
  const ctx = await requireMember();
  if (!ctx.can[key]) redirect("/dashboard?denied=1");
  return ctx;
}

/** The business's words, falling back to its archetype's. */
export function terminology(business: Pick<Business, "terminology" | "business_type">): Terminology {
  return { ...getArchetype(business.business_type).terminology, ...business.terminology } as Terminology;
}
