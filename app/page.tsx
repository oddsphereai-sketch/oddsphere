import type { Metadata } from "next";
import Link from "next/link";
import {
  getPublicTrackRecordSummary,
  type PublicTrackRecordSummary,
} from "@/lib/services/tracking/publicTrackRecordSummary";

const SITE_URL = "https://www.oddsphereai.com";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "OddSphere AI | Sports Prediction Models & Market Analysis",
  description:
    "OddSphere AI combines sports prediction models, market movement analysis, Play Grades, and tracked results in one Daily Edge dashboard.",
  alternates: { canonical: "/" },
  keywords: [
    "AI sports predictions",
    "sports prediction models",
    "MLB predictions",
    "WNBA predictions",
    "World Cup predictions",
    "sports betting analytics",
    "market movement analysis",
    "sports model dashboard",
  ],
  openGraph: {
    type: "website",
    url: "/",
    title: "OddSphere AI | Daily Edge Sports Model Dashboard",
    description:
      "Model projections, price/value context, market movement, Play Grades, and tracked results in one clean sports analytics dashboard.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "OddSphere AI sports analytics dashboard preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@OddSphereAI",
    title: "OddSphere AI | Daily Edge Sports Model Dashboard",
    description:
      "Sports prediction models, market analysis, Play Grades, and tracked results in one Daily Edge dashboard.",
    images: ["/og-image.png"],
  },
};

type FaqItem = { q: string; a: string };

const supportedSports = ["MLB", "WNBA", "World Cup", "NBA", "NHL"];

const faq: FaqItem[] = [
  {
    q: "What is Daily Edge?",
    a: "Daily Edge is OddSphere's main dashboard for model-driven game predictions. It organizes each slate by Play Grade, market context, price/value, and supporting evidence.",
  },
  {
    q: "Are picks guaranteed?",
    a: "No. Sports outcomes are uncertain. OddSphere provides informational sports analytics, model projections, and market context. It does not guarantee outcomes or profits.",
  },
  {
    q: "What are Play Grades?",
    a: "Play Grades are simple labels that summarize the current model/value setup: Best Angle, Lean, Watchlist, Caution, and No Play. They are decision-support labels, not guarantees.",
  },
  {
    q: "What are Consensus Splits and Sharp Book Splits?",
    a: "Consensus Splits summarize broader money and bet distribution where available. Sharp Book Splits or Signals summarize a sharper market context when the sport and market support it. OddSphere hides unsupported sections instead of showing empty placeholders.",
  },
  {
    q: "Why do some sports not show Sharp Book data?",
    a: "Not every sport or market has reliable split sources. MLB moneyline and totals can show richer market context when available, WNBA is generally consensus-only, and World Cup/Soccer copy focuses on model, price, movement, and market-specific context.",
  },
  {
    q: "How is the track record updated?",
    a: "Tracked results update after games settle and grading completes. Pending rows are separated from settled win rate so the public view does not mix unresolved predictions with finished outcomes.",
  },
  {
    q: "Does OddSphere place bets for users?",
    a: "No. OddSphere is not a sportsbook and does not place, accept, or settle wagers. Users make their own decisions and are responsible for complying with local laws.",
  },
  {
    q: "Can I cancel?",
    a: "Yes. Membership billing is managed through Whop, and users can cancel through their Whop account. See the Refund & Cancellation Policy for details.",
  },
  {
    q: "What sports are included?",
    a: "Daily Edge currently supports MLB, WNBA, and World Cup/Soccer views, with NBA and NHL surfaces available as those seasons and data pipelines are active.",
  },
  {
    q: "Is this betting advice?",
    a: "No. OddSphere provides informational and educational sports analytics. Nothing on the site should be treated as financial advice or a recommendation to place any wager.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "FAQPage",
      "@id": `${SITE_URL}/#faq`,
      mainEntity: faq.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.a,
        },
      })),
    },
    {
      "@type": "Product",
      "@id": `${SITE_URL}/#product`,
      name: "OddSphere AI Premium",
      description:
        "A subscription sports analytics dashboard with model projections, market movement analysis, Play Grades, and tracked results.",
      brand: { "@id": `${SITE_URL}/#organization` },
      offers: {
        "@type": "Offer",
        price: "25",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        url: `${SITE_URL}/pricing`,
        category: "Subscription",
      },
    },
  ],
};

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">{label}</p>
      <p className="mt-1 text-lg font-black tabular-nums text-white">{value}</p>
    </div>
  );
}

function trackingPct(summary: PublicTrackRecordSummary): string {
  return summary.overall.winPct === null ? "—" : `${summary.overall.winPct.toFixed(1)}%`;
}

function trackingRecord(summary: PublicTrackRecordSummary): string {
  return `${summary.overall.wins.toLocaleString()}-${summary.overall.losses.toLocaleString()}`;
}

