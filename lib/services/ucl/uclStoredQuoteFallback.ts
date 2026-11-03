import type { EplSharpFixtureMarket, EplSharpOddsRecord } from "@/lib/providers/real_api/SharpApiEplMarketProvider";
import type { EplStoredPriceObservation } from "@/lib/services/epl/buildEplDailyEdgePreview";
import { soccerStoredPriceMaxAgeMs } from "@/lib/providers/real_api/CurrentSoccerMarketProvider";

export const UCL_STORED_QUOTE_FALLBACK_RELEASE =
  "ucl_stored_quote_fallback_2026_11_03_r3_intact_complete_same_book" as const;

export const UCL_STORED_QUOTE_FALLBACK_ENDPOINT = "/oddsphere/ucl/stored-line-history" as const;

type Market = EplStoredPriceObservation["market"];

const MARKET_REQUIREMENTS: Record<Market, readonly string[]> = {
  match_result: ["home", "draw", "away"],
  double_chance: ["home_or_draw", "away_or_draw", "home_or_away"],
  total: ["over", "under"],
  btts: ["yes", "no"],
};

function canonicalBook(value: string | null): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function decimalFromAmerican(american: number): number {
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

function lineKey(market: Market, line: number | null): string {
  return market === "total" ? String(line ?? "missing") : "main";
}

function currentMarketIsComplete(fixture: EplSharpFixtureMarket, market: Market): boolean {
  const required = MARKET_REQUIREMENTS[market];
  const grouped = new Map<string, Map<string, number>>();
  const conflicted = new Set<string>();
  for (const row of fixture.odds) {
    if (row.market !== market || row.odds_american === null || !row.sportsbook) continue;
    if (market === "total" && row.line !== 2.5) continue;
    const key = JSON.stringify([canonicalBook(row.sportsbook), lineKey(market, row.line),
      row.provider, row.provider_endpoint, row.provider_event_id, Date.parse(row.fetched_at)]);
    const sides = grouped.get(key) ?? new Map<string, number>();
    if (sides.has(row.selection) && sides.get(row.selection) !== row.odds_american) conflicted.add(key);
    sides.set(row.selection, row.odds_american);
    grouped.set(key, sides);
  }
  return [...grouped.entries()].some(([key, sides]) => !conflicted.has(key) && required.every((side) => sides.has(side)));
}

function storedRowsForMarket(input: {
  providerId: number;
  market: Market;
  history: EplStoredPriceObservation[];
  kickoff: string;
  nowMs: number;
}): EplSharpOddsRecord[] {
  const groups = new Map<string, EplStoredPriceObservation[]>();
  for (const row of input.history) {
    if (row.providerId !== input.providerId || row.market !== input.market || !row.sportsbook) continue;
    if (!Number.isFinite(row.american) || row.american === 0) continue;
    const recordedAt = Date.parse(row.recordedAt);
    if (row.isOpener || !Number.isFinite(recordedAt) || recordedAt > input.nowMs
      || input.nowMs - recordedAt > soccerStoredPriceMaxAgeMs(input.kickoff, input.nowMs)) continue;
    if (input.market === "total" && row.line !== 2.5) continue;
    const key = `${canonicalBook(row.sportsbook)}:${lineKey(row.market, row.line)}:${recordedAt}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const required = MARKET_REQUIREMENTS[input.market];
  const latestComplete = new Map<string, EplStoredPriceObservation[]>();
  for (const rows of groups.values()) {
    const bySide = new Map(rows.map((row) => [row.side, row]));
    if (!required.every((side) => bySide.has(side)) || rows.some(row =>
      rows.some(other => other.side === row.side && other.american !== row.american))) continue;
    const first = rows[0]!;
    const key = `${canonicalBook(first.sportsbook)}:${lineKey(first.market, first.line)}`;
    const prior = latestComplete.get(key);
    if (!prior || Date.parse(first.recordedAt) > Date.parse(prior[0]!.recordedAt)) latestComplete.set(key, rows);
  }
  return [...latestComplete.values()].flatMap(rows => {
    const bySide = new Map(rows.map(row => [row.side, row]));
    return required.map((side): EplSharpOddsRecord => {
      const row = bySide.get(side)!;
      return {
        market: row.market,
        selection: row.side as EplSharpOddsRecord["selection"],
        line: row.market === "total" ? row.line : null,
        odds_american: row.american,
        odds_decimal: decimalFromAmerican(row.american),
        sportsbook: row.sportsbook,
        provider: "stored_quote",
        provider_endpoint: UCL_STORED_QUOTE_FALLBACK_ENDPOINT,
        fetched_at: row.recordedAt,
        provider_event_id: null,
        fetched_at_source: "oddsphere_capture",
        persistable: false,
      };
    });
  });
}

/** Restore an absent UCL market from its latest fresh complete same-book stored
 * tuples under the shared soccer freshness window. Current provider markets win. Stored rows
 * remain exact-price availability/economics evidence and are deliberately
 * ineligible for forecast arbitration because their original Sharp event ID
 * was not retained by the legacy line-history schema. */
export function applyUclStoredQuoteFallback(input: {
  fixture: EplSharpFixtureMarket;
  providerId: number;
  history: EplStoredPriceObservation[];
  kickoff: string;
  now?: Date;
}): EplSharpFixtureMarket {
  const fallbackRows = (Object.keys(MARKET_REQUIREMENTS) as Market[]).flatMap((market) => {
    if (currentMarketIsComplete(input.fixture, market)) return [];
    return storedRowsForMarket({ providerId: input.providerId, market, history: input.history,
      kickoff: input.kickoff, nowMs: (input.now ?? new Date()).getTime() });
  });
  if (fallbackRows.length === 0) return input.fixture;
  const restoredMarkets = new Set(fallbackRows.map(row => row.market));
  // These markets have no intact current official family. Do not leave their
  // partial fragments ahead of the fallback for downstream first-side readers.
  const current = input.fixture.odds.filter(row => !restoredMarkets.has(row.market) || row.market === "total" && row.line !== 2.5);
  return { ...input.fixture, odds: [...current, ...fallbackRows] };
}
