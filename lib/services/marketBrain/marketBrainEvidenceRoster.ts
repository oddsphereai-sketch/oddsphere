import {
  MARKET_BRAIN_ACTIVE_PRODUCT_KEYS,
  MARKET_BRAIN_PRODUCT_REGISTRY,
  type MarketBrainActiveProductKey,
} from "./marketBrainProductRegistry";

export const MARKET_BRAIN_EVIDENCE_ROSTER_RELEASE =
  "market_brain_evidence_roster_2026_10_27_r3_all_product_source_contracts" as const;

export const MARKET_BRAIN_TRUE_PROVIDER_BLIND_SPOTS = Object.freeze([
  "absolute_handle", "ticket_count", "bet_size_distribution", "book_limits",
  "move_origin", "suspension_lifecycle", "private_order_flow",
] as const);

export type MarketBrainTrueProviderBlindSpot = typeof MARKET_BRAIN_TRUE_PROVIDER_BLIND_SPOTS[number];
export type MarketBrainFeedPhase = "provider_opening" | "current" | "pregame_context" | "historical_context" | "settlement";
export type MarketBrainCaptureStatus = "not_started" | "partial" | "complete";

export type MarketBrainExpectedFeed = Readonly<{
  provider: string;
  feed: string;
  participant: string | null;
  evidenceFamilies: readonly string[];
  phases: readonly MarketBrainFeedPhase[];
  expectation: "required" | "opportunistic";
  replayMode: "raw_replayable" | "normalized_only";
  captureStatus: MarketBrainCaptureStatus;
}>;

export type MarketBrainExpectedParticipant = Readonly<{
  provider: string;
  participant: string;
  expectation: "required" | "opportunistic";
}>;

/** A dynamic catalog is an explicit discovery obligation, not permission to accept parser survivors. */
export type MarketBrainParticipantRoster = Readonly<{
  provider: string;
  mode: "explicit_allowlist" | "provider_catalog";
  namedParticipants: readonly MarketBrainExpectedParticipant[];
  excludedParticipants: readonly string[];
  implementationStatus: MarketBrainCaptureStatus;
}>;

export type MarketBrainEvidenceRoster = Readonly<{
  release: typeof MARKET_BRAIN_EVIDENCE_ROSTER_RELEASE;
  product: MarketBrainActiveProductKey;
  contractStatus: "frozen";
  coverageStatus: MarketBrainCaptureStatus;
  coveredEvidenceFamilies: readonly string[];
  unresolvedEvidenceFamilies: readonly string[];
  feeds: readonly MarketBrainExpectedFeed[];
  priceParticipants: readonly MarketBrainExpectedParticipant[];
  participantRosters: readonly MarketBrainParticipantRoster[];
  trueProviderBlindSpots: readonly MarketBrainTrueProviderBlindSpot[];
}>;

export const NFL_MARKET_BRAIN_EVIDENCE_ROSTER = contractRoster({
  product: "nfl_daily_edge",
  coverageStatus: "partial",
  coveredEvidenceFamilies: ["two_sided_prices", "same_book_chronology"],
  feeds: [
    expectedFeed("balldontlie", "opening_odds", ["two_sided_prices", "same_book_chronology"], ["provider_opening"], "required", "raw_replayable", "partial"),
    expectedFeed("balldontlie", "current_odds", ["two_sided_prices", "same_book_chronology"], ["current"], "required", "raw_replayable", "partial"),
    expectedFeed("sharpapi", "main_odds", ["two_sided_prices", "same_book_chronology"], ["current"], "required", "raw_replayable", "partial", "circa"),
    expectedFeed("sharpapi", "main_odds", ["two_sided_prices", "same_book_chronology"], ["current"], "required", "raw_replayable", "partial", "pinnacle"),
    expectedFeed("sharpapi", "sportsbook_splits", ["identified_splits"], ["current"], "required", "raw_replayable"),
    expectedFeed("playbook", "public_splits", ["public_splits"], ["current"], "required", "raw_replayable"),
    expectedFeed("balldontlie", "player_designations", ["availability"], ["pregame_context"], "required", "raw_replayable"),
    expectedFeed("openweather", "venue_forecast", ["weather"], ["pregame_context"], "required", "raw_replayable"),
  ],
  participantRosters: [
    explicitParticipants("balldontlie", ["fanduel", "draftkings", "caesars", "betmgm", "fanatics", "betrivers"], "opportunistic", "partial"),
    explicitParticipants("sharpapi", ["circa", "pinnacle"], "required", "partial"),
  ],
});

