import { cbbThresholdProbabilities, settleCbbMarket } from "./model";
import type { CbbEvaluationRow } from "./evaluation";
import type { CbbForecast, CbbMarket, CbbQuote, CbbTrainingGame } from "./types";
import { CBB_SCORE_FEATURE_NAMES, type CbbScoreCorrection } from "./scoreResearch";
import { CBB_SHOT_FEATURE_NAMES, type CbbShotHead } from "./shotProfileResearch";
import { CBB_MECHANISM_FEATURE_NAMES } from "./matchupMechanismResearch";

export type CbbLossAuditPair = { game: CbbTrainingGame; baseline: CbbForecast; candidate: CbbForecast; minimumTeamGames: number; restDifference: number };
const mean = (values: number[]) => values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);
const selectedProbability = (f: CbbForecast) => Math.max(f.homeWinProbability, 1 - f.homeWinProbability);
const won = (g: CbbTrainingGame, f: CbbForecast) => (f.homeWinProbability >= 0.5) === (g.homeScore > g.awayScore);

export function compareCbbNeutralOrientations(game: CbbTrainingGame, original: CbbForecast, swapped: CbbForecast) {
  if (game.neutral !== true || original.gameId !== game.id || swapped.gameId !== game.id || original.homeId !== game.homeId || original.awayId !== game.awayId ||
    swapped.homeId !== game.awayId || swapped.awayId !== game.homeId || original.asOf !== swapped.asOf ||
    ![original.asOf, game.date].every(t => Number.isFinite(Date.parse(t))) || Date.parse(original.asOf) > Date.parse(game.date) ||
    [original, swapped].some(f => !Number.isFinite(f.margin) || !Number.isFinite(f.total) || !Number.isFinite(f.homeWinProbability) || f.homeWinProbability < 0 || f.homeWinProbability > 1)) throw new Error("invalid CBB neutral orientation audit");
  return { originalMargin: original.margin, canonicalSwappedMargin: -swapped.margin,
    signedMarginDiscrepancy: original.margin + swapped.margin, absoluteMarginDiscrepancy: Math.abs(original.margin + swapped.margin),
    totalDiscrepancy: Math.abs(original.total - swapped.total), homeProbabilityDiscrepancy: Math.abs(original.homeWinProbability + swapped.homeWinProbability - 1),
    winnerChangesFromListingOnly: (original.homeWinProbability >= 0.5) !== (1 - swapped.homeWinProbability >= 0.5) };
}

