import "server-only";
import { timingSafeEqual } from "node:crypto";

/** Cron routes accept `Authorization: Bearer $CRON_SECRET` (what Vercel Cron sends). */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
