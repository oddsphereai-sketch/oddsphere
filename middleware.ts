/**
 * Edge middleware — pre-launch V1 access gate (Fix 5.1).
 *
 * Gates `/lab/*` + `/admin/*` page routes and `/api/lab/*` API routes
 * behind a shared beta-password cookie. The cookie is set by
 * `/api/auth/login` after the member submits the correct
 * `LAB_BETA_PASSWORD`.
 *
 * Flag D1: page routes (`/lab/*`, `/admin/*`) redirect unauthenticated
 *   visitors to `/login?next=<original-path>`. API routes (`/api/lab/*`)
 *   return JSON 401 — API consumers expect JSON, not HTML or redirects.
 *
 * Flag I1: NO dev-mode bypass. Local `npm run dev` exercises the same
 *   gate as production. Production fail-closed posture is preserved
 *   regardless of NODE_ENV.
 *
 * Unaffected:
 *   • `/api/admin/*` — protected by `validateAdminAuth` at handler level
 *     (token + email allowlist). Middleware excludes this prefix so admin
 *     curl/Postman workflows stay token-based.
 *   • `/api/cron/*` — protected by `CRON_SECRET` via the `cronHandler`
 *     wrapper. Middleware excludes this prefix.
 *   • Marketing routes (`/`, `/pricing`, `/track-record`, `/login`) — public.
 *   • `/api/auth/*` — the gate's own endpoints; must remain public.
 *   • Next.js internals + static assets — excluded by the `matcher` below.
 *
 * Phase 7 (Whop OAuth) replaces this gate. The cookie name + flow shape
 * are chosen to be drop-in-replaceable; only this file + lib/auth/*
 * change when Whop wiring lands.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  BETA_SESSION_COOKIE_NAME,
  isValidBetaSession,
} from "@/lib/auth/betaSession";
import {
  WHOP_SESSION_COOKIE_NAME,
  verifyWhopSession,
} from "@/lib/auth/whopSession";

/**
 * Page-route prefixes that require the beta session cookie. On miss,
 * unauthenticated visitors are redirected to /login?next=<encoded-path>.
 */
const PROTECTED_PAGE_PREFIXES = ["/lab", "/admin"];

/**
 * API-route prefixes that require the beta session cookie. On miss,
 * return JSON 401 (no redirect — API consumers expect JSON).
 */
const PROTECTED_API_PREFIXES = ["/api/lab"];

function isProtectedPagePath(pathname: string): boolean {
  return PROTECTED_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function isProtectedApiPath(pathname: string): boolean {
  return PROTECTED_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Fast path: not a protected route → no work.
  const isPage = isProtectedPagePath(pathname);
  const isApi = isProtectedApiPath(pathname);
  if (!isPage && !isApi) return NextResponse.next();

  // Either session cookie unlocks the Lab. We check Whop first because
  // a Whop user is the launch-target case; beta is the fallback.
  const whopCookie = request.cookies.get(WHOP_SESSION_COOKIE_NAME)?.value;
  const whopPayload = await verifyWhopSession(whopCookie);
  if (whopPayload !== null) return NextResponse.next();

  const betaCookie = request.cookies.get(BETA_SESSION_COOKIE_NAME)?.value;
  const betaAuthenticated = await isValidBetaSession(betaCookie);
  if (betaAuthenticated) return NextResponse.next();

  // Unauthenticated. Branch on path style — page → redirect, API → JSON 401.
  if (isApi) {
    return NextResponse.json(
      {
        error: "auth_required",
        login_url: "/login",
      },
      { status: 401 }
    );
  }

  // Page route — redirect to /login?next=<original-path>.
  // The `next` param is URL-encoded; the login route's sanitizeNext()
  // re-validates that the value is a same-origin path.
  const loginUrl = new URL("/login", request.url);
  const nextParam = pathname + (request.nextUrl.search || "");
  loginUrl.searchParams.set("next", nextParam);
  return NextResponse.redirect(loginUrl, { status: 302 });
}

/**
 * Matcher excludes Next.js internals + static assets so we don't run the
 * gate logic on every CSS/font/image fetch. The complement set covers:
 *   • `/_next/*` — Next.js bundles, RSC payloads, prefetches
 *   • `/favicon.ico` and other root-level static files
 *   • Anything with a file extension (matches `.png`, `.jpg`, `.svg`,
 *     `.woff`, etc.) — typical static asset suffixes
 *
 * The gate then narrows further inside the function via the two prefix
 * lists. This pattern is documented at:
 *   node_modules/next/dist/docs/(if present) — Next.js middleware matchers
 */
export const config = {
  matcher: [
    // Match everything except: _next/*, favicon, files with extensions
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
