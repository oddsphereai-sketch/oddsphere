import type { Metadata } from "next";
import Image, { getImageProps } from "next/image";
import Link from "next/link";
import { HomepageDashboardPrototype } from "@/app/components/HomepageDashboardPrototype";
import { HomepageTrackingCategoryBoard } from "@/app/components/HomepageTrackingCategoryBoard";
import { isHomepageExperienceCandidateEnabled } from "@/lib/config/productExperience";
import {
  getPublicTrackRecordSummary,
  type PublicTrackRecordSummary,
} from "@/lib/services/tracking/publicTrackRecordSummary";
import {
  MONTHLY_TRIAL_DISCLOSURE,
  PRICING_PAGE_URL,
} from "@/lib/marketing/trialOffer";

const SITE_URL = "https://www.oddsphereai.com";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "OddSphere AI | Sports Prediction & Market Intelligence",
  description:
    "Explore model predictions, compare them with the market, understand Play Grades, inspect matchup research, and review tracked results with OddSphere AI Daily Edge.",
  alternates: { canonical: "/" },
  keywords: [
    "AI sports predictions",
    "sports betting intelligence",
    "MLB predictions",
    "NFL predictions",
    "college football predictions",
    "NBA predictions",
    "college basketball predictions",
    "WNBA predictions",
    "soccer predictions",
    "World Cup predictions",
    "Champions League predictions",
    "NHL predictions",
    "sports prediction models",
    "market movement analysis",
    "sports model dashboard",
  ],
  openGraph: {
    type: "website",
    url: "/",
    title: "OddSphere AI | Sports Prediction & Market Intelligence",
    description:
      "Model predictions, market comparison, Play Grades, matchup research, and tracked results in one Daily Edge dashboard.",
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
      "Explore model predictions, compare them with the market, and understand the reasoning behind each Daily Edge read.",
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
    title: "Model projections",
    body: "Projected scores and probabilities for supported matchups and markets.",
  },
  {
    title: "Play Grades",
    body: "Understand how the available price and supporting context affect the grade.",
  },
  {
    title: "Market context",
    body: "Explore price movement, public consensus, and verified sharp-book signals where available.",
  },
  {
    title: "Supporting evidence",
    body: "Look into the matchup information behind the projection.",
  },
  {
    title: "Tracked results",
    body: "Review recorded prediction outcomes by sport, market, and available period.",
  },
  {
    title: "Player Props",
    body: "Explore supported prop markets, pricing, recent results, and matchup context.",
  },
];

const workflowSteps: StepCard[] = [
  {
    title: "The model projects the game",
    body: "Daily Edge presents sport-specific projected scores and probabilities before the market comparison.",
  },
  {
    title: "The market is compared",
    body: "The available price, movement, public consensus, and verified sharp-book signals are shown where available.",
  },
  {
    title: "The Play Grade is explained",
    body: "The grade connects the projection with available price and supporting context without making every forecast actionable.",
  },
];

