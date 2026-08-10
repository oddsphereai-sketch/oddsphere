import Link from "next/link";
import { notFound } from "next/navigation";

import { isProductExperiencePreviewAvailable } from "@/lib/config/productExperience";
import { sanitizeNext } from "@/lib/auth/betaSession";
import { TRIAL_CHECKOUT_URL, TRIAL_DISCLOSURE } from "@/lib/marketing/trialOffer";

export const metadata = {
  title: "OddSphere Login Preview",
  robots: { index: false, follow: false },
};

export default async function LoginPreviewPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; surface?: string }> }) {
  if (!isProductExperiencePreviewAvailable()) notFound();
  const params = await searchParams;
  const nextValue = typeof params.next === "string" ? sanitizeNext(params.next) : "/lab/daily-edge";
  const whopStartHref = `/api/auth/whop/start?next=${encodeURIComponent(nextValue)}`;
  const hasError = typeof params.error === "string" && params.error.length > 0;
  const isMemberSurface = params.surface === "member";

  return (
    <main className="relative overflow-hidden px-4 py-10 sm:px-6 sm:py-16 lg:px-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_24%_18%,rgba(124,58,237,0.20),transparent_34%),radial-gradient(circle_at_78%_64%,rgba(52,211,153,0.08),transparent_34%)]" />
      <div className="mx-auto grid max-w-6xl overflow-hidden rounded-3xl border border-white/[0.09] bg-[#090a10]/95 shadow-[0_30px_120px_-50px_rgba(124,58,237,0.85)] lg:grid-cols-[1.08fr_0.92fr]">
        <section className="border-b border-white/[0.07] bg-[linear-gradient(145deg,rgba(124,58,237,0.13),rgba(255,255,255,0.015)_52%,rgba(16,185,129,0.04))] p-7 sm:p-10 lg:border-b-0 lg:border-r lg:p-12">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-200">OddSphere member access</p>
          <h1 className="mt-4 max-w-xl text-4xl font-black tracking-tight text-white sm:text-5xl">Your Daily Edge is ready.</h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-gray-300">
            Sign in to scan today&rsquo;s slate, open the complete game reader, research player props, and review every graded result in one OddSphere workspace.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            {[
              ["Daily Edge", "Model, market and matchup"],
              ["Player Props", "Fast board, deeper research"],
              ["Tracking", "Transparent graded results"],
            ].map(([title, body]) => (
              <div key={title} className="rounded-xl border border-white/[0.08] bg-black/20 p-4">
                <p className="text-sm font-black text-white">{title}</p>
                <p className="mt-1 text-xs leading-5 text-gray-500">{body}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-2xl border border-violet-400/20 bg-[#0e0d17] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.17em] text-violet-200">Today&rsquo;s workflow</p>
                <p className="mt-1 text-sm font-black text-white">Scan → open → understand</p>
              </div>
              <span className="rounded-full border border-emerald-400/25 bg-emerald-400/[0.08] px-3 py-1 text-[9px] font-black uppercase tracking-wider text-emerald-200">Member dashboard</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2" aria-hidden="true">
              <span className="h-2 rounded-full bg-violet-400/75" />
              <span className="h-2 rounded-full bg-sky-400/65" />
              <span className="h-2 rounded-full bg-emerald-400/70" />
            </div>
          </div>
        </section>

        <section className="flex items-center p-7 sm:p-10 lg:p-12">
          <div className="w-full">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">Welcome back</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-white">Member Login</h2>
            <p className="mt-3 text-sm leading-6 text-gray-400">Use the Whop account connected to your OddSphere membership or trial.</p>

            {hasError ? <div role="alert" className="mt-5 rounded-xl border border-amber-300/25 bg-amber-300/[0.07] p-3 text-xs leading-5 text-amber-100">We couldn&rsquo;t complete that sign-in. Please try again; if the problem continues, contact OddSphere support.</div> : null}

            <a href={whopStartHref} className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3.5 text-sm font-black text-white shadow-[0_12px_35px_-18px_rgba(124,58,237,0.95)] transition hover:bg-violet-500">
              <span aria-hidden="true">◇</span>
              Sign in with Whop
            </a>

            <div className="mt-5 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4 text-xs leading-5 text-gray-500">
              Secure membership verification is handled through Whop. OddSphere does not receive your Whop password.
            </div>

            <p className="mt-6 text-sm text-gray-400">
              Not a member yet?{" "}
              <Link href={TRIAL_CHECKOUT_URL} className="font-black text-emerald-300 underline decoration-emerald-300/40 underline-offset-4 hover:text-emerald-200">
                Start your free trial
              </Link>
            </p>
            <p className="mt-2 text-[11px] leading-5 text-gray-600">{TRIAL_DISCLOSURE}</p>

            {!isMemberSurface ? <div className="mt-8 border-t border-white/[0.06] pt-5">
              <Link href="/dev/relaunch-review" className="text-[10px] font-black uppercase tracking-[0.15em] text-violet-200 hover:text-violet-100">← Back to founder review</Link>
              <p className="mt-3 text-[10px] leading-5 text-amber-100/55">Private candidate. Sign-in continues through the existing secure Whop OAuth route.</p>
            </div> : null}
          </div>
        </section>
      </div>
    </main>
  );
}
