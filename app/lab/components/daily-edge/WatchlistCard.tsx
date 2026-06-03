/**
 * Phase 4.1.8.C-final (B+C Hybrid) — WatchlistCard.
 *
 * Compact polished editorial card for verdict=watchlist. Reads as a
 * single decision-led paragraph rather than a stack of data sections.
 * No chips, no pills, no inline pick summary on the collapsed card.
 *
 * Two-step progressive disclosure:
 *   1. Default state: compact matchup, single composed paragraph,
 *      "Show details →" affordance at bottom-right.
 *   2. First expand: reveals projected score + pick tiles + optional
 *      caveat + Full Breakdown CTA.
 *   3. Second expand (inside the visible CTA): per-market detail.
 *
 * No top-edge accent — Watchlist is intentionally undecorated. The
 * visual de-emphasis is the point.
 */

"use client";

import { useState } from "react";
import type { DailyEdgeGameDto } from "../../lib/labTypes";
import type { ComposedTakeaway } from "../../lib/composeTakeaway";
import Icon from "../Icon";
import {
  CardEyebrow,
  CompactMatchupHeader,
  PickTilesRow,
  FullBreakdownExpandable,
} from "./sharedCardParts";

type Props = {
  game: DailyEdgeGameDto;
  takeaway: ComposedTakeaway;
};

export default function WatchlistCard({ game, takeaway }: Props) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [fullExpanded, setFullExpanded] = useState(false);

  return (
    <article className="bg-gray-900/40 border border-gray-800/60 rounded-xl p-5 sm:p-6 transition-colors duration-200 hover:border-gray-700/80">
      {/* Eyebrow */}
      <CardEyebrow verdictKey="watchlist" gameTime={game.gameTime} compact />

      {/* Compact matchup with 28px logos */}
      <div className="mb-3">
        <CompactMatchupHeader
          awayTeam={game.awayTeam}
          awayTeamLogo={game.awayTeamLogo}
          homeTeam={game.homeTeam}
          homeTeamLogo={game.homeTeamLogo}
        />
      </div>

      {/* Editorial single-paragraph lead — the whole content */}
      <p className="text-[15px] sm:text-base text-gray-300 leading-relaxed mb-4">
        {takeaway.lead}
      </p>

      {/* Right-aligned "Show details" affordance */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setDetailsExpanded((v) => !v)}
          aria-expanded={detailsExpanded}
          className="inline-flex items-center gap-1 text-[12px] text-gray-400 hover:text-violet-300 transition-colors whitespace-nowrap"
        >
          {detailsExpanded ? "Hide details" : "Show details"}
          <Icon
            name="chevron-down"
            className={`w-3 h-3 transition-transform duration-200 ${
              detailsExpanded ? "rotate-180" : ""
            }`}
          />
        </button>
      </div>

      {/* Expanded details — projected score + pick tiles + caveat + Full Breakdown */}
      {detailsExpanded && (
        <div className="mt-4 pt-4 border-t border-gray-800/60 space-y-4">
          {takeaway.why && (
            <p className="text-sm text-gray-400 leading-relaxed">
              <span className="text-[10px] uppercase tracking-[0.14em] text-gray-500 font-semibold mr-2">
                Why
              </span>
              {takeaway.why}
            </p>
          )}

          {takeaway.caveat && (
            <p className="text-xs text-amber-200/80 leading-snug flex items-start gap-1.5">
              <span aria-hidden="true" className="text-amber-400/70 leading-none mt-0.5">
                ⚠
              </span>
              <span>{takeaway.caveat}</span>
            </p>
          )}

          {/* Projected row */}
          <div className="flex items-center justify-center gap-3 text-[13px] text-gray-400">
            <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
              Projected
            </span>
            <span className="text-gray-200 font-medium tabular-nums">
              {game.awayTeam} {game.projected.away.toFixed(1)}
            </span>
            <span className="text-gray-600">·</span>
            <span className="text-gray-200 font-medium tabular-nums">
              {game.homeTeam} {game.projected.home.toFixed(1)}
            </span>
          </div>

          {/* Pick tiles */}
          <PickTilesRow game={game} />

          {/* Full Breakdown */}
          <FullBreakdownExpandable
            game={game}
            expanded={fullExpanded}
            onToggle={() => setFullExpanded((v) => !v)}
          />
        </div>
      )}
    </article>
  );
}