const faq: FaqItem[] = [
  {
    q: "What do I get during the free trial?",
    a: "The monthly trial includes Daily Edge access with model projections, market context, Play Grades, supporting evidence, tracked results, and supported Player Props coverage.",
  },
  {
    q: "When am I charged?",
    a: "The monthly plan is free for 7 days, then renews at $19.99/month unless canceled. The annual plan is $199/year, billed immediately, with no free trial.",
  },
  {
    q: "Can I cancel before the trial ends?",
    a: "Yes. Membership and cancellation are managed through Whop. Cancel the monthly plan through your Whop account before the trial ends to avoid the first charge.",
  },
  {
    q: "What sports does Daily Edge cover?",
    a: "Daily Edge supports major baseball, football, basketball, hockey, and soccer competitions. Sports, markets, and Player Props boards vary by season and verified data availability.",
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

function formatTrackingDate(yyyyMmDd: string): string {
  const [year, month, day] = yyyyMmDd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function TrackingPreview({ summary }: { summary: PublicTrackRecordSummary }) {
  const official = summary.currentOfficial;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-emerald-300/15 bg-[radial-gradient(circle_at_top_right,rgba(52,211,153,0.12),transparent_38%),rgba(3,7,18,0.82)] p-5 shadow-[0_32px_90px_rgba(0,0,0,0.28)] sm:p-8">
      <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-emerald-400/10 blur-3xl" />
      <div className="relative">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">Tracked results</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">Explore the tracked results.</h2>
            <p className="mt-4 text-sm leading-relaxed text-gray-300 sm:text-base">
              Review prediction results by sport, market, and available period.
            </p>
          </div>
        </div>
        <div className="mt-8 flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="text-lg font-black text-white sm:text-xl">Tracking by category</h3>
          <p className="text-xs font-semibold text-gray-500">Sport and market records</p>
        </div>
        <HomepageTrackingCategoryBoard
          windows={summary.categoryTracking.windows}
          available={summary.categoryTracking.available}
        />
        <p className="mt-5 text-xs leading-relaxed text-gray-500">
          {official
            ? `Results updated through ${formatTrackingDate(official.latestActivityDate)}. `
            : "Results update after settlement. "}
          Pushes are shown in the record and excluded from hit rate. Win rate measures prediction accuracy, not betting returns. Past performance does not guarantee future results.
        </p>
      </div>
    </div>
  );
}

function DailyEdgeOverviewImage() {
  const common = {
    alt: "OddSphere Daily Edge member reader showing a sample NYM at TOR matchup, projected score, outcome forecast, market prices, Best Angle Play Grade, and supporting matchup evidence",
    sizes: "(min-width: 1024px) 70vw, (min-width: 640px) 92vw, 100vw",
  };
  const {
    props: { srcSet: desktopSrcSet },
  } = getImageProps({
    ...common,
    src: "/marketing/daily-edge-member-overview-desktop-consensus-sample.jpg",
    width: 1240,
    height: 920,
    quality: 75,
    fetchPriority: "high",
  });
  const {
    props: { srcSet: mobileSrcSet, alt: mobileAlt, ...mobileProps },
  } = getImageProps({
    ...common,
    src: "/marketing/daily-edge-member-overview-mobile-consensus-sample.jpg",
    width: 350,
    height: 400,
    quality: 75,
    fetchPriority: "high",
  });

  return (
    <picture>
      <source media="(min-width: 640px)" srcSet={desktopSrcSet} />
      <source media="(max-width: 639px)" srcSet={mobileSrcSet} />
      <img
        {...mobileProps}
        alt={mobileAlt}
        className="h-auto w-full bg-[#07060d] object-cover"
        style={{ width: "100%", height: "auto" }}
      />
    </picture>
  );
}

function DailyEdgePreview() {
  return (
    <div aria-label="Daily Edge product preview" className="relative">
      <div className="absolute -inset-5 rounded-[2rem] bg-violet-700/20 blur-3xl" />
      <div className="relative rounded-2xl border border-violet-400/30 bg-[#080712] p-3 shadow-[0_0_90px_rgba(124,58,237,0.22)] sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1 pb-3 sm:px-2">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-200">Actual Daily Edge member interface</p>
            <p className="mt-1 text-xs text-gray-400">Explore a matchup and the market context behind it.</p>
          </div>
          <div className="flex gap-1.5" aria-hidden="true">
            <span className="h-2 w-2 rounded-full bg-emerald-300/80" />
            <span className="h-2 w-2 rounded-full bg-violet-300/70" />
            <span className="h-2 w-2 rounded-full bg-white/30" />
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.72fr)_minmax(290px,0.58fr)] lg:items-start">
          <figure className="min-w-0 overflow-hidden rounded-xl border border-white/10 bg-black/30">
            <a
              href="/marketing/daily-edge-member-overview-desktop-consensus-sample.jpg"
              target="_blank"
              rel="noreferrer"
              aria-label="Open the Daily Edge matchup overview at full size"
              className="group relative block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              <DailyEdgeOverviewImage />
              <span className="absolute bottom-3 right-3 rounded-md border border-white/15 bg-black/80 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-white opacity-90 transition group-hover:bg-black group-focus-visible:bg-black">
                Open full size ↗
              </span>
            </a>
            <figcaption className="border-t border-white/10 p-3 sm:p-4">
              <p className="text-sm font-black text-white">Matchup overview</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-400">
                Predictions, projected score, exact-price decision, Play Grade, and supporting matchup evidence in the member reader.
              </p>
            </figcaption>
          </figure>

          <figure className="min-w-0 overflow-hidden rounded-xl border border-white/10 bg-black/30">
            <a
              href="/marketing/daily-edge-member-market-context-consensus-sample.jpg"
              target="_blank"
              rel="noreferrer"
              aria-label="Open the Daily Edge market context detail at full size"
              className="group relative block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              <Image
                src="/marketing/daily-edge-member-market-context-consensus-sample.jpg"
                alt="Daily Edge market context detail showing consensus price movement, public consensus, sharp-book splits, and a cross-source read"
                width={450}
                height={730}
                sizes="(min-width: 1024px) 28vw, 100vw"
                className="h-auto w-full bg-[#07060d]"
              />
              <span className="absolute bottom-3 right-3 rounded-md border border-white/15 bg-black/80 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-white opacity-90 transition group-hover:bg-black group-focus-visible:bg-black">
                Open full size ↗
              </span>
            </a>
            <figcaption className="border-t border-white/10 p-3 sm:p-4">
              <p className="text-sm font-black text-white">Market context detail</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-400">
                Consensus price movement, public consensus, sharp-book information, and the cross-source read in this illustrative example.
              </p>
            </figcaption>
          </figure>
        </div>

        <p className="px-1 pt-3 text-[11px] leading-relaxed text-gray-500 sm:px-2">
          Illustrative MLB example dated Aug. 10, 2026. Not a current recommendation or actual result.
        </p>
      </div>
      <div className="relative mx-auto -mt-1 flex max-w-2xl flex-wrap justify-center gap-2 px-4 pt-4">
        {["Projected score", "Play Grades", "Odds movement", "Public + sharp context"].map((label) => (
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

  return (
    <main className="overflow-hidden">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <section className={`mx-auto grid max-w-7xl items-center gap-8 px-4 pb-12 pt-8 sm:px-6 sm:pb-14 sm:pt-10 lg:px-8 ${candidate ? "grid-cols-[minmax(0,1fr)]" : "lg:grid-cols-[0.88fr_1.12fr]"}`}>
        <div className={candidate ? "min-w-0 max-w-4xl" : undefined}>
          <p className="inline-flex rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1.5 text-xs font-black uppercase tracking-[0.16em] text-emerald-200">
            OddSphere AI · Daily Edge
          </p>
          <h1 className="mt-5 max-w-4xl break-words text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">
            Understand the matchup before you make your call.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-gray-200">
            Explore model predictions, compare them with the market, and understand the reasoning behind each read. Daily Edge brings projections, Play Grades, and matchup research into one place.
          </p>
          <div className="mt-6 flex min-w-0 flex-col gap-3 sm:flex-row">
            <TrialButton className="w-full sm:w-auto" />
            <HomepageDashboardPrototype />
          </div>
          <Link
            href="/how-it-works"
            className="mt-4 inline-flex text-sm font-bold text-violet-200 transition hover:text-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
          >
            See how OddSphere works
          </Link>
          <p className="mt-3 text-sm font-semibold leading-relaxed text-violet-100">
            {MONTHLY_TRIAL_DISCLOSURE}
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
          <DailyEdgePreview />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8">
        <SectionHeader
          eyebrow="Inside the Daily Edge"
          title="From the slate to the reasoning."
          body="Choose a matchup, compare the projection with the market, and explore what supports the read."
        />
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              title: "Scan the slate",
              body: "Browse available matchups and use the existing filters to focus your research.",
            },
            {
              title: "Open a matchup",
              body: "Review projected scores, probabilities, Play Grades, and available price context.",
            },
            {
              title: "Explore the reasoning",
              body: "Inspect matchup evidence, market movement, and public and sharp-book splits where available.",
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
            <h2 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">See why the model favors a side, and how the price affects the grade.</h2>
          </div>
          <p className="text-base leading-relaxed text-gray-300">
            A predicted winner is only part of the picture. Daily Edge connects the projection with the available price, market context, and matchup evidence so you can understand the grade behind the read.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-18 lg:px-8">
        <SectionHeader
          eyebrow="What members get"
          title="Your research, in one place."
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
          Coverage varies by sport, season, market, and data availability.
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
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-200">OddSphere AI · Daily Edge</p>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-5xl">Explore Daily Edge free for 7 days.</h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-gray-200 sm:text-base">
            Open the board, explore a matchup, and see how the projections, grades, and market context fit your research.
          </p>
          <p className="mt-4 text-sm font-bold text-emerald-100">
            {MONTHLY_TRIAL_DISCLOSURE}
          </p>
          <p className="mt-2 text-xs font-semibold text-gray-400">Membership and cancellation managed through Whop.</p>
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
