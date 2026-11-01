import type { DailyEdgeGameDto } from "@/app/lab/lib/labTypes";
import type { RawOwlsOddsEvent } from "@/lib/providers/owls/owlsSharpBookOdds";
import type { PredictionMarketGameIdentity, PredictionMarketSport } from "@/lib/providers/owls/owlsPredictionMarkets";
import { cbbSplitOrientation } from "./exactSplitIdentity";

export const CBB_MARKET_TRACKING_RELEASE = "cbb_market_tracking_2026_11_01_r2_exact_exchange_names_provider_date" as const;

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
  if (matches.length === 1) {
    identity.cbbMarketStartAt = matches[0].commence_time!;
    // Some odds events encode the scheduled date correctly while retaining a
    // 23:59 placeholder start. Preserve both original times; only their exact
    // named event's explicit date may prove the adjacent midnight date.
    const encoded = matches[0].eventId?.match(/^ncaab:[^@]+@.+-(\d{4})(\d{2})(\d{2})$/);
    if (encoded) identity.cbbMarketDate = `${encoded[1]}-${encoded[2]}-${encoded[3]}`;
  }
  return identity;
}
