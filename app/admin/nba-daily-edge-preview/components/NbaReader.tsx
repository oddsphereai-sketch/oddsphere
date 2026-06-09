/**
 * Phase 7B v0c-DE — NBA Daily Edge reader (right panel).
 *
 * Detailed per-game view shown when a slate card is selected.
 * Sections (top to bottom):
 *
 *   1. Matchup header — teams, tip-off ET, series state, venue/closeout
 *   2. Quick Read — one-sentence top-recommendation summary
 *   3. Projection strip — predicted score / total / spread
 *   4. Context strip — rest, injuries, data-quality tier
 *   5. Three market tracker cards — Spread emphasized, then Total, then ML
 *   6. Public splits panel
 *   7. Source badges
 */

"use client";

import type { NbaDailyEdgeGameDto } from "@/lib/services/nba/buildNbaDailyEdgeDto";
import { NbaMarketTracker } from "./NbaMarketTracker";
import { NbaPublicSplitsPanel } from "./NbaPublicSplits";
import { NbaSourceBadges } from "./NbaSourceBadges";
import {
  GRADE_BAND_TINT,
  GRADE_TEXT_COLOR,
  GRADE_GLYPH,
  GRADE_LABEL,
  GRADE_GLOW,
} from "./NbaVerdictPalette";
import { nbaTeamPrimary } from "./NbaTeamColors";

