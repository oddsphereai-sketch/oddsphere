import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { NflPreviewGame } from "./balldontlieNflPreviewSlate";
import type { NflForwardWeatherSnapshot } from "./nflForwardEvidence";
import type { NflPlayerPropsCurrentSeasonState } from "./nflPlayerPropsCurrentSeasonState";

export const NFL_EXACT_PROVIDER_SCORE_ARTIFACT_RELEASE =
  "nfl_exact_provider_score_artifact_2026_10_15_r11" as const;
export const NFL_EXACT_PROVIDER_SCORE_MODEL_RELEASE =
  "nfl_exact_provider_independent_score_2026_10_15_r11" as const;
export const NFL_EXACT_PROVIDER_MARGIN_RELEASE =
  "nfl_exact_provider_margin_2026_10_15_r7" as const;
export const NFL_EXACT_PROVIDER_TOTAL_RELEASE =
  "nfl_exact_provider_state_residual_total_2026_10_15_r10" as const;
export const NFL_EXACT_PROVIDER_RUNTIME_RELEASE =
  "nfl_exact_provider_score_runtime_2026_10_15_r1" as const;

type Metric = "explosive_rate" | "sack_rate" | "turnover_rate" | "plays" |
  "redzone_td_rate" | "no_huddle_rate" | "points";
type Metrics = Record<Metric, number>;
type TeamState = {
  offFast: Metrics;
  offSlow: Metrics;
  defFast: Metrics;
  defSlow: Metrics;
  offAdjusted: Metrics;
  defAdjusted: Metrics;
  elo: number;
  games: number;
};
type TreeNode = [number, number, number, number, number, number, number];
type Tree = { nodes: TreeNode[] };
type PortableModel = {
  kind: "linear_regressor" | "extra_trees_regressor" | "hgb_regressor";
  inputFeatures: string[];
  imputerStatistics: Array<number | null>;
  missingIndicatorFeatureIndexes: number[];
  scalerMean?: number[];
  scalerScale?: number[];
  coefficients?: number[];
  intercept?: number;
  baseline?: number;
  trees: Tree[] | Tree[][];
};
type Artifact = {
  artifactRelease: typeof NFL_EXACT_PROVIDER_SCORE_ARTIFACT_RELEASE;
  modelRelease: typeof NFL_EXACT_PROVIDER_SCORE_MODEL_RELEASE;
  marginRelease: typeof NFL_EXACT_PROVIDER_MARGIN_RELEASE;
  totalRelease: typeof NFL_EXACT_PROVIDER_TOTAL_RELEASE;
  featureRelease: string;
  marketInputPolicy: "prohibited_from_independent_score";
  metrics: Metric[];
  priors: Metrics;
  teamState: {
    fastAlpha: number;
    slowAlpha: number;
    offseasonCarry: number;
    trainedThroughSeason: number;
    completeThroughWeek: number;
    teams: Record<string, TeamState>;
  };
  dynamicTotalState: {
    stateGain: number;
    offseasonCarry: number;
    homeFieldMargin: number;
    leagueGain: number;
    trainedThroughSeason: number;
    completeThroughWeek: number;
    leaguePoints: number;
    teams: Record<string, { offense: number; defense: number }>;
  };
  models: {
    margin: PortableModel;
    totalResidualComponents: Record<string, PortableModel>;
  };
  totalResidual: {
    componentWeights: Record<string, number>;
    weight: number;
    cap: number;
  };
  parity: {
    rows: number;
    maximumAbsoluteMarginError: number;
    maximumAbsoluteTotalError: number;
    cases: Array<{ gameId: string; features: Record<string, number | null>; baseTotal: number; margin: number; total: number }>;
  };
};

// Keep the generated tree payload outside the TypeScript AST. The route trace
// explicitly packages this deterministic asset for the server runtime.
const ARTIFACT = JSON.parse(
  gunzipSync(readFileSync(path.join(
    process.cwd(),
    "lib/services/football/modelArtifacts/nflExactProviderScoreR11.json.gz",
  ))).toString("utf8"),
) as Artifact;
const METRICS: readonly Metric[] = [
  "explosive_rate", "sack_rate", "turnover_rate", "plays",
  "redzone_td_rate", "no_huddle_rate", "points",
];

