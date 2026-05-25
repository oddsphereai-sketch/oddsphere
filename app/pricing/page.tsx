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

export const metadata = {
  title: "Pricing — OddSphere Premium",
  description:
    "OddSphere Premium · $25/month locked for life. One membership unlocks daily AI picks, player props research, sharp signals, transparent tracking, and Discord.",
};

const FEATURES: string[] = [
  "Daily Edge — model picks across all 7 leagues with sharp-market context",
  "Player Props Lab — ranked edges with drill-down breakdown",
  "Sharp Signals — market moves, line history, steam alerts",
  "Transparent tracking — every pick logged before games start",
  "Confidence calibration — see how honest our confidence actually is",
  "Discord access — daily alerts + community",
  "Locked-in $25/month — your rate never changes",
];

export default function PricingPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
      <header className="text-center mb-10 sm:mb-12">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-300 mb-3">
          OddSphere Premium
        </p>
        <h1 className="text-4xl sm:text-5xl font-black tracking-tight mb-3">
          One membership unlocks everything.
        </h1>
        <p className="text-base sm:text-lg text-gray-300 max-w-xl mx-auto leading-relaxed">
          Daily model picks. Player prop research. Honest tracking. One price,
          locked in for as long as you stay subscribed.
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
            Locked for life. Your rate never changes.
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

        <Link
          href="/login"
          className="block w-full text-center bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-lg px-6 py-4 text-base transition-all duration-200 shadow-lg shadow-violet-900/40 hover:shadow-[0_0_25px_rgba(167,139,250,0.5)] hover:scale-[1.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
        >
          Join through Whop →
        </Link>
        <p className="text-xs text-gray-500 text-center mt-3 italic">
          Whop handles checkout and Discord access. Cancel anytime through
          your Whop account.
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
