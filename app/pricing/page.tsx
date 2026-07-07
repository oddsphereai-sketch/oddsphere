import Link from "next/link";

import {
  TRIAL_CHECKOUT_URL,
  TRIAL_DISCLOSURE_WITH_BILLING,
} from "@/lib/marketing/trialOffer";

export const metadata = {
  title: "Pricing — Start with 7 Days Free | OddSphere AI",
  description:
    "Start a 7-day free trial of OddSphere Daily Edge. Then $25/month for sports model projections, market reads, Play Grades, and transparent tracking.",
  alternates: { canonical: "/pricing" },
};

const FEATURES: string[] = [
  "Daily Edge dashboard",
  "Model projections",
  "Market reads",
  "Play Grades",
  "Supporting Evidence",
  "Transparent tracking",
  "Active and seasonal sport coverage as supported",
];

export default function PricingPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
      <header className="text-center mb-10 sm:mb-12">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-300 mb-3">
          OddSphere Daily Edge
        </p>
        <h1 className="text-4xl sm:text-5xl font-black tracking-tight mb-3">
          Start with 7 Days Free
        </h1>
        <p className="text-base sm:text-lg text-gray-300 max-w-xl mx-auto leading-relaxed">
          Get full Daily Edge access today. If you stay, your membership
          continues at $25/month.
        </p>
      </header>

      <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-violet-700/40 rounded-2xl p-6 sm:p-10 shadow-[0_0_40px_rgba(167,139,250,0.18)]">
        <div className="text-center mb-8 pb-6 border-b border-gray-800/60">
          <p className="text-[10px] uppercase tracking-[0.16em] text-violet-300 font-bold mb-2">
            7-Day Free Trial
          </p>
          <p className="text-5xl sm:text-6xl font-black tabular-nums leading-none mb-3">
            Free
          </p>
          <p className="text-base text-emerald-300 font-semibold">
            Then $25/month
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

        <PricingCta />
        <p className="text-xs text-gray-500 text-center mt-3 italic">
          {TRIAL_DISCLOSURE_WITH_BILLING}{" "}
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
  const cls =
    "block w-full text-center bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-lg px-6 py-4 text-base transition-all duration-200 shadow-lg shadow-violet-900/40 hover:shadow-[0_0_25px_rgba(167,139,250,0.5)] hover:scale-[1.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950";
  return (
    <a href={TRIAL_CHECKOUT_URL} className={cls} rel="noopener noreferrer" target="_blank">
      Start Free Trial
    </a>
  );
}
