import { forecastCbbGame } from "./model";
import { cbbScoreFeatures, fitCbbScoreResearchState, type CbbScoreFeatureRow, type CbbScoreResearchConfig } from "./scoreResearch";
import type { CbbRatingState, CbbTrainingGame, CbbUncertainty } from "./types";

export const CBB_STRUCTURAL_RESEARCH_RELEASE = "cbb_candidate_2026_10_28_r6_structural_fit";
export type CbbStructuralVariant = { id: string; seasonEndPrior: boolean; dateEnvironment: boolean };
export const CBB_STRUCTURAL_VARIANTS: readonly CbbStructuralVariant[] = [
  { id: "converged", seasonEndPrior: false, dateEnvironment: false },
  { id: "converged_season_end", seasonEndPrior: true, dateEnvironment: false },
  { id: "converged_date_environment", seasonEndPrior: false, dateEnvironment: true },
  { id: "converged_season_end_date_environment", seasonEndPrior: true, dateEnvironment: true },
];
const lag = 21600000;
type Environment = { efficiency: number; tempo: number };
type Observation = { opponent: number; own: number; allowed: number; home: number; tempo: number; weight: number; environment: Environment };
export type CbbFitDiagnostics = { iterations: number; maxChange: number; initialMaxChange: number; converged: boolean; games: number };

/** Each historical observation uses only information known before its UTC day. */
export function cbbHistoricalEnvironments(history: CbbTrainingGame[], season: number, config: CbbScoreResearchConfig, prior?: CbbRatingState) {
  const games = history.filter(g => g.season === season && g.neutral !== null);
  const days = [...new Set(games.map(g => g.date.slice(0, 10)))].sort();
  const environments = new Map<string, Environment>();
  for (const day of days) {
    const at = Date.parse(`${day}T00:00:00.000Z`);
    if (prior && (prior.season >= season || Date.parse(prior.asOf) > at)) throw new Error("future CBB environment prior");
    let precision = 100, efficiency = 100 * (prior?.leagueEfficiency ?? 103), tempo = 100 * (prior?.leagueTempo ?? 69);
    for (const game of games) {
      if (Date.parse(game.date) + lag > at) continue;
      const w = Math.exp(-(at - Date.parse(game.date)) / 86400000 / config.recencyDays);
      precision += w; efficiency += w * 50 * (game.homeScore + game.awayScore) / game.possessions; tempo += w * game.tempo;
    }
    environments.set(day, { efficiency: efficiency / precision, tempo: tempo / precision });
  }
  return environments;
}

