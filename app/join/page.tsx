import {
  WHOP_URL,
  CHARTER_PRICE,
  STANDARD_PRICE,
  CHARTER_SPOTS_TOTAL,
  CHARTER_SPOTS_TAKEN,
  CHARTER_SPOTS_LEFT,
} from "../data/trackRecord";

const INCLUDED = [
  {
    title: "Daily AI Picks in Discord",
    blurb:
      "Model-driven predictions for the NFL, NBA, MLB, CBB, CFB, UCL, and NHL — delivered every day.",
  },
  {
    title: "Lifetime Track Record",
    blurb:
      "Fully transparent, publicly tracked tally for every market we cover.",
  },
  {
    title: "The Lab — at Launch",
    blurb:
      "Premium player props research suite. Included with your membership the moment it launches.",
  },
  {
    title: "Charter Pricing Locked In",
    blurb: `Your ${CHARTER_PRICE}/month rate stays the same forever — even after standard pricing rises to ${STANDARD_PRICE}.`,
  },
];

type Cell = "yes" | "no" | "maybe";

type CompareCol = {
  name: string;
  price: string;
  highlight?: boolean;
  future?: boolean;
  rows: { label: string; value: Cell }[];
};

const COMPARISON: CompareCol[] = [
  {
    name: "Oddsphere AI — Charter",
    price: `${CHARTER_PRICE}/mo`,
    highlight: true,
    rows: [
      { label: "Daily AI picks across NFL, NBA, MLB, CBB, CFB, UCL, NHL", value: "yes" },
      { label: "Lifetime tracked record", value: "yes" },
      { label: "The Lab access at launch", value: "yes" },
      { label: "Locked-in rate forever", value: "yes" },
    ],
  },
  {
    name: "Standard Oddsphere AI",
    price: `${STANDARD_PRICE}/mo`,
    future: true,
    rows: [
      { label: "Daily AI picks across NFL, NBA, MLB, CBB, CFB, UCL, NHL", value: "yes" },
      { label: "Lifetime tracked record", value: "yes" },
      { label: "The Lab access at launch", value: "yes" },
      { label: "Locked-in rate forever", value: "no" },
    ],
  },
  {
    name: "Typical Picks Discord",
    price: "$50–200/mo",
    rows: [
      { label: "Daily picks", value: "yes" },
      { label: "Multi-sport coverage", value: "maybe" },
      { label: "Tracked record", value: "no" },
      { label: "Research tools", value: "no" },
    ],
  },
  {
    name: "BettingPros",
    price: "$30–50/mo",
    rows: [
      { label: "Daily picks", value: "no" },
      { label: "Multi-sport coverage", value: "yes" },
      { label: "Tracked record", value: "yes" },
      { label: "AI predictions", value: "no" },
    ],
  },
];

function ValueIcon({ value }: { value: Cell }) {
  if (value === "yes") return <span className="text-violet-400">✅</span>;
  if (value === "no") return <span className="text-gray-600">❌</span>;
  return <span className="text-yellow-400">❓</span>;
}

export const metadata = {
  title: "Join Premium — Oddsphere AI",
  description: `Unlock daily AI sports predictions and first access to The Lab. ${CHARTER_PRICE}/month Charter pricing — locked in for life. Limited to the first ${CHARTER_SPOTS_TOTAL} members.`,
};

