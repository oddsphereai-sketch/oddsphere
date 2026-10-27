import type { NcaafBookOdds, NcaafGame } from "./balldontlieNcaafSlate";
import type { CfbCurrentAdvancedGame, CfbCurrentAdvancedMetrics } from "./cfbCurrentAdvancedState";
import type {
  CfbForwardEvidencePayload,
  CfbForwardMarketHistoryEvidence,
  CfbForwardPlaybookSplit,
} from "./cfbForwardEvidence";
import type { CfbForwardMarketReaderObservation } from "./cfbForwardEvidenceCapture";
import type { CfbSharpApiSplitRecord } from "./cfbSharpApiSplits";
import { summarizePmf, tiltCfbMarginWithinTotals } from "./cfbMarketSharpAwareShadow";
import type { CfbV1Forecast } from "./cfbV1Decision";
import { CFB_PUBLIC_SCORE_DIRECTION_TOLERANCE_POINTS } from "./footballCrossMarketCoherence";

export const CFB_FINAL_WINNER_COORDINATOR_ARTIFACT_RELEASE =
  "cfb_final_winner_coordinator_artifact_2026_10_14_r2_correct_qb_target_excluded_smooth_net_accuracy" as const;
export const CFB_FINAL_WINNER_COORDINATOR_RELEASE =
  "cfb_final_winner_coordinator_2026_10_14_r2_correct_qb_target_excluded_smooth_net_accuracy" as const;
export const CFB_FINAL_WINNER_COORDINATOR_BOUNDARY_RELEASE =
  "cfb_final_winner_coordinator_boundary_2026_10_27_r1_actual_pmf_incumbent" as const;
export const CFB_PMF_WINNER_COHERENCE_RELEASE =
  "cfb_pmf_winner_coherence_2026_10_27_r1_near_tie_single_pmf" as const;

type NullableNumber = number | null;
type Side = "first" | "second";
type TeamProfile = {
  displayName: string;
  elo: number;
  lastPlayedAt: string | null;
  priorGames: number;
  rolling: Record<string, NullableNumber>;
  defenseRolling: Record<string, NullableNumber>;
  recentRolling: Record<string, NullableNumber>;
  qbEpaVolume: NullableNumber;
  personnel: Record<string, NullableNumber>;
};
type LogisticPipeline = {
  kind: "logistic_classifier";
  inputFeatures: string[];
  imputerStatistics: number[];
  missingIndicatorFeatureIndexes: number[];
  scalerMean: number[];
  scalerScale: number[];
  coefficients: number[];
  intercept: number;
};
type Artifact = {
  artifactRelease: string;
  modelRelease: string;
  season: number;
  policy: {
    maximumAuthority: number;
    confidenceCenter: number;
    confidenceWidth: number;
    readerMarginDecayScale: number;
    probabilityMarginScale: number;
    maximumAbsoluteMargin: number;
    applyOnlyOnWinnerBoundaryCross: true;
  };
  rollingKeys: string[];
  recentKeys: string[];
  model: LogisticPipeline;
  teamProfiles: Record<string, TeamProfile>;
};
type MutableTeamState = {
  profile: TeamProfile;
  matched: boolean;
  elo: number;
  lastPlayedAt: string | null;
  currentGames: number;
  sums: Record<string, number>;
  counts: Record<string, number>;
  defenseSums: Record<string, number>;
  defenseCounts: Record<string, number>;
  recent: Record<string, number[]>;
  qbEpaNumerator: number;
  qbAttempts: number;
};
type CompletedObservation = {
  sourceGameId: string;
  season: number;
  scheduledStart: string;
  neutralSite: boolean;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  homeMetrics: CfbCurrentAdvancedMetrics;
  awayMetrics: CfbCurrentAdvancedMetrics;
};
type SplitRead = {
  provenance: "namedSharp" | "fallback" | "public";
  side: Side;
  gapPp: number;
};

