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
    title: "Premium Website Access",
    blurb:
      "When the premium site launches, your Whop login unlocks it instantly — no extra subscription.",
  },
  {
    title: "Upcoming Research Suite",
    blurb:
      "Player props streaks, team trends, ML/totals research — included the moment they ship.",
  },
];

export const metadata = {
  title: "Join Premium — Oddsphere AI",
  description:
    "Unlock daily AI sports predictions and the upcoming premium Oddsphere AI website. One Whop subscription, everything included.",
};

export default function JoinPage() {
  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <header className="text-center mb-12">
        <p className="text-xs font-bold uppercase tracking-wider text-violet-400 mb-3">
          Join Oddsphere AI
        </p>
        <h1 className="text-4xl sm:text-5xl font-bold mb-4">
          One subscription. Every edge.
        </h1>
        <p className="text-lg text-gray-300 max-w-2xl mx-auto">
          Daily AI sports predictions in Discord — plus the upcoming premium research website — all bundled into a single Whop membership.
        </p>
      </header>

      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-6 text-center">What's Included</h2>
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

      <section className="bg-gradient-to-br from-violet-900/60 to-fuchsia-900/30 border border-violet-700/50 rounded-xl p-8 sm:p-12 text-center">
        <h2 className="text-3xl sm:text-4xl font-bold mb-3">
          Ready to join the edge?
        </h2>
        <p className="text-gray-300 mb-8 max-w-xl mx-auto">
          Subscribe via Whop and you're in — Discord access today, premium site access the moment it launches.
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
