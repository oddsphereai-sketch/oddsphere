import { CBB_MODEL_RELEASE } from "./releases";
import type { CbbForecast, CbbFourFactors, CbbModelConfig, CbbRatingState, CbbTeamRating, CbbTrainingGame, CbbUncertainty } from "./types";

export const CBB_CANDIDATES: readonly CbbModelConfig[] = Object.freeze([
  { id: "adjusted_ridge_6_carry_45", ridge: 6, priorCarry: 0.45, recencyDays: 60 },
  { id: "adjusted_ridge_10_carry_65", ridge: 10, priorCarry: 0.65, recencyDays: 60 },
  { id: "adjusted_ridge_14_carry_65", ridge: 14, priorCarry: 0.65, recencyDays: 90 },
  { id: "adjusted_ridge_10_carry_80", ridge: 10, priorCarry: 0.8, recencyDays: 90 },
]);

const empty = (): CbbTeamRating => ({ offense: 0, defense: 0, pace: 0, games: 0, factors: null, opponentFactors: null });
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const factorKeys = ["efg", "turnoverRate", "offensiveReboundRate", "freeThrowRate"] as const;

/** Regularized additive schedule adjustment; current-season information replaces priors through data precision. */
export function fitCbbRatings(history: CbbTrainingGame[], options: {
  season: number; asOf: string; config: CbbModelConfig; prior?: CbbRatingState;
}): CbbRatingState {
  const { season, asOf, config, prior } = options;
  if (!Number.isFinite(Date.parse(asOf))) throw new Error("CBB invalid as-of time");
  if (prior && (prior.season >= season || Date.parse(prior.asOf) > Date.parse(asOf))) throw new Error("CBB future prior rejected");
  // Archives identify start, not final-whistle receipt. A conservative six-hour
  // lag additionally prevents a late previous-day game leaking into midnight forecasts.
  const current = history.filter(game => game.season === season &&
    Date.parse(game.date) + 6 * 60 * 60 * 1000 <= Date.parse(asOf) && game.neutral !== null);
  const ids = new Set<number>([...Object.keys(prior?.teams ?? {}).map(Number), ...current.flatMap(game => [game.homeId, game.awayId])]);
  const teams: Record<number, CbbTeamRating> = {};
  const priors = new Map<number, CbbTeamRating>();
  for (const id of ids) {
    const old = prior?.teams[id];
    const base = empty();
    base.offense = (old?.offense ?? 0) * config.priorCarry;
    base.defense = (old?.defense ?? 0) * config.priorCarry;
    base.pace = (old?.pace ?? 0) * config.priorCarry;
    priors.set(id, base); teams[id] = { ...base };
  }
  const weights = current.map(game => Math.exp(-Math.max(0, (Date.parse(asOf) - Date.parse(game.date)) / 86400000) / config.recencyDays));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const leagueEfficiency = ((prior?.leagueEfficiency ?? 103) * 100 + current.reduce((sum, game, index) =>
    sum + weights[index] * 50 * (game.homeScore + game.awayScore) / game.possessions, 0)) / (100 + totalWeight);
  const leagueTempo = ((prior?.leagueTempo ?? 69) * 100 + current.reduce((sum, game, index) => sum + weights[index] * game.tempo, 0)) / (100 + totalWeight);
  let homeEfficiency = prior?.homeEfficiency ?? 4;
  const teamRows = new Map<number, Array<{ own: number; opponent: number; opponentId: number; home: number; pace: number; weight: number; factors: CbbFourFactors; opponentFactors: CbbFourFactors }>>();
  for (let i = 0; i < current.length; i++) {
    const game = current[i], weight = weights[i], h = game.neutral ? 0 : 0.5;
    for (const [id, opponentId, own, opponent, home, factors, opponentFactors] of [
      [game.homeId, game.awayId, game.homeScore, game.awayScore, h, game.homeFactors, game.awayFactors],
      [game.awayId, game.homeId, game.awayScore, game.homeScore, -h, game.awayFactors, game.homeFactors],
    ] as const) {
      const rows = teamRows.get(id) ?? [];
      rows.push({ own: 100 * own / game.possessions, opponent: 100 * opponent / game.possessions, opponentId,
        home, pace: game.tempo, weight, factors, opponentFactors });
      teamRows.set(id, rows);
    }
  }
  for (const [id, rows] of teamRows) {
    teams[id].games = rows.length;
    teams[id].factors = Object.fromEntries(factorKeys.map(key => [key, mean(rows.map(row => row.factors[key]))])) as CbbFourFactors;
    teams[id].opponentFactors = Object.fromEntries(factorKeys.map(key => [key, mean(rows.map(row => row.opponentFactors[key]))])) as CbbFourFactors;
  }
  for (let iteration = 0; iteration < 24; iteration++) {
    for (const [id, rows] of teamRows) {
      const base = priors.get(id)!;
      let off = config.ridge * base.offense, def = config.ridge * base.defense;
      let pace = config.ridge * base.pace, precision = config.ridge, pacePrecision = config.ridge;
      for (const row of rows) {
        const opp = teams[row.opponentId];
        off += row.weight * (row.own - leagueEfficiency - opp.defense - row.home * homeEfficiency);
        def += row.weight * (row.opponent - leagueEfficiency - opp.offense + row.home * homeEfficiency);
        pace += row.weight * 0.5 * (row.pace - leagueTempo - 0.5 * opp.pace);
        precision += row.weight; pacePrecision += row.weight * 0.25;
      }
      teams[id].offense = off / precision; teams[id].defense = def / precision;
      teams[id].pace = pace / pacePrecision;
    }
    let hNum = 20 * (prior?.homeEfficiency ?? 4), hDen = 20;
    for (let i = 0; i < current.length; i++) {
      const game = current[i]; if (game.neutral) continue;
      const home = teams[game.homeId], away = teams[game.awayId];
      const residualMargin = 100 * (game.homeScore - game.awayScore) / game.possessions -
        (home.offense + away.defense - away.offense - home.defense);
      hNum += weights[i] * residualMargin; hDen += weights[i];
    }
    homeEfficiency = hNum / hDen;
  }
  return { release: CBB_MODEL_RELEASE, config, season, asOf, leagueEfficiency, leagueTempo, homeEfficiency,
    teams, trainingGames: current.length };
}

