import {
  WHOP_URL,
  CHARTER_PRICE,
  STANDARD_PRICE,
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
      { label: "Public lifetime tracked record", value: "yes" },
      { label: "The Lab access at launch", value: "yes" },
      { label: "Locked-in rate forever", value: "yes" },
      { label: "One subscription = Discord + premium website", value: "yes" },
    ],
  },
  {
    name: "Standard Oddsphere AI",
    price: `${STANDARD_PRICE}/mo`,
    future: true,
    rows: [
      { label: "Daily AI picks across NFL, NBA, MLB, CBB, CFB, UCL, NHL", value: "yes" },
      { label: "Public lifetime tracked record", value: "yes" },
      { label: "The Lab access at launch", value: "yes" },
      { label: "Locked-in rate forever", value: "no" },
      { label: "One subscription = Discord + premium website", value: "yes" },
    ],
  },
  {
    name: "Typical Picks Discord",
    price: "$50–200/mo",
    rows: [
      { label: "Daily picks", value: "yes" },
      { label: "Multi-sport coverage", value: "maybe" },
      { label: "Public lifetime tracked record", value: "no" },
      { label: "Research tools", value: "no" },
      { label: "AI model predictions", value: "no" },
    ],
  },
];

function ValueIcon({ value }: { value: Cell }) {
  if (value === "yes") return <span className="text-violet-400">✅</span>;
  if (value === "no") return <span className="text-gray-400">❌</span>;
  return <span className="text-yellow-400">❓</span>;
}

export const metadata = {
  title: "Join Premium — Oddsphere AI",
  description: `Unlock daily AI sports predictions and first access to The Lab. ${CHARTER_PRICE}/month Charter pricing — locked in for life. Limited to the first 50 members.`,
};

