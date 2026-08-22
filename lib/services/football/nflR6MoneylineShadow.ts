import type { DailyEdgeGameAvailability } from "@/lib/services/dailyEdge/gameAvailability";
import artifactJson from "./modelArtifacts/nflR6MoneylineShadow.json";
import type { NflPreviewBookOdds, NflPreviewGame } from "./balldontlieNflPreviewSlate";
import type {
  NflForwardEvidenceStage,
  NflForwardOperationalOpening,
  NflForwardTeamDepthSnapshot,
} from "./nflForwardEvidence";
import {
  NFL_T60_MAX_CAPTURE_LAG_MINUTES,
  NFL_T60_TARGET_MINUTES,
  type NflRegularEvaluatedQuote,
} from "./nflRegularDecisionEvidence";

export const NFL_R6_SHADOW_DECISION_SCHEMA_RELEASE =
  "nfl_shadow_exact_price_decision_tuple_2026_08_22_r1" as const;
export const NFL_R6_RUNTIME_ARTIFACT_RELEASE =
  "nfl_r6_moneyline_runtime_artifact_2026_08_22_r1" as const;
export const NFL_R6_MONEYLINE_MODEL_RELEASE =
  "nfl_market_led_moneyline_shadow_2026_08_22_r6" as const;
export const NFL_R6_MONEYLINE_CALIBRATION_RELEASE =
  "nfl_market_led_price_calibration_shadow_2026_08_22_r6" as const;
export const NFL_R6_MONEYLINE_DECISION_RELEASE =
  "nfl_market_led_moneyline_lean_shadow_2026_08_22_r6" as const;
export const NFL_R6_SOURCE_POINT_MODEL_RELEASE =
  "nfl_pregame_market_residual_shadow_2026_08_21_r2" as const;

export type NflR6ShadowDecisionStage =
  | "opening_evaluation"
  | "unlocked"
  | "t60_locked"
  | "t60_held";

export type NflR6ShadowMoneylineDecision = {
  schemaRelease: typeof NFL_R6_SHADOW_DECISION_SCHEMA_RELEASE;
  decisionKind: "shadow_exact_price_bet";
  shadowOnly: true;
  publicationEligible: false;
  trackingEligible: false;
  providerGameId: string;
  market: "moneyline";
  grade: "Lean" | "Held";
  side: "home" | "away" | null;
  team: string | null;
  modelProbability: number | null;
  otherBooksConsensusFairProbability: number | null;
  targetBookFairProbability: number | null;
  otherBookCount: number;
  evaluatedQuote: NflRegularEvaluatedQuote | null;
  expectedValuePerUnit: number | null;
  edgePercentagePoints: number | null;
  decisionStage: NflR6ShadowDecisionStage;
  evaluatedAt: string;
  gameStartsAt: string;
  lockedAt: string | null;
  reason: "uncapped_market_led_exact_price_candidate" | "exact_price_does_not_clear_candidate_thresholds" | "shadow_evaluation_held";
  footballProjection: {
    openingHomeMargin: number;
    independentCorrection: number;
    projectedHomeMargin: number;
  } | null;
  quarterbackContext: {
    away: { name: string | null; historyMatched: boolean; status: "confirmed" | "projected" | "unknown" };
    home: { name: string | null; historyMatched: boolean; status: "confirmed" | "projected" | "unknown" };
  };
  health: {
    blockingReasons: string[];
    quarterbackReasons: string[];
    contextReasons: string[];
  };
  runtimeArtifactRelease: typeof NFL_R6_RUNTIME_ARTIFACT_RELEASE;
  modelRelease: typeof NFL_R6_MONEYLINE_MODEL_RELEASE;
  calibrationRelease: typeof NFL_R6_MONEYLINE_CALIBRATION_RELEASE;
  decisionRelease: typeof NFL_R6_MONEYLINE_DECISION_RELEASE;
  sourcePointModelRelease: typeof NFL_R6_SOURCE_POINT_MODEL_RELEASE;
};

type TreeNode = {
  value: number;
  featureIndex: number;
  threshold: number;
  missingGoToLeft: boolean;
  left: number;
  right: number;
  isLeaf: boolean;
};