export type CfbFinalWinnerCoordinatorResult = {
  forecast: CfbV1Forecast;
  applied: boolean;
  reason: "winner_boundary_cross" | "same_winner_side" | "team_profile_unavailable" | "runtime_fallback";
  learnedHomeWinProbability: number | null;
  combinedHomeWinProbability: number;
  authority: number;
  targetMarginHome: number | null;
  featureSnapshot: Record<string, NullableNumber> | null;
};

export type CfbFinalWinnerCoordinatorEvaluation = {
  baselineHomeWinProbability: number;
  learnedHomeWinProbability: number;
  combinedHomeWinProbability: number;
  authority: number;
  crossesWinnerBoundary: boolean;
  targetMarginHome: number | null;
};

// Keep the generated coordinator artifact out of TypeScript's literal type
// graph while preserving a fixed bundler-visible path and typed contract.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const artifact = require("./modelArtifacts/cfbFinalWinnerCoordinatorArtifact.json") as Artifact;
const CURRENT_SEASON_PRIOR_GAMES = 4;
const RECENT_PRIOR_GAMES = 1.5;
const RECENT_WINDOW = 3;
const WINNER_DIRECTION_EPSILON = 1e-9;
const GLOBAL_MEANS: Record<string, number> = { margin: 0, pace: 68, drives: 12 };

assertArtifact();

export function applyCfbFinalWinnerCoordinator(args: {
  forecast: CfbV1Forecast;
  game: NcaafGame;
  completedGames?: NcaafGame[];
  advancedGames?: CfbCurrentAdvancedGame[];
  currentBooks: NcaafBookOdds[];
  evaluatedSportsbookByMarket: Partial<Record<"moneyline" | "spread" | "total", string>>;
  histories: CfbForwardMarketHistoryEvidence[];
  currentObservation: CfbForwardMarketReaderObservation;
}): CfbFinalWinnerCoordinatorResult {
  const baselineProbability = sigmoid(args.forecast.expectedMarginHome / artifact.policy.probabilityMarginScale);
  try {
    const states = initialStates();
    const away = resolveState(states, args.game.away.name);
    const home = resolveState(states, args.game.home.name);
    if (!away.matched || !home.matched) {
      return unchanged(args.forecast, baselineProbability, "team_profile_unavailable");
    }
    const advanced = (args.advancedGames ?? [])
      .filter((game) => game.season === args.game.season)
      .sort(compareObservation);
    const advancedKeys = new Set(advanced.map(observationKey));
    const scoreOnly = (args.completedGames ?? [])
      .filter((game) => game.season === args.game.season && game.homeScore !== null && game.awayScore !== null)
      .filter((game) => !advancedKeys.has(observationKey(game)))
      .map(toScoreOnlyObservation);
    for (const observation of [...advanced, ...scoreOnly].sort(compareObservation)) {
      if (Date.parse(observation.scheduledStart) >= Date.parse(args.game.scheduledStart)) break;
      applyCompletedGame(states, observation);
    }
    const resolvedAway = resolveState(states, args.game.away.name).state;
    const resolvedHome = resolveState(states, args.game.home.name).state;
    const features = {
      ...matchupFeatures({ game: args.game, away: resolvedAway, home: resolvedHome }),
      ...buildCfbFinalWinnerCoordinatorMarketFeatures(args),
      reader_margin: args.forecast.expectedMarginHome,
      reader_margin_abs: Math.abs(args.forecast.expectedMarginHome),
      both_fbs: args.game.away.fbs && args.game.home.fbs ? 1 : 0,
    };
    const evaluation = evaluateCfbFinalWinnerCoordinator(
      features,
      args.forecast.expectedMarginHome,
      args.forecast.homeWinProbability,
    );
    if (!evaluation.crossesWinnerBoundary) {
      return {
        forecast: args.forecast,
        applied: false,
        reason: "same_winner_side",
        learnedHomeWinProbability: evaluation.learnedHomeWinProbability,
        combinedHomeWinProbability: evaluation.combinedHomeWinProbability,
        authority: evaluation.authority,
        targetMarginHome: null,
        featureSnapshot: features,
      };
    }
    const targetMargin = evaluation.targetMarginHome!;
    const pmf = reconcileCfbFinalWinnerPmf(
      args.forecast,
      targetMargin,
      evaluation.combinedHomeWinProbability > 0.5,
    );
    const summary = summarizePmf(pmf);
    return {
      forecast: { ...args.forecast, ...summary, pmf },
      applied: true,
      reason: "winner_boundary_cross",
      learnedHomeWinProbability: evaluation.learnedHomeWinProbability,
      combinedHomeWinProbability: evaluation.combinedHomeWinProbability,
      authority: evaluation.authority,
      targetMarginHome: summary.expectedMarginHome,
      featureSnapshot: features,
    };
  } catch {
    return unchanged(args.forecast, baselineProbability, "runtime_fallback");
  }
}

