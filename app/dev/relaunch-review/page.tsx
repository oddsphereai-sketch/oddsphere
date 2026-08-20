import Link from "next/link";
import { notFound } from "next/navigation";

import ProductAppFrame from "@/app/lab/components/ProductAppFrame";
import { DAILY_EDGE_SPORTS } from "@/app/lab/lib/dailyEdgeSports";
import { DAILY_EDGE_REVIEW_SLATES } from "@/app/lab/lib/dailyEdgeReviewSlates";
import { isProductExperiencePreviewAvailable } from "@/lib/config/productExperience";

export const metadata = {
  title: "OddSphere Founder Review",
  robots: { index: false, follow: false },
};

export default function RelaunchReviewPage() {
  if (!isProductExperiencePreviewAvailable()) notFound();
  const supported = DAILY_EDGE_SPORTS.filter((sport) => sport.memberAvailable);
  const planned = DAILY_EDGE_SPORTS.filter((sport) => !sport.memberAvailable);

  return (
    <ProductAppFrame>
      <div className="min-h-screen bg-[#070910] px-4 py-10 text-white sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="rounded-3xl border border-violet-400/20 bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.16),transparent_44%),rgba(255,255,255,0.025)] p-6 sm:p-9">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-200">Private · Founder approval required</p>
            <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">OddSphere relaunch review</h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-gray-300 sm:text-base">
              Review the complete product system here. Core experiences are presentation layers over OddSphere&apos;s proven live contracts. Clearly identified additions use bounded, audited sources. Everything remains behind authentication and disconnected from live member routes until its individual release switch is enabled.
            </p>
          </div>

          <ReviewSection title="Daily Edge" body="The core product. Review each supported model with a representative populated slate; the same board, reader state, and market contracts are used across sports.">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {supported.map((sport) => {
                const slate = DAILY_EDGE_REVIEW_SLATES[sport.key];
                if (!slate) return null;
                return (
                  <ReviewLink
                    key={sport.key}
                    href={`/dev/experience-preview?sport=${sport.key}&date=${slate.date}${slate.freshContractRead ? "&fresh=1" : ""}`}
                    eyebrow={slate.freshContractRead ? "Fresh read-only contract" : "Populated review slate"}
                    title={sport.label}
                    body={slate.note}
                  />
                );
              })}
            </div>
            <p className="mt-4 text-xs leading-5 text-gray-500">
              Planned model tabs remain visible but honestly unavailable: {planned.map((sport) => sport.label).join(", ")}. They are not presented as launched products.
            </p>
          </ReviewSection>

          <ReviewSection title="Supporting products" body="These candidates preserve Daily Edge as the center while making prop research and accountability feel like one OddSphere system.">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <ReviewLink href="/dev/premier-league-preview" eyebrow="Local shadow · Gameweek 1" title="Premier League" body="Friday-through-Monday weekly slate with coherent model probabilities, promoted-club uncertainty, retained completed matches, and no live grades or stakes." />
              <ReviewLink href="/dev/mlb-props-preview" eyebrow="Latest read-only snapshot" title="Player Props" body="Real prices and model rows first; research controls and complete available evidence remain on demand. A deterministic fixture remains available with ?source=fixture." />
              <ReviewLink href="/dev/tracking-preview" eyebrow="Live tracking payload" title="Tracking" body="Yesterday first, then weekly, monthly, and lifetime results grouped cleanly by sport and model. Recent grades and methodology remain available on demand." />
            </div>
          </ReviewSection>

          <ReviewSection title="Logged-out experience" body="Review the complete journey a prospective member sees before entering the product. The preview navigation keeps Homepage and Login connected so this can be tested as one flow.">
            <div className="grid gap-3 md:grid-cols-2">
              <ReviewLink href="/dev/homepage-preview" eyebrow="Pre-login candidate" title="Homepage" body="Daily Edge-led positioning with the current reader image, product hierarchy, tracking proof, and conversion story." />
              <ReviewLink href="/dev/login-preview" eyebrow="Member access candidate" title="Login" body="A professional OddSphere-branded Whop entry point that carries the same product hierarchy and visual system into sign-in." />
            </div>
          </ReviewSection>

          <ReviewSection title="Verified review coverage" body="These candidate behaviors have passed focused automated checks and desktop/mobile review. They still do not enable a live route.">
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                "Desktop and mobile navigation feel consistent",
                "Every board pill opens the matching reader market",
                "Public consensus and sharp-book splits are clearly distinct",
                "Expected data gaps fail readiness; true provider exceptions are explicit",
                "Player Props keeps advanced research without front-loading it",
                "Tracking totals reconcile to their category rows",
                "Homepage uses the current Daily Edge candidate image",
                "Production build and focused product-safety checks pass",
              ].map((item) => (
                <div key={item} className="flex gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4 text-sm text-gray-200">
                  <span aria-hidden="true" className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-emerald-400/35 bg-emerald-400/10 text-[9px] font-black text-emerald-200">✓</span>
                  {item}
                </div>
              ))}
            </div>
          </ReviewSection>

          <ReviewSection title="Required at approved cutover" body="These are intentionally not executed during private review because they write warm snapshots, enable member routes, or require the production-like staging environment.">
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                "Prime Daily Edge and Tracking warm snapshots, then rerun slate readiness",
                "Verify same-book price trails, cron health, and current release IDs in staging",
                "Verify candidate and live snapshots report the approved immutable release identifiers",
                "Run production-like concurrency, member-session, and rollback smoke checks",
                "If Player Props launches, enable and verify refresh, tracking, settlement, and coverage gates",
                "Enable candidate switches only after explicit founder approval",
              ].map((item) => (
                <div key={item} className="flex gap-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.035] p-4 text-sm text-amber-50/90">
                  <span aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 rounded border border-amber-300/35 bg-amber-300/10" />
                  {item}
                </div>
              ))}
            </div>
          </ReviewSection>

          <div className="mt-10 rounded-2xl border border-amber-300/20 bg-amber-300/[0.05] p-5 text-sm leading-6 text-amber-50/90">
            No candidate switch is enabled by default. Final launch still requires your approval, a clean intentional commit, production smoke checks, and rollback verification.
          </div>
        </div>
      </div>
    </ProductAppFrame>
  );
}

function ReviewSection({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-black tracking-tight sm:text-2xl">{title}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">{body}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function ReviewLink({ href, eyebrow, title, body }: { href: string; eyebrow: string; title: string; body: string }) {
  return (
    <Link href={href} className="group rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 transition hover:border-violet-300/30 hover:bg-violet-400/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
      <p className="text-[9px] font-black uppercase tracking-[0.18em] text-violet-200/75">{eyebrow}</p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <h3 className="text-lg font-black">{title}</h3>
        <span aria-hidden="true" className="text-gray-600 transition group-hover:translate-x-0.5 group-hover:text-violet-200">→</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-gray-400">{body}</p>
    </Link>
  );
}
