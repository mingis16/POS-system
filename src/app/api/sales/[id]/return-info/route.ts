import { NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { describeDbError } from "@/lib/actions";

/**
 * GET /api/sales/:id/return-info — what can still come back from a sale, for
 * the return / exchange dialog: remaining quantities, line values, sold serial
 * numbers, the customer, and the managers who can approve with a PIN.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/sales/[id]/return-info">) {
  const session = await getContext();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Sale not found." }, { status: 404 });

  const { data, error } = await session.supabase.rpc("sale_return_info", { p_sale: id });
  if (error) {
    const status = error.code === "42501" ? 403 : error.message === "Sale not found." ? 404 : error.code === "P0001" ? 422 : 500;
    return NextResponse.json({ error: describeDbError(error) }, { status });
  }
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
