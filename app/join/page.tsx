import { WHOP_URL } from "../data/trackRecord";

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
    title: "Locked-in Pricing",
    blurb:
      "Current members keep $20/month even after The Lab launches.",
  },
];

type Cell = "yes" | "no" | "maybe";

type CompareCol = {
  name: string;
  price: string;
  highlight: boolean;
  rows: { label: string; value: Cell }[];
};

const COMPARISON: CompareCol[] = [
  {
    name: "Oddsphere AI",
    price: "$20/mo",
    highlight: true,
    rows: [
      { label: "Daily AI picks across NFL, NBA, MLB, CBB, CFB, UCL, NHL", value: "yes" },
      { label: "Lifetime tracked record", value: "yes" },
      { label: "The Lab access at launch", value: "yes" },
      { label: "AI model", value: "yes" },
    ],
  },
  {
    name: "Typical Picks Discord",
    price: "$50–200/mo",
    highlight: false,
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
    highlight: false,
    rows: [
      { label: "Daily picks", value: "no" },
      { label: "Multi-sport coverage", value: "yes" },
      { label: "Tracked record", value: "yes" },
      { label: "Research tools", value: "yes" },
      { label: "AI model", value: "no" },
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
  description:
    "Unlock daily AI sports predictions and first access to The Lab. One Whop subscription. $20/mo, locked in.",
};

export default function JoinPage() {
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
        <p className="text-lg text-gray-300 max-w-2xl mx-auto mb-6">
          Daily AI sports predictions in Discord — plus first access to The Lab — all bundled into a single Whop membership.
        </p>
        <div className="inline-block bg-gradient-to-r from-violet-900/60 to-fuchsia-900/40 border border-violet-700/50 rounded-lg px-6 py-4">
          <p className="text-2xl sm:text-3xl font-bold text-white">
            $20
            <span className="text-base font-medium text-gray-400">/month</span>
          </p>
          <p className="text-xs text-violet-300 mt-1 font-semibold uppercase tracking-wider">
            Locked in for existing members when The Lab launches
          </p>
        </div>
      </header>

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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
          {COMPARISON.map((col) => (
            <div
              key={col.name}
              className={`rounded-lg p-6 flex flex-col ${
                col.highlight
                  ? "bg-gradient-to-br from-violet-900/60 to-fuchsia-900/30 border border-violet-600"
                  : "bg-gray-900 border border-gray-800"
              }`}
            >
              <h3 className="text-xl font-bold mb-1">{col.name}</h3>
              <p
                className={`text-2xl font-bold mb-5 tabular-nums ${
                  col.highlight ? "text-violet-300" : "text-gray-300"
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
      </section>

      {/* Trust signals */}
      <section className="text-center space-y-1">
        <p className="text-violet-300 font-semibold">Join 20+ active members.</p>
        <p className="text-sm text-gray-500">Cancel anytime.</p>
      </section>

      {/* Final CTA */}
      <section className="bg-gradient-to-br from-violet-900/60 to-fuchsia-900/30 border border-violet-700/50 rounded-xl p-8 sm:p-12 text-center">
        <h2 className="text-3xl sm:text-4xl font-bold mb-3">
          Ready to join the edge?
        </h2>
        <p className="text-gray-300 mb-8 max-w-xl mx-auto">
          Subscribe via Whop and you're in — Discord access today, The Lab the moment it launches.
        </p>
        <a
          href={WHOP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-violet-600 hover:bg-violet-500 text-white text-lg font-semibold px-10 py-4 rounded-md transition-colors shadow-lg shadow-violet-900/50"
        >
          Join Now on Whop →
        </a>
        <p className="text-xs text-gray-500 italic mt-6">
          For entertainment and informational purposes only.
        </p>
      </section>
    </main>
  );
}
