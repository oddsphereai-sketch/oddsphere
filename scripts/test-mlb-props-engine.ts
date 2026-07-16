import {
  american_to_decimal,
  american_to_implied_probability,
  decimal_to_american,
  expected_value,
  kelly_fraction,
  remove_vig_two_way,
  recommended_fractional_kelly_stake,
} from "../lib/mlb/props/oddsMath";
import { MockMLBProvider } from "../lib/mlb/props/providerClients";
import { parseBallDontLiePlayerProps, parseMlbStatsGames, parseMlbStatsProbablePitchers, parseSharpApiProps } from "../lib/mlb/props/providerClients";
import { existsSync, readFileSync } from "fs";
import { buildMlbPropFeatureSnapshot } from "../lib/mlb/props/featureBuilder";
import { PitcherStrikeoutsModel, modelForMlbPropMarket } from "../lib/mlb/props/models";
import { PitcherOutsModel } from "../lib/mlb/props/models";
import { recommendPropBet } from "../lib/mlb/props/recommendations";
import { runFixtureMlbPropBacktest } from "../lib/mlb/props/backtest";
import { normalizePlayerName, resolveMlbPlayer } from "../lib/mlb/props/entityResolution";
import { comparePropClv } from "../lib/mlb/props/clv";
import { outsFromInningsPitched, settlePropPick, settlementResultFromFinalStats } from "../lib/mlb/props/settlement";
import { getPublicPicksMode, isPublicRecommendationVisible } from "../lib/mlb/props/publicPicksSafety";
import { mapSharpEventToGame, resolveSharpPropRow, scoreRealMlbPropsDryRun, scoreRealMlbPropsForPaper } from "../lib/mlb/props/realScoring";
import { classifySharpApiAvailability, diagnoseSharpApiMlbPropsAvailability } from "../lib/mlb/props/sharpApiAvailabilityDiagnostics";
import { resolveMlbTeamAlias } from "../lib/mlb/props/mlbTeamAliases";
import { evaluateRealPaperPersistenceGate, isPaperTradingMarketAllowed } from "../lib/mlb/props/paperTrading";
import { allMlbPropMarketDefinitions } from "../lib/mlb/props/marketCatalog";
import { checkProjectionSideIntegrity } from "../lib/mlb/props/projectionSideIntegrity";
import {
  buildPlayerPitchArsenalEvidence,
  buildPlayerPitchMixMatchupEvidence,
  buildPlayerPropEnvironmentEvidence,
  buildPlayerPropOpponentProfile,
  buildPlayerPropRecentForm,
} from "../lib/mlb/props/researchEvidence";
import { parseBdlHitterPitchTypeStats, parseBdlPitchTypeStats, parseBdlResearchPlayer } from "../lib/mlb/props/ballDontLieResearch";
import { enrichPlayerPropResearchRows } from "../lib/mlb/props/researchEnrichment";
import { parseNwsHourlyForecast } from "../lib/mlb/props/nwsWeatherClient";
import { parseStatcastParkFactorsHtml } from "../lib/mlb/props/statcastParkFactors";
import { loadSlateEnvironmentResearch } from "../lib/mlb/props/environmentResearch";
import type { MlbTeamHittingProfile } from "../lib/providers/real_api/_mlbStatsApiClient";
import {
  PROP_GRADES,
  getPropGradeColor,
  getPropGradeDescription,
  getPropGradeLabel,
  isActionablePropGrade,
  isInspectablePropGrade,
  mapLegacyPropStatusToGrade,
  type PropGrade,
} from "../lib/mlb/props/propGrades";
import type { MlbGameEntity, MlbHistoricalStatRow, MlbProbablePitcher, PropOddsSnapshot } from "../lib/mlb/props/providers";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, condition: boolean) {
  if (condition) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
}

function approx(a: number, b: number, tolerance = 1e-6) {
  return Math.abs(a - b) <= tolerance;
}

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as unknown as NodeJS.ProcessEnv;
}

