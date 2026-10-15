import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEVICE_COOKIE } from "@/lib/constants";

const PUBLIC_PATHS = ["/login", "/signup", "/auth", "/offline", "/api/cron", "/welcome"];

/** Refreshes the Supabase session, gates private pages and tags the device. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { pathname } = request.nextUrl;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    // Not configured yet: show the setup notice on the login page.
    if (!PUBLIC_PATHS.some((p) => pathname.startsWith(p)) && pathname !== "/") {
      return pathname.startsWith("/api/")
        ? NextResponse.json({ error: "Supabase is not configured" }, { status: 503 })
        : NextResponse.redirect(new URL("/login", request.url));
    }
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p)) || pathname === "/";
  let redirect: NextResponse | null = null;
  if (!user && !isPublic) {
    if (pathname.startsWith("/api/")) {
      redirect = NextResponse.json({ error: "Not signed in" }, { status: 401 });
    } else {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = pathname === "/dashboard" ? "" : `?next=${encodeURIComponent(pathname)}`;
      redirect = NextResponse.redirect(url);
    }
  } else if (user && (pathname.startsWith("/login") || pathname.startsWith("/signup"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    redirect = NextResponse.redirect(url);
  }

  const out = redirect ?? response;
  if (redirect) {
    for (const c of response.cookies.getAll()) out.cookies.set(c);
  }
  if (!request.cookies.get(DEVICE_COOKIE)) {
    out.cookies.set(DEVICE_COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 400,
      path: "/",
    });
  }
  return out;
}