/** Exact linear-head accounting. Correlated feature contributions are not causal effects. */
export function decomposeCbbScoreHeadChange(baselineFeatures: number[], candidateFeatures: number[], baseline: CbbScoreCorrection, candidate: CbbShotHead) {
  const rawNames = [...CBB_SCORE_FEATURE_NAMES, ...CBB_SHOT_FEATURE_NAMES, ...CBB_MECHANISM_FEATURE_NAMES];
  const names = [...rawNames, ...rawNames.slice(1).map(n => `maturity:${n}`)];
  if (baselineFeatures.length !== CBB_SCORE_FEATURE_NAMES.length || candidateFeatures.length !== names.length || candidate.margin.length !== names.length || candidate.total.length !== names.length ||
    baseline.featureIndexes.length !== baseline.coefficientsMargin.length || baseline.featureIndexes.length !== baseline.coefficientsTotal.length ||
    baselineFeatures.some((v, i) => Math.abs(v - candidateFeatures[i]) > 1e-10) || ![...baselineFeatures, ...candidateFeatures, ...candidate.margin, ...candidate.total, ...baseline.coefficientsMargin, ...baseline.coefficientsTotal].every(Number.isFinite)) throw new Error("CBB score attribution schema/core mismatch");
  const oldMargin = new Map(baseline.featureIndexes.map((index, i) => [index, baseline.coefficientsMargin[i]]));
  const oldTotal = new Map(baseline.featureIndexes.map((index, i) => [index, baseline.coefficientsTotal[i]]));
  const features = names.map((name, i) => ({ name, family: i >= rawNames.length ? "maturity_interactions" : i >= CBB_SCORE_FEATURE_NAMES.length + CBB_SHOT_FEATURE_NAMES.length ? "basketball_mechanisms" : i >= CBB_SCORE_FEATURE_NAMES.length ? "shot_profiles" : "shared_head_reweighting",
    margin: candidateFeatures[i] * (candidate.margin[i] - (oldMargin.get(i) ?? 0)),
    total: candidateFeatures[i] * (candidate.total[i] - (oldTotal.get(i) ?? 0)) }));
  return { features, margin: sum(features.map(f => f.margin)), total: sum(features.map(f => f.total)) };
}
export function pairCbbLossAudit(baseline: CbbEvaluationRow[], candidate: CbbEvaluationRow[], history: CbbTrainingGame[]): CbbLossAuditPair[] {
  const candidates = new Map(candidate.map(r => [r.game.id, r]));
  if (candidates.size !== candidate.length || baseline.length !== candidate.length || new Set(baseline.map(r => r.game.id)).size !== baseline.length) throw new Error("duplicate/unpaired CBB loss census");
  return baseline.map(row => {
    const next = candidates.get(row.game.id);
    if (!next || JSON.stringify(next.game) !== JSON.stringify(row.game) || row.forecast.asOf !== next.forecast.asOf) throw new Error("CBB loss census cohort mismatch");
    if ([row.forecast, next.forecast].some(f => f.gameId !== row.game.id || f.homeId !== row.game.homeId || f.awayId !== row.game.awayId ||
      !Number.isFinite(Date.parse(f.asOf)) || !Number.isFinite(Date.parse(row.game.date)) || Date.parse(f.asOf) > Date.parse(row.game.date) ||
      !Number.isFinite(f.homeWinProbability) || f.homeWinProbability < 0 || f.homeWinProbability > 1 || !(f.possessions > 0))) throw new Error("CBB loss census forecast identity/cutoff mismatch");
    const available = history.filter(g => g.season === row.game.season && Date.parse(g.date) + 21600000 <= Date.parse(row.forecast.asOf));
    const team = (id: number) => available.filter(g => g.homeId === id || g.awayId === id);
    const home = team(row.game.homeId), away = team(row.game.awayId);
    const rest = (games: CbbTrainingGame[]) => games.length ? Math.min(14, (Date.parse(row.forecast.asOf) - Math.max(...games.map(g => Date.parse(g.date)))) / 86400000) : 14;
    return { game: row.game, baseline: row.forecast, candidate: next.forecast, minimumTeamGames: Math.min(home.length, away.length), restDifference: rest(home) - rest(away) };
  });
}