export default function JoinPage() {
  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 space-y-20 sm:space-y-28">
      {/* Hero */}
      <header className="text-center">
        <p className="text-xs font-bold uppercase tracking-wider text-violet-300 mb-4">
          Join Oddsphere AI
        </p>
        <div className="relative isolate inline-block">
          <div className="hero-glow"></div>
          <h1 className="relative text-4xl sm:text-6xl md:text-7xl font-black mb-6 leading-[1.05] tracking-tight">
            One subscription. Every edge.
          </h1>
        </div>
        <p className="text-lg sm:text-xl text-gray-200 max-w-2xl mx-auto">
          Daily AI sports predictions in Discord — plus first access to The Lab — all bundled into a single Whop membership.
        </p>
      </header>

      {/* Charter pricing hero */}
      <section className="bg-gradient-to-br from-violet-900/60 via-purple-900/40 to-fuchsia-900/30 border border-violet-600/60 rounded-2xl p-8 sm:p-14 text-center transition-all duration-300 hover:border-violet-500 hover:shadow-[0_0_40px_rgba(167,139,250,0.3)]">
        <p className="text-xs font-bold uppercase tracking-wider text-violet-200 mb-3">
          Charter Member Pricing
        </p>
        <h2 className="text-6xl sm:text-7xl font-black mb-4 tracking-tight">
          <span className="text-white">{CHARTER_PRICE}</span>
          <span className="text-2xl sm:text-3xl text-gray-200 font-medium">/month</span>
        </h2>
        <p className="text-lg sm:text-xl text-gray-100 mb-8">
          Locked in for life. Limited to the first 50 members.
        </p>

        {/* Urgency line (was progress bar) */}
        <p className="text-lg text-violet-100 font-bold mb-8 drop-shadow-[0_0_8px_rgba(167,139,250,0.4)]">
          Charter pricing — limited to the first 50 members.
        </p>

        <a
          href={WHOP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-violet-600 hover:bg-violet-500 text-white text-lg font-semibold px-10 py-4 rounded-md transition-all duration-200 shadow-lg shadow-violet-900/50 hover:shadow-[0_0_30px_rgba(167,139,250,0.55)] hover:scale-[1.02]"
        >
          Claim Your Charter Spot →
        </a>

        <p className="text-xs text-gray-300 mt-6 max-w-xl mx-auto leading-relaxed">
          After 50 members, pricing increases to $35/month. Your Charter rate stays locked forever.
        </p>
      </section>

      {/* What's Included */}
      <section>
        <h2 className="text-2xl sm:text-4xl font-black mb-8 text-center tracking-tight">
          What's Included
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {INCLUDED.map((item) => (
            <div
              key={item.title}
              className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-lg p-5 flex gap-3 transition-all duration-300 hover:border-violet-500/50 hover:shadow-[0_0_30px_rgba(167,139,250,0.15)]"
            >
              <span className="text-violet-400 text-xl shrink-0">✅</span>
              <div>
                <h3 className="font-semibold mb-1">{item.title}</h3>
                <p className="text-sm text-gray-100">{item.blurb}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Compare */}
      <section>
        <h2 className="text-2xl sm:text-4xl font-black mb-3 text-center tracking-tight">
          Compare for yourself.
        </h2>
        <p className="text-lg text-gray-200 text-center mb-10">
          We're cheaper. We're more transparent. We're more useful.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
          {COMPARISON.map((col) => (
            <div
              key={col.name}
              className={`rounded-lg p-6 flex flex-col transition-all duration-300 hover:shadow-[0_0_30px_rgba(167,139,250,0.15)] ${
                col.highlight
                  ? "bg-gradient-to-br from-violet-900/60 to-fuchsia-900/30 border border-violet-600 hover:border-violet-500"
                  : "bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 hover:border-violet-500/50"
              }`}
            >
              <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                <h3 className="text-xl font-bold">{col.name}</h3>
                {col.highlight && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-violet-200 bg-violet-900/60 px-2 py-0.5 rounded">
                    Current
                  </span>
                )}
                {col.future && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-300 bg-gray-800 px-2 py-0.5 rounded">
                    Future
                  </span>
                )}
              </div>
              <p
                className={`text-2xl font-black mb-5 tabular-nums ${
                  col.highlight
                    ? "text-violet-200"
                    : col.future
                    ? "text-gray-300"
                    : "text-gray-100"
                }`}
              >
                {col.price}
              </p>
              <ul className="space-y-3 text-sm flex-1">
                {col.rows.map((r) => (
                  <li key={r.label} className="flex gap-2 items-start">
                    <ValueIcon value={r.value} />
                    <span className="text-gray-100">{r.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-center mt-10 text-lg font-semibold text-violet-300">
          Same edge. Half the price. Forever.
        </p>
      </section>

      {/* Trust signal */}
      <section className="text-center">
        <p className="text-sm text-gray-300">Cancel anytime.</p>
      </section>

      {/* Final CTA */}
      <section className="bg-gradient-to-br from-violet-900/60 to-fuchsia-900/30 border border-violet-700/50 rounded-2xl p-8 sm:p-14 text-center transition-all duration-300 hover:border-violet-500 hover:shadow-[0_0_40px_rgba(167,139,250,0.3)]">
        <h2 className="text-3xl sm:text-4xl md:text-5xl font-black mb-4 tracking-tight">
          Ready to join the edge?
        </h2>
        <p className="text-lg text-gray-200 mb-3 max-w-xl mx-auto">
          {CHARTER_PRICE}/month Charter pricing — first 50 members only.
        </p>
        <p className="text-violet-300 mb-10 font-semibold">
          Charter pricing — first 50 members only.
        </p>
        <a
          href={WHOP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-violet-600 hover:bg-violet-500 text-white text-lg font-semibold px-10 py-4 rounded-md transition-all duration-200 shadow-lg shadow-violet-900/50 hover:shadow-[0_0_30px_rgba(167,139,250,0.55)] hover:scale-[1.02]"
        >
          Claim Your Charter Spot →
        </a>
        <p className="text-xs text-gray-400 italic mt-8">
          For entertainment and informational purposes only. Gamble responsibly, 21+.
        </p>
      </section>
    </main>
  );
}
