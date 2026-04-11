import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Public routes — let through
  if (
    path === "/login" ||
    path.startsWith("/auth/") ||
    path.startsWith("/api/webhook") ||
    path.startsWith("/api/internal/")
  ) {
    return NextResponse.next();
  }

  // Only guard /app and /admin. API routes use Bearer tokens handled by their handlers.
  if (!path.startsWith("/app") && !path.startsWith("/admin")) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: request.headers } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Single query used by both /app (disabled check) and /admin (role + status check)
  const { data: settings } = await supabase
    .from("user_settings")
    .select("role, status")
    .eq("user_id", user.id)
    .maybeSingle();

  // Disabled users cannot use the app
  if (settings?.status === "disabled") {
    return NextResponse.redirect(new URL("/login?disabled=1", request.url));
  }

  // /admin requires super_admin + active status
  if (path.startsWith("/admin")) {
    if (settings?.role !== "super_admin" || settings?.status !== "active") {
      return NextResponse.redirect(new URL("/app", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*"],
};