export function summarizeCbbLossPairs(pairs: CbbLossAuditPair[]) {
  const model = (version: "baseline" | "candidate") => {
    const losses = pairs.filter(r => !won(r.game, r[version])).length;
    const expectedLosses = sum(pairs.map(r => 1 - selectedProbability(r[version])));
    const marginResiduals = pairs.map(r => r.game.homeScore - r.game.awayScore - r[version].margin);
    const totalResiduals = pairs.map(r => r.game.homeScore + r.game.awayScore - r[version].total);
    const sd = (values: number[]) => values.length ? Math.sqrt(Math.max(0, mean(values.map(v => v * v))! - mean(values)! ** 2)) : null;
    const quantiles = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? [0.05, 0.5, 0.95].map(p => sorted[Math.floor((sorted.length - 1) * p)]) : null; };
    return { games: pairs.length, wins: pairs.length - losses, losses, accuracy: pairs.length ? 1 - losses / pairs.length : null,
      expectedLosses, excessLosses: losses - expectedLosses,
      averageConfidence: mean(pairs.map(r => selectedProbability(r[version]))),
      marginMae: mean(pairs.map(r => Math.abs(r.game.homeScore - r.game.awayScore - r[version].margin))),
      totalMae: mean(pairs.map(r => Math.abs(r.game.homeScore + r.game.awayScore - r[version].total))),
      marginBiasPredictionMinusActual: mean(pairs.map(r => r[version].margin - r.game.homeScore + r.game.awayScore)),
      totalBiasPredictionMinusActual: mean(pairs.map(r => r[version].total - r.game.homeScore - r.game.awayScore)),
      brier: mean(pairs.map(r => (r[version].homeWinProbability - Number(r.game.homeScore > r.game.awayScore)) ** 2)),
      observedMarginResidualSd: sd(marginResiduals), observedTotalResidualSd: sd(totalResiduals), totalActualMinusForecastQuantiles5_50_95: quantiles(totalResiduals),
      forecastMarginSd: mean(pairs.map(r => r[version].uncertainty.marginSd)), forecastTotalSd: mean(pairs.map(r => r[version].uncertainty.totalSd)),
      margin90Coverage: mean(pairs.map((r, i) => Number(Math.abs(marginResiduals[i]) <= 1.645 * r[version].uncertainty.marginSd))),
      total90Coverage: mean(pairs.map((r, i) => Number(Math.abs(totalResiduals[i]) <= 1.645 * r[version].uncertainty.totalSd))),
      incompleteInputs: pairs.filter(r => r[version].inputStatus !== "complete").length };
  };
  const corrections = pairs.filter(r => !won(r.game, r.baseline) && won(r.game, r.candidate)).length;
  const harms = pairs.filter(r => won(r.game, r.baseline) && !won(r.game, r.candidate)).length;
  return { baseline: model("baseline"), candidate: model("candidate"), corrections, harms, netWinners: corrections - harms };
}

export function cbbQuoteDateUncertainty(rows: Array<{ date: string; delta: number }>) {
  const groups = new Map<string, { n: number; delta: number }>();
  for (const row of rows) {
    if (!Number.isFinite(Date.parse(row.date)) || ![-1, 0, 1].includes(row.delta)) throw new Error("invalid CBB quote paired delta");
    const day = row.date.slice(0, 10), block = groups.get(day) ?? { n: 0, delta: 0 };
    block.n++; block.delta += row.delta; groups.set(day, block);
  }
  const blocks = [...groups.values()]; if (!blocks.length) throw new Error("empty CBB quote uncertainty cohort");
  let seed = 20261029;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const samples = Array.from({ length: 2000 }, () => {
    let n = 0, delta = 0;
    for (let i = 0; i < blocks.length; i++) { const b = blocks[Math.floor(random() * blocks.length)]; n += b.n; delta += b.delta; }
    return delta / n;
  }).sort((a, b) => a - b);
  return { dates: blocks.length, netWinDeltaPerGame95: [samples[50], samples[1949]],
    warning: "Calendar-date resampling of this small opened quote cohort; not independent validation, a causal test or removal of team/selection dependence." };
}

