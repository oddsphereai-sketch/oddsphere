/**
 * / — Home / marketing landing (Phase 6.2b, V2.1 spec Part 11).
 *
 * Nine sections per spec:
 *   a. Hero with CTAs
 *   b. Problem statement
 *   c. What You Get (4 cards)
 *   d. How It Works (Model Pick → Market Context → Signal Label → Tracked Result)
 *   e. Signal Language Preview (5 example signals)
 *   f. Track Record Preview (top 3-5 markets, real data)
 *   g. Pricing CTA card
 *   h. FAQ (6 questions, collapsible)
 *   i. Responsible footer (Global Footer lands in 6.2c — for now layout.tsx footer)
 *
 * Voice (locked): premium handicapping, never capper. No "LOCK"/"HAMMER"/
 * "GUARANTEED" / multiple fire-emoji explosions / picks-as-promises framing.
 */

import Link from "next/link";
import { TRACK_RECORD, type TrackRecordRow } from "./data/trackRecord";

export const metadata = {
  title: "OddSphere AI — AI Sports Picks Built for Clarity",
  description:
    "OddSphere turns model projections, market movement, and betting context into clear daily signals. Daily picks, player props research, sharp signals, and tracked results across 7 leagues.",
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function pct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

function fmtCompact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString();
}

function aggregateLifetime(rows: TrackRecordRow[]) {
  const wins = rows.reduce((s, r) => s + r.lifetimeWins, 0);
  const total = rows.reduce((s, r) => s + r.lifetimeTotal, 0);
  return { wins, total, hitRate: total > 0 ? (wins / total) * 100 : 0 };
}

function topMarkets(rows: TrackRecordRow[], n: number): TrackRecordRow[] {
  return [...rows]
    .filter((r) => r.lifetimeTotal >= 100)
    .sort((a, b) => b.lifetimePercent - a.lifetimePercent)
    .slice(0, n);
}

// ─── Content blocks ───────────────────────────────────────────────────────

const WHAT_YOU_GET = [
  {
    icon: "🎯",
    title: "Daily Edge",
    body: "Tonight&rsquo;s board across every game, ranked by signal strength. See which picks the model + sharps agree on, which are model-only, and which to skip.",
  },
  {
    icon: "🎮",
    title: "Player Props Lab",
    body: "Ranked prop edges with a drill-down for every line — projection, edge%, supporting signals, and a Risk Check that names the catches before you bet.",
  },
  {
    icon: "🦈",
    title: "Sharp Signals",
    body: "Steam moves, reverse line movement, Pinnacle fair-line agreement, and public-vs-sharp money divergence — surfaced where it matters, hidden where it doesn&rsquo;t.",
  },
  {
    icon: "📈",
    title: "Tracked Results",
    body: "Every pick logged before games start, graded against final scores. Honest calibration: when we say 60%, we show you what we actually hit.",
  },
];

const HOW_IT_WORKS = [
  {
    n: 1,
    label: "Model Pick",
    body: "Our model produces a projection + confidence for each game and prop line.",
  },
  {
    n: 2,
    label: "Market Context",
    body: "We layer sharp-money signals, line movement, and public action on top.",
  },
  {
    n: 3,
    label: "Signal Label",
    body: "One of 7 grades: Best Signal, Sharp Confirmed, Market-Led, Model Only, Market Watch, Public Smoke, or Sharp Conflict.",
  },
  {
    n: 4,
    label: "Tracked Result",
    body: "Pick is logged, the game plays out, the result hits Tracking the next morning.",
  },
];

