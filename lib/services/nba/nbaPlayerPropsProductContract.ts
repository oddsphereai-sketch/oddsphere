import type { NbaPlayerPropMarket, NbaPlayerPropSide } from "./nbaPlayerPropsContract";
import type { NbaPlayerPropsReaderMetric } from "./nbaPlayerPropsReaderContract";

export const NBA_PLAYER_PROPS_PRODUCT_CANDIDATE_RELEASE =
  "nba_player_props_product_candidate_2026_10_22_r6_active_role_integrity" as const;
export const NBA_PLAYER_PROPS_MEMBER_SNAPSHOT_CANDIDATE_RELEASE =
  "nba_player_props_member_snapshot_candidate_2026_10_22_r6_active_role_integrity_disabled" as const;
export const NBA_PLAYER_PROPS_LOCK_CANDIDATE_RELEASE =
  "nba_player_props_lock_candidate_2026_10_21_r1_immutable" as const;

export type NbaPlayerPropsMemberGrade = "Best Angle" | "Lean" | "Watchlist" | "No Play";

export type NbaPlayerPropsMemberGame = Readonly<{
  gameId: string;
  scheduledStart: string;
  homeTeam: string;
  awayTeam: string;
}>;

export type NbaPlayerPropsPricePoint = Readonly<{
  sportsbook: string;
  side: Extract<NbaPlayerPropSide, "over" | "under">;
  line: number;
  americanPrice: number;
  observedAt: string;
}>;

export type NbaPlayerPropsMemberDecision = Readonly<{
  decisionKey: string;
  gameId: string;
  scheduledStart: string;
  homeTeam: string;
  awayTeam: string;
  playerId: string;
  playerName: string;
  team: string;
  opponent: string;
  market: NbaPlayerPropMarket;
  line: number;
  projection: number;
  independentProjection: number;
  independentProbability?: number;
  modelRelease?: string;
  calibrationRelease?: string;
  decisionRelease?: string;
  side: Extract<NbaPlayerPropSide, "over" | "under">;
  probability: number;
  grade: NbaPlayerPropsMemberGrade;
  sportsbook: string;
  americanPrice: number;
  expectedValue: number;
  targetExcludedProbability: number;
  targetExcludedBooks: number;
  targetExcludedReferenceBooks: number;
  marketEvidenceMode: "target_excluded_arbitration" | "candidate_projection";
  gradePolicySource:
    | "points_ungated_ranked"
    | "assists_role_stable_ranked"
    | "pra_relative_best"
    | "universal_market_relative_lean"
    | "combo_market_relative_lean"
    | "forward_only_market_relative_lean"
    | "forecast_only";
  role: readonly NbaPlayerPropsReaderMetric[];
  production: readonly NbaPlayerPropsReaderMetric[];
  matchup: readonly NbaPlayerPropsReaderMetric[];
  priceLadder: readonly NbaPlayerPropsPricePoint[];
  movement: Readonly<{
    sportsbook: string;
    openingLine: number;
    priorLine: number | null;
    currentLine: number;
    openingPrice: number;
    priorPrice: number | null;
    currentPrice: number;
  }> | null;
  evaluatedAt: string;
  lockedAt: string | null;
}>;

export type NbaPlayerPropsMemberSnapshot = Readonly<{
  productRelease: typeof NBA_PLAYER_PROPS_PRODUCT_CANDIDATE_RELEASE;
  snapshotRelease: typeof NBA_PLAYER_PROPS_MEMBER_SNAPSHOT_CANDIDATE_RELEASE;
  lockRelease: typeof NBA_PLAYER_PROPS_LOCK_CANDIDATE_RELEASE;
  mode: "private_historical_visual_qa_only" | "private_forward_candidate";
  publicEnabled: false;
  generatedAt: string;
  slateDate: string;
  games: readonly NbaPlayerPropsMemberGame[];
  decisions: readonly NbaPlayerPropsMemberDecision[];
  diagnostics: Readonly<{
    inputRows: number;
    canonicalMarkets: number;
    actionable: number;
    bestAngles: number;
    leans: number;
    watchlists: number;
    noPlays: number;
    sportsbooks: readonly string[];
  }>;
}>;

