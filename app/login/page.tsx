/**
 * /login — pre-launch V1 beta-password gate UI (Fix 5.1).
 *
 * Server Component. Reads `next` + `error` query params and renders a
 * password form that POSTs to /api/auth/login. On success, the route
 * sets the beta session cookie and redirects to the sanitized `next`.
 *
 * Whop OAuth ships in Phase 7 — the button stays as a disabled placeholder
 * so the marketing flow + login surface are stable. When Phase 7 lands,
 * this page swaps the password form for the Whop OAuth button without
 * changing the surrounding URL contract.
 *
 * Error states:
 *   • ?error=invalid      → "Incorrect password" inline notice
 *   • ?error=unavailable  → "Beta access temporarily unavailable" (LAB_BETA_PASSWORD env missing on server). Avoids disclosing the env var name to anonymous visitors.
 */

import Link from "next/link";

type SearchParams = { next?: string; error?: string };

const ERROR_COPY: Record<string, string> = {
  invalid: "Incorrect password. Try again.",
  unavailable:
    "Beta access is temporarily unavailable. Please contact support if this persists.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const nextValue = typeof params.next === "string" ? params.next : "";
  const errorKey = typeof params.error === "string" ? params.error : "";
  const errorMessage = ERROR_COPY[errorKey] ?? null;

  return (
    <main className="max-w-md mx-auto px-4 sm:px-6 py-16 sm:py-24">
      <header className="text-center mb-10">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-300 mb-3">
          OddSphere Premium
        </p>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-2">
          Welcome to The Lab
        </h1>
        <p className="text-sm text-gray-300">
          Enter your beta access password to continue.
        </p>
      </header>

      <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-2xl p-6 sm:p-8 space-y-4">
        {/* Whop OAuth placeholder — Phase 7 swaps this disabled button for
            the real OAuth handler. Keeps the visual structure stable for
            the eventual migration. */}
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Whop OAuth ships in Phase 7"
          className="w-full inline-flex items-center justify-center gap-2 bg-violet-600 text-white font-semibold rounded-lg px-4 py-3 transition-all hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950 cursor-not-allowed opacity-90"
        >
          <span aria-hidden="true">🔐</span>
          Continue with Whop
        </button>

        <div className="flex items-center gap-3 text-xs text-gray-500 uppercase tracking-wider">
          <span className="flex-1 h-px bg-gray-800" aria-hidden="true" />
          <span>beta access</span>
          <span className="flex-1 h-px bg-gray-800" aria-hidden="true" />
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2"
          >
            {errorMessage}
          </div>
        )}

        <form
          action="/api/auth/login"
          method="POST"
          className="space-y-3"
          aria-label="Beta password sign-in form"
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
              autoFocus
              className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-base text-white placeholder:text-gray-500 focus:outline-none focus:border-violet-500 focus:shadow-[0_0_16px_rgba(167,139,250,0.25)] transition-all"
            />
          </label>
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-lg px-4 py-3 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
          >
            Continue
          </button>
        </form>

        <p className="text-[11px] text-gray-500 leading-relaxed italic pt-2 border-t border-gray-800/60">
          Beta members received the access password via Whop. Full Whop sign-in
          ships in Phase 7.
        </p>
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
