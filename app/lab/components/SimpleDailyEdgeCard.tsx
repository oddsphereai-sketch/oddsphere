/**
 * Phase 4.1.8.C-final — SimpleDailyEdgeCard router.
 *
 * Routes each game to the variant matching its server-derived verdict:
 *   best_angle / lean → HeroCard
 *   caution           → CautionCard
 *   watchlist         → WatchlistCard
 *   no_play           → NoPlayStrip (also rendered directly by DailyEdgeView
 *                       for the No Play group; this branch is defensive)
 *
 * The pre-4.1.8.C-final monolithic body (~640 LOC, single uniform layout
 * for every verdict) is gone. Each variant now owns its own visual
 * treatment per the locked design plan. composeTakeaway is called once
 * here and passed down so the variants share the same lead/why/caveat
 * derivation.
 */

"use client";

import type { DailyEdgeGameDto } from "../lib/labTypes";
import { composeTakeaway } from "../lib/composeTakeaway";
import HeroCard from "./daily-edge/HeroCard";
import CautionCard from "./daily-edge/CautionCard";
import WatchlistCard from "./daily-edge/WatchlistCard";
import { NoPlayStrip } from "./daily-edge/sharedCardParts";

type Props = {
  game: DailyEdgeGameDto;
};

export default function SimpleDailyEdgeCard({ game }: Props) {
  const takeaway = composeTakeaway(game);

  switch (game.breakdown.verdict.key) {
    case "best_angle":
    case "lean":
      return <HeroCard game={game} takeaway={takeaway} />;
    case "caution":
      return <CautionCard game={game} takeaway={takeaway} />;
    case "watchlist":
      return <WatchlistCard game={game} takeaway={takeaway} />;
    case "no_play":
      // DailyEdgeView renders NoPlayStrip directly for no_play games (it
      // groups them in a stacked-strip section). This branch is a defensive
      // fallback for any consumer that routes through SimpleDailyEdgeCard
      // without the page-level grouping.
      return <NoPlayStrip game={game} takeaway={takeaway} />;
  }
}
