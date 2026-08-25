import artifactJson from "./modelArtifacts/nflPlayerPropsRuntime.json";
import type { NflPlayerPropMarket, NflPlayerPropsObservationSnapshot } from "./nflPlayerPropsContract";
import type { NflPlayerPropsInferenceContext } from "./nflPlayerPropsInferenceContext";
import type { NflPlayerPropsExactOffer } from "./nflPlayerPropsMarketBoard";

export const NFL_PLAYER_PROPS_RUNTIME_RELEASE =
  "nfl_player_props_runtime_2026_08_25_r2_shared_context" as const;

type TreeNode = {
  value: number; featureIndex: number; threshold: number; missingGoToLeft: boolean;
  left: number; right: number; isLeaf: boolean;
};
type TreeModel = { kind: "hgb_regressor" | "hgb_classifier"; featureNames: string[]; baseline: number; trees: Array<Array<{ nodes: TreeNode[] }>> };
type LinearModel = { kind: "linear_regressor"; featureNames: string[]; imputer: number[]; means: number[]; scales: number[]; coefficients: number[]; intercept: number };
type PortableModel = TreeModel | LinearModel;
type EmpiricalDistribution = { family: "empirical_residual"; residualQuantiles: number[] };
type Distribution = EmpiricalDistribution | {
  family: "empirical_residual_mean_bucket";
  buckets: Array<{ lower: number; upper: number; distribution: EmpiricalDistribution }>;
  fallback: EmpiricalDistribution;
};
type RuntimeArtifact = {
  runtimeRelease: typeof NFL_PLAYER_PROPS_RUNTIME_RELEASE;
  modelRelease: string; calibrationRelease: string; touchdownModelRelease: string;
  touchdownCalibrationRelease: string; decisionRelease: string; marketResidualRelease: string;
  featureNames: string[];
  participationModel: TreeModel;
  markets: Record<string, {
    model: PortableModel; distribution: Distribution; baselineColumn: string | null;
    marketResidualWeight: number; marketResidualQualified: boolean;
    promotionPolicy: { bestAngle: boolean; lean: boolean; watchlist: boolean };
  }>;
  touchdown: {
    featureNames: string[]; model: TreeModel; calibrator: { intercept: number; coefficient: number };
    marketResidualWeight: number; actionable: false;
  };
  decision: {
    maximumQuoteAgeHours: number;
    volumeAndYardage: {
      lean: GradeThresholds;
      bestAngle: { minimumEv: number; minimumProbabilityEdge: number; minimumParticipationProbability: number; minimumIndependentBooks: number };
    };
    marketLanes: Record<string, {
      eligibleSides: Array<"over" | "under">; bestAngle: boolean; lean: boolean; watchlist: boolean;
      leanThresholds?: GradeThresholds;
    }>;
  };
  playerStates: Record<string, Record<string, number | string | null>>;
  ambiguousPlayerNames: string[];
  teamStates: Record<string, Record<string, number | null>>;
  opponentStates: Record<string, Record<string, number | null>>;
  parity: Array<{ inputs: Record<string, number | null>; participationProbability: number; projections: Record<string, number>; touchdownProbability: number }>;
};
type GradeThresholds = {
  minimumEv: number; minimumProbabilityEdge: number; minimumParticipationProbability: number; minimumIndependentBooks: number;
};

const artifact = artifactJson as unknown as RuntimeArtifact;
if (artifact.runtimeRelease !== NFL_PLAYER_PROPS_RUNTIME_RELEASE) {
  throw new Error("NFL player props runtime artifact release mismatch.");
}

export type NflPlayerPropsRuntimeFeatureRow = {
  gameId: string; playerName: string; team: string; opponent: string; position: string | null;
  featureAsOf: string; roleFingerprint: string; scoreEligible: boolean; healthHolds: string[];
  teamImpliedPoints: number | null; teamImpliedTouchdowns: number | null;
  features: Record<string, number | null>;
};

export type NflPlayerPropsRuntimeScore = {
  participationProbability: number;
  projections: Record<string, number>;
  touchdownProbability: number;
  modelRelease: string; calibrationRelease: string; touchdownModelRelease: string;
};