type RuntimeArtifact = {
  artifactRelease: typeof NFL_R6_RUNTIME_ARTIFACT_RELEASE;
  shadowOnly: true;
  modelRelease: typeof NFL_R6_MONEYLINE_MODEL_RELEASE;
  calibrationRelease: typeof NFL_R6_MONEYLINE_CALIBRATION_RELEASE;
  decisionRelease: typeof NFL_R6_MONEYLINE_DECISION_RELEASE;
  sourcePointModelRelease: typeof NFL_R6_SOURCE_POINT_MODEL_RELEASE;
  policy: {
    minimumExpectedValue: number;
    minimumEdgePercentagePoints: number;
    minimumAmericanPrice: number;
    maximumAmericanPrice: number;
    maximumActionsPerWeek: null;
    bestAngleAuthorized: false;
  };
  marginModel: {
    featureNames: string[];
    imputerMedians: number[];
    baseline: number;
    trees: Array<Array<{ nodes: TreeNode[] }>>;
    weight: number;
    correctionCap: number;
  };
  probabilityModel: {
    featureNames: string[];
    means: number[];
    scales: number[];
    coefficients: number[];
    intercept: number;
  };
  teamStates: Record<string, TeamState>;
  quarterbackStates: Record<string, QuarterbackState>;
  quarterbackNameToId: Record<string, string>;
  playerNameToPfr: Record<string, string>;
  adjustedPlayerRoles2026Week1: Record<string, PlayerRole>;
  parityCases: {
    margin: Array<{ features: number[]; expected: number }>;
    probability: Array<{ consensusHome: number; projectedHomeMargin: number; expected: number }>;
  };
};

type TeamState = {
  offFast: Record<string, number>;
  offSlow: Record<string, number>;
  defFast: Record<string, number>;
  defSlow: Record<string, number>;
  offAdjusted: Record<string, number>;
  defAdjusted: Record<string, number>;
  elo: number;
  lastQbId: string | null;
};

type QuarterbackState = {
  epa: number;
  cpoe: number;
  sackRate: number;
  turnoverRate: number;
  dropbacks: number;
};

type QuarterbackContext = QuarterbackState & {
  id: string | null;
  name: string | null;
  matched: boolean;
  status: "confirmed" | "projected" | "unknown";
  continuity: number;
  logDropbacks: number;
};

type PlayerRole = { offense: number; defense: number; lastTeam: string; position: string };
type PlayerValue = Record<string, number>;
type ExactOffer = {
  side: "home" | "away";
  team: string;
  sportsbook: string;
  observedAt: string;
  price: number;
  modelProbability: number;
  consensusFairProbability: number;
  targetFairProbability: number;
  otherBookCount: number;
  expectedValue: number;
  edgePercentagePoints: number;
};

const artifact = artifactJson as unknown as RuntimeArtifact;
const METRIC_PRIORS: Record<string, number> = {
  epa: 0,
  pass_epa: 0,
  rush_epa: 0,
  success: 0.43,
  early_down_pass_epa: 0,
  explosive_rate: 0.105,
  sack_rate: 0.07,
  turnover_rate: 0.022,
  plays: 64,
  redzone_td_rate: 0.55,
  no_huddle_rate: 0.10,
  pass_oe: 0,
  points: 22.5,
};
const PAIRED_PLAYER_VALUES = [
  "unavailable_role", "offense_unavailable", "defense_unavailable", "qb_unavailable",
  "ol_unavailable", "skill_unavailable", "front_unavailable", "secondary_unavailable",
  "out_role", "doubtful_role", "questionable_role", "core_out_count",
  "offense_continuity", "defense_continuity", "healthy_offense_continuity",
  "healthy_defense_continuity",
] as const;
const DIVISIONS: readonly (readonly string[])[] = [
  ["BUF", "MIA", "NE", "NYJ"], ["BAL", "CIN", "CLE", "PIT"],
  ["HOU", "IND", "JAX", "TEN"], ["DEN", "KC", "LV", "LAC"],
  ["DAL", "NYG", "PHI", "WAS"], ["CHI", "DET", "GB", "MIN"],
  ["ATL", "CAR", "NO", "TB"], ["ARI", "LA", "SF", "SEA"],
];
const BLOCKING_COVERAGE_REASONS = new Set([
  "roster_depth_unavailable",
  "expected_quarterback_unavailable",
  "injury_report_unavailable",
  "multibook_consensus_unavailable",
  "r6_leave_one_out_consensus_unavailable",
  "t60_capture_late",
]);

assertArtifact();

