import Link from "next/link";
import type { Metadata } from "next";

import {
  ANNUAL_BILLING_DISCLOSURE,
  ANNUAL_CHECKOUT_URL,
  ANNUAL_PRICE,
  MONTHLY_CHECKOUT_URL,
  MONTHLY_PRICE,
  MONTHLY_TRIAL_DISCLOSURE,
} from "@/lib/marketing/trialOffer";

export const metadata: Metadata = {
  title: "Pricing — $19.99 Monthly or $199 Yearly | OddSphere AI",
  description:
    "Choose OddSphere Daily Edge for $19.99 monthly after a 7-day free trial, or $199 yearly billed immediately.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    type: "website",
    url: "/pricing",
    title: "Pricing — $19.99 Monthly or $199 Yearly | OddSphere AI",
    description:
      "Daily Edge includes model projections, market reads, Play Grades, supporting evidence, transparent tracking, and responsible-use context.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "OddSphere AI pricing and Daily Edge preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@OddSphereAI",
    title: "Pricing — $19.99 Monthly or $199 Yearly | OddSphere AI",
    description:
      "Try monthly free for 7 days, then $19.99/month, or choose $199 yearly billed immediately.",
    images: ["/og-image.png"],
  },
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

const PRICING_PLANS = [
  {
    id: "monthly",
    title: "Monthly",
    price: MONTHLY_PRICE,
    cadence: "/month",
    checkoutUrl: MONTHLY_CHECKOUT_URL,
    disclosure: MONTHLY_TRIAL_DISCLOSURE,
    badge: "7-day free trial",
    detail: "Full access with a lower upfront commitment.",
    cta: "Start 7-Day Free Trial",
    featured: false,
  },
  {
    id: "annual",
    title: "Yearly",
    price: ANNUAL_PRICE,
    cadence: "/year",
    checkoutUrl: ANNUAL_CHECKOUT_URL,
    disclosure: ANNUAL_BILLING_DISCLOSURE,
    badge: "Best value · Save $40.88",
    detail: "Equivalent to $16.58/month, billed once yearly.",
    cta: "Choose Yearly",
    featured: true,
  },
] as const;

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <header className="text-center mb-10 sm:mb-12">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-300 mb-3">
          OddSphere Daily Edge
        </p>
        <h1 className="text-4xl sm:text-5xl font-black tracking-tight mb-3">
          Simple pricing
        </h1>
        <p className="text-base sm:text-lg text-gray-300 max-w-xl mx-auto leading-relaxed">
          Try monthly free for seven days or save with a yearly membership.
          Both plans include the same full Daily Edge access.
        </p>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        {PRICING_PLANS.map((plan) => (
          <PricingCard key={plan.id} plan={plan} />
        ))}
      </div>

      <div className="mt-6 grid gap-6 rounded-2xl border border-gray-800 bg-gray-950/70 p-6 sm:grid-cols-[1.15fr_0.85fr] sm:p-8">
        <div>
          <h2 className="text-xl font-black text-white">Included with either plan</h2>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-3 text-sm text-gray-100">
                <span aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-400">✓</span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-4 text-sm leading-relaxed text-amber-50">
          <p className="font-bold text-amber-100">What this membership is and is not</p>
          <p className="mt-2 text-amber-50/85">
            Daily Edge is an informational sports analytics dashboard. OddSphere is not a
            sportsbook, does not accept wagers, does not place bets, and does not guarantee
            outcomes or profits.
          </p>
        </div>
      </div>

      <p className="mx-auto mt-6 max-w-2xl text-center text-xs leading-relaxed text-gray-500 italic">
        Billing is handled through Whop. Subscriptions renew automatically at the selected
        cadence until canceled. See the{" "}
        <Link href="/legal/refund-cancellation" className="text-violet-300 underline underline-offset-2 hover:text-violet-200">
          refund &amp; cancellation policy
        </Link>
        .
      </p>

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

function PricingCard({ plan }: { plan: (typeof PRICING_PLANS)[number] }) {
  return (
    <section className={`relative rounded-2xl border bg-gradient-to-br from-gray-900 to-gray-950 p-6 sm:p-8 ${plan.featured ? "border-violet-500/60 shadow-[0_0_40px_rgba(167,139,250,0.18)]" : "border-gray-800"}`}>
      <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${plan.featured ? "text-violet-300" : "text-gray-400"}`}>{plan.badge}</p>
      <h2 className="mt-3 text-2xl font-black text-white">{plan.title}</h2>
      <div className="mt-5 flex items-end gap-2">
        <span className="text-5xl font-black tabular-nums leading-none text-white">{plan.price}</span>
        <span className="pb-1 text-sm font-semibold text-gray-400">{plan.cadence}</span>
      </div>
      <p className="mt-3 min-h-10 text-sm leading-relaxed text-gray-300">{plan.detail}</p>
      <a
        href={plan.checkoutUrl}
        className={`mt-6 block w-full rounded-lg px-6 py-4 text-center text-base font-bold text-white transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950 ${plan.featured ? "bg-violet-600 shadow-lg shadow-violet-900/40 hover:scale-[1.01] hover:bg-violet-500 hover:shadow-[0_0_25px_rgba(167,139,250,0.5)] focus-visible:ring-violet-400" : "bg-gray-800 hover:bg-gray-700 focus-visible:ring-gray-400"}`}
        rel="noopener noreferrer"
        target="_blank"
      >
        {plan.cta}
      </a>
      <p className="mt-3 text-center text-xs leading-relaxed text-gray-500">{plan.disclosure}</p>
    </section>
  );
}