export type NflPlayerPropsGrade = "Best Angle" | "Lean" | "Watchlist" | "No Play" | "Held";
export type NflPlayerPropsRuntimeDecision = {
  gameId: string; providerPlayerId: string | null; playerName: string; team: string; market: NflPlayerPropMarket; line: number;
  side: "over" | "under" | "yes"; sportsbook: string; provider: string; americanPrice: number;
  observedAt: string; lockAt: string; state: "unlocked" | "locked"; roleFingerprint: string;
  projection: number | null; participationProbability: number; rawModelProbability: number;
  marketProbability: number; finalProbability: number; probabilityEdge: number; expectedValue: number;
  grade: NflPlayerPropsGrade; healthHolds: string[]; provisional: false;
  modelRelease: string; calibrationRelease: string; decisionRelease: string;
};

export type NflPlayerPropsRuntimeBoard = {
  release: "nfl_player_props_board_2026_08_25_r2_shared_context";
  generatedAt: string; evaluatedAt: string; provisional: false; publicationEnabled: false; trackingEnabled: false;
  decisions: NflPlayerPropsRuntimeDecision[];
  counts: Record<NflPlayerPropsGrade, number> & { actionable: number };
  diagnostics: {
    inputOffers: number; completeExactOffers: number; incompleteExactOffers: number; lockedOffers: number;
    unavailableNoIndependentBenchmark: number; unavailableStaleQuotes: number; unavailableFeatureContext: number;
    roleOrIdentityHeld: number;
  };
};

export function scoreNflPlayerPropsRuntimeFeatures(features: Record<string, number | null>): NflPlayerPropsRuntimeScore {
  const participationProbability = clamp(sigmoid(predict(artifact.participationModel, features)), 0.01, 0.99);
  const projections = Object.fromEntries(Object.entries(artifact.markets).map(([market, value]) => [
    market,
    Math.max(0, value.baselineColumn ? (features[value.baselineColumn] ?? 0) : predict(value.model, features)),
  ]));
  const touchdownRaw = clamp(sigmoid(predict(artifact.touchdown.model, features)), 0.005, 0.995);
  const touchdownLogit = logit(touchdownRaw);
  const touchdownProbability = sigmoid(artifact.touchdown.calibrator.intercept + artifact.touchdown.calibrator.coefficient * touchdownLogit);
  return {
    participationProbability, projections, touchdownProbability,
    modelRelease: artifact.modelRelease, calibrationRelease: artifact.calibrationRelease,
    touchdownModelRelease: artifact.touchdownModelRelease,
  };
}

export function nflPlayerPropsOverProbability(market: string, projection: number, line: number): number {
  const component = artifact.markets[market];
  if (!component) throw new Error(`NFL props runtime market is unsupported: ${market}`);
  const distribution = component.distribution;
  let selected: EmpiricalDistribution;
  if (distribution.family === "empirical_residual") selected = distribution;
  else selected = distribution.buckets.find((bucket) => bucket.lower <= projection && projection <= bucket.upper)?.distribution ?? distribution.fallback;
  const target = line - Math.max(projection, 1e-6);
  const residuals = selected.residualQuantiles;
  let low = 0; let high = residuals.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (residuals[middle]! <= target) low = middle + 1;
    else high = middle;
  }
  return 1 - low / residuals.length;
}

export function nflPlayerPropsResidualProbability(model: number, market: number, weight: number): number {
  return sigmoid(logit(market) + weight * (logit(model) - logit(market)));
}

export function nflPlayerPropsExpectedValue(probability: number, americanPrice: number): number {
  const profit = americanPrice < 0 ? 100 / Math.abs(americanPrice) : americanPrice / 100;
  return probability * profit - (1 - probability);
}

