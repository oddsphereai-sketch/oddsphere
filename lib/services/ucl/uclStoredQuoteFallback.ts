import type { EplSharpFixtureMarket, EplSharpOddsRecord } from "@/lib/providers/real_api/SharpApiEplMarketProvider";
import type { EplStoredPriceObservation } from "@/lib/services/epl/buildEplDailyEdgePreview";

export const UCL_STORED_QUOTE_FALLBACK_RELEASE =
  "ucl_stored_quote_fallback_2026_10_14_r1_complete_same_book" as const;

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
  const grouped = new Map<string, Set<string>>();
  for (const row of fixture.odds) {
    if (row.market !== market || row.odds_american === null || !row.sportsbook) continue;
    if (market === "total" && row.line !== 2.5) continue;
    const key = `${canonicalBook(row.sportsbook)}:${lineKey(market, row.line)}`;
    const sides = grouped.get(key) ?? new Set<string>();
    sides.add(row.selection);
    grouped.set(key, sides);
  }
  return [...grouped.values()].some((sides) => required.every((side) => sides.has(side)));
}

function storedRowsForMarket(input: {
  providerId: number;
  market: Market;
  history: EplStoredPriceObservation[];
}): EplSharpOddsRecord[] {
  const latestByGroupSide = new Map<string, EplStoredPriceObservation>();
  for (const row of input.history) {
    if (row.providerId !== input.providerId || row.market !== input.market || !row.sportsbook) continue;
    if (!Number.isFinite(row.american) || row.american === 0) continue;
    if (input.market === "total" && row.line !== 2.5) continue;
    const key = `${canonicalBook(row.sportsbook)}:${lineKey(row.market, row.line)}:${row.side}`;
    const prior = latestByGroupSide.get(key);
    if (!prior || Date.parse(row.recordedAt) >= Date.parse(prior.recordedAt)) latestByGroupSide.set(key, row);
  }

  const groups = new Map<string, EplStoredPriceObservation[]>();
  for (const row of latestByGroupSide.values()) {
    const key = `${canonicalBook(row.sportsbook)}:${lineKey(row.market, row.line)}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const required = MARKET_REQUIREMENTS[input.market];
  return [...groups.values()].flatMap((rows) => {
    const bySide = new Map(rows.map((row) => [row.side, row]));
    if (!required.every((side) => bySide.has(side))) return [];
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

/** Restore an absent UCL market from its latest complete same-book stored
 * tuples. Any complete current provider market wins untouched. Stored rows
 * remain exact-price availability/economics evidence and are deliberately
 * ineligible for forecast arbitration because their original Sharp event ID
 * was not retained by the legacy line-history schema. */
export function applyUclStoredQuoteFallback(input: {
  fixture: EplSharpFixtureMarket;
  providerId: number;
  history: EplStoredPriceObservation[];
}): EplSharpFixtureMarket {
  const fallbackRows = (Object.keys(MARKET_REQUIREMENTS) as Market[]).flatMap((market) => {
    if (currentMarketIsComplete(input.fixture, market)) return [];
    return storedRowsForMarket({ providerId: input.providerId, market, history: input.history });
  });
  if (fallbackRows.length === 0) return input.fixture;
  return { ...input.fixture, odds: [...input.fixture.odds, ...fallbackRows] };
}
