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

import { sanitizeNext } from "@/lib/auth/betaSession";
import {
  getCheckoutUrl,
  isBetaFallbackEnabled,
  isWhopAccessEnabled,
} from "@/lib/auth/whopConfig";

type SearchParams = { next?: string; error?: string };

const ERROR_COPY: Record<string, string> = {
  invalid:            "Incorrect password. Try again.",
  unavailable:        "Lab access is temporarily unavailable. Please contact support if this persists.",
  whop_disabled:      "Whop sign-in is not currently configured. Use the beta access form below if you have a code.",
  whop_denied:        "Sign-in was cancelled. Try again, or contact support if you expected access.",
  whop_state:         "Your sign-in session expired. Please try again.",
  whop_token:         "We couldn't complete your Whop sign-in. Please try again.",
  whop_userinfo:      "We couldn't read your Whop profile. Please try again.",
  whop_access_error:  "Membership check failed. Please try again in a moment.",
  whop_session_error: "We couldn't start your session. Please try again.",
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

  const whopEnabled = isWhopAccessEnabled();
  const betaEnabled = isBetaFallbackEnabled();
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
            className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2"
          >
            {errorMessage}
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
