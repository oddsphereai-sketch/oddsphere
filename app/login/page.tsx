"use client";

/**
 * /login — sign-in page (Phase 6.2b, UI only per V2.1 spec).
 *
 * Two auth methods promised in V2.1 Part 5:
 *   • Continue with Whop (OAuth) — Phase 7
 *   • Continue with Email (passwordless magic link) — Phase 7
 *
 * For 6.2b the buttons are visual-only placeholders so the marketing flow
 * (CTA → /login → "Join Premium" link → /pricing) is walkable end-to-end.
 * Phase 7 wires real auth without changing this surface.
 *
 * Marked as a Client Component because the form uses an onSubmit handler
 * to prevent the placeholder submit from actually navigating. Once Phase 7
 * wires real auth this stays a client component for the form interactivity.
 */

import Link from "next/link";

export default function LoginPage() {
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
          Sign in to access daily model picks, player props, and tracking.
        </p>
      </header>

      <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-2xl p-6 sm:p-8 space-y-4">
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
          <span>or</span>
          <span className="flex-1 h-px bg-gray-800" aria-hidden="true" />
        </div>

        <form
          onSubmit={(e) => e.preventDefault()}
          className="space-y-3"
          aria-label="Email magic link form"
        >
          <label className="block">
            <span className="sr-only">Email address</span>
            <input
              type="email"
              placeholder="you@example.com"
              disabled
              aria-disabled="true"
              className="w-full bg-gray-950 border border-gray-800 rounded-lg px-4 py-3 text-base text-white placeholder:text-gray-500 focus:outline-none focus:border-violet-500 focus:shadow-[0_0_16px_rgba(167,139,250,0.25)] transition-all cursor-not-allowed"
            />
          </label>
          <button
            type="submit"
            disabled
            aria-disabled="true"
            title="Email magic link ships in Phase 7"
            className="w-full inline-flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-100 font-semibold rounded-lg px-4 py-3 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950 cursor-not-allowed opacity-90"
          >
            <span aria-hidden="true">✉</span>
            Continue with Email
          </button>
        </form>

        <p className="text-[11px] text-gray-500 leading-relaxed italic pt-2 border-t border-gray-800/60">
          We&rsquo;ll email you a one-time sign-in link — no password to remember.
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
