import type { Sport } from "../types/domain/Sport";
import type { MarketIntelligenceMarketType } from "../types/domain/MarketIntelligenceV2";
import { publicSplitsCapability } from "./publicSplitsCapability";

export type DailyEdgeLeague = "MLB" | "WNBA" | "NBA" | "NFL" | "NCAAF" | "NCAAB" | "NHL";

export type MarketIdentity = {
  canonical: MarketIntelligenceMarketType;
  label: "moneyline" | "spread" | "run_line" | "puck_line" | "total";
  orientation: "home_away" | "over_under";
  preserveExactLine: boolean;
  keyNumbers: readonly number[];
};

export type EvidenceFamilyReadiness = {
  ready: boolean;
  blocker: string | null;
};

export type MarketIntelligenceSportConfig = {
  sport: Sport;
  league: DailyEdgeLeague;
  playbookLeague: "mlb" | "wnba" | "nba" | "nhl" | "nfl" | "ncaaf" | "ncaab";
  dailyEdgeSupported: boolean;
  collectionEnabledByDefault: boolean;
  markets: readonly MarketIdentity[];
  providerCoverage: {
    playbook: EvidenceFamilyReadiness;
    sharpApiPrices: EvidenceFamilyReadiness;
    betMgmPublicTickets: EvidenceFamilyReadiness;
    dkCircaSplits: EvidenceFamilyReadiness;
    sharpBooks: EvidenceFamilyReadiness;
    retailBooks: EvidenceFamilyReadiness;
  };
  validation: {
    historicalCoverage: EvidenceFamilyReadiness;
    resolver: EvidenceFamilyReadiness;
    model: EvidenceFamilyReadiness;
    ui: EvidenceFamilyReadiness;
  };
};

const MONEYLINE: MarketIdentity = {
  canonical: "moneyline",
  label: "moneyline",
  orientation: "home_away",
  preserveExactLine: true,
  keyNumbers: [],
};

const TOTAL: MarketIdentity = {
  canonical: "total",
  label: "total",
  orientation: "over_under",
  preserveExactLine: true,
  keyNumbers: [],
};

const SPREAD: MarketIdentity = {
  canonical: "spread",
  label: "spread",
  orientation: "home_away",
  preserveExactLine: true,
  keyNumbers: [],
};

const FOOTBALL_SPREAD: MarketIdentity = {
  ...SPREAD,
  keyNumbers: [3, 7, 10, 14],
};

const MLB_RUN_LINE: MarketIdentity = {
  ...SPREAD,
  label: "run_line",
};

const NHL_PUCK_LINE: MarketIdentity = {
  ...SPREAD,
  label: "puck_line",
};

function ready(): EvidenceFamilyReadiness {
  return { ready: true, blocker: null };
}

function blocked(blocker: string): EvidenceFamilyReadiness {
  return { ready: false, blocker };
}

export const DAILY_EDGE_MARKET_INTELLIGENCE_SPORTS: readonly Sport[] = [
  "mlb",
  "wnba",
  "nba",
  "nfl",
  "cfb",
  "cbb",
  "nhl",
];

