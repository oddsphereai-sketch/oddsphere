/**
 * Local-only contract for the NFL and NCAAF pregame model program.
 *
 * Nothing in this directory is connected to a production writer, reader,
 * database table, cron route, play grade, stake, or official tracking lane.
 */

export const FOOTBALL_RESEARCH_SCHEMA_RELEASE = "football_pregame_research_schema_2026_08_19_r2" as const;
export const NFL_SHADOW_MODEL_RELEASE = "nfl_pregame_real_local_current_refit_2026_08_19_r3" as const;
export const NCAAF_SHADOW_MODEL_RELEASE = "ncaaf_pregame_shadow_unfit_2026_08_19_r1" as const;

export type FootballLeague = "nfl" | "ncaaf";
export type FootballSeasonPhase = "preseason" | "regular" | "postseason" | "bowl";
export type FootballMarket = "moneyline" | "spread" | "total";
export type FootballSide = "home" | "away" | "over" | "under";

export type FootballReleaseStamp = {
  researchSchemaRelease: typeof FOOTBALL_RESEARCH_SCHEMA_RELEASE;
  modelRelease: typeof NFL_SHADOW_MODEL_RELEASE | typeof NCAAF_SHADOW_MODEL_RELEASE;
  featureRelease: string;
  calibrationRelease: string;
  decisionRelease: string;
};

export type FootballGameIdentity = {
  league: FootballLeague;
  providerGameId: string;
  season: number;
  week: number;
  seasonPhase: FootballSeasonPhase;
  scheduledStart: string;
  homeTeamId: string;
  awayTeamId: string;
  neutralSite: boolean;
  venue: string | null;
};

export type FeatureValue = {
  value: number | null;
  observedAt: string | null;
  source: string;
  availability: "available" | "missing" | "stale" | "not_applicable";
};

export type FootballIndependentFeatures = {
  offense: {
    homeOpponentAdjustedEfficiency: FeatureValue;
    awayOpponentAdjustedEfficiency: FeatureValue;
    homeEarlyDownPassEfficiency: FeatureValue;
    awayEarlyDownPassEfficiency: FeatureValue;
    homeExplosiveness: FeatureValue;
    awayExplosiveness: FeatureValue;
    homeFinishingDrives: FeatureValue;
    awayFinishingDrives: FeatureValue;
  };
  defense: {
    homeOpponentAdjustedEfficiencyAllowed: FeatureValue;
    awayOpponentAdjustedEfficiencyAllowed: FeatureValue;
    homePressureOrHavoc: FeatureValue;
    awayPressureOrHavoc: FeatureValue;
    homeExplosivenessAllowed: FeatureValue;
    awayExplosivenessAllowed: FeatureValue;
  };
  personnel: {
    homeQuarterbackAdjustmentPoints: FeatureValue;
    awayQuarterbackAdjustmentPoints: FeatureValue;
    homeNonQuarterbackInjuryAdjustmentPoints: FeatureValue;
    awayNonQuarterbackInjuryAdjustmentPoints: FeatureValue;
    homeContinuity: FeatureValue;
    awayContinuity: FeatureValue;
  };
  situation: {
    homeRestDays: FeatureValue;
    awayRestDays: FeatureValue;
    travelDistanceMiles: FeatureValue;
    timezoneChangeHours: FeatureValue;
    temperatureF: FeatureValue;
    sustainedWindMph: FeatureValue;
    precipitationProbability: FeatureValue;
    altitudeFeet: FeatureValue;
  };
  collegeOnly: {
    homeRecruitingTalent: FeatureValue;
    awayRecruitingTalent: FeatureValue;
    homeTransferContinuity: FeatureValue;
    awayTransferContinuity: FeatureValue;
    homeConferenceStrength: FeatureValue;
    awayConferenceStrength: FeatureValue;
  };
};

export type IndependentFootballProjection = {
  generatedAt: string;
  trainedThrough: string;
  projectedHomeScore: number;
  projectedAwayScore: number;
  projectedHomeMargin: number;
  projectedTotal: number;
  homeWinProbability: number;
  marginStdDev: number;
  totalStdDev: number;
  marketIndependent: true;
  featureWarnings: string[];
};

export type FootballMarketObservation = {
  provider: string;
  sourceKey: string;
  sportsbook: string | null;
  sourceType: "sportsbook" | "consensus" | "exchange";
  providerEventId: string;
  market: FootballMarket;
  side: FootballSide;
  lineValue: number | null;
  americanPrice: number;
  observedAt: string;
  fetchedAt: string;
  isOpening: boolean;
  isClosing: boolean;
};

export type FootballSplitObservation = {
  provider: string;
  sourceKey: string;
  sourceType: "multi_book_consensus" | "named_book" | "unknown";
  sportsbook: string | null;
  booksUsed: number | null;
  providerEventId: string;
  market: FootballMarket;
  side: FootballSide;
  lineValue: number | null;
  ticketsPct: number | null;
  moneyPct: number | null;
  observedAt: string;
  sourceUpdatedAt: string | null;
  fetchedAt: string;
};

export type FootballShadowForecast = {
  status: "shadow" | "hold";
  identity: FootballGameIdentity;
  releases: FootballReleaseStamp;
  independent: IndependentFootballProjection | null;
  calibratedProbabilities: {
    homeWin: number | null;
    homeCover: number | null;
    over: number | null;
  };
  selectedSide: Partial<Record<FootballMarket, FootballSide>>;
  dataHealthFindings: string[];
  /** Always false until a release passes the documented launch gates. */
  actionable: false;
};

export function shadowModelReleaseFor(league: FootballLeague) {
  return league === "nfl" ? NFL_SHADOW_MODEL_RELEASE : NCAAF_SHADOW_MODEL_RELEASE;
}
