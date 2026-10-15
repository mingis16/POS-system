import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth";
import { loadCatalog } from "@/lib/catalog";

/** GET /api/pos/catalog — the active business's sellable items with live stock, for the till and its offline cache. */
export async function GET() {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!ctx.business) return NextResponse.json({ error: "No active business" }, { status: 403 });
  try {
    const items = await loadCatalog(ctx.supabase, ctx.business.id);
    return NextResponse.json({ business_id: ctx.business.id, at: Date.now(), items }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Could not load the catalogue" }, { status: 500 });
  }
}