// CDF approximation is stable in both tails. Probabilities are always derived from the same forecast.
export function normalCdf(value: number): number {
  const z = Math.abs(value), t = 1 / (1 + 0.2316419 * z);
  const tail = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) *
    t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return value >= 0 ? 1 - tail : tail;
}

export function forecastCbbGame(state: CbbRatingState, game: {
  id: number; date: string; homeId: number; awayId: number; neutral: boolean | null;
}, uncertainty: CbbUncertainty): CbbForecast {
  if (state.asOf > game.date) throw new Error("CBB forecast cannot consume future state");
  if (uncertainty.fitThroughSeason >= state.season) throw new Error("CBB uncertainty was fitted on the evaluated season");
  if (!(uncertainty.marginSd > 0 && uncertainty.totalSd > 0 && Math.abs(uncertainty.marginTotalCorrelation) < 1)) throw new Error("invalid CBB uncertainty");
  const h = state.teams[game.homeId], a = state.teams[game.awayId];
  const issues: string[] = [];
  if (!h) issues.push("missing_home_team_history"); if (!a) issues.push("missing_away_team_history");
  if (game.neutral === null) issues.push("unverified_venue");
  const home = h ?? empty(), away = a ?? empty();
  const possessions = state.leagueTempo + 0.5 * (home.pace + away.pace);
  const homeEfficiency = state.leagueEfficiency + home.offense + away.defense + (game.neutral === false ? state.homeEfficiency / 2 : 0);
  const awayEfficiency = state.leagueEfficiency + away.offense + home.defense - (game.neutral === false ? state.homeEfficiency / 2 : 0);
  const homeScore = homeEfficiency * possessions / 100 + (uncertainty.totalCorrection + uncertainty.marginCorrection) / 2;
  const awayScore = awayEfficiency * possessions / 100 + (uncertainty.totalCorrection - uncertainty.marginCorrection) / 2;
  if (possessions <= 0 || homeScore <= 0 || awayScore <= 0) throw new Error("invalid CBB score fit");
  const margin = homeScore - awayScore, total = homeScore + awayScore;
  const zeroMass = normalCdf((0.5 - margin) / uncertainty.marginSd) - normalCdf((-0.5 - margin) / uncertainty.marginSd);
  const homeWinProbability = (1 - normalCdf((0.5 - margin) / uncertainty.marginSd)) / (1 - zeroMass);
  return { release: state.release, gameId: game.id, asOf: state.asOf, homeId: game.homeId, awayId: game.awayId,
    homeScore, awayScore, margin, total, possessions, uncertainty,
    homeWinProbability, inputStatus: issues.length ? "incomplete" : "complete", issues };
}

/** Integer score thresholds with continuity correction retain W/L/push, including alternative lines. */
export function cbbThresholdProbabilities(forecast: CbbForecast, market: "moneyline" | "spread" | "total", line: number | null) {
  if (market === "moneyline") return { first: forecast.homeWinProbability, second: 1 - forecast.homeWinProbability, push: 0 };
  if (line === null || !Number.isFinite(line) || Math.round(line * 2) !== line * 2) throw new Error("CBB requires an exact integer/half-point line");
  const threshold = market === "spread" ? -line : line;
  const center = market === "spread" ? forecast.margin : forecast.total;
  const sd = market === "spread" ? forecast.uncertainty.marginSd : forecast.uncertainty.totalSd;
  const integer = Number.isInteger(threshold);
  const upper = integer ? threshold + 0.5 : Math.ceil(threshold) - 0.5;
  const lower = integer ? threshold - 0.5 : upper;
  let first = 1 - normalCdf((upper - center) / sd), second = normalCdf((lower - center) / sd);
  let push = Math.max(0, 1 - first - second);
  if (market === "spread") {
    // A completed basketball game cannot tie: remove the impossible zero-margin atom.
    const zero = normalCdf((0.5 - center) / sd) - normalCdf((-0.5 - center) / sd);
    if (threshold < 0) first -= zero;
    else if (threshold > 0) second -= zero;
    else push -= zero;
    first = Math.max(0, first / (1 - zero)); second = Math.max(0, second / (1 - zero)); push = Math.max(0, push / (1 - zero));
  }
  return { first, second, push };
}

export function settleCbbMarket(market: "moneyline" | "spread" | "total", selection: "first" | "second", line: number | null, home: number, away: number): "win" | "loss" | "push" {
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0 || home === away) throw new Error("CBB settlement requires a completed non-tied game");
  if (market !== "moneyline" && (line === null || !Number.isFinite(line))) throw new Error("CBB settlement requires exact line");
  const outcome = market === "total" ? home + away - line! : home - away + (market === "spread" ? line! : 0);
  return outcome === 0 ? "push" : (outcome > 0) === (selection === "first") ? "win" : "loss";
}
