export const DAILY_EDGE_COMPLETE_HEALTH_CONTRACT_RELEASE =
  "daily_edge_complete_health_contract_2026_10_21_r1_all_active_models" as const;

export type DailyEdgeHealthSport = "mlb" | "wnba" | "nba" | "nfl" | "cfb" | "nhl" | "soccer";
export type DailyEdgeHealthDimension =
  | "schedule"
  | "statistics"
  | "availability"
  | "current_paired_price"
  | "same_book_opening_current_trail"
  | "public_or_sharp_splits"
  | "model_release"
  | "market_reader_trace"
  | "projection_pick_coherence"
  | "lock"
  | "tracking";

export type DailyEdgeCompleteHealthContract = Readonly<{
  sport: DailyEdgeHealthSport;
  expectedMarkets: readonly string[];
  lineMarkets: readonly string[];
  lineValueRequiredMarkets: ReadonlySet<string>;
  availabilityAuthorities: readonly string[];
  availabilityCredentialEnv?: string;
  splitsPolicy: "required_when_provider_publishes" | "not_contractual";
  dimensions: readonly DailyEdgeHealthDimension[];
}>;

const REQUIRED_DIMENSIONS = [
  "schedule",
  "statistics",
  "availability",
  "current_paired_price",
  "same_book_opening_current_trail",
  "public_or_sharp_splits",
  "model_release",
  "market_reader_trace",
  "projection_pick_coherence",
  "lock",
  "tracking",
] as const satisfies readonly DailyEdgeHealthDimension[];

/**
 * One certification vocabulary, with sport-specific source authority. This is
 * intentionally not one generic model or one market weight. A sport may use
 * its own qualified reader, but it cannot omit a health dimension silently.
 */
export const DAILY_EDGE_COMPLETE_HEALTH_CONTRACTS: Readonly<Record<DailyEdgeHealthSport, DailyEdgeCompleteHealthContract>> = {
  mlb: contract({
    sport: "mlb",
    expectedMarkets: ["moneyline", "total", "first_inning"],
    lineMarkets: ["moneyline", "total", "first_inning_total"],
    lineValueRequiredMarkets: ["total", "first_inning"],
    availabilityAuthorities: ["Playbook", "MLB official 40-man IL"],
    splitsPolicy: "required_when_provider_publishes",
  }),
  wnba: contract({
    sport: "wnba",
    expectedMarkets: ["moneyline", "total", "spread"],
    lineMarkets: ["moneyline", "total", "spread"],
    lineValueRequiredMarkets: ["total", "spread"],
    availabilityAuthorities: ["ESPN"],
    splitsPolicy: "required_when_provider_publishes",
  }),
  nba: contract({
    sport: "nba",
    expectedMarkets: ["moneyline", "total", "spread"],
    lineMarkets: ["moneyline", "total", "spread"],
    lineValueRequiredMarkets: ["total", "spread"],
    availabilityAuthorities: ["ESPN"],
    splitsPolicy: "required_when_provider_publishes",
  }),
  nfl: contract({
    sport: "nfl",
    expectedMarkets: ["moneyline", "spread", "total"],
    lineMarkets: ["moneyline", "spread", "total"],
    lineValueRequiredMarkets: ["spread", "total"],
    availabilityAuthorities: ["BALLDONTLIE player designations", "exact-game retained report"],
    splitsPolicy: "required_when_provider_publishes",
  }),
  cfb: contract({
    sport: "cfb",
    expectedMarkets: ["moneyline", "spread", "total"],
    lineMarkets: ["moneyline", "spread", "total"],
    lineValueRequiredMarkets: ["spread", "total"],
    availabilityAuthorities: ["Official conference report", "SportsDataIO national FBS injury wire", "exact-game retained report"],
    availabilityCredentialEnv: "SPORTSDATAIO_CFB_API_KEY",
    splitsPolicy: "required_when_provider_publishes",
  }),
  nhl: contract({
    sport: "nhl",
    expectedMarkets: ["moneyline", "total", "spread"],
    lineMarkets: ["moneyline", "total", "spread", "puckline"],
    lineValueRequiredMarkets: ["total", "puckline"],
    availabilityAuthorities: ["ESPN injuries", "ESPN starting goalie context"],
    splitsPolicy: "required_when_provider_publishes",
  }),
  soccer: contract({
    sport: "soccer",
    expectedMarkets: ["match_result", "total", "btts"],
    lineMarkets: ["match_result", "total", "btts", "double_chance"],
    lineValueRequiredMarkets: ["total"],
    availabilityAuthorities: ["BALLDONTLIE player injuries", "verified lineups"],
    splitsPolicy: "not_contractual",
  }),
};

function contract(args: {
  sport: DailyEdgeHealthSport;
  expectedMarkets: readonly string[];
  lineMarkets: readonly string[];
  lineValueRequiredMarkets: readonly string[];
  availabilityAuthorities: readonly string[];
  availabilityCredentialEnv?: string;
  splitsPolicy: DailyEdgeCompleteHealthContract["splitsPolicy"];
}): DailyEdgeCompleteHealthContract {
  return {
    ...args,
    lineValueRequiredMarkets: new Set(args.lineValueRequiredMarkets),
    dimensions: REQUIRED_DIMENSIONS,
  };
}

export type DailyEdgeHealthCertificationInput = Readonly<{
  sport: DailyEdgeHealthSport;
  activeGames: number;
  dimensionCoverage: Readonly<Partial<Record<DailyEdgeHealthDimension, number>>>;
  configuredEnvironment?: Readonly<Record<string, boolean>>;
}>;

export type DailyEdgeHealthCertification = Readonly<{
  release: typeof DAILY_EDGE_COMPLETE_HEALTH_CONTRACT_RELEASE;
  sport: DailyEdgeHealthSport;
  status: "green" | "red" | "inactive";
  failedDimensions: readonly DailyEdgeHealthDimension[];
  missingCredentials: readonly string[];
}>;

export function certifyDailyEdgeCompleteHealth(input: DailyEdgeHealthCertificationInput): DailyEdgeHealthCertification {
  const contract = DAILY_EDGE_COMPLETE_HEALTH_CONTRACTS[input.sport];
  if (input.activeGames === 0) {
    return { release: DAILY_EDGE_COMPLETE_HEALTH_CONTRACT_RELEASE, sport: input.sport, status: "inactive", failedDimensions: [], missingCredentials: [] };
  }
  const missingCredentials = contract.availabilityCredentialEnv && !input.configuredEnvironment?.[contract.availabilityCredentialEnv]
    ? [contract.availabilityCredentialEnv]
    : [];
  const failedDimensions = contract.dimensions.filter((dimension) => {
    if (dimension === "public_or_sharp_splits" && contract.splitsPolicy === "not_contractual") return false;
    return (input.dimensionCoverage[dimension] ?? 0) < input.activeGames;
  });
  return {
    release: DAILY_EDGE_COMPLETE_HEALTH_CONTRACT_RELEASE,
    sport: input.sport,
    status: failedDimensions.length === 0 && missingCredentials.length === 0 ? "green" : "red",
    failedDimensions,
    missingCredentials,
  };
}