const SIGNAL_PREVIEW: Array<{ emoji: string; label: string; body: string; color: string }> = [
  {
    emoji: "🔥",
    label: "Best Signal",
    body: "Model + sharps agree on the pick.",
    color: "text-emerald-300 border-emerald-700/40 bg-emerald-950/30",
  },
  {
    emoji: "✅",
    label: "Sharp Confirmed",
    body: "Market supports the model pick.",
    color: "text-emerald-300 border-emerald-700/40 bg-emerald-950/30",
  },
  {
    emoji: "⚡",
    label: "Market-Led",
    body: "Sharp money is driving this read, even though model edge is light.",
    color: "text-sky-300 border-sky-700/40 bg-sky-950/30",
  },
  {
    emoji: "📊",
    label: "Model Only",
    body: "Strong model edge with no major market signal.",
    color: "text-gray-300 border-gray-700/50 bg-gray-900/60",
  },
  {
    emoji: "⚠️",
    label: "Sharp Conflict",
    body: "Market is moving against the model — proceed with caution.",
    color: "text-amber-300 border-amber-700/40 bg-amber-950/30",
  },
];

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "What exactly do I get for $25/month?",
    a: "Daily model picks across NFL, CFB, NBA, CBB, MLB, NHL, and UCL. The Player Props Lab with edge rankings and drill-down. Sharp signal analysis. Honest tracking with calibration. Discord access included.",
  },
  {
    q: "How is this different from a typical picks Discord?",
    a: "We publish the math, the line, the confidence, and the result — before and after the game. No \"hammer this\" hype. You see exactly how often our 60% confidence picks actually hit.",
  },
  {
    q: "Is this betting advice?",
    a: "No. We provide model projections and market context as research. You decide what to bet, how much, and whether to bet at all. Hit rate doesn&rsquo;t equal profit — odds, line shopping, and bankroll matter.",
  },
  {
    q: "What sports are covered at launch?",
    a: "MLB is fully live in The Lab. NBA, NFL, NHL, CBB, CFB, and UCL show in tracking but Lab functionality rolls in as each season starts. Discord covers all 7 leagues year-round.",
  },
  {
    q: "What if I want to cancel?",
    a: "Subscriptions are managed through Whop — cancel anytime in your Whop account. No questions, no retention calls.",
  },
  {
    q: "Why $25 locked for life?",
    a: "Charter pricing for our first members. The rate you sign up at is the rate you keep, as long as your subscription stays active. New tiers may launch later at higher prices; existing members are grandfathered.",
  },
];

// ─── Component ────────────────────────────────────────────────────────────

