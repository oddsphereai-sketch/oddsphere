/**
 * Outcome-aware evaluation helpers for predeclared upset-probability audits.
 *
 * This module is intentionally disconnected from every production scorer. It
 * compares already-frozen independent, fair-market and final probabilities on
 * the same timestamped rows. Callers remain responsible for target exclusion,
 * release purity and proving that every probability existed before kickoff.
 */

export type UpsetForecastRow = {
  identity: string;
  releaseId: string;
  decisionAt: string;
  /** Fair probability for the side that was the market underdog at decision. */
  fairMarketUnderdogProbability: number;
  independentUnderdogProbability: number;
  finalUnderdogProbability: number;
  underdogWon: boolean;
};

export type UpsetAlertRule = {
  name: string;
  minimumFinalProbability: number;
  minimumLiftOverFairMarket: number;
};

type ForecastMetrics = {
  brier: number;
  logLoss: number;
  meanProbability: number;
};

export type UpsetProbabilityBand = {
  lowerInclusive: number;
  upperExclusive: number;
  rows: number;
  upsets: number;
  observedRate: number;
  independent: ForecastMetrics;
  fairMarket: ForecastMetrics;
  final: ForecastMetrics;
};

export type UpsetAlertMetrics = {
  name: string;
  rows: number;
  upsets: number;
  precision: number | null;
  recall: number | null;
  meanFinalProbability: number | null;
  observedRate: number | null;
};

export type UpsetForecastEvaluation = {
  rows: number;
  releases: string[];
  upsets: number;
  observedUpsetRate: number;
  independent: ForecastMetrics;
  fairMarket: ForecastMetrics;
  final: ForecastMetrics;
  finalBrierSkillVsIndependent: number | null;
  finalBrierSkillVsFairMarket: number | null;
  winnerBoundaryInterventions: {
    changes: number;
    corrections: number;
    harms: number;
    netRescues: number;
  };
  probabilityDirection: {
    finalImprovedOnIndependent: number;
    finalHarmedIndependent: number;
    finalTiedIndependent: number;
    finalImprovedOnFairMarket: number;
    finalHarmedFairMarket: number;
    finalTiedFairMarket: number;
  };
  fairMarketBands: UpsetProbabilityBand[];
  alerts: UpsetAlertMetrics[];
};

const EPSILON = 1e-12;