export default function JoinPage() {
  const progressPct = Math.round((CHARTER_SPOTS_TAKEN / CHARTER_SPOTS_TOTAL) * 100);

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 space-y-16">
      {/* Hero */}
      <header className="text-center">
        <p className="text-xs font-bold uppercase tracking-wider text-violet-400 mb-3">
          Join Oddsphere AI
        </p>
        <h1 className="text-4xl sm:text-5xl font-bold mb-4">
          One subscription. Every edge.
        </h1>
        <p className="text-lg text-gray-300 max-w-2xl mx-auto">
          Daily AI sports predictions in Discord — plus first access to The Lab — all bundled into a single Whop membership.
        </p>
      </header>

      {/* Charter pricing hero */}
      <section className="bg-gradient-to-br from-violet-900/60 via-purple-900/40 to-fuchsia-900/30 border border-violet-600/60 rounded-2xl p-8 sm:p-12 text-center">
        <p className="text-xs font-bold uppercase tracking-wider text-violet-300 mb-3">
          Charter Member Pricing
        </p>
        <h2 className="text-5xl sm:text-6xl font-bold mb-3">
          <span className="text-white">{CHARTER_PRICE}</span>
          <span className="text-2xl sm:text-3xl text-gray-300 font-medium">/month</span>
        </h2>
        <p className="text-lg text-gray-200 mb-8">
          Locked in for life. Limited to the first {CHARTER_SPOTS_TOTAL} members.
        </p>

        {/* Scarcity progress bar */}
        <div className="max-w-md mx-auto mb-3">
          <div
            className="bg-gray-900/70 border border-violet-700/40 rounded-full h-3 overflow-hidden"
            role="progressbar"
            aria-valuenow={CHARTER_SPOTS_TAKEN}
            aria-valuemin={0}
            aria-valuemax={CHARTER_SPOTS_TOTAL}
          >
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
        <p className="text-violet-200 font-bold mb-6">
          {CHARTER_SPOTS_TAKEN} of {CHARTER_SPOTS_TOTAL} charter spots taken — {CHARTER_SPOTS_LEFT} left at this rate
        </p>

        <a
          href={WHOP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-violet-600 hover:bg-violet-500 text-white text-lg font-semibold px-10 py-4 rounded-md transition-colors shadow-lg shadow-violet-900/50"
        >
          Claim Your Charter Spot →
        </a>

        <p className="text-xs text-gray-400 mt-6 max-w-xl mx-auto leading-relaxed">
          After {CHARTER_SPOTS_TOTAL} charter members, pricing increases to {STANDARD_PRICE}/month. Your Charter rate stays locked forever.
        </p>
      </section>

      {/* What's Included */}
      <section>
        <h2 className="text-2xl sm:text-3xl font-bold mb-6 text-center">
          What's Included
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {INCLUDED.map((item) => (
            <div
              key={item.title}
              className="bg-gray-900 border border-gray-800 rounded-lg p-5 flex gap-3"
            >
              <span className="text-violet-400 text-xl shrink-0">✅</span>
              <div>
                <h3 className="font-semibold mb-1">{item.title}</h3>
                <p className="text-sm text-gray-400">{item.blurb}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Compare */}
      <section>
        <h2 className="text-2xl sm:text-3xl font-bold mb-3 text-center">
          Compare for yourself.
        </h2>
        <p className="text-gray-400 text-center mb-8">
          We're cheaper. We're more transparent. We're more useful.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {COMPARISON.map((col) => (
            <div
              key={col.name}
              className={`rounded-lg p-6 flex flex-col ${
                col.highlight
                  ? "bg-gradient-to-br from-violet-900/60 to-fuchsia-900/30 border border-violet-600"
                  : col.future
                  ? "bg-gray-900/50 border border-gray-800"
                  : "bg-gray-900 border border-gray-800"
              }`}
            >
              <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                <h3 className="text-xl font-bold">{col.name}</h3>
                {col.highlight && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-violet-300 bg-violet-900/60 px-2 py-0.5 rounded">
                    Current
                  </span>
                )}
                {col.future && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
                    Future
                  </span>
                )}
              </div>
              <p
                className={`text-2xl font-bold mb-5 tabular-nums ${
                  col.highlight
                    ? "text-violet-300"
                    : col.future
                    ? "text-gray-500"
                    : "text-gray-300"
                }`}
              >
                {col.price}
              </p>
              <ul className="space-y-3 text-sm flex-1">
                {col.rows.map((r) => (
                  <li key={r.label} className="flex gap-2 items-start">
                    <ValueIcon value={r.value} />
                    <span className="text-gray-300">{r.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-center mt-8 text-lg font-semibold text-violet-300">
          Same edge. Half the price. Forever.
        </p>
      </section>

      {/* Trust signals */}
      <section className="text-center space-y-1">
        <p className="text-violet-300 font-semibold">
          Join {CHARTER_SPOTS_TAKEN} active members.
        </p>
        <p className="text-sm text-gray-500">Cancel anytime.</p>
      </section>

      {/* Final CTA */}
      <section className="bg-gradient-to-br from-violet-900/60 to-fuchsia-900/30 border border-violet-700/50 rounded-xl p-8 sm:p-12 text-center">
        <h2 className="text-3xl sm:text-4xl font-bold mb-3">
          Ready to join the edge?
        </h2>
        <p className="text-gray-300 mb-2 max-w-xl mx-auto">
          {CHARTER_PRICE}/month Charter pricing — first {CHARTER_SPOTS_TOTAL} members only.
        </p>
        <p className="text-violet-300 mb-8 font-semibold">
          {CHARTER_SPOTS_LEFT} charter spots left.
        </p>
        <a
          href={WHOP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-violet-600 hover:bg-violet-500 text-white text-lg font-semibold px-10 py-4 rounded-md transition-colors shadow-lg shadow-violet-900/50"
        >
          Claim Your Charter Spot →
        </a>
        <p className="text-xs text-gray-500 italic mt-6">
          For entertainment and informational purposes only.
        </p>
      </section>
    </main>
  );
}