export function buildNflPlayerPropsRuntimeFeatureRows(args: {
  snapshot: NflPlayerPropsObservationSnapshot;
  context: NflPlayerPropsInferenceContext;
}): NflPlayerPropsRuntimeFeatureRow[] {
  if (args.context.providerSnapshotGeneratedAt !== args.snapshot.generatedAt) {
    throw new Error("NFL props runtime observation/context identity mismatch.");
  }
  const candidates = new Map<string, { gameId: string; playerName: string; playerTeam: string | null }>();
  for (const row of args.snapshot.observations) {
    const ordinary = artifact.markets[row.market] && row.offerType === "over_under";
    const touchdown = row.market === "anytime_td" && row.offerType === "milestone" && row.line === 0.5;
    if (!row.isOpening && row.canonicalGameId && row.playerName && (ordinary || touchdown)) {
      candidates.set(`${row.canonicalGameId}|${normalizeName(row.playerName)}`, { gameId: row.canonicalGameId, playerName: row.playerName, playerTeam: row.playerTeam });
    }
  }
  const contextByGame = new Map(args.context.games.map((game) => [game.canonicalGameId, game]));
  return [...candidates.values()].map((candidate) => {
    const game = contextByGame.get(candidate.gameId);
    if (!game) throw new Error(`NFL props runtime context is missing ${candidate.gameId}.`);
    const roster = [...game.awayDepth.roster, ...game.homeDepth.roster].find((player) => normalizeName(player.name) === normalizeName(candidate.playerName));
    const injury = game.injuries.teams.flatMap((team) => team.players).find((player) => normalizeName(player.name) === normalizeName(candidate.playerName));
    const playerState = artifact.playerStates[normalizeName(candidate.playerName)];
    const ambiguous = artifact.ambiguousPlayerNames.includes(normalizeName(candidate.playerName));
    const team = normalizeTeam(roster ? ([game.awayDepth, game.homeDepth].find((depth) => depth.roster.includes(roster))?.team ?? candidate.playerTeam ?? "") : (candidate.playerTeam ?? ""));
    const home = normalizeTeam(game.homeTeam); const away = normalizeTeam(game.awayTeam);
    const opponent = team === home ? away : team === away ? home : "";
    const holds = [
      roster ? null : "roster_identity_unmatched",
      playerState ? null : ambiguous ? "historical_identity_ambiguous" : "historical_identity_unmatched",
      opponent ? null : "team_game_identity_unmatched",
      injury && !injury.reportedAt && !game.injuries.reportUpdatedAt ? "injury_report_timestamp_missing" : null,
      injury && ["out", "inactive", "injured reserve", "ir"].includes(injury.status.toLowerCase()) ? "player_listed_out" : null,
    ].filter((value): value is string => value !== null);
    const impliedPoints = impliedTeamPoints(game, team);
    const features: Record<string, number | null> = {};
    for (const name of new Set([...artifact.featureNames, ...artifact.touchdown.featureNames])) features[name] = null;
    mergeNumeric(features, playerState); mergeNumeric(features, artifact.teamStates[team]); mergeNumeric(features, artifact.opponentStates[opponent]);
    features.is_home = Number(team === home);
    for (const position of ["qb", "rb", "fb", "wr", "te"]) features[`position_${position}`] = Number(roster?.position?.toLowerCase() === position);
    features.team_implied_touchdowns = impliedPoints === null ? null : impliedPoints / 7;
    return {
      gameId: candidate.gameId, playerName: candidate.playerName, team, opponent,
      position: roster?.position ?? null, featureAsOf: args.context.capturedAt,
      roleFingerprint: stableRoleFingerprint({ roster, injury }), scoreEligible: holds.length === 0,
      healthHolds: holds, teamImpliedPoints: impliedPoints,
      teamImpliedTouchdowns: features.team_implied_touchdowns, features,
    };
  });
}

