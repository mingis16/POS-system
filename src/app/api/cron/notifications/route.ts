import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cron";
import { NotConfigured, sendNotification } from "@/lib/notify";

/** GET /api/cron/notifications — sends queued SMS/WhatsApp alerts (every few minutes). Protected by CRON_SECRET. */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" }, { status: 500 });

  const { data: queue, error } = await admin
    .from("notifications")
    .select("id, channel, recipient, body, attempts")
    .eq("status", "pending")
    .lt("attempts", 5)
    .order("created_at")
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sent = 0;
  let failed = 0;
  for (const n of queue ?? []) {
    try {
      await sendNotification(n.channel, n.recipient, n.body);
      await admin.from("notifications").update({ status: "sent", sent_at: new Date().toISOString(), attempts: n.attempts + 1 }).eq("id", n.id);
      sent++;
    } catch (e) {
      if (e instanceof NotConfigured) {
        return NextResponse.json({ sent, failed, pending: (queue ?? []).length - sent, note: e.message });
      }
      failed++;
      await admin
        .from("notifications")
        .update({ attempts: n.attempts + 1, last_error: e instanceof Error ? e.message : String(e), status: n.attempts + 1 >= 5 ? "failed" : "pending" })
        .eq("id", n.id);
    }
  }
  return NextResponse.json({ sent, failed });
}
