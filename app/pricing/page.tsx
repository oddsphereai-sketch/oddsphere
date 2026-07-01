/**
 * /pricing — single-card pricing page (Phase 6.2b, V2.1 spec Part 11).
 *
 * One plan: $25/month locked for life. Checkout actually happens through
 * Whop (Phase 7 wires the real link); for now the CTA placeholder routes
 * to /login so the flow is testable end-to-end without a live Whop URL.
 *
 * Disclaimer copy matches V2.1: members understand Whop manages the
 * subscription + Discord access — OddSphere only unlocks the Lab.
 */

import Link from "next/link";

import { getCheckoutUrl } from "@/lib/auth/whopConfig";

export const metadata = {
  title: "Pricing — OddSphere AI Premium",
  description:
    "OddSphere AI Premium is $25/month for sports model dashboards, Daily Edge market analysis, tracking, and member access.",
  alternates: { canonical: "/pricing" },
};

const FEATURES: string[] = [
  "Daily Edge — model projections, Play Grades, Market Read, and Supporting Evidence",
  "Market movement context — opening, previous, and current price movement where available",
  "Consensus and Sharp Book context where each sport and market supports it",
  "Transparent tracking — results logged and displayed without outcome guarantees",
  "Multi-sport dashboard — MLB, WNBA, World Cup/Soccer, NBA, and NHL surfaces as active",
  "Member access through Whop",
  "$25/month charter pricing while available",
];

export default function PricingPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
      <header className="text-center mb-10 sm:mb-12">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-300 mb-3">
          OddSphere Premium
        </p>
        <h1 className="text-4xl sm:text-5xl font-black tracking-tight mb-3">
          One membership includes the Daily Edge dashboard.
        </h1>
        <p className="text-base sm:text-lg text-gray-300 max-w-xl mx-auto leading-relaxed">
          Daily Edge model dashboards, market context, and tracked results. One
          transparent monthly subscription.
        </p>
      </header>

      <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-violet-700/40 rounded-2xl p-6 sm:p-10 shadow-[0_0_40px_rgba(167,139,250,0.18)]">
        <div className="text-center mb-8 pb-6 border-b border-gray-800/60">
          <p className="text-[10px] uppercase tracking-[0.16em] text-violet-300 font-bold mb-2">
            Charter pricing
          </p>
          <p className="text-5xl sm:text-6xl font-black tabular-nums leading-none mb-2">
            $25
            <span className="text-2xl sm:text-3xl text-gray-400 font-bold">
              {" "}/ month
            </span>
          </p>
          <p className="text-sm text-emerald-300 font-semibold">
            Charter pricing while available.
          </p>
        </div>

        <ul className="space-y-3 mb-8">
          {FEATURES.map((feature) => (
            <li key={feature} className="flex items-start gap-3 text-sm text-gray-100">
              <span aria-hidden="true" className="shrink-0 text-emerald-400 mt-0.5">
                ✓
              </span>
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        {/*
          Phase 6B.3a: CTA routes to the configured WHOP_CHECKOUT_URL
          when Whop is wired. Falls back to /login as a placeholder
          when the env var is missing — never fakes a Whop link.
        */}
        <PricingCta />
        <p className="text-xs text-gray-500 text-center mt-3 italic">
          Whop handles checkout and Discord access. Cancel anytime through
          your Whop account.{" "}
          <Link href="/legal/refund-cancellation" className="text-violet-300 hover:text-violet-200 underline underline-offset-2">
            Refund &amp; cancellation policy
          </Link>
          .
        </p>
      </div>

      <p className="text-center text-xs text-gray-400 mt-8 max-w-md mx-auto leading-relaxed">
        OddSphere provides sports research and model projections — not betting
        advice. 21+. Gambling involves risk. Need help?{" "}
        <a href="tel:1-800-426-2537" className="text-violet-300 hover:text-violet-200">
          1-800-GAMBLER
        </a>
        .
      </p>
    </main>
  );
}

function PricingCta() {
  const checkoutUrl = getCheckoutUrl();
  const cls =
    "block w-full text-center bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-lg px-6 py-4 text-base transition-all duration-200 shadow-lg shadow-violet-900/40 hover:shadow-[0_0_25px_rgba(167,139,250,0.5)] hover:scale-[1.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950";
  if (checkoutUrl !== null) {
    return (
      <a href={checkoutUrl} className={cls} rel="noopener noreferrer" target="_blank">
        Join through Whop →
      </a>
    );
  }
  // No checkout URL configured — route to /login, which itself
  // surfaces either the Whop button or beta access. Never fabricates
  // a Whop URL.
  return (
    <Link href="/login" className={cls}>
      Continue to Sign In →
    </Link>
  );
}