export function reconcileCfbFinalWinnerPmf(
  forecast: CfbV1Forecast,
  requestedMargin: number,
  homeWinner: boolean,
): CfbV1Forecast["pmf"] {
  const atMargin = (margin: number) => tiltCfbMarginWithinTotals(
    forecast.pmf,
    margin - forecast.expectedMarginHome,
  );
  const coherent = (pmf: CfbV1Forecast["pmf"]) => {
    const summary = summarizePmf(pmf);
    const mass = pmf.reduce((sum, cell) => sum + cell.probability, 0);
    const awayWinProbability = mass - summary.homeWinProbability;
    const displayedHome = Math.round(summary.expectedHomePoints * 10);
    const displayedAway = Math.round(summary.expectedAwayPoints * 10);
    const representativeMargin = summary.representativeScore.home - summary.representativeScore.away;
    return homeWinner
      ? summary.expectedMarginHome > 0 && summary.homeWinProbability - awayWinProbability > WINNER_DIRECTION_EPSILON &&
        displayedHome > displayedAway && representativeMargin > 0
      : summary.expectedMarginHome < 0 && awayWinProbability - summary.homeWinProbability > WINNER_DIRECTION_EPSILON &&
        displayedHome < displayedAway && representativeMargin < 0;
  };
  const initial = atMargin(requestedMargin);
  if (coherent(initial)) return initial;
  const extremeMargin = homeWinner
    ? artifact.policy.maximumAbsoluteMargin
    : -artifact.policy.maximumAbsoluteMargin;
  const extreme = atMargin(extremeMargin);
  if (!coherent(extreme)) throw new Error("CFB winner coordinator cannot reconcile the final score and winner side.");
  let unresolved = requestedMargin;
  let resolved = extremeMargin;
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const midpoint = (unresolved + resolved) / 2;
    if (coherent(atMargin(midpoint))) resolved = midpoint;
    else unresolved = midpoint;
  }
  return atMargin(resolved);
}

export function reconcileCfbNearTiePmfWinnerCoherence(forecast: CfbV1Forecast): {
  forecast: CfbV1Forecast;
  applied: boolean;
  reason: "near_tie_mean_probability_direction_cross" | "already_coherent" | "outside_tolerance" | "exact_tie";
} {
  const marginDirection = Math.sign(forecast.expectedMarginHome);
  const probabilityDirection = Math.sign(forecast.homeWinProbability - 0.5);
  if (marginDirection === 0 || probabilityDirection === 0) {
    return { forecast, applied: false, reason: "exact_tie" };
  }
  if (marginDirection === probabilityDirection) {
    return { forecast, applied: false, reason: "already_coherent" };
  }
  if (Math.abs(forecast.expectedMarginHome) > CFB_PUBLIC_SCORE_DIRECTION_TOLERANCE_POINTS) {
    return { forecast, applied: false, reason: "outside_tolerance" };
  }
  const pmf = reconcileCfbFinalWinnerPmf(
    forecast,
    forecast.expectedMarginHome,
    marginDirection > 0,
  );
  const summary = summarizePmf(pmf);
  return {
    forecast: {
      ...forecast,
      ...summary,
      pmf,
      directionalAlignment: {
        release: CFB_PMF_WINNER_COHERENCE_RELEASE,
        target: marginDirection > 0 ? "home" : "away",
        symmetricPoints: Math.abs(summary.expectedMarginHome - forecast.expectedMarginHome) / 2,
        reason: "mean_probability_direction_cross",
      },
    },
    applied: true,
    reason: "near_tie_mean_probability_direction_cross",
  };
}