export const MARKET_INTELLIGENCE_SPORT_CONFIG: Record<DailyEdgeLeague, MarketIntelligenceSportConfig> = {
  MLB: {
    sport: "mlb",
    league: "MLB",
    playbookLeague: "mlb",
    dailyEdgeSupported: true,
    collectionEnabledByDefault: true,
    markets: [MONEYLINE, MLB_RUN_LINE, TOTAL],
    providerCoverage: {
      playbook: ready(),
      sharpApiPrices: ready(),
      betMgmPublicTickets: blocked("SharpAPI currently returns zero MLB BetMGM public-ticket rows; adapter is ready when rows appear."),
      dkCircaSplits: blocked("SharpAPI current /splits endpoint returns zero MLB sportsbook rows; /splits/history returns genuine DraftKings/Circa rows and is collected when event IDs are known."),
      sharpBooks: ready(),
      retailBooks: ready(),
    },
    validation: {
      historicalCoverage: blocked("Production history collection began 2026-06-25; needs chronological sample before model promotion."),
      resolver: ready(),
      model: blocked("Market-aware probability/grade model must pass MLB walk-forward comparison before enabling."),
      ui: blocked("Member UI flag remains disabled until historical comparison passes."),
    },
  },
  WNBA: {
    sport: "wnba",
    league: "WNBA",
    playbookLeague: "wnba",
    dailyEdgeSupported: true,
    collectionEnabledByDefault: false,
    markets: [MONEYLINE, SPREAD, TOTAL],
    providerCoverage: {
      playbook: ready(),
      sharpApiPrices: blocked("SharpAPI WNBA price coverage has not been production-verified in v2 collection."),
      betMgmPublicTickets: blocked("BetMGM public-ticket coverage not verified for WNBA v2 observations."),
      dkCircaSplits: blocked("No verified DK/Circa WNBA split rows."),
      sharpBooks: blocked("Sharp-book coverage not verified for WNBA v2 price observations."),
      retailBooks: blocked("Retail-book coverage not verified for WNBA v2 price observations."),
    },
    validation: {
      historicalCoverage: blocked("Needs WNBA v2 scheduled collection/backfill."),
      resolver: ready(),
      model: blocked("Needs WNBA chronological validation; do not reuse MLB coefficients."),
      ui: blocked("Daily Edge WNBA DTO path is not promoted."),
    },
  },
  NBA: {
    sport: "nba",
    league: "NBA",
    playbookLeague: "nba",
    dailyEdgeSupported: true,
    collectionEnabledByDefault: false,
    markets: [MONEYLINE, SPREAD, TOTAL],
    providerCoverage: {
      playbook: blocked("Playbook NBA coverage listed but needs event-matching and market-coverage audit."),
      sharpApiPrices: blocked("SharpAPI NBA v2 price coverage not verified in production collection."),
      betMgmPublicTickets: blocked("BetMGM public-ticket coverage not verified for NBA v2 observations."),
      dkCircaSplits: blocked("No verified DK/Circa NBA split rows."),
      sharpBooks: blocked("Sharp-book coverage not verified for NBA v2 price observations."),
      retailBooks: blocked("Retail-book coverage not verified for NBA v2 price observations."),
    },
    validation: {
      historicalCoverage: blocked("Needs NBA v2 scheduled collection/backfill."),
      resolver: ready(),
      model: blocked("Needs NBA chronological validation; do not reuse MLB coefficients."),
      ui: blocked("NBA has an adapted Daily Edge path, but unified Market Read DTO is not promoted."),
    },
  },
  NFL: {
    sport: "nfl",
    league: "NFL",
    playbookLeague: "nfl",
    dailyEdgeSupported: true,
    collectionEnabledByDefault: false,
    markets: [MONEYLINE, FOOTBALL_SPREAD, TOTAL],
    providerCoverage: {
      playbook: blocked("Playbook NFL coverage listed but needs event-matching and market-coverage audit."),
      sharpApiPrices: blocked("SharpAPI NFL v2 price coverage not verified in production collection."),
      betMgmPublicTickets: blocked("BetMGM public-ticket coverage not verified for NFL v2 observations."),
      dkCircaSplits: blocked("No verified DK/Circa NFL split rows."),
      sharpBooks: blocked("Sharp-book coverage not verified for NFL v2 price observations."),
      retailBooks: blocked("Retail-book coverage not verified for NFL v2 price observations."),
    },
    validation: {
      historicalCoverage: blocked("Needs NFL v2 scheduled collection/backfill."),
      resolver: blocked("Resolver must add football key-number calibration before promotion."),
      model: blocked("Needs NFL chronological validation; do not reuse MLB coefficients."),
      ui: blocked("Daily Edge NFL DTO path is not promoted."),
    },
  },
  NCAAF: {
    sport: "cfb",
    league: "NCAAF",
    playbookLeague: "ncaaf",
    dailyEdgeSupported: true,
    collectionEnabledByDefault: false,
    markets: [MONEYLINE, FOOTBALL_SPREAD, TOTAL],
    providerCoverage: {
      playbook: blocked("Playbook NCAAF coverage listed but needs event-matching and market-coverage audit."),
      sharpApiPrices: blocked("SharpAPI NCAAF v2 price coverage not verified in production collection."),
      betMgmPublicTickets: blocked("BetMGM public-ticket coverage not verified for NCAAF v2 observations."),
      dkCircaSplits: blocked("No verified DK/Circa NCAAF split rows."),
      sharpBooks: blocked("Sharp-book coverage not verified for NCAAF v2 price observations."),
      retailBooks: blocked("Retail-book coverage not verified for NCAAF v2 price observations."),
    },
    validation: {
      historicalCoverage: blocked("Needs NCAAF v2 scheduled collection/backfill."),
      resolver: blocked("Resolver must add college-football liquidity and key-number calibration before promotion."),
      model: blocked("Needs NCAAF chronological validation; do not reuse MLB coefficients."),
      ui: blocked("Daily Edge NCAAF DTO path is not promoted."),
    },
  },
  NCAAB: {
    sport: "cbb",
    league: "NCAAB",
    playbookLeague: "ncaab",
    dailyEdgeSupported: true,
    collectionEnabledByDefault: false,
    markets: [MONEYLINE, SPREAD, TOTAL],
    providerCoverage: {
      playbook: blocked("Playbook NCAAB coverage listed but needs event-matching and market-coverage audit."),
      sharpApiPrices: blocked("SharpAPI NCAAB v2 price coverage not verified in production collection."),
      betMgmPublicTickets: blocked("BetMGM public-ticket coverage not verified for NCAAB v2 observations."),
      dkCircaSplits: blocked("No verified DK/Circa NCAAB split rows."),
      sharpBooks: blocked("Sharp-book coverage not verified for NCAAB v2 price observations."),
      retailBooks: blocked("Retail-book coverage not verified for NCAAB v2 price observations."),
    },
    validation: {
      historicalCoverage: blocked("Needs NCAAB v2 scheduled collection/backfill."),
      resolver: blocked("Resolver must add college-basketball liquidity calibration before promotion."),
      model: blocked("Needs NCAAB chronological validation; do not reuse MLB coefficients."),
      ui: blocked("Daily Edge NCAAB DTO path is not promoted."),
    },
  },
  NHL: {
    sport: "nhl",
    league: "NHL",
    playbookLeague: "nhl",
    dailyEdgeSupported: true,
    collectionEnabledByDefault: false,
    markets: [MONEYLINE, NHL_PUCK_LINE, TOTAL],
    providerCoverage: {
      playbook: blocked("Playbook NHL coverage listed but needs event-matching and market-coverage audit."),
      sharpApiPrices: blocked("SharpAPI NHL v2 price coverage not verified in production collection."),
      betMgmPublicTickets: blocked("BetMGM public-ticket coverage not verified for NHL v2 observations."),
      dkCircaSplits: blocked("No verified DK/Circa NHL split rows."),
      sharpBooks: blocked("Sharp-book coverage not verified for NHL v2 price observations."),
      retailBooks: blocked("Retail-book coverage not verified for NHL v2 price observations."),
    },
    validation: {
      historicalCoverage: blocked("Needs NHL v2 scheduled collection/backfill."),
      resolver: blocked("Resolver must preserve NHL moneyline/puck-line/total identity before promotion."),
      model: blocked("Needs NHL chronological validation; do not reuse MLB coefficients."),
      ui: blocked("Daily Edge NHL DTO path is not promoted."),
    },
  },
};

export function leagueForSport(sport: Sport): DailyEdgeLeague | null {
  switch (sport) {
    case "mlb": return "MLB";
    case "wnba": return "WNBA";
    case "nba": return "NBA";
    case "nfl": return "NFL";
    case "cfb": return "NCAAF";
    case "cbb": return "NCAAB";
    case "nhl": return "NHL";
    default: return null;
  }
}

export function marketIntelligenceSportConfig(sport: Sport): MarketIntelligenceSportConfig | null {
  const league = leagueForSport(sport);
  return league ? MARKET_INTELLIGENCE_SPORT_CONFIG[league] : null;
}

export function sportSupportsMarketIntelligenceCollection(sport: Sport): boolean {
  const config = marketIntelligenceSportConfig(sport);
  if (!config) return false;
  const splits = publicSplitsCapability(sport);
  return config.dailyEdgeSupported && (splits.playbookSplits || config.providerCoverage.sharpApiPrices.ready);
}

export function readinessCell(state: EvidenceFamilyReadiness): string {
  return state.ready ? "Ready" : `Not ready: ${state.blocker}`;
}