function MiniBar({ label, money, bets }: { label: string; money: number; bets: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.12em] text-gray-300">
        <span>{label}</span>
      </div>
      <div className="grid grid-cols-[44px_1fr_34px] items-center gap-2 text-[11px] text-gray-400">
        <span>Money</span>
        <span className="h-2 rounded-full bg-gray-800">
          <span className="block h-full rounded-full bg-violet-400" style={{ width: `${money}%` }} />
        </span>
        <span className="text-right tabular-nums">{money}%</span>
      </div>
      <div className="grid grid-cols-[44px_1fr_34px] items-center gap-2 text-[11px] text-gray-400">
        <span>Bets</span>
        <span className="h-2 rounded-full bg-gray-800">
          <span className="block h-full rounded-full bg-emerald-300" style={{ width: `${bets}%` }} />
        </span>
        <span className="text-right tabular-nums">{bets}%</span>
      </div>
    </div>
  );
}

function TrackRecordPreview({ summary }: { summary: PublicTrackRecordSummary }) {
  const markets = summary.markets.slice(0, 4);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-300">
            Tracked results
          </p>
          <h3 className="mt-2 text-2xl font-black text-white">Public record preview</h3>
        </div>
        <p className="text-xs text-gray-500">Updated {summary.lastUpdatedLabel}</p>
      </div>

      {!summary.tablesInitialized ? (
        <p className="mt-5 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-4 text-sm leading-relaxed text-amber-50">
          Tracking summary is temporarily unavailable, so this preview is not showing stale manual numbers.
        </p>
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <StatPill label="Overall" value={trackingRecord(summary)} />
            <StatPill label="Win Rate" value={trackingPct(summary)} />
            <StatPill label="Pending" value={summary.overall.pending.toLocaleString()} />
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            {markets.map((row) => (
              <div key={`${row.sport}-${row.market}`} className="rounded-xl border border-white/10 bg-gray-950/70 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{row.sportLabel}</p>
                <p className="mt-1 font-bold text-white">{row.marketLabel}</p>
                <p className="mt-2 text-sm tabular-nums text-gray-300">
                  {row.metrics.wins}-{row.metrics.losses}
                  <span className="text-gray-500"> · </span>
                  {row.metrics.winPct === null ? "—" : `${row.metrics.winPct.toFixed(1)}%`}
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-gray-500">
          Results update after games settle. Pending rows are separated from settled hit rate.
        </p>
        <Link href="/track-record" className="text-sm font-bold text-violet-200 hover:text-violet-100">
          View full track record
        </Link>
      </div>
    </div>
  );
}

function ProductMockup() {
  return (
    <div
      aria-label="Daily Edge product preview showing Play Grade, Market Read, Supporting Evidence, and split context"
      className="relative mx-auto max-w-6xl overflow-hidden rounded-2xl border border-violet-500/30 bg-gray-950 shadow-[0_0_70px_rgba(139,92,246,0.18)]"
    >
      <div className="border-b border-white/10 bg-white/[0.03] px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">Daily Edge Preview</p>
            <p className="mt-1 text-sm font-semibold text-white">MLB slate dashboard</p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-gray-300">
            {["MLB", "WNBA", "World Cup"].map((sport) => (
              <span key={sport} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
                {sport}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[1.05fr_1.35fr]">
        <div className="border-b border-white/10 p-4 sm:p-5 lg:border-b-0 lg:border-r">
          <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">Selected Edge</p>
                <h3 className="mt-2 text-2xl font-black tracking-tight text-white">NYM @ TOR</h3>
              </div>
              <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-emerald-300">
                Best Angle
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <StatPill label="Pick" value="NYM" />
              <StatPill label="Model" value="56%" />
              <StatPill label="Price" value="-104" />
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-gray-950/70 p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300">Quick Read</p>
              <p className="mt-2 text-sm leading-relaxed text-gray-200">
                Strong model/value case with odds movement and sharper market context behind it.
              </p>
            </div>

            <div className="mt-4 space-y-2">
              {[
                ["Moneyline", "NYM", "Best Angle"],
                ["Total", "Over 7.5", "Lean"],
                ["1st Inning", "Toss-Up", "No Play"],
              ].map(([market, pick, grade]) => (
                <div key={market} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{market}</p>
                    <p className="text-sm font-bold text-white">{pick}</p>
                  </div>
                  <p className="text-xs font-semibold text-violet-200">{grade}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="grid gap-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300">Supporting Evidence</p>
              <p className="mt-2 text-sm leading-relaxed text-gray-200">
                NYM has 56% model probability versus 46% implied at -104, for about 10 percentage points of edge.
              </p>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <StatPill label="Projection" value="56%" />
                <StatPill label="Market" value="46%" />
                <StatPill label="Edge" value="+10pp" />
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">Market Read</p>
              <p className="mt-2 text-sm leading-relaxed text-gray-200">
                Mixed consensus, but the sharper split profile and odds movement support the pick. Price remains playable.
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-300">Market Pulse - Splits</p>
                <p className="text-[11px] text-gray-500">Example display</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-white">Consensus Splits</p>
                  <MiniBar label="NYM" money={41} bets={45} />
                  <div className="mt-3">
                    <MiniBar label="TOR" money={59} bets={55} />
                  </div>
                </div>
                <div>
                  <p className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-white">Sharp Book Splits</p>
                  <MiniBar label="NYM" money={78} bets={36} />
                  <div className="mt-3">
                    <MiniBar label="TOR" money={22} bets={64} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductVisualGrid() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300">WNBA preview</p>
        <h3 className="mt-2 text-xl font-black text-white">Consensus-only context</h3>
        <p className="mt-3 text-sm leading-relaxed text-gray-300">
          WNBA reader copy uses model, price, spread/total context, line movement, and Consensus Splits where available.
        </p>
        <div className="mt-4 rounded-xl border border-white/10 bg-gray-950/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold text-white">ATL @ WSH</span>
            <span className="text-xs font-bold text-violet-200">Watchlist</span>
          </div>
          <p className="mt-3 text-sm text-gray-300">
            Projection supports the Over, but the current number keeps this in monitor territory.
          </p>
          <div className="mt-4">
            <MiniBar label="Consensus Splits" money={54} bets={51} />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300">World Cup preview</p>
        <h3 className="mt-2 text-xl font-black text-white">Soccer-specific read</h3>
        <p className="mt-3 text-sm leading-relaxed text-gray-300">
          Soccer copy avoids split assumptions and focuses on model probability, price, draw risk, movement, totals, BTTS, and Double Chance context.
        </p>
        <div className="mt-4 rounded-xl border border-white/10 bg-gray-950/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold text-white">BEL vs CAN</span>
            <span className="text-xs font-bold text-amber-200">Lean</span>
          </div>
          <p className="mt-3 text-sm text-gray-300">
            Odds movement supports the Over, while price and match-state risk keep the read measured.
          </p>
          <div className="mt-4 grid grid-cols-3 items-center gap-2 text-center text-sm font-bold tabular-nums text-white">
            <span>+112</span>
            <span className="text-gray-500">→</span>
            <span>-112</span>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300">MLB FI preview</p>
        <h3 className="mt-2 text-xl font-black text-white">First-inning discipline</h3>
        <p className="mt-3 text-sm leading-relaxed text-gray-300">
          FI copy stays prediction-specific and does not treat missing Consensus or Sharp split bars as a problem.
        </p>
        <div className="mt-4 rounded-xl border border-white/10 bg-gray-950/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold text-white">SD @ CHC</span>
            <span className="text-xs font-bold text-gray-300">No Play</span>
          </div>
          <p className="mt-3 text-sm text-gray-300">
            First inning is a Toss-Up, so there is not enough actionable edge at the current number.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <StatPill label="FI Prob" value="52%" />
            <StatPill label="Grade" value="No Play" />
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <header className="mx-auto mb-10 max-w-3xl text-center">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-300">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">{title}</h2>
      {body ? <p className="mt-4 text-base leading-relaxed text-gray-300">{body}</p> : null}
    </header>
  );
}

export default async function HomePage() {
  const trackingSummary = await getPublicTrackRecordSummary();

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <section className="mx-auto max-w-7xl px-4 pb-14 pt-16 sm:px-6 sm:pb-20 sm:pt-24 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <p className="inline-flex rounded-full border border-violet-400/30 bg-violet-400/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-violet-200">
            Sports model dashboard
          </p>
          <h1 className="mt-6 text-4xl font-black tracking-tight text-white sm:text-6xl">
            AI-powered sports prediction models and market analysis in one Daily Edge dashboard.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-200">
            OddSphere turns model projections, price/value context, market movement, and tracked results into a clean daily reader for serious sports fans.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/pricing"
              className="rounded-lg bg-violet-600 px-7 py-3.5 text-sm font-bold text-white shadow-lg shadow-violet-900/40 transition hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              Get Access
            </Link>
            <Link
              href="#product-preview"
              className="rounded-lg border border-white/15 bg-white/[0.04] px-7 py-3.5 text-sm font-bold text-white transition hover:border-violet-400/40 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              See What's Inside
            </Link>
            <Link
              href="/track-record"
              className="rounded-lg border border-white/15 bg-gray-950 px-7 py-3.5 text-sm font-bold text-white transition hover:border-violet-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              View Tracking
            </Link>
          </div>
          <p className="mt-5 text-xs leading-relaxed text-gray-400">
            Informational sports analytics only. No guaranteed outcomes. Betting involves risk.
          </p>
        </div>
      </section>

      <section id="product-preview" className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <ProductMockup />
        <p className="mx-auto mt-4 max-w-3xl text-center text-xs leading-relaxed text-gray-500">
          Product preview uses representative display data and member-facing labels. It does not expose private member-only live card data.
        </p>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8">
        <SectionHeader
          eyebrow="What members see"
          title="Readable previews by sport and market."
          body="The public mockups use sample display data to show the reader structure without exposing private member-only cards."
        />
        <ProductVisualGrid />
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8">
        <SectionHeader
          eyebrow="How it works"
          title="The reader connects model, market, and price."
          body="OddSphere is built to show why a prediction is graded the way it is, not just the pick."
        />
        <div className="grid gap-4 md:grid-cols-4">
          {[
            ["Model Projection", "Game and market-level model probabilities create the starting point for every read."],
            ["Market Context", "Odds movement, price, Consensus Splits, and Sharp Book context are surfaced when supported."],
            ["Play Grade", "Each prediction is simplified into Best Angle, Lean, Watchlist, Caution, or No Play."],
            ["Tracked Results", "Public tracking shows historical performance and keeps the product accountable."],
          ].map(([title, body], index) => (
            <div key={title} className="rounded-xl border border-white/10 bg-white/[0.035] p-5">
              <p className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-violet-500/15 text-sm font-black text-violet-200">
                {index + 1}
              </p>
              <h3 className="text-base font-bold text-white">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-300">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8">
        <SectionHeader
          eyebrow="Supported sports"
          title="Built for multi-sport slates."
          body="Daily Edge copy adapts by sport, so unsupported split sections are hidden instead of forced into the reader."
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {supportedSports.map((sport) => (
            <div key={sport} className="rounded-xl border border-white/10 bg-white/[0.035] px-5 py-6 text-center">
              <p className="text-xl font-black text-white">{sport}</p>
              <p className="mt-2 text-xs leading-relaxed text-gray-400">
                {sport === "MLB"
                  ? "Daily Edge, ML/Totals/FI, splits where available"
                  : sport === "WNBA"
                    ? "Consensus-only reader context"
                  : sport === "World Cup"
                    ? "Soccer model, movement, BTTS and totals context"
                    : "Limited tracked rows appear as seasonal data is active"}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8">
        <TrackRecordPreview summary={trackingSummary} />
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8">
        <SectionHeader
          eyebrow="Why OddSphere"
          title="A cleaner way to read the board."
        />
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["No hype language", "The reader avoids exaggerated betting slang and focuses on evidence, value, and risk."],
            ["Market-aware copy", "Market Read explains support, resistance, mixed signals, price caps, and model/value overrides."],
            ["Transparent access", "Pricing, cancellation, terms, privacy, and responsible-use information are linked before signup."],
          ].map(([title, body]) => (
            <div key={title} className="rounded-xl border border-white/10 bg-white/[0.035] p-6">
              <h3 className="text-lg font-bold text-white">{title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-gray-300">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8">
        <div className="rounded-2xl border border-violet-500/30 bg-violet-500/[0.08] p-6 text-center sm:p-10">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-200">Pricing</p>
          <h2 className="mt-3 text-4xl font-black tracking-tight text-white">$25/month</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-gray-200">
            Charter pricing for the first members. If pricing changes later, the pricing page will show the current offer before checkout.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/pricing" className="rounded-lg bg-violet-600 px-7 py-3 text-sm font-bold text-white transition hover:bg-violet-500">
              View Pricing
            </Link>
            <Link href="/legal/refund-cancellation" className="rounded-lg border border-white/15 px-7 py-3 text-sm font-bold text-white transition hover:border-violet-400/40">
              Cancellation Policy
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8">
        <SectionHeader
          eyebrow="Responsible use"
          title="Sports analytics, not guarantees."
          body="OddSphere is designed as an informational decision-support dashboard. Users are responsible for their own decisions and for following the laws in their jurisdiction."
        />
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-5 text-sm leading-relaxed text-amber-50">
          OddSphere AI does not place bets, accept wagers, or guarantee any outcome. Betting involves risk and may not be legal in every jurisdiction. Users must be 21+ where applicable. If gambling is a problem, call 1-800-GAMBLER.
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8">
        <SectionHeader eyebrow="FAQ" title="Questions before joining." />
        <div className="space-y-3">
          {faq.map((item) => (
            <details key={item.q} className="group rounded-xl border border-white/10 bg-white/[0.035]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-bold text-white">
                {item.q}
                <span className="text-gray-500 transition group-open:rotate-180" aria-hidden="true">v</span>
              </summary>
              <p className="border-t border-white/10 px-5 py-4 text-sm leading-relaxed text-gray-300">{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}
