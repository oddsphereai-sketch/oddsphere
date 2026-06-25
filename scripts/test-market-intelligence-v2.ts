import {
  MARKET_INTELLIGENCE_V2_ENABLED_ENV,
  MARKET_INTELLIGENCE_V2_UI_ENABLED_ENV,
  MARKET_SPLITS_MODEL_MODE_ENV,
  marketSplitsAreProductionInput,
  readMarketIntelligenceV2Config,
} from "../lib/config/marketIntelligenceV2";
import {
  buildPlaybookSplitObservationsV2,
  buildSharpApiBetMgmTicketObservationV2,
  buildSharpApiPriceObservationV2,
  buildSharpApiSplitObservationsV2,
  normalizePercentToUnit,
  stablePayloadHash,
} from "../lib/services/marketIntelligenceV2/canonicalAdapters";
import type { PlaybookSplitGame } from "../lib/providers/playbook/types";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) pass++;
  else {
    fail++;
    failures.push(detail ? `${label}: ${detail}` : label);
  }
}

function marketId(market: "moneyline" | "spread" | "total"): string {
  return `game-1:${market}`;
}

function selectionKey(market: "moneyline" | "spread" | "total", side: string): string {
  return `game-1:${market}:${side}`;
}

{
  const cfg = readMarketIntelligenceV2Config({});
  check("flags default disabled", cfg.enabled === false && cfg.uiEnabled === false);
  check("model mode defaults shadow", cfg.splitsModelMode === "shadow");
  check("shadow mode is not production input", marketSplitsAreProductionInput(cfg) === false);

  const enabled = readMarketIntelligenceV2Config({
    [MARKET_INTELLIGENCE_V2_ENABLED_ENV]: "true",
    [MARKET_INTELLIGENCE_V2_UI_ENABLED_ENV]: "true",
    [MARKET_SPLITS_MODEL_MODE_ENV]: "production",
  });
  check("strict true enables flags", enabled.enabled === true && enabled.uiEnabled === true);
  check("production mode recognized", enabled.splitsModelMode === "production");
  check("production input requires enabled + production", marketSplitsAreProductionInput(enabled) === true);

  const sloppy = readMarketIntelligenceV2Config({
    [MARKET_INTELLIGENCE_V2_ENABLED_ENV]: "TRUE",
    [MARKET_SPLITS_MODEL_MODE_ENV]: "weird",
  });
  check("flags are strict lowercase true", sloppy.enabled === false);
  check("invalid model mode falls back to shadow", sloppy.splitsModelMode === "shadow");
}

{
  const errors: string[] = [];
  check("percent 57 -> 0.57", normalizePercentToUnit(57, "x", errors) === 0.57);
  check("fraction 0.57 stays 0.57", normalizePercentToUnit(0.57, "x", errors) === 0.57);
  check("missing percent stays null", normalizePercentToUnit(null, "x", errors) === null);
  const bad: string[] = [];
  const out = normalizePercentToUnit(123, "bad_pct", bad);
  check("impossible percent rejected", out === null && bad.some((e) => e.includes("above 100")));
}

{
  const a = stablePayloadHash({ b: 2, a: { z: 1, y: 2 } });
  const b = stablePayloadHash({ a: { y: 2, z: 1 }, b: 2 });
  check("payload hash is stable across key order", a === b);
}

const playbookRow: PlaybookSplitGame = {
  gameId: "pb-1",
  league: "mlb",
  awayTeamName: "Houston Astros",
  homeTeamName: "Detroit Tigers",
  splits: {
    moneyline: {
      bets: { homePercent: 57, awayPercent: 43 },
      money: { homePercent: 53, awayPercent: 47 },
      source: { booksUsed: 11 },
    },
    total: {
      bets: { overPercent: 0.49, underPercent: 0.51 },
      money: { overPercent: 0.48, underPercent: 0.52 },
      source: { booksUsed: 10 },
    },
  },
};

{
  const result = buildPlaybookSplitObservationsV2({
    row: playbookRow,
    canonicalEventId: "game-1",
    league: "mlb",
    fetchedAt: "2026-06-25T13:00:00.000Z",
    canonicalMarketId: marketId,
    selectionKey,
  });
  check("Playbook rows accepted", result.rejected.length === 0, JSON.stringify(result.rejected));
  check("Playbook emits four populated observations", result.observations.length === 4);
  const home = result.observations.find((o) => o.market_type === "moneyline" && o.selection_key.endsWith(":home"));
  check("Playbook provider role is consensus", home?.provider === "playbook" && home.source_book === "consensus" && home.source_type === "multi_book_consensus");
  check("Playbook percentages normalize to 0..1", home?.bets_pct === 0.57 && home.money_pct === 0.53);
  check("Playbook booksUsed preserved as quality attribute", home?.books_used === 11);
  check("Playbook source timestamp is not verified", home?.source_timestamp_verified === false && home.source_observed_at === null);
}

