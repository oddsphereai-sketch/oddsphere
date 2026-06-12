/**
 * Phase 4.1.8.C-final (B+C Hybrid) — CautionCard.
 *
 * Featured-style card for verdict=caution. Same matchup-anchored shape
 * as HeroCard, with three Caution-specific differences:
 *   • Amber eyebrow + container tint (subtle, not alarm)
 *   • Hero lead in amber-100 — decisive caution framing
 *   • Model/Sharps side-by-side CONTRAST BLOCK — the defining Caution
 *     visual. Shows the model's pick (with confidence) and the sharp
 *     posture phrase next to each other so the disagreement is the
 *     visible story.
 *
 * Team-color top accent stays — identity is consistent across Featured
 * variants. Caution gets its color signal from the eyebrow + lead text
 * + contrast block, not from a colored backdrop.
 */

"use client";

import { useState } from "react";
import type { DailyEdgeGameDto } from "../../lib/labTypes";
import type { ComposedTakeaway } from "../../lib/composeTakeaway";
import {
  headlinePrimaryMarket,
  type HeadlineMarket,
} from "../../lib/perPickHeadline";
import {
  CardEyebrow,
  FeaturedMatchupHeader,
  TeamColorAccent,
  FullBreakdownExpandable,
  otherMarketsLabels,
} from "./sharedCardParts";

type Props = {
  game: DailyEdgeGameDto;
  takeaway: ComposedTakeaway;
};

// ─── Helpers for the Model side of the contrast block ────────────────

// Phase 4.2.C.2 — held markets carry null pick AND null confidence. Either
// nullable triggers the early return (no headline label possible).
function headlinePickLabel(game: DailyEdgeGameDto): {
  market: HeadlineMarket;
  label: string;
  confidence: number;
} | null {
  const market = headlinePrimaryMarket(game);
  if (market === "moneyline") {
    const ml = game.predictions.ml;
    if (!ml.pick || ml.pick === "—" || ml.confidence === null) return null;
    return { market, label: `${ml.pick} ML`, confidence: ml.confidence };
  }
  if (market === "total") {
    const t = game.predictions.total;
    if (!t.pick || t.confidence === null) return null;
    return {
      market,
      label: t.line !== null ? `${t.pick} ${t.line}` : t.pick,
      confidence: t.confidence,
    };
  }
  if (market === "first_inning_total") {
    const n = game.predictions.nrfi;
    if (!n.pick || n.pick === "—" || n.confidence === null) return null;
    return { market, label: n.pick, confidence: n.confidence };
  }
  return null;
}

/** Sharp side phrase — derived from the row's sharpRead.key. */
function sharpSidePhrase(
  game: DailyEdgeGameDto,
  headlineLabel: string | null
): string {
  const key = game.breakdown.sharpRead.key;
  if (key === "push_against") {
    return headlineLabel
      ? `Pushing against ${headlineLabel.toLowerCase()}`
      : "Pushing against the model's side";
  }
  if (key === "support") return "Backing the same side";
  if (key === "mixed") return "Split — no clean lean";
  if (key === "not_enough") return "Light coverage — no clean confirmation";
  if (key === "no_data") return "Picture unclear";
  return "Light movement only";
}

// ─── Component ────────────────────────────────────────────────────────

export default function CautionCard({ game, takeaway }: Props) {
  const [expanded, setExpanded] = useState(false);
  const headline = headlinePickLabel(game);
  const others = otherMarketsLabels(game);

  return (
    <article className="relative bg-gradient-to-br from-gray-900 via-gray-900 to-amber-950/15 border border-amber-700/20 rounded-2xl p-6 sm:p-8 transition-all duration-200 overflow-hidden">
      <TeamColorAccent awayTeam={game.awayTeam} homeTeam={game.homeTeam} sport={game.sport} />

      <CardEyebrow verdictKey="caution" gameTime={game.gameTime} />

      {/* Matchup anchor */}
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

      {/* Hair divider above the hero lead */}
      <div className="border-t border-gray-800/50 mb-5" />

      {/* Hero lead — amber-tinted, decisive */}
      <p className="text-[19px] sm:text-[21px] font-medium text-amber-100 leading-snug mb-6">
        {takeaway.lead}
      </p>

      {/* Model / Sharps contrast block — the defining Caution visual */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        <div className="bg-gray-900/40 border border-gray-800/50 rounded-md p-4">
          <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500 font-semibold mb-2">
            Model
          </p>
          <p className="text-[15px] font-medium text-gray-100 tabular-nums">
            {headline ? (
              <>
                {headline.label}
                <span className="text-gray-400 ml-2">
                  · {Math.round(headline.confidence * 100)}%
                </span>
              </>
            ) : (
              "—"
            )}
          </p>
          {takeaway.why && (
            <p className="text-[13px] text-gray-400 leading-snug mt-2">
              {takeaway.why}
            </p>
          )}
        </div>

        <div className="bg-amber-950/15 border border-amber-700/20 rounded-md p-4">
          <p className="text-[10px] uppercase tracking-[0.14em] text-amber-400/80 font-semibold mb-2">
            Sharps
          </p>
          <p className="text-[15px] font-medium text-amber-100 leading-snug">
            {sharpSidePhrase(game, headline?.label ?? null)}
          </p>
        </div>
      </div>

      {/* Caveat (rare on Caution but possible when modelBreakdown has one) */}
      {takeaway.caveat && (
        <p className="text-xs text-amber-200/80 leading-snug flex items-start gap-1.5 mb-4">
          <span aria-hidden="true" className="text-amber-400/70 leading-none mt-0.5">
            ⚠
          </span>
          <span>{takeaway.caveat}</span>
        </p>
      )}

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

      <FullBreakdownExpandable
        game={game}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        ctaLabelCollapsed="Read full breakdown"
      />
    </article>
  );
}