function assertProbability(label: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a finite probability in [0, 1]`);
  }
}

function validateRows(rows: readonly UpsetForecastRow[]): void {
  if (rows.length === 0) throw new Error("upset evaluation requires at least one row");
  const identities = new Set<string>();
  for (const row of rows) {
    if (!row.identity || identities.has(row.identity)) {
      throw new Error(`upset evaluation identity must be unique: ${row.identity || "<missing>"}`);
    }
    identities.add(row.identity);
    if (!row.releaseId) throw new Error(`releaseId missing for ${row.identity}`);
    if (!Number.isFinite(Date.parse(row.decisionAt))) throw new Error(`decisionAt invalid for ${row.identity}`);
    assertProbability("fairMarketUnderdogProbability", row.fairMarketUnderdogProbability);
    if (row.fairMarketUnderdogProbability > 0.5 + EPSILON) {
      throw new Error(`market-defined underdog exceeds 50% for ${row.identity}`);
    }
    assertProbability("independentUnderdogProbability", row.independentUnderdogProbability);
    assertProbability("finalUnderdogProbability", row.finalUnderdogProbability);
  }
}

function score(probability: number, outcome: boolean): { brier: number; logLoss: number } {
  const y = outcome ? 1 : 0;
  const safe = Math.max(EPSILON, Math.min(1 - EPSILON, probability));
  return {
    brier: (probability - y) ** 2,
    logLoss: -(y * Math.log(safe) + (1 - y) * Math.log(1 - safe)),
  };
}

function metrics(rows: readonly UpsetForecastRow[], probability: (row: UpsetForecastRow) => number): ForecastMetrics {
  const sums = rows.reduce((acc, row) => {
    const value = probability(row);
    const scored = score(value, row.underdogWon);
    acc.brier += scored.brier;
    acc.logLoss += scored.logLoss;
    acc.probability += value;
    return acc;
  }, { brier: 0, logLoss: 0, probability: 0 });
  return {
    brier: sums.brier / rows.length,
    logLoss: sums.logLoss / rows.length,
    meanProbability: sums.probability / rows.length,
  };
}

function brierSkill(candidate: number, benchmark: number): number | null {
  return benchmark <= EPSILON ? null : 1 - candidate / benchmark;
}

function compareLoss(left: number, right: number): -1 | 0 | 1 {
  if (Math.abs(left - right) <= EPSILON) return 0;
  return left < right ? -1 : 1;
}

function validateBandEdges(edges: readonly number[]): void {
  if (edges.length < 2 || edges[0] !== 0 || edges[edges.length - 1] !== 0.5) {
    throw new Error("underdog band edges must start at 0 and end at 0.5");
  }
  for (let index = 1; index < edges.length; index++) {
    if (!(edges[index]! > edges[index - 1]!)) throw new Error("underdog band edges must increase strictly");
  }
}

export function evaluateUpsetForecastRows(
  rows: readonly UpsetForecastRow[],
  options: {
    fairMarketBandEdges?: readonly number[];
    alertRules?: readonly UpsetAlertRule[];
  } = {},
): UpsetForecastEvaluation {
  validateRows(rows);
  const bandEdges = options.fairMarketBandEdges ?? [0, 0.1, 0.2, 0.3, 0.4, 0.5];
  validateBandEdges(bandEdges);
  const alertRules = options.alertRules ?? [];
  for (const rule of alertRules) {
    if (!rule.name) throw new Error("upset alert rule name is required");
    assertProbability(`${rule.name}.minimumFinalProbability`, rule.minimumFinalProbability);
    if (!Number.isFinite(rule.minimumLiftOverFairMarket) || rule.minimumLiftOverFairMarket < 0 || rule.minimumLiftOverFairMarket > 1) {
      throw new Error(`${rule.name}.minimumLiftOverFairMarket must be in [0, 1]`);
    }
  }

  const independent = metrics(rows, (row) => row.independentUnderdogProbability);
  const fairMarket = metrics(rows, (row) => row.fairMarketUnderdogProbability);
  const final = metrics(rows, (row) => row.finalUnderdogProbability);
  let changes = 0;
  let corrections = 0;
  let harms = 0;
  let improvedIndependent = 0;
  let harmedIndependent = 0;
  let tiedIndependent = 0;
  let improvedMarket = 0;
  let harmedMarket = 0;
  let tiedMarket = 0;

  for (const row of rows) {
    const independentPickUnderdog = row.independentUnderdogProbability > 0.5;
    const finalPickUnderdog = row.finalUnderdogProbability > 0.5;
    if (independentPickUnderdog !== finalPickUnderdog) {
      changes += 1;
      if (finalPickUnderdog === row.underdogWon) corrections += 1;
      else harms += 1;
    }
    const finalLoss = score(row.finalUnderdogProbability, row.underdogWon).brier;
    const independentComparison = compareLoss(finalLoss, score(row.independentUnderdogProbability, row.underdogWon).brier);
    if (independentComparison < 0) improvedIndependent += 1;
    else if (independentComparison > 0) harmedIndependent += 1;
    else tiedIndependent += 1;
    const marketComparison = compareLoss(finalLoss, score(row.fairMarketUnderdogProbability, row.underdogWon).brier);
    if (marketComparison < 0) improvedMarket += 1;
    else if (marketComparison > 0) harmedMarket += 1;
    else tiedMarket += 1;
  }

  const fairMarketBands: UpsetProbabilityBand[] = [];
  for (let index = 0; index < bandEdges.length - 1; index++) {
    const lowerInclusive = bandEdges[index]!;
    const upperExclusive = bandEdges[index + 1]!;
    const inBand = rows.filter((row) => row.fairMarketUnderdogProbability >= lowerInclusive
      && (index === bandEdges.length - 2
        ? row.fairMarketUnderdogProbability <= upperExclusive
        : row.fairMarketUnderdogProbability < upperExclusive));
    if (inBand.length === 0) continue;
    const upsets = inBand.filter((row) => row.underdogWon).length;
    fairMarketBands.push({
      lowerInclusive,
      upperExclusive,
      rows: inBand.length,
      upsets,
      observedRate: upsets / inBand.length,
      independent: metrics(inBand, (row) => row.independentUnderdogProbability),
      fairMarket: metrics(inBand, (row) => row.fairMarketUnderdogProbability),
      final: metrics(inBand, (row) => row.finalUnderdogProbability),
    });
  }

  const totalUpsets = rows.filter((row) => row.underdogWon).length;
  const alerts = alertRules.map((rule): UpsetAlertMetrics => {
    const selected = rows.filter((row) => row.finalUnderdogProbability >= rule.minimumFinalProbability
      && row.finalUnderdogProbability - row.fairMarketUnderdogProbability >= rule.minimumLiftOverFairMarket);
    const upsets = selected.filter((row) => row.underdogWon).length;
    return {
      name: rule.name,
      rows: selected.length,
      upsets,
      precision: selected.length === 0 ? null : upsets / selected.length,
      recall: totalUpsets === 0 ? null : upsets / totalUpsets,
      meanFinalProbability: selected.length === 0 ? null : selected.reduce((sum, row) => sum + row.finalUnderdogProbability, 0) / selected.length,
      observedRate: selected.length === 0 ? null : upsets / selected.length,
    };
  });

  return {
    rows: rows.length,
    releases: [...new Set(rows.map((row) => row.releaseId))].sort(),
    upsets: totalUpsets,
    observedUpsetRate: totalUpsets / rows.length,
    independent,
    fairMarket,
    final,
    finalBrierSkillVsIndependent: brierSkill(final.brier, independent.brier),
    finalBrierSkillVsFairMarket: brierSkill(final.brier, fairMarket.brier),
    winnerBoundaryInterventions: { changes, corrections, harms, netRescues: corrections - harms },
    probabilityDirection: {
      finalImprovedOnIndependent: improvedIndependent,
      finalHarmedIndependent: harmedIndependent,
      finalTiedIndependent: tiedIndependent,
      finalImprovedOnFairMarket: improvedMarket,
      finalHarmedFairMarket: harmedMarket,
      finalTiedFairMarket: tiedMarket,
    },
    fairMarketBands,
    alerts,
  };
}