export function buildNflPlayerPropsRuntimeBoard(args: {
  offers: NflPlayerPropsExactOffer[];
  features: NflPlayerPropsRuntimeFeatureRow[];
  evaluatedAt: string;
}): NflPlayerPropsRuntimeBoard {
  const evaluatedAt = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) throw new Error("NFL props runtime board evaluatedAt is invalid.");
  const featureByKey = new Map(args.features.map((row) => [`${row.gameId}|${normalizeName(row.playerName)}`, row]));
  const exact = args.offers.filter((offer) => offer.gradeEligibleMarket && offer.exactPriceComplete);
  const staleOutcomeKeys = new Set<string>();
  const unavailableBenchmarkKeys = new Set<string>();
  const unavailableFeatureKeys = new Set<string>();
  const freshExact = exact.filter((offer) => {
    const stale = evaluatedAt - Date.parse(offer.observedAt) > artifact.decision.maximumQuoteAgeHours * 3_600_000;
    if (stale) for (const key of outcomeKeys(offer)) staleOutcomeKeys.add(key);
    return !stale;
  });
  const benchmarkGroups = new Map<string, Map<string, { over: number | null; under: number | null; yes: number | null }>>();
  for (const offer of freshExact) {
    const key = `${offer.canonicalGameId}|${normalizeName(offer.playerName)}|${offer.market}|${offer.line}`;
    const books = benchmarkGroups.get(key) ?? new Map();
    const book = normalizeBook(offer.sportsbook);
    const probability = { over: offer.overNoVigProbability, under: offer.underNoVigProbability, yes: offer.yesPrice === null ? null : impliedProbability(offer.yesPrice) };
    const previous = books.get(book);
    books.set(book, previous ? {
      over: averagePresent([previous.over, probability.over]), under: averagePresent([previous.under, probability.under]), yes: averagePresent([previous.yes, probability.yes]),
    } : probability);
    benchmarkGroups.set(key, books);
  }
  const decisions: NflPlayerPropsRuntimeDecision[] = [];
  for (const offer of freshExact) {
    const feature = featureByKey.get(`${offer.canonicalGameId}|${normalizeName(offer.playerName)}`);
    if (!feature) {
      for (const key of outcomeKeys(offer)) unavailableFeatureKeys.add(key);
      continue;
    }
    const benchmarkKey = `${offer.canonicalGameId}|${normalizeName(offer.playerName)}|${offer.market}|${offer.line}`;
    const books = benchmarkGroups.get(benchmarkKey) ?? new Map();
    const others = [...books.entries()].filter(([book]) => book !== normalizeBook(offer.sportsbook)).map(([, value]) => value);
    const independentBooks = others.length;
    if (independentBooks === 0) {
      for (const key of outcomeKeys(offer)) unavailableBenchmarkKeys.add(key);
      continue;
    }
    const scored = scoreNflPlayerPropsRuntimeFeatures(feature.features);
    const commonHolds = [...offer.healthHolds, ...feature.healthHolds];
    if (offer.market === "anytime_td") {
      if (offer.yesPrice === null) continue;
      const raw = scored.touchdownProbability;
      const market = averagePresent(others.map((value) => value.yes)) ?? impliedProbability(offer.yesPrice);
      const final = nflPlayerPropsResidualProbability(raw, market, artifact.touchdown.marketResidualWeight);
      const edge = final - market; const ev = nflPlayerPropsExpectedValue(final, offer.yesPrice);
      const grade: NflPlayerPropsGrade = commonHolds.length ? "Held" : offer.yesPrice >= 100 && edge >= 0 && ev >= 0 ? "Watchlist" : "No Play";
      decisions.push(decisionRow(offer, feature, scored, "yes", offer.yesPrice, null, raw, market, final, edge, ev, grade, commonHolds, artifact.touchdownModelRelease, artifact.touchdownCalibrationRelease));
      continue;
    }
    const policy = artifact.markets[offer.market];
    const lane = artifact.decision.marketLanes[offer.market];
    if (!policy || offer.overPrice === null || offer.underPrice === null || offer.overNoVigProbability === null || offer.underNoVigProbability === null) continue;
    const projection = scored.projections[offer.market]!;
    const rawOver = nflPlayerPropsOverProbability(offer.market, projection, offer.line);
    for (const [side, price, raw, market] of [
      ["over", offer.overPrice, rawOver, averagePresent(others.map((value) => value.over)) ?? offer.overNoVigProbability],
      ["under", offer.underPrice, 1 - rawOver, averagePresent(others.map((value) => value.under)) ?? offer.underNoVigProbability],
    ] as const) {
      const final = nflPlayerPropsResidualProbability(raw, market, policy.marketResidualWeight);
      const edge = final - market; const ev = nflPlayerPropsExpectedValue(final, price);
      const eligibleSide = lane?.eligibleSides.includes(side) ?? false;
      const leanThresholds = lane?.leanThresholds ?? artifact.decision.volumeAndYardage.lean;
      let grade: NflPlayerPropsGrade = "No Play";
      if (commonHolds.length) grade = "Held";
      else if (eligibleSide && policy.marketResidualQualified && lane?.bestAngle && ev >= artifact.decision.volumeAndYardage.bestAngle.minimumEv
        && edge >= artifact.decision.volumeAndYardage.bestAngle.minimumProbabilityEdge
        && scored.participationProbability >= artifact.decision.volumeAndYardage.bestAngle.minimumParticipationProbability
        && independentBooks >= artifact.decision.volumeAndYardage.bestAngle.minimumIndependentBooks) grade = "Best Angle";
      else if (eligibleSide && policy.marketResidualQualified && lane?.lean
        && ev >= leanThresholds.minimumEv
        && edge >= leanThresholds.minimumProbabilityEdge
        && scored.participationProbability >= leanThresholds.minimumParticipationProbability
        && independentBooks >= leanThresholds.minimumIndependentBooks) grade = "Lean";
      else if (eligibleSide && policy.marketResidualQualified && lane?.watchlist && ev >= 0 && edge >= 0) grade = "Watchlist";
      decisions.push(decisionRow(offer, feature, scored, side, price, projection, raw, market, final, edge, ev, grade, commonHolds, artifact.modelRelease, artifact.calibrationRelease));
    }
  }
  const bestPrice = new Map<string, NflPlayerPropsRuntimeDecision>();
  for (const row of decisions) {
    const key = `${row.gameId}|${normalizeName(row.playerName)}|${row.market}|${row.line}|${row.side}`;
    const previous = bestPrice.get(key);
    if (!previous || row.americanPrice > previous.americanPrice) bestPrice.set(key, row);
  }
  const deduped = [...bestPrice.values()].sort(compareDecision);
  const count = (grade: NflPlayerPropsGrade) => deduped.filter((row) => row.grade === grade).length;
  return {
    release: "nfl_player_props_board_2026_08_25_r2_shared_context", generatedAt: new Date(evaluatedAt).toISOString(), evaluatedAt: args.evaluatedAt,
    provisional: false, publicationEnabled: false, trackingEnabled: false, decisions: deduped,
    counts: { "Best Angle": count("Best Angle"), Lean: count("Lean"), Watchlist: count("Watchlist"), "No Play": count("No Play"), Held: count("Held"), actionable: count("Best Angle") + count("Lean") },
    diagnostics: {
      inputOffers: args.offers.length,
      completeExactOffers: exact.length,
      incompleteExactOffers: args.offers.filter((offer) => offer.gradeEligibleMarket && !offer.exactPriceComplete).length,
      unavailableNoIndependentBenchmark: unavailableBenchmarkKeys.size,
      unavailableStaleQuotes: staleOutcomeKeys.size,
      unavailableFeatureContext: unavailableFeatureKeys.size,
      roleOrIdentityHeld: deduped.filter((row) => row.grade === "Held").length,
      lockedOffers: exact.filter((offer) => offer.state === "locked").length,
    },
  };
}