export type NflExactProviderScoreContext = {
  season: 2026;
  week: number;
  homeTeam: string;
  awayTeam: string;
  neutralSite: boolean;
  divisionGame: boolean;
  homeRestDays: number;
  awayRestDays: number;
  roofIndoor: boolean;
  surfaceGrass: boolean;
};

export type NflExactProviderIndependentScore = {
  release: typeof NFL_EXACT_PROVIDER_RUNTIME_RELEASE;
  artifactRelease: typeof NFL_EXACT_PROVIDER_SCORE_ARTIFACT_RELEASE;
  modelRelease: typeof NFL_EXACT_PROVIDER_SCORE_MODEL_RELEASE;
  marginRelease: typeof NFL_EXACT_PROVIDER_MARGIN_RELEASE;
  totalRelease: typeof NFL_EXACT_PROVIDER_TOTAL_RELEASE;
  marketInputPolicy: "prohibited_from_independent_score";
  homeTeam: string;
  awayTeam: string;
  expectedHomeScore: number;
  expectedAwayScore: number;
  expectedHomeMargin: number;
  expectedTotal: number;
  completeThroughWeek: number;
};

export function buildNflExactProviderScoreContext(args: {
  game: NflPreviewGame;
  currentSeasonState: NflPlayerPropsCurrentSeasonState;
  weather: NflForwardWeatherSnapshot;
}): NflExactProviderScoreContext {
  const startsAt = Date.parse(args.game.scheduledStart);
  if (!Number.isFinite(startsAt)) throw new Error("NFL exact-provider score game start is invalid.");
  const home = normalizeTeam(args.game.home.abbreviation);
  const away = normalizeTeam(args.game.away.abbreviation);
  return {
    season: 2026,
    week: args.game.providerWeek,
    homeTeam: home,
    awayTeam: away,
    neutralSite: isNeutralVenue(args.game.venue),
    divisionGame: args.game.home.conference !== undefined && args.game.away.conference !== undefined
      && args.game.home.division !== undefined && args.game.away.division !== undefined
      ? args.game.home.conference === args.game.away.conference && args.game.home.division === args.game.away.division
      : sameDivision(home, away),
    homeRestDays: priorRestDays(args.currentSeasonState, home, startsAt),
    awayRestDays: priorRestDays(args.currentSeasonState, away, startsAt),
    roofIndoor: args.weather.roofType === "fixed" || args.weather.status === "controlled_indoor",
    surfaceGrass: isGrassSurface(home, args.game.venue),
  };
}

export function buildNflExactProviderIndependentScore(args: {
  context: NflExactProviderScoreContext;
  currentSeasonState: NflPlayerPropsCurrentSeasonState;
}): NflExactProviderIndependentScore {
  validateArtifact();
  if (args.currentSeasonState.season !== args.context.season) {
    throw new Error("NFL exact-provider score state season mismatch.");
  }
  const home = normalizeTeam(args.context.homeTeam);
  const away = normalizeTeam(args.context.awayTeam);
  if (home === away) throw new Error("NFL exact-provider score requires distinct teams.");
  const teamStates = cloneTeamStates();
  const dynamic = cloneDynamicState();
  applyCompletedWeeks(teamStates, dynamic, args.currentSeasonState);
  const homeState = teamStates[home];
  const awayState = teamStates[away];
  const homeDynamic = dynamic.teams[home];
  const awayDynamic = dynamic.teams[away];
  if (!homeState || !awayState || !homeDynamic || !awayDynamic) {
    throw new Error(`NFL exact-provider score state is missing ${away}@${home}.`);
  }
  const features = buildFeatures(args.context, homeState, awayState);
  const baseHome = dynamic.leaguePoints + homeDynamic.offense + awayDynamic.defense + ARTIFACT.dynamicTotalState.homeFieldMargin / 2;
  const baseAway = dynamic.leaguePoints + awayDynamic.offense + homeDynamic.defense - ARTIFACT.dynamicTotalState.homeFieldMargin / 2;
  const evaluated = evaluateNflExactProviderModelsForParity(features, baseHome + baseAway);
  return {
    release: NFL_EXACT_PROVIDER_RUNTIME_RELEASE,
    artifactRelease: NFL_EXACT_PROVIDER_SCORE_ARTIFACT_RELEASE,
    modelRelease: NFL_EXACT_PROVIDER_SCORE_MODEL_RELEASE,
    marginRelease: NFL_EXACT_PROVIDER_MARGIN_RELEASE,
    totalRelease: NFL_EXACT_PROVIDER_TOTAL_RELEASE,
    marketInputPolicy: "prohibited_from_independent_score",
    homeTeam: home,
    awayTeam: away,
    expectedHomeScore: (evaluated.total + evaluated.margin) / 2,
    expectedAwayScore: (evaluated.total - evaluated.margin) / 2,
    expectedHomeMargin: evaluated.margin,
    expectedTotal: evaluated.total,
    completeThroughWeek: Math.max(ARTIFACT.teamState.completeThroughWeek, args.currentSeasonState.completeThroughWeek),
  };
}

