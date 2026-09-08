import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const PUBLIC_PATHS = ["/login"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Without Supabase configured, the app runs in demo mode (see
  // docs/architecture.md) — no session to check, let every route through.
  // This is only safe for local development, though: `process.env.VERCEL`
  // is set automatically in every Vercel deployment (preview or
  // production), so a real deployment with missing/misconfigured env vars
  // must fail closed instead of silently opening every route — a live
  // audit flagged that a misconfigured production deploy would otherwise
  // be indistinguishable from "intentional demo mode".
  if (!isSupabaseConfigured()) {
    if (process.env.VERCEL) {
      return new NextResponse("Configuration Error: Supabase is not configured.", { status: 503 });
    }
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The shared-password gate (src/app/login/actions.ts) only ever signs
  // people in as one fixed account — but "does a valid Supabase session
  // exist" and "did it come from that gate" are two different questions.
  // If the Supabase project ever allowed signup/another sign-in method
  // (it shouldn't — see docs/security-boundaries.md — but this doesn't
  // rely on that being remembered), a session for any OTHER account must
  // be treated as not logged in here, not just downstream in
  // getCurrentUser().
  const isOperator = user?.email === process.env.OPERATOR_EMAIL;

  const isPublicPath = PUBLIC_PATHS.includes(request.nextUrl.pathname);

  if (!isOperator && !isPublicPath) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (isOperator && request.nextUrl.pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