async function main() {
  console.log("\n━━━ MLB Props Engine Phase 1 ━━━");

  check("positive American odds to decimal", approx(american_to_decimal(150), 2.5));
  check("negative American odds to decimal", approx(american_to_decimal(-200), 1.5));
  check("even money decimal to American", decimal_to_american(2) === 100);
  check("positive American implied", approx(american_to_implied_probability(150), 0.4));
  check("negative American implied", approx(american_to_implied_probability(-200), 2 / 3));
  const devig = remove_vig_two_way(-110, -110);
  check("two-way devig sums to 1", approx(devig.over + devig.under, 1));
  check("EV positive candidate", expected_value(0.6, 110) > 0);
  check("Kelly positive for +EV", kelly_fraction(0.6, 110) > 0);
  check("no stake when EV negative", recommended_fractional_kelly_stake({
    modelProbability: 0.4,
    americanOdds: -110,
    bankroll: 1000,
    fractionalKelly: 0.15,
    maxBankrollFraction: 0.005,
  }) === 0);

  const oddsSample = JSON.parse(readFileSync("tests/fixtures/mlb-props/real-contract-samples/sharpapi-props-sample.json", "utf8"));
  const parsedOddsSample = parseSharpApiProps(oddsSample, "2026-07-07T15:00:00.000Z");
  check("Sharp API fixture parser extracts supported props", parsedOddsSample.length === 3 && parsedOddsSample.some((row) => row.marketKey === "pitcher_strikeouts") && parsedOddsSample.some((row) => row.marketKey === "pitcher_outs"));
  const robustSharpSample = {
    data: [
      {
        event_id: "mlb_nym_tor_2026-07-07_b3",
        market: { key: "player_pitching_strikeouts" },
        player: { name: "Nolan McLean", id: "sharp-player-1" },
        sportsbook: { id: "hardrock" },
        selection: { type: "Over", line: 5.5, odds_american: 112 },
      },
      {
        event_id: "mlb_nym_tor_2026-07-07_b3",
        market_type: "player_pitching_outs",
        player_name: "Nolan McLean",
        book: "draftkings",
        selection_type: "Under",
        line: 17.5,
        odds_american: -118,
      },
      {
        event_id: "mlb_nym_tor_2026-07-07_b3",
        market_type: "moneyline",
        selection_type: "home",
        odds_american: -120,
      },
    ],
    pagination: { next_cursor: null },
  };
  const robustParsed = parseSharpApiProps(robustSharpSample, "2026-07-07T15:00:00.000Z", {
    id: "mlb_nym_tor_2026-07-07_b3",
    start_time: "2026-07-07T23:07:00.000Z",
    home_team: "Toronto Blue Jays",
    away_team: "New York Mets",
    markets: ["moneyline"],
  });
  check("Sharp parser reads nested unfiltered event odds player props", robustParsed.length === 2);
  check("Sharp parser normalizes pitching market variants", robustParsed.some((row) => row.marketKey === "pitcher_strikeouts") && robustParsed.some((row) => row.marketKey === "pitcher_outs"));
  check("Sharp parser does not require event markets to advertise props", robustParsed.every((row) => row.rawPayload && (row.rawPayload as { event_home_team?: unknown }).event_home_team === "Toronto Blue Jays"));
  const bdlPropsSample = {
    data: [
      {
        id: 101,
        game_id: 7001,
        player_id: 9001,
        vendor: "DraftKings",
        prop_type: "pitcher_strikeouts",
        line_value: 5.5,
        market: { type: "over_under", over_odds: 115, under_odds: -135 },
        updated_at: "2026-07-07T14:45:00.000Z",
        player: { full_name: "Nolan McLean" },
      },
      {
        id: 102,
        game_id: 7001,
        player_id: 9001,
        vendor: "FanDuel",
        prop_type: "pitcher_outs",
        line_value: 17.5,
        market: { type: "over_under", over_odds: -105, under_odds: -115 },
        updated_at: "2026-07-07T14:46:00.000Z",
        player: { full_name: "Nolan McLean" },
      },
      {
        id: 103,
        game_id: 7001,
        player_id: 9001,
        vendor: "Caesars",
        prop_type: "pitcher_strikeouts",
        line_value: 7,
        market: { type: "milestone", odds: 220 },
        updated_at: "2026-07-07T14:47:00.000Z",
      },
      {
        id: 104,
        game_id: 7001,
        player_id: 9001,
        vendor: "BetMGM",
        prop_type: "pitcher_strikeouts",
        line_value: 6.5,
        market: { type: "over_under", over_odds: 120 },
        updated_at: "2026-07-07T14:48:00.000Z",
      },
    ],
  };
  const bdlParsed = parseBallDontLiePlayerProps(bdlPropsSample, "2026-07-07T15:00:00.000Z", {
    id: 7001,
    game_date: "2026-07-07T23:07:00.000Z",
    status: "scheduled",
    home_team: { full_name: "Toronto Blue Jays" },
    away_team: { full_name: "New York Mets" },
  });
  check("BDL player_props over_under parser emits two-way rows", bdlParsed.length === 6 && bdlParsed.some((row) => row.side === "over") && bdlParsed.some((row) => row.side === "under"));
  check("BDL pitcher_strikeouts normalization works", bdlParsed.filter((row) => row.marketKey === "pitcher_strikeouts").length === 4);
  check("BDL pitcher_outs normalization works", bdlParsed.filter((row) => row.marketKey === "pitcher_outs").length === 2);
  check("BDL milestone markets preserved as research-only", bdlParsed.some((row) => (row.rawPayload as { provider_prop_id?: unknown; market_kind?: unknown; recommendation_eligibility?: unknown }).provider_prop_id === "103" && (row.rawPayload as { market_kind?: unknown }).market_kind === "milestone" && (row.rawPayload as { recommendation_eligibility?: unknown }).recommendation_eligibility === "eligible_now"));
  check("BDL vendors and updated_at preserved", bdlParsed.some((row) => row.sportsbook === "draftkings" && row.asOfTimestamp === "2026-07-07T14:45:00.000Z"));
  check("BDL missing over/under pair preserved with reason", bdlParsed.some((row) => (row.rawPayload as { provider_prop_id?: unknown; reason_codes?: string[] }).provider_prop_id === "104" && ((row.rawPayload as { reason_codes?: string[] }).reason_codes ?? []).includes("MISSING_TWO_WAY_PAIR")));
  const bdlOpeningParsed = parseBallDontLiePlayerProps({ data: [{ ...bdlPropsSample.data[0], opened_at: "2026-07-07T12:00:00.000Z", updated_at: undefined }] }, "2026-07-07T15:00:00.000Z", undefined, "opening");
  check("BDL opening props preserve opened_at and opening role", bdlOpeningParsed.length === 2 && bdlOpeningParsed.every((row) => row.snapshotRole === "opening" && row.asOfTimestamp === "2026-07-07T12:00:00.000Z"));
  const fullBdlMarketSample = {
    data: allMlbPropMarketDefinitions().map((definition, index) => ({
      id: 200 + index,
      game_id: 7001,
      player_id: 9100 + index,
      vendor: "DraftKings",
      prop_type: definition.marketKey.replace(/^batter_/, "").replace("pitcher_record_a_win", "pitcher_record_a_win"),
      line_value: definition.milestone ? 0.5 : 1.5,
      market: definition.milestone ? { type: "milestone", odds: 240 } : { type: "over_under", over_odds: 105, under_odds: -125 },
      updated_at: "2026-07-07T14:50:00.000Z",
      player: { full_name: `Fixture Player ${index}` },
    })),
  };
  const fullBdlParsed = parseBallDontLiePlayerProps(fullBdlMarketSample, "2026-07-07T15:00:00.000Z", {
    id: 7001,
    game_date: "2026-07-07T23:07:00.000Z",
    status: "scheduled",
    home_team: { full_name: "Toronto Blue Jays" },
    away_team: { full_name: "New York Mets" },
  });
  check("all cataloged BDL markets normalize", allMlbPropMarketDefinitions().every((definition) => fullBdlParsed.some((row) => row.marketKey === definition.marketKey)));
  check("all markets have model families", allMlbPropMarketDefinitions().every((definition) => definition.modelFamily.length > 0 && modelForMlbPropMarket(definition.marketKey).marketKey === definition.marketKey));
  check("all markets have complete product metadata", allMlbPropMarketDefinitions().every((definition) => definition.marketGroup.length > 0 && definition.displayGroup.length > 0 && definition.requiredFeatures.length > 0 && definition.preferredFeatures.length > 0 && definition.optionalFeatures.length > 0 && definition.confidenceGates.minimum > 0 && isInspectablePropGrade(definition.defaultGrade)));
  const scheduleSample = JSON.parse(readFileSync("tests/fixtures/mlb-props/real-contract-samples/mlbstats-schedule-sample.json", "utf8"));
  check("MLB Stats fixture parser extracts games", parseMlbStatsGames(scheduleSample).length === 1);
  check("MLB Stats fixture parser extracts probable pitchers", parseMlbStatsProbablePitchers(scheduleSample, "2026-07-07T15:00:00.000Z").length === 2);
  check("production display disabled returns no public picks", getPublicPicksMode({
    NODE_ENV: "production",
    ODDSPHERE_PROP_MODEL_ENV: "production",
    ODDSPHERE_PROPS_DISPLAY_ENABLED: "false",
  } as NodeJS.ProcessEnv).mode === "disabled");
  check("local mock preview disabled without explicit public API flag", getPublicPicksMode({
    NODE_ENV: "development",
    ODDSPHERE_PROP_MODEL_ENV: "development",
    ODDSPHERE_PROPS_DISPLAY_ENABLED: "false",
    ODDSPHERE_PROPS_PUBLIC_API_ENABLED: "false",
  } as NodeJS.ProcessEnv).mode === "disabled");
  check("public API flag alone does not enable props", getPublicPicksMode({
    NODE_ENV: "development",
    ODDSPHERE_PROP_MODEL_ENV: "development",
    ODDSPHERE_PROPS_DISPLAY_ENABLED: "false",
    ODDSPHERE_PROPS_PUBLIC_API_ENABLED: "true",
  } as NodeJS.ProcessEnv).mode === "disabled");
  check("display flag alone does not enable public props", getPublicPicksMode({
    NODE_ENV: "production",
    ODDSPHERE_PROP_MODEL_ENV: "production",
    ODDSPHERE_PROPS_DISPLAY_ENABLED: "true",
    ODDSPHERE_PROPS_PUBLIC_API_ENABLED: "false",
  } as NodeJS.ProcessEnv).mode === "disabled");
  const previewFixture = JSON.parse(readFileSync("tests/fixtures/mlb-props/player-props-preview-full.json", "utf8")) as {
    slate: { practice: boolean; contextStatus: string; matchups: Array<{ awayTeam: string; homeTeam: string; starterStatus: string }> };
    providerStatus: { selectedOddsSource: string; sharpApi: string; bdl: string; writesToSupabase: boolean; publicDisplayEnabled: boolean };
    props: Array<{ id: string; player: string; market: string; book: string; source: string; status: string; playGrade: PropGrade; side: "over" | "under"; line: number; projection: number; overProbability: number; underProbability: number; modelEdge: number | null; expectedValue: number | null; confidence: number; marketProbability: number | null; modelProbability: number; finalProbability: number; reasonCodes: string[]; recentForm?: { coverage: string; source: string; logs: Array<{ value: number; opponent: string }> }; opponentProfile?: { source: string; teamAbbreviation: string; plateAppearances: number; researchOnly: boolean }; pitchArsenal?: { source: string; pitchesTracked: number; pitches: Array<{ code: string }>; researchOnly: boolean }; pitchMatchup?: { pitcherName: string; pitchMixCoveragePercent: number; matchedPitchTypes: number; researchOnly: boolean }; environment?: { venue: string; park: { status: string; runFactor: number | null }; weather: { status: string; conditions: string | null }; researchOnly: boolean } }>;
  };
  check("preview fixture covers full market families", allMlbPropMarketDefinitions().every((definition) => previewFixture.props.some((row) => row.market === definition.marketKey)));
  check("preview fixture includes every props grade", PROP_GRADES.every((grade) => previewFixture.props.some((row) => row.playGrade === grade)));
  check("preview fixture separates grade from math", previewFixture.props.every((row) => "playGrade" in row && "modelEdge" in row && "expectedValue" in row && "confidence" in row && "marketProbability" in row && "modelProbability" in row && "finalProbability" in row && Array.isArray(row.reasonCodes)));
  check("preview fixture includes multiple books for one prop", new Set(previewFixture.props.filter((row) => row.player === "Nolan McLean" && row.market === "pitcher_strikeouts").map((row) => row.book)).size >= 2);
  check("preview fixture is explicitly labeled practice data", previewFixture.slate.practice === true && previewFixture.slate.matchups.length > 0);
  check("preview fixture never claims a live odds provider", previewFixture.providerStatus.selectedOddsSource === "simulated_fixture" && previewFixture.providerStatus.sharpApi === "not_queried" && previewFixture.providerStatus.bdl === "not_queried");
  check("preview fixture rows identify simulated provenance", previewFixture.props.every((row) => row.source === "Simulated design fixture"));
  check("preview fixture preserves truthful partial context", previewFixture.slate.contextStatus === "partial" && previewFixture.slate.matchups.some((matchup) => matchup.starterStatus === "partial"));
  check("preview fixture remains no-write/no-public", previewFixture.providerStatus.writesToSupabase === false && previewFixture.providerStatus.publicDisplayEnabled === false);
  check("preview fixture includes sampled recent-form evidence", previewFixture.props.some((row) => row.player === "Zack Wheeler" && row.market === "pitcher_outs" && row.recentForm?.source === "MLB Stats sample" && row.recentForm.coverage === "full_season" && row.recentForm.logs.length >= 10));
  check("preview fixture includes sampled opponent and arsenal evidence", previewFixture.props.some((row) => row.player === "Zack Wheeler" && row.opponentProfile?.source === "MLB Stats sample" && row.opponentProfile.teamAbbreviation === "NYM" && row.opponentProfile.plateAppearances === 3633 && row.opponentProfile.researchOnly && row.pitchArsenal?.source === "Ball Don't Lie sample" && row.pitchArsenal.pitchesTracked === 1453 && row.pitchArsenal.pitches.length === 6 && row.pitchArsenal.researchOnly));
  check("preview fixture includes sampled hitter-versus-pitch-mix evidence", previewFixture.props.some((row) => row.player === "Kyle Schwarber" && row.pitchMatchup?.pitcherName === "Nolan McLean" && row.pitchMatchup.pitchMixCoveragePercent === 100 && row.pitchMatchup.matchedPitchTypes === 7 && row.pitchMatchup.researchOnly));
  check("preview fixture includes sampled hitter form and opponent history", previewFixture.props.some((row) => row.player === "Kyle Schwarber" && row.recentForm?.source === "MLB Stats sample" && row.recentForm.logs.length >= 10 && row.recentForm.logs.filter((log) => log.opponent === "NYM").length === 6));
  check("preview environment includes sampled Statcast park factors and NWS game-time weather", previewFixture.props.some((row) => row.player === "Zack Wheeler" && row.environment?.venue === "Citizens Bank Park" && row.environment.park.status === "available" && row.environment.park.runFactor === 104 && row.environment.weather.status === "available" && row.environment.weather.conditions === "Smoke" && row.environment.researchOnly));
  const evidenceLogs: MlbHistoricalStatRow[] = [
    { gameId: "mlbstats-game-2", playerId: "mlbstats-player-554430", teamId: "mlbstats-team-143", opponentTeamId: "mlbstats-team-121", gameDate: "2026-07-12", provider: "mlb_stats_api", stats: { outs: 18, strikeouts: 10, pitch_count: 96, home_away: "away" } },
    { gameId: "mlbstats-game-1", playerId: "mlbstats-player-554430", teamId: "mlbstats-team-143", opponentTeamId: "mlbstats-team-116", gameDate: "2026-07-01", provider: "mlb_stats_api", stats: { outs: 14, strikeouts: 10, pitch_count: 104, home_away: "home" } },
    { gameId: "mlbstats-game-future", playerId: "mlbstats-player-554430", teamId: "mlbstats-team-143", opponentTeamId: "mlbstats-team-121", gameDate: "2026-07-16", provider: "mlb_stats_api", stats: { outs: 21, strikeouts: 12, home_away: "home" } },
  ];
  const recentEvidence = buildPlayerPropRecentForm({ logs: evidenceLogs, marketKey: "pitcher_outs", asOfTimestamp: "2026-07-15T22:05:00.000Z", coverage: "full_season" });
  check("recent-form adapter maps market stats and blocks future logs", recentEvidence?.logs.length === 2 && recentEvidence.logs[0]?.value === 18 && recentEvidence.logs[0]?.opponent === "NYM" && recentEvidence.logs[0]?.homeAway === "away");
  check("recent-form adapter preserves source and coverage", recentEvidence?.source === "MLB Stats" && recentEvidence.coverage === "full_season" && recentEvidence.statLabel === "Outs recorded");
  const hitterRecentEvidence = buildPlayerPropRecentForm({ logs: [
    { gameId: "hitter-game-1", playerId: "mlbstats-player-656941", teamId: "mlbstats-team-143", opponentTeamId: "mlbstats-team-116", gameDate: "2026-07-12", provider: "mlb_stats_api", stats: { hits: 2, at_bats: 4, total_bases: 6, home_away: "home" } },
    { gameId: "hitter-future", playerId: "mlbstats-player-656941", teamId: "mlbstats-team-143", opponentTeamId: "mlbstats-team-121", gameDate: "2026-07-16", provider: "mlb_stats_api", stats: { hits: 4, at_bats: 4, total_bases: 10, home_away: "home" } },
  ], marketKey: "batter_hits", asOfTimestamp: "2026-07-15T22:05:00.000Z", coverage: "full_season" });
  check("recent-form adapter supports hitter markets without future-game leakage", hitterRecentEvidence?.sampleLabel === "games" && hitterRecentEvidence.logs.length === 1 && hitterRecentEvidence.logs[0]?.value === 2 && hitterRecentEvidence.logs[0]?.secondaryLabel === "4 AB | 6 TB");
  const opponentProfileInput: MlbTeamHittingProfile = {
    team_id: 121, team_name: "New York Mets", season: 2026, games_played: 97, plate_appearances: 3633, at_bats: 3259, hits: 761, strikeouts: 797, walks: 299, home_runs: 112, batting_average: 0.234, on_base_percentage: 0.303, slugging_percentage: 0.381, ops: 0.684, strikeout_rate: 797 / 3633, walk_rate: 299 / 3633, home_run_rate: 112 / 3633, ranks: { strikeout_rate: 16, walk_rate: 25, batting_average: 26, ops: 28, home_run_rate: 16, out_of: 30 }, league_average: { strikeout_rate: 0.221, walk_rate: 0.0899, batting_average: 0.2436, ops: 0.7203, home_run_rate: 0.032 }, raw_source: "mlb_stats_api",
  };
  const opponentEvidence = buildPlayerPropOpponentProfile({ profiles: [opponentProfileInput], opponentTeamId: "NYM", marketKey: "pitcher_outs", asOfTimestamp: "2026-07-15T22:05:00.000Z" });
  check("opponent-profile adapter resolves aliases and preserves calculated ranks", opponentEvidence?.teamAbbreviation === "NYM" && opponentEvidence.ops.rank === 28 && opponentEvidence.summary.includes(".684 OPS") && opponentEvidence.researchOnly);
  const bdlPlayer = parseBdlResearchPlayer({ id: 473, full_name: "Zack Wheeler", position: "SP", bats_throws: "L/R", team: { abbreviation: "PHI" } });
  const bdlPitchRows = parseBdlPitchTypeStats([
    { player_id: 473, pitch_type: "FF", pitch_name: "4-Seam Fastball", pitch_count: 524, pitch_usage_percent: 36.06, whiff_percent: 30.14, season_pitch_count: 1453, games_backfilled: 15, last_game_date: "2026-07-12" },
    { player_id: 473, pitch_type: "FS", pitch_name: "Splitter", pitch_count: 212, pitch_usage_percent: 14.59, whiff_percent: 42.57, season_pitch_count: 1453, games_backfilled: 15, last_game_date: "2026-07-12" },
    { player_id: 473, pitch_type: "ST", pitch_name: "Future pitch", pitch_count: 10, pitch_usage_percent: 1, season_pitch_count: 1463, games_backfilled: 16, last_game_date: "2026-07-16" },
    { player_id: 999, pitch_type: "CU", pitch_name: "Wrong player", pitch_count: 1, pitch_usage_percent: 1, last_game_date: "2026-07-12" },
  ], 473, 2026);
  const arsenalEvidence = bdlPlayer ? buildPlayerPitchArsenalEvidence({ player: bdlPlayer, pitchTypes: bdlPitchRows, asOfTimestamp: "2026-07-15T22:05:00.000Z" }) : null;
  check("BDL player parser normalizes bats/throws", bdlPlayer?.bats === "L" && bdlPlayer.throws === "R" && bdlPlayer.teamAbbreviation === "PHI");
  check("pitch-type adapter filters identities and sorts usage", bdlPitchRows.length === 3 && bdlPitchRows[0]?.pitchType === "FF");
  check("arsenal evidence blocks future aggregate rows", arsenalEvidence?.pitches.length === 2 && arsenalEvidence.pitches[0]?.code === "FF" && arsenalEvidence.pitchesTracked === 1453 && arsenalEvidence.researchOnly);
  const bdlHitter = parseBdlResearchPlayer({ id: 100, full_name: "Test Hitter", position: "RF", bats_throws: "L/R", team: { abbreviation: "PHI" } });
  const hitterPitchRows = parseBdlHitterPitchTypeStats([
    { player_id: 100, pitch_type: "FF", pitch_name: "4-Seam Fastball", pitch_count: 200, pa_count: 80, ba: 0.300, slg: 0.500, xwoba: 0.390, whiff_percent: 18, last_game_date: "2026-07-12" },
    { player_id: 100, pitch_type: "FS", pitch_name: "Splitter", pitch_count: 80, pa_count: 32, ba: 0.200, slg: 0.300, xwoba: 0.240, whiff_percent: 40, last_game_date: "2026-07-12" },
    { player_id: 100, pitch_type: "ST", pitch_name: "Future pitch", pitch_count: 20, pa_count: 8, xwoba: 0.500, last_game_date: "2026-07-16" },
    { player_id: 999, pitch_type: "FF", pitch_name: "Wrong hitter", pitch_count: 10, last_game_date: "2026-07-12" },
  ], 100, 2026);
  const pitchMixEvidence = bdlHitter && bdlPlayer ? buildPlayerPitchMixMatchupEvidence({
    hitter: bdlHitter,
    pitcher: bdlPlayer,
    hitterPitchTypes: hitterPitchRows,
    pitcherPitchTypes: bdlPitchRows,
    asOfTimestamp: "2026-07-15T22:05:00.000Z",
  }) : null;
  check("hitter pitch-type adapter preserves performance and identity", hitterPitchRows.length === 3 && hitterPitchRows[0]?.pitchType === "FF" && hitterPitchRows[0]?.xwoba === 0.390);
  check("pitch-mix matchup blocks future rows and reports matched coverage", pitchMixEvidence?.pitches.length === 2 && pitchMixEvidence.matchedPitchTypes === 2 && pitchMixEvidence.hitterPitchesSeen === 280 && pitchMixEvidence.researchOnly);
  check("pitch-mix matchup weights hitter outcomes by opposing arsenal usage", pitchMixEvidence !== null && approx(pitchMixEvidence.weighted.xwoba ?? 0, (0.390 * 36.06 + 0.240 * 14.59) / (36.06 + 14.59), 0.000001));
  check("pitch-mix matchup stays distinct from direct BvP history", pitchMixEvidence?.summary.includes("season pitch mix") === true && pitchMixEvidence?.coverageStatus === "available");
  const domeEnvironment = buildPlayerPropEnvironmentEvidence({ venue: "Indoor Park", roofStatus: "dome", asOfTimestamp: "2026-07-15T22:05:00.000Z" });
  check("environment adapter creates controlled dome context", domeEnvironment.weather.status === "available" && domeEnvironment.weather.conditions === "Controlled indoors" && domeEnvironment.weather.windSpeedMph === 0);
  const completeEnvironment = buildPlayerPropEnvironmentEvidence({
    venue: "Indoor Park",
    roofStatus: "dome",
    asOfTimestamp: "2026-07-15T22:05:00.000Z",
    park: { status: "available", runFactor: 100, homeRunFactor: 101, strikeoutFactor: 99, source: "Verified test source" },
  });
  const coverageReport = bdlPlayer && bdlHitter && recentEvidence && opponentEvidence ? await enrichPlayerPropResearchRows([
    { rowId: "pitcher-row", playerName: bdlPlayer.fullName, marketKey: "pitcher_outs", bdlPlayerId: bdlPlayer.playerId, asOfTimestamp: "2026-07-15T22:05:00.000Z", recentForm: recentEvidence, opponentProfile: opponentEvidence, environment: completeEnvironment },
    { rowId: "hitter-row", playerName: bdlHitter.fullName, marketKey: "batter_strikeouts", bdlPlayerId: bdlHitter.playerId, opposingPitcherBdlId: bdlPlayer.playerId, asOfTimestamp: "2026-07-15T22:05:00.000Z", recentForm: recentEvidence, environment: completeEnvironment },
  ], {
    getBdlPlayer: async (playerId) => playerId === bdlPlayer.playerId ? bdlPlayer : playerId === bdlHitter.playerId ? bdlHitter : null,
    getPitcherPitchTypes: async () => bdlPitchRows,
    getHitterPitchTypes: async () => hitterPitchRows,
    teamHittingProfiles: [opponentProfileInput],
  }) : null;
  check("research enrichment marks a row complete only when every required module is available", coverageReport?.completeRows === 2 && coverageReport.rows.every((row) => row.memberReady));
  check("research enrichment reports full-slate automatic readiness explicitly", coverageReport?.automaticRefreshReady === true && coverageReport?.withheldRowIds.length === 0);
  const blockedCoverage = await enrichPlayerPropResearchRows([{ rowId: "blocked", playerName: "Unknown", marketKey: "batter_hits", asOfTimestamp: "2026-07-15T22:05:00.000Z", environment: completeEnvironment }], {
    getBdlPlayer: async () => null,
    getPitcherPitchTypes: async () => [],
    getHitterPitchTypes: async () => [],
  });
  check("research enrichment fails closed on unresolved player and opposing-starter identities", blockedCoverage.blockedRows === 1 && blockedCoverage.automaticRefreshReady === false && blockedCoverage.withheldRowIds[0] === "blocked");
  const nwsForecast = parseNwsHourlyForecast({ properties: { updateTime: "2026-07-15T21:30:00.000Z", periods: [
    { startTime: "2026-07-16T18:00:00-04:00", endTime: "2026-07-16T19:00:00-04:00", temperature: 88, temperatureUnit: "F", windSpeed: "7 to 12 mph", windDirection: "SW", shortForecast: "Chance Showers", probabilityOfPrecipitation: { value: 40 } },
  ] } }, "2026-07-16T22:30:00.000Z");
  check("NWS hourly parser selects the game-time period and normalizes forecast fields", nwsForecast?.temperatureF === 88 && nwsForecast.windSpeedMph === 12 && nwsForecast.windDirection === "SW" && nwsForecast.precipitationProbability === 40);
  const statcastRows = parseStatcastParkFactorsHtml('<script>var data = [{"grouping_venue_conditions":"All","key_bat_side":"All","key_year":"2026","venue_id":"2681","venue_name":"Citizens Bank Park","main_team_id":"143","name_display_club":"Phillies","n_pa":"47727","index_runs":"104","index_hr":"115","index_so":"104","index_woba":"102","year_range":"2024-2026"}];</script>', 2026);
  check("Statcast park-factor parser reads structured official factors", statcastRows.length === 1 && statcastRows[0]?.venue === "Citizens Bank Park" && statcastRows[0]?.runFactor === 104 && statcastRows[0]?.homeRunFactor === 115 && statcastRows[0]?.strikeoutFactor === 104);
  const environmentCoverage = await loadSlateEnvironmentResearch({
    games: [{ id: "game-1", providerIds: { mlbstats: "1" }, season: 2026, gameDate: "2026-07-16", scheduledStart: "2026-07-16T23:00:00.000Z", homeTeamId: "mlbstats-team-143", awayTeamId: "mlbstats-team-121", venue: "Citizens Bank Park", roofStatus: "outdoor", gameStatus: "scheduled" }],
    asOfTimestamp: "2026-07-15T22:05:00.000Z",
    parkFactors: { getParkFactors: async () => statcastRows },
    weather: { getWeather: async () => [{ gameId: "game-1", asOfTimestamp: "2026-07-15T21:30:00.000Z", temperatureF: 88, windSpeedMph: 12, windDirection: "SW", precipitationProbability: 40, conditions: "Chance Showers", provider: "National Weather Service" }] },
  });
  const gameEnvironment = environmentCoverage.byGameId.get("game-1");
  check("slate environment loader joins park and game-time weather by game", gameEnvironment?.park.status === "available" && gameEnvironment.park.runFactor === 104 && gameEnvironment.weather.status === "available" && gameEnvironment.weather.conditions === "Chance Showers");
  check("fixture has no projection-side contradictions", previewFixture.props.every((row) => checkProjectionSideIntegrity(row).status === "coherent"));
  check("fixture selected-side probability matches model probability", previewFixture.props.every((row) => approx(row.side === "over" ? row.overProbability : row.underProbability, row.modelProbability)));
  check("fixture actionable rows are coherent and plausible", previewFixture.props.filter((row) => isActionablePropGrade(row.playGrade)).every((row) => checkProjectionSideIntegrity(row).status === "coherent" && row.modelProbability > 0.5 && (row.modelEdge ?? 0) > 0 && (row.expectedValue ?? 0) > 0 && Math.abs(row.expectedValue ?? 0) <= 0.15));
  check("fixture non-actionable rows carry clear reasons", previewFixture.props.filter((row) => !isActionablePropGrade(row.playGrade)).every((row) => row.reasonCodes.length > 0));
  const propsUiSource = readFileSync("app/mlb/props/components/PlayerPropsDashboard.tsx", "utf8");
  const liveBoardSource = readFileSync("lib/mlb/props/liveBoard.ts", "utf8");
  const launchReadinessSource = readFileSync("lib/mlb/props/launchReadiness.ts", "utf8");
  const marketCatalogSource = readFileSync("lib/mlb/props/marketCatalog.ts", "utf8");
  const propsConfigSource = readFileSync("lib/mlb/props/config.ts", "utf8");
  const internalTrackingSource = readFileSync("lib/mlb/props/internalTracking.ts", "utf8");
  const boardSnapshotStoreSource = readFileSync("lib/mlb/props/boardSnapshotStore.ts", "utf8");
  check("preview UI clearly discloses simulated data", propsUiSource.includes("Design preview · Simulated board") && propsUiSource.includes("not live, bettable, or sourced from today&apos;s BDL response") && propsUiSource.includes("Fixture timestamp") && propsUiSource.includes("Sample options"));
  check("props UI contains no Best Edge copy", !propsUiSource.includes("Best Edge"));
  check("props UI is a researcher rather than a pick feed", ["Prop Researcher", "Today&apos;s Radar", "Prop Reader"].every((label) => propsUiSource.includes(label)) && !propsUiSource.includes("Best Bets") && !propsUiSource.includes("All Props") && !propsUiSource.includes("VIEW_OPTIONS"));
  check("member-like preview omits operational hero copy", !["Public Display Off", "Not Live Picks", "Powered by"].some((label) => propsUiSource.includes(label)) && propsUiSource.includes('mode === "admin"'));
  const researchEntrySource = propsUiSource.slice(propsUiSource.indexOf('data-product-zone="research-entry"'), propsUiSource.indexOf("function PropsSlateHeader"));
  const radarSource = propsUiSource.slice(propsUiSource.indexOf("function TodayRadar"), propsUiSource.indexOf("export function PropResearchCockpit"));
  const boardSource = propsUiSource.slice(propsUiSource.indexOf("export function PropsTable"), propsUiSource.indexOf("function PlayerView"));
  const playerViewSource = propsUiSource.slice(propsUiSource.indexOf("function PlayerView"), propsUiSource.indexOf("function PlayerSummaryMetric"));
  const drawerSource = propsUiSource.slice(propsUiSource.indexOf("export function PropDetailDrawer"), propsUiSource.indexOf("function DrawerSection"));
  check("researcher is the default rendered workflow", propsUiSource.includes('useState<SortKey>("signal")') && propsUiSource.includes("Signal first") && propsUiSource.includes("<TodayRadar") && propsUiSource.includes("<PlayerDirectory") && propsUiSource.includes("<FullBoardView rows={filteredRows}") && !propsUiSource.includes("TodayAnglesView"));
  check("researcher leads with universal search and two-level market controls", researchEntrySource.includes("Search a player, team, market, or sportsbook") && researchEntrySource.includes('id="mlb-props-players"') && researchEntrySource.includes('aria-label="Market groups"') && researchEntrySource.includes('aria-label="Specific market filters"') && ["Pitcher props", "Batter props", "All pitcher props", "All batter props", "Pitcher Ks", "Pitcher Outs", "Batter Ks"].every((label) => propsUiSource.includes(label)) && !researchEntrySource.includes("Research markets"));
  check("researcher exposes only present model signals as a board filter", researchEntrySource.includes('label="Model signal"') && researchEntrySource.includes("gradeOptions") && propsUiSource.includes("available.has(value)") && !researchEntrySource.includes("Strongest model edges"));
  check("radar surfaces multiple research questions instead of ranked picks", ["Projection gap", "Book spread", "Context watch", "Model signal"].every((label) => propsUiSource.includes(label)) && radarSource.includes("Open Reader") && !radarSource.includes("Best bet"));
  check("player directory opens a focused player workspace", radarSource.includes("PlayerDirectory") && propsUiSource.includes("playerDirectorySummaries") && playerViewSource.includes('data-product-zone="player-workspace"') && playerViewSource.includes("Clear player search") && playerViewSource.includes("MarketSideQuote"));
  check("price comparison uses one exclusive segmented mode", propsUiSource.includes("type PriceMode = \"best\" | \"all\"") && propsUiSource.includes("PriceModeControl") && ["Best odds", "All prices"].every((label) => propsUiSource.includes(`>${label}<`)));
  check("compact slate header has one clear contextual purpose", ["PropsSlateHeader", "SlateGameNavigator", "Players priced", "Prop options", "Updated"].every((label) => propsUiSource.includes(label)) && !propsUiSource.includes("Top value"));
  check("props researcher is ready for future league switching", propsUiSource.includes("PropLeagueRail") && propsUiSource.includes('aria-label="Player props leagues"') && ["MLB", "NFL", "CFB", "NBA", "WNBA", "CBB", "NHL", "Soccer"].every((label) => propsUiSource.includes(`label: "${label}"`)) && propsUiSource.includes("Coming soon"));
  check("product zones are explicit and ordered", ["slate-intelligence", "research-entry", "today-radar", "player-directory", "board-controls", "full-board", "player-workspace"].every((zone) => propsUiSource.includes(`data-product-zone="${zone}"`)) && propsUiSource.indexOf("<PropsSlateHeader") < propsUiSource.indexOf('data-product-zone="research-entry"'));
  check("player discovery is native to the researcher", researchEntrySource.includes("Search a player, team, market, or sportsbook") && ["row.player", "row.team", "row.opponent", "row.marketLabel", "row.book"].every((label) => propsUiSource.includes(label)));
  check("props UI exposes provider health", propsUiSource.includes("Provider Health") && ["BDL odds", "Sharp audit", "Splits/context", "Probable starters"].every((label) => propsUiSource.includes(label)));
  check("props UI includes progressive board controls", ["Main lines", "All lines", "Best odds", "All prices", "Hide Research", "More filters"].every((label) => propsUiSource.includes(label)) && propsUiSource.includes('<details className="group mt-2'));
  check("props UI includes responsive full board", propsUiSource.includes("PropsTable") && propsUiSource.includes("max-xl:hidden") && propsUiSource.includes("xl:grid"));
  check("market board exposes model-tool comparison columns", ["Player", "Market", "Side / Line", "Book / Odds", "Edge", "EV", "Evidence", "Model Signal", "Reader"].every((label) => boardSource.includes(`>${label}<`)) && boardSource.includes("projectionLabel") && boardSource.includes('"Recent avg" : "Projection"') && !boardSource.includes(">Reason<"));
  check("market board is continuous rather than grouped by recommendation grade", !propsUiSource.includes("sections = PROP_GRADES.map") && propsUiSource.includes("<PropsTable rows={visibleRows}"));
  check("full-slate market board progressively bounds rendered rows", propsUiSource.includes("rows.slice(0, visibleCount)") && propsUiSource.includes("marketPairs.slice(0, visibleCount)") && propsUiSource.includes("Load more markets") && propsUiSource.includes("Showing {visibleUnits} of {totalUnits}"));
  check("market board rows and mobile cards open reader", boardSource.includes('onClick={() => onSelect(row.id)}') && boardSource.includes("Open Reader") && boardSource.includes('label={row.projectionSource === "recent_form" ? "Recent avg" : "Projection"}'));
  check("best-price board pairs both sides and separates prediction from projection", propsUiSource.includes("MarketPairCards") && propsUiSource.includes("marketDirection(pair)") && propsUiSource.includes("ModelPredictionBadge") && propsUiSource.includes("directionKind") && propsUiSource.includes("Projection only") && propsUiSource.includes("Not offered") && !propsUiSource.includes("isPredictionSide") && !propsUiSource.includes("Model side:"));
  check("player search workspace keeps paired over-under markets", propsUiSource.includes("Clear player search") && propsUiSource.includes("const marketPairs = pairMarketRows(marketRows)") && propsUiSource.includes('PlayerSummaryMetric label="Markets" value={String(marketPairs.length)}') && !propsUiSource.includes("bestPlayerMarketPrices"));
  check("market board communicates loaded coverage without overclaiming", propsUiSource.includes("Search results") && propsUiSource.includes("filtered options") && propsUiSource.includes("posted") && propsUiSource.includes("Prop Board"));
  check("props UI includes member-focused Prop Reader", ["Prop Reader", "Prop Summary", "Reader Summary", "Model Comparison", "Projection vs Line", "Best Available Price", "Signal Context", "Evidence Strength", "What Could Change", "Matchup Context"].every((label) => drawerSource.includes(label)) && drawerSource.includes("propReaderSummary(row, prices)"));
  check("Prop Reader includes line-aware recent form research", ["Recent Form", "RecentFormPanel", "L5", "L10", "Season", "Current line", "Vs ${row.opponent}"].every((label) => drawerSource.includes(label)) && drawerSource.includes('data-visual="recent-form"') && drawerSource.includes("propResult(log.value, row.line, row.side)"));
  check("Prop Reader includes sourced opponent, direct matchup, arsenal, pitch-mix, and environment research", ["OpponentProfilePanel", "BatterPitcherHistoryPanel", "PitchArsenalPanel", "PitchMixMatchupPanel", "EnvironmentPanel", "Game Environment", "Ranks are calculated across MLB", "small-sample research only", "not direct career batter-versus-pitcher history"].every((label) => drawerSource.includes(label)) && ["opponent-profile", "batter-pitcher-history", "pitch-arsenal", "pitch-mix-matchup", "game-environment"].every((module) => drawerSource.includes(`data-research-module="${module}"`)));
  check("admin diagnostics retain advanced audit fields", drawerSource.includes("showDiagnostics ?") && ["Reason Codes", "Feature Inputs", "Missing Features", "Settlement / CLV", "shrinkageWeight"].every((label) => drawerSource.includes(label)));
  check("detail drawer includes all data-bound visual modules", ["model-vs-market", "projection-vs-line", "book-price-ladder", "confidence-meter", "feature-confidence-checklist"].every((label) => drawerSource.includes(`data-visual="${label}"`)));
  check("projection and model visuals expose member-friendly comparison", drawerSource.includes("data-projection={projection}") && drawerSource.includes("data-line={line}") && drawerSource.includes("OddSphere estimate") && drawerSource.includes("Market implied") && drawerSource.includes("Model difference"));
  check("member probability visual matches the displayed edge while admin retains raw probability", propsUiSource.includes("const model = row.finalProbability") && drawerSource.includes('label="Independent probability"') && drawerSource.includes('label="Shrinkage weight"'));
  check("drawer explains projection-side mismatches in member language", drawerSource.includes("ProjectionIntegrityNotice") && drawerSource.includes("Projection favors") && drawerSource.includes("Final prediction:") && drawerSource.includes("Price and matchup context") && !drawerSource.includes("Blocked projection-side contradiction") && !drawerSource.includes("excluded from positive model signals") && !drawerSource.includes("does not support"));
  check("member context avoids payload and provider narration", drawerSource.includes("Season opponent tendencies will appear when the team profile is verified.") && !drawerSource.includes("current provider payload"));
  check("member reason and context translators remove operational language", propsUiSource.includes("function memberReason") && propsUiSource.includes('STALE_BDL_ODDS: "Price refresh in progress"') && propsUiSource.includes('FIRST_HR_FIELD_MODEL_NOT_PROMOTED: "Research market only"') && propsUiSource.includes('.replace(/^BDL\\s+/i, "")') && propsUiSource.includes('.replace(/^MLB Stats\\s+/i, "")') && propsUiSource.includes("verified fixture field"));
  check("longshot value rows display the priced side as the prediction", propsUiSource.includes("function isLongshotValueRow") && propsUiSource.includes("const longshotValue = pair.rows") && propsUiSource.includes("if (isLongshotValueRow(row)) return row.side"));
  check("paired prediction badge cannot contradict the graded model side", propsUiSource.includes("function isModelSignalSide") && propsUiSource.includes(".filter(isModelSignalSide)") && propsUiSource.includes("probability: signalPrediction.modelProbability") && propsUiSource.includes("if (isModelSignalSide(row)) return row.side"));
  check("research cockpit contains decision visuals", ["projection-vs-line", "model-vs-market", "book-price-ladder", "player-stat-snapshot", "market-context"].every((module) => propsUiSource.includes(`data-research-module="${module}"`)));
  check("player stat snapshot uses truthful member-facing labels", propsUiSource.includes('data-visual="player-stat-snapshot"') && propsUiSource.includes('data-stat-available={stat.feature ? "true" : "false"}') && propsUiSource.includes('stat.feature ? "Included in this projection" : "More data coming"') && propsUiSource.includes("playerStatDescriptor"));
  check("book ladder distinguishes unavailable covered books", propsUiSource.includes("unavailableBooks") && propsUiSource.includes('data-book-availability="unavailable"') && propsUiSource.includes("opacity-35"));
  check("feature confidence uses member evidence labels", ["Player", "Price", "Lineup", "Form", "Matchup"].every((label) => propsUiSource.includes(`featureState("${label}"`)));
  check("pitcher and batter strikeout markets are not mixed", marketCatalogSource.includes('"Pitcher Strikeouts"') && marketCatalogSource.includes('"Batter Strikeouts"') && propsUiSource.includes('Pitcher Ks') && propsUiSource.includes('Batter Ks') && !marketCatalogSource.includes('marketKey.includes("strikeouts")'));
  check("radar prioritizes playable positive signals before context watches", propsUiSource.includes("function isRadarEligible") && propsUiSource.includes("row.odds >= -250") && propsUiSource.includes("const signalRows = uniqueRows.filter(isPositiveSignal)") && propsUiSource.includes("const primaryRows = signalRows.length ? signalRows") && propsUiSource.includes("signalRows.length < 3") && propsUiSource.includes('row.playGrade !== "RESEARCH"'));
  check("lineup context is status not a board blocker", liveBoardSource.indexOf('definition.recommendationEligibility === "research_only" || !eligibleModel ? "RESEARCH"') >= 0 && liveBoardSource.indexOf('definition.recommendationEligibility === "research_only" || !eligibleModel ? "RESEARCH"') < liveBoardSource.indexOf(': !memberReady ? "PENDING_DATA"') && liveBoardSource.includes("HITTER_ROWS_PROJECTED_LINEUP") && !liveBoardSource.includes("HITTER_ROWS_AWAITING_LINEUP"));
  check("hitter model reads use integrated evidence stack", liveBoardSource.includes("buildIntegratedHitterSignal") && ["RECENT_FORM_EDGE", "PITCH_MIX_MATCHUP_EDGE", "DIRECT_MATCHUP_CONTEXT", "PARK_WEATHER_CONTEXT", "MARKET_MOVEMENT_CONTEXT"].every((label) => liveBoardSource.includes(label)));
  check("hitter market tiers allow volume leans while capping rare events", liveBoardSource.includes("HITTER_LEAN_ELIGIBLE_MARKETS") && liveBoardSource.includes('"batter_hits"') && liveBoardSource.includes('"batter_total_bases"') && liveBoardSource.includes("HITTER_WATCHLIST_ONLY_MARKETS") && liveBoardSource.includes("HITTER_LONGSHOT_VALUE_MARKETS") && liveBoardSource.includes('"batter_home_runs"') && liveBoardSource.includes("LONGSHOT_VALUE_CONTEXT") && liveBoardSource.includes("RARE_OR_CONTEXT_HEAVY_MARKET_CAPPED"));
  check("generic pitcher scorer warnings cannot suppress integrated hitter reads", liveBoardSource.includes('const scoredPitcherSignal = definition.family === "pitcher"') && liveBoardSource.includes("const signal: IntegratedPropSignal | null = scoredPitcherSignal ?") && liveBoardSource.includes("const blockingModelWarnings = (scoredPitcherSignal?.featureWarnings ?? [])"));
  check("positive prop signals collapse duplicate sportsbook rows to the best price", liveBoardSource.includes("applyBestPriceSignalDiscipline") && liveBoardSource.includes("applyHitterSignalDiscipline(applyBestPriceSignalDiscipline(dedupeRows(rows)))") && liveBoardSource.includes("signalOfferKey") && liveBoardSource.includes("BETTER_PRICE_AVAILABLE"));
  check("hitter leans are de-duplicated and capped for slate readability", liveBoardSource.includes("applyHitterSignalDiscipline") && ["BETTER_PRICE_AVAILABLE", "CORRELATED_HITTER_MARKET_CAPPED", "PLAYER_HITTER_SIGNAL_LIMIT", "SLATE_HITTER_SIGNAL_LIMIT"].every((code) => liveBoardSource.includes(code) && propsConfigSource.includes(code)) && liveBoardSource.includes("ODDSPHERE_PROPS_HITTER_LEANS_PER_GAME"));
  check("short hitter prices stay visible without being elevated to Lean", liveBoardSource.includes("ODDSPHERE_PROPS_HITTER_LEAN_MIN_AMERICAN_ODDS") && liveBoardSource.includes("HITTER_LEAN_PRICE_TOO_SHORT"));
  check("projected lineups do not change hitter signal confidence versus posted lineups", liveBoardSource.includes("confidence += 0.04;\n  reasons.push(args.lineupStatus.status === \"posted\" || args.lineupStatus.status === \"confirmed\"") && liveBoardSource.includes("LINEUP_STATUS_POSTED") && liveBoardSource.includes("PROJECTED_LINEUP_CONTEXT"));
  check("pre-lineup props use projected member wording", propsUiSource.includes("function lineupDisplayStatus") && propsUiSource.includes('return "Projected"') && propsUiSource.includes('LINEUP_CONTEXT_INSUFFICIENT: "Projected lineup context"') && !propsUiSource.includes("Waiting for lineup confirmation"));
  check("launch readiness treats posted lineups as non-critical refresh context", launchReadinessSource.includes("posted lineups refresh the board and are not required to open it") && marketCatalogSource.includes("projected_or_confirmed_lineup") && !marketCatalogSource.includes('"confirmed_lineup"'));
  check("props UI includes member-friendly pending market state", propsUiSource.includes("PendingPropsState") && propsUiSource.includes("Player prop lines have not posted yet.") && propsUiSource.includes("Today’s board will populate automatically"));
  check("internal tracking settles hitter and pitcher markets from the right official game logs", internalTrackingSource.includes("getHitterGameLogs") && internalTrackingSource.includes("getPitcherGameLogs") && internalTrackingSource.includes("gameLogKey") && internalTrackingSource.includes("finalStatsForEntry"));
  check("internal tracking lock window does not open before T-60", internalTrackingSource.includes("candidate.minutesToStart > 0 && candidate.minutesToStart <= lockMinutes") && !internalTrackingSource.includes("candidate.minutesToStart <= lockMinutes + graceMinutes"));
  check("member props display freezes games from locked board snapshots", boardSnapshotStoreSource.includes("loadLatestMlbPropsDisplaySnapshot") && boardSnapshotStoreSource.includes("applyMlbPropsDisplayLocks") && boardSnapshotStoreSource.includes("mlb_prop_tracking_entries") && boardSnapshotStoreSource.includes("board_snapshot_id") && boardSnapshotStoreSource.includes("lockedRowsByGame") && boardSnapshotStoreSource.includes("lockStatus"));
  check("member props UI marks locked rows on cards and reader", propsUiSource.includes("function LockStatusBadge") && propsUiSource.includes("row.lockStatus") && propsUiSource.includes("Locked <span") && propsUiSource.includes("lockedAt={row.lockStatus.lockedAt}"));
  check("props UI exposes search/filter data shape", ["type=\"search\"", "Model signal", "Market groups", "Specific market filters", "Book", "Team / game", "Evidence strength", "EV range", "Model-edge range", "Odds range", "Start time", "Sort"].every((label) => propsUiSource.includes(label)));
  check("positive model signals retain actionable backend semantics", isActionablePropGrade("BEST_ANGLE") && isActionablePropGrade("LEAN") && !isActionablePropGrade("WATCHLIST"));
  check("all props grades are inspectable", PROP_GRADES.every(isInspectablePropGrade));
  check("grade helpers use Daily Edge-aligned member labels", getPropGradeLabel("BEST_ANGLE") === "Best Angle" && getPropGradeLabel("LEAN") === "Lean" && getPropGradeLabel("WATCHLIST") === "Watchlist" && getPropGradeLabel("NO_PLAY") === "No Edge" && getPropGradeLabel("PENDING_DATA") === "Data Check" && getPropGradeDescription("BEST_ANGLE").length > 0);
  check("player-prop status colors align to Daily Edge signal palette", getPropGradeColor("BEST_ANGLE").border === "#10b981" && getPropGradeColor("LEAN").border === "#38bdf8" && getPropGradeColor("WATCHLIST").border === "#6366f1" && getPropGradeColor("NO_PLAY").border === "#4b5563" && getPropGradeColor("RESEARCH").border === "#475569");
  check("legacy blocked data maps to Pending Data", mapLegacyPropStatusToGrade("blocked", { reasonCodes: ["STALE_BDL_ODDS"] }) === "PENDING_DATA");
  check("price policy and projection mismatches do not become Data Check", mapLegacyPropStatusToGrade("no_play", { reasonCodes: ["EXTREME_PRICE_RESEARCH_ONLY"] }) === "RESEARCH" && mapLegacyPropStatusToGrade("no_play", { reasonCodes: ["PROJECTION_SIDE_CONTRADICTION"] }) === "NO_PLAY" && mapLegacyPropStatusToGrade("no_play", { reasonCodes: ["INVALID_PRICE_FORMAT"] }) === "PENDING_DATA" && propsUiSource.includes('alreadyBlocked ? row.playGrade : "NO_PLAY"'));
  check("legacy milestone maps to Research", mapLegacyPropStatusToGrade("research_only", { reasonCodes: ["FIRST_HR_FIELD_MODEL_NOT_PROMOTED"] }) === "RESEARCH");
  check("dev preview route exists", existsSync("app/dev/mlb-props-preview/page.tsx"));
  check("dev preview supports a validated Reader deep link", readFileSync("app/dev/mlb-props-preview/page.tsx", "utf8").includes("searchParams: Promise") && readFileSync("app/dev/mlb-props-preview/page.tsx", "utf8").includes("initialSelectedId"));
  const productNavSource = readFileSync("app/lab/components/LabAppNav.tsx", "utf8");
  const productFrameSource = readFileSync("app/lab/components/ProductAppFrame.tsx", "utf8");
  const devPreviewSource = readFileSync("app/dev/mlb-props-preview/page.tsx", "utf8");
  const memberPropsSource = readFileSync("app/mlb/props/page.tsx", "utf8");
  const memberPropsApiSource = readFileSync("app/api/mlb/props/picks/route.ts", "utf8");
  const playerPropsApiSource = readFileSync("app/api/mlb/props/player/[player_id]/route.ts", "utf8");
  const teamBadgeSource = readFileSync("app/lab/components/daily-edge/ProductTeamBadge.tsx", "utf8");
  const marketingNavSource = readFileSync("app/components/Navbar.tsx", "utf8");
  const marketingFooterSource = readFileSync("app/components/Footer.tsx", "utf8");
  const headshotRouteSource = readFileSync("app/api/mlb/player-headshot/[mlb_id]/route.ts", "utf8");
  check("product nav presents Player Props as a first-class member product", productNavSource.includes("/lab/daily-edge") && productNavSource.includes("/mlb/props") && !productNavSource.includes("gated: true") && !productNavSource.includes("(gated)"));
  check("preview renders inside product shell", devPreviewSource.includes("ProductAppFrame") && productFrameSource.includes("LabAppNav"));
  check("player props preserves the shared product shell", productFrameSource.includes("max-w-7xl") && !productFrameSource.includes("wide") && productNavSource.includes("{t.icon}") && productNavSource.includes("max-w-7xl"));
  check("dev preview stays production-disabled but supports Vercel Preview", devPreviewSource.includes('process.env.VERCEL_ENV === "production"') && devPreviewSource.includes('process.env.VERCEL_ENV === undefined') && devPreviewSource.includes('process.env.NODE_ENV === "production"') && devPreviewSource.includes("notFound()"));
  check("hosted dev preview reads the latest private live snapshot", devPreviewSource.includes("loadLatestMlbPropsBoardSnapshot") && devPreviewSource.includes('process.env.VERCEL_ENV !== "preview"'));
  check("props routes use only the authenticated product shell", [marketingNavSource, marketingFooterSource].every((source) => source.includes('pathname === "/mlb/props"') && source.includes('pathname === "/dev/mlb-props-preview"')));
  check("member route scaffold is gated and fixture-free", memberPropsSource.includes("getPublicPicksMode") && memberPropsSource.includes("ProductAppFrame") && !memberPropsSource.includes("player-props-preview-full.json"));
  check("member routes read display-locked props snapshots", memberPropsSource.includes("loadCachedLatestMlbPropsDisplaySnapshot") && memberPropsApiSource.includes("loadCachedLatestMlbPropsDisplaySnapshot") && playerPropsApiSource.includes("loadLatestMlbPropsDisplaySnapshot") && !memberPropsSource.includes("loadCachedLatestMlbPropsBoardSnapshot"));
  check("member route uses product copy without operational internals", memberPropsSource.includes("Today’s prop board is loading.") && memberPropsSource.includes("latest complete market snapshot") && !["Supabase", "fixture", "flags", "Public picks hidden"].some((label) => memberPropsSource.includes(label)));
  check("team visual uses existing ESPN MLB strategy with fallback", teamBadgeSource.includes("a.espncdn.com/i/teamlogos/mlb/500") && teamBadgeSource.includes("onError") && propsUiSource.includes("ProductTeamBadge"));
  check("player avatar supports safe optional headshots with team fallback", propsUiSource.includes("headshotUrl?: string | null") && propsUiSource.includes('headshotUrl?.startsWith("/")') && propsUiSource.includes("imageFailed") && propsUiSource.includes("<ProductTeamBadge abbreviation={team}"));
  check("headshot proxy is preview-only and blocked in public production", headshotRouteSource.includes('process.env.VERCEL_ENV === "production"') && headshotRouteSource.includes('process.env.VERCEL_ENV === undefined') && headshotRouteSource.includes('process.env.NODE_ENV === "production"'));
  check("no-photo visual preserves projection and team context", propsUiSource.includes("data-player-visual") && propsUiSource.includes("OddSphere projection") && propsUiSource.includes("projectionDelta"));
  check("desktop reader uses centered responsive modal", propsUiSource.includes("sm:max-w-[980px]") && propsUiSource.includes("sm:items-center") && propsUiSource.includes("lg:grid-cols-2") && propsUiSource.includes('aria-label="Close reader"'));
  const uxResearchPath = "tests/fixtures/mlb-props/reports/player-props-ux-research-notes.json";
  const uxResearch = existsSync(uxResearchPath) ? JSON.parse(readFileSync(uxResearchPath, "utf8")) as { sources: unknown[]; adopt: unknown[]; avoid: unknown[]; oddsphereMapping: Record<string, string> } : null;
  check("player props UX research notes are complete", uxResearch !== null && uxResearch.sources.length >= 4 && uxResearch.adopt.length > 0 && uxResearch.avoid.length > 0 && Object.keys(uxResearch.oddsphereMapping).length > 0);
  const productBenchmarkPath = "tests/fixtures/mlb-props/reports/player-props-product-benchmark.json";
  const productBenchmark = existsSync(productBenchmarkPath) ? JSON.parse(readFileSync(productBenchmarkPath, "utf8")) as { target: string; sources: unknown[]; adopt: unknown[]; avoid: unknown[]; oddsphereDifferentiation: { promise: string; flow: string[]; trustModel: string } } : null;
  check("player props product benchmark is complete", productBenchmark !== null && productBenchmark.target.includes("Prop Researcher") && productBenchmark.target.includes("Prop Reader") && productBenchmark.sources.length >= 5 && productBenchmark.adopt.length > 0 && productBenchmark.avoid.length > 0 && productBenchmark.oddsphereDifferentiation.flow.length >= 5 && productBenchmark.oddsphereDifferentiation.trustModel.length > 0);
  const visualBenchmarkPath = "tests/fixtures/mlb-props/reports/player-props-visual-benchmark-2026-07-14.json";
  const visualBenchmark = existsSync(visualBenchmarkPath) ? JSON.parse(readFileSync(visualBenchmarkPath, "utf8")) as { sources: unknown[]; memberCopyRemoved: string[]; visualDecisions: string[]; adminBoundary: string; safety: { publicDisplayEnabled: boolean; paperPersistenceEnabled: boolean; writesToSupabase: boolean } } : null;
  check("external visual benchmark and member-copy boundary are complete", visualBenchmark !== null && visualBenchmark.sources.length >= 5 && visualBenchmark.memberCopyRemoved.length >= 7 && visualBenchmark.visualDecisions.length >= 5 && visualBenchmark.adminBoundary.includes("Provider health") && !visualBenchmark.safety.publicDisplayEnabled && !visualBenchmark.safety.paperPersistenceEnabled && !visualBenchmark.safety.writesToSupabase);
  const meticulousAuditPath = "tests/fixtures/mlb-props/reports/player-props-meticulous-design-audit.json";
  const meticulousAudit = existsSync(meticulousAuditPath) ? JSON.parse(readFileSync(meticulousAuditPath, "utf8")) as { sources: unknown[]; userJobs: unknown[]; sectionAudit: Array<{ section: string; passCriteria: string[] }>; rejectedPatterns: unknown[]; shellDecision: string } : null;
  check("meticulous product design audit covers every member zone", meticulousAudit !== null && meticulousAudit.sources.length >= 7 && meticulousAudit.userJobs.length >= 6 && meticulousAudit.sectionAudit.length >= 10 && meticulousAudit.sectionAudit.every((section) => section.passCriteria.length >= 2) && meticulousAudit.rejectedPatterns.length >= 4 && meticulousAudit.shellDecision.includes("shared"));
  const headshotAuditPath = "tests/fixtures/mlb-props/reports/player-headshot-source-audit.json";
  const headshotAudit = existsSync(headshotAuditPath) ? JSON.parse(readFileSync(headshotAuditPath, "utf8")) as { answer: { technicallyPossible: boolean; safeToUseFreeMlbCdnInCommercialProduct: boolean; currentProductHasLicensedFeed: boolean }; sources: unknown[]; integrationShape: { requiredFields: string[]; existingUiContract: string } } : null;
  check("player headshot sourcing decision is explicit", headshotAudit !== null && headshotAudit.answer.technicallyPossible && !headshotAudit.answer.safeToUseFreeMlbCdnInCommercialProduct && !headshotAudit.answer.currentProductHasLicensedFeed && headshotAudit.sources.length >= 3 && headshotAudit.integrationShape.requiredFields.includes("licenseProvider") && headshotAudit.integrationShape.existingUiContract.includes("headshotUrl"));
  check("player props default view uses progressive disclosure", ["More model context", "Research signals", "Admin diagnostics"].every((label) => propsUiSource.includes(label)) && (propsUiSource.match(/<details/g) ?? []).length >= 3 && !propsUiSource.includes("<details open"));
  const polishQaPath = "tests/fixtures/mlb-props/reports/player-props-polish-qa.json";
  const polishQa = existsSync(polishQaPath) ? JSON.parse(readFileSync(polishQaPath, "utf8")) as { featuredCardCount: { desktop: number; mobile: number }; defaultWorkspace: string; radarResearchQuestions: string[]; playerDirectoryVisible: boolean; focusedPlayerWorkspace: boolean; plainEnglishReader: boolean; continuousMarketBoard: boolean; defaultSort: string; modelSignalFilter: boolean; priceComparisonModes: string[]; advancedDiagnosticsHiddenFromBoard: boolean; projectionSideContradictionsCount: number; allModelStatesInspectable: boolean; searchVisible: boolean; commandCenterVisible: boolean; fixtureCoherence: boolean; publicDisplayEnabled: boolean; paperPersistenceEnabled: boolean; writesToSupabase: boolean } : null;
  check("player props polish QA report is complete", polishQa !== null && polishQa.featuredCardCount.desktop === 0 && polishQa.featuredCardCount.mobile === 0 && polishQa.defaultWorkspace === "Prop Researcher" && polishQa.radarResearchQuestions.length === 3 && polishQa.playerDirectoryVisible && polishQa.focusedPlayerWorkspace && polishQa.plainEnglishReader && polishQa.continuousMarketBoard && polishQa.defaultSort === "Signal first" && polishQa.modelSignalFilter && polishQa.priceComparisonModes.length === 2 && polishQa.advancedDiagnosticsHiddenFromBoard && polishQa.projectionSideContradictionsCount === 0 && polishQa.allModelStatesInspectable && polishQa.searchVisible && polishQa.commandCenterVisible && polishQa.fixtureCoherence && !polishQa.publicDisplayEnabled && !polishQa.paperPersistenceEnabled && !polishQa.writesToSupabase);
  check("book badge renders safe text abbreviations", propsUiSource.includes("function BookChip") && ["DK", "FD", "MGM", "CZR"].every((label) => propsUiSource.includes(label)));
  check("legacy lab props route redirects to canonical member route", readFileSync("app/lab/player-props/page.tsx", "utf8").includes("redirect(\"/mlb/props\")"));
  check("admin props review route exists", existsSync("app/admin/mlb/props-review/page.tsx"));
  check("paper picks are not public", !isPublicRecommendationVisible({ recommendationStatus: "paper" }));
  check("real publish disabled status is not public", !isPublicRecommendationVisible({ recommendationStatus: "blocked" }));
  check("stale public picks hidden", !isPublicRecommendationVisible({
    recommendationStatus: "recommended",
    createdAt: "2026-07-07T15:00:00.000Z",
    now: "2026-07-07T16:00:01.000Z",
    maxAgeSeconds: 60,
  }));
  check("team alias resolves D-backs variant", resolveMlbTeamAlias("D-Backs")?.abbreviation === "ARI");
  check("team alias resolves White Sox spacing", resolveMlbTeamAlias("WhiteSox")?.abbreviation === "CWS");
  check("team alias resolves Athletics variant", resolveMlbTeamAlias("Sacramento Athletics")?.abbreviation === "ATH");
  check("real paper gate blocks without paper flag", !evaluateRealPaperPersistenceGate({
    providerMode: "real",
    persist: true,
    dryRun: false,
    env: env({
      ODDSPHERE_PROPS_PAPER_TRADING_ENABLED: "false",
      ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED: "false",
      ODDSPHERE_PROPS_DISPLAY_ENABLED: "false",
    }),
  }).ok);
  check("real paper gate blocks dry run", !evaluateRealPaperPersistenceGate({
    providerMode: "real",
    persist: true,
    dryRun: true,
    env: env({
      ODDSPHERE_PROPS_PAPER_TRADING_ENABLED: "true",
      ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED: "false",
      ODDSPHERE_PROPS_DISPLAY_ENABLED: "false",
    }),
  }).ok);
  check("real paper gate blocks without persist", !evaluateRealPaperPersistenceGate({
    providerMode: "real",
    persist: false,
    dryRun: false,
    env: env({
      ODDSPHERE_PROPS_PAPER_TRADING_ENABLED: "true",
      ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED: "false",
      ODDSPHERE_PROPS_DISPLAY_ENABLED: "false",
    }),
  }).ok);
  check("real paper gate blocks publish enabled", !evaluateRealPaperPersistenceGate({
    providerMode: "real",
    persist: true,
    dryRun: false,
    env: env({
      ODDSPHERE_PROPS_PAPER_TRADING_ENABLED: "true",
      ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED: "true",
      ODDSPHERE_PROPS_DISPLAY_ENABLED: "false",
    }),
  }).ok);
  check("real paper gate blocks display enabled", !evaluateRealPaperPersistenceGate({
    providerMode: "real",
    persist: true,
    dryRun: false,
    env: env({
      ODDSPHERE_PROPS_PAPER_TRADING_ENABLED: "true",
      ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED: "false",
      ODDSPHERE_PROPS_DISPLAY_ENABLED: "true",
    }),
  }).ok);
  const paperGatePass = evaluateRealPaperPersistenceGate({
    providerMode: "real",
    persist: true,
    dryRun: false,
    env: env({
      ODDSPHERE_PROPS_PAPER_TRADING_ENABLED: "true",
      ODDSPHERE_PROPS_REAL_PUBLISH_ENABLED: "false",
      ODDSPHERE_PROPS_DISPLAY_ENABLED: "false",
    }),
  });
  check("real paper gate permits hidden paper only", paperGatePass.ok && paperGatePass.recommendationStatus === "paper");
  check("internal tracking markets cover promoted pitcher and hitter props", isPaperTradingMarketAllowed("pitcher_strikeouts") && isPaperTradingMarketAllowed("pitcher_outs") && isPaperTradingMarketAllowed("batter_hits") && isPaperTradingMarketAllowed("batter_total_bases") && isPaperTradingMarketAllowed("batter_strikeouts") && !isPaperTradingMarketAllowed("first_home_run"));

  const provider = new MockMLBProvider();
  const odds = await provider.getPropOdds({ date: "2026-07-07", asOfTimestamp: "2026-07-07T15:00:00.000Z" });
  check("mock odds provider returns over/under", odds.length >= 2 && odds.some((row) => row.side === "over") && odds.some((row) => row.side === "under"));

  const feature = await buildMlbPropFeatureSnapshot({
    provider,
    gameId: "mock-game-1",
    playerId: "mock-pitcher-1",
    marketKey: "pitcher_strikeouts",
    line: 5.5,
    asOfTimestamp: "2026-07-07T15:00:00.000Z",
  });
  check("future game log not used", Number(feature.features.rolling_10_start_k) < 10);
  check("feature hash exists", feature.leakageGuardHash.length === 64);

  const model = new PitcherStrikeoutsModel();
  const [prediction] = await model.predict_proba([feature]);
  const [strikeoutDistribution] = await model.predict_distribution([feature]);
  check("model probability between 0 and 1", prediction.modelProbability > 0 && prediction.modelProbability < 1);
  check("distribution fallback returns side", prediction.side === "over" || prediction.side === "under");
  check("pitcher K distribution probability valid", typeof strikeoutDistribution.overProbability === "number" && strikeoutDistribution.overProbability >= 0 && strikeoutDistribution.overProbability <= 1);
  const contextualStrikeoutFeature = {
    ...feature,
    features: {
      ...feature.features,
      opponent_strikeout_rate: 0.25,
      opponent_league_strikeout_rate: 0.22,
      park_strikeout_factor: 106,
      temperature_f: 90,
    },
    dataAvailability: {
      ...feature.dataAvailability,
      opponent_k_profile: true,
      park_factor: true,
      weather: true,
    },
  };
  const [contextualStrikeoutDistribution] = await model.predict_distribution([contextualStrikeoutFeature]);
  check("pitcher K model consumes opponent, park, and weather context", Number(contextualStrikeoutDistribution.opponentMultiplier) !== 1 && Number(contextualStrikeoutDistribution.parkMultiplier) !== 1 && Number(contextualStrikeoutDistribution.weatherMultiplier) !== 1);

  const outsFeature = await buildMlbPropFeatureSnapshot({
    provider,
    gameId: "mock-game-1",
    playerId: "mock-pitcher-1",
    marketKey: "pitcher_outs",
    line: 17.5,
    asOfTimestamp: "2026-07-07T15:00:00.000Z",
  });
  const [outsPrediction] = await new PitcherOutsModel().predict_proba([outsFeature]);
  const [outsDistribution] = await new PitcherOutsModel().predict_distribution([outsFeature]);
  check("pitcher outs model returns probability", outsPrediction.marketKey === "pitcher_outs" && outsPrediction.modelProbability > 0 && outsPrediction.modelProbability < 1);
  check("pitcher outs model probability valid", typeof outsDistribution.overProbability === "number" && outsDistribution.overProbability >= 0 && outsDistribution.overProbability <= 1);
  const contextualOutsFeature = {
    ...outsFeature,
    features: {
      ...outsFeature.features,
      opponent_ops: 0.76,
      opponent_league_ops: 0.72,
      park_run_factor: 108,
      temperature_f: 90,
    },
    dataAvailability: {
      ...outsFeature.dataAvailability,
      opponent_profile: true,
      park_factor: true,
      weather: true,
    },
  };
  const [contextualOutsDistribution] = await new PitcherOutsModel().predict_distribution([contextualOutsFeature]);
  check("pitcher outs model consumes opponent, park, and weather context", Number(contextualOutsDistribution.opponentMultiplier) !== 1 && Number(contextualOutsDistribution.parkMultiplier) !== 1 && Number(contextualOutsDistribution.weatherMultiplier) !== 1);

  const over = odds.find((row) => row.marketKey === "pitcher_strikeouts" && row.side === "over" && row.snapshotRole === "current") ?? null;
  const under = odds.find((row) => row.marketKey === "pitcher_strikeouts" && row.side === "under" && row.snapshotRole === "current") ?? null;
  const closingOver = (await provider.getPropOdds({ date: "2026-07-07", asOfTimestamp: "9999-12-31T00:00:00.000Z" }))
    .filter((row) => row.marketKey === "pitcher_strikeouts" && row.snapshotRole === "closing");
  const negativeEv = recommendPropBet({
    prediction: { ...prediction, modelProbability: 0.4 },
    overOdds: over,
    underOdds: under,
    asOfTimestamp: "2026-07-07T15:00:00.000Z",
    config: { maxOddsAgeSeconds: 10_000 },
  });
  check("negative/low EV candidate rejected", negativeEv.status === "no_play");

  const positiveEv = recommendPropBet({
    prediction: { ...prediction, side: "over", modelProbability: 0.68 },
    overOdds: over,
    underOdds: under,
    asOfTimestamp: "2026-07-07T15:00:00.000Z",
    config: { maxOddsAgeSeconds: 10_000 },
  });
  check("positive EV candidate accepted", positiveEv.status === "recommended");
  check("market-prior shrinkage creates bounded final probability", positiveEv.finalProbability > 0 && positiveEv.finalProbability < 1 && positiveEv.finalProbability < positiveEv.modelProbability && positiveEv.finalProbability > (positiveEv.marketProbability ?? 0));
  check("recommendation separates model edge and grade", positiveEv.modelEdge === positiveEv.edge && ["BEST_ANGLE", "LEAN"].includes(positiveEv.playGrade));

  check("over projection below line is a contradiction", checkProjectionSideIntegrity({ side: "over", line: 5.5, projection: 5.2 }).status === "contradiction");
  check("under projection above line is a contradiction", checkProjectionSideIntegrity({ side: "under", line: 5.5, projection: 5.8 }).status === "contradiction");
  const contradictoryOver = recommendPropBet({
    prediction: { ...prediction, side: "over", modelProbability: 0.68, explanation: { ...prediction.explanation, projectedStrikeouts: 5.2 } },
    overOdds: over,
    underOdds: under,
    asOfTimestamp: "2026-07-07T15:00:00.000Z",
    config: { maxOddsAgeSeconds: 10_000 },
  });
  check("projection-side contradiction blocks actionable grade", contradictoryOver.status === "no_play" && contradictoryOver.playGrade === "NO_PLAY" && contradictoryOver.reasonCodes.includes("PROJECTION_SIDE_CONTRADICTION"));
  const contradictoryUnder = recommendPropBet({
    prediction: { ...prediction, side: "under", modelProbability: 0.68, explanation: { ...prediction.explanation, projectedStrikeouts: 5.8 } },
    overOdds: over,
    underOdds: under,
    asOfTimestamp: "2026-07-07T15:00:00.000Z",
    config: { maxOddsAgeSeconds: 10_000 },
  });
  check("under contradiction is blocked from recommendation", contradictoryUnder.status === "no_play" && contradictoryUnder.reasonCodes.includes("PROJECTION_SIDE_CONTRADICTION"));

  const staleRejected = recommendPropBet({
    prediction: { ...prediction, side: "over", modelProbability: 0.68 },
    overOdds: over,
    underOdds: under,
    asOfTimestamp: "2026-07-07T23:00:00.000Z",
  });
  check("stale odds rejected", staleRejected.status === "no_play" && staleRejected.reasonCodes.includes("STALE_ODDS"));

  const missingUnderRejected = recommendPropBet({
    prediction: { ...prediction, side: "over", modelProbability: 0.68 },
    overOdds: over,
    underOdds: null,
    asOfTimestamp: "2026-07-07T15:00:00.000Z",
    config: { maxOddsAgeSeconds: 10_000 },
  });
  check("missing under side rejected because devig impossible", missingUnderRejected.status === "no_play");

  const injuryRejected = recommendPropBet({
    prediction: { ...prediction, side: "over", modelProbability: 0.68 },
    overOdds: over,
    underOdds: under,
    asOfTimestamp: "2026-07-07T15:00:00.000Z",
    injuryRisk: true,
    config: { maxOddsAgeSeconds: 10_000 },
  });
  check("injury risk rejected", injuryRejected.status === "no_play" && injuryRejected.reasonCodes.includes("INJURY_RISK"));

  const lineupRejected = recommendPropBet({
    prediction: { ...prediction, side: "over", modelProbability: 0.68 },
    overOdds: over,
    underOdds: under,
    asOfTimestamp: "2026-07-07T15:00:00.000Z",
    lineupRisk: true,
    config: { maxOddsAgeSeconds: 10_000 },
  });
  check("lineup risk rejected for batter-style gate", lineupRejected.status === "no_play" && lineupRejected.reasonCodes.includes("LINEUP_RISK"));

  const players = await provider.getPlayers();
  const providerMatch = resolveMlbPlayer({ providerPlayerId: "mock-pitcher-1", players });
  check("entity resolution exact provider id match", providerMatch.status === "matched" && providerMatch.method === "provider_id");
  const accentMatch = resolveMlbPlayer({ providerName: "Nolán McLean Jr.", teamId: "team-nym", players });
  check("entity resolution handles accents and suffixes", accentMatch.status === "matched");
  const ambiguous = resolveMlbPlayer({
    providerName: "Alex Smith",
    teamId: null,
    players: [
      { id: "a", providerIds: {}, fullName: "Alex Smith", normalizedName: normalizePlayerName("Alex Smith"), teamId: "team-a", active: true },
      { id: "b", providerIds: {}, fullName: "Alex Smith", normalizedName: normalizePlayerName("Alex Smith"), teamId: "team-b", active: true },
    ],
  });
  check("entity resolution ambiguous name blocked", ambiguous.status === "blocked" && ambiguous.reason === "ambiguous");
  const tradedMismatch = resolveMlbPlayer({ providerName: "Nolan McLean", teamId: "team-lad", players });
  check("entity resolution team mismatch blocked", tradedMismatch.status === "blocked" && tradedMismatch.reason === "team_mismatch");

  const realGames: MlbGameEntity[] = [
    {
      id: "mlbstats-game-1",
      providerIds: { mlbstats: 1 },
      season: 2026,
      gameDate: "2026-07-07",
      scheduledStart: "2026-07-07T23:07:00.000Z",
      homeTeamId: "mlbstats-team-141",
      awayTeamId: "mlbstats-team-121",
      venue: "Rogers Centre",
      gameStatus: "scheduled",
    },
  ];
  const realProbables: MlbProbablePitcher[] = [
    {
      gameId: "mlbstats-game-1",
      teamId: "mlbstats-team-121",
      playerId: "mlbstats-player-999",
      status: "announced",
      asOfTimestamp: "2026-07-07T15:00:00.000Z",
      provider: "mlbstats",
      rawPayload: { probablePitcher: { fullName: "Nolán McLean Jr." } },
    },
    {
      gameId: "mlbstats-game-1",
      teamId: "mlbstats-team-141",
      playerId: "mlbstats-player-888",
      status: "announced",
      asOfTimestamp: "2026-07-07T15:00:00.000Z",
      provider: "mlbstats",
      rawPayload: { probablePitcher: { fullName: "Kevin Gausman" } },
    },
  ];
  const sharpNymTor = realOdds({
    eventHome: "Toronto Blue Jays",
    eventAway: "New York Mets",
    eventStart: "2026-07-07T23:07:00.000Z",
    playerName: "Nolan McLean",
    side: "over",
    marketKey: "pitcher_strikeouts",
  });
  const mappedGame = mapSharpEventToGame({ row: sharpNymTor, games: realGames });
  check("Sharp event maps by exact team/date/start", mappedGame.status === "matched" && mappedGame.game.id === "mlbstats-game-1");
  const aliasGame = mapSharpEventToGame({ row: { ...sharpNymTor, rawPayload: { ...(sharpNymTor.rawPayload as object), event_home_team: "Jays", event_away_team: "NY Mets" } }, games: realGames });
  check("Sharp event maps by team aliases", aliasGame.status === "matched");
  const doubleheader = mapSharpEventToGame({ row: sharpNymTor, games: [...realGames, { ...realGames[0], id: "mlbstats-game-2" }] });
  check("Sharp doubleheader ambiguity blocked", doubleheader.status === "blocked" && doubleheader.reason === "GAME_MAPPING_AMBIGUOUS");
  const lateStart = mapSharpEventToGame({ row: { ...sharpNymTor, rawPayload: { ...(sharpNymTor.rawPayload as object), event_start_time: "2026-07-08T03:07:00.000Z" } }, games: realGames });
  check("Sharp start-time mismatch blocked", lateStart.status === "blocked");
  const reversed = mapSharpEventToGame({ row: { ...sharpNymTor, rawPayload: { ...(sharpNymTor.rawPayload as object), event_home_team: "Mets", event_away_team: "Blue Jays" } }, games: realGames });
  check("Sharp reversed home/away blocked", reversed.status === "blocked" && reversed.reason === "GAME_HOME_AWAY_REVERSED");
  const mappedPitcher = resolveSharpPropRow({ row: sharpNymTor, games: realGames, probablePitchers: realProbables });
  check("Sharp pitcher maps to probable starter with suffix/accent normalization", mappedPitcher.status === "matched" && mappedPitcher.row.playerId === "mlbstats-player-999");
  const bdlMapped = resolveSharpPropRow({ row: bdlParsed[0]!, games: realGames, probablePitchers: realProbables });
  check("BDL prop maps by game context and probable name when present", bdlMapped.status === "matched" && bdlMapped.row.playerId === "mlbstats-player-999");
  const bdlIdOnly = resolveSharpPropRow({
    row: {
      ...bdlParsed[0]!,
      rawPayload: { ...(bdlParsed[0]!.rawPayload as Record<string, unknown>), player_name: null },
    },
    games: realGames,
    probablePitchers: realProbables,
  });
  check("BDL prop preserves provider player id when name mapping is absent", bdlIdOnly.status === "matched" && bdlIdOnly.row.playerId === "balldontlie-player-9001" && bdlIdOnly.row.mappingConfidence >= 0.98);
  const missingBdlPlayerId = resolveSharpPropRow({
    row: {
      ...bdlParsed[0]!,
      playerId: "",
      rawPayload: { ...(bdlParsed[0]!.rawPayload as Record<string, unknown>), bdl_player_id: null },
    },
    games: realGames,
    probablePitchers: realProbables,
  });
  check("missing BDL player_id blocked", missingBdlPlayerId.status === "blocked" && missingBdlPlayerId.reason === "BDL_PLAYER_ID_MISSING");
  const missingBdlGameId = resolveSharpPropRow({
    row: {
      ...bdlParsed[0]!,
      rawPayload: { ...(bdlParsed[0]!.rawPayload as Record<string, unknown>), bdl_game_id: null },
    },
    games: realGames,
    probablePitchers: realProbables,
  });
  check("missing BDL game_id blocked", missingBdlGameId.status === "blocked" && missingBdlGameId.reason === "BDL_GAME_ID_MISSING");
  const bdlStarterConfirmed = resolveSharpPropRow({
    row: {
      ...bdlParsed[0]!,
      rawPayload: {
        ...(bdlParsed[0]!.rawPayload as Record<string, unknown>),
        player_name: null,
        bdl_home_pitcher_id: null,
        bdl_away_pitcher_id: "9001",
      },
    },
    games: realGames,
    probablePitchers: realProbables,
  });
  check("BDL starter confirmation promotes starter confidence", bdlStarterConfirmed.status === "matched" && bdlStarterConfirmed.row.starterReasonCode === "STARTER_CONFIRMED_BDL" && bdlStarterConfirmed.row.starterConfidence >= 0.98);
  const bdlStarterConflict = resolveSharpPropRow({
    row: {
      ...bdlParsed[0]!,
      rawPayload: {
        ...(bdlParsed[0]!.rawPayload as Record<string, unknown>),
        player_name: null,
        bdl_home_pitcher_id: "9001",
        bdl_away_pitcher_id: "9001",
      },
    },
    games: realGames,
    probablePitchers: realProbables,
  });
  check("BDL starter conflict blocked", bdlStarterConflict.status === "blocked" && bdlStarterConflict.reason === "STARTER_CONFLICT");
  const batterLike = resolveSharpPropRow({ row: { ...sharpNymTor, rawPayload: { ...(sharpNymTor.rawPayload as object), player_name: "Bo Bichette" } }, games: realGames, probablePitchers: realProbables });
  check("batter/non-starter blocked for pitcher prop", batterLike.status === "blocked" && batterLike.reason === "PLAYER_NOT_PROBABLE_STARTER");
  const sameNameAmbiguous = resolveSharpPropRow({
    row: sharpNymTor,
    games: realGames,
    probablePitchers: [
      ...realProbables,
      { ...realProbables[1], playerId: "mlbstats-player-777", rawPayload: { probablePitcher: { fullName: "Nolan McLean" } } },
    ],
  });
  check("same player name on both teams blocked", sameNameAmbiguous.status === "blocked" && sameNameAmbiguous.reason === "PLAYER_MAPPING_AMBIGUOUS");

  const realDryRun = await scoreRealMlbPropsDryRun({
    games: realGames,
    probablePitchers: realProbables,
    date: "2026-07-07",
    asOfTimestamp: "2026-07-07T15:00:00.000Z",
    odds: [
      sharpNymTor,
      realOdds({ ...oddsSeed(sharpNymTor), side: "under", americanOdds: -120 }),
      realOdds({ ...oddsSeed(sharpNymTor), marketKey: "pitcher_outs", side: "over", line: 17.5, americanOdds: 105 }),
      realOdds({ ...oddsSeed(sharpNymTor), marketKey: "pitcher_outs", side: "under", line: 17.5, americanOdds: -125, sportsbook: "hardrock" }),
      realOdds({ ...oddsSeed(sharpNymTor), marketKey: "pitcher_outs", side: "over", line: 17.5, americanOdds: 105, sportsbook: "hardrock" }),
      realOdds({ ...oddsSeed(sharpNymTor), marketKey: "pitcher_hits_allowed", side: "over", line: 5.5, americanOdds: 100 }),
    ],
  });
  check("real dry-run scores promoted pitcher markets only", realDryRun.candidatesScored >= 2 && !realDryRun.marketsDetected.includes("batter_hits"));
  check("real dry-run preserves Hard Rock count", realDryRun.hardRockDetected && realDryRun.hardRockRows === 2);
  check("real dry-run remains no-write", realDryRun.noSupabaseWrites === true && realDryRun.dryRun === true);
  const realPaperScore = await scoreRealMlbPropsForPaper({
    games: realGames,
    probablePitchers: realProbables,
    date: "2026-07-07",
    asOfTimestamp: "2026-07-07T15:00:00.000Z",
    odds: [
      sharpNymTor,
      realOdds({ ...oddsSeed(sharpNymTor), side: "under", americanOdds: -120 }),
      realOdds({ ...oddsSeed(sharpNymTor), marketKey: "pitcher_outs", side: "over", line: 17.5, americanOdds: 105 }),
      realOdds({ ...oddsSeed(sharpNymTor), marketKey: "pitcher_outs", side: "under", line: 17.5, americanOdds: -125 }),
      realOdds({ ...oddsSeed(sharpNymTor), marketKey: "pitcher_hits_allowed", side: "over", line: 5.5, americanOdds: 100 }),
    ],
  });
  check("real paper scoring output limited to pitcher Ks and outs", realPaperScore.scored.recommendations.every((row) => isPaperTradingMarketAllowed(row.marketKey)));
  check("real paper scoring results stay pending/no_play", realPaperScore.scored.recommendations.every((row) => row.result === "pending" || row.result === "no_play"));
  check("first paper scoring set is capped and limited", realPaperScore.paperScored.bets <= 25 && realPaperScore.paperScored.recommendations.every((row) => row.recommendation.status === "recommended" && isPaperTradingMarketAllowed(row.marketKey)));
  const unavailableDryRun = await scoreRealMlbPropsDryRun({
    games: realGames,
    probablePitchers: realProbables,
    date: "2026-07-07",
    asOfTimestamp: "2026-07-07T15:00:00.000Z",
    odds: [],
  });
  check("real dry-run reports provider prop odds unavailable", unavailableDryRun.rejectedCountByReasonCode.PROVIDER_PROP_ODDS_UNAVAILABLE === 1);
  check("real dry-run no-props state is cleanly blocked/pending", unavailableDryRun.safeBlocked && unavailableDryRun.propsAvailabilityStatus === "pending" && unavailableDryRun.blockerReason === "PROVIDER_PROP_ODDS_UNAVAILABLE" && unavailableDryRun.noSupabaseWrites);
  check("no-props dry-run still generates full audit pack", [unavailableDryRun.marketFeatureInventoryPath, unavailableDryRun.modelComparisonPath, unavailableDryRun.recommendationSanityAuditPath, unavailableDryRun.firstPaperRunDecisionPath, unavailableDryRun.calibrationReadinessPath, unavailableDryRun.providerMarketComparisonPath, unavailableDryRun.splitsContextAuditPath].every((value) => typeof value === "string"));
  const bdlDryRun = await scoreRealMlbPropsDryRun({
    games: realGames,
    probablePitchers: realProbables,
    date: "2026-07-07",
    asOfTimestamp: "2026-07-07T15:00:00.000Z",
    odds: bdlParsed.map((row) => ({
      ...row,
      rawPayload: {
        ...(row.rawPayload as Record<string, unknown>),
        player_name: null,
        bdl_away_pitcher_id: "9001",
      },
    })),
    seasonStatsByPlayerId: new Map([
      ["balldontlie-player-9001", {
        playerId: "balldontlie-player-9001",
        pitchingGs: 12,
        pitchingGp: 13,
        pitchingIp: 72,
        pitchingK: 86,
        pitchingKPer9: 10.75,
      }],
    ]),
    providerContext: {
      selectedOddsProvider: "balldontlie",
      sharpApiPropRows: 0,
      bdlPropRows: bdlParsed.length,
      fallbackReason: "SHARPAPI_PLAYER_PROPS_EMPTY",
    },
  });
  check("Sharp empty props can fall back to BDL rows for scoring", bdlDryRun.oddsProvider === "balldontlie" && bdlDryRun.sharpApiPropRows === 0 && bdlDryRun.bdlPropRows === bdlParsed.length && bdlDryRun.candidatesScored >= 2);
  check("BDL pitcher feature bundle builds when real fields exist", !bdlDryRun.featureAvailabilityWarnings.bdl_stat_bundle_pending_baseline_used && bdlDryRun.bdlTraceSummary !== null);
  check("BDL rejection trace separates EV/data blockers", typeof bdlDryRun.bdlTracePath === "string" && bdlDryRun.bdlTraceSummary?.totalCandidates === bdlDryRun.candidatesScored);
  check("BDL over/under no-vig sanity stays clean", bdlDryRun.bdlSanityAuditSummary?.negativeNoVigAnomalies === 0);
  check("BDL side-specific EV audit is populated", (bdlDryRun.bdlSanityAuditSummary?.maxEv ?? 0) > 0 && (bdlDryRun.bdlSanityAuditSummary?.maxEdge ?? 0) > 0);
  check("BDL review dedupe summary is present", typeof bdlDryRun.bdlSanityAuditSummary?.dedupedReviewRecommendationsCount === "number");
  check("BDL cap scenario counts are present", typeof bdlDryRun.bdlSanityAuditSummary?.capScenarioCounts.combinedConservative === "number");
  check("feature inventory report generated", typeof bdlDryRun.pitcherFeatureInventoryPath === "string");
  check("market feature inventory report generated", typeof bdlDryRun.marketFeatureInventoryPath === "string");
  check("model comparison report generated", typeof bdlDryRun.modelComparisonPath === "string");
  check("first-paper-run decision report generated", typeof bdlDryRun.firstPaperRunDecisionPath === "string");
  check("calibration readiness report generated", typeof bdlDryRun.calibrationReadinessPath === "string");
  check("provider market comparison report generated", typeof bdlDryRun.providerMarketComparisonPath === "string");
  check("recommendation sanity audit report generated", typeof bdlDryRun.recommendationSanityAuditPath === "string");
  check("splits/context audit report generated", typeof bdlDryRun.splitsContextAuditPath === "string");
  const splitsContextAudit = bdlDryRun.splitsContextAuditPath
    ? JSON.parse(readFileSync(bdlDryRun.splitsContextAuditPath, "utf8")) as { writesToSupabase: boolean; fields: Array<{ provider: string; field: string; available: boolean }>; summary: { fakeSplitsShown: boolean; requestedSignals: Record<string, { available: boolean; provider: string; endpointOrSource: string; timestampOrAsOfField: string | null; usableInModel: boolean; usableInUi: boolean }> } }
    : null;
  check("splits/context audit is explicit and no-write", splitsContextAudit !== null && splitsContextAudit.writesToSupabase === false && splitsContextAudit.fields.some((row) => row.provider === "BDL" && row.field === "odds/player props" && row.available) && splitsContextAudit.summary.fakeSplitsShown === false);
  check("requested props context signals are individually audited", splitsContextAudit !== null && ["publicSplits", "handleVsBets", "lineMovement", "consensus"].every((key) => key in splitsContextAudit.summary.requestedSignals) && Object.values(splitsContextAudit.summary.requestedSignals).every((signal) => signal.available === false && signal.usableInModel === false && signal.usableInUi === false && signal.provider.length > 0 && signal.endpointOrSource.length > 0 && signal.timestampOrAsOfField === null));
  const featureInventory = bdlDryRun.pitcherFeatureInventoryPath
    ? JSON.parse(readFileSync(bdlDryRun.pitcherFeatureInventoryPath, "utf8")) as {
      writesToSupabase: boolean;
      summary: { pitchersWithSeasonStats: number; rollingLogsAvailable: boolean; opponentKProfileAvailable: boolean };
      pitchers: Array<{ seasonStats: { available: boolean }; recentStats: { available: boolean; note: string }; context: { opponentKProfileAvailable: boolean } }>;
    }
    : null;
  check("feature inventory report shape", featureInventory !== null && featureInventory.writesToSupabase === false && featureInventory.pitchers.length > 0);
  check("BDL season stats feature inventory available", (featureInventory?.summary.pitchersWithSeasonStats ?? 0) > 0 && featureInventory?.pitchers.some((row) => row.seasonStats.available) === true);
  check("missing recent stats fallback documented", featureInventory?.summary.rollingLogsAvailable === false && featureInventory?.pitchers.some((row) => row.recentStats.available === false && row.recentStats.note.includes("Season baseline")) === true);
  check("opponent K profile unavailable is explicit", featureInventory?.summary.opponentKProfileAvailable === false && featureInventory?.pitchers.every((row) => row.context.opponentKProfileAvailable === false) === true);
  const modelComparison = bdlDryRun.modelComparisonPath
    ? JSON.parse(readFileSync(bdlDryRun.modelComparisonPath, "utf8")) as {
      writesToSupabase: boolean;
      candidates: Array<{ oldBaselineProbability: number; newDistributionProbability: number; confidenceBucket: string }>;
      summary: { averageProbabilityDifference: number | null; confidenceDistribution: Record<string, number> };
    }
    : null;
  check("model comparison report generated with bounded probabilities", modelComparison !== null && modelComparison.writesToSupabase === false && modelComparison.candidates.every((row) => row.oldBaselineProbability >= 0 && row.oldBaselineProbability <= 1 && row.newDistributionProbability >= 0 && row.newDistributionProbability <= 1));
  check("feature confidence high/medium/low buckets reported", modelComparison !== null && Object.keys(modelComparison.summary.confidenceDistribution).length > 0 && modelComparison.candidates.every((row) => ["high", "medium", "low"].includes(row.confidenceBucket)));
  const decisionReport = bdlDryRun.firstPaperRunDecisionPath
    ? JSON.parse(readFileSync(bdlDryRun.firstPaperRunDecisionPath, "utf8")) as {
      writesToSupabase: boolean;
      recommendedFirstPaperCount: number;
      persistRecommended: boolean;
      modelProbabilityDistribution: Record<string, number>;
      persistCommandIfRecommended: string | null;
    }
    : null;
  check("first-paper-run decision report generated", decisionReport !== null && decisionReport.writesToSupabase === false && typeof decisionReport.persistRecommended === "boolean");
  check("calibration-ready probability buckets present", decisionReport !== null && ["50-52.5%", "52.5-55%", "55-57.5%", "57.5-60%", "60-65%", "65%+"].every((bucket) => bucket in decisionReport.modelProbabilityDistribution));
  check("first-paper-run recommendations remain capped", decisionReport !== null && decisionReport.recommendedFirstPaperCount <= 25);
  const bdlAudit = bdlDryRun.bdlSanityAuditPath
    ? JSON.parse(readFileSync(bdlDryRun.bdlSanityAuditPath, "utf8")) as {
      writesToSupabase: boolean;
      rawRecommendations: Array<{
        bdlGameId: string | null;
        bdlPlayerId: string | null;
        side: "over" | "under";
        overOdds: number;
        underOdds: number;
        noVigMarketProbability: number | null;
        modelProbability: number;
        expectedValue: number | null;
        reasonCodes: string[];
        sanityFlags: string[];
      }>;
      reviewRecommendations: Array<{ vendor: string; expectedValue: number | null }>;
      summary: {
        rawRecommendationsCount: number;
        dedupedReviewRecommendationsCount: number;
        removedDuplicatesCount: number;
        conflictBlockedCount: number;
        modelProbabilityBelow050Recommendations: number;
        impossibleProbabilityCount: number;
        oddsParsingOutlierRecommendations: number;
        sanityFlags: Record<string, number>;
      };
    }
    : null;
  const firstBdlRecommendation = bdlAudit?.rawRecommendations[0] ?? null;
  const firstBdlDevig = firstBdlRecommendation
    ? remove_vig_two_way(firstBdlRecommendation.overOdds, firstBdlRecommendation.underOdds)
    : null;
  const firstBdlSelectedOdds = firstBdlRecommendation?.side === "over"
    ? firstBdlRecommendation.overOdds
    : firstBdlRecommendation?.underOdds ?? null;
  check("BDL sanity audit writes local no-Supabase report", bdlAudit !== null && bdlAudit.writesToSupabase === false && bdlAudit.summary.rawRecommendationsCount === bdlAudit.rawRecommendations.length);
  check("BDL recommendation audit includes sanitized provider identity", firstBdlRecommendation !== null && firstBdlRecommendation.bdlGameId === "7001" && firstBdlRecommendation.bdlPlayerId === "9001");
  check("BDL over/under no-vig sums to 1 in audit", firstBdlDevig !== null && approx(firstBdlDevig.over + firstBdlDevig.under, 1));
  check("BDL side-specific EV uses selected side odds", firstBdlRecommendation !== null && firstBdlSelectedOdds !== null && firstBdlRecommendation.expectedValue !== null && approx(firstBdlRecommendation.expectedValue, Math.round(expected_value(firstBdlRecommendation.modelProbability, firstBdlSelectedOdds) * 10_000) / 10_000));
  check("BDL clean recommendations carry no odds sanity flag", bdlAudit !== null && bdlAudit.rawRecommendations.every((row) => row.sanityFlags.length === 0));
  check("BDL audit reports probability and odds-outlier distributions", bdlAudit !== null && bdlAudit.summary.modelProbabilityBelow050Recommendations === 0 && bdlAudit.summary.impossibleProbabilityCount === 0 && bdlAudit.summary.oddsParsingOutlierRecommendations === 0);
  const duplicateBdlRows = [
    ...bdlParsed,
    ...bdlParsed
      .filter((row) => row.marketKey === "pitcher_strikeouts")
      .map((row) => ({
        ...row,
        sportsbook: "fanduel",
        americanOdds: 120,
        decimalOdds: american_to_decimal(120),
        impliedProbability: american_to_implied_probability(120),
        rawPayload: {
          ...(row.rawPayload as Record<string, unknown>),
          vendor: "FanDuel",
          player_name: null,
          bdl_away_pitcher_id: "9001",
        },
      })),
  ].map((row) => ({
    ...row,
    rawPayload: {
      ...(row.rawPayload as Record<string, unknown>),
      player_name: null,
      bdl_away_pitcher_id: "9001",
    },
  }));
  const duplicateBdlDryRun = await scoreRealMlbPropsDryRun({
    games: realGames,
    probablePitchers: realProbables,
    date: "2026-07-07",
    asOfTimestamp: "2026-07-07T15:00:00.000Z",
    odds: duplicateBdlRows,
    seasonStatsByPlayerId: new Map([
      ["balldontlie-player-9001", {
        playerId: "balldontlie-player-9001",
        pitchingGs: 12,
        pitchingGp: 13,
        pitchingIp: 72,
        pitchingK: 86,
        pitchingKPer9: 10.75,
      }],
    ]),
  });
  const duplicateAudit = duplicateBdlDryRun.bdlSanityAuditPath
    ? JSON.parse(readFileSync(duplicateBdlDryRun.bdlSanityAuditPath, "utf8")) as {
      reviewRecommendations: Array<{ market: string; vendor: string; expectedValue: number | null }>;
      summary: { removedDuplicatesCount: number; sanityFlags: Record<string, number> };
    }
    : null;
  const duplicateStrikeoutReview = duplicateAudit?.reviewRecommendations.find((row) => row.market === "pitcher_strikeouts");
  check("duplicate vendor lines dedupe correctly", duplicateAudit !== null && duplicateAudit.summary.removedDuplicatesCount > 0 && (duplicateAudit.summary.sanityFlags.DUPLICATE_VENDOR_LINE ?? 0) > 0);
  check("same player/market best price selected", duplicateStrikeoutReview?.vendor === "fanduel");
  const sanityBlocked = recommendPropBet({
    prediction: { ...prediction, side: "over", modelProbability: 0.68 },
    overOdds: over,
    underOdds: under,
    asOfTimestamp: "2026-07-07T15:00:00.000Z",
    forceNoPlayReasonCodes: ["CONFLICTING_SIDE_RECOMMENDATION"],
    config: { maxOddsAgeSeconds: 10_000 },
  });
  check("conflicting over/under same player/market blocked by sanity flag", sanityBlocked.status === "no_play" && sanityBlocked.reasonCodes.includes("CONFLICTING_SIDE_RECOMMENDATION"));
  const unusualEvBlocked = recommendPropBet({
    prediction: { ...prediction, side: "over", modelProbability: 0.95 },
    overOdds: over ? { ...over, americanOdds: 900, decimalOdds: american_to_decimal(900), impliedProbability: american_to_implied_probability(900) } : null,
    underOdds: under,
    asOfTimestamp: "2026-07-07T15:00:00.000Z",
    forceNoPlayReasonCodes: ["UNUSUALLY_HIGH_EV"],
    config: { maxOddsAgeSeconds: 10_000 },
  });
  check("unusually high EV flagged candidates are not recommended", unusualEvBlocked.status === "no_play" && unusualEvBlocked.reasonCodes.includes("UNUSUALLY_HIGH_EV"));
  const staleBdlDryRun = await scoreRealMlbPropsDryRun({
    games: realGames,
    probablePitchers: realProbables,
    date: "2026-07-07",
    asOfTimestamp: "2026-07-07T17:00:00.000Z",
    odds: bdlParsed.map((row) => ({
      ...row,
      rawPayload: {
        ...(row.rawPayload as Record<string, unknown>),
        player_name: null,
        bdl_away_pitcher_id: "9001",
      },
    })),
    seasonStatsByPlayerId: new Map([
      ["balldontlie-player-9001", {
        playerId: "balldontlie-player-9001",
        pitchingGs: 12,
        pitchingGp: 13,
        pitchingIp: 72,
        pitchingK: 86,
        pitchingKPer9: 10.75,
      }],
    ]),
  });
  check("stale BDL updated_at flagged", (staleBdlDryRun.bdlSanityAuditSummary?.staleUpdatedAtAnomalies ?? 0) > 0);
  const missingUpdatedAtDryRun = await scoreRealMlbPropsDryRun({
    games: realGames,
    probablePitchers: realProbables,
    date: "2026-07-07",
    asOfTimestamp: "2026-07-07T15:00:00.000Z",
    odds: bdlParsed.map((row) => ({
      ...row,
      rawPayload: {
        ...(row.rawPayload as Record<string, unknown>),
        updated_at: null,
        player_name: null,
        bdl_away_pitcher_id: "9001",
      },
    })),
    seasonStatsByPlayerId: new Map([
      ["balldontlie-player-9001", {
        playerId: "balldontlie-player-9001",
        pitchingGs: 12,
        pitchingGp: 13,
        pitchingIp: 72,
        pitchingK: 86,
        pitchingKPer9: 10.75,
      }],
    ]),
  });
  check("missing BDL updated_at flagged", (missingUpdatedAtDryRun.bdlSanityAuditSummary?.missingUpdatedAtAnomalies ?? 0) > 0);
  check("both Sharp and BDL empty preserve unavailable blocker", unavailableDryRun.rejectedCountByReasonCode.PROVIDER_PROP_ODDS_UNAVAILABLE === 1 && unavailableDryRun.candidatesScored === 0);
  check("Sharp availability classifier separates empty provider odds", classifySharpApiAvailability({
    eventCount: 2,
    probes: [{ ok: true, rowCount: 0 }, { ok: true, rowCount: 0 }],
  }) === "PROVIDER_PROP_ODDS_UNAVAILABLE");
  const diagnostic = await diagnoseSharpApiMlbPropsAvailability({
    date: "2026-07-07",
    apiKey: "test-key",
    baseUrl: "https://example.test/api/v1",
    maxEvents: 1,
    outputDir: `/private/tmp/mlb-props-diagnostic-test-${Date.now()}`,
    fetchImpl: mockSharpDiagnosticFetch,
  });
  check("Sharp diagnostic writes no Supabase and classifies empty odds", diagnostic.writesToSupabase === false && diagnostic.summary.blockerReason === "PROVIDER_PROP_ODDS_UNAVAILABLE");
  check("Sharp diagnostic records support summary", diagnostic.supportSummary.mlbEventsFound === 1 && diagnostic.supportSummary.marketsTested.includes("pitcher_strikeouts"));
  check("Sharp diagnostic records event-level summary", diagnostic.eventSummaries.length === 1 && diagnostic.eventSummaries[0]?.marketsEmpty.includes("pitcher_strikeouts"));
  check("Sharp diagnostic tests endpoint variants", diagnostic.endpointVariantProbes.some((probe) => probe.variant === "event_id_only") && diagnostic.endpointVariantProbes.every((probe) => probe.supportStatus === "supported_empty"));
  check("Sharp diagnostic reports provider availability fields", diagnostic.summary.providerAvailabilityStatus === "unavailable" && diagnostic.summary.propRowsFound === 0 && diagnostic.summary.marketsAllEmpty.includes("pitcher_outs"));
  const sweepDiagnostic = await diagnoseSharpApiMlbPropsAvailability({
    date: "2026-07-07",
    apiKey: "test-key",
    baseUrl: "https://example.test/api/v1",
    sweep: true,
    outputDir: `/private/tmp/mlb-props-diagnostic-sweep-test-${Date.now()}`,
    fetchImpl: mockSharpDiagnosticFetch,
  });
  check("Sharp diagnostic sweep includes future window and all returned events", sweepDiagnostic.sweep && sweepDiagnostic.datesTested.includes("2026-07-10") && sweepDiagnostic.eventCount === 2);
  const deepDiagnostic = await diagnoseSharpApiMlbPropsAvailability({
    date: "2026-07-07",
    apiKey: "test-key",
    baseUrl: "https://example.test/api/v1",
    deep: true,
    maxEvents: 1,
    outputDir: `/private/tmp/mlb-props-diagnostic-deep-test-${Date.now()}`,
    fetchImpl: mockSharpDiagnosticFetch,
  });
  check("Sharp deep diagnostic probes reference and event endpoints", deepDiagnostic.deepDiscovery !== null && deepDiagnostic.deepDiscovery.referenceEndpoints.length >= 6 && deepDiagnostic.deepDiscovery.eventOddsProbes.some((probe) => probe.endpointPath.includes("/odds")));
  check("Sharp deep diagnostic reports precise blocker", deepDiagnostic.deepDiscovery?.preciseBlockerClassification === "MARKET_KEYS_DIFFER_FROM_ASSUMED");

  if (over) {
    const clvExact = comparePropClv({
      betOdds: over,
      closingSnapshots: closingOver,
      gameStartTimestamp: "2026-07-07T23:07:00.000Z",
      providerVerifiedClose: true,
    });
    check("exact-line CLV comparable", clvExact.status === "comparable");
    const movedLine = comparePropClv({
      betOdds: over,
      closingSnapshots: closingOver.map((row) => ({ ...row, line: 6.5 })),
      gameStartTimestamp: "2026-07-07T23:07:00.000Z",
      providerVerifiedClose: true,
    });
    check("moved-line CLV not comparable", movedLine.status === "line_moved_not_comparable");
    const missingClose = comparePropClv({
      betOdds: over,
      closingSnapshots: [],
      gameStartTimestamp: "2026-07-07T23:07:00.000Z",
    });
    check("missing close CLV pending", missingClose.status === "pending");
    const staleClose = comparePropClv({
      betOdds: over,
      closingSnapshots: closingOver.map((row) => ({ ...row, asOfTimestamp: "2026-07-08T00:00:00.000Z" })),
      gameStartTimestamp: "2026-07-07T23:07:00.000Z",
    });
    check("stale close rejected", staleClose.status === "rejected");
  }

  check("pitcher strikeouts over win settlement", settlePropPick({
    marketKey: "pitcher_strikeouts",
    playerId: "mock-pitcher-1",
    gameId: "mock-game-1",
    line: 5.5,
    side: "over",
    finalStats: { strikeouts: 7 },
  }).status === "settled");
  check("pitcher strikeouts under win settlement", settlePropPick({
    marketKey: "pitcher_strikeouts",
    playerId: "mock-pitcher-1",
    gameId: "mock-game-1",
    line: 5.5,
    side: "under",
    finalStats: { strikeouts: 4 },
  }).status === "settled");
  const pushSettlement = settlePropPick({
    marketKey: "pitcher_strikeouts",
    playerId: "mock-pitcher-1",
    gameId: "mock-game-1",
    line: 5,
    side: "over",
    finalStats: { strikeouts: 5 },
  });
  check("settlement push detected", pushSettlement.status === "settled" && pushSettlement.result === "push");
  check("player did not start unresolved", settlePropPick({
    marketKey: "pitcher_strikeouts",
    playerId: "mock-pitcher-1",
    gameId: "mock-game-1",
    line: 5.5,
    side: "over",
    finalStats: { strikeouts: 7 },
    playerStarted: false,
  }).status === "unresolved");
  check("missing final stat unresolved", settlePropPick({
    marketKey: "pitcher_strikeouts",
    playerId: "mock-pitcher-1",
    gameId: "mock-game-1",
    line: 5.5,
    side: "over",
    finalStats: {},
  }).status === "unresolved");
  check("pitcher outs conversion from IP is correct", outsFromInningsPitched("5.2") === 17 && outsFromInningsPitched(6.1) === 19);
  check("settlement result scaffold handles outs", settlementResultFromFinalStats({
    marketKey: "pitcher_outs",
    playerId: "mock-pitcher-1",
    gameId: "mock-game-1",
    line: 17.5,
    finalStats: { innings_pitched: "6.0" },
  }).overWon === true);
  check("hitter settlement supports member-facing prop markets", [
    settlePropPick({ marketKey: "batter_hits", playerId: "mock-hitter-1", gameId: "mock-game-1", line: 1.5, side: "over", finalStats: { hits: 2 } }),
    settlePropPick({ marketKey: "batter_total_bases", playerId: "mock-hitter-1", gameId: "mock-game-1", line: 2.5, side: "over", finalStats: { total_bases: 4 } }),
    settlePropPick({ marketKey: "batter_strikeouts", playerId: "mock-hitter-1", gameId: "mock-game-1", line: 0.5, side: "under", finalStats: { strikeouts: 0 } }),
    settlePropPick({ marketKey: "batter_hits_runs_rbis", playerId: "mock-hitter-1", gameId: "mock-game-1", line: 1.5, side: "over", finalStats: { hits_runs_rbis: 3 } }),
    settlePropPick({ marketKey: "batter_stolen_bases", playerId: "mock-hitter-1", gameId: "mock-game-1", line: 0.5, side: "over", finalStats: { stolen_bases: 1 } }),
  ].every((result) => result.status === "settled" && result.result === "win"));

  const backtest = await runFixtureMlbPropBacktest({
    provider,
    date: "2026-07-07",
    asOfTimestamp: "2026-07-07T15:00:00.000Z",
  });
  check("fixture backtest runs", backtest.recommendations.length > 0);
  check("fixture backtest reproducible", backtest.name === "fixture_2026-07-07");
  check("fixture backtest calculates CLV when closing line exists", backtest.recommendations.some((row) => row.clv !== null));
  check("fixture backtest supports pitcher outs market", (await runFixtureMlbPropBacktest({
    provider,
    date: "2026-07-07",
    asOfTimestamp: "2026-07-07T15:00:00.000Z",
    marketKeys: ["pitcher_outs"],
  })).recommendations.some((row) => row.marketKey === "pitcher_outs"));

  console.log(`\nPass: ${pass}  Fail: ${fail}`);
  if (fail > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
}

function oddsSeed(row: PropOddsSnapshot) {
  const raw = row.rawPayload as Record<string, unknown>;
  return {
    eventHome: String(raw.event_home_team),
    eventAway: String(raw.event_away_team),
    eventStart: String(raw.event_start_time),
    playerName: String(raw.player_name),
    marketKey: row.marketKey,
    side: row.side,
    line: row.line,
    americanOdds: row.americanOdds,
    sportsbook: row.sportsbook,
  };
}

function realOdds(args: {
  eventHome: string;
  eventAway: string;
  eventStart: string;
  playerName: string;
  marketKey: PropOddsSnapshot["marketKey"];
  side: "over" | "under";
  line?: number;
  americanOdds?: number;
  sportsbook?: string;
}): PropOddsSnapshot {
  const americanOdds = args.americanOdds ?? 110;
  return {
    marketKey: args.marketKey,
    gameId: "sharpapi-event-evt1",
    playerId: `sharpapi-player-${normalizePlayerName(args.playerName)}`,
    sportsbook: args.sportsbook ?? "draftkings",
    side: args.side,
    line: args.line ?? 5.5,
    americanOdds,
    decimalOdds: american_to_decimal(americanOdds),
    impliedProbability: american_to_implied_probability(americanOdds),
    asOfTimestamp: "2026-07-07T15:00:00.000Z",
    snapshotRole: "current",
    provider: "sharpapi",
    rawPayload: {
      event_id: "evt1",
      event_home_team: args.eventHome,
      event_away_team: args.eventAway,
      event_start_time: args.eventStart,
      event_neutral_site: false,
      player_name: args.playerName,
      market_type: args.marketKey,
      selection_type: args.side,
      is_main_line: true,
      is_alternate_line: false,
    },
  };
}

async function mockSharpDiagnosticFetch(input: URL | RequestInfo): Promise<Response> {
  const url = new URL(String(input));
  if (url.pathname.endsWith("/events")) {
    return Response.json({
      data: [
      {
        id: "evt1",
        start_time: "2026-07-07T23:07:00.000Z",
        home_team: "Toronto Blue Jays",
        away_team: "New York Mets",
        markets: ["moneyline", "player_runs"],
      },
      {
        id: "evt2",
        league: "mlb",
        start_time: "2026-07-10T20:05:00.000Z",
        home_team: "Chicago Cubs",
        away_team: "St. Louis Cardinals",
        status: "pregame",
        markets: ["moneyline", "total_runs"],
      },
    ],
  });
  }
  return Response.json({ data: [], pagination: { count: 0 } });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
