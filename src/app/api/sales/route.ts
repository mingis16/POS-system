import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth";
import { describeDbError } from "@/lib/actions";
import { saleSchema } from "@/lib/validation";

/**
 * POST /api/sales — records a POS sale (online or synced from the offline
 * queue). The body is validated here; the record_sale database function then
 * re-checks the role, takes prices from the catalogue, moves stock, posts the
 * journal and raises fraud alerts. Retrying with the same client_ref is safe.
 */
export async function POST(request: Request) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = saleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid sale" }, { status: 400 });
  }
  const sale = parsed.data;
  const member = ctx.memberships.find((m) => m.business_id === sale.business_id && m.status === "active");
  if (!member) return NextResponse.json({ error: "You are not active on this business." }, { status: 403 });

  const { data, error } = await ctx.supabase.rpc("record_sale", { p: sale });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0001" || error.code?.startsWith("22") || error.code?.startsWith("23") ? 422 : 500;
    return NextResponse.json({ error: describeDbError(error) }, { status });
  }
  return NextResponse.json(data, { status: 201 });
}
