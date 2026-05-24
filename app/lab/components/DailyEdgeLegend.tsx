"use client";

import Icon from "./Icon";

type Props = {
  onClose: () => void;
};

export default function DailyEdgeLegend({ onClose }: Props) {
  return (
    <section
      aria-label="How to read Daily Edge"
      className="relative bg-gradient-to-br from-gray-900/60 to-gray-950/60 border border-gray-800 rounded-xl p-5 sm:p-6 max-w-3xl mx-auto"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close how-to-read legend"
        className="absolute top-3 right-3 text-gray-400 hover:text-white p-1.5 rounded-md hover:bg-gray-800/70 transition-colors"
      >
        <Icon name="x" className="w-4 h-4" />
      </button>

      <h2 className="text-base sm:text-lg font-bold mb-5 flex items-center gap-2 tracking-tight">
        <span aria-hidden="true">🔍</span>
        How to read this
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 sm:gap-6 mb-5 text-sm">
        {/* Column 1: Verdict colors */}
        <div>
          <p className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-bold mb-3">
            Verdict colors
          </p>
          <ul className="space-y-2.5">
            <li className="flex items-start gap-2 text-gray-200">
              <span
                aria-hidden="true"
                className="inline-block w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0 shadow-[0_0_6px_rgba(52,211,153,0.6)]"
              />
              <span>
                <strong className="font-semibold text-emerald-300">STRONG</strong>{" "}
                — sharps support the model&rsquo;s pick on at least one market
              </span>
            </li>
            <li className="flex items-start gap-2 text-gray-200">
              <span
                aria-hidden="true"
                className="inline-block w-2 h-2 rounded-full bg-gray-500 mt-1.5 shrink-0"
              />
              <span>
                <strong className="font-semibold text-gray-200">No banner</strong>{" "}
                — no sharp signals detected. The model&rsquo;s pick speaks for itself.
              </span>
            </li>
            <li className="flex items-start gap-2 text-gray-200">
              <span
                aria-hidden="true"
                className="inline-block w-2 h-2 rounded-full bg-amber-400 mt-1.5 shrink-0 shadow-[0_0_6px_rgba(245,158,11,0.6)]"
              />
              <span>
                <strong className="font-semibold text-amber-300">CAUTION</strong>{" "}
                — sharps moving against the model&rsquo;s pick on at least one market
              </span>
            </li>
          </ul>
        </div>

        {/* Column 2: Sharp status per pick */}
        <div>
          <p className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-bold mb-3">
            Sharp status per pick
          </p>
          <ul className="space-y-2.5 text-gray-200">
            <li className="flex items-start gap-2">
              <Icon
                name="check"
                className="w-3.5 h-3.5 text-emerald-400 mt-1 shrink-0"
              />
              <span>Sharps confirm this pick</span>
            </li>
            <li className="flex items-start gap-2">
              <Icon
                name="minus"
                className="w-3.5 h-3.5 text-gray-400 mt-1 shrink-0"
              />
              <span>No clear sharp signal</span>
            </li>
            <li className="flex items-start gap-2">
              <Icon
                name="alert-triangle"
                className="w-3.5 h-3.5 text-amber-400 mt-1 shrink-0"
              />
              <span>Sharps moving against this pick</span>
            </li>
          </ul>
        </div>

        {/* Column 3: Model coloring */}
        <div>
          <p className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-bold mb-3">
            Model coloring
          </p>
          <ul className="space-y-2.5 text-gray-200">
            <li>
              <strong className="font-bold text-emerald-400">NRFI</strong> in
              green — model predicts no first-inning run
            </li>
            <li>
              <strong className="font-bold text-rose-400">YRFI</strong> in red —
              model predicts a first-inning run
            </li>
            <li className="text-gray-400 text-xs italic pt-1">
              Coloring shows model output only — sharp status is separate.
            </li>
          </ul>
        </div>
      </div>

      <p className="text-xs sm:text-sm text-violet-200/90 border-t border-gray-800/60 pt-4 italic leading-relaxed">
        Your model is the primary signal. Sharp data is context to help you weigh each play.
      </p>
    </section>
  );
}
