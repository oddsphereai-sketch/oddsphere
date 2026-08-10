import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { HomepageDashboardPrototype } from "@/app/components/HomepageDashboardPrototype";
import { MarketingDailyEdgePreviewSurface } from "@/app/lab/components/daily-edge/DailyEdgeShell";
import { isHomepageExperienceCandidateEnabled } from "@/lib/config/productExperience";
import {
  getPublicTrackRecordSummary,
  type PublicTrackRecordSummary,
} from "@/lib/services/tracking/publicTrackRecordSummary";
import {
  PRICING_PAGE_URL,
  TRIAL_DISCLOSURE,
} from "@/lib/marketing/trialOffer";

const SITE_URL = "https://www.oddsphereai.com";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "OddSphere AI | Sports Prediction & Market Intelligence",
  description:
    "Start a 7-day free trial of OddSphere Daily Edge: AI sports predictions, model projections, market reads, Play Grades, transparent tracking, and responsible-use disclosures.",
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
    title: "OddSphere AI | Sports Prediction & Market Intelligence",
    description:
      "Model projections, market movement, Play Grades, supporting evidence, transparent tracking, and responsible-use context in one Daily Edge dashboard.",
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
    title: "OddSphere AI | Sports Prediction & Market Intelligence",
    description:
      "Start a 7-day free trial of OddSphere Daily Edge: AI-powered predictions, market reads, Play Grades, and tracking.",
    images: ["/og-image.png"],
  },
};

type FaqItem = { q: string; a: string };
type FeatureCard = { title: string; body: string };
type StepCard = { title: string; body: string };

const trustChips = [
  "Full Daily Edge access",
  "7 days free",
  "Transparent tracking",
  "21+ responsible use",
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
    a: "The monthly plan is free for 7 days, then renews at $19.99/month unless canceled before the trial ends. The annual plan is $199 charged immediately and does not include a free trial.",
  },
  {
    q: "Can I cancel before the trial ends?",
    a: "Yes. Billing is managed through Whop, and users can cancel through their Whop account before the trial ends.",
  },
  {
    q: "What sports are currently supported?",
    a: "Daily Edge currently supports active MLB, WNBA, and World Cup/Soccer slates when schedules and data are available. The public lifetime tracking archive also includes NFL, CFB, NBA, CBB, MLB, UCL/Soccer, and NHL model families, with seasonal Daily Edge surfaces returning as supported leagues are active.",
  },
  {
    q: "Is this financial or wagering advice?",
    a: "No. OddSphere provides informational sports analytics, model projections, and market context. Users make their own decisions and are responsible for following applicable laws.",
  },
  {
    q: "Does OddSphere take bets or connect to sportsbooks?",
    a: "No. OddSphere is not a sportsbook, does not accept wagers, does not place bets for users, and does not require connecting a betting account.",
  },
  {
    q: "Are picks guaranteed?",
    a: "No. Sports outcomes are uncertain. OddSphere does not guarantee outcomes, profits, or results.",
  },
  {
    q: "Can minors use OddSphere?",
    a: "No. OddSphere is intended only for adults 21+ where applicable. Users are responsible for following all local laws and responsible gambling guidelines.",
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
        "A subscription sports analytics dashboard with model projections, market movement analysis, Play Grades, supporting evidence, responsible-use disclosures, and tracked results.",
      brand: { "@id": `${SITE_URL}/#organization` },
      offers: [
        {
          "@type": "Offer",
          name: "Monthly membership",
          price: "19.99",
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
          url: `${SITE_URL}${PRICING_PAGE_URL}`,
          category: "Subscription",
        },
        {
          "@type": "Offer",
          name: "Annual membership",
          price: "199",
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
          url: `${SITE_URL}${PRICING_PAGE_URL}`,
          category: "Subscription",
        },
      ],
    },
  ],
};

