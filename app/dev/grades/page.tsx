/**
 * /dev/grades — Phase 6.3d visual verification surface for GradeBadge.
 *
 * Renders the badge in every grade × size × variant permutation so QA can
 * eyeball it without wiring the component into Daily Edge / Player Props
 * (which is 6.4/6.5 work). Not linked from any nav — direct URL only.
 *
 * Will be deleted once the badge is integrated into real UI in Phase 6.4.
 */

import GradeBadge, { ALL_GRADES } from "@/app/components/GradeBadge";

export const metadata = {
  title: "Dev · Grade Badge Preview",
  robots: "noindex",
};

export default function GradesPreviewPage() {
  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
      <header className="mb-10">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-300 mb-2">
          Phase 6.3d · dev preview
        </p>
        <h1 className="text-3xl font-black tracking-tight">
          GradeBadge — all 7 variants
        </h1>
        <p className="text-sm text-gray-300 mt-2 leading-relaxed">
          V2.1 6.3 final-grade pills. This page exists for visual QA of the
          new component. Removed when the badge is wired into Daily Edge in
          Phase 6.4.
        </p>
      </header>

      {/* Default (md) size, full label */}
      <section className="mb-10">
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-gray-400 mb-3">
          Default size (md)
        </h2>
        <div className="flex flex-wrap gap-3 p-5 bg-gray-900/60 border border-gray-800 rounded-xl">
          {ALL_GRADES.map((g) => (
            <GradeBadge key={g} grade={g} />
          ))}
        </div>
      </section>

      {/* Small variant */}
      <section className="mb-10">
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-gray-400 mb-3">
          Small (sm)
        </h2>
        <div className="flex flex-wrap gap-2 p-5 bg-gray-900/60 border border-gray-800 rounded-xl">
          {ALL_GRADES.map((g) => (
            <GradeBadge key={g} grade={g} size="sm" />
          ))}
        </div>
      </section>

      {/* Emoji-only compact mode */}
      <section className="mb-10">
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-gray-400 mb-3">
          Emoji-only (table mode)
        </h2>
        <div className="flex flex-wrap gap-2 p-5 bg-gray-900/60 border border-gray-800 rounded-xl">
          {ALL_GRADES.map((g) => (
            <GradeBadge key={g} grade={g} emojiOnly />
          ))}
        </div>
      </section>

      {/* Verdict-grouping reference */}
      <section className="text-xs text-gray-400 leading-relaxed space-y-2 mt-12 pt-6 border-t border-gray-800">
        <p>
          <span className="text-emerald-300">Green</span> verdicts (best_signal,
          sharp_confirmed) = both layers strong + aligned.
        </p>
        <p>
          <span className="text-sky-300">Cyan</span> verdicts (market_led,
          market_watch) = market activity without strong model conviction.
        </p>
        <p>
          <span className="text-gray-300">Gray</span> (model_only) = model
          edge alone, no market read.
        </p>
        <p>
          <span className="text-violet-300">Violet</span> (public_smoke) =
          recreational chase, no sharp confirmation.
        </p>
        <p>
          <span className="text-amber-300">Amber</span> (sharp_conflict) =
          sharps fading our pick — caution flag.
        </p>
      </section>
    </main>
  );
}