function outcomeKeys(offer: NflPlayerPropsExactOffer): string[] {
  const base = `${offer.canonicalGameId}|${normalizeName(offer.playerName)}|${offer.market}|${offer.line}`;
  return offer.market === "anytime_td" ? [`${base}|yes`] : [`${base}|over`, `${base}|under`];
}

export function verifyNflPlayerPropsRuntimeParity(tolerance = 1e-9): void {
  for (const test of artifact.parity) {
    const actual = scoreNflPlayerPropsRuntimeFeatures(test.inputs);
    assertNear(actual.participationProbability, test.participationProbability, tolerance, "participation");
    assertNear(actual.touchdownProbability, test.touchdownProbability, tolerance, "touchdown");
    for (const [market, expected] of Object.entries(test.projections)) assertNear(actual.projections[market]!, expected, tolerance, market);
  }
}

export function nflPlayerPropsRuntimePolicy(): Readonly<RuntimeArtifact["decision"]> { return artifact.decision; }
export function nflPlayerPropsRuntimeMarketPolicy(market: NflPlayerPropMarket): { weight: number; qualified: boolean } | null {
  const value = artifact.markets[market];
  return value ? { weight: value.marketResidualWeight, qualified: value.marketResidualQualified } : null;
}
export function nflPlayerPropsTouchdownPolicy(): { weight: number; actionable: false } {
  return { weight: artifact.touchdown.marketResidualWeight, actionable: artifact.touchdown.actionable };
}

