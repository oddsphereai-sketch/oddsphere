/**
 * Phase 7B v0c-DE — NBA per-market tracker card.
 *
 * Renders one market (ML / spread / total) with:
 *   • current consensus line + best-price odds + book
 *   • per-book breakdown (table)
 *   • no-vig / fair / EV row
 *   • model probability / edge
 *   • conflict band + recommendation grade
 *   • splits compact strip (full splits panel is rendered separately)
 *   • first-observed timestamp + movement note
 *   • per-market warnings (stale, limited books)
 *
 * NBA layout puts SPREAD first via parent ordering. This component
 * itself is market-agnostic.
 */

import type { MarketIntelligence } from "@/lib/services/nba/nbaMarketIntelligence";
import {
  GRADE_LABEL,
  GRADE_GLYPH,
  GRADE_TEXT_COLOR,
  GRADE_BAND_TINT,
  GRADE_GLOW,
  CONFLICT_TINT,
} from "./NbaVerdictPalette";

function fmtAmerican(o: number | null): string {
  if (o === null) return "—";
  return o > 0 ? `+${o}` : `${o}`;
}
function fmtPp(pp: number | null, signed = true): string {
  if (pp === null) return "—";
  const v = pp.toFixed(1);
  if (signed && pp > 0) return `+${v}pp`;
  return `${v}pp`;
}
function fmtPts(pts: number | null): string {
  if (pts === null) return "—";
  const v = pts.toFixed(1);
  return pts > 0 ? `+${v}` : v;
}
function fmtProb(p: number | null): string {
  if (p === null) return "—";
  return `${(p * 100).toFixed(1)}%`;
}
function fmtLine(line: number | null): string {
  if (line === null) return "—";
  return line > 0 ? `+${line}` : `${line}`;
}