export const MARKET_BRAIN_EVIDENCE_ROSTERS: Readonly<Record<MarketBrainActiveProductKey, MarketBrainEvidenceRoster>> = Object.freeze({
  nfl_daily_edge: NFL_MARKET_BRAIN_EVIDENCE_ROSTER,
  cfb_daily_edge: contractRoster({
    product: "cfb_daily_edge",
    feeds: [
      expectedFeed("balldontlie", "ncaaf_opening_odds", ["two_sided_prices", "same_book_chronology"], ["provider_opening"], "required", "raw_replayable"),
      expectedFeed("balldontlie", "ncaaf_current_odds", ["two_sided_prices", "same_book_chronology"], ["current"], "required", "raw_replayable"),
      expectedFeed("sharpapi", "main_odds", ["two_sided_prices", "same_book_chronology"], ["current"], "required", "raw_replayable"),
      expectedFeed("sharpapi", "sportsbook_splits", ["identified_splits"], ["current"], "required", "raw_replayable"),
      expectedFeed("playbook", "public_splits", ["public_splits"], ["current"], "required", "raw_replayable"),
      expectedFeed("official_conference_reports", "player_availability", ["availability"], ["pregame_context"], "required", "raw_replayable"),
      expectedFeed("espn", "injury_news", ["availability"], ["pregame_context"], "required", "raw_replayable"),
      expectedFeed("sportsdataio", "national_injuries", ["availability"], ["pregame_context"], "opportunistic", "raw_replayable"),
      expectedFeed("openweather", "venue_forecast", ["weather"], ["pregame_context"], "required", "raw_replayable"),
    ],
    participantRosters: [providerCatalog("balldontlie", ["fanduel", "draftkings", "caesars", "betmgm", "fanatics", "betrivers"]), providerCatalog("sharpapi", ["circa", "pinnacle"])],
  }),
  nba_daily_edge: contractRoster({
    product: "nba_daily_edge",
    feeds: [
      expectedFeed("sharpapi", "main_odds", ["two_sided_prices", "same_book_chronology"], ["provider_opening", "current"], "required", "raw_replayable"),
      expectedFeed("sharpapi", "sportsbook_splits", ["identified_splits"], ["current"], "required", "raw_replayable"),
      expectedFeed("playbook", "public_splits", ["public_splits"], ["current"], "required", "raw_replayable"),
      expectedFeed("espn", "scoreboard_and_injuries", ["availability", "roster_state"], ["pregame_context"], "required", "raw_replayable"),
      expectedFeed("balldontlie", "games_boxes_players", ["roster_state"], ["historical_context", "current"], "required", "raw_replayable"),
    ],
    participantRosters: [providerCatalog("sharpapi", ["circa", "pinnacle", "bookmaker"])],
  }),
  wnba_daily_edge: contractRoster({
    product: "wnba_daily_edge",
    feeds: [
      expectedFeed("sharpapi", "main_odds", ["two_sided_prices", "same_book_chronology"], ["provider_opening", "current"], "required", "raw_replayable"),
      expectedFeed("sharpapi", "sportsbook_splits", ["identified_splits"], ["current"], "required", "raw_replayable"),
      expectedFeed("playbook", "consensus_lines", ["two_sided_prices"], ["current"], "opportunistic", "raw_replayable"),
      expectedFeed("playbook", "public_splits", ["public_splits"], ["current"], "required", "raw_replayable"),
      expectedFeed("espn", "scoreboard_and_injuries", ["availability"], ["pregame_context"], "required", "raw_replayable"),
    ],
    participantRosters: [providerCatalog("sharpapi", ["circa", "pinnacle", "bookmaker"]), explicitParticipants("playbook", ["playbook_consensus"], "opportunistic")],
  }),
  mlb_daily_edge: contractRoster({
    product: "mlb_daily_edge",
    feeds: [
      expectedFeed("sharpapi", "main_odds", ["two_sided_prices", "same_book_chronology"], ["provider_opening", "current"], "required", "raw_replayable"),
      expectedFeed("sharpapi", "sharp_signals", ["identified_splits"], ["current"], "required", "raw_replayable"),
      expectedFeed("playbook", "public_splits", ["public_splits"], ["current"], "required", "raw_replayable"),
      expectedFeed("playbook", "starting_pitchers_and_lineups", ["probable_pitchers", "lineups"], ["pregame_context"], "required", "raw_replayable"),
      expectedFeed("mlb_stats", "official_schedule_and_probable_pitchers", ["probable_pitchers"], ["pregame_context"], "required", "raw_replayable"),
      expectedFeed("mlb_stats", "official_lineups", ["lineups"], ["pregame_context"], "required", "raw_replayable"),
      expectedFeed("openweather", "venue_forecast", ["weather"], ["pregame_context"], "required", "raw_replayable"),
    ],
    participantRosters: [providerCatalog("sharpapi", ["circa", "pinnacle", "bookmaker"])],
  }),
  nhl_daily_edge: contractRoster({
    product: "nhl_daily_edge",
    feeds: [
      expectedFeed("sharpapi", "event_odds", ["two_sided_prices", "same_book_chronology"], ["provider_opening", "current"], "required", "raw_replayable"),
      expectedFeed("sharpapi", "sportsbook_splits", ["identified_splits"], ["current"], "required", "raw_replayable"),
      expectedFeed("playbook", "public_splits", ["public_splits"], ["current"], "required", "raw_replayable"),
      expectedFeed("nhl_api", "schedule_team_and_goalie_stats", ["goalie_state"], ["historical_context", "pregame_context"], "required", "raw_replayable"),
      expectedFeed("espn", "injuries_and_starting_goalie_context", ["availability", "goalie_state"], ["pregame_context"], "required", "raw_replayable"),
    ],
    participantRosters: [providerCatalog("sharpapi", ["circa", "pinnacle", "bookmaker"])],
  }),
  epl_daily_edge: soccerRoster("epl_daily_edge", "balldontlie_epl", "club_state"),
  ucl_daily_edge: soccerRoster("ucl_daily_edge", "balldontlie_ucl", "club_state", ["polymarket", "kalshi"]),
  soccer_world_cup_daily_edge: soccerRoster("soccer_world_cup_daily_edge", "balldontlie_fifa", "team_state"),
  nfl_player_props: contractRoster({
    product: "nfl_player_props",
    feeds: [
      expectedFeed("balldontlie", "player_props_current_and_opening", ["exact_prop_offers", "same_line_chronology"], ["provider_opening", "current"], "required", "raw_replayable"),
      expectedFeed("sharpapi", "player_props_reference", ["target_excluded_reference_offers"], ["current"], "required", "raw_replayable"),
      expectedFeed("balldontlie", "player_designations_and_depth", ["availability", "role_state"], ["pregame_context"], "required", "raw_replayable"),
      expectedFeed("balldontlie", "main_game_market", ["game_context"], ["current"], "required", "raw_replayable"),
    ],
    participantRosters: [providerCatalog("balldontlie", []), explicitParticipants("sharpapi", ["pinnacle", "novig"], "required")],
  }),
  nba_player_props: contractRoster({
    product: "nba_player_props",
    feeds: [
      expectedFeed("balldontlie", "player_props_current_and_opening", ["exact_prop_offers", "same_line_chronology"], ["provider_opening", "current"], "required", "raw_replayable"),
      expectedFeed("the_odds_api", "player_props", ["target_excluded_reference_offers"], ["current"], "required", "raw_replayable"),
      expectedFeed("espn", "game_injuries", ["availability"], ["pregame_context"], "required", "raw_replayable"),
      expectedFeed("balldontlie", "games_boxes_advanced_players", ["role_state", "component_relationships"], ["historical_context", "current"], "required", "raw_replayable"),
    ],
    participantRosters: [providerCatalog("balldontlie", []), providerCatalog("the_odds_api", ["pinnacle", "fanduel", "bet365", "novig", "profitx"], ["polymarket"])],
  }),
  mlb_player_props: contractRoster({
    product: "mlb_player_props",
    feeds: [
      expectedFeed("balldontlie", "player_props_current_and_opening", ["exact_prop_offers", "same_line_chronology"], ["provider_opening", "current"], "required", "raw_replayable"),
      expectedFeed("sharpapi", "player_props_reference", ["target_excluded_reference_offers"], ["current"], "required", "raw_replayable"),
      expectedFeed("mlb_stats", "probable_pitchers_and_lineups", ["probable_pitchers", "lineups", "role_state"], ["pregame_context"], "required", "raw_replayable"),
      expectedFeed("nws", "venue_forecast", ["weather"], ["pregame_context"], "required", "raw_replayable"),
    ],
    participantRosters: [providerCatalog("balldontlie", []), providerCatalog("sharpapi", ["pinnacle", "circa", "bookmaker"])],
  }),
});

