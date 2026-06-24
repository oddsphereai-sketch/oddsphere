/**
 * Playbook public-splits mapper.
 *
 * Converts Playbook's public bet% / money% rows into OddSphere's existing
 * SharpSignalRecord shape for PUBLIC-SPLITS ONLY.
 *
 * Safety contract:
 *   - Playbook does NOT provide +EV, Pinnacle fair probability, steam, RLM,
 *     CLV, or sportsbook-specific movement.
 *   - This mapper therefore sets those fields to null/false.
 *   - It emits moneyline / total / spread split records only.
 *   - It is pure: no DB, no network, no production writes.
 */

import type { MarketType, Side } from "../../types/domain/Lines";
import type { SharpSignalRecord } from "../interfaces/ISharpSignalProvider";
import { normalizeMlbTeamName } from "../real_api/_teamNameNormalizer";
import type { PlaybookSplitGame } from "./types";
import {
  buildGameKey as buildPlaybookGameKey,
  type NormalizerSport,
} from "./playbookTeamNormalizer";

export type PlaybookSplitsMapperSport = "mlb" | NormalizerSport;

export type PlaybookSplitsMapResult = {
  records: SharpSignalRecord[];
  stats: {
    rowsRead: number;
    rowsMapped: number;
    recordsEmitted: number;
    skippedUnresolvedTeam: number;
    skippedNoGameExternalId: number;
    skippedNoSplitCells: number;
  };
};

export type PlaybookSplitsMapperOptions = {
  sport: PlaybookSplitsMapperSport;
  rows: PlaybookSplitGame[];
  /**
   * Stable away@home key -> game_external_id.
   *
   * For MLB this key is canonical abbreviations, e.g. "NYY@BOS".
   * For WNBA this key is also canonical abbreviations once the WNBA registry
   * resolves provider names.
   */
  gameExternalIdByKey: ReadonlyMap<string, number>;
  computedAt: string;
};

function asPct(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function keyForRow(sport: PlaybookSplitsMapperSport, row: PlaybookSplitGame): string | null {
  if (sport === "mlb") {
    const away = normalizeMlbTeamName(row.awayTeamName ?? "");
    const home = normalizeMlbTeamName(row.homeTeamName ?? "");
    return away && home ? `${away}@${home}` : null;
  }
  return buildPlaybookGameKey(sport, row.awayTeamName, row.homeTeamName);
}

function splitPctFor(
  row: PlaybookSplitGame,
  market: MarketType,
  side: Side
): { betting: number | null; money: number | null } {
  if (market === "moneyline") {
    const m = row.splits?.moneyline;
    if (side === "home") {
      return { betting: asPct(m?.bets?.homePercent), money: asPct(m?.money?.homePercent) };
    }
    if (side === "away") {
      return { betting: asPct(m?.bets?.awayPercent), money: asPct(m?.money?.awayPercent) };
    }
  }

  if (market === "spread") {
    const m = row.splits?.spread;
    if (side === "home") {
      return { betting: asPct(m?.bets?.homePercent), money: asPct(m?.money?.homePercent) };
    }
    if (side === "away") {
      return { betting: asPct(m?.bets?.awayPercent), money: asPct(m?.money?.awayPercent) };
    }
  }

  if (market === "total") {
    const m = row.splits?.total;
    if (side === "over") {
      return { betting: asPct(m?.bets?.overPercent), money: asPct(m?.money?.overPercent) };
    }
    if (side === "under") {
      return { betting: asPct(m?.bets?.underPercent), money: asPct(m?.money?.underPercent) };
    }
  }

  return { betting: null, money: null };
}

function makePublicSplitSignal(opts: {
  gameExternalId: number;
  market: MarketType;
  side: Side;
  betting: number | null;
  money: number | null;
  computedAt: string;
}): SharpSignalRecord {
  return {
    game_external_id: opts.gameExternalId,
    market_type: opts.market,
    side: opts.side,
    pinnacle_fair_probability: null,
    is_plus_ev: false,
    ev_pct: null,
    has_steam_move: false,
    steam_detected_at: null,
    steam_books_count: null,
    has_reverse_line_movement: false,
    rlm_direction: null,
    public_betting_pct: opts.betting,
    public_money_pct: opts.money,
    signal_strength: null,
    signal_summary: null,
    computed_at: opts.computedAt,
  };
}

export function mapPlaybookSplitsToSharpSignalRecords(
  opts: PlaybookSplitsMapperOptions
): PlaybookSplitsMapResult {
  const stats: PlaybookSplitsMapResult["stats"] = {
    rowsRead: opts.rows.length,
    rowsMapped: 0,
    recordsEmitted: 0,
    skippedUnresolvedTeam: 0,
    skippedNoGameExternalId: 0,
    skippedNoSplitCells: 0,
  };
  const records: SharpSignalRecord[] = [];
  const markets: ReadonlyArray<{ market: MarketType; sides: readonly Side[] }> = [
    { market: "moneyline", sides: ["home", "away"] },
    { market: "total", sides: ["over", "under"] },
    { market: "spread", sides: ["home", "away"] },
  ];

  for (const row of opts.rows) {
    const key = keyForRow(opts.sport, row);
    if (!key) {
      stats.skippedUnresolvedTeam++;
      continue;
    }
    const gameExternalId = opts.gameExternalIdByKey.get(key);
    if (gameExternalId === undefined) {
      stats.skippedNoGameExternalId++;
      continue;
    }

    let emittedForRow = 0;
    for (const { market, sides } of markets) {
      for (const side of sides) {
        const { betting, money } = splitPctFor(row, market, side);
        if (betting === null && money === null) continue;
        records.push(
          makePublicSplitSignal({
            gameExternalId,
            market,
            side,
            betting,
            money,
            computedAt: opts.computedAt,
          })
        );
        emittedForRow++;
      }
    }

    if (emittedForRow === 0) {
      stats.skippedNoSplitCells++;
    } else {
      stats.rowsMapped++;
      stats.recordsEmitted += emittedForRow;
    }
  }

  return { records, stats };
}
