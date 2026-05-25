"use client";

import Icon from "./Icon";
import GradeBadge, { ALL_GRADES } from "@/app/components/GradeBadge";
import { getAttribution, PICK_PLACEHOLDER } from "../lib/gradeAttribution";

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

      {/* Grade catalog — 7 rows of badge + V2.1-verbatim attribution copy.
          The legend pulls from the SAME getAttribution source the card does,
          passing the literal "[pick]" placeholder so members see the
          variable's position in the best_signal sentence. */}
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-bold mb-3">
          Grades
        </p>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2.5 text-sm">
          {ALL_GRADES.map((g) => (
            <li key={g} className="flex items-start gap-2.5">
              <span className="shrink-0 mt-0.5">
                <GradeBadge grade={g} context="daily-edge" size="sm" />
              </span>
              <span className="text-gray-300 leading-snug">
                {getAttribution(g, PICK_PLACEHOLDER)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6 mb-5 text-sm">
        {/* Sharp status per pick (unchanged — still relevant per-tile) */}
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

        {/* Model coloring — V2.1 6.4 fix: YRFI in violet, not rose */}
        <div>
          <p className="text-[10px] uppercase tracking-[0.12em] text-gray-400 font-bold mb-3">
            1st-inning pick coloring
          </p>
          <ul className="space-y-2.5 text-gray-200">
            <li>
              <strong className="font-bold text-emerald-400">NRFI</strong> in
              green — model predicts no first-inning run
            </li>
            <li>
              <strong className="font-bold text-violet-400">YRFI</strong> in
              violet — model predicts a first-inning run
            </li>
            <li className="text-gray-400 text-xs italic pt-1">
              Both are valid picks — the color is direction, not value.
            </li>
          </ul>
        </div>
      </div>

      <p className="text-xs sm:text-sm text-violet-200/90 border-t border-gray-800/60 pt-4 italic leading-relaxed">
        The grade blends the model edge with the market read. Sharp status on
        each tile is the per-pick detail behind the headline grade.
      </p>
    </section>
  );
}