export function assertMarketBrainEvidenceRoster(roster: MarketBrainEvidenceRoster): void {
  const feedKeys = roster.feeds.map((row) => [row.provider, row.feed, row.participant ?? "*"].join("|"));
  const participantKeys = roster.priceParticipants.map((row) => `${row.provider}|${row.participant}`);
  const declaredFamilies = MARKET_BRAIN_PRODUCT_REGISTRY[roster.product].expectedEvidenceFamilies;
  const accountedFamilies = [...roster.coveredEvidenceFamilies, ...roster.unresolvedEvidenceFamilies];
  const feedFamilies = new Set(roster.feeds.flatMap((row) => row.evidenceFamilies));
  if (roster.release !== MARKET_BRAIN_EVIDENCE_ROSTER_RELEASE || roster.contractStatus !== "frozen" ||
    new Set(feedKeys).size !== feedKeys.length || new Set(participantKeys).size !== participantKeys.length ||
    new Set(accountedFamilies).size !== accountedFamilies.length ||
    JSON.stringify([...declaredFamilies].sort()) !== JSON.stringify([...accountedFamilies].sort()) ||
    declaredFamilies.some((family) => !feedFamilies.has(family)) ||
    (roster.coverageStatus === "not_started" && roster.coveredEvidenceFamilies.length > 0) ||
    (roster.coverageStatus !== "not_started" && roster.coveredEvidenceFamilies.length === 0) ||
    (roster.coverageStatus === "complete" && roster.unresolvedEvidenceFamilies.length > 0) ||
    roster.coveredEvidenceFamilies.some((family) => !roster.feeds.some((row) => row.evidenceFamilies.includes(family) && row.captureStatus !== "not_started")) ||
    roster.feeds.some((row) => row.phases.length === 0 || row.evidenceFamilies.length === 0) ||
    roster.participantRosters.length === 0 ||
    roster.participantRosters.some((entry) => entry.namedParticipants.some((row) => row.provider !== entry.provider) ||
      new Set(entry.namedParticipants.map((row) => row.participant)).size !== entry.namedParticipants.length ||
      new Set(entry.excludedParticipants).size !== entry.excludedParticipants.length ||
      (entry.mode === "explicit_allowlist" && entry.namedParticipants.length === 0)) ||
    MARKET_BRAIN_TRUE_PROVIDER_BLIND_SPOTS.some((blindSpot) => !roster.trueProviderBlindSpots.includes(blindSpot))) {
    throw new Error(`Market Brain evidence roster is incomplete or ambiguous: ${roster.product}`);
  }
}

