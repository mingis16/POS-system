import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { BUSINESS_COOKIE } from "@/lib/constants";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(BUSINESS_COOKIE);
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
