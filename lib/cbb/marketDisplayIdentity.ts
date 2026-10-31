import type { DailyEdgeGameDto } from "@/app/lab/lib/labTypes";
import type { RawOwlsOddsEvent } from "@/lib/providers/owls/owlsSharpBookOdds";
import type { PredictionMarketGameIdentity, PredictionMarketSport } from "@/lib/providers/owls/owlsPredictionMarkets";
import { cbbSplitOrientation } from "./exactSplitIdentity";

export const CBB_MARKET_TRACKING_RELEASE = "cbb_market_tracking_2026_10_31_r1_observed_tape_verified_midnight" as const;

/** An independent exact-institution odds event may resolve a one-minute
 * midnight discrepancy for an unlocked display. Never changes the fixture. */
export function marketDisplayGameIdentity(game: DailyEdgeGameDto, sport: PredictionMarketSport,
  events: readonly RawOwlsOddsEvent[] = [], now = Date.now()): PredictionMarketGameIdentity {
  const identity: PredictionMarketGameIdentity = { sport, gameStartAt: game.gameStartAt ?? "",
    awayTeam: game.awayTeam, homeTeam: game.homeTeam, awayName: game.awayTeamDisplayName,
    homeName: game.homeTeamDisplayName, awayCollege: game.cbbAwayCollege, homeCollege: game.cbbHomeCollege,
    lockState: game.lockState, lockedAt: game.lockedAt };
  const start = Date.parse(identity.gameStartAt);
  if (sport !== "cbb" || game.lockState !== "open" || game.lockedAt !== null || start <= now) return identity;
  const matches = events.filter(event => event.eventId && cbbSplitOrientation(event.away_team ?? "", event.home_team ?? "", game) &&
    Number.isFinite(Date.parse(event.commence_time ?? "")) && Math.abs(Date.parse(event.commence_time!) - start) <= 60_000);
  if (matches.length === 1) identity.cbbMarketStartAt = matches[0].commence_time!;
  return identity;
}