export function buildNflR6ShadowMoneylineDecision(args: {
  game: NflPreviewGame;
  opening: NflForwardOperationalOpening;
  comparableCurrentBooks: NflPreviewBookOdds[];
  startersAndDepth: { away: NflForwardTeamDepthSnapshot; home: NflForwardTeamDepthSnapshot };
  injuries: DailyEdgeGameAvailability | null;
  stage: NflForwardEvidenceStage;
  capturedAt: string;
  t60LagMinutes: number | null;
  coverageHealthHolds: string[];
}): NflR6ShadowMoneylineDecision {
  const evaluatedAt = isoTimestamp(args.capturedAt, "capturedAt");
  const startsAt = Date.parse(args.game.scheduledStart);
  const evaluatedTime = Date.parse(evaluatedAt);
  const t60Valid = args.stage !== "t60" || validT60Capture({
    reportedLagMinutes: args.t60LagMinutes,
    capturedAt: evaluatedAt,
    gameStartsAt: args.game.scheduledStart,
  });
  const awayQb = quarterbackContext(args.startersAndDepth.away, normalizeTeam(args.game.away.abbreviation));
  const homeQb = quarterbackContext(args.startersAndDepth.home, normalizeTeam(args.game.home.abbreviation));
  const qbContext = {
    away: { name: awayQb.name, historyMatched: awayQb.matched, status: awayQb.status },
    home: { name: homeQb.name, historyMatched: homeQb.matched, status: homeQb.status },
  };
  const quarterbackReasons = uniqueSorted([
    awayQb.status !== "confirmed" ? `away_quarterback_${awayQb.status}_not_confirmed` : null,
    homeQb.status !== "confirmed" ? `home_quarterback_${homeQb.status}_not_confirmed` : null,
    !awayQb.matched ? "away_quarterback_history_unmatched" : null,
    !homeQb.matched ? "home_quarterback_history_unmatched" : null,
  ]);
  const blockingReasons = uniqueSorted([
    ...args.coverageHealthHolds.filter((reason) => BLOCKING_COVERAGE_REASONS.has(reason)),
    args.game.season !== 2026 || args.game.providerWeek !== 1 ? "r6_runtime_outside_2026_week1" : null,
    !Number.isFinite(startsAt) || evaluatedTime >= startsAt ? "decision_not_pregame" : null,
    args.stage === "t60" && !t60Valid ? "t60_capture_late" : null,
    !awayQb.matched ? "away_quarterback_history_unmatched" : null,
    !homeQb.matched ? "home_quarterback_history_unmatched" : null,
    args.injuries === null ? "injury_report_unavailable" : null,
  ]);
  const contextReasons = uniqueSorted(args.coverageHealthHolds.filter((reason) => !BLOCKING_COVERAGE_REASONS.has(reason)));
  const stage = decisionStage(args.stage, t60Valid);

  try {
    const home = normalizeTeam(args.game.home.abbreviation);
    const away = normalizeTeam(args.game.away.abbreviation);
    const homeState = artifact.teamStates[home];
    const awayState = artifact.teamStates[away];
    if (!homeState || !awayState) throw new Error("team_state_unavailable");
    const playerValues = currentPlayerValues(args.startersAndDepth, args.injuries);
    const homePlayerValue = playerValues[home];
    const awayPlayerValue = playerValues[away];
    if (!homePlayerValue || !awayPlayerValue) throw new Error("player_value_unavailable");
    const openingSpread = args.opening.quote.spread;
    if (!openingSpread) throw new Error("operational_opening_spread_unavailable");
    const books = comparableMoneylineBooks(args.comparableCurrentBooks);
    if (books.length < 3) throw new Error("multibook_consensus_requires_three_books");

    const raw = makeRawFeatures({
      week: args.game.providerWeek,
      home,
      away,
      homeState,
      awayState,
      homeQb,
      awayQb,
      homePlayerValue,
      awayPlayerValue,
    });
    const engineered = engineerFeatures(raw);
    const rawCorrection = predictMargin(engineered);
    const independentCorrection = artifact.marginModel.weight * clamp(
      rawCorrection,
      -artifact.marginModel.correctionCap,
      artifact.marginModel.correctionCap,
    );
    const openingHomeMargin = -openingSpread.homeLine;
    const projectedHomeMargin = openingHomeMargin + independentCorrection;
    const offers = exactOffers({
      books,
      projectedHomeMargin,
      homeTeam: args.game.home.abbreviation,
      awayTeam: args.game.away.abbreviation,
    });
    const selected = [...offers].sort((first, second) =>
      second.expectedValue - first.expectedValue
      || second.edgePercentagePoints - first.edgePercentagePoints
      || first.sportsbook.localeCompare(second.sportsbook)
      || first.side.localeCompare(second.side))[0];
    if (!selected) throw new Error("exact_price_offer_unavailable");
    if (Date.parse(selected.observedAt) > evaluatedTime) blockingReasons.push("evaluated_quote_postdates_decision");
    const policyEligible = selected.price >= artifact.policy.minimumAmericanPrice
      && selected.price <= artifact.policy.maximumAmericanPrice
      && selected.expectedValue >= artifact.policy.minimumExpectedValue
      && selected.edgePercentagePoints >= artifact.policy.minimumEdgePercentagePoints;
    const healthBlocked = blockingReasons.length > 0 || stage === "t60_held";
    const grade = policyEligible && !healthBlocked ? "Lean" : "Held";
    return {
      ...baseDecision(args.game, evaluatedAt, stage, qbContext, {
        blockingReasons: uniqueSorted(blockingReasons), quarterbackReasons, contextReasons,
      }),
      grade,
      side: selected.side,
      team: selected.team,
      modelProbability: selected.modelProbability,
      otherBooksConsensusFairProbability: selected.consensusFairProbability,
      targetBookFairProbability: selected.targetFairProbability,
      otherBookCount: selected.otherBookCount,
      evaluatedQuote: {
        sportsbook: selected.sportsbook,
        line: null,
        price: selected.price,
        observedAt: isoTimestamp(selected.observedAt, "evaluatedQuote.observedAt"),
      },
      expectedValuePerUnit: selected.expectedValue,
      edgePercentagePoints: selected.edgePercentagePoints,
      lockedAt: stage === "t60_locked" ? evaluatedAt : null,
      reason: grade === "Lean"
        ? "uncapped_market_led_exact_price_candidate"
        : healthBlocked ? "shadow_evaluation_held" : "exact_price_does_not_clear_candidate_thresholds",
      footballProjection: { openingHomeMargin, independentCorrection, projectedHomeMargin },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "shadow_evaluation_failed";
    return {
      ...baseDecision(args.game, evaluatedAt, stage, qbContext, {
        blockingReasons: uniqueSorted([...blockingReasons, reason]), quarterbackReasons, contextReasons,
      }),
      grade: "Held",
      side: null,
      team: null,
      modelProbability: null,
      otherBooksConsensusFairProbability: null,
      targetBookFairProbability: null,
      otherBookCount: 0,
      evaluatedQuote: null,
      expectedValuePerUnit: null,
      edgePercentagePoints: null,
      lockedAt: null,
      reason: "shadow_evaluation_held",
      footballProjection: null,
    };
  }
}

function baseDecision(
  game: NflPreviewGame,
  evaluatedAt: string,
  stage: NflR6ShadowDecisionStage,
  quarterbackContext: NflR6ShadowMoneylineDecision["quarterbackContext"],
  health: NflR6ShadowMoneylineDecision["health"],
): Pick<NflR6ShadowMoneylineDecision,
  "schemaRelease" | "decisionKind" | "shadowOnly" | "publicationEligible" | "trackingEligible"
  | "providerGameId" | "market" | "decisionStage" | "evaluatedAt" | "gameStartsAt"
  | "quarterbackContext" | "health" | "runtimeArtifactRelease" | "modelRelease"
  | "calibrationRelease" | "decisionRelease" | "sourcePointModelRelease"> {
  return {
    schemaRelease: NFL_R6_SHADOW_DECISION_SCHEMA_RELEASE,
    decisionKind: "shadow_exact_price_bet",
    shadowOnly: true,
    publicationEligible: false,
    trackingEligible: false,
    providerGameId: game.providerGameId,
    market: "moneyline",
    decisionStage: stage,
    evaluatedAt,
    gameStartsAt: isoTimestamp(game.scheduledStart, "gameStartsAt"),
    quarterbackContext,
    health,
    runtimeArtifactRelease: NFL_R6_RUNTIME_ARTIFACT_RELEASE,
    modelRelease: NFL_R6_MONEYLINE_MODEL_RELEASE,
    calibrationRelease: NFL_R6_MONEYLINE_CALIBRATION_RELEASE,
    decisionRelease: NFL_R6_MONEYLINE_DECISION_RELEASE,
    sourcePointModelRelease: NFL_R6_SOURCE_POINT_MODEL_RELEASE,
  };
}

function quarterbackContext(depth: NflForwardTeamDepthSnapshot, team: string): QuarterbackContext {
  const starter = depth.expectedStartingQuarterback;
  const name = starter?.name?.trim() || null;
  const id = name ? artifact.quarterbackNameToId[normalizeScheduleName(name)] ?? null : null;
  const state = id ? artifact.quarterbackStates[id] : null;
  const fallback = { epa: 0, cpoe: 0, sackRate: 0.07, turnoverRate: 0.022, dropbacks: 0 };
  const values = state ?? fallback;
  return {
    ...values,
    id,
    name,
    matched: id !== null,
    status: depth.starterStatus,
    continuity: Number(id !== null && artifact.teamStates[team]?.lastQbId === id),
    logDropbacks: Math.log1p(values.dropbacks),
  };
}

function currentPlayerValues(
  depths: { away: NflForwardTeamDepthSnapshot; home: NflForwardTeamDepthSnapshot },
  injuries: DailyEdgeGameAvailability | null,
): Record<string, PlayerValue> {
  const rosters = new Map<string, Array<{ key: string; position: string | null }>>();
  for (const depth of [depths.away, depths.home]) {
    const team = normalizeTeam(depth.team);
    rosters.set(team, depth.roster.map((player) => ({
      key: playerKey(player.name),
      position: player.position,
    })));
  }
  const reports = new Map<string, Array<{ key: string; position: string | null; status: string; reportedAt: string | null }>>();
  for (const teamReport of injuries?.teams ?? []) {
    const team = normalizeTeam(teamReport.abbreviation);
    const rows = teamReport.players.map((player) => ({
      key: playerKey(player.name),
      position: player.position,
      status: injuryStatus(player.status),
      reportedAt: player.reportedAt,
    })).filter((row) => row.status !== "");
    reports.set(team, latestInjuryRows(rows));
  }
  const result: Record<string, PlayerValue> = {};
  for (const [team, roster] of rosters) {
    result[team] = teamPlayerValue(team, roster, reports.get(team) ?? []);
  }
  return result;
}

function teamPlayerValue(
  team: string,
  roster: Array<{ key: string; position: string | null }>,
  injuries: Array<{ key: string; position: string | null; status: string; reportedAt: string | null }>,
): PlayerValue {
  const values: PlayerValue = {
    unavailable_role: 0, offense_unavailable: 0, defense_unavailable: 0,
    qb_unavailable: 0, ol_unavailable: 0, skill_unavailable: 0,
    front_unavailable: 0, secondary_unavailable: 0, other_unavailable: 0,
    out_role: 0, doubtful_role: 0, questionable_role: 0, core_out_count: 0,
  };
  const severityByPlayer = new Map<string, number>();
  for (const player of injuries) {
    const severity = statusSeverity(player.status);
    severityByPlayer.set(player.key, severity);
    const state = artifact.adjustedPlayerRoles2026Week1[player.key];
    let offense = state?.offense ?? 0;
    let defense = state?.defense ?? 0;
    let role = Math.max(offense, defense);
    const group = positionGroup(player.position);
    if (!state) {
      role = 0.05;
      if (group === "front" || group === "secondary") defense = 0.05;
      else offense = 0.05;
    }
    values.unavailable_role += severity * role;
    values.offense_unavailable += severity * offense;
    values.defense_unavailable += severity * defense;
    values[`${group}_unavailable`] += severity * role;
    values[`${player.status}_role`] += role;
    if (player.status === "out" && role >= 0.5) values.core_out_count += 1;
  }
  const rosterKeys = new Set(roster.map((player) => player.key));
  const prior = Object.entries(artifact.adjustedPlayerRoles2026Week1)
    .filter(([, role]) => role.lastTeam === team && Math.max(role.offense, role.defense) >= 0.2);
  const offenseDenominator = prior.reduce((sum, [, role]) => sum + role.offense, 0);
  const defenseDenominator = prior.reduce((sum, [, role]) => sum + role.defense, 0);
  const offenseOverlap = prior.reduce((sum, [key, role]) => sum + (rosterKeys.has(key) ? role.offense : 0), 0);
  const defenseOverlap = prior.reduce((sum, [key, role]) => sum + (rosterKeys.has(key) ? role.defense : 0), 0);
  const healthyOffense = prior.reduce((sum, [key, role]) => sum + (
    rosterKeys.has(key) ? role.offense * (1 - (severityByPlayer.get(key) ?? 0)) : 0), 0);
  const healthyDefense = prior.reduce((sum, [key, role]) => sum + (
    rosterKeys.has(key) ? role.defense * (1 - (severityByPlayer.get(key) ?? 0)) : 0), 0);
  values.offense_continuity = offenseDenominator > 0 ? offenseOverlap / offenseDenominator : Number.NaN;
  values.defense_continuity = defenseDenominator > 0 ? defenseOverlap / defenseDenominator : Number.NaN;
  values.healthy_offense_continuity = offenseDenominator > 0 ? healthyOffense / offenseDenominator : Number.NaN;
  values.healthy_defense_continuity = defenseDenominator > 0 ? healthyDefense / defenseDenominator : Number.NaN;
  return values;
}

function makeRawFeatures(args: {
  week: number;
  home: string;
  away: string;
  homeState: TeamState;
  awayState: TeamState;
  homeQb: QuarterbackContext;
  awayQb: QuarterbackContext;
  homePlayerValue: PlayerValue;
  awayPlayerValue: PlayerValue;
}): Record<string, number> {
  const raw: Record<string, number> = {
    week: args.week,
    neutral_site: 0,
    division_game: Number(DIVISIONS.some((division) => division.includes(args.home) && division.includes(args.away))),
    home_rest: 7,
    away_rest: 7,
    rest_diff: 0,
    elo_diff: args.homeState.elo - args.awayState.elo,
    home_qb_epa: args.homeQb.epa,
    away_qb_epa: args.awayQb.epa,
    home_qb_cpoe: args.homeQb.cpoe,
    away_qb_cpoe: args.awayQb.cpoe,
    home_qb_sack_rate: args.homeQb.sackRate,
    away_qb_sack_rate: args.awayQb.sackRate,
    home_qb_turnover_rate: args.homeQb.turnoverRate,
    away_qb_turnover_rate: args.awayQb.turnoverRate,
    home_qb_log_dropbacks: args.homeQb.logDropbacks,
    away_qb_log_dropbacks: args.awayQb.logDropbacks,
    home_qb_same_as_last_start: args.homeQb.continuity,
    away_qb_same_as_last_start: args.awayQb.continuity,
    home_coach_continuity: Number.NaN,
    away_coach_continuity: Number.NaN,
    home_roster_continuity: Number.NaN,
    away_roster_continuity: Number.NaN,
  };
  for (const [metric, prior] of Object.entries(METRIC_PRIORS)) {
    raw[`home_matchup_fast_${metric}`] = args.homeState.offFast[metric]! - (args.awayState.defFast[metric]! - prior);
    raw[`away_matchup_fast_${metric}`] = args.awayState.offFast[metric]! - (args.homeState.defFast[metric]! - prior);
    raw[`home_matchup_slow_${metric}`] = args.homeState.offSlow[metric]! - (args.awayState.defSlow[metric]! - prior);
    raw[`away_matchup_slow_${metric}`] = args.awayState.offSlow[metric]! - (args.homeState.defSlow[metric]! - prior);
    raw[`home_off_adj_${metric}`] = args.homeState.offAdjusted[metric]!;
    raw[`away_off_adj_${metric}`] = args.awayState.offAdjusted[metric]!;
    raw[`home_def_adj_${metric}`] = args.homeState.defAdjusted[metric]!;
    raw[`away_def_adj_${metric}`] = args.awayState.defAdjusted[metric]!;
  }
  for (const name of PAIRED_PLAYER_VALUES) {
    raw[`pv_${name}_diff`] = args.homePlayerValue[name]! - args.awayPlayerValue[name]!;
    raw[`pv_${name}_sum`] = args.homePlayerValue[name]! + args.awayPlayerValue[name]!;
  }
  for (const [metric, key] of [
    ["epa", "epa"], ["cpoe", "cpoe"], ["experience", "logDropbacks"],
    ["sack_rate", "sackRate"], ["turnover_rate", "turnoverRate"], ["continuity", "continuity"],
  ] as const) {
    raw[`pv_qb_${metric}_diff`] = args.homeQb[key] - args.awayQb[key];
    raw[`pv_qb_${metric}_sum`] = args.homeQb[key] + args.awayQb[key];
  }
  return raw;
}

function engineerFeatures(raw: Record<string, number>): Record<string, number> {
  const x: Record<string, number> = {
    week_sin: Math.sin(2 * Math.PI * raw.week! / 18),
    week_cos: Math.cos(2 * Math.PI * raw.week! / 18),
    neutral_site: raw.neutral_site!, division_game: raw.division_game!, rest_diff: raw.rest_diff!, elo_diff: raw.elo_diff!,
    home_qb_epa_diff: raw.home_qb_epa! - raw.away_qb_epa!,
    home_qb_cpoe_diff: raw.home_qb_cpoe! - raw.away_qb_cpoe!,
    home_qb_sack_adv: raw.away_qb_sack_rate! - raw.home_qb_sack_rate!,
    home_qb_turnover_adv: raw.away_qb_turnover_rate! - raw.home_qb_turnover_rate!,
    qb_experience_diff: raw.home_qb_log_dropbacks! - raw.away_qb_log_dropbacks!,
    qb_continuity_diff: raw.home_qb_same_as_last_start! - raw.away_qb_same_as_last_start!,
    coach_continuity_diff: raw.home_coach_continuity! - raw.away_coach_continuity!,
    roster_continuity_diff: raw.home_roster_continuity! - raw.away_roster_continuity!,
  };
  for (const metric of Object.keys(METRIC_PRIORS)) {
    x[`matchup_fast_${metric}_diff`] = raw[`home_matchup_fast_${metric}`]! - raw[`away_matchup_fast_${metric}`]!;
    x[`matchup_slow_${metric}_diff`] = raw[`home_matchup_slow_${metric}`]! - raw[`away_matchup_slow_${metric}`]!;
    x[`off_adj_${metric}_diff`] = raw[`home_off_adj_${metric}`]! - raw[`away_off_adj_${metric}`]!;
    x[`def_adj_${metric}_home_adv`] = raw[`away_def_adj_${metric}`]! - raw[`home_def_adj_${metric}`]!;
  }
  for (const [name, value] of Object.entries(raw)) {
    if (name.startsWith("pv_") && (name.endsWith("_diff") || name.endsWith("_sum"))) x[name] = value;
  }
  return x;
}

function predictMargin(features: Record<string, number>): number {
  const inputs = artifact.marginModel.featureNames.map((name, index) => {
    const value = features[name];
    return value !== undefined && Number.isFinite(value) ? value : artifact.marginModel.imputerMedians[index]!;
  });
  let prediction = artifact.marginModel.baseline;
  for (const iteration of artifact.marginModel.trees) {
    for (const tree of iteration) prediction += predictTree(tree.nodes, inputs);
  }
  return prediction;
}

function predictTree(nodes: TreeNode[], inputs: number[]): number {
  let index = 0;
  while (true) {
    const node = nodes[index];
    if (!node) throw new Error("runtime_tree_node_unavailable");
    if (node.isLeaf) return node.value;
    const value = inputs[node.featureIndex];
    const left = value === undefined || !Number.isFinite(value) ? node.missingGoToLeft : value <= node.threshold;
    index = left ? node.left : node.right;
  }
}

function exactOffers(args: {
  books: NflPreviewBookOdds[];
  projectedHomeMargin: number;
  homeTeam: string;
  awayTeam: string;
}): ExactOffer[] {
  const result: ExactOffer[] = [];
  for (const target of args.books) {
    const others = args.books.filter((book) => normalizeBook(book.sportsbook) !== normalizeBook(target.sportsbook));
    if (!target.moneyline || others.length < 2) continue;
    const consensusHome = mean(others.map((book) => noVig(book.moneyline!.homePrice, book.moneyline!.awayPrice)));
    const targetHome = noVig(target.moneyline.homePrice, target.moneyline.awayPrice);
    const homeProbability = predictHomeProbability(consensusHome, args.projectedHomeMargin);
    for (const side of ["home", "away"] as const) {
      const probability = side === "home" ? homeProbability : 1 - homeProbability;
      const consensus = side === "home" ? consensusHome : 1 - consensusHome;
      const targetFair = side === "home" ? targetHome : 1 - targetHome;
      const price = side === "home" ? target.moneyline.homePrice : target.moneyline.awayPrice;
      result.push({
        side,
        team: side === "home" ? args.homeTeam : args.awayTeam,
        sportsbook: target.sportsbook,
        observedAt: target.observedAt,
        price,
        modelProbability: probability,
        consensusFairProbability: consensus,
        targetFairProbability: targetFair,
        otherBookCount: others.length,
        expectedValue: expectedValue(probability, price),
        edgePercentagePoints: 100 * (probability - consensus),
      });
    }
  }
  return result;
}

function predictHomeProbability(consensusHome: number, projectedHomeMargin: number): number {
  const values = [
    logit(clamp(consensusHome, 0.01, 0.99)),
    projectedHomeMargin / 7,
    Math.sign(projectedHomeMargin) * Math.sqrt(Math.abs(projectedHomeMargin)) / Math.sqrt(7),
  ];
  let score = artifact.probabilityModel.intercept;
  for (let index = 0; index < values.length; index += 1) {
    score += ((values[index]! - artifact.probabilityModel.means[index]!) / artifact.probabilityModel.scales[index]!)
      * artifact.probabilityModel.coefficients[index]!;
  }
  return 1 / (1 + Math.exp(-score));
}

function comparableMoneylineBooks(books: NflPreviewBookOdds[]): NflPreviewBookOdds[] {
  const seen = new Set<string>();
  return books.filter((book) => {
    const normalized = normalizeBook(book.sportsbook);
    if (!book.moneyline || seen.has(normalized)) return false;
    seen.add(normalized);
    return Number.isFinite(book.moneyline.homePrice) && Number.isFinite(book.moneyline.awayPrice);
  });
}

function latestInjuryRows<T extends { key: string; status: string; reportedAt: string | null }>(rows: T[]): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const previous = latest.get(row.key);
    if (!previous || injuryRank(row) >= injuryRank(previous)) latest.set(row.key, row);
  }
  return [...latest.values()];
}