export function evaluateNflExactProviderModelsForParity(
  features: Readonly<Record<string, number | null>>,
  baseTotal: number,
): { margin: number; total: number } {
  const margin = predict(ARTIFACT.models.margin, features);
  const correction = Object.entries(ARTIFACT.models.totalResidualComponents).reduce((sum, [name, model]) =>
    sum + (ARTIFACT.totalResidual.componentWeights[name] ?? 0) * predict(model, features), 0);
  const total = baseTotal + clamp(
    ARTIFACT.totalResidual.weight * correction,
    -ARTIFACT.totalResidual.cap,
    ARTIFACT.totalResidual.cap,
  );
  return { margin, total };
}

export function nflExactProviderParityCases(): Readonly<Artifact["parity"]["cases"]> {
  return ARTIFACT.parity.cases;
}

function cloneTeamStates(): Record<string, TeamState> {
  return Object.fromEntries(Object.entries(ARTIFACT.teamState.teams).map(([team, state]) => [team, {
    offFast: { ...state.offFast }, offSlow: { ...state.offSlow },
    defFast: { ...state.defFast }, defSlow: { ...state.defSlow },
    offAdjusted: { ...state.offAdjusted }, defAdjusted: { ...state.defAdjusted },
    elo: state.elo, games: state.games,
  }]));
}

function cloneDynamicState(): { leaguePoints: number; teams: Record<string, { offense: number; defense: number }> } {
  return {
    leaguePoints: ARTIFACT.dynamicTotalState.leaguePoints,
    teams: Object.fromEntries(Object.entries(ARTIFACT.dynamicTotalState.teams).map(([team, state]) => [team, { ...state }])),
  };
}