/** Refine the existing normal equations; no R2 runtime or existing artifact is changed. */
export function fitCbbStructuralState(history: CbbTrainingGame[], options: {
  season: number; asOf: string; config: CbbScoreResearchConfig; prior?: CbbRatingState;
  variant: CbbStructuralVariant; environments?: Map<string, Environment>;
}): { state: CbbRatingState; diagnostics: CbbFitDiagnostics } {
  const { season, asOf, config, prior, variant } = options;
  const state = fitCbbScoreResearchState(history, options);
  const at = Date.parse(asOf), current = history.filter(g => g.season === season && g.neutral !== null && Date.parse(g.date) + lag <= at);
  const environments = options.environments ?? (variant.dateEnvironment ? cbbHistoricalEnvironments(history, season, config, prior) : undefined);
  const currentEnvironment = { efficiency: state.leagueEfficiency, tempo: state.leagueTempo };
  const rows = new Map<number, Observation[]>();
  const weights = current.map(g => Math.exp(-(at - Date.parse(g.date)) / 86400000 / config.recencyDays));
  for (let i = 0; i < current.length; i++) {
    const g = current[i], environment = variant.dateEnvironment ? environments?.get(g.date.slice(0, 10)) : currentEnvironment;
    if (!environment) throw new Error("missing historical CBB environment");
    const h = g.neutral ? 0 : 0.5;
    for (const [id, opponent, own, allowed, home] of [[g.homeId, g.awayId, g.homeScore, g.awayScore, h], [g.awayId, g.homeId, g.awayScore, g.homeScore, -h]]) {
      const list = rows.get(id) ?? [];
      list.push({ opponent, own: 100 * own / g.possessions, allowed: 100 * allowed / g.possessions, home, tempo: g.tempo, weight: weights[i], environment });
      rows.set(id, list);
    }
  }
  let maxChange = 0, initialMaxChange = 0, iterations = 0;
  for (; iterations < 400; iterations++) {
    maxChange = 0;
    for (const [id, observations] of rows) {
      const base = prior?.teams[id], team = state.teams[id];
      let off = config.ridge * (base?.offense ?? 0) * config.priorCarry;
      let def = config.ridge * (base?.defense ?? 0) * config.priorCarry;
      let pace = config.paceRidge * (base?.pace ?? 0) * config.priorCarry;
      let precision = config.ridge, pacePrecision = config.paceRidge;
      for (const r of observations) {
        const other = state.teams[r.opponent];
        off += r.weight * (r.own - r.environment.efficiency - other.defense - r.home * state.homeEfficiency);
        def += r.weight * (r.allowed - r.environment.efficiency - other.offense + r.home * state.homeEfficiency);
        pace += r.weight * 0.5 * (r.tempo - r.environment.tempo - 0.5 * other.pace);
        precision += r.weight; pacePrecision += r.weight * 0.25;
      }
      const next = { offense: off / precision, defense: def / precision, pace: pace / pacePrecision };
      for (const key of ["offense", "defense", "pace"] as const) { maxChange = Math.max(maxChange, Math.abs(team[key] - next[key])); team[key] = next[key]; }
    }
    let hNum = 20 * (prior?.homeEfficiency ?? 4), hDen = 20;
    for (let i = 0; i < current.length; i++) {
      const g = current[i]; if (g.neutral) continue;
      const h = state.teams[g.homeId], a = state.teams[g.awayId];
      hNum += weights[i] * (100 * (g.homeScore - g.awayScore) / g.possessions - (h.offense + a.defense - a.offense - h.defense));
      hDen += weights[i];
    }
    const nextHome = hNum / hDen;
    maxChange = Math.max(maxChange, Math.abs(nextHome - state.homeEfficiency)); state.homeEfficiency = nextHome;
    if (iterations === 0) initialMaxChange = maxChange;
    if (!Number.isFinite(maxChange)) throw new Error("nonfinite CBB structural fit");
    if (maxChange < 1e-7) { iterations++; break; }
  }
  return { state: { ...state, release: CBB_STRUCTURAL_RESEARCH_RELEASE },
    diagnostics: { iterations, maxChange, initialMaxChange, converged: maxChange < 1e-7, games: current.length } };
}

export function fitCbbStructuralPrior(history: CbbTrainingGame[], season: number, config: CbbScoreResearchConfig, variant: CbbStructuralVariant) {
  let prior: CbbRatingState | undefined;
  const diagnostics: CbbFitDiagnostics[] = [];
  for (const previous of [...new Set(history.filter(g => g.season < season).map(g => g.season))].sort()) {
    const previousGames = history.filter(g => g.season === previous && g.neutral !== null);
    if (!previousGames.length) continue;
    const asOf = variant.seasonEndPrior ? new Date(Math.max(...previousGames.map(g => Date.parse(g.date))) + lag).toISOString() : `${previous + 1}-07-01T00:00:00.000Z`;
    const fitted = fitCbbStructuralState(history, { season: previous, asOf, config, prior, variant });
    prior = fitted.state; diagnostics.push(fitted.diagnostics);
  }
  return { prior, diagnostics };
}

export function replayCbbStructuralResearch(history: CbbTrainingGame[], season: number, config: CbbScoreResearchConfig, uncertainty: CbbUncertainty, variant: CbbStructuralVariant) {
  const fitted = fitCbbStructuralPrior(history, season, config, variant), prior = fitted.prior;
  const environments = variant.dateEnvironment ? cbbHistoricalEnvironments(history, season, config, prior) : undefined;
  const grouped = new Map<string, CbbTrainingGame[]>();
  for (const game of history.filter(g => g.season === season)) {
    const day = game.date.slice(0, 10), rows = grouped.get(day) ?? []; rows.push(game); grouped.set(day, rows);
  }
  const rows: CbbScoreFeatureRow[] = [], diagnostics = [...fitted.diagnostics];
  for (const [day, games] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const asOf = `${day}T00:00:00.000Z`, fit = fitCbbStructuralState(history, { season, asOf, config, prior, variant, environments });
    diagnostics.push(fit.diagnostics);
    const available = history.filter(g => g.season === season && Date.parse(g.date) + lag <= Date.parse(asOf));
    for (const game of games) {
      const forecast = { ...forecastCbbGame(fit.state, game, uncertainty), release: CBB_STRUCTURAL_RESEARCH_RELEASE };
      rows.push({ game, forecast, features: cbbScoreFeatures(forecast, fit.state, game, available) });
    }
  }
  return { rows, diagnostics };
}
