import type { Metadata } from "next";
import Link from "next/link";

const SITE_URL = "https://www.oddsphereai.com";

type LinkItem = {
  href: string;
  label: string;
};

type CardItem = {
  title: string;
  body: string;
};

export type SeoLandingPageConfig = {
  slug: string;
  title: string;
  description: string;
  h1: string;
  eyebrow: string;
  intro: string;
  keywords: string[];
  whatYouGet: CardItem[];
  howItWorks: CardItem[];
  whyDifferent: CardItem[];
  memberView: CardItem[];
  relatedLinks: LinkItem[];
  ctaTitle: string;
  ctaBody: string;
};

export function seoLandingMetadata(config: SeoLandingPageConfig): Metadata {
  const path = `/${config.slug}`;
  return {
    title: config.title,
    description: config.description,
    alternates: { canonical: path },
    keywords: config.keywords,
    openGraph: {
      type: "website",
      url: path,
      title: config.title,
      description: config.description,
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: "OddSphere AI sports prediction platform preview",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      site: "@OddSphereAI",
      title: config.title,
      description: config.description,
      images: ["/og-image.png"],
    },
  };
}

function SectionHeader({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body?: string;
}) {
  return (
    <header className="mx-auto mb-8 max-w-3xl text-center">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-300">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
        {title}
      </h2>
      {body ? (
        <p className="mt-4 text-base leading-relaxed text-gray-300">{body}</p>
      ) : null}
    </header>
  );
}

function InfoGrid({ items }: { items: CardItem[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {items.map((item) => (
        <article key={item.title} className="rounded-xl border border-white/10 bg-white/[0.035] p-5">
          <h3 className="text-lg font-bold text-white">{item.title}</h3>
          <p className="mt-3 text-sm leading-relaxed text-gray-300">{item.body}</p>
        </article>
      ))}
    </div>
  );
}

function ProductPreviewPanel() {
  return (
    <div className="rounded-2xl border border-violet-500/25 bg-gray-950/80 p-5 shadow-[0_0_45px_rgba(139,92,246,0.14)] sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300">
            Daily Edge Preview
          </p>
          <h2 className="mt-2 text-2xl font-black text-white">Model read, market read, grade</h2>
        </div>
        <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-emerald-300">
          Lean
        </span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {[
          ["Model", "58%"],
          ["Market", "52%"],
          ["Edge", "+6pp"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">
              {label}
            </p>
            <p className="mt-1 text-xl font-black text-white">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.035] p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">
          Market Read
        </p>
        <p className="mt-2 text-sm leading-relaxed text-gray-200">
          The model case is positive and the current price is playable, while market context
          keeps the read measured rather than automatic.
        </p>
      </div>

      <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.035] p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300">
          Supporting Evidence
        </p>
        <p className="mt-2 text-sm leading-relaxed text-gray-200">
          OddSphere explains the projection, implied probability, price, movement, and available
          split context without exposing the full premium slate.
        </p>
      </div>
    </div>
  );
}

function JsonLd({ config }: { config: SeoLandingPageConfig }) {
  const url = `${SITE_URL}/${config.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${url}#webpage`,
        url,
        name: config.title,
        description: config.description,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: { "@id": `${SITE_URL}/#application` },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}/#application`,
        name: "OddSphere AI",
        applicationCategory: "SportsApplication",
        operatingSystem: "Web",
        url: SITE_URL,
        description:
          "OddSphere AI is a sports prediction and betting intelligence platform with model projections, market reads, Play Grades, and transparent tracking.",
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

export default function PublicSeoLandingPage({ config }: { config: SeoLandingPageConfig }) {
  return (
    <main>
      <JsonLd config={config} />

      <section className="mx-auto max-w-7xl px-4 pb-10 pt-16 sm:px-6 sm:pb-16 sm:pt-24 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div>
            <p className="inline-flex rounded-full border border-violet-400/30 bg-violet-400/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-violet-200">
              {config.eyebrow}
            </p>
            <h1 className="mt-6 text-4xl font-black tracking-tight text-white sm:text-6xl">
              {config.h1}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-gray-200">
              {config.intro}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/pricing"
                className="rounded-lg bg-violet-600 px-7 py-3.5 text-center text-sm font-bold text-white shadow-lg shadow-violet-900/40 transition hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
              >
                View Membership
              </Link>
              <Link
                href="/track-record"
                className="rounded-lg border border-white/15 bg-white/[0.04] px-7 py-3.5 text-center text-sm font-bold text-white transition hover:border-violet-400/40 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
              >
                See Tracking
              </Link>
            </div>
            <p className="mt-5 text-xs leading-relaxed text-gray-400">
              Informational sports analytics only. No outcome is guaranteed, and betting involves risk.
            </p>
          </div>
          <ProductPreviewPanel />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <SectionHeader
          eyebrow="What OddSphere gives you"
          title="A cleaner way to understand the board."
          body="Daily Edge turns model projections, price/value, market movement, and supported split context into simple reader sections."
        />
        <InfoGrid items={config.whatYouGet} />
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <SectionHeader
          eyebrow="How the model works"
          title="Model first, market aware."
          body="OddSphere does not present a pick without context. The reader connects the model case to price, movement, and evidence quality."
        />
        <InfoGrid items={config.howItWorks} />
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <SectionHeader
          eyebrow="Why it is different"
          title="Built to avoid tout-style noise."
        />
        <InfoGrid items={config.whyDifferent} />
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <SectionHeader
          eyebrow="What members see"
          title="Daily Edge is the main product."
          body="Members see organized predictions by sport and market, with Play Grades like Best Angle and Lean plus supporting evidence."
        />
        <InfoGrid items={config.memberView} />
      </section>

      <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <div className="rounded-2xl border border-violet-500/30 bg-violet-500/[0.08] p-6 text-center sm:p-10">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-200">
            Start with Daily Edge
          </p>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
            {config.ctaTitle}
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-gray-200">
            {config.ctaBody}
          </p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/pricing" className="rounded-lg bg-violet-600 px-7 py-3 text-sm font-bold text-white transition hover:bg-violet-500">
              Get Access
            </Link>
            <Link href="/track-record" className="rounded-lg border border-white/15 px-7 py-3 text-sm font-bold text-white transition hover:border-violet-400/40">
              View Track Record
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-5 text-sm leading-relaxed text-amber-50">
            OddSphere provides sports research, model projections, and market context for
            informational purposes. It is not a sportsbook, does not place bets, and does
            not guarantee outcomes or profits. Users are responsible for their own decisions
            and for following local laws. 21+ where applicable. If gambling is a problem,
            call 1-800-GAMBLER.
          </div>
          <nav className="rounded-xl border border-white/10 bg-white/[0.035] p-5" aria-label="Related pages">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400">
              Related guides
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {config.relatedLinks.map((link) => (
                <Link key={link.href} href={link.href} className="text-sm font-bold text-violet-200 hover:text-violet-100">
                  {link.label}
                </Link>
              ))}
            </div>
          </nav>
        </div>
      </section>
    </main>
  );
}

