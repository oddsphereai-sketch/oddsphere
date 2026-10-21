import { NBA_PLAYER_PROPS_FOUNDATION_MARKETS } from "./nbaPlayerPropsContract";

export const NBA_PLAYER_PROPS_SOURCE_POLICY_RELEASE =
  "nba_player_props_source_policy_2026_10_21_r2_private_forward_ready" as const;

export const NBA_PLAYER_PROPS_SOURCE_POLICY = {
  liveBoard: {
    primary: "balldontlie",
    secondaries: ["the_odds_api", "sharpapi"],
    playbookRole: "context_only_until_documented_player_prop_contract",
  },
  outcomeAndAvailability: {
    officialStats: "balldontlie",
    activePlayers: "balldontlie",
    injuries: "balldontlie",
  },
  historical: {
    playerResults: "balldontlie",
    openingProps: "balldontlie",
    pointInTimeOddsReplay: "the_odds_api",
  },
  memberFetches: false,
  privateCandidateWriterAvailable: true,
  productionWriterEnabled: false,
  routeEnabled: false,
  navigationEnabled: false,
} as const;

export type NbaPlayerPropsCadenceStage = "far" | "game_day" | "t_minus_180" | "t_minus_60" | "t_minus_15" | "locked";

export function nbaPlayerPropsCadenceStage(args: {
  now: string;
  scheduledStart: string;
  slateDate: string;
}): NbaPlayerPropsCadenceStage {
  const now = Date.parse(args.now);
  const start = Date.parse(args.scheduledStart);
  if (!Number.isFinite(now) || !Number.isFinite(start)) throw new Error("NBA props cadence requires valid timestamps.");
  if (now >= start - 60 * 60_000) return now >= start - 15 * 60_000 ? (now >= start ? "locked" : "t_minus_15") : "t_minus_60";
  if (now >= start - 180 * 60_000) return "t_minus_180";
  const currentEt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  return currentEt === args.slateDate ? "game_day" : "far";
}

/**
 * The Odds API bills current event odds at one credit per unique market
 * returned per region-equivalent bookmaker group. Historical event odds cost
 * ten credits on that same basis. This upper-bound planner assumes every
 * requested market is returned and deliberately does not spend credits.
 */
export function planNbaPlayerPropsTheOddsApiCredits(args: {
  events: number;
  marketsPerEvent?: number;
  regionEquivalentBookmakerGroups?: number;
  currentSweepsPerEvent?: number;
  historicalSnapshotsPerEvent?: number;
}): {
  currentCredits: number;
  historicalCredits: number;
  totalCredits: number;
} {
  const events = boundedInteger(args.events, "events", 0, 20);
  const markets = boundedInteger(args.marketsPerEvent ?? NBA_PLAYER_PROPS_FOUNDATION_MARKETS.length, "marketsPerEvent", 0, 32);
  const regions = boundedInteger(args.regionEquivalentBookmakerGroups ?? 1, "regionEquivalentBookmakerGroups", 1, 5);
  const currentSweeps = boundedInteger(args.currentSweepsPerEvent ?? 0, "currentSweepsPerEvent", 0, 24);
  const historicalSnapshots = boundedInteger(args.historicalSnapshotsPerEvent ?? 0, "historicalSnapshotsPerEvent", 0, 24);
  const currentCredits = events * markets * regions * currentSweeps;
  const historicalCredits = events * markets * regions * historicalSnapshots * 10;
  return { currentCredits, historicalCredits, totalCredits: currentCredits + historicalCredits };
}

export function recommendedNbaPlayerPropsRequestPlan(args: {
  gameCount: number;
  missingOrReferenceGameCount: number;
  includeBdlOpenings: boolean;
  theOddsApiCheckpointsPerGapGame?: number;
}): {
  ballDontLieRequests: number;
  theOddsApiMaxCredits: number;
  explanation: string[];
} {
  const gameCount = boundedInteger(args.gameCount, "gameCount", 0, 20);
  const gaps = boundedInteger(args.missingOrReferenceGameCount, "missingOrReferenceGameCount", 0, gameCount);
  const checkpoints = boundedInteger(args.theOddsApiCheckpointsPerGapGame ?? 1, "theOddsApiCheckpointsPerGapGame", 0, 3);
  const ballDontLieRequests = 1 + gameCount + (args.includeBdlOpenings ? gameCount : 0);
  const theOddsApiMaxCredits = planNbaPlayerPropsTheOddsApiCredits({
    events: gaps,
    currentSweepsPerEvent: checkpoints,
  }).totalCredits;
  return {
    ballDontLieRequests,
    theOddsApiMaxCredits,
    explanation: [
      "One BALLDONTLIE schedule request plus one complete prop response per game.",
      args.includeBdlOpenings ? "One BALLDONTLIE opening-prop request per game." : "Opening props are read from retained storage, not refetched.",
      "The Odds API is limited to gap/reference games and never fetched from a member request.",
    ],
  };
}

function boundedInteger(value: number, field: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`NBA props ${field} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}