function applyCompletedWeeks(
  states: Record<string, TeamState>,
  dynamic: { leaguePoints: number; teams: Record<string, { offense: number; defense: number }> },
  current: NflPlayerPropsCurrentSeasonState,
): void {
  const startWeek = ARTIFACT.teamState.completeThroughWeek + 1;
  const endWeek = current.completeThroughWeek;
  if (endWeek < startWeek) return;
  for (let week = startWeek; week <= endWeek; week += 1) {
    const teamRows = current.teamStats.filter((row) => row.week === week);
    const playRows = current.playMetrics.filter((row) => row.week === week);
    const games = current.games.filter((row) => row.week === week);
    if (teamRows.length !== games.length * 2 || playRows.length !== games.length * 2 || games.length === 0) {
      throw new Error(`NFL exact-provider score has incomplete Week ${week} state.`);
    }
    const playByIdentity = new Map(playRows.map((row) => [`${row.gameId}|${normalizeTeam(row.team)}`, row]));
    const observations = new Map<string, { opponent: string; values: Metrics }>();
    for (const row of teamRows) {
      const team = normalizeTeam(row.team);
      const play = playByIdentity.get(`${row.gameId}|${team}`);
      if (!play || play.validPlays < 1) throw new Error(`NFL exact-provider play metrics are missing ${row.gameId}|${team}.`);
      observations.set(team, {
        opponent: normalizeTeam(row.opponent),
        values: {
          explosive_rate: play.explosiveRate,
          sack_rate: row.sacksAllowed / Math.max(1, row.passingAttempts + row.sacksAllowed),
          turnover_rate: row.turnovers / play.validPlays,
          plays: play.validPlays,
          redzone_td_rate: row.redZoneAttempts > 0 ? row.redZoneScores / row.redZoneAttempts : ARTIFACT.priors.redzone_td_rate,
          no_huddle_rate: play.noHuddleRate,
          points: row.pointsFor,
        },
      });
    }
    const snapshot = cloneWeekStates(states);
    for (const [team, observation] of observations) {
      const state = states[team];
      const preOpponent = snapshot[observation.opponent];
      const opponent = observations.get(observation.opponent);
      if (!state || !preOpponent || !opponent || opponent.opponent !== team) {
        throw new Error(`NFL exact-provider score has incomplete opponent state for ${team}.`);
      }
      for (const metric of METRICS) {
        const prior = ARTIFACT.priors[metric];
        const observed = observation.values[metric];
        const allowed = opponent.values[metric];
        state.offFast[metric] = ewm(state.offFast[metric], observed, ARTIFACT.teamState.fastAlpha);
        state.offSlow[metric] = ewm(state.offSlow[metric], observed, ARTIFACT.teamState.slowAlpha);
        state.defFast[metric] = ewm(state.defFast[metric], allowed, ARTIFACT.teamState.fastAlpha);
        state.defSlow[metric] = ewm(state.defSlow[metric], allowed, ARTIFACT.teamState.slowAlpha);
        state.offAdjusted[metric] = ewm(state.offAdjusted[metric], observed - (preOpponent.defSlow[metric] - prior), ARTIFACT.teamState.slowAlpha);
        state.defAdjusted[metric] = ewm(state.defAdjusted[metric], allowed - (preOpponent.offSlow[metric] - prior), ARTIFACT.teamState.slowAlpha);
      }
      state.games += 1;
    }
    applyEloWeek(states, snapshot, games);
    applyDynamicWeek(dynamic, games);
  }
}

function cloneWeekStates(states: Record<string, TeamState>): Record<string, TeamState> {
  return Object.fromEntries(Object.entries(states).map(([team, state]) => [team, {
    offFast: { ...state.offFast }, offSlow: { ...state.offSlow },
    defFast: { ...state.defFast }, defSlow: { ...state.defSlow },
    offAdjusted: { ...state.offAdjusted }, defAdjusted: { ...state.defAdjusted },
    elo: state.elo, games: state.games,
  }]));
}

function applyEloWeek(
  states: Record<string, TeamState>,
  snapshot: Record<string, TeamState>,
  games: NflPlayerPropsCurrentSeasonState["games"],
): void {
  for (const game of games) {
    const home = normalizeTeam(game.homeTeam); const away = normalizeTeam(game.awayTeam);
    const preHome = snapshot[home]; const preAway = snapshot[away];
    if (!preHome || !preAway || !states[home] || !states[away]) throw new Error(`NFL Elo state missing ${away}@${home}.`);
    const expectedHome = 1 / (1 + 10 ** (-(preHome.elo - preAway.elo + 45) / 400));
    const margin = game.homeScore - game.awayScore;
    const outcome = margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
    const multiplier = Math.log1p(Math.abs(margin)) * (2.2 / (Math.abs(preHome.elo - preAway.elo) * 0.001 + 2.2));
    const change = 20 * multiplier * (outcome - expectedHome);
    states[home].elo += change; states[away].elo -= change;
  }
}