function timeAgo(iso: string | null): string {
  if (iso === null) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function NbaMarketTracker({
  market,
  intel,
  emphasis,
}: {
  market: "moneyline" | "spread" | "total";
  intel: MarketIntelligence;
  /** When true, render as the larger spread-focused card. */
  emphasis: boolean;
}) {
  const grade = intel.grade;
  const conflict = CONFLICT_TINT[intel.conflict_band];
  const titleSuffix = market === "moneyline" ? "Moneyline" : market === "spread" ? "Spread" : "Total";

  return (
    <div
      className={`relative rounded-xl border bg-gradient-to-b ${GRADE_BAND_TINT[grade]} ${emphasis ? "p-5" : "p-4"} space-y-4`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-gray-400">
            {titleSuffix}
            {emphasis && <span className="ml-2 text-emerald-300/70">· spread-focused</span>}
          </div>
          <div className={`text-2xl font-semibold mt-0.5 ${GRADE_TEXT_COLOR[grade]} ${GRADE_GLOW[grade]}`}>
            {intel.pick_label}
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-1 justify-end">
            <span className={`text-base ${GRADE_TEXT_COLOR[grade]} ${GRADE_GLOW[grade]}`}>{GRADE_GLYPH[grade]}</span>
            <span className={`text-xs font-semibold uppercase tracking-wider ${GRADE_TEXT_COLOR[grade]}`}>
              {GRADE_LABEL[grade]}
            </span>
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">
            eff conf {intel.effective_confidence.toFixed(0)} / model {intel.model_confidence.toFixed(0)}
          </div>
        </div>
      </div>

      {/* Current line / price */}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wider text-gray-400">Line</div>
          <div className="text-sm font-mono text-gray-200">
            {market === "moneyline" ? "—" : fmtLine(intel.consensus_line)}
          </div>
        </div>
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wider text-gray-400">Best Price</div>
          <div className="text-sm font-mono text-gray-200">{fmtAmerican(intel.current_price.odds_american)}</div>
          <div className="text-[10px] text-gray-500 uppercase">{intel.current_price.sportsbook ?? "—"}</div>
        </div>
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-wider text-gray-400">Other Side</div>
          <div className="text-sm font-mono text-gray-300">{fmtAmerican(intel.other_side_price.odds_american)}</div>
          <div className="text-[10px] text-gray-500 uppercase">{intel.other_side_price.sportsbook ?? "—"}</div>
        </div>
      </div>

      {/* Conflict / no-vig / EV row */}
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className={`px-2 py-0.5 rounded border ${conflict.bg} ${conflict.text} uppercase tracking-wider`}>
          {conflict.label}
        </span>
        <span className="px-2 py-0.5 rounded border bg-gray-800/40 border-gray-700/40 text-gray-300">
          no-vig {fmtProb(intel.market_no_vig_prob_pick)}
        </span>
        <span className="px-2 py-0.5 rounded border bg-gray-800/40 border-gray-700/40 text-gray-300">
          implied {fmtProb(intel.market_implied_prob_pick)}
        </span>
        {intel.opp_fair_probability_pick !== null && (
          <span className="px-2 py-0.5 rounded border bg-emerald-500/10 border-emerald-500/30 text-emerald-300">
            sharp fair {fmtProb(intel.opp_fair_probability_pick)}
          </span>
        )}
        {intel.opp_ev_percentage_pick !== null && (
          <span
            className={`px-2 py-0.5 rounded border uppercase tracking-wider ${
              intel.opp_ev_percentage_pick > 0
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-gray-800/40 border-gray-700/40 text-gray-400"
            }`}
          >
            EV {intel.opp_ev_percentage_pick > 0 ? "+" : ""}{intel.opp_ev_percentage_pick.toFixed(2)}%
          </span>
        )}
        {intel.edge_prob_pp !== null && (
          <span className="px-2 py-0.5 rounded border bg-sky-500/10 border-sky-500/25 text-sky-300">
            edge {fmtPp(intel.edge_prob_pp)}
          </span>
        )}
        {intel.edge_points !== null && (
          <span className="px-2 py-0.5 rounded border bg-sky-500/10 border-sky-500/25 text-sky-300">
            edge {fmtPts(intel.edge_points)} pt
          </span>
        )}
        {intel.opp_market_width !== null && (
          <span className="px-2 py-0.5 rounded border bg-gray-800/40 border-gray-700/40 text-gray-400">
            width {intel.opp_market_width.toFixed(1)}
          </span>
        )}
        {intel.opp_possibly_stale && (
          <span className="px-2 py-0.5 rounded border bg-amber-500/10 border-amber-500/30 text-amber-300">
            possibly stale
          </span>
        )}
      </div>

      {/* Per-book table */}
      {intel.per_book_pick_side.length > 0 && (
        <div className="rounded-md border border-gray-800/60 bg-black/20">
          <div className="grid grid-cols-12 px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-800/60">
            <div className="col-span-5">Book</div>
            <div className="col-span-3 text-right">{intel.pick_label}</div>
            <div className="col-span-3 text-right text-gray-600">Other</div>
            <div className="col-span-1 text-right">—</div>
          </div>
          {intel.per_book_pick_side.map((row, i) => {
            const other = intel.per_book_other_side.find((o) => o.sportsbook === row.sportsbook);
            return (
              <div
                key={`${row.sportsbook}-${i}`}
                className="grid grid-cols-12 px-3 py-1.5 text-xs border-b border-gray-800/30 last:border-b-0"
              >
                <div className="col-span-5 text-gray-300 uppercase tracking-wider text-[10px]">{row.sportsbook}</div>
                <div className="col-span-3 text-right font-mono text-gray-200">
                  {row.line_value !== null && market !== "moneyline" ? `${fmtLine(row.line_value)} ` : ""}
                  {fmtAmerican(row.odds_american)}
                </div>
                <div className="col-span-3 text-right font-mono text-gray-500">
                  {other?.line_value !== null && other !== undefined && market !== "moneyline"
                    ? `${fmtLine(other.line_value)} `
                    : ""}
                  {fmtAmerican(other?.odds_american ?? null)}
                </div>
                <div className="col-span-1 text-right text-[10px] text-gray-600">{timeAgo(row.fetched_at)}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Splits compact strip */}
      {intel.splits.pick_side !== null && (
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <span className="text-gray-500 uppercase tracking-wider">Splits:</span>
          {intel.splits.pick_side.bets_pct !== null && (
            <span className="px-2 py-0.5 rounded bg-gray-800/40 border border-gray-700/40 text-gray-300">
              pick bets {Math.round((intel.splits.pick_side.bets_pct ?? 0) * 100)}%
            </span>
          )}
          {intel.splits.pick_side.handle_pct !== null && (
            <span className="px-2 py-0.5 rounded bg-gray-800/40 border border-gray-700/40 text-gray-300">
              pick handle {Math.round((intel.splits.pick_side.handle_pct ?? 0) * 100)}%
            </span>
          )}
          {intel.splits.sharp_signal_side === "pick" && (
            <span className="px-2 py-0.5 rounded bg-violet-500/15 border border-violet-500/35 text-violet-200">
              sharp money on our pick
            </span>
          )}
          {intel.splits.sharp_signal_side === "other" && (
            <span className="px-2 py-0.5 rounded bg-violet-500/15 border border-violet-500/35 text-violet-200">
              sharp money on other side
            </span>
          )}
        </div>
      )}

      {/* Rationale */}
      {intel.rationale.length > 0 && (
        <div className="border-t border-gray-800/40 pt-3 text-[11px] text-gray-400 space-y-1">
          {intel.rationale.map((r, i) => (
            <div key={i}>· {r}</div>
          ))}
        </div>
      )}

      {/* Movement note + first observed */}
      <div className="flex items-center justify-between text-[10px] text-gray-500 border-t border-gray-800/40 pt-2">
        <span>First observed: {timeAgo(intel.first_observed_at)}</span>
        <span className="italic">{intel.movement_note}</span>
      </div>
    </div>
  );
}
