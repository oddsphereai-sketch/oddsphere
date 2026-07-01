/**
 * /login — Lab access gate (Phase 6B.3a — Whop OAuth wired).
 *
 * Server Component. Reads server-side feature flags from the auth env
 * and chooses between three UI states:
 *
 *   (a) Whop OAuth enabled  → "Sign in with Whop" is the primary CTA.
 *                              Beta password form appears below as a
 *                              labelled fallback if also configured.
 *   (b) Beta-only           → Beta password form is the primary UI.
 *   (c) Neither configured  → A safe "Lab access is temporarily
 *                              unavailable" message. No broken buttons.
 *
 * Honors `next` (sanitized later in the auth route) and `error` query
 * params. The full set of error codes the login UI recognises now:
 *   invalid           — wrong beta password
 *   unavailable       — server misconfigured (env missing)
 *   whop_disabled     — Whop CTA hit while feature disabled
 *   whop_denied       — user denied consent on the Whop screen
 *   whop_state        — OAuth state/CSRF mismatch
 *   whop_token        — token exchange failed
 *   whop_userinfo     — userinfo call failed
 *   whop_access_error — access-check API error (transient)
 *   whop_session_error — could not mint our own session cookie
 */

import Link from "next/link";
import type { Metadata } from "next";

import { sanitizeNext } from "@/lib/auth/betaSession";
import {
  getCheckoutUrl,
  isBetaFallbackEnabled,
  isBetaLoginPubliclyVisible,
  isWhopAccessEnabled,
} from "@/lib/auth/whopConfig";

export const metadata: Metadata = {
  title: "Log In — OddSphere AI",
  description: "Sign in to the OddSphere AI member dashboard through Whop.",
  robots: {
    index: false,
    follow: false,
  },
};

type SearchParams = { next?: string; error?: string; wd?: string; wdd?: string };

