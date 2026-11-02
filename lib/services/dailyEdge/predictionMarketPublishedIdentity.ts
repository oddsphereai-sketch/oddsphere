import type { DailyEdgeGameDto } from "@/app/lab/lib/labTypes";

export const PUBLISHED_MARKET_READER_RELEASE = "prediction_market_published_reader_2026_11_02_r3_cbb_indexed_details" as const;
export type PublishedMarketIdentity = Pick<DailyEdgeGameDto,
  "id" | "external_id" | "sport" | "awayTeam" | "homeTeam" | "gameStartAt">;

/** Membership comes from the sole published board. Chart histories belong in
 * the per-game detail, not a repeatedly inflated all-slate identity cache. */
export function publishedMarketIdentities(games: readonly DailyEdgeGameDto[]): PublishedMarketIdentity[] {
  if (games.length > 500 || new Set(games.map(game => game.external_id)).size !== games.length) {
    throw new Error("Published market identity index is oversized or ambiguous");
  }
  return games.map(({id,external_id,sport,awayTeam,homeTeam,gameStartAt}) =>
    ({id,external_id,sport,awayTeam,homeTeam,gameStartAt}));
}

/** A cached board index cannot authorize an excluded or changed fixture. The
 * member store supplies the complete original market/lock payload first. */
export function verifiedPublishedMarketDetail(identity:PublishedMarketIdentity,game:DailyEdgeGameDto):DailyEdgeGameDto {
  if (identity.id !== game.id || identity.external_id !== game.external_id || identity.sport !== game.sport ||
    identity.awayTeam !== game.awayTeam || identity.homeTeam !== game.homeTeam ||
    Date.parse(identity.gameStartAt ?? "") !== Date.parse(game.gameStartAt ?? "")) {
    throw new Error("Published market detail identity changed");
  }
  return game;
}