function applyDynamicWeek(
  state: { leaguePoints: number; teams: Record<string, { offense: number; defense: number }> },
  games: NflPlayerPropsCurrentSeasonState["games"],
): void {
  const updates: Array<{ team: string; unit: "offense" | "defense"; residual: number }> = [];
  const scores: number[] = [];
  for (const game of games) {
    const home = normalizeTeam(game.homeTeam); const away = normalizeTeam(game.awayTeam);
    const homeState = state.teams[home]; const awayState = state.teams[away];
    if (!homeState || !awayState) throw new Error(`NFL dynamic total state missing ${away}@${home}.`);
    const expectedHome = state.leaguePoints + homeState.offense + awayState.defense + ARTIFACT.dynamicTotalState.homeFieldMargin / 2;
    const expectedAway = state.leaguePoints + awayState.offense + homeState.defense - ARTIFACT.dynamicTotalState.homeFieldMargin / 2;
    const homeResidual = game.homeScore - expectedHome; const awayResidual = game.awayScore - expectedAway;
    updates.push(
      { team: home, unit: "offense", residual: homeResidual }, { team: away, unit: "defense", residual: homeResidual },
      { team: away, unit: "offense", residual: awayResidual }, { team: home, unit: "defense", residual: awayResidual },
    );
    scores.push(game.homeScore, game.awayScore);
  }
  for (const update of updates) state.teams[update.team][update.unit] += ARTIFACT.dynamicTotalState.stateGain * update.residual / 2;
  const teams = Object.values(state.teams);
  const offenseMean = mean(teams.map((team) => team.offense));
  const defenseMean = mean(teams.map((team) => team.defense));
  for (const team of teams) { team.offense -= offenseMean; team.defense -= defenseMean; }
  state.leaguePoints = (1 - ARTIFACT.dynamicTotalState.leagueGain) * state.leaguePoints
    + ARTIFACT.dynamicTotalState.leagueGain * mean(scores);
}

function buildFeatures(context: NflExactProviderScoreContext, home: TeamState, away: TeamState): Record<string, number> {
  const values: Record<string, number> = {
    home_field: context.neutralSite ? 0 : 1,
    neutral_site: context.neutralSite ? 1 : 0,
    division_game: context.divisionGame ? 1 : 0,
    rest_diff: context.homeRestDays - context.awayRestDays,
    rest_sum: context.homeRestDays + context.awayRestDays,
    roof_indoor: context.roofIndoor ? 1 : 0,
    surface_grass: context.surfaceGrass ? 1 : 0,
    week: context.week,
    elo_diff: home.elo - away.elo,
    elo_sum_centered: home.elo + away.elo - 3000,
    games_state_min: Math.min(home.games, away.games),
  };
  for (const metric of METRICS) {
    const prior = ARTIFACT.priors[metric];
    for (const speed of ["Fast", "Slow"] as const) {
      const homeMatchup = home[`off${speed}`][metric] - (away[`def${speed}`][metric] - prior);
      const awayMatchup = away[`off${speed}`][metric] - (home[`def${speed}`][metric] - prior);
      values[`matchup_${speed.toLowerCase()}_${metric}_diff`] = homeMatchup - awayMatchup;
      values[`matchup_${speed.toLowerCase()}_${metric}_sum`] = homeMatchup + awayMatchup - 2 * prior;
    }
    const homeAdjusted = home.offAdjusted[metric] - (away.defAdjusted[metric] - prior);
    const awayAdjusted = away.offAdjusted[metric] - (home.defAdjusted[metric] - prior);
    values[`matchup_adjusted_${metric}_diff`] = homeAdjusted - awayAdjusted;
    values[`matchup_adjusted_${metric}_sum`] = homeAdjusted + awayAdjusted - 2 * prior;
  }
  return values;
}

function predict(model: PortableModel, features: Readonly<Record<string, number | null>>): number {
  const raw = model.inputFeatures.map((name) => features[name] ?? Number.NaN);
  const missing = raw.map((value) => !Number.isFinite(value));
  const values = raw.map((value, index) => missing[index] ? (model.imputerStatistics[index] ?? 0) : value);
  for (const index of model.missingIndicatorFeatureIndexes) values.push(missing[index] ? 1 : 0);
  if (model.kind === "linear_regressor") {
    const scaled = values.map((value, index) => (value - model.scalerMean![index]) / model.scalerScale![index]);
    return model.intercept! + model.coefficients!.reduce((sum, value, index) => sum + value * scaled[index], 0);
  }
  if (model.kind === "extra_trees_regressor") return mean((model.trees as Tree[]).map((tree) => walk(tree, values)));
  return model.baseline! + (model.trees as Tree[][]).reduce((sum, iteration) =>
    sum + iteration.reduce((treeSum, tree) => treeSum + walk(tree, values), 0), 0);
}

