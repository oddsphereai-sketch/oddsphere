"use client";

/**
 * MyBetsStub — V1 placeholder for /lab/my-bets (V2.1 spec Part 11).
 *
 * V2.1: "Coming Soon page with feature preview list. No real build."
 * Full implementation lands in Phase 9 (post-launch) once user_bets +
 * user_settings tables exist.
 */

const FEATURE_PREVIEW = [
  "Log any bet you place — by hand or in one click from a Lab card later on",
  "Personal hit rate, ROI, and unit-sized P/L across every market you play",
  "See where your edge actually lives — sport, market, sportsbook, line range",
  "Compare your hit rate against the model's grade for the same picks",
  "Streaks, weekly recaps, and a calibration view of your own bets",
];

export default function MyBetsStub() {
  return (
    <div className="max-w-2xl mx-auto py-12 sm:py-20">
      <div className="bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-2xl p-8 sm:p-12">
        <p className="inline-block text-[10px] font-bold uppercase tracking-wider text-gray-300 bg-gray-800/60 border border-gray-700 rounded-full px-3 py-1 mb-4">
          Coming soon
        </p>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-3">
          My Bets
        </h1>
        <p className="text-base text-gray-200 leading-relaxed mb-6">
          Track every bet you place, measure your personal hit rate, and see
          where your edge really comes from over time.
        </p>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-violet-300 mb-3">
          What lands first
        </p>
        <ul className="space-y-2 text-sm text-gray-300">
          {FEATURE_PREVIEW.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span aria-hidden="true" className="text-violet-400 mt-1">·</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-gray-500 italic mt-6 pt-4 border-t border-gray-800/60">
          Premium members get this at no extra charge when it ships.
        </p>
      </div>
    </div>
  );
}