export function assertCompleteMarketBrainEvidenceRosterRegistry(): void {
  const keys = Object.keys(MARKET_BRAIN_EVIDENCE_ROSTERS).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...MARKET_BRAIN_ACTIVE_PRODUCT_KEYS].sort())) {
    throw new Error("Market Brain evidence roster registry does not cover every active product.");
  }
  for (const product of MARKET_BRAIN_ACTIVE_PRODUCT_KEYS) {
    const roster = MARKET_BRAIN_EVIDENCE_ROSTERS[product];
    assertMarketBrainEvidenceRoster(roster);
    if (MARKET_BRAIN_PRODUCT_REGISTRY[product].adapterState !== "not_started" && roster.coverageStatus === "not_started") {
      throw new Error(`Started Market Brain adapter has no implemented evidence coverage: ${product}`);
    }
  }
}

function contractRoster(args: {
  product: MarketBrainActiveProductKey;
  feeds: readonly MarketBrainExpectedFeed[];
  participantRosters: readonly MarketBrainParticipantRoster[];
  coverageStatus?: MarketBrainCaptureStatus;
  coveredEvidenceFamilies?: readonly string[];
}): MarketBrainEvidenceRoster {
  const covered = [...(args.coveredEvidenceFamilies ?? [])];
  const unresolved = MARKET_BRAIN_PRODUCT_REGISTRY[args.product].expectedEvidenceFamilies.filter((family) => !covered.includes(family));
  const participantRosters = args.participantRosters.map((entry) => Object.freeze({ ...entry,
    namedParticipants: Object.freeze([...entry.namedParticipants]), excludedParticipants: Object.freeze([...entry.excludedParticipants]) }));
  return Object.freeze({
    release: MARKET_BRAIN_EVIDENCE_ROSTER_RELEASE, product: args.product, contractStatus: "frozen" as const,
    coverageStatus: args.coverageStatus ?? "not_started", coveredEvidenceFamilies: Object.freeze(covered),
    unresolvedEvidenceFamilies: Object.freeze(unresolved), feeds: Object.freeze([...args.feeds]),
    priceParticipants: Object.freeze(participantRosters.flatMap((entry) => entry.namedParticipants)),
    participantRosters: Object.freeze(participantRosters), trueProviderBlindSpots: MARKET_BRAIN_TRUE_PROVIDER_BLIND_SPOTS,
  });
}