function walk(tree: Tree, features: number[]): number {
  let index = 0;
  while (!tree.nodes[index][6]) {
    const node = tree.nodes[index]; const value = features[node[1]];
    index = !Number.isFinite(value) ? (node[3] ? node[4] : node[5]) : value <= node[2] ? node[4] : node[5];
  }
  return tree.nodes[index][0];
}

function validateArtifact(): void {
  if (ARTIFACT.artifactRelease !== NFL_EXACT_PROVIDER_SCORE_ARTIFACT_RELEASE
    || ARTIFACT.modelRelease !== NFL_EXACT_PROVIDER_SCORE_MODEL_RELEASE
    || ARTIFACT.marginRelease !== NFL_EXACT_PROVIDER_MARGIN_RELEASE
    || ARTIFACT.totalRelease !== NFL_EXACT_PROVIDER_TOTAL_RELEASE
    || ARTIFACT.marketInputPolicy !== "prohibited_from_independent_score"
    || ARTIFACT.teamState.completeThroughWeek !== 5
    || ARTIFACT.dynamicTotalState.completeThroughWeek !== 5
    || Object.keys(ARTIFACT.teamState.teams).length !== 32
    || ARTIFACT.parity.rows !== 79) {
    throw new Error("NFL exact-provider score artifact contract mismatch.");
  }
}

const DIVISIONS = [
  ["BUF", "MIA", "NE", "NYJ"], ["BAL", "CIN", "CLE", "PIT"],
  ["HOU", "IND", "JAX", "TEN"], ["DEN", "KC", "LAC", "LV"],
  ["DAL", "NYG", "PHI", "WAS"], ["CHI", "DET", "GB", "MIN"],
  ["ATL", "CAR", "NO", "TB"], ["ARI", "LA", "SEA", "SF"],
] as const;
const GRASS_HOME_TEAMS = new Set([
  "ARI", "BAL", "BUF", "CHI", "CLE", "DEN", "GB", "JAX", "KC",
  "LV", "MIA", "PHI", "PIT", "SF", "TB", "WAS",
]);

function priorRestDays(state: NflPlayerPropsCurrentSeasonState, team: string, startsAt: number): number {
  const prior = state.games
    .filter((game) => (normalizeTeam(game.homeTeam) === team || normalizeTeam(game.awayTeam) === team)
      && Date.parse(game.scheduledStart) < startsAt)
    .sort((first, second) => Date.parse(second.scheduledStart) - Date.parse(first.scheduledStart))[0];
  if (!prior) return 7;
  return Math.max(1, Math.round((startsAt - Date.parse(prior.scheduledStart)) / 86_400_000));
}

function sameDivision(first: string, second: string): boolean {
  return DIVISIONS.some((division) => (division as readonly string[]).includes(first) && (division as readonly string[]).includes(second));
}

function isNeutralVenue(venue: string | undefined): boolean {
  return venue !== undefined && /wembley|tottenham|deutsche bank park|allianz arena|arena corinthians|santiago bernab/i.test(venue);
}

function isGrassSurface(home: string, venue: string | undefined): boolean {
  if (venue && /wembley|tottenham|deutsche bank park|allianz arena|arena corinthians|santiago bernab/i.test(venue)) return true;
  return GRASS_HOME_TEAMS.has(home);
}

function normalizeTeam(value: string): string {
  const team = value.trim().toUpperCase();
  return ({ LAR: "LA", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LA" } as Record<string, string>)[team] ?? team;
}
function ewm(previous: number, observed: number, alpha: number): number { return alpha * observed + (1 - alpha) * previous; }
function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }
function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }

validateArtifact();