/** Descriptive pregame partitions, not outcome-tuned prediction rules. */
export function groupCbbLossPairs(pairs: CbbLossAuditPair[]) {
  const cuts: Record<string, (r: CbbLossAuditPair) => string> = {
    confidence: r => selectedProbability(r.baseline) < 0.6 ? "50-60%" : selectedProbability(r.baseline) < 0.7 ? "60-70%" : selectedProbability(r.baseline) < 0.8 ? "70-80%" : selectedProbability(r.baseline) < 0.9 ? "80-90%" : "90-100%",
    projectedMargin: r => Math.abs(r.baseline.margin) < 3 ? "under3" : Math.abs(r.baseline.margin) < 6 ? "3to6" : Math.abs(r.baseline.margin) < 12 ? "6to12" : "12plus",
    minimumTeamGames: r => r.minimumTeamGames < 5 ? "0to4" : r.minimumTeamGames < 15 ? "5to14" : "15plus",
    venue: r => r.game.neutral === null ? "unverified" : r.game.neutral ? "neutral" : "home",
    selectedVenueSide: r => r.baseline.homeWinProbability >= 0.5 ? "listed_home" : "listed_away",
    projectedPace: r => r.baseline.possessions < 65 ? "under65" : r.baseline.possessions < 72 ? "65to72" : "72plus",
    projectedTotal: r => r.baseline.total < 135 ? "under135" : r.baseline.total < 150 ? "135to150" : "150plus",
    rest: r => r.restDifference >= 2 ? "home_2plus_days" : r.restDifference <= -2 ? "away_2plus_days" : "within2days",
    month: r => r.game.date.slice(0, 7),
  };
  return Object.fromEntries(Object.entries(cuts).map(([name, cut]) => {
    const groups = new Map<string, CbbLossAuditPair[]>();
    for (const row of pairs) { const key = cut(row), group = groups.get(key) ?? []; group.push(row); groups.set(key, group); }
    return [name, Object.fromEntries([...groups].map(([key, rows]) => [key, summarizeCbbLossPairs(rows)]))];
  }));
}

/** Calendar blocks retain all games; intervals are conditional on this opened cohort. */
export function cbbLossDateUncertainty(pairs: CbbLossAuditPair[]) {
  const groups = new Map<string, CbbLossAuditPair[]>();
  for (const pair of pairs) { const day = pair.game.date.slice(0, 10), group = groups.get(day) ?? []; group.push(pair); groups.set(day, group); }
  const blocks = [...groups].map(([day, rows]) => ({ day, n: rows.length,
    net: sum(rows.map(r => Number(won(r.game, r.candidate)) - Number(won(r.game, r.baseline)))),
    baselineExcess: sum(rows.map(r => Number(!won(r.game, r.baseline)) - (1 - selectedProbability(r.baseline)))),
    candidateExcess: sum(rows.map(r => Number(!won(r.game, r.candidate)) - (1 - selectedProbability(r.candidate)))) }));
  if (!blocks.length) throw new Error("empty CBB uncertainty cohort");
  let seed = 20261029;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const samples = Array.from({ length: 2000 }, () => {
    let n = 0, net = 0, baselineExcess = 0, candidateExcess = 0;
    for (let i = 0; i < blocks.length; i++) { const b = blocks[Math.floor(random() * blocks.length)]; n += b.n; net += b.net; baselineExcess += b.baselineExcess; candidateExcess += b.candidateExcess; }
    return { winnerDelta: net / n, baselineExcessLossRate: baselineExcess / n, candidateExcessLossRate: candidateExcess / n };
  });
  const interval = (key: keyof typeof samples[number]) => { const values = samples.map(r => r[key]).sort((a, b) => a - b); return [values[50], values[1949]]; };
  const net = sum(blocks.map(b => b.net));
  return { method: "2000 fixed-seed calendar-date block resamples; not a new holdout or full team-dependence correction", dates: blocks.length,
    winnerDelta95: interval("winnerDelta"), baselineExcessLossRate95: interval("baselineExcessLossRate"), candidateExcessLossRate95: interval("candidateExcessLossRate"),
    leaveOneDateOutNetRange: [Math.min(...blocks.map(b => net - b.net)), Math.max(...blocks.map(b => net - b.net))], blocks };
}