function tierBadge(tier: string): { text: string; tint: string } {
  if (tier === "high") return { text: "tier: high", tint: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10" };
  if (tier === "medium") return { text: "tier: medium", tint: "text-sky-300 border-sky-500/30 bg-sky-500/10" };
  if (tier === "low") return { text: "tier: low", tint: "text-amber-300 border-amber-500/30 bg-amber-500/10" };
  return { text: "tier: fallback", tint: "text-gray-400 border-gray-700/40 bg-gray-800/40" };
}

export function NbaReader({
  game,
  injuryIngestEnabled,
}: {
  game: NbaDailyEdgeGameDto;
  injuryIngestEnabled: boolean;
}) {
  const intel = game.intelligence;
  const topGrade = intel.top_grade;
  const tier = tierBadge(game.data_quality_tier);
  const homeColor = nbaTeamPrimary(game.home_abbr);
  const awayColor = nbaTeamPrimary(game.away_abbr);

  return (
    <div className="space-y-5">
      {/* Header band — verdict-tinted */}
      <div className={`relative rounded-2xl border bg-gradient-to-b ${GRADE_BAND_TINT[topGrade]} p-5`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-gray-400 mb-1">
              {game.series.text}
            </div>
            <div className="flex items-center gap-3 text-3xl font-semibold text-gray-100">
              <span style={{ color: awayColor }}>{game.away_abbr}</span>
              <span className="text-gray-500 text-2xl">@</span>
              <span style={{ color: homeColor }}>{game.home_abbr}</span>
            </div>
            <div className="text-xs text-gray-400 mt-1.5">
              {game.tip_display_et ?? "tip tbd"}
              {game.series.venue_shift ? " · venue shift" : ""}
              {game.series.elimination_for !== null
                ? ` · ${game.series.elimination_for === "home" ? game.home_abbr : game.away_abbr} elimination`
                : ""}
            </div>
          </div>
          <div className="text-right space-y-1">
            <div className={`text-2xl ${GRADE_TEXT_COLOR[topGrade]} ${GRADE_GLOW[topGrade]}`}>
              {GRADE_GLYPH[topGrade]} {GRADE_LABEL[topGrade]}
            </div>
            <div className="text-[10px] text-gray-500 uppercase">top read</div>
            {/* ADMIN-ONLY v1 model badge. Must not surface in member-facing UI. */}
            {game.admin_model_badge !== null && (
              <div className="flex items-center justify-end gap-1.5 mt-1">
                <span
                  className="px-1.5 py-0.5 rounded border border-violet-500/30 bg-violet-500/10 text-[10px] uppercase tracking-wider text-violet-200"
                  title="Active preview model — admin/audit-only label"
                >
                  {game.admin_model_badge.label}
                </span>
                {game.admin_model_badge.audit_flags.length > 0 && (
                  <span
                    className="px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-[10px] uppercase tracking-wider text-amber-200"
                    title={game.admin_model_badge.audit_flags.join("; ")}
                  >
                    ⚠ {game.admin_model_badge.audit_flags.length} v0/v1 flag{game.admin_model_badge.audit_flags.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Read */}
      <div className="rounded-xl border border-gray-700/40 bg-gray-900/40 p-4">
        <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Quick Read</div>
        <div className="text-sm text-gray-100">{game.quick_read}</div>
      </div>

      {/* Projection + context strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-gray-700/40 bg-gray-900/40 p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Predicted Score</div>
          <div className="text-lg font-semibold font-mono text-gray-100 mt-0.5">
            {Math.round(game.projection.away_score)} – {Math.round(game.projection.home_score)}
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">{game.away_abbr} @ {game.home_abbr}</div>
        </div>
        <div className="rounded-xl border border-gray-700/40 bg-gray-900/40 p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Projected Total</div>
          <div className="text-lg font-semibold font-mono text-gray-100 mt-0.5">
            {game.projection.total.toFixed(1)}
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">
            market {intel.total.consensus_line ?? "—"}
          </div>
        </div>
        <div className="rounded-xl border border-gray-700/40 bg-gray-900/40 p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Projected Spread</div>
          <div className="text-lg font-semibold font-mono text-gray-100 mt-0.5">
            {game.projection.spread_home > 0 ? "+" : ""}{game.projection.spread_home.toFixed(1)}
            <span className="text-xs text-gray-500 ml-1">(home)</span>
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">
            market {intel.spread.consensus_line ?? "—"}
          </div>
        </div>
        <div className="rounded-xl border border-gray-700/40 bg-gray-900/40 p-3 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Context</div>
          <div className="flex flex-wrap gap-1">
            <span className={`px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wider ${tier.tint}`}>
              {tier.text}
            </span>
            {game.rest.home_days !== null && game.rest.away_days !== null && (
              <span className="px-1.5 py-0.5 rounded border bg-gray-800/40 border-gray-700/40 text-[10px] text-gray-400 uppercase">
                rest H{game.rest.home_days}/A{game.rest.away_days}
              </span>
            )}
            {(game.injuries.home_out > 0 || game.injuries.away_out > 0) && (
              <span className="px-1.5 py-0.5 rounded border bg-rose-500/10 border-rose-500/30 text-[10px] text-rose-300 uppercase">
                injuries H{game.injuries.home_out}/A{game.injuries.away_out}
              </span>
            )}
            {(game.injuries.home_unknown > 0 || game.injuries.away_unknown > 0) && (
              <span className="px-1.5 py-0.5 rounded border bg-amber-500/10 border-amber-500/30 text-[10px] text-amber-300 uppercase">
                ?{game.injuries.home_unknown + game.injuries.away_unknown} unknown
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Three market tracker cards — Spread first (NBA is spread-focused) */}
      <div className="space-y-4">
        <NbaMarketTracker market="spread" intel={intel.spread} emphasis />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <NbaMarketTracker market="total" intel={intel.total} emphasis={false} />
          <NbaMarketTracker market="moneyline" intel={intel.ml} emphasis={false} />
        </div>
      </div>

      {/* Public splits */}
      <NbaPublicSplitsPanel
        ml={intel.ml}
        spread={intel.spread}
        total={intel.total}
        hasSplits={intel.sources.has_splits}
        splitsFetchedAt={intel.sources.splits_fetched_at}
      />

      {/* Source/provenance badges */}
      <div className="rounded-xl border border-gray-700/40 bg-gray-900/40 p-4 space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-gray-500">Sources</div>
        <NbaSourceBadges
          sources={game.sources}
          provenance={game.provenance}
          injuryIngestEnabled={injuryIngestEnabled}
        />
        {intel.sources.limited_book_coverage && (
          <div className="text-[10px] text-amber-300/80 mt-1">
            ⚠ Limited book coverage — only {intel.sources.book_count}{" "}
            {intel.sources.book_count === 1 ? "book" : "books"} ({intel.sources.books.join(", ")}). Best price
            shown is the best of what we have, not the true market best.
          </div>
        )}
      </div>
    </div>
  );
}
