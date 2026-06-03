/**
 * Phase 4.1.8.C-final (B+C Hybrid) — Tonight's MLB Edge briefing module.
 *
 * Single curation module at the top of Daily Edge. Replaces Top Reads +
 * TonightsBoard + the prior "Tonight's Top Angles" header by consolidating
 * all top-of-page curation into one editorial briefing.
 *
 * Composition:
 *   1. Header row: "TONIGHT'S MLB EDGE" eyebrow + slate date
 *   2. Counts strip: "3 top angles · 9 watchlist · no major cautions"
 *   3. Editorial lede (always rendered per Sub-D4) — 1-2 sentences from
 *      composeBriefingLede
 *   4. Hairline divider
 *   5. 3-up "Best of" row: Best Moneyline / Best Total / Best 1st Inning
 *      — fixed 3 cells (Sub-D3). Empty cells show "No standout edge tonight."
 *
 * No accent edge — the briefing is the neutral command-center module, not
 * a verdict zone. Visual hierarchy comes from typography + spacing.
 */

"use client";

import type { DailyEdgeGameDto } from "../../lib/labTypes";
import { composeBriefingLede } from "./composeBriefingLede";
import {
  findBestOfMarket,
  bestOfHeroLabel,
  bestOfConfidence,
} from "./findBestOfMarket";

type Props = {
  games: DailyEdgeGameDto[];
  /** YYYY-MM-DD slate date string from the route response. */
  slateDate: string;
};

// ─── Helpers ────────────────────────────────────────────────────────

function formatSlateDate(yyyymmdd: string): string {
  const d = new Date(`${yyyymmdd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return yyyymmdd;
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(d);
  const month = new Intl.DateTimeFormat("en-US", { month: "long" }).format(d);
  const day = d.getDate();
  return `${weekday} · ${month} ${day}`;
}

function groupForBriefing(games: DailyEdgeGameDto[]) {
  const topAngles: DailyEdgeGameDto[] = [];
  const watchlist: DailyEdgeGameDto[] = [];
  const caution: DailyEdgeGameDto[] = [];
  const no_play: DailyEdgeGameDto[] = [];
  for (const g of games) {
    const k = g.breakdown.verdict.key;
    if (k === "best_angle" || k === "lean") topAngles.push(g);
    else if (k === "watchlist") watchlist.push(g);
    else if (k === "caution") caution.push(g);
    else if (k === "no_play") no_play.push(g);
  }
  return { topAngles, watchlist, caution, no_play };
}

function formatCautionPhrase(cautionCount: number): string {
  if (cautionCount === 0) return "no major cautions";
  if (cautionCount === 1) return "1 caution";
  return `${cautionCount} cautions`;
}

// ─── Component ───────────────────────────────────────────────────────

export default function TonightsMlbEdge({ games, slateDate }: Props) {
  const grouped = groupForBriefing(games);
  const { topAngles, watchlist, caution } = grouped;

  const bestML = findBestOfMarket(games, "moneyline");
  const bestTotal = findBestOfMarket(games, "total");
  const bestNrfi = findBestOfMarket(games, "first_inning_total");

  const lede = composeBriefingLede(grouped);
  const formattedDate = formatSlateDate(slateDate);

  const topAngleCount = topAngles.length;
  const topAnglesWord = topAngleCount === 1 ? "top angle" : "top angles";
  const watchlistWord = watchlist.length === 1 ? "watchlist spot" : "watchlist spots";

  return (
    <section className="mb-10 bg-gray-900/40 border border-gray-800/60 rounded-2xl p-6 sm:p-8">
      {/* Header row */}
      <div className="flex items-baseline justify-between gap-3 mb-4 flex-wrap">
        <h2 className="text-[13px] sm:text-[14px] uppercase tracking-[0.18em] font-semibold text-gray-200">
          Tonight&rsquo;s MLB Edge
        </h2>
        <span className="text-[12px] text-gray-500 tabular-nums">
          {formattedDate}
        </span>
      </div>

      {/* Counts strip */}
      <p className="text-[14px] text-gray-400 mb-3 leading-snug">
        <span className="text-gray-200 font-medium tabular-nums">{topAngleCount}</span>{" "}
        {topAnglesWord}
        <span className="text-gray-600 mx-2">·</span>
        <span className="text-gray-200 font-medium tabular-nums">
          {watchlist.length}
        </span>{" "}
        {watchlistWord}
        <span className="text-gray-600 mx-2">·</span>
        <span className={caution.length > 0 ? "text-amber-300 font-medium" : "text-gray-400"}>
          {formatCautionPhrase(caution.length)}
        </span>
      </p>

      {/* Editorial lede */}
      <p className="text-[15px] sm:text-[17px] text-gray-200 leading-relaxed mb-6 max-w-3xl">
        {lede}
      </p>

      {/* Hairline divider */}
      <div className="border-t border-gray-800/50 mb-6" />

      {/* Best-of 3-up row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 sm:gap-6">
        <BestOfCell
          label="Best Moneyline"
          game={bestML}
          market="moneyline"
        />
        <BestOfCell
          label="Best Total"
          game={bestTotal}
          market="total"
        />
        <BestOfCell
          label="Best 1st Inning"
          game={bestNrfi}
          market="first_inning_total"
        />
      </div>
    </section>
  );
}

function BestOfCell({
  label,
  game,
  market,
}: {
  label: string;
  game: DailyEdgeGameDto | null;
  market: "moneyline" | "total" | "first_inning_total";
}) {
  if (game === null) {
    return (
      <div>
        <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500 font-semibold mb-2">
          {label}
        </p>
        <p className="text-[15px] text-gray-400 leading-snug">
          No standout edge tonight.
        </p>
      </div>
    );
  }

  const hero = bestOfHeroLabel(game, market);
  const conf = bestOfConfidence(game, market);

  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500 font-semibold mb-2">
        {label}
      </p>
      <p className="text-[24px] sm:text-[26px] font-bold tracking-tight text-white leading-none mb-2 tabular-nums">
        {hero}
      </p>
      <p className="text-[13px] text-gray-400 leading-snug">
        {game.awayTeam} @ {game.homeTeam}
        <span className="text-gray-600 mx-1.5">·</span>
        <span className="tabular-nums text-gray-400">{game.gameTime}</span>
        {conf !== null && (
          <>
            <span className="text-gray-600 mx-1.5">·</span>
            <span className="tabular-nums text-gray-300 font-medium">
              {Math.round(conf * 100)}%
            </span>
          </>
        )}
      </p>
    </div>
  );
}