/** Actual tempo is an impossible pregame oracle: diagnosis, never candidate accuracy. */
export function cbbLossComponentAccounting(pairs: CbbLossAuditPair[]) {
  return Object.fromEntries((["baseline", "candidate"] as const).map(version => {
    const components = pairs.map(row => {
      const f = row[version], g = row.game;
      const paceScaledTotal = f.total * g.tempo / f.possessions;
      const pace = paceScaledTotal - f.total, overtime = g.homeScore + g.awayScore - g.homeRegulation - g.awayRegulation;
      const remaining = g.homeRegulation + g.awayRegulation - paceScaledTotal;
      return { gameId: g.id, error: g.homeScore + g.awayScore - f.total, pace, remaining, overtime,
        oracleError: Math.abs(g.homeScore + g.awayScore - paceScaledTotal),
        oracleWithActualOtError: Math.abs(g.homeScore + g.awayScore - paceScaledTotal - overtime) };
    });
    if (components.some(c => Math.abs(c.error - c.pace - c.remaining - c.overtime) > 1e-8)) throw new Error("invalid CBB component identity");
    return [version, { games: pairs.length, actualTotalMae: mean(components.map(c => Math.abs(c.error))),
      oracleActualTempoMae: mean(components.map(c => c.oracleError)), oracleActualTempoAndOtMae: mean(components.map(c => c.oracleWithActualOtError)),
      meanSignedComponents: { pace: mean(components.map(c => c.pace)), remaining: mean(components.map(c => c.remaining)), overtime: mean(components.map(c => c.overtime)) },
      absoluteComponentsAreNotAdditive: true,
      paceDominantGames: components.filter(c => Math.abs(c.pace) > Math.max(Math.abs(c.remaining), Math.abs(c.overtime))).length,
      remainingDominantGames: components.filter(c => Math.abs(c.remaining) >= Math.max(Math.abs(c.pace), Math.abs(c.overtime))).length,
      overtimeDominantGames: components.filter(c => Math.abs(c.overtime) > Math.abs(c.remaining) && Math.abs(c.overtime) >= Math.abs(c.pace)).length,
      warning: "Arithmetic decomposition/counterfactual, not causal attribution or an achievable performance floor. Actual tempo/OT never enter a prediction. Positive pace rescaling cannot flip an outright winner." }];
  }));
}

export function auditCbbQuotePair(game: CbbTrainingGame, baseline: CbbForecast, candidate: CbbForecast, quote: CbbQuote) {
  if (quote.gameId !== game.id || [baseline, candidate].some(f => f.gameId !== game.id || f.homeId !== game.homeId || f.awayId !== game.awayId) || baseline.asOf !== candidate.asOf ||
    ![quote.providerObservedAt, baseline.asOf, game.date].every(t => Number.isFinite(Date.parse(t))) || Date.parse(quote.providerObservedAt) > Date.parse(baseline.asOf) || Date.parse(baseline.asOf) >= Date.parse(game.date)) throw new Error("CBB quote audit identity/cutoff mismatch");
  const one = (forecast: CbbForecast) => {
    const market: CbbMarket = quote.market;
    const signedEdge = market === "moneyline" ? forecast.homeWinProbability - 0.5 : market === "spread" ? forecast.margin + quote.line! : forecast.total - quote.line!;
    if (!Number.isFinite(signedEdge)) throw new Error("missing CBB audit edge");
    const probabilities = cbbThresholdProbabilities(forecast, market, quote.line);
    const first = signedEdge >= 0;
    const result = signedEdge === 0 && market !== "moneyline" ? "pass" : settleCbbMarket(market, first ? "first" : "second", quote.line, game.homeScore, game.awayScore);
    const probability = (first ? probabilities.first : probabilities.second) / (probabilities.first + probabilities.second);
    const targetFirst = settleCbbMarket(market, "first", quote.line, game.homeScore, game.awayScore);
    const homeProbability = probabilities.first / (probabilities.first + probabilities.second);
    return { signedEdge, probability, result, pick: first ? "first" : "second", expectedLoss: result === "push" || result === "pass" ? null : 1 - probability,
      brier: result === "push" || result === "pass" ? null : (homeProbability - Number(targetFirst === "win")) ** 2 };
  };
  const old = one(baseline), next = one(candidate);
  return { gameId: game.id, date: game.date, asOf: baseline.asOf, market: quote.market, quote,
    baseline: old, candidate: next, correction: old.result === "loss" && next.result === "win", harm: old.result === "win" && next.result === "loss" };
}