function predict(model: PortableModel, features: Record<string, number | null>): number {
  if (model.kind === "linear_regressor") {
    let value = model.intercept;
    for (let index = 0; index < model.featureNames.length; index += 1) {
      const raw = features[model.featureNames[index]!] ?? model.imputer[index]!;
      value += ((raw - model.means[index]!) / model.scales[index]!) * model.coefficients[index]!;
    }
    return value;
  }
  const inputs = model.featureNames.map((name) => features[name] ?? Number.NaN);
  let value = model.baseline;
  for (const iteration of model.trees) for (const tree of iteration) value += predictTree(tree.nodes, inputs);
  return value;
}

function predictTree(nodes: TreeNode[], inputs: number[]): number {
  let index = 0;
  while (true) {
    const node = nodes[index]; if (!node) throw new Error("NFL props runtime tree node is missing.");
    if (node.isLeaf) return node.value;
    const input = inputs[node.featureIndex];
    index = input === undefined || !Number.isFinite(input) ? (node.missingGoToLeft ? node.left : node.right) : (input <= node.threshold ? node.left : node.right);
  }
}

function impliedTeamPoints(game: NflPlayerPropsInferenceContext["games"][number], team: string): number | null {
  const books = game.mainMarket.currentBooks.filter((book) => book.total && book.spread);
  if (!books.length) return null;
  const total = median(books.map((book) => book.total!.line));
  const homeSpread = median(books.map((book) => book.spread!.homeLine));
  const homePoints = total / 2 - homeSpread / 2;
  return team === normalizeTeam(game.homeTeam) ? homePoints : total - homePoints;
}

function mergeNumeric(target: Record<string, number | null>, source: Record<string, number | string | null> | undefined): void {
  if (!source) return;
  for (const [key, value] of Object.entries(source)) if (typeof value === "number") target[key] = value;
}
function stableRoleFingerprint(value: unknown): string {
  const input = JSON.stringify(canonicalize(value));
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([first], [second]) => first.localeCompare(second)).map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}
function normalizeName(value: string): string { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b|[^a-z0-9]/g, ""); }
function normalizeTeam(value: string): string { const team = value.trim().toUpperCase(); return ({ LAR: "LA", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LA" } as Record<string, string>)[team] ?? team; }
function median(values: number[]): number { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2; }
function sigmoid(value: number): number { return 1 / (1 + Math.exp(-value)); }
function logit(value: number): number { const clipped = clamp(value, 1e-5, 1 - 1e-5); return Math.log(clipped / (1 - clipped)); }
function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)); }
function assertNear(actual: number, expected: number, tolerance: number, label: string): void { if (Math.abs(actual - expected) > tolerance) throw new Error(`NFL props runtime ${label} parity failed: ${actual} != ${expected}`); }
function impliedProbability(price: number): number { return price < 0 ? -price / (-price + 100) : 100 / (price + 100); }
function averagePresent(values: Array<number | null>): number | null { const present = values.filter((value): value is number => value !== null); return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null; }
function normalizeBook(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function decisionRow(
  offer: NflPlayerPropsExactOffer, feature: NflPlayerPropsRuntimeFeatureRow, score: NflPlayerPropsRuntimeScore,
  side: "over" | "under" | "yes", price: number, projection: number | null, raw: number, market: number,
  final: number, edge: number, expectedValue: number, grade: NflPlayerPropsGrade, holds: string[], modelRelease: string, calibrationRelease: string,
): NflPlayerPropsRuntimeDecision {
  return {
    gameId: offer.canonicalGameId, providerPlayerId: offer.providerPlayerId, playerName: offer.playerName, team: feature.team, market: offer.market,
    line: offer.line, side, sportsbook: offer.sportsbook, provider: offer.provider, americanPrice: price,
    observedAt: offer.observedAt, lockAt: offer.lockAt, state: offer.state, roleFingerprint: feature.roleFingerprint,
    projection, participationProbability: score.participationProbability, rawModelProbability: raw,
    marketProbability: market, finalProbability: final, probabilityEdge: edge, expectedValue, grade,
    healthHolds: [...new Set(holds)].sort(), provisional: false, modelRelease, calibrationRelease,
    decisionRelease: artifact.decisionRelease,
  };
}
function compareDecision(first: NflPlayerPropsRuntimeDecision, second: NflPlayerPropsRuntimeDecision): number {
  return first.gameId.localeCompare(second.gameId) || first.playerName.localeCompare(second.playerName)
    || first.market.localeCompare(second.market) || first.line - second.line || first.side.localeCompare(second.side);
}