export function evaluateCfbFinalWinnerCoordinator(
  features: Record<string, NullableNumber>,
  readerMarginHome: number,
  incumbentHomeWinProbability?: number,
): CfbFinalWinnerCoordinatorEvaluation {
  const baselineHomeWinProbability = incumbentHomeWinProbability ??
    sigmoid(readerMarginHome / artifact.policy.probabilityMarginScale);
  const learnedHomeWinProbability = predictLogistic(artifact.model, {
    ...features,
    reader_margin: readerMarginHome,
    reader_margin_abs: Math.abs(readerMarginHome),
  });
  const confidence = 2 * Math.abs(learnedHomeWinProbability - 0.5);
  const authority = artifact.policy.maximumAuthority *
    sigmoid((confidence - artifact.policy.confidenceCenter) / artifact.policy.confidenceWidth) *
    Math.exp(-((Math.abs(readerMarginHome) / artifact.policy.readerMarginDecayScale) ** 2));
  const combinedHomeWinProbability = clamp(
    baselineHomeWinProbability + authority * (learnedHomeWinProbability - baselineHomeWinProbability),
    0.001,
    0.999,
  );
  const crossesWinnerBoundary = (combinedHomeWinProbability > 0.5) !==
    (baselineHomeWinProbability > 0.5);
  return {
    baselineHomeWinProbability,
    learnedHomeWinProbability,
    combinedHomeWinProbability,
    authority,
    crossesWinnerBoundary,
    targetMarginHome: crossesWinnerBoundary ? clamp(
      artifact.policy.probabilityMarginScale *
        Math.log(combinedHomeWinProbability / (1 - combinedHomeWinProbability)),
      -artifact.policy.maximumAbsoluteMargin,
      artifact.policy.maximumAbsoluteMargin,
    ) : null,
  };
}

function unchanged(
  forecast: CfbV1Forecast,
  baselineProbability: number,
  reason: CfbFinalWinnerCoordinatorResult["reason"],
): CfbFinalWinnerCoordinatorResult {
  return {
    forecast,
    applied: false,
    reason,
    learnedHomeWinProbability: null,
    combinedHomeWinProbability: baselineProbability,
    authority: 0,
    targetMarginHome: null,
    featureSnapshot: null,
  };
}

function initialStates(): Map<string, MutableTeamState> {
  return new Map(Object.entries(artifact.teamProfiles).map(([name, profile]) => [name, {
    profile,
    matched: true,
    elo: profile.elo,
    lastPlayedAt: profile.lastPlayedAt,
    currentGames: 0,
    sums: {},
    counts: {},
    defenseSums: {},
    defenseCounts: {},
    recent: {},
    qbEpaNumerator: 0,
    qbAttempts: 0,
  }]));
}

function resolveState(states: Map<string, MutableTeamState>, name: string): { state: MutableTeamState; matched: boolean } {
  const exact = states.get(normalizeName(name));
  if (exact) return { state: exact, matched: exact.matched };
  const folded = foldName(name);
  const matches = [...states.entries()].filter(([candidate]) => foldName(candidate) === folded);
  if (matches.length === 1) return { state: matches[0]![1], matched: matches[0]![1].matched };
  if (matches.length > 1) return { state: matches[0]![1], matched: false };
  const rolling = Object.fromEntries(artifact.rollingKeys.map((key) => [key, GLOBAL_MEANS[key] ?? 0]));
  const profile: TeamProfile = {
    displayName: name,
    elo: 1500,
    lastPlayedAt: null,
    priorGames: 0,
    rolling,
    defenseRolling: Object.fromEntries(artifact.rollingKeys.map((key) => [key, 0])),
    recentRolling: Object.fromEntries(artifact.recentKeys.map((key) => [key, GLOBAL_MEANS[key] ?? 0])),
    qbEpaVolume: 0,
    personnel: { roster_continuity: null, roster_experience: null, returning_qb: null },
  };
  const state: MutableTeamState = {
    profile,
    matched: false,
    elo: 1500,
    lastPlayedAt: null,
    currentGames: 0,
    sums: {}, counts: {}, defenseSums: {}, defenseCounts: {}, recent: {},
    qbEpaNumerator: 0, qbAttempts: 0,
  };
  states.set(normalizeName(name), state);
  return { state, matched: false };
}

