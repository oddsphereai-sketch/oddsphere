"use client";

/**
 * CalibrationDisplay — "we admit our biases" section on the Tracking page.
 *
 * Reads /api/lab/calibration via useCalibration. Renders:
 *   • A hero callout with the most newsworthy bucket ("When we say 60%, we
 *     hit 57%."). Color-coded — red for negative delta (overconfident),
 *     emerald for positive delta (underconfident).
 *   • A table/grid with every displayable game-level bucket, sample size,
 *     expected vs actual hit rate, and signed delta.
 *
 * V1 carve-out (locked after 5C): prop calibration is excluded — the route
 * already filters server-side. The headline text reads "game moneylines"
 * / "game totals" / "first-inning runs" so members never wonder why prop
 * calibration is absent. Phase 9+ revisits with ROI/CLV.
 */

import { useCalibration } from "../../hooks/useCalibration";
import type { CalibrationBucket } from "../../lib/labTypes";

const CARD =
  "bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 rounded-xl transition-all duration-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]";

const PREDICTION_LABEL: Record<CalibrationBucket["predictionType"], string> = {
  game_ml: "Moneyline",
  game_total: "Total (O/U)",
  game_nrfi: "NRFI / YRFI",
};

function pct1(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function signedPp(delta: number): string {
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}pp`;
}

function deltaColor(delta: number): string {
  // ±2pp considered noise — render neutral.
  if (Math.abs(delta) < 2) return "text-gray-300";
  if (delta < 0) return "text-rose-300";
  return "text-emerald-300";
}

export default function CalibrationDisplay() {
  const { data, error, isLoading } = useCalibration();

  return (
    <section>
      <header className="mb-4">
        <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">
          🎯 Calibration Honesty
        </h2>
        <p className="text-sm text-gray-400 mt-1">
          We track our own calibration so you can adjust expectations.
        </p>
      </header>

      {error ? (
        <ErrorState message={error.message} />
      ) : isLoading && !data ? (
        <LoadingSkeleton />
      ) : !data || data.buckets.length === 0 ? (
        <EmptyState />
      ) : (
        <CalibrationContent data={data} />
      )}
    </section>
  );
}

function CalibrationContent({
  data,
}: {
  data: NonNullable<ReturnType<typeof useCalibration>["data"]>;
}) {
  const { buckets, headline } = data;

  return (
    <div className={`${CARD} p-5 sm:p-6`}>
      {/* Hero callout */}
      {headline && (
        <div className="mb-6 pb-5 border-b border-gray-800/60">
          <p className="text-[10px] uppercase tracking-[0.12em] text-violet-300 font-bold mb-2">
            Headline finding
          </p>
          <p className="text-base sm:text-lg text-gray-100 leading-snug">
            {headline.summary}
          </p>
          <p className="text-xs text-gray-500 mt-2 italic">
            Based on {headline.bucket.sampleSize.toLocaleString()} resolved
            predictions across all sports.
          </p>
        </div>
      )}

      {/* Desktop: table */}
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold border-b border-gray-800/60">
              <th className="text-left py-2.5 pr-3 font-semibold">Market</th>
              <th className="text-left py-2.5 pr-3 font-semibold">Confidence bucket</th>
              <th className="text-right py-2.5 pr-3 font-semibold">Sample</th>
              <th className="text-right py-2.5 pr-3 font-semibold">Expected</th>
              <th className="text-right py-2.5 pr-3 font-semibold">Actual</th>
              <th className="text-right py-2.5 pr-3 font-semibold">Delta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60">
            {buckets.map((b) => (
              <BucketRow key={`${b.predictionType}-${b.label}`} bucket={b} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards */}
      <div className="md:hidden space-y-3">
        {buckets.map((b) => (
          <BucketCard key={`${b.predictionType}-${b.label}`} bucket={b} />
        ))}
      </div>

      <p className="mt-6 pt-5 border-t border-gray-800/60 text-xs text-gray-500 italic leading-relaxed">
        Calibration is recomputed every Sunday from the prior week&rsquo;s
        resolved predictions. Buckets need at least 30 resolved picks before
        they appear — smaller samples carry too much noise to publish honestly.
        V1 covers game-level markets only; prop calibration arrives once the
        prop model has enough history to track.
      </p>
    </div>
  );
}

function BucketRow({ bucket }: { bucket: CalibrationBucket }) {
  return (
    <tr className="hover:bg-gray-900/40 transition-colors">
      <td className="py-3 pr-3 align-middle text-sm text-gray-100 font-medium whitespace-nowrap">
        {PREDICTION_LABEL[bucket.predictionType]}
      </td>
      <td className="py-3 pr-3 align-middle text-sm text-gray-200 whitespace-nowrap">
        {bucket.label}
      </td>
      <td className="py-3 pr-3 align-middle text-sm text-right tabular-nums text-gray-200 whitespace-nowrap">
        {bucket.sampleSize.toLocaleString()}
      </td>
      <td className="py-3 pr-3 align-middle text-sm text-right tabular-nums text-gray-300 whitespace-nowrap">
        {pct1(bucket.expectedHitRate)}
      </td>
      <td className="py-3 pr-3 align-middle text-sm text-right tabular-nums text-gray-100 font-semibold whitespace-nowrap">
        {pct1(bucket.actualHitRate)}
      </td>
      <td className={`py-3 pr-3 align-middle text-sm text-right tabular-nums font-bold whitespace-nowrap ${deltaColor(bucket.calibrationDelta)}`}>
        {signedPp(bucket.calibrationDelta)}
      </td>
    </tr>
  );
}

function BucketCard({ bucket }: { bucket: CalibrationBucket }) {
  return (
    <div className="bg-gray-900/40 border border-gray-800/60 rounded-lg p-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div>
          <p className="text-sm font-medium text-gray-100">
            {PREDICTION_LABEL[bucket.predictionType]}
          </p>
          <p className="text-xs text-gray-400">{bucket.label} bucket</p>
        </div>
        <span className={`text-base font-bold tabular-nums ${deltaColor(bucket.calibrationDelta)}`}>
          {signedPp(bucket.calibrationDelta)}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs tabular-nums">
        <div>
          <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold mb-0.5">
            Sample
          </p>
          <p className="text-gray-100">{bucket.sampleSize.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold mb-0.5">
            Expected
          </p>
          <p className="text-gray-300">{pct1(bucket.expectedHitRate)}</p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold mb-0.5">
            Actual
          </p>
          <p className="text-gray-100 font-semibold">
            {pct1(bucket.actualHitRate)}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Loading / empty / error ──────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className={`${CARD} p-5 sm:p-6 animate-pulse`} aria-hidden="true">
      <div className="h-3 w-32 rounded bg-gray-800 mb-3" />
      <div className="h-6 rounded bg-gray-800/70 mb-6" />
      <div className="space-y-2">
        <div className="h-8 rounded bg-gray-800/50" />
        <div className="h-8 rounded bg-gray-800/50" />
        <div className="h-8 rounded bg-gray-800/50" />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className={`${CARD} p-6 text-sm text-gray-300`}>
      <p className="mb-2">
        Not enough resolved game-level picks yet to publish a calibration
        bucket honestly.
      </p>
      <p className="text-xs text-gray-500 italic">
        Each bucket needs at least 30 resolved picks before it appears. Check
        back as the season progresses.
      </p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="bg-rose-950/40 border border-rose-800/50 rounded-xl p-6 text-sm text-rose-100">
      <p className="font-semibold text-rose-200 mb-1">
        Couldn&rsquo;t load calibration data.
      </p>
      <p className="text-rose-100/80 leading-relaxed">{message}</p>
    </div>
  );
}
