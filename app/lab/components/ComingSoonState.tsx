"use client";

import type { Sport } from "../data/mockData";
import { SPORT_META } from "../data/mockData";

type Props = {
  sport: Sport;
};

export default function ComingSoonState({ sport }: Props) {
  const meta = SPORT_META[sport];
  return (
    <div className="min-h-[420px] sm:min-h-[520px] flex items-center justify-center px-4">
      <div className="text-center max-w-md w-full bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-2xl px-6 py-10 sm:py-14">
        <div className="text-6xl sm:text-7xl mb-6" aria-hidden="true">
          {meta.icon}
        </div>
        <p className="text-xs font-bold uppercase tracking-wider text-violet-300 mb-3">
          {meta.comingSoonLabel ?? "Coming soon"}
        </p>
        <h2 className="text-2xl sm:text-3xl font-black mb-4 tracking-tight">
          {meta.label} research
        </h2>
        <p className="text-base text-gray-200 mb-8 leading-relaxed">
          Tested signals, sortable views, and edge-vs-market tools — built specifically for {meta.label}.
        </p>
        <button
          type="button"
          disabled
          className="inline-block bg-violet-600/30 text-violet-200 font-semibold px-8 py-3 rounded-md border border-violet-500/30 cursor-not-allowed"
        >
          Get notified when it launches
        </button>
        <p className="text-xs text-gray-400 italic mt-4">
          (Notification signup wires up closer to launch.)
        </p>
      </div>
    </div>
  );
}