function matchupFeatures(args: {
  game: NcaafGame;
  away: MutableTeamState;
  home: MutableTeamState;
}): Record<string, NullableNumber> {
  const neutral = args.game.neutralSite === true;
  const output: Record<string, NullableNumber> = {
    elo_diff: args.home.elo - args.away.elo + (neutral ? 0 : 55),
    rest_diff: clamp(
      restDays(args.home.lastPlayedAt, args.game.scheduledStart) -
        restDays(args.away.lastPlayedAt, args.game.scheduledStart),
      -14,
      14,
    ),
  };
  for (const key of artifact.rollingKeys) {
    const home = blendedValue(args.home, key);
    const away = blendedValue(args.away, key);
    const homeMatchup = home + blendedDefenseValue(args.away, key);
    const awayMatchup = away + blendedDefenseValue(args.home, key);
    output[`matchup_${key}_diff`] = homeMatchup - awayMatchup;
  }
  for (const key of artifact.recentKeys) {
    output[`recent3_${key}_diff`] = blendedRecentValue(args.home, key) - blendedRecentValue(args.away, key);
  }
  output.qb_epa_volume_diff = blendedQbEpa(args.home) - blendedQbEpa(args.away);
  for (const key of ["roster_continuity", "roster_experience", "returning_qb"] as const) {
    const home = args.home.profile.personnel[key];
    const away = args.away.profile.personnel[key];
    output[`${key}_diff`] = home === null || away === null ? null : home - away;
  }
  return output;
}

export function buildCfbFinalWinnerCoordinatorMarketFeatures(args: {
  currentBooks: NcaafBookOdds[];
  evaluatedSportsbookByMarket: Partial<Record<"moneyline" | "spread" | "total", string>>;
  histories: CfbForwardMarketHistoryEvidence[];
  currentObservation: CfbForwardMarketReaderObservation;
}): Record<string, NullableNumber> {
  const eligible = args.currentBooks.filter((book) => book.marketReadingEligible !== false &&
    !["kalshi", "polymarket"].includes(canonicalBook(book.sportsbook)));
  const excluding = (market: "moneyline" | "spread" | "total") => eligible.filter((book) =>
    canonicalBook(book.sportsbook) !== canonicalBook(args.evaluatedSportsbookByMarket[market] ?? ""));
  const moneylineBooks = excluding("moneyline").filter((book) => book.moneyline !== null);
  const homeProbabilities = moneylineBooks.flatMap((book) => {
    if (!book.moneyline) return [];
    const home = implied(book.moneyline.homePrice);
    const away = implied(book.moneyline.awayPrice);
    return home + away > 0 ? [home / (home + away)] : [];
  });
  const spreadLines = excluding("spread").flatMap((book) => book.spread ? [book.spread.homeLine] : []);
  const totalLines = excluding("total").flatMap((book) => book.total ? [book.total.line] : []);
  const reads = splitReads(args.histories, args.currentObservation, "moneyline");
  const strongest = (provenance: SplitRead["provenance"]) => reads
    .filter((read) => read.provenance === provenance)
    .sort((first, second) => Math.abs(second.gapPp) - Math.abs(first.gapPp))[0] ?? null;
  const output: Record<string, NullableNumber> = {
    market_home_probability: homeProbabilities.length ? median(homeProbabilities) : null,
    market_home_spread: spreadLines.length ? median(spreadLines) : null,
    market_total_consensus: totalLines.length ? median(totalLines) : null,
    market_eligible_books: moneylineBooks.length,
    market_history_observations: args.histories.length + 1,
  };
  for (const provenance of ["namedSharp", "fallback", "public"] as const) {
    const read = strongest(provenance);
    output[`moneyline_${provenance}_side`] = read ? (read.side === "first" ? -1 : 1) : null;
    output[`moneyline_${provenance}_gap_pp`] = read?.gapPp ?? null;
  }
  return output;
}

