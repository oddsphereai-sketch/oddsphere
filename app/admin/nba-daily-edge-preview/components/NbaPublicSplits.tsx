/**
 * Phase 7B v0c-DE — NBA public splits panel.
 *
 * Shows bets% and handle% per side for ML / spread / total, with the
 * NBA-specific interpretation:
 *
 *   • Money outpacing bets ≥10pp → sharp signal on that side.
 *   • Money outpacing bets 5–10pp → mild sharp lean.
 *   • Bets outpacing money ≥10pp → public-heavy; do NOT auto-fade.
 *   • Splits are CONSENSUS only — single source, not per-book.
 *
 * Honest when the source is unavailable.
 */

import type { MarketIntelligence } from "@/lib/services/nba/nbaMarketIntelligence";
import { DIVERGENCE_TINT } from "./NbaVerdictPalette";

function fmtPct(p: number | null): string {
  if (p === null) return "—";
  return `${Math.round(p * 100)}%`;
}

function SplitsBar({
  label,
  left,
  right,
  leftPct,
  rightPct,
  leftHandle,
  rightHandle,
}: {
  label: string;
  left: string;
  right: string;
  leftPct: number | null;
  rightPct: number | null;
  leftHandle: number | null;
  rightHandle: number | null;
}) {
  const leftPctNum = leftPct ?? 0;
  const rightPctNum = rightPct ?? 0;
  const leftHandleNum = leftHandle ?? 0;
  const rightHandleNum = rightHandle ?? 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-400">
        <span>{label}</span>
        <span className="font-mono">{left} · {right}</span>
      </div>
      <div className="space-y-1">
        <div className="space-y-0.5">
          <div className="flex items-center justify-between text-[10px] text-gray-500">
            <span>Bets</span>
            <span className="font-mono text-gray-300">{fmtPct(leftPct)} / {fmtPct(rightPct)}</span>
          </div>
          <div className="flex w-full h-1.5 bg-gray-900/60 rounded overflow-hidden">
            <div className="bg-sky-400/60 h-full" style={{ width: `${leftPctNum * 100}%` }} />
            <div className="bg-amber-400/60 h-full" style={{ width: `${rightPctNum * 100}%` }} />
          </div>
        </div>
        <div className="space-y-0.5">
          <div className="flex items-center justify-between text-[10px] text-gray-500">
            <span>Handle</span>
            <span className="font-mono text-gray-300">{fmtPct(leftHandle)} / {fmtPct(rightHandle)}</span>
          </div>
          <div className="flex w-full h-1.5 bg-gray-900/60 rounded overflow-hidden">
            <div className="bg-sky-500/80 h-full" style={{ width: `${leftHandleNum * 100}%` }} />
            <div className="bg-amber-500/80 h-full" style={{ width: `${rightHandleNum * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function NbaPublicSplitsPanel({
  ml,
  spread,
  total,
  hasSplits,
  splitsFetchedAt,
}: {
  ml: MarketIntelligence;
  spread: MarketIntelligence;
  total: MarketIntelligence;
  hasSplits: boolean;
  splitsFetchedAt: string | null;
}) {
  if (!hasSplits) {
    return (
      <div className="rounded-lg border border-gray-700/40 bg-gray-900/40 p-4 text-sm text-gray-400">
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-300 mb-1">
          Public Splits
        </div>
        <div className="text-gray-500 italic">Unavailable — SharpAPI returned no /splits row for this matchup.</div>
        <div className="text-[10px] text-gray-600 mt-2">
          NBA splits source: SharpAPI /splits (consensus only — single source, no per-book breakdown).
        </div>
      </div>
    );
  }
  const mlPick = ml.splits.pick_side;
  const mlOther = ml.splits.other_side;
  const spPick = spread.splits.pick_side;
  const spOther = spread.splits.other_side;
  const toPick = total.splits.pick_side;
  const toOther = total.splits.other_side;
  const mlPickAbbr = ml.pick_side === "home" ? "Home" : ml.pick_side === "away" ? "Away" : "Pick";
  const mlOtherAbbr = ml.pick_side === "home" ? "Away" : ml.pick_side === "away" ? "Home" : "Other";
  const spPickAbbr = spread.pick_side === "home" ? "Home" : spread.pick_side === "away" ? "Away" : "Pick";
  const spOtherAbbr = spread.pick_side === "home" ? "Away" : spread.pick_side === "away" ? "Home" : "Other";
  const toPickAbbr = total.pick_side === "over" ? "Over" : "Under";
  const toOtherAbbr = total.pick_side === "over" ? "Under" : "Over";

  const fmtTime = (iso: string | null) => {
    if (iso === null) return null;
    try {
      const d = new Date(iso);
      return d.toLocaleString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });
    } catch {
      return null;
    }
  };
  return (
    <div className="rounded-lg border border-gray-700/40 bg-gray-900/40 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-300">
          Public Splits
        </div>
        <div className="text-[10px] text-gray-500">
          Consensus · {splitsFetchedAt !== null ? fmtTime(splitsFetchedAt) : "fetched_at unknown"}
        </div>
      </div>
      <SplitsBar
        label="Moneyline"
        left={mlPickAbbr}
        right={mlOtherAbbr}
        leftPct={mlPick?.bets_pct ?? null}
        rightPct={mlOther?.bets_pct ?? null}
        leftHandle={mlPick?.handle_pct ?? null}
        rightHandle={mlOther?.handle_pct ?? null}
      />
      <SplitsBar
        label="Spread"
        left={spPickAbbr}
        right={spOtherAbbr}
        leftPct={spPick?.bets_pct ?? null}
        rightPct={spOther?.bets_pct ?? null}
        leftHandle={spPick?.handle_pct ?? null}
        rightHandle={spOther?.handle_pct ?? null}
      />
      <SplitsBar
        label="Total"
        left={toPickAbbr}
        right={toOtherAbbr}
        leftPct={toPick?.bets_pct ?? null}
        rightPct={toOther?.bets_pct ?? null}
        leftHandle={toPick?.handle_pct ?? null}
        rightHandle={toOther?.handle_pct ?? null}
      />
      <div className="border-t border-gray-700/40 pt-3 space-y-1 text-[10px] text-gray-500">
        <div className="flex gap-1.5 flex-wrap">
          {ml.splits.sharp_signal_side !== "none" && (
            <span className={`px-1.5 py-0.5 rounded border ${DIVERGENCE_TINT[ml.splits.pick_side?.divergence ?? "none"].bg} ${DIVERGENCE_TINT[ml.splits.pick_side?.divergence ?? "none"].text}`}>
              ML: {ml.splits.sharp_signal_side === "pick" ? "money on our pick" : "money on the other side"}
            </span>
          )}
          {spread.splits.sharp_signal_side !== "none" && (
            <span className={`px-1.5 py-0.5 rounded border ${DIVERGENCE_TINT[spread.splits.pick_side?.divergence ?? "none"].bg} ${DIVERGENCE_TINT[spread.splits.pick_side?.divergence ?? "none"].text}`}>
              Spread: {spread.splits.sharp_signal_side === "pick" ? "money on our pick" : "money on the other side"}
            </span>
          )}
          {total.splits.sharp_signal_side !== "none" && (
            <span className={`px-1.5 py-0.5 rounded border ${DIVERGENCE_TINT[total.splits.pick_side?.divergence ?? "none"].bg} ${DIVERGENCE_TINT[total.splits.pick_side?.divergence ?? "none"].text}`}>
              Total: {total.splits.sharp_signal_side === "pick" ? "money on our pick" : "money on the other side"}
            </span>
          )}
        </div>
        <div className="text-gray-600">
          NBA rule: do not auto-follow handle, do not auto-fade public. Splits are a context signal,
          not a trigger.
        </div>
      </div>
    </div>
  );
}
