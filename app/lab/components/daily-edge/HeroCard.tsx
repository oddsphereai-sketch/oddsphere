/**
 * Phase 4.1.8.C-final (B+C Hybrid) — HeroCard.
 *
 * Featured card for verdict=best_angle and verdict=lean. Angle-first,
 * matchup-driven. Per Daniel's locked design rules:
 *   • The selected angle is the visual hero (40px font-black, white).
 *   • Team identity anchors the card (48px logos + team-color top edge).
 *   • Projected score is supporting context, not the hero.
 *   • Use stronger typography hierarchy, fewer pills.
 *   • Color as signal, not decoration (verdict color in eyebrow only;
 *     team color on the top edge only).
 *   • Why + Risk read editorially — labeled blocks, not chips.
 *
 * Lean variant uses the same component with sky accents + slightly
 * smaller hero pick (no shadow elevation).
 */

"use client";

import { useState } from "react";
import type { DailyEdgeGameDto } from "../../lib/labTypes";
import type { ComposedTakeaway } from "../../lib/composeTakeaway";
import {
  CardEyebrow,
  selectHeadlineMarketChip,
  FeaturedMatchupHeader,
  TeamColorAccent,
  FullBreakdownExpandable,
  heroPickString,
  headlineConfidence,
  otherMarketsLabels,
} from "./sharedCardParts";

type Props = {
  game: DailyEdgeGameDto;
  takeaway: ComposedTakeaway;
};

// Per-verdict container palette. Best Angle adds a subtle shadow + emerald
// tint; Lean stays flatter with a quieter sky tint. Both keep the team-
// color top-edge accent above (rendered by <TeamColorAccent />).
const PALETTE = {
  best_angle: {
    container:
      "bg-gradient-to-br from-gray-900 via-gray-900 to-emerald-950/20 border border-gray-800 shadow-xl shadow-emerald-500/[0.04]",
    heroPickSize: "text-[36px] sm:text-[40px]",
  },
  lean: {
    container:
      "bg-gradient-to-br from-gray-900 via-gray-900 to-sky-950/12 border border-gray-800",
    heroPickSize: "text-[28px] sm:text-[32px]",
  },
} as const;

export default function HeroCard({ game, takeaway }: Props) {
  const verdictKey = game.breakdown.verdict.key as "best_angle" | "lean";
  const palette = PALETTE[verdictKey];
  const [expanded, setExpanded] = useState(false);

  const heroPick = heroPickString(game);
  const confidence = headlineConfidence(game);
  const others = otherMarketsLabels(game);

  return (
    <article
      className={`relative ${palette.container} rounded-2xl p-6 sm:p-8 transition-all duration-200 overflow-hidden`}
    >
      <TeamColorAccent awayTeam={game.awayTeam} homeTeam={game.homeTeam} sport={game.sport} />

      {/* Eyebrow row */}
      <CardEyebrow verdictKey={verdictKey} gameTime={game.gameTime} marketChip={selectHeadlineMarketChip(game)} />

      {/* Matchup identity anchor — 48px logos + team names + projected */}
      <div className="mb-7">
        <FeaturedMatchupHeader
          awayTeam={game.awayTeam}
          awayTeamLogo={game.awayTeamLogo}
          awayProjected={game.projected.away}
          homeTeam={game.homeTeam}
          homeTeamLogo={game.homeTeamLogo}
          homeProjected={game.projected.home}
        />
      </div>

      {/* Hair divider above the angle hero */}
      <div className="border-t border-gray-800/50 mb-5" />

      {/* Hero row — angle + confidence, left/right justified per Sub-D6 */}
      {heroPick && (
        <div className="flex items-baseline justify-between gap-4 mb-4">
          <h4
            className={`${palette.heroPickSize} font-black tabular-nums tracking-tight text-white leading-none`}
          >
            {heroPick}
          </h4>
          {confidence !== null && (
            <span className="text-[20px] sm:text-[22px] font-medium tabular-nums text-gray-400 leading-none">
              {Math.round(confidence * 100)}%
            </span>
          )}
        </div>
      )}

      {/* Composed lead — decision-led sentence */}
      <p className="text-[17px] sm:text-[18px] font-medium text-gray-100 leading-snug mb-6">
        {takeaway.lead}
      </p>

      {/* "Why this angle" block */}
      {takeaway.why && (
        <div className="mb-4">
          <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500 font-semibold mb-1">
            Why this angle
          </p>
          <p className="text-[15px] text-gray-300 leading-relaxed">
            {takeaway.why}
          </p>
        </div>
      )}

      {/* "Where it gets less clean" — conditional risk block */}
      {takeaway.caveat && (
        <div className="mb-4">
          <p className="text-[10px] uppercase tracking-[0.14em] text-amber-400/70 font-semibold mb-1">
            Where it gets less clean
          </p>
          <p className="text-[15px] text-amber-100/85 leading-relaxed">
            {takeaway.caveat}
          </p>
        </div>
      )}

      {/* Hair divider before footer */}
      <div className="border-t border-gray-800/50 my-5" />

      {/* Other markets inline label */}
      {others.length > 0 && (
        <div className="mb-4 text-[13px] text-gray-400">
          <span className="text-[10px] uppercase tracking-[0.14em] text-gray-500 font-semibold mr-2">
            Other markets
          </span>
          {others.map((label, i) => (
            <span key={label}>
              {i > 0 && <span className="text-gray-600 mx-1.5">·</span>}
              <span className="text-gray-300 tabular-nums">{label}</span>
            </span>
          ))}
        </div>
      )}

      {/* Full Breakdown CTA + expanded section */}
      <FullBreakdownExpandable
        game={game}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        ctaLabelCollapsed="Read full breakdown"
      />
    </article>
  );
}