{
  const badRow: PlaybookSplitGame = {
    ...playbookRow,
    splits: {
      moneyline: {
        bets: { homePercent: 57, awayPercent: 50 },
        money: { homePercent: 53, awayPercent: 47 },
      },
    },
  };
  const result = buildPlaybookSplitObservationsV2({
    row: badRow,
    canonicalEventId: "game-1",
    league: "mlb",
    fetchedAt: "2026-06-25T13:00:00.000Z",
    canonicalMarketId: marketId,
    selectionKey,
  });
  check("Playbook opposing percentages must approximately sum to one", result.observations.length === 0 && result.rejected.length === 1);
}

{
  const result = buildSharpApiSplitObservationsV2({
    row: {
      event_id: "sharp-1",
      sportsbook: "draftkings",
      fetched_at: "2026-06-25T12:59:00.000Z",
      moneyline: {
        bets_pct: { home: 0.57, away: 0.43 },
        handle_pct: { home: 0.88, away: 0.12 },
      },
    },
    canonicalEventId: "game-1",
    league: "mlb",
    fetchedAt: "2026-06-25T13:00:00.000Z",
    canonicalMarketId: marketId,
    selectionKey,
  });
  const home = result.observations.find((o) => o.selection_key.endsWith(":home"));
  check("SharpAPI DraftKings source stays source-specific", home?.provider === "sharpapi" && home.source_book === "draftkings" && home.source_type === "retail_book");
  check("SharpAPI split percentages normalize from fractions", home?.bets_pct === 0.57 && home.money_pct === 0.88);
  check("SharpAPI split timestamp marked verified when present", home?.source_timestamp_verified === true);
}

{
  const result = buildSharpApiSplitObservationsV2({
    row: {
      event_id: "sharp-2",
      sportsbook: "circa",
      moneyline: {
        bets_pct: { home: 57, away: 43 },
        handle_pct: { home: null, away: null },
      },
    },
    canonicalEventId: "game-1",
    league: "mlb",
    fetchedAt: "2026-06-25T13:00:00.000Z",
    canonicalMarketId: marketId,
    selectionKey,
  });
  const home = result.observations.find((o) => o.selection_key.endsWith(":home"));
  check("Circa is sharp-adjacent, not definitive sharp money", home?.source_book === "circa" && home.source_type === "sharp_adjacent_book");
  check("missing money remains null, never 0.50", home?.money_pct === null);
}

{
  const result = buildSharpApiBetMgmTicketObservationV2({
    row: {
      event_id: "sharp-3",
      sportsbook: "betmgm",
      market_type: "moneyline",
      selection_key: "game-1:moneyline:home",
      public_bet_pct: 61,
      provider_timestamp: "2026-06-25T12:58:00.000Z",
    },
    canonicalEventId: "game-1",
    canonicalMarketId: "game-1:moneyline",
    league: "mlb",
    fetchedAt: "2026-06-25T13:00:00.000Z",
  });
  const obs = result.observations[0];
  check("BetMGM ticket-only row accepted", result.rejected.length === 0 && obs?.source_book === "betmgm");
  check("BetMGM public_bet_pct maps only to bets_pct", obs?.bets_pct === 0.61 && obs.money_pct === null);
}

{
  const price = buildSharpApiPriceObservationV2({
    canonicalEventId: "game-1",
    canonicalMarketId: "game-1:moneyline",
    league: "mlb",
    sportsbook: "pinnacle",
    sharpBook: true,
    marketType: "moneyline",
    selectionKey: "game-1:moneyline:home",
    line: null,
    americanPrice: -118,
    decimalPrice: 1.847,
    providerTimestamp: "2026-06-25T12:58:00.000Z",
    fetchedAt: "2026-06-25T13:00:00.000Z",
  });
  check("price observation keeps SharpAPI timestamp as timestamp field", price.provider_timestamp === "2026-06-25T12:58:00.000Z");
  check("price observation marks sharp book explicitly", price.sharp_book === true);
}

console.log(`\nmarket-intelligence-v2: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("\nFailures:");
  for (const f of failures) console.error(`  x ${f}`);
  process.exit(1);
}
console.log("all assertions passed");
