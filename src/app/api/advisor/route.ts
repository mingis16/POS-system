import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { buildAdvice } from "@/lib/advisor";

/** POST /api/advisor — fresh advice for the active business (owners and admins). */
export async function POST() {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!ctx.business || !isAdmin(ctx.membership?.role)) return NextResponse.json({ error: "Owners and admins only" }, { status: 403 });
  try {
    const advice = await buildAdvice(ctx.supabase, ctx.business.id);
    return NextResponse.json(advice, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Could not build advice" }, { status: 500 });
  }
}