function TrialButton({ className = "" }: { className?: string }) {
  return (
    <Link
      href={PRICING_PAGE_URL}
      className={`inline-flex items-center justify-center rounded-lg bg-emerald-400 px-7 py-3.5 text-sm font-black text-gray-950 shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 ${className}`}
    >
      Start Free Trial
    </Link>
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
            <h3 className="mt-2 text-2xl font-black tracking-tight text-white">Historical Tracking, Not Cherry-Picked Screenshots</h3>
          </div>
          <p className="text-xs text-gray-500">
            Lifetime archive snapshot · {summary.lastUpdatedLabel}
          </p>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-gray-300">
          OddSphere maintains a public lifetime model archive for accountability.
          Current Daily Edge results continue inside the member dashboard.
        </p>
      </div>

      {!summary.tablesInitialized ? (
        <p className="m-5 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-4 text-sm leading-relaxed text-amber-50">
          Tracking summary is temporarily unavailable, so this preview is not showing stale manual numbers.
        </p>
      ) : (
        <div className="p-5 sm:p-6">
          {summary.currentOfficial ? (
            <div className="mb-5 grid gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.055] p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-300">Current verified tracking</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-400">Latest settled activity · {summary.currentOfficial.latestActivityDate}</p>
              </div>
              <p className="text-sm tabular-nums text-gray-300"><strong className="text-lg text-white">{summary.currentOfficial.wins}-{summary.currentOfficial.losses}{summary.currentOfficial.pushes ? `-${summary.currentOfficial.pushes}` : ""}</strong><span className="ml-2 text-gray-500">official model results</span></p>
              <p className="text-lg font-black tabular-nums text-emerald-200">{summary.currentOfficial.hitRate.toFixed(1)}%</p>
            </div>
          ) : null}
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

function DailyEdgePreview({ candidate = false }: { candidate?: boolean }) {
  return (
    <div aria-label="Daily Edge product preview" className="relative">
      <div className="absolute -inset-5 rounded-[2rem] bg-violet-700/20 blur-3xl" />
      <div className="relative overflow-hidden rounded-2xl border border-violet-400/30 bg-[#080712] shadow-[0_0_90px_rgba(124,58,237,0.22)]">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 bg-white/[0.035] px-4 py-3 sm:px-5">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-200">
            {candidate ? "OddSphere Daily Edge · Complete reader" : "Daily Edge reader"}
          </p>
          <div className="flex gap-1.5" aria-hidden="true">
            <span className="h-2 w-2 rounded-full bg-emerald-300/80" />
            <span className="h-2 w-2 rounded-full bg-violet-300/70" />
            <span className="h-2 w-2 rounded-full bg-white/30" />
          </div>
        </div>
        {candidate ? <div className="p-2 sm:p-3"><MarketingDailyEdgePreviewSurface /></div> : (
          <div className="relative aspect-[1.18/1] overflow-hidden bg-black">
            <Image
              src="/marketing/daily-edge-expanded-reader.jpg"
              alt="OddSphere Daily Edge selected edge, supporting evidence, odds movement, and market pulse"
              fill
              priority
              sizes="(min-width: 1024px) 58vw, 100vw"
              className="object-cover object-[46%_26%]"
            />
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(3,2,12,0.08),rgba(3,2,12,0)_20%,rgba(3,2,12,0)_78%,rgba(3,2,12,0.16))]" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#080712] to-transparent" />
          </div>
        )}
      </div>
      <div className="relative mx-auto -mt-5 flex max-w-xl flex-wrap justify-center gap-2 px-4">
        {["Quick Read", "Odds Move", "Market Pulse", "Supporting Evidence"].map((label) => (
          <span key={label} className="rounded-full border border-white/10 bg-gray-950/90 px-3 py-1.5 text-xs font-black uppercase tracking-[0.12em] text-gray-200 shadow-lg shadow-black/30">
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

export async function HomePageContent({ presentation = "current" }: { presentation?: "current" | "candidate" }) {
  const trackingSummary = await getPublicTrackRecordSummary();
  const candidate = presentation === "candidate";
  const displayedFeatures = candidate
    ? [
        memberFeatures[0],
        memberFeatures[2],
        memberFeatures[1],
        {
          title: "MLB Player Prop Research",
          body: "Filter the prop board quickly, then open recent results, matchup evidence, pricing, and deeper supporting context only when you need it.",
        },
        memberFeatures[4],
        memberFeatures[5],
      ]
    : memberFeatures;

  return (
    <main className="overflow-hidden">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <section className={`mx-auto grid max-w-7xl items-center gap-10 px-4 pb-14 pt-10 sm:px-6 sm:pb-16 sm:pt-12 lg:px-8 ${candidate ? "grid-cols-[minmax(0,1fr)]" : "lg:grid-cols-[0.88fr_1.12fr]"}`}>
        <div className={candidate ? "min-w-0 max-w-4xl" : undefined}>
          <p className="inline-flex rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1.5 text-xs font-black uppercase tracking-[0.16em] text-emerald-200">
            {candidate ? "OddSphere Sports Intelligence" : "7-Day Free Trial · OddSphere Daily Edge"}
          </p>
          <h1 className="mt-5 max-w-3xl break-words text-4xl font-black tracking-tight text-white sm:text-5xl xl:text-6xl">
            {candidate
              ? "The Full Game Read—From Model Edge to Market Pulse."
              : "Cut Through the Noise. Find the Plays Worth Your Attention."}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-gray-200">
            {candidate
              ? "Make clearer moneyline, totals, and first-inning decisions with model projections, real price movement, public consensus, verified sharp-book splits where available, matchup evidence, and tracking in one OddSphere workflow."
              : "Model projections, market movement, Play Grades, and tracking — organized into one Daily Edge dashboard built to show the why behind every pick."}
          </p>
          <div className="mt-6 flex min-w-0 flex-col gap-3 sm:flex-row">
            <TrialButton className="w-full sm:w-auto" />
            <HomepageDashboardPrototype candidate={candidate} />
          </div>
          <p className="mt-4 text-sm font-semibold text-violet-100">
            {TRIAL_DISCLOSURE}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {trustChips.map((chip) => (
              <span key={chip} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-gray-200">
                {chip}
              </span>
            ))}
          </div>
          <div className="mt-5 max-w-2xl rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-4 text-xs leading-relaxed text-amber-50">
            <p className="font-bold text-amber-100">Informational sports analytics only.</p>
            <p className="mt-1 text-amber-50/85">
              OddSphere does not accept wagers, place bets, or guarantee outcomes. 21+ where applicable.
              Betting involves risk.{" "}
              <Link href="/legal/responsible-gambling" className="font-bold text-amber-100 underline underline-offset-2">
                Bet responsibly
              </Link>
              .
            </p>
          </div>
        </div>

        <div id="product-preview" className="min-w-0 max-w-full overflow-hidden">
          <DailyEdgePreview candidate={candidate} />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8">
        <SectionHeader
          eyebrow="Inside the Daily Edge"
          title={candidate ? "Scan the slate. Open the read. Go as deep as you need." : "The slate, the selected edge, and the accountability layer."}
          body={candidate
            ? "The first layer stays fast and readable. The complete reader keeps projections, price movement, public-versus-sharp splits, matchup stats, and supporting evidence available without crowding the board."
            : "OddSphere is designed around the actual decision flow: scan the board, open the strongest reads, and understand why each grade exists."}
        />
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              title: "Slate Scanner",
              body: "Sort the day by sport, market, Play Grade, and signal quality without digging through noisy one-off posts.",
            },
            {
              title: "Selected Edge",
              body: "Open a pick to see the projection, price/value context, market read, supporting evidence, and risk language.",
            },
            {
              title: "Tracking",
              body: "Posted Daily Edge results are tracked after settlement so the product stays accountable.",
            },
          ].map((item) => (
            <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.035] p-6">
              <h3 className="text-lg font-black text-white">{item.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-gray-300">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8">
        <div className="grid gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:p-7 lg:grid-cols-[0.95fr_1.05fr] lg:p-8">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">Why OddSphere is different</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">A sharper read than a pick alone.</h2>
          </div>
          <p className="text-base leading-relaxed text-gray-300">
            {candidate
              ? "OddSphere does more than surface a pick or trend. It connects the model projection to the live betting number, keeps public consensus separate from verified sharper-market signals where available, explains the matchup evidence, and tracks what the system actually posted."
              : "Most betting content gives you a pick and asks you to trust it. OddSphere shows the full read: the model projection, the market context, the grade, the risk, and the tracking behind the system."}
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8">
        <SectionHeader
          eyebrow="What members get"
          title={candidate ? "Daily Edge first, with deeper research when it matters." : "Everything needed to understand the slate."}
          body={candidate
            ? "Daily Edge remains the center of OddSphere. Player Props and Tracking extend the same workflow instead of turning the product into a wall of disconnected statistics."
            : "Daily Edge is built to make the board easier to scan, compare, and judge without exposing users to noisy tout-style copy."}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {displayedFeatures.map((feature) => (
            <div key={feature.title} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
              <h3 className="text-lg font-black text-white">{feature.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-gray-300">{feature.body}</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-6 max-w-3xl text-center text-sm leading-relaxed text-gray-400">
          Daily Edge currently supports active MLB, WNBA, and World Cup/Soccer slates. The public archive also tracks NFL, CFB, NBA, CBB, MLB, UCL/Soccer, and NHL model families, with seasonal member surfaces returning as leagues and data pipelines are active.
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
            {TRIAL_DISCLOSURE}
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
                <span className="text-gray-500 group-open:hidden" aria-hidden="true">+</span>
                <span className="hidden text-gray-500 group-open:inline" aria-hidden="true">-</span>
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

export default async function HomePage() {
  return (
    <HomePageContent
      presentation={isHomepageExperienceCandidateEnabled() ? "candidate" : "current"}
    />
  );
}
