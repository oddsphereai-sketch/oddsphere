import {
  MARKET_INTELLIGENCE_V2_ENABLED_ENV,
  MARKET_INTELLIGENCE_V2_UI_MLB_ENABLED_ENV,
  MARKET_INTELLIGENCE_V2_UI_NBA_ENABLED_ENV,
  MARKET_INTELLIGENCE_V2_UI_NCAAB_ENABLED_ENV,
  MARKET_INTELLIGENCE_V2_UI_NCAAF_ENABLED_ENV,
  MARKET_INTELLIGENCE_V2_UI_NFL_ENABLED_ENV,
  MARKET_INTELLIGENCE_V2_UI_NHL_ENABLED_ENV,
  MARKET_INTELLIGENCE_V2_UI_WNBA_ML_ENABLED_ENV,
  MARKET_INTELLIGENCE_V2_UI_WNBA_SPREAD_ENABLED_ENV,
  MARKET_INTELLIGENCE_V2_UI_WNBA_TOTAL_ENABLED_ENV,
  MARKET_INTELLIGENCE_V2_UI_WNBA_ENABLED_ENV,
  MARKET_INTELLIGENCE_V2_UI_ENABLED_ENV,
  MARKET_SPLITS_MODEL_MODE_ENV,
  LEGACY_MARKET_SIGNAL_GRADE_INFLUENCE_ENABLED_ENV,
  MARKET_AWARE_ENGINE_ENABLED_ENV,
  marketAwareEngineCanRun,
  marketIntelligenceV2UiEnabledForWnbaMarket,
  marketIntelligenceV2UiEnabledForSport,
  marketSplitsAreProductionInput,
  readMarketIntelligenceV2Config,
} from "../lib/config/marketIntelligenceV2";
import {
  buildPlaybookSplitObservationsV2,
  buildSharpApiBetMgmTicketObservationV2,
  buildSharpApiPriceObservationV2,
  buildSharpApiSplitHistoryObservationsV2,
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
  check("sport UI flags default disabled", Object.values(cfg.uiEnabledBySport).every((v) => v === false));
  check("WNBA market UI flags default disabled", Object.values(cfg.uiEnabledByWnbaMarket).every((v) => v === false));
    check("model mode defaults shadow", cfg.splitsModelMode === "shadow");
  check("market-aware engine defaults disabled", cfg.marketAwareEngineEnabled === false);
  check("legacy grade influence defaults enabled", cfg.legacyMarketSignalGradeInfluenceEnabled === true);
  check("shadow mode is not production input", marketSplitsAreProductionInput(cfg) === false);
  check("market-aware engine cannot run by default", marketAwareEngineCanRun(cfg) === false);

  const enabled = readMarketIntelligenceV2Config({
    [MARKET_INTELLIGENCE_V2_ENABLED_ENV]: "true",
      [MARKET_INTELLIGENCE_V2_UI_ENABLED_ENV]: "true",
      [MARKET_INTELLIGENCE_V2_UI_MLB_ENABLED_ENV]: "true",
      [MARKET_INTELLIGENCE_V2_UI_WNBA_ENABLED_ENV]: "true",
      [MARKET_INTELLIGENCE_V2_UI_NBA_ENABLED_ENV]: "true",
      [MARKET_INTELLIGENCE_V2_UI_NFL_ENABLED_ENV]: "true",
      [MARKET_INTELLIGENCE_V2_UI_NCAAF_ENABLED_ENV]: "true",
      [MARKET_INTELLIGENCE_V2_UI_NCAAB_ENABLED_ENV]: "true",
      [MARKET_INTELLIGENCE_V2_UI_NHL_ENABLED_ENV]: "true",
      [MARKET_INTELLIGENCE_V2_UI_WNBA_ML_ENABLED_ENV]: "true",
      [MARKET_INTELLIGENCE_V2_UI_WNBA_TOTAL_ENABLED_ENV]: "true",
      [MARKET_INTELLIGENCE_V2_UI_WNBA_SPREAD_ENABLED_ENV]: "false",
      [MARKET_SPLITS_MODEL_MODE_ENV]: "production",
    [LEGACY_MARKET_SIGNAL_GRADE_INFLUENCE_ENABLED_ENV]: "false",
    });
    check("strict true enables flags", enabled.enabled === true && enabled.uiEnabled === true);
    check("sport UI requires master switch and sport flag", marketIntelligenceV2UiEnabledForSport(enabled, "mlb") === true);
    check("WNBA sport UI flag maps directly", marketIntelligenceV2UiEnabledForSport(enabled, "wnba") === true);
    check("WNBA ML market UI can render independently", marketIntelligenceV2UiEnabledForWnbaMarket(enabled, "moneyline") === true);
    check("WNBA total market UI can render independently", marketIntelligenceV2UiEnabledForWnbaMarket(enabled, "total") === true);
    check("WNBA spread market UI remains gated off", marketIntelligenceV2UiEnabledForWnbaMarket(enabled, "spread") === false);
    check("NCAAF env maps to cfb sport key", marketIntelligenceV2UiEnabledForSport(enabled, "cfb") === true);
    check("NCAAB env maps to cbb sport key", marketIntelligenceV2UiEnabledForSport(enabled, "cbb") === true);
    check("production mode recognized", enabled.splitsModelMode === "production");
    check("production input requires enabled + production", marketSplitsAreProductionInput(enabled) === true);
  check("legacy grade influence kill switch can disable", enabled.legacyMarketSignalGradeInfluenceEnabled === false);

  const marketAware = readMarketIntelligenceV2Config({
    [MARKET_AWARE_ENGINE_ENABLED_ENV]: "true",
    [LEGACY_MARKET_SIGNAL_GRADE_INFLUENCE_ENABLED_ENV]: "true",
  });
  check("market-aware engine flag enables engine", marketAware.marketAwareEngineEnabled === true);
  check("market-aware engine forces legacy market grade influence off", marketAware.legacyMarketSignalGradeInfluenceEnabled === false);
  check("market-aware engine can run only with legacy influence off", marketAwareEngineCanRun(marketAware) === true);

  const sloppy = readMarketIntelligenceV2Config({
    [MARKET_INTELLIGENCE_V2_ENABLED_ENV]: "TRUE",
    [MARKET_INTELLIGENCE_V2_UI_MLB_ENABLED_ENV]: "true",
    [MARKET_SPLITS_MODEL_MODE_ENV]: "weird",
  });
  check("flags are strict lowercase true", sloppy.enabled === false);
  check("sport UI does not render when master UI is false", marketIntelligenceV2UiEnabledForSport(sloppy, "mlb") === false);
  check("WNBA market UI requires master UI", marketIntelligenceV2UiEnabledForWnbaMarket(sloppy, "moneyline") === false);
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
  check("Playbook line basis defaults unknown", home?.split_line_basis === "unknown");
}