function injuryRank(row: { status: string; reportedAt: string | null }): number {
  const timestamp = row.reportedAt ? Date.parse(row.reportedAt) : 0;
  return (Number.isFinite(timestamp) ? timestamp : 0) * 10 + statusSeverity(row.status);
}

function playerKey(name: string): string {
  const normalized = normalizeName(name);
  const pfr = artifact.playerNameToPfr[normalized];
  return pfr ? `pfr:${pfr}` : `name:${normalized}`;
}

function normalizeTeam(value: string): string {
  const team = value.trim().toUpperCase();
  return ({ LAR: "LA", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LA" } as Record<string, string>)[team] ?? team;
}

function normalizeName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeScheduleName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
    .filter((token) => token && !["jr", "sr", "ii", "iii", "iv", "v"].includes(token)).join(" ");
}

function injuryStatus(value: string): string {
  const status = value.toLowerCase().trim();
  if (["ir", "out", "pup", "nfi", "suspend"].some((token) => status.includes(token))) return "out";
  if (status.includes("doubtful")) return "doubtful";
  if (status.includes("questionable") || status === "q") return "questionable";
  return "";
}

function statusSeverity(status: string): number {
  return status === "out" ? 1 : status === "doubtful" ? 0.65 : status === "questionable" ? 0.25 : 0;
}

function positionGroup(value: string | null): string {
  const position = value?.toUpperCase().trim() ?? "";
  if (position === "QB") return "qb";
  if (["T", "OT", "G", "OG", "C", "OL"].includes(position)) return "ol";
  if (["WR", "RB", "FB", "TE"].includes(position)) return "skill";
  if (["DE", "DT", "DL", "NT", "LB", "ILB", "OLB", "EDGE"].includes(position)) return "front";
  if (["CB", "S", "DB", "FS", "SS"].includes(position)) return "secondary";
  return "other";
}

function decisionStage(stage: NflForwardEvidenceStage, t60Valid: boolean): NflR6ShadowDecisionStage {
  if (stage === "opening") return "opening_evaluation";
  if (stage === "unlocked") return "unlocked";
  return t60Valid ? "t60_locked" : "t60_held";
}

function validT60(lag: number | null): boolean {
  return lag !== null && Number.isFinite(lag) && lag >= 0 && lag <= NFL_T60_MAX_CAPTURE_LAG_MINUTES;
}

function validT60Capture(args: {
  reportedLagMinutes: number | null;
  capturedAt: string;
  gameStartsAt: string;
}): boolean {
  if (!validT60(args.reportedLagMinutes)) return false;
  const cutoff = Date.parse(args.gameStartsAt) - NFL_T60_TARGET_MINUTES * 60_000;
  const actualLag = (Date.parse(args.capturedAt) - cutoff) / 60_000;
  return validT60(actualLag) && Math.abs(actualLag - args.reportedLagMinutes!) < 0.01;
}

function noVig(first: number, second: number): number {
  const firstRaw = americanImplied(first);
  const secondRaw = americanImplied(second);
  return firstRaw / (firstRaw + secondRaw);
}

function americanImplied(price: number): number {
  if (!Number.isFinite(price) || price === 0) throw new Error("american_price_invalid");
  return price > 0 ? 100 / (price + 100) : -price / (-price + 100);
}

function expectedValue(probability: number, price: number): number {
  const profit = price > 0 ? price / 100 : 100 / Math.abs(price);
  return probability * profit - (1 - probability);
}

function logit(value: number): number {
  return Math.log(value / (1 - value));
}

function mean(values: number[]): number {
  if (values.length === 0) throw new Error("mean_requires_values");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeBook(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isoTimestamp(value: string, label: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label}_invalid`);
  return new Date(parsed).toISOString();
}

function uniqueSorted(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function assertArtifact(): void {
  if (
    artifact.artifactRelease !== NFL_R6_RUNTIME_ARTIFACT_RELEASE
    || artifact.modelRelease !== NFL_R6_MONEYLINE_MODEL_RELEASE
    || artifact.calibrationRelease !== NFL_R6_MONEYLINE_CALIBRATION_RELEASE
    || artifact.decisionRelease !== NFL_R6_MONEYLINE_DECISION_RELEASE
    || artifact.sourcePointModelRelease !== NFL_R6_SOURCE_POINT_MODEL_RELEASE
    || artifact.shadowOnly !== true
    || artifact.policy.maximumActionsPerWeek !== null
    || artifact.policy.bestAngleAuthorized !== false
    || artifact.marginModel.featureNames.length !== artifact.marginModel.imputerMedians.length
    || artifact.probabilityModel.featureNames.join(",") !== "market_logit,margin_edge,signed_sqrt_margin"
  ) throw new Error("NFL r6 runtime artifact contract mismatch.");
}

export const __NFL_R6_MONEYLINE_SHADOW_TEST__ = {
  artifact,
  predictMargin,
  predictHomeProbability,
  currentPlayerValues,
  validT60,
  validT60Capture,
  t60TargetMinutes: NFL_T60_TARGET_MINUTES,
};