export default function HomePage() {
  const lifetime = aggregateLifetime(TRACK_RECORD);
  const top = topMarkets(TRACK_RECORD, 4);

  return (
    <main>
      {/* a) Hero */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 sm:pt-24 pb-16 text-center">
        <p className="inline-block text-xs font-bold uppercase tracking-[0.18em] text-violet-300 mb-4 border border-violet-700/40 bg-violet-950/30 rounded-full px-3 py-1">
          OddSphere Premium · $25/mo
        </p>
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tight mb-5 leading-[1.05]">
          AI sports picks <span className="text-violet-300">built for clarity.</span>
        </h1>
        <p className="text-lg sm:text-xl text-gray-200 max-w-2xl mx-auto leading-relaxed mb-8">
          Model projections, market movement, and betting context — turned into
          clear daily signals. Every pick tracked.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/pricing"
            className="inline-block bg-violet-600 hover:bg-violet-500 text-white font-bold px-8 py-3.5 rounded-lg transition-all duration-200 shadow-lg shadow-violet-900/40 hover:shadow-[0_0_25px_rgba(167,139,250,0.5)] hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
          >
            Join Premium → $25/mo
          </Link>
          <Link
            href="/track-record"
            className="inline-block bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-violet-500/40 text-gray-100 hover:text-white font-semibold px-8 py-3.5 rounded-lg transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
          >
            See the track record →
          </Link>
        </div>
        <p className="text-xs text-gray-400 mt-5 tabular-nums">
          {fmtCompact(lifetime.total)}+ picks tracked · {pct(lifetime.hitRate, 1)} lifetime hit rate
        </p>
      </section>

      {/* b) Problem */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-2xl p-8 sm:p-10 text-center">
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight mb-4">
            Most pick services don&rsquo;t show you the math.
          </h2>
          <p className="text-base sm:text-lg text-gray-200 leading-relaxed">
            You get hype, capper-speak, and emoji explosions — but rarely a clear
            answer to <em>why</em> a pick is the pick, what the model actually
            projected, and how often that grade has hit in the past.
            <br />
            <br />
            We do that differently.
          </p>
        </div>
      </section>

      {/* c) What You Get */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <header className="text-center mb-10">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-300 mb-2">
            What you get
          </p>
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight">
            Four tools. One membership.
          </h2>
        </header>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
          {WHAT_YOU_GET.map((feat) => (
            <div
              key={feat.title}
              className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-2xl p-6 sm:p-7 transition-all duration-200 hover:border-violet-500/40 hover:shadow-[0_0_24px_rgba(167,139,250,0.12)]"
            >
              <p className="text-3xl mb-3" aria-hidden="true">{feat.icon}</p>
              <h3 className="text-lg sm:text-xl font-bold mb-2 tracking-tight">
                {feat.title}
              </h3>
              <p
                className="text-sm sm:text-base text-gray-300 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: feat.body }}
              />
            </div>
          ))}
        </div>
      </section>

      {/* d) How It Works */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <header className="text-center mb-10">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-300 mb-2">
            How it works
          </p>
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight">
            Model + market → clear signal.
          </h2>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {HOW_IT_WORKS.map((step) => (
            <div
              key={step.n}
              className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-2xl p-5 sm:p-6 text-center"
            >
              <p className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-violet-600/20 border border-violet-500/40 text-violet-300 text-sm font-black tabular-nums mb-3">
                {step.n}
              </p>
              <p className="text-sm font-bold uppercase tracking-[0.1em] text-white mb-2">
                {step.label}
              </p>
              <p className="text-sm text-gray-300 leading-relaxed">
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* e) Signal Language Preview */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <header className="text-center mb-10">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-300 mb-2">
            Signal language
          </p>
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight">
            Plain English on every pick.
          </h2>
          <p className="text-sm text-gray-300 mt-3 max-w-xl mx-auto">
            Every card carries one of 7 grade badges. The label tells you what
            the model and the market agree (or disagree) on — no decoding required.
          </p>
        </header>
        <ul className="space-y-3">
          {SIGNAL_PREVIEW.map((sig) => (
            <li
              key={sig.label}
              className={`flex items-start gap-3 border rounded-xl px-4 py-3 ${sig.color}`}
            >
              <span aria-hidden="true" className="shrink-0 text-xl">
                {sig.emoji}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold uppercase tracking-wider">
                  {sig.label}
                </p>
                <p className="text-sm text-gray-200 mt-0.5">{sig.body}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-gray-400 text-center mt-4 italic">
          Two more grades live inside the Lab — Market Watch and Public Smoke.
        </p>
      </section>

      {/* f) Track Record Preview */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <header className="text-center mb-8">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-300 mb-2">
            Track record
          </p>
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight">
            {pct(lifetime.hitRate, 1)} lifetime · {fmtCompact(lifetime.total)}+ picks.
          </h2>
          <p className="text-sm text-gray-300 mt-3 max-w-xl mx-auto">
            Strongest performing markets across our model history. Every pick
            logged before games start.
          </p>
        </header>
        <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-2xl overflow-hidden mb-6">
          <ul className="divide-y divide-gray-800/60">
            {top.map((row) => (
              <li
                key={row.market}
                className="flex items-center gap-4 px-5 py-4"
              >
                <span aria-hidden="true" className="text-lg">{row.emoji}</span>
                <span className="flex-1 min-w-0 truncate text-base font-medium text-gray-100">
                  {row.market}
                </span>
                <span className="text-xs text-gray-400 tabular-nums hidden sm:inline">
                  {row.lifetimeWins.toLocaleString()}/{row.lifetimeTotal.toLocaleString()}
                </span>
                <span className="text-lg font-black tabular-nums text-violet-300 shrink-0">
                  {row.lifetimePercent.toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="text-center">
          <Link
            href="/track-record"
            className="inline-block text-sm font-semibold text-violet-300 hover:text-violet-200 transition-colors"
          >
            See the full snapshot →
          </Link>
        </div>
      </section>

      {/* g) Pricing CTA */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <div className="bg-gradient-to-br from-violet-900/40 to-fuchsia-900/20 border border-violet-700/40 rounded-2xl p-8 sm:p-12 text-center shadow-[0_0_40px_rgba(167,139,250,0.18)]">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-300 mb-3">
            Charter pricing
          </p>
          <p className="text-5xl sm:text-6xl font-black tabular-nums leading-none mb-3">
            $25
            <span className="text-xl sm:text-2xl text-gray-400 font-bold">
              {" "}/ month
            </span>
          </p>
          <p className="text-sm text-emerald-300 font-semibold mb-6">
            Locked for life · cancel anytime
          </p>
          <Link
            href="/pricing"
            className="inline-block bg-violet-600 hover:bg-violet-500 text-white font-bold px-8 py-3.5 rounded-lg transition-all duration-200 shadow-lg shadow-violet-900/40 hover:shadow-[0_0_25px_rgba(167,139,250,0.5)] hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
          >
            Join Premium →
          </Link>
        </div>
      </section>

      {/* h) FAQ */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <header className="text-center mb-10">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-300 mb-2">
            Questions
          </p>
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight">
            Frequently asked.
          </h2>
        </header>
        <div className="space-y-3">
          {FAQ.map((item) => (
            <details
              key={item.q}
              className="group bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-xl overflow-hidden hover:border-gray-700 transition-colors"
            >
              <summary className="flex items-center justify-between gap-3 px-5 py-4 cursor-pointer list-none">
                <span className="text-sm sm:text-base font-semibold text-white">
                  {item.q}
                </span>
                <span
                  aria-hidden="true"
                  className="text-gray-400 text-lg transition-transform duration-200 group-open:rotate-180"
                >
                  ⌄
                </span>
              </summary>
              <p
                className="px-5 pb-5 text-sm sm:text-base text-gray-300 leading-relaxed border-t border-gray-800/40 pt-4"
                dangerouslySetInnerHTML={{ __html: item.a }}
              />
            </details>
          ))}
        </div>
      </section>

      {/* i) Footer is rendered by app/layout.tsx — Global Footer component
            lands in 6.2c. */}
    </main>
  );
}