function splitReads(
  histories: CfbForwardMarketHistoryEvidence[],
  current: CfbForwardMarketReaderObservation,
  market: "moneyline" | "spread" | "total",
): SplitRead[] {
  const observations = [
    ...histories.map((history) => ({
      playbookSplits: history.payload.market.playbookSplits,
      sharpApiSplits: history.payload.market.sharpApiSplits ?? [],
    })),
    current,
  ];
  const buckets = new Map<string, Array<SplitRead & { at: string; money: number }>>();
  for (const observation of observations) {
    const publicSplit = observation.playbookSplits?.[market] ?? null;
    const publicRead = publicSplit ? playbookSide(publicSplit, market) : null;
    if (publicSplit && publicRead) buckets.set("public", [
      ...(buckets.get("public") ?? []),
      { provenance: "public", at: publicSplit.capturedAt, ...publicRead },
    ]);
    for (const record of observation.sharpApiSplits ?? []) {
      const read = sharpSide(record, market);
      if (!read) continue;
      const provenance = record.sportsbook === "circa" && record.sourceSemantics === "sharp_adjacent"
        ? "namedSharp" as const
        : "fallback" as const;
      const key = `${provenance}:${canonicalBook(record.sportsbook)}`;
      buckets.set(key, [...(buckets.get(key) ?? []), { provenance, at: record.capturedAt, ...read }]);
    }
  }
  return [...buckets.values()].flatMap((rows): SplitRead[] => {
    const last = [...rows].sort((first, second) => Date.parse(first.at) - Date.parse(second.at)).at(-1);
    return last ? [{ provenance: last.provenance, side: last.side, gapPp: last.gapPp }] : [];
  });
}

function playbookSide(
  split: CfbForwardPlaybookSplit,
  market: "moneyline" | "spread" | "total",
): { side: Side; gapPp: number; money: number } | null {
  if (market === "total") return null;
  if ([split.awayMoneyPct, split.awayBetsPct, split.homeMoneyPct, split.homeBetsPct].some((value) => value === null)) return null;
  const first = split.awayMoneyPct! - split.awayBetsPct!;
  const second = split.homeMoneyPct! - split.homeBetsPct!;
  if (Math.max(Math.abs(first), Math.abs(second)) < 1e-9) return null;
  return first >= second
    ? { side: "first", gapPp: first, money: split.awayMoneyPct! }
    : { side: "second", gapPp: second, money: split.homeMoneyPct! };
}

function sharpSide(
  record: CfbSharpApiSplitRecord,
  market: "moneyline" | "spread" | "total",
): { side: Side; gapPp: number; money: number } | null {
  const value = market === "moneyline" ? record.moneyline : market === "spread" ? record.spread : null;
  if (!value) return null;
  const first = value.away.moneyPct - value.away.ticketsPct;
  const second = value.home.moneyPct - value.home.ticketsPct;
  if (Math.max(Math.abs(first), Math.abs(second)) < 1e-9) return null;
  return first >= second
    ? { side: "first", gapPp: first, money: value.away.moneyPct }
    : { side: "second", gapPp: second, money: value.home.moneyPct };
}

