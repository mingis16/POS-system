import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { DEVICE_COOKIE } from "@/lib/constants";

export type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Supabase as the signed-in user. The browser's IP, user agent and device id
 * are forwarded as x-client-* headers so the audit trail records who did what
 * from which device (see request_meta() in the controls migration).
 */
export async function createClient() {
  const cookieStore = await cookies();
  const h = await headers();
  const ip =
    h.get("cf-connecting-ip") ?? h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const meta: Record<string, string> = {};
  if (ip) meta["x-client-ip"] = ip;
  const ua = h.get("user-agent");
  if (ua) meta["x-client-ua"] = ua.slice(0, 300);
  const device = cookieStore.get(DEVICE_COOKIE)?.value;
  if (device) meta["x-device-id"] = device.slice(0, 64);

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: meta },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component; the proxy refreshes the session instead.
          }
        },
      },
    },
  );
}
