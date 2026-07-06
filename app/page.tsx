import type { Metadata } from "next";
import Link from "next/link";
import {
  getPublicTrackRecordSummary,
  type PublicTrackRecordSummary,
} from "@/lib/services/tracking/publicTrackRecordSummary";

const SITE_URL = "https://www.oddsphereai.com";
const TRIAL_CHECKOUT_URL = "https://whop.com/checkout/plan_Fe6L8iSreOPYb";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "OddSphere AI | Daily Edge Sports Betting Intelligence",
  description:
    "Start a 7-day free trial of OddSphere Daily Edge: AI sports predictions, model projections, market reads, Play Grades, and transparent tracking.",
  alternates: { canonical: "/" },
  keywords: [
    "AI sports predictions",
    "sports betting intelligence",
    "MLB predictions",
    "WNBA predictions",
    "World Cup predictions",
    "sports prediction models",
    "market movement analysis",
    "sports model dashboard",
  ],
  openGraph: {
    type: "website",
    url: "/",
    title: "OddSphere AI | Daily Edge Sports Betting Intelligence",
    description:
      "Model projections, market movement, Play Grades, supporting evidence, and transparent tracking in one Daily Edge dashboard.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "OddSphere AI Daily Edge dashboard preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@OddSphereAI",
    title: "OddSphere AI | Daily Edge Sports Betting Intelligence",
    description:
      "Start a 7-day free trial of OddSphere Daily Edge: AI-powered picks, market reads, Play Grades, and tracking.",
    images: ["/og-image.png"],
  },
};

type FaqItem = { q: string; a: string };
type FeatureCard = { title: string; body: string };
type StepCard = { title: string; body: string };

const trustChips = [
  "Full Daily Edge access",
  "7 days free",
  "Then $25/month",
  "Cancel anytime",
  "Every pick tracked",
];

const memberFeatures: FeatureCard[] = [
  {
    title: "Daily Edge Picks",
    body: "A clean slate view built to help you find the games worth watching.",
  },
  {
    title: "Model Projections",
    body: "Projected scores, probabilities, totals, and matchup context in one place.",
  },
  {
    title: "Market Reads",
    body: "Line movement, price context, and market resistance signals where available.",
  },
  {
    title: "Play Grades",
    body: "Best Angle, Lean, Watchlist, and Caution labels separate stronger reads from thinner spots.",
  },
  {
    title: "Supporting Evidence",
    body: "Quick explanations behind the read so users are not blindly tailing picks.",
  },
  {
    title: "Transparent Tracking",
    body: "Results are tracked so the product is accountable over time.",
  },
];

const workflowSteps: StepCard[] = [
  {
    title: "The model projects the game",
    body: "OddSphere generates a model-side read using matchup data, pricing context, and sport-specific inputs.",
  },
  {
    title: "The market gets checked",
    body: "Line movement, price, public and sharp signals where available, and market resistance help shape the final read.",
  },
  {
    title: "The play gets graded",
    body: "Each spot is organized into a clear grade so users can understand strength, risk, and whether the edge is worth attention.",
  },
];

const faq: FaqItem[] = [
  {
    q: "What do I get during the free trial?",
    a: "You get full access to Daily Edge during the 7-day trial, including model-backed picks, market reads, Play Grades, supporting evidence, and tracking where available.",
  },
  {
    q: "When am I charged?",
    a: "The trial is free for 7 days. After that, membership renews at $25/month unless canceled before the trial ends.",
  },
  {
    q: "Can I cancel before the trial ends?",
    a: "Yes. Billing is managed through Whop, and users can cancel through their Whop account before the trial ends.",
  },
  {
    q: "What sports are currently supported?",
    a: "OddSphere supports active Daily Edge markets as data and schedules are available, including MLB, WNBA, and World Cup/Soccer, with additional seasonal surfaces returning as leagues are active.",
  },
  {
    q: "Is this betting advice?",
    a: "No. OddSphere provides informational sports analytics, model projections, and market context. Users make their own decisions and are responsible for following applicable laws.",
  },
  {
    q: "Are picks guaranteed?",
    a: "No. Sports outcomes are uncertain. OddSphere does not guarantee outcomes, profits, or results.",
  },
  {
    q: "How is OddSphere different from a picks Discord?",
    a: "OddSphere is built around a structured Daily Edge dashboard: model projections, market context, Play Grades, supporting evidence, and tracking. It is designed to show why a read exists, not just post a pick.",
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
      name: "OddSphere AI Daily Edge",
      description:
        "A subscription sports analytics dashboard with model projections, market movement analysis, Play Grades, supporting evidence, and tracked results.",
      brand: { "@id": `${SITE_URL}/#organization` },
      offers: {
        "@type": "Offer",
        price: "25",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        url: TRIAL_CHECKOUT_URL,
        category: "Subscription",
      },
    },
  ],
};

function TrialButton({ className = "" }: { className?: string }) {
  return (
    <a
      href={TRIAL_CHECKOUT_URL}
      className={`inline-flex items-center justify-center rounded-lg bg-emerald-400 px-7 py-3.5 text-sm font-black text-gray-950 shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 ${className}`}
      rel="noopener noreferrer"
      target="_blank"
    >
      Start Free Trial
    </a>
  );
}