const ERROR_COPY: Record<string, string> = {
  invalid:                  "Incorrect password. Try again.",
  unavailable:              "Lab access is temporarily unavailable. Please contact support if this persists.",
  whop_disabled:            "Whop sign-in is not currently configured. Use the beta access form below if you have a code.",
  whop_denied:              "Sign-in was cancelled on the Whop consent screen. Try again, or contact support if you expected access.",

  // Specific callback-stage failures (Phase 6B.3a.5). The diagnostic
  // line below the message shows "Whop responded: <wd>" so the cause
  // is identifiable without exposing secrets.
  whop_config_missing:      "Whop sign-in isn't fully configured on the server right now. Please use the beta access form below or try again shortly.",
  whop_missing_code:        "Whop didn't return a sign-in code. Please try again.",
  whop_state_mismatch:      "Your sign-in session expired or was started in another tab. Please try again from this page.",
  whop_token_exchange_failed: "We couldn't complete the Whop sign-in handshake. The diagnostic below names the exact Whop error.",
  whop_missing_access_token: "Whop accepted the sign-in but returned no access token. Please try again — contact support if it persists.",
  whop_nonce_mismatch:      "Your sign-in session didn't match — likely a stale tab or cookies were cleared mid-flow. Please try again.",
  whop_missing_user:        "We couldn't read your Whop profile. Please try again — contact support if it persists.",
  whop_access_check_failed: "We couldn't verify your Whop membership right now. Please try again in a moment.",
  whop_no_resource_access:  "Your Whop account doesn't have an active OddSphere AI Premium membership. Get access below to continue.",
  whop_session_write_failed: "We couldn't start your session. Please try again.",
  whop_unexpected_callback_error: "Something unexpected happened during sign-in. Please try again — the diagnostic below has details for support.",

  // Backwards-compat (older callbacks / cached redirects may still
  // arrive at /login with these codes).
  whop_state:               "Your sign-in session expired. Please try again.",
  whop_token:               "We couldn't complete your Whop sign-in. Please try again.",
  whop_userinfo:            "We couldn't read your Whop profile. Please try again.",
  whop_access_error:        "Membership check failed. Please try again in a moment.",
  whop_session_error:       "We couldn't start your session. Please try again.",
  whop_nonce:               "Your sign-in session didn't match — likely a stale tab or cookies were cleared mid-flow. Please try again.",

  // Authorize-stage Whop OAuth error codes (Phase 6B.3a.3).
  whop_oauth_request:       "Whop rejected the sign-in request. The Whop OAuth app may need its redirect URI updated.",
  whop_oauth_unauthorized:  "The Whop OAuth app is not authorized to sign members in. Check that OAuth is enabled, the app is published, and the redirect URI is approved in the Whop dashboard.",
  whop_oauth_unsupported:   "Whop rejected the sign-in flow. Contact support — this likely needs a code fix.",
  whop_oauth_scope:         "Whop blocked the sign-in because one of the requested scopes (openid, profile, email) is not enabled on the Whop OAuth app.",
  whop_oauth_server:        "Whop is having a server-side issue. Please try again in a minute.",
  whop_oauth_unavailable:   "Whop is temporarily unavailable. Please try again in a minute.",
  whop_oauth_err:           "Whop returned an unexpected sign-in error. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const nextValue = typeof params.next === "string" ? sanitizeNext(params.next) : "/lab/daily-edge";
  const errorKey = typeof params.error === "string" ? params.error : "";
  const errorMessage = ERROR_COPY[errorKey] ?? null;
  // Whop diagnostic forwarding (wd = error code, wdd = description).
  // Already public via the redirect URL Whop sent here — not a secret.
  // Cap to safe lengths defensively.
  const whopDetail = typeof params.wd === "string" ? params.wd.slice(0, 64) : null;
  const whopDescription = typeof params.wdd === "string" ? params.wdd.slice(0, 200) : null;

  const whopEnabled = isWhopAccessEnabled();
  const betaEnabledServerSide = isBetaFallbackEnabled();
  // Phase 6B.4 — surface the beta password form only when:
  //   • Whop OAuth is NOT yet configured (fallback path during cutover), OR
  //   • LAB_BETA_LOGIN_VISIBLE=true is explicitly set (admin recovery).
  // The beta session code path stays available either way — middleware
  // still honors a valid cookie if one is presented.
  const betaEnabled = whopEnabled
    ? isBetaLoginPubliclyVisible()
    : betaEnabledServerSide;
  const checkoutUrl = getCheckoutUrl();

  const whopStartHref = `/api/auth/whop/start?next=${encodeURIComponent(nextValue)}`;

  return (
    <main className="max-w-md mx-auto px-4 sm:px-6 py-16 sm:py-24">
      <header className="text-center mb-10">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-300 mb-3">
          OddSphere AI
        </p>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-2">
          Sign in to the Lab
        </h1>
        <p className="text-sm text-gray-300">
          {whopEnabled
            ? "Use the Whop account connected to your OddSphere AI membership."
            : "Enter your beta access password to continue."}
        </p>
      </header>

      <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-2xl p-6 sm:p-8 space-y-4">
        {errorMessage !== null && (
          <div
            role="alert"
            className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 space-y-1.5"
          >
            <div>{errorMessage}</div>
            {whopDetail !== null && (
              <div className="text-[11px] text-amber-200/80 font-mono break-all">
                Whop responded: <span className="font-semibold">{whopDetail}</span>
                {whopDescription !== null && (
                  <span className="text-amber-200/60"> — {whopDescription}</span>
                )}
              </div>
            )}
          </div>
        )}

        {whopEnabled && (
          <a
            href={whopStartHref}
            className="w-full inline-flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-lg px-4 py-3 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
          >
            <span aria-hidden="true">🔐</span>
            Sign in with Whop
          </a>
        )}

        {whopEnabled && betaEnabled && (
          <div className="flex items-center gap-3 text-[11px] text-gray-500 uppercase tracking-wider pt-2">
            <span className="flex-1 h-px bg-gray-800" aria-hidden="true" />
            <span>or beta access</span>
            <span className="flex-1 h-px bg-gray-800" aria-hidden="true" />
          </div>
        )}

        {betaEnabled && (
          <form
            action="/api/auth/login"
            method="POST"
            className="space-y-3"
            aria-label="Beta access sign-in form"
          >
            <input type="hidden" name="next" value={nextValue} />
            <label className="block">
              <span className="sr-only">Beta access password</span>
              <input
                type="password"
                name="password"
                placeholder="Beta access password"
                required
                autoComplete="current-password"
                autoFocus={!whopEnabled}
                className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-base text-white placeholder:text-gray-500 focus:outline-none focus:border-violet-500 focus:shadow-[0_0_16px_rgba(167,139,250,0.25)] transition-all"
              />
            </label>
            <button
              type="submit"
              className={
                whopEnabled
                  ? "w-full inline-flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-white font-semibold rounded-lg px-4 py-3 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
                  : "w-full inline-flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-lg px-4 py-3 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
              }
            >
              Continue with beta password
            </button>
          </form>
        )}

        {!whopEnabled && !betaEnabled && (
          <div className="text-sm text-gray-300 text-center py-2">
            Lab access is temporarily unavailable. Please contact support if this persists.
          </div>
        )}

        {whopEnabled && (
          <p className="text-[11px] text-gray-500 leading-relaxed pt-2 border-t border-gray-800/60">
            Don&rsquo;t have a membership yet?{" "}
            {checkoutUrl !== null ? (
              <a
                href={checkoutUrl}
                className="text-violet-300 hover:text-violet-200 font-semibold underline underline-offset-2"
                rel="noopener noreferrer"
                target="_blank"
              >
                Get access on Whop
              </a>
            ) : (
              <Link
                href="/pricing"
                className="text-violet-300 hover:text-violet-200 font-semibold underline underline-offset-2"
              >
                See membership
              </Link>
            )}
            .
          </p>
        )}
      </div>

      <p className="text-center text-sm text-gray-300 mt-8">
        Not a member yet?{" "}
        <Link
          href="/pricing"
          className="text-violet-300 hover:text-violet-200 font-semibold underline underline-offset-2"
        >
          Join Premium
        </Link>
      </p>
    </main>
  );
}