{
  const result = buildPlaybookSplitObservationsV2({
    row: playbookRow,
    canonicalEventId: "game-1",
    league: "mlb",
    fetchedAt: "2026-06-25T13:00:00.000Z",
    ingestionRunId: "run-1",
    pairedLine: (market, side) => {
      if (market === "total") return { line: 8.5, price: null, basis: "paired_same_ingestion" };
      if (market === "moneyline" && side === "home") return { line: null, price: -118, basis: "paired_same_ingestion" };
      return { line: null, price: null, basis: "unknown" };
    },
    canonicalMarketId: marketId,
    selectionKey,
  });
  const totalOver = result.observations.find((o) => o.market_type === "total" && o.selection_key.endsWith(":over"));
  const mlHome = result.observations.find((o) => o.market_type === "moneyline" && o.selection_key.endsWith(":home"));
  check("Playbook same-ingestion total line is preserved", totalOver?.market_line === 8.5 && totalOver.split_line_basis === "paired_same_ingestion");
  check("Playbook same-ingestion moneyline price is preserved", mlHome?.market_price === -118 && mlHome.ingestion_run_id === "run-1");
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
  check("BetMGM ticket-only row uses ticket-share source type", obs?.source_type === "retail_ticket_share");
  check("BetMGM public_bet_pct maps only to bets_pct", obs?.bets_pct === 0.61 && obs.money_pct === null);
}

{
  const result = buildSharpApiSplitObservationsV2({
    row: {
      event_id: "mlb_probe_2026-06-25",
      sportsbook: "betmgm",
      league: "mlb",
      fetched_at: "2026-06-25T13:00:00Z",
      moneyline: {
        bets_pct: { home: 61, away: 39 },
        handle_pct: { home: 70, away: 30 },
      },
    },
    canonicalEventId: "game-1",
    league: "mlb",
    fetchedAt: "2026-06-25T17:00:00.000Z",
    canonicalMarketId: marketId,
    selectionKey,
  });
  const betMgmHome = result.observations.find((o) => o.selection_key.endsWith(":home"));
  check("SharpAPI /splits accepts BetMGM ticket rows", result.observations.length === 2 && result.rejected.length === 0);
  check("SharpAPI /splits never promotes BetMGM handle_pct to money share", betMgmHome?.bets_pct === 0.61 && betMgmHome.money_pct === null);
}

{
  const result = buildSharpApiSplitHistoryObservationsV2({
    row: {
      book: "circa",
      ts: "2026-06-25T13:00:33.987292+00:00",
      moneyline: {
        away_odds: -105,
        home_odds: -115,
        bets_pct: { away: 0.38, home: 0.62 },
        handle_pct: { away: 0.12, home: 0.88 },
      },
      spread: {
        away_line: -1.5,
        home_line: 1.5,
        bets_pct: { away: 0.43, home: 0.57 },
        handle_pct: { away: 0.95, home: 0.05 },
      },
      total: {
        line: 9,
        bets_pct: { over: 0.39, under: 0.61 },
        handle_pct: { over: 0.98, under: 0.02 },
      },
    },
    providerEventId: "mlb_astros_tigers_2026-06-25",
    canonicalEventId: "game-1",
    league: "mlb",
    fetchedAt: "2026-06-25T17:00:00.000Z",
    ingestionRunId: "run-history",
    canonicalMarketId: marketId,
    selectionKey,
  });
  const mlHome = result.observations.find((o) => o.market_type === "moneyline" && o.selection_key.endsWith(":home"));
  const spreadAway = result.observations.find((o) => o.market_type === "spread" && o.selection_key.endsWith(":away"));
  const totalOver = result.observations.find((o) => o.market_type === "total" && o.selection_key.endsWith(":over"));
  check("SharpAPI history emits six observations", result.observations.length === 6, `${result.observations.length}`);
  check("SharpAPI history preserves Circa source", mlHome?.source_book === "circa" && mlHome.source_type === "sharp_adjacent_book");
  check("SharpAPI history preserves side-specific moneyline price", mlHome?.market_price === -115);
  check("SharpAPI history preserves spread side line", spreadAway?.market_line === -1.5);
  check("SharpAPI history preserves total line", totalOver?.market_line === 9);
  check(
    "SharpAPI history keeps provider time separate from poll time",
    mlHome?.source_timestamp_verified === true &&
      mlHome.source_observed_at === "2026-06-25T13:00:33.987292+00:00" &&
      mlHome.fetched_at === "2026-06-25T17:00:00.000Z",
  );
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
