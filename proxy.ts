/**
 * Request proxy — pre-launch V1 access gate (Fix 5.1).
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
  buildWhopSessionClearCookie,
  buildWhopSessionSetCookie,
  WHOP_SESSION_MAX_AGE_SECONDS,
  WHOP_SESSION_COOKIE_NAME,
  shouldRefreshWhopAccess,
  signWhopSession,
  verifyWhopSession,
} from "@/lib/auth/whopSession";
import { checkWhopAccess } from "@/lib/auth/whopAccess";

/**
 * Page-route prefixes that require the beta session cookie. On miss,
 * unauthenticated visitors are redirected to /login?next=<encoded-path>.
 */
const PROTECTED_PAGE_PREFIXES = [
  "/lab",
  "/admin",
  "/mlb/props",
  "/dev/experience-preview",
  "/dev/mlb-props-preview",
  "/dev/tracking-preview",
  "/dev/homepage-preview",
  "/dev/login-preview",
  "/dev/relaunch-review",
  "/dev/device-review",
];

/**
 * API-route prefixes that require the beta session cookie. On miss,
 * return JSON 401 (no redirect — API consumers expect JSON).
 */
const PROTECTED_API_PREFIXES = ["/api/lab", "/api/mlb/props"];

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

function withClearedWhopSession(response: NextResponse): NextResponse {
  response.headers.append("Set-Cookie", buildWhopSessionClearCookie());
  return response;
}

function unauthenticatedResponse(
  request: NextRequest,
  isApi: boolean,
  clearWhopSession: boolean,
): NextResponse {
  const response = isApi
    ? NextResponse.json(
        { error: "auth_required", login_url: "/login" },
        { status: 401 },
      )
    : (() => {
        const loginUrl = new URL("/login", request.url);
        const nextParam = request.nextUrl.pathname + (request.nextUrl.search || "");
        loginUrl.searchParams.set("next", nextParam);
        return NextResponse.redirect(loginUrl, { status: 302 });
      })();

  return clearWhopSession ? withClearedWhopSession(response) : response;
}

function accessCheckUnavailableResponse(request: NextRequest, isApi: boolean): NextResponse {
  if (isApi) {
    return NextResponse.json(
      { error: "access_check_unavailable", login_url: "/login" },
      { status: 503 },
    );
  }

  const loginUrl = new URL("/login", request.url);
  const nextParam = request.nextUrl.pathname + (request.nextUrl.search || "");
  loginUrl.searchParams.set("next", nextParam);
  loginUrl.searchParams.set("error", "whop_access_check_failed");
  return NextResponse.redirect(loginUrl, { status: 302 });
}

function authenticatedPageResponse(request: NextRequest): NextResponse {
  return NextResponse.next();
}

// ─── TEMPORARY: nba-v0a preview-branch bypass ─────────────────────────
//
// !!!  REMOVE BEFORE MERGING nba-v0a -> main  !!!
//
// Scoped to ALL of:
//   • Running on Vercel (VERCEL=1, platform-set)
//   • Vercel env is exactly "preview" (NOT production, NOT development)
//   • The git branch is exactly "nba-v0a"
//   • Path is exactly one of the NBA admin preview routes (page or API)
//
// On production deployments VERCEL_ENV="production" and
// VERCEL_GIT_COMMIT_REF="main" — neither matches, so the bypass is
// inert there. All other preview branches also have a different ref → inert.
//
// Does NOT broadly bypass /admin/*. Does NOT bypass any MLB admin route.
// Does NOT touch member-facing paths. The /api/admin/nba-preview API
// already re-validates auth at its handler with the same triple-gate.
const NBA_PREVIEW_BYPASS_PATHS = [
  "/admin/nba-preview",
  "/admin/nba-daily-edge-preview",
  "/api/admin/nba-preview",
];
function isNbaPreviewBranchBypass(pathname: string): boolean {
  if (
    process.env.VERCEL !== "1" ||
    process.env.VERCEL_ENV !== "preview" ||
    process.env.VERCEL_GIT_COMMIT_REF !== "nba-v0a"
  ) {
    return false;
  }
  return NBA_PREVIEW_BYPASS_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // TEMPORARY nba-v0a preview-branch bypass — REMOVE BEFORE MERGING TO MAIN.
  if (isNbaPreviewBranchBypass(pathname)) {
    return NextResponse.next();
  }

  // Fast path: not a protected route → no work.
  const isPage = isProtectedPagePath(pathname);
  const isApi = isProtectedApiPath(pathname);
  if (!isPage && !isApi) return NextResponse.next();

  // Either session cookie unlocks the Lab. We check Whop first because
  // a Whop user is the launch-target case; beta is the fallback.
  const whopCookie = request.cookies.get(WHOP_SESSION_COOKIE_NAME)?.value;
  const whopPayload = await verifyWhopSession(whopCookie);
  let clearWhopSession = false;
  let whopAccessCheckUnavailable = false;

  if (whopPayload !== null) {
    if (!shouldRefreshWhopAccess(whopPayload)) {
      return authenticatedPageResponse(request);
    }

    const access = await checkWhopAccess({ userId: whopPayload.uid });
    if (access.has_access) {
      const refreshedPayload = {
        ...whopPayload,
        acl: access.access_level,
        iat: access.checked_at,
        exp: access.checked_at + WHOP_SESSION_MAX_AGE_SECONDS,
      };
      const refreshedCookie = await signWhopSession(refreshedPayload);
      if (refreshedCookie !== null) {
        const response = authenticatedPageResponse(request);
        response.headers.append("Set-Cookie", buildWhopSessionSetCookie(refreshedCookie));
        return response;
      }
      whopAccessCheckUnavailable = true;
    } else if (access.reason === "denied") {
      clearWhopSession = true;
    } else {
      // Fail closed for this request, but retain the signed session so an
      // active member can retry after a transient Whop/configuration issue.
      whopAccessCheckUnavailable = true;
    }
  }

  const betaCookie = request.cookies.get(BETA_SESSION_COOKIE_NAME)?.value;
  const betaAuthenticated = await isValidBetaSession(betaCookie);
  if (betaAuthenticated) {
    const response = authenticatedPageResponse(request);
    return clearWhopSession ? withClearedWhopSession(response) : response;
  }

  if (whopAccessCheckUnavailable) {
    return accessCheckUnavailableResponse(request, isApi);
  }

  // Unauthenticated. Branch on path style — page → redirect, API → JSON 401.
  return unauthenticatedResponse(request, isApi, clearWhopSession);
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