export function buildNbaPlayerPropsMemberSnapshot(args: {
  mode: NbaPlayerPropsMemberSnapshot["mode"];
  generatedAt: string;
  slateDate: string;
  games: readonly NbaPlayerPropsMemberGame[];
  decisions: readonly NbaPlayerPropsMemberDecision[];
  inputRows: number;
}): NbaPlayerPropsMemberSnapshot {
  timestamp(args.generatedAt, "generatedAt");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.slateDate)) throw new Error("NBA props snapshot requires an ET slate date.");
  const gameIds = new Set<string>();
  for (const game of args.games) {
    if (gameIds.has(game.gameId)) throw new Error(`NBA props snapshot repeats game ${game.gameId}.`);
    gameIds.add(game.gameId);
    timestamp(game.scheduledStart, "scheduledStart");
  }
  const decisionKeys = new Set<string>();
  const canonicalScopes = new Set<string>();
  for (const decision of args.decisions) {
    if (!gameIds.has(decision.gameId)) throw new Error(`NBA props decision references missing game ${decision.gameId}.`);
    if (decisionKeys.has(decision.decisionKey)) throw new Error(`NBA props repeats decision ${decision.decisionKey}.`);
    decisionKeys.add(decision.decisionKey);
    const canonicalScope = [decision.gameId, decision.playerId, decision.market].join("|");
    if (canonicalScopes.has(canonicalScope)) throw new Error(`NBA props repeats canonical market ${canonicalScope}.`);
    canonicalScopes.add(canonicalScope);
    if (!Number.isFinite(decision.projection) || !Number.isFinite(decision.line)
      || !Number.isFinite(decision.probability) || decision.probability < 0 || decision.probability > 1) {
      throw new Error(`NBA props decision ${decision.decisionKey} has invalid forecast values.`);
    }
    const expectedSide = decision.projection > decision.line ? "over" : "under";
    if (decision.side !== expectedSide) throw new Error(`NBA props decision ${decision.decisionKey} contradicts its projection.`);
    if (!Number.isInteger(decision.americanPrice) || decision.americanPrice === 0) {
      throw new Error(`NBA props decision ${decision.decisionKey} has an invalid price.`);
    }
    timestamp(decision.evaluatedAt, "evaluatedAt");
    if (decision.lockedAt !== null) timestamp(decision.lockedAt, "lockedAt");
    if (args.mode === "private_forward_candidate" && (
      !Number.isFinite(decision.independentProbability)
      || !decision.modelRelease || !decision.calibrationRelease || !decision.decisionRelease
    )) throw new Error(`NBA props forward decision ${decision.decisionKey} is missing frozen tracking provenance.`);
  }
  const ordered = [...args.decisions].sort((left, right) => Date.parse(left.scheduledStart) - Date.parse(right.scheduledStart)
    || gradeRank(left.grade) - gradeRank(right.grade)
    || left.playerName.localeCompare(right.playerName)
    || left.market.localeCompare(right.market));
  return {
    productRelease: NBA_PLAYER_PROPS_PRODUCT_CANDIDATE_RELEASE,
    snapshotRelease: NBA_PLAYER_PROPS_MEMBER_SNAPSHOT_CANDIDATE_RELEASE,
    lockRelease: NBA_PLAYER_PROPS_LOCK_CANDIDATE_RELEASE,
    mode: args.mode,
    publicEnabled: false,
    generatedAt: new Date(Date.parse(args.generatedAt)).toISOString(),
    slateDate: args.slateDate,
    games: [...args.games].sort((left, right) => Date.parse(left.scheduledStart) - Date.parse(right.scheduledStart)),
    decisions: ordered,
    diagnostics: {
      inputRows: args.inputRows,
      canonicalMarkets: canonicalScopes.size,
      actionable: ordered.filter((row) => row.grade === "Best Angle" || row.grade === "Lean").length,
      bestAngles: ordered.filter((row) => row.grade === "Best Angle").length,
      leans: ordered.filter((row) => row.grade === "Lean").length,
      watchlists: ordered.filter((row) => row.grade === "Watchlist").length,
      noPlays: ordered.filter((row) => row.grade === "No Play").length,
      sportsbooks: [...new Set(ordered.map((row) => row.sportsbook))].sort(),
    },
  };
}

function gradeRank(grade: NbaPlayerPropsMemberGrade): number {
  return grade === "Best Angle" ? 0 : grade === "Lean" ? 1 : grade === "Watchlist" ? 2 : 3;
}

function timestamp(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`NBA props ${field} is invalid.`);
}
