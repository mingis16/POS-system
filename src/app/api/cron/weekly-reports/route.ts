import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron";
import { buildAdvice } from "@/lib/advisor";
import { addDays, todayISO, weekStart } from "@/lib/format";

export const maxDuration = 300;

/**
 * GET /api/cron/weekly-reports — every Monday: last week's report with
 * advice for every business, plus an expiry scan. Protected by CRON_SECRET.
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" }, { status: 500 });

  const lastWeek = weekStart(addDays(todayISO(), -7));
  const { data: businesses, error } = await admin.from("businesses").select("id, name").not("onboarding_completed_at", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: { business: string; ok: boolean; error?: string }[] = [];
  for (const b of businesses ?? []) {
    try {
      await admin.rpc("scan_expiries", { b: b.id });
      const { data: reportId, error: genErr } = await admin.rpc("generate_weekly_report", { b: b.id, p_week_start: lastWeek });
      if (genErr) throw genErr;
      const advice = await buildAdvice(admin, b.id);
      await admin.rpc("save_report_advice", { p_report: reportId, p_advice: advice });
      results.push({ business: b.name, ok: true });
    } catch (e) {
      results.push({ business: b.name, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ week_start: lastWeek, results });
}