function soccerRoster(product: "epl_daily_edge" | "ucl_daily_edge" | "soccer_world_cup_daily_edge", statsProvider: string,
  stateFamily: "club_state" | "team_state", excludedParticipants: readonly string[] = []): MarketBrainEvidenceRoster {
  return contractRoster({ product, feeds: [
    expectedFeed("sharpapi", "soccer_market_odds", ["three_way_prices", "two_sided_prices", "same_book_chronology"], ["provider_opening", "current"], "required", "raw_replayable"),
    expectedFeed(statsProvider, "matches_statistics_injuries_lineups", ["availability", stateFamily], ["historical_context", "pregame_context"], "required", "raw_replayable"),
  ], participantRosters: [providerCatalog("sharpapi", ["pinnacle", "circa", "draftkings", "fanduel", "betmgm", "caesars"], excludedParticipants)] });
}

function expectedFeed(provider: string, name: string, evidenceFamilies: readonly string[], phases: readonly MarketBrainFeedPhase[],
  expectation: MarketBrainExpectedFeed["expectation"], replayMode: MarketBrainExpectedFeed["replayMode"],
  captureStatus: MarketBrainCaptureStatus = "not_started", participant: string | null = null): MarketBrainExpectedFeed {
  return Object.freeze({ provider, feed: name, participant, evidenceFamilies: Object.freeze([...evidenceFamilies]),
    phases: Object.freeze([...phases]), expectation, replayMode, captureStatus });
}

function explicitParticipants(provider: string, names: readonly string[], expectation: MarketBrainExpectedParticipant["expectation"],
  implementationStatus: MarketBrainCaptureStatus = "not_started"): MarketBrainParticipantRoster {
  return Object.freeze({ provider, mode: "explicit_allowlist" as const,
    namedParticipants: Object.freeze(names.map((name) => participant(provider, name, expectation))),
    excludedParticipants: Object.freeze([]), implementationStatus });
}

function providerCatalog(provider: string, requiredNamed: readonly string[], excludedParticipants: readonly string[] = []): MarketBrainParticipantRoster {
  return Object.freeze({ provider, mode: "provider_catalog" as const,
    namedParticipants: Object.freeze(requiredNamed.map((name) => participant(provider, name, "required"))),
    excludedParticipants: Object.freeze([...excludedParticipants]), implementationStatus: "not_started" as const });
}

function participant(provider: string, name: string, expectation: MarketBrainExpectedParticipant["expectation"]): MarketBrainExpectedParticipant {
  return Object.freeze({ provider, participant: name, expectation });
}