function applyCompletedGame(states: Map<string, MutableTeamState>, game: CompletedObservation): void {
  const home = resolveState(states, game.homeTeam).state;
  const away = resolveState(states, game.awayTeam).state;
  const homeOffense = Object.fromEntries(artifact.rollingKeys.map((key) => [key, blendedValue(home, key)]));
  const awayOffense = Object.fromEntries(artifact.rollingKeys.map((key) => [key, blendedValue(away, key)]));
  const homeMetrics = {
    ...game.homeMetrics,
    margin: game.homeScore - game.awayScore,
  };
  const awayMetrics = {
    ...game.awayMetrics,
    margin: game.awayScore - game.homeScore,
  };
  observe(home, homeMetrics);
  observe(away, awayMetrics);
  observeDefense(home, awayMetrics, awayOffense);
  observeDefense(away, homeMetrics, homeOffense);
  const expected = 1 / (1 + 10 ** (-(home.elo - away.elo + (game.neutralSite ? 0 : 55)) / 400));
  const outcome = game.homeScore > game.awayScore ? 1 : game.homeScore === game.awayScore ? 0.5 : 0;
  const margin = game.homeScore - game.awayScore;
  const multiplier = Math.log1p(Math.abs(margin)) * (2.2 / ((home.elo - away.elo) * 0.001 + 2.2));
  const delta = 24 * multiplier * (outcome - expected);
  home.elo += delta;
  away.elo -= delta;
  home.lastPlayedAt = game.scheduledStart;
  away.lastPlayedAt = game.scheduledStart;
}

function observe(state: MutableTeamState, metrics: CfbCurrentAdvancedMetrics): void {
  state.currentGames += 1;
  for (const key of artifact.rollingKeys) {
    const metric = metrics[key];
    if (typeof metric !== "number" || !Number.isFinite(metric)) continue;
    state.sums[key] = (state.sums[key] ?? 0) + metric;
    state.counts[key] = (state.counts[key] ?? 0) + 1;
    state.recent[key] = [...(state.recent[key] ?? []), metric].slice(-RECENT_WINDOW);
  }
  const numerator = metrics.qb_epa_numerator;
  const attempts = metrics.qb_attempts;
  if (typeof numerator === "number" && Number.isFinite(numerator) &&
      typeof attempts === "number" && Number.isFinite(attempts) && attempts > 0) {
    state.qbEpaNumerator += numerator;
    state.qbAttempts += attempts;
  }
}

function observeDefense(
  state: MutableTeamState,
  opponentMetrics: CfbCurrentAdvancedMetrics,
  opponentExpectation: Record<string, number>,
): void {
  for (const key of artifact.rollingKeys) {
    const metric = opponentMetrics[key];
    if (typeof metric !== "number" || !Number.isFinite(metric)) continue;
    state.defenseSums[key] = (state.defenseSums[key] ?? 0) + metric - opponentExpectation[key]!;
    state.defenseCounts[key] = (state.defenseCounts[key] ?? 0) + 1;
  }
}

function blendedValue(state: MutableTeamState, key: string): number {
  const prior = state.profile.rolling[key] ?? GLOBAL_MEANS[key] ?? 0;
  if (state.currentGames === 0 || !state.counts[key]) return prior;
  const current = state.sums[key]! / state.counts[key]!;
  const weight = state.currentGames / (state.currentGames + CURRENT_SEASON_PRIOR_GAMES);
  return weight * current + (1 - weight) * prior;
}

function blendedDefenseValue(state: MutableTeamState, key: string): number {
  const prior = state.profile.defenseRolling[key] ?? 0;
  if (state.currentGames === 0 || !state.defenseCounts[key]) return prior;
  const current = state.defenseSums[key]! / state.defenseCounts[key]!;
  const weight = state.currentGames / (state.currentGames + CURRENT_SEASON_PRIOR_GAMES);
  return weight * current + (1 - weight) * prior;
}

function blendedRecentValue(state: MutableTeamState, key: string): number {
  const prior = state.profile.recentRolling[key] ?? GLOBAL_MEANS[key] ?? 0;
  const values = state.recent[key] ?? [];
  if (state.currentGames === 0 || values.length === 0) return prior;
  const current = values.reduce((sum, value) => sum + value, 0) / values.length;
  const observed = Math.min(state.currentGames, RECENT_WINDOW);
  const weight = observed / (observed + RECENT_PRIOR_GAMES);
  return weight * current + (1 - weight) * prior;
}