function SectionHeader({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <header className="mx-auto mb-10 max-w-3xl text-center">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">{title}</h2>
      {body ? <p className="mt-4 text-base leading-relaxed text-gray-300">{body}</p> : null}
    </header>
  );
}

function MetricTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.045] p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-gray-400">{label}</p>
      <p className="mt-1 text-xl font-black tabular-nums text-white">{value}</p>
      {detail ? <p className="mt-1 text-xs leading-relaxed text-gray-400">{detail}</p> : null}
    </div>
  );
}

function TrackingPreview({ summary }: { summary: PublicTrackRecordSummary }) {
  const markets = summary.markets.slice(0, 4);
  const pct = summary.overall.winPct === null ? "—" : `${summary.overall.winPct.toFixed(1)}%`;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-gray-950/75">
      <div className="border-b border-white/10 bg-white/[0.035] p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">Public accountability</p>
            <h3 className="mt-2 text-2xl font-black tracking-tight text-white">Tracked Results. Not Cherry-Picked Screenshots.</h3>
          </div>
          <p className="text-xs text-gray-500">Updated {summary.lastUpdatedLabel}</p>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-gray-300">
          OddSphere keeps public historical tracking to show accountability over time. Current Daily Edge tracking continues inside the member dashboard.
        </p>
      </div>

      {!summary.tablesInitialized ? (
        <p className="m-5 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-4 text-sm leading-relaxed text-amber-50">
          Tracking summary is temporarily unavailable, so this preview is not showing stale manual numbers.
        </p>
      ) : (
        <div className="p-5 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricTile label="Lifetime record" value={`${summary.overall.wins.toLocaleString()}-${summary.overall.losses.toLocaleString()}`} />
            <MetricTile label="Win rate" value={pct} />
            <MetricTile label="Tracked picks" value={summary.overall.picks.toLocaleString()} />
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            {markets.map((row) => (
              <div key={`${row.sport}-${row.market}`} className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-gray-500">{row.sportLabel}</p>
                <p className="mt-1 font-bold text-white">{row.marketLabel}</p>
                <p className="mt-2 text-sm tabular-nums text-gray-300">
                  {row.metrics.wins}-{row.metrics.losses}
                  <span className="text-gray-500"> · </span>
                  {row.metrics.winPct === null ? "—" : `${row.metrics.winPct.toFixed(1)}%`}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-gray-500">
            Past performance does not guarantee future results.
          </p>
        </div>
      )}
    </div>
  );
}

function DailyEdgePreview() {
  return (
    <div
      aria-label="Sample Daily Edge dashboard preview"
      className="relative overflow-hidden rounded-2xl border border-violet-500/30 bg-gray-950 shadow-[0_0_80px_rgba(124,58,237,0.18)]"
    >
      <div className="border-b border-white/10 bg-white/[0.035] px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-300">Sample Daily Edge Preview</p>
            <p className="mt-1 text-sm font-semibold text-white">Representative display data only</p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-gray-300">
            {["Model Pick", "Market Read", "Play Grade"].map((label) => (
              <span key={label} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[0.95fr_1.25fr]">
        <div className="border-b border-white/10 p-4 sm:p-5 lg:border-b-0 lg:border-r">
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">Selected Edge</p>
                <h3 className="mt-2 text-2xl font-black tracking-tight text-white">Sample MLB Matchup</h3>
              </div>
              <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-emerald-300">
                Lean
              </span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <MetricTile label="Model Pick" value="Over 8.5" />
              <MetricTile label="Projected Total" value="9.3" />
              <MetricTile label="Model Prob." value="58%" />
              <MetricTile label="Price" value="-112" />
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-gray-950/70 p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300">Quick Read</p>
              <p className="mt-2 text-sm leading-relaxed text-gray-200">
                Projection supports the Over, with price still playable and market movement not fighting the read.
              </p>
            </div>

            <div className="mt-4 grid grid-cols-3 items-center gap-2 rounded-xl border border-white/10 bg-gray-950/70 p-4 text-center">
              <div>
                <p className="text-lg font-black tabular-nums text-white">8.0</p>
                <p className="mt-1 text-[10px] font-black uppercase tracking-[0.14em] text-gray-500">Open</p>
              </div>
              <div>
                <p className="text-lg font-black tabular-nums text-white">8.5</p>
                <p className="mt-1 text-[10px] font-black uppercase tracking-[0.14em] text-gray-500">Move</p>
              </div>
              <div>
                <p className="text-lg font-black tabular-nums text-white">8.5</p>
                <p className="mt-1 text-[10px] font-black uppercase tracking-[0.14em] text-gray-500">Current</p>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="grid gap-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-300">Market Read</p>
              <p className="mt-2 text-sm leading-relaxed text-gray-200">
                Model edge with supportive movement, but monitor late steam before treating it as a cleaner top-tier look.
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-300">Supporting Evidence</p>
              <p className="mt-2 text-sm leading-relaxed text-gray-200">
                Projection clears the market total, price movement is not fighting the read, and risk remains moderate.
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <MetricTile label="Projection Gap" value="+0.8" />
                <MetricTile label="Play Grade" value="Lean" />
                <MetricTile label="Risk" value="Moderate" />
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-300">What the card explains</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {[
                  "Why the model likes it",
                  "Whether price is playable",
                  "How the market is moving",
                  "Why the grade is not stronger",
                ].map((item) => (
                  <div key={item} className="rounded-lg border border-white/10 bg-gray-950/70 px-3 py-2 text-sm font-semibold text-gray-200">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function HomePage() {
  const trackingSummary = await getPublicTrackRecordSummary();

  return (
    <main className="overflow-hidden">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <section className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-20 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
        <div>
          <p className="inline-flex rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1.5 text-xs font-black uppercase tracking-[0.16em] text-emerald-200">
            7-Day Free Trial · OddSphere Daily Edge
          </p>
          <h1 className="mt-6 max-w-3xl text-4xl font-black tracking-tight text-white sm:text-6xl">
            Stop Betting Blind. See the Edge Before You Play.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-gray-200">
            OddSphere turns model projections, market movement, Play Grades, and transparent tracking into one clean Daily Edge, so you can quickly see which games are worth your attention and why.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <TrialButton />
            <Link
              href="#product-preview"
              className="inline-flex items-center justify-center rounded-lg border border-white/15 bg-white/[0.05] px-7 py-3.5 text-sm font-bold text-white transition hover:border-violet-400/50 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              See What&apos;s Inside
            </Link>
            <Link
              href="/track-record"
              className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-gray-950 px-7 py-3.5 text-sm font-bold text-gray-200 transition hover:border-white/25 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              View Track Record
            </Link>
          </div>
          <p className="mt-4 text-sm font-semibold text-violet-100">
            Free for 7 days, then $25/month. Cancel anytime before the trial ends.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {trustChips.map((chip) => (
              <span key={chip} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-gray-200">
                {chip}
              </span>
            ))}
          </div>
          <p className="mt-6 max-w-2xl text-xs leading-relaxed text-gray-500">
            OddSphere provides sports prediction and betting analysis for informational purposes only. No pick is guaranteed. Bet responsibly.
          </p>
        </div>

        <div id="product-preview">
          <DailyEdgePreview />
          <p className="mx-auto mt-4 max-w-2xl text-center text-xs leading-relaxed text-gray-500">
            Preview uses static representative display data and does not expose member-only live picks.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8">
        <div className="grid gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:p-7 lg:grid-cols-[0.95fr_1.05fr] lg:p-8">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">Why OddSphere is different</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">A sharper read than a pick alone.</h2>
          </div>
          <p className="text-base leading-relaxed text-gray-300">
            Most betting content gives you a pick and asks you to trust it. OddSphere shows the full read: the model projection, the market context, the grade, the risk, and the tracking behind the system.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8">
        <SectionHeader
          eyebrow="What members get"
          title="Everything needed to understand the slate."
          body="Daily Edge is built to make the board easier to scan, compare, and judge without exposing users to noisy tout-style copy."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {memberFeatures.map((feature) => (
            <div key={feature.title} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
              <h3 className="text-lg font-black text-white">{feature.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-gray-300">{feature.body}</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-6 max-w-3xl text-center text-sm leading-relaxed text-gray-400">
          Daily Edge currently supports active markets like MLB, WNBA, and World Cup/Soccer, with NBA, NHL, NFL, CFB, and CBB surfaces available as seasons and supported data pipelines are active.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8">
        <SectionHeader
          eyebrow="How Daily Edge works"
          title="Model first. Market checked. Grade explained."
        />
        <div className="grid gap-4 md:grid-cols-3">
          {workflowSteps.map((step, index) => (
            <div key={step.title} className="rounded-2xl border border-white/10 bg-white/[0.035] p-6">
              <p className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/15 text-sm font-black text-violet-200">
                {index + 1}
              </p>
              <h3 className="text-lg font-black text-white">{step.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-gray-300">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8">
        <TrackingPreview summary={trackingSummary} />
      </section>

      <section className="mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8">
        <div className="rounded-3xl border border-emerald-400/25 bg-emerald-400/[0.07] p-6 text-center sm:p-10">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-200">Start with 7 Days Free</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-5xl">Full Daily Edge access today.</h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-gray-200 sm:text-base">
            Get full access to Daily Edge, including model-backed picks, projected scores, market reads, Play Grades, supporting evidence, and transparent tracking.
          </p>
          <p className="mt-4 text-sm font-bold text-emerald-100">
            Free for 7 days, then $25/month. Cancel anytime before the trial ends.
          </p>
          <div className="mt-7">
            <TrialButton />
          </div>
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

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8">
        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-5 text-sm leading-relaxed text-amber-50">
          OddSphere provides sports prediction and betting analysis for informational purposes only. It does not place bets, accept wagers, or guarantee any outcome. Betting involves risk and may not be legal in every jurisdiction. Users must be 21+ where applicable. If gambling is a problem, call 1-800-GAMBLER.
        </div>
      </section>
    </main>
  );
}
