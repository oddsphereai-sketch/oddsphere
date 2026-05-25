import type { Sport } from "../../types/domain/Sport";
import type { IOddsProvider, LineRecord } from "../interfaces/IOddsProvider";
import type {
  MarketType,
  PropMarketType,
} from "../../types/domain/Lines";

import linesJson from "./fixtures/lines.json";
import propsJson from "./fixtures/player_props.json";
import gamesJson from "./fixtures/games.json";
import playersJson from "./fixtures/players.json";

const GAME_LINES = linesJson as unknown as LineRecord[];
const RAW_PROPS = propsJson as unknown as Array<
  LineRecord & { event_external_id?: string }
>;

// Slate-date + sport indexing of games (mock games only have UTC timestamps)
type GameMeta = { id: number; sport: Sport; slate: string };
const GAMES_META: GameMeta[] = (gamesJson as unknown as Array<{
  external_id: number;
  sport: Sport;
  game_date: string;
}>).map((g) => {
  const t = new Date(g.game_date);
  const slate =
    t.getUTCHours() < 6
      ? new Date(t.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10)
      : g.game_date.slice(0, 10);
  return { id: g.external_id, sport: g.sport, slate };
});

const IS_PITCHER = new Map<number, boolean>(
  (playersJson as unknown as Array<{ external_id: number; is_pitcher: boolean }>).map(
    (p) => [p.external_id, p.is_pitcher]
  )
);

/**
 * Map SharpAPI-style prop market strings (`player_*`) to our internal
 * PropMarketType union (`batter_*` / `pitcher_*`). For `player_strikeouts`,
 * the bucket depends on whether the player is a pitcher.
 */
function mapPropMarket(
  raw: string,
  playerExternalId: number | null
): MarketType {
  switch (raw) {
    case "player_hits":
      return "batter_hits" as PropMarketType;
    case "player_total_bases":
      return "batter_total_bases" as PropMarketType;
    case "player_home_runs":
      return "batter_home_runs" as PropMarketType;
    case "player_rbis":
      return "batter_rbis" as PropMarketType;
    case "player_strikeouts":
      // Disambiguate by player kind. Default to pitcher for safety.
      if (playerExternalId !== null && IS_PITCHER.get(playerExternalId) === false) {
        return "batter_strikeouts" as PropMarketType;
      }
      return "pitcher_strikeouts" as PropMarketType;
    case "player_earned_runs":
      return "pitcher_earned_runs" as PropMarketType;
    case "player_hits_allowed":
      return "pitcher_hits_allowed" as PropMarketType;
    default:
      // Pass through unknowns; provider boundary is forgiving so future
      // SharpAPI markets don't blow up the call.
      return raw as MarketType;
  }
}

function gamesOnSlate(date: string, sport?: Sport): Set<number> {
  return new Set(
    GAMES_META.filter(
      (g) => g.slate === date && (sport === undefined || g.sport === sport)
    ).map((g) => g.id)
  );
}

export class MockOddsProvider implements IOddsProvider {
  async getGameLines(date: string, sport?: Sport): Promise<LineRecord[]> {
    const ids = gamesOnSlate(date, sport);
    return GAME_LINES.filter((l) => ids.has(l.game_external_id));
  }

  async getPlayerProps(date: string, sport?: Sport): Promise<LineRecord[]> {
    const ids = gamesOnSlate(date, sport);
    return RAW_PROPS.filter((p) => ids.has(p.game_external_id)).map((raw) => {
      // Strip event_external_id (not on LineRecord) and normalize market_type
      // from SharpAPI's `player_*` strings to our internal PropMarketType.
      const { event_external_id: _drop, market_type, player_external_id, ...rest } = raw as
        LineRecord & { event_external_id?: string; market_type: string };
      return {
        ...rest,
        market_type: mapPropMarket(market_type, player_external_id),
        player_external_id,
      };
    });
  }
}