function blendedQbEpa(state: MutableTeamState): number {
  const prior = state.profile.qbEpaVolume ?? 0;
  if (state.currentGames === 0 || state.qbAttempts <= 0) return prior;
  const current = state.qbEpaNumerator / state.qbAttempts;
  const weight = state.currentGames / (state.currentGames + CURRENT_SEASON_PRIOR_GAMES);
  return weight * current + (1 - weight) * prior;
}

function predictLogistic(model: LogisticPipeline, features: Record<string, NullableNumber>): number {
  const missing = model.inputFeatures.map((name) => {
    const value = features[name];
    return value === null || value === undefined || !Number.isFinite(value);
  });
  const values = model.inputFeatures.map((name, index) => missing[index]
    ? model.imputerStatistics[index]!
    : features[name]!);
  const transformed = [
    ...values,
    ...model.missingIndicatorFeatureIndexes.map((index) => missing[index] ? 1 : 0),
  ];
  if (transformed.length !== model.coefficients.length ||
      transformed.length !== model.scalerMean.length ||
      transformed.length !== model.scalerScale.length) {
    throw new Error("CFB winner coordinator transformed feature shape is invalid.");
  }
  const logit = transformed.reduce((sum, value, index) => {
    const scale = model.scalerScale[index]!;
    const standardized = scale === 0 ? 0 : (value - model.scalerMean[index]!) / scale;
    return sum + standardized * model.coefficients[index]!;
  }, model.intercept);
  return sigmoid(logit);
}

function toScoreOnlyObservation(game: NcaafGame): CompletedObservation {
  return {
    sourceGameId: game.providerGameId,
    season: game.season,
    scheduledStart: game.scheduledStart,
    neutralSite: game.neutralSite === true,
    homeTeam: game.home.name,
    awayTeam: game.away.name,
    homeScore: game.homeScore!,
    awayScore: game.awayScore!,
    homeMetrics: {},
    awayMetrics: {},
  };
}

function observationKey(game: CfbCurrentAdvancedGame | NcaafGame): string {
  const home = "homeTeam" in game ? game.homeTeam : game.home.name;
  const away = "awayTeam" in game ? game.awayTeam : game.away.name;
  return `${game.scheduledStart.slice(0, 10)}:${foldName(away)}:${foldName(home)}`;
}

function compareObservation(first: CompletedObservation, second: CompletedObservation): number {
  return Date.parse(first.scheduledStart) - Date.parse(second.scheduledStart) ||
    first.sourceGameId.localeCompare(second.sourceGameId);
}

function implied(price: number): number {
  return price > 0 ? 100 / (price + 100) : -price / (-price + 100);
}

function canonicalBook(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function median(values: number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function restDays(lastPlayedAt: string | null, startsAt: string): number {
  return lastPlayedAt ? (Date.parse(startsAt) - Date.parse(lastPlayedAt)) / 86_400_000 : 14;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replaceAll("'", "").replaceAll(".", "").trim().replace(/\s+/g, " ");
}

function foldName(value: string): string {
  return normalizeName(value).normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-clamp(value, -35, 35)));
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function assertArtifact(): void {
  if (artifact.artifactRelease !== CFB_FINAL_WINNER_COORDINATOR_ARTIFACT_RELEASE ||
      artifact.modelRelease !== CFB_FINAL_WINNER_COORDINATOR_RELEASE) {
    throw new Error("CFB winner coordinator release mismatch.");
  }
  if (artifact.season !== 2026 || Object.keys(artifact.teamProfiles).length < 700) {
    throw new Error("CFB winner coordinator team coverage is incomplete.");
  }
  if (artifact.model.inputFeatures.length !== artifact.model.imputerStatistics.length) {
    throw new Error("CFB winner coordinator imputer shape is invalid.");
  }
}
