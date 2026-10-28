/** All-game, no-write loss census. No fitting of new prediction rules or hindsight exclusions. */
import { readFile, writeFile } from "node:fs/promises";
import { buildCbbTrainingGames } from "../../lib/cbb/dataset";
import { applyCbbScoreCorrection, type CbbScoreCorrection, type CbbScoreFeatureRow } from "../../lib/cbb/scoreResearch";
import type { CbbShotHead } from "../../lib/cbb/shotProfileResearch";
import { auditCbbQuotePair, cbbLossComponentAccounting, cbbLossDateUncertainty, cbbQuoteDateUncertainty, decomposeCbbScoreHeadChange, groupCbbLossPairs, pairCbbLossAudit, summarizeCbbLossPairs, type CbbLossAuditPair } from "../../lib/cbb/lossAudit";
import type { CbbBox, CbbForecast, CbbGame, CbbQuote, CbbTeam, CbbTrainingGame, CbbVenue } from "../../lib/cbb/types";
const dir = "/private/tmp/oddsphere-cbb-data";
if (process.argv.some(a => /^(--write|--publish|--activate)/.test(a))) throw new Error("private loss audit only");
const read = async <T>(file: string): Promise<T> => JSON.parse(await readFile(`${dir}/${file}`, "utf8"));
const mean = (values: number[]) => values.length ? values.reduce((s, n) => s + n, 0) / values.length : null;
const correct = (g: CbbTrainingGame, f: CbbForecast) => (g.homeScore > g.awayScore) === (f.homeWinProbability >= 0.5);
type QuotedInput = { game: CbbTrainingGame; baseline: CbbForecast; candidate: CbbForecast; targets: CbbQuote[] };
type BetRow = ReturnType<typeof auditCbbQuotePair>;
function betSummary(rows: BetRow[]) {
  const model = (version: "baseline" | "candidate") => {
    const wins = rows.filter(r => r[version].result === "win").length, losses = rows.filter(r => r[version].result === "loss").length;
    return { wins, losses, pushes: rows.filter(r => r[version].result === "push").length, passes: rows.filter(r => r[version].result === "pass").length,
      accuracy: wins + losses ? wins / (wins + losses) : null, expectedLossesConditionalOnNonPushRows: rows.reduce((s, r) => s + (r[version].expectedLoss ?? 0), 0),
      brier: mean(rows.flatMap(r => r[version].brier === null ? [] : [r[version].brier!])),
      actualSelectedSideMargin: mean(rows.filter(r => r.quote.market !== "moneyline").map(r => Math.abs(r[version].signedEdge))) };
  };
  return { games: rows.length, baseline: model("baseline"), candidate: model("candidate"), corrections: rows.filter(r => r.correction).length,
    harms: rows.filter(r => r.harm).length, net: rows.filter(r => r.correction).length - rows.filter(r => r.harm).length };
}
function quoteGroups(rows: BetRow[]) {
  const group = (cut: (r: BetRow) => string) => {
    const grouped = new Map<string, BetRow[]>();
    for (const row of rows) { const key = cut(row), list = grouped.get(key) ?? []; list.push(row); grouped.set(key, list); }
    return Object.fromEntries([...grouped].map(([key, list]) => [key, betSummary(list)]));
  };
  const dates = group(r => r.date.slice(0, 10));
  const net = betSummary(rows).net;
  // Few dates: emphasize the actual per-date sequence and leave-one-date-out, not false precision.
  return { all: betSummary(rows), byDate: dates,
    uncertainty: cbbQuoteDateUncertainty(rows.map(r => ({ date: r.date, delta: Number(r.candidate.result === "win") - Number(r.baseline.result === "win") }))),
    leaveOneDateOutNetRange: [Math.min(...Object.values(dates).map(d => net - d.net)), Math.max(...Object.values(dates).map(d => net - d.net))],
    byBaselineConfidence: group(r => r.baseline.probability < 0.55 ? "50to55" : r.baseline.probability < 0.6 ? "55to60" : r.baseline.probability < 0.7 ? "60to70" : "70plus"),
    byBaselineEdge: rows[0]?.market === "moneyline" ? null : group(r => Math.abs(r.baseline.signedEdge) < 1 ? "under1" : Math.abs(r.baseline.signedEdge) < 3 ? "1to3" : Math.abs(r.baseline.signedEdge) < 6 ? "3to6" : "6plus"),
    flips: rows.filter(r => r.correction || r.harm),
  };
}
function concentration(pairs: CbbLossAuditPair[], teams: Map<number, CbbTeam>) {
  const perTeam = new Map<number, CbbLossAuditPair[]>();
  for (const row of pairs) for (const id of [row.game.homeId, row.game.awayId]) {
    const list = perTeam.get(id) ?? []; list.push(row); perTeam.set(id, list);
  }
  const net = summarizeCbbLossPairs(pairs).netWinners;
  const rows = [...perTeam].map(([id, games]) => ({ teamId: id, name: teams.get(id)?.full_name ?? String(id), ...summarizeCbbLossPairs(games), netWithoutTeamGames: net - summarizeCbbLossPairs(games).netWinners }));
  return { note: "Each game belongs to both participants: team counts/net gains cannot be added. Leave-one-team-out is sensitivity, not independent validation.",
    leaveOneTeamOutNetRange: [Math.min(...rows.map(r => r.netWithoutTeamGames)), Math.max(...rows.map(r => r.netWithoutTeamGames))],
    mostPositive: [...rows].sort((a, b) => b.netWinners - a.netWinners).slice(0, 12),
    mostNegative: [...rows].sort((a, b) => a.netWinners - b.netWinners).slice(0, 12), rows };
}
async function main() {
  const rawGames: CbbGame[] = [], boxes: CbbBox[] = [], venues: CbbVenue[] = [];
  for (const season of [2022, 2023, 2024, 2025]) {
    rawGames.push(...(await read<{ data: CbbGame[] }>(`games-${season}.json`)).data);
    boxes.push(...(await read<{ data: CbbBox[] }>(`boxes-${season}.json`)).data);
    venues.push(...(await read<{ data: CbbVenue[] }>(`venues-${season}.json`)).data);
  }
  const dataset = buildCbbTrainingGames(rawGames, boxes, venues), history = dataset.games;
  const baseline = await read<CbbScoreFeatureRow[]>("candidate-r2-diagnostic.json"), candidate = await read<CbbScoreFeatureRow[]>("candidate-r8-diagnostic.json");
  const baseArtifact = await read<{ config: { id: string }; correction: CbbScoreCorrection }>("candidate-r2-artifact.json"), candidateHead = await read<CbbShotHead>("candidate-r8-head.json");
  const pairs = pairCbbLossAudit(baseline, candidate, history), groups = groupCbbLossPairs(pairs);
  const rawSelection = await read<CbbScoreFeatureRow[]>("score-feature-selection.json");
  const archived = await read<{ candidates: Array<{ config: { id: string }; mode: CbbScoreCorrection["mode"]; correction: CbbScoreCorrection }> }>("score-improvement-report.json");
  const referenceHeads = archived.candidates.filter(c => c.config.id === baseArtifact.config.id && c.mode === baseArtifact.correction.mode);
  if (referenceHeads.length !== 1 || referenceHeads[0].correction.fitThroughSeason !== 2023) throw new Error("missing/ambiguous frozen earlier-season CBB head");
  const reference = applyCbbScoreCorrection(rawSelection, referenceHeads[0].correction);
  const referencePairs = pairCbbLossAudit(reference, reference, history), referenceGroups = groupCbbLossPairs(referencePairs);
  const repeatability = Object.fromEntries(Object.entries(groups).map(([dimension, values]) => [dimension,
    Object.fromEntries(Object.entries(values).map(([key, value]) => {
      const old = referenceGroups[dimension]?.[key]?.baseline;
      return [key, { diagnostic: value.baseline, earlierSelectionSeason: old ?? null,
        sameSignedTotalBias: old && old.totalBiasPredictionMinusActual !== null && value.baseline.totalBiasPredictionMinusActual !== null ? Math.sign(old.totalBiasPredictionMinusActual) === Math.sign(value.baseline.totalBiasPredictionMinusActual) : null,
        warning: "Exploratory repeated pattern; earlier 2024 season was used for model selection, not an independent validation cohort." }];
    }))]));
  const teams = new Map(rawGames.flatMap(g => [[g.home_team.id, g.home_team] as const, [g.visitor_team.id, g.visitor_team] as const]));
  const boxMap = new Map(boxes.map(b => [`${b.game.id}:${b.team.id}`, b]));
  const ledger = pairs.map(row => {
    const before = correct(row.game, row.baseline), after = correct(row.game, row.candidate), g = row.game;
    const hBox = boxMap.get(`${g.id}:${g.homeId}`)!, aBox = boxMap.get(`${g.id}:${g.awayId}`)!;
    return { gameId: g.id, date: g.date, asOf: row.baseline.asOf,
      home: teams.get(g.homeId)?.full_name ?? String(g.homeId), away: teams.get(g.awayId)?.full_name ?? String(g.awayId),
      actualHome: g.homeScore, actualAway: g.awayScore, baseline: row.baseline, candidate: row.candidate,
      status: before ? after ? "both_correct" : "harm" : after ? "correction" : "both_wrong",
      pregame: { minimumTeamGames: row.minimumTeamGames, restDifference: row.restDifference, neutral: g.neutral, issues: row.baseline.issues },
      postgameOnly: { overtime: g.overtime, finalWithin3: Math.abs(g.homeScore - g.awayScore) <= 3, actualTempo: g.tempo,
        homeThree: `${hBox.fg3m}/${hBox.fg3a}`, awayThree: `${aBox.fg3m}/${aBox.fg3a}`,
        homeFactors: g.homeFactors, awayFactors: g.awayFactors },
    };
  });
  const candidateById = new Map(candidate.map(r => [r.game.id, r]));
  const contributions = baseline.map((r, i) => {
    const next = candidateById.get(r.game.id)!;
    const change = decomposeCbbScoreHeadChange(r.features, next.features, baseArtifact.correction, candidateHead);
    if (Math.abs(change.margin - next.forecast.margin + r.forecast.margin) > 1e-8 || Math.abs(change.total - next.forecast.total + r.forecast.total) > 1e-8) throw new Error("CBB head attribution fails exact score identity");
    return { gameId: r.game.id, status: ledger[i].status, ...change };
  });
  const attribution = Object.fromEntries(["all", "harm", "correction", "both_wrong"].map(status => {
    const rows = status === "all" ? contributions : contributions.filter(r => r.status === status);
    const families = [...new Set(contributions[0].features.map(f => f.family))];
    const featureSummary = contributions[0].features.map((f, i) => ({ name: f.name, family: f.family,
      meanMarginContribution: mean(rows.map(r => r.features[i].margin)), meanAbsoluteMarginContribution: mean(rows.map(r => Math.abs(r.features[i].margin))),
      meanTotalContribution: mean(rows.map(r => r.features[i].total)), meanAbsoluteTotalContribution: mean(rows.map(r => Math.abs(r.features[i].total))) }));
    return [status, { games: rows.length, meanMarginChange: mean(rows.map(r => r.margin)), meanAbsoluteMarginChange: mean(rows.map(r => Math.abs(r.margin))),
      meanTotalChange: mean(rows.map(r => r.total)), families: Object.fromEntries(families.map(family => [family, {
        meanMarginContribution: mean(rows.map(r => r.features.filter(f => f.family === family).reduce((s, f) => s + f.margin, 0))),
        meanAbsoluteNetMarginContribution: mean(rows.map(r => Math.abs(r.features.filter(f => f.family === family).reduce((s, f) => s + f.margin, 0)))),
        meanTotalContribution: mean(rows.map(r => r.features.filter(f => f.family === family).reduce((s, f) => s + f.total, 0))),
      }])), topAbsoluteMarginContributors: [...featureSummary].sort((a, b) => (b.meanAbsoluteMarginContribution ?? 0) - (a.meanAbsoluteMarginContribution ?? 0)).slice(0, 12),
      warning: "Exact mechanical linear-head accounting, not causal feature importance. Correlated features/interactions can offset; reweighting shared inputs is part of the change." }];
  }));
  const inputs = await read<{ marketRows: QuotedInput[]; totalRows: QuotedInput[] }>("independent-quote-loss-audit-inputs.json");
  const marketRows = inputs.marketRows.flatMap(r => r.targets.map(q => auditCbbQuotePair(r.game, r.baseline, r.candidate, q)));
  const totalRows = inputs.totalRows.flatMap(r => r.targets.map(q => auditCbbQuotePair(r.game, r.baseline, r.candidate, q)));
  const quoted = { threeMarket353: Object.fromEntries((["moneyline", "spread", "total"] as const).map(m => [m, quoteGroups(marketRows.filter(r => r.market === m))])), total635: quoteGroups(totalRows) };
  const postgameGroups = { overtime: summarizeCbbLossPairs(pairs.filter(r => r.game.overtime)), regulation: summarizeCbbLossPairs(pairs.filter(r => !r.game.overtime)),
    finalWithin3: summarizeCbbLossPairs(pairs.filter(r => Math.abs(r.game.homeScore - r.game.awayScore) <= 3)),
    finalBeyond3: summarizeCbbLossPairs(pairs.filter(r => Math.abs(r.game.homeScore - r.game.awayScore) > 3)) };
  const rawMap = new Map(rawGames.map(g => [g.id, g]));
  const sourceMismatches = pairs.flatMap(r => {
    const source = rawMap.get(r.game.id)!;
    const pair = [boxMap.get(`${r.game.id}:${r.game.homeId}`)!, boxMap.get(`${r.game.id}:${r.game.awayId}`)!];
    const boxMismatch = pair.some(b => b.game.season !== r.game.season || Date.parse(b.game.date) !== Date.parse(source.date));
    const otSumMismatch = r.game.overtime && ((source.home_ot_scores?.length && source.home_ot_scores.reduce((s, n) => s + n, 0) + r.game.homeRegulation !== r.game.homeScore) ||
      (source.away_ot_scores?.length && source.away_ot_scores.reduce((s, n) => s + n, 0) + r.game.awayRegulation !== r.game.awayScore));
    return boxMismatch || otSumMismatch ? [{ gameId: r.game.id, boxFixtureDateSeasonMismatch: boxMismatch, overtimeSumMismatch: Boolean(otSumMismatch) }] : [];
  });
  const dataIntegrity = { acceptedGames: history.length, rejected: dataset.rejected, sourceMismatches,
    diagnosticGames: pairs.length, exactBoxPairs: pairs.filter(r => boxMap.has(`${r.game.id}:${r.game.homeId}`) && boxMap.has(`${r.game.id}:${r.game.awayId}`)).length,
    incoherentScores: pairs.filter(r => [r.baseline, r.candidate].some(f => Math.abs(f.homeScore - f.awayScore - f.margin) > 1e-8 || Math.abs(f.homeScore + f.awayScore - f.total) > 1e-8)).length,
    unavailableHistoricalEvidence: ["verified_pregame_injury_and_roster_receipts", "qualified_movement_and_splits_for_the_353_opening_cohort"],
    warning: "Missing historical evidence cannot be declared healthy or assigned as the cause of an individual loss." };
  const groupUncertainty = Object.fromEntries(["confidence", "minimumTeamGames", "projectedPace"].map(dimension => [dimension,
    Object.fromEntries(Object.entries(groups[dimension]).map(([key, value]) => {
      const selected = pairs.filter(row => {
        if (dimension === "confidence") { const p = Math.max(row.baseline.homeWinProbability, 1 - row.baseline.homeWinProbability); return (p < 0.6 ? "50-60%" : p < 0.7 ? "60-70%" : p < 0.8 ? "70-80%" : p < 0.9 ? "80-90%" : "90-100%") === key; }
        if (dimension === "minimumTeamGames") return (row.minimumTeamGames < 5 ? "0to4" : row.minimumTeamGames < 15 ? "5to14" : "15plus") === key;
        return (row.baseline.possessions < 65 ? "under65" : row.baseline.possessions < 72 ? "65to72" : "72plus") === key;
      });
      if (selected.length !== value.baseline.games) throw new Error("CBB group uncertainty partition mismatch");
      return [key, { ...cbbLossDateUncertainty(selected), blocks: undefined }];
    }))]));
  const report = { audit: "cbb_loss_census_2026_10_28_r1", productionWrites: 0, providerCalls: 0, predictionChanges: 0,
    baselineRelease: baseline[0].forecast.release, candidateRelease: candidate[0].forecast.release,
    scope: "Already-opened retrospective 2025 season; r8 is rejected research, not a deployed successor. No hindsight-excluded official record or pure-variance labels.",
    all: summarizeCbbLossPairs(pairs), pregameGroups: groups, pregameGroupUncertainty: groupUncertainty,
    postgameOnlyGroups: postgameGroups, postgameGroupingWarning: "Outcome-conditioned groups are descriptive only; selected-side probabilities are not conditional on the game later being close/overtime, so their excess losses are NOT calibration tests.",
    uncertainty: cbbLossDateUncertainty(pairs), componentAccounting: cbbLossComponentAccounting(pairs),
    earlierSelectionSeason: { all: summarizeCbbLossPairs(referencePairs), repeatability },
    teamConcentration: concentration(pairs, teams), quoted, dataIntegrity,
    scoreHeadAttribution: attribution,
    highConfidenceLosses: ledger.filter(r => r.status === "both_wrong" || r.status === "correction").sort((a, b) => Math.max(b.baseline.homeWinProbability, 1 - b.baseline.homeWinProbability) - Math.max(a.baseline.homeWinProbability, 1 - a.baseline.homeWinProbability)).slice(0, 20),
    ledgerCounts: Object.fromEntries(["both_correct", "both_wrong", "correction", "harm"].map(status => [status, ledger.filter(r => r.status === status).length])),
    sourceLimitations: "Quotes cover eight fixed Saturdays, not a full-season market audit. Opening-price fixture orientation is corroborated, not exact selection-level side proof. Overlapping cohorts and repeated team games are not independent samples. No confidence interval removes all variation, selection bias, omitted inputs or causal ambiguity.",
  };
  await writeFile(`${dir}/cbb-loss-audit-report.json`, JSON.stringify(report, null, 2));
  const compactContributions = contributions.map(({ features, ...row }) => ({ ...row,
    families: Object.fromEntries([...new Set(features.map(f => f.family))].map(family => [family, {
      margin: features.filter(f => f.family === family).reduce((s, f) => s + f.margin, 0),
      total: features.filter(f => f.family === family).reduce((s, f) => s + f.total, 0),
    }])), topMarginContributions: row.status === "both_correct" ? [] : [...features].sort((a, b) => Math.abs(b.margin) - Math.abs(a.margin)).slice(0, 5) }));
  await writeFile(`${dir}/cbb-loss-audit-ledger.json`, JSON.stringify({ audit: report.audit, rows: ledger, scoreHeadContributions: compactContributions, quoteRows: marketRows, totalRows }));
  console.log(JSON.stringify({ audit: report.audit, productionWrites: 0, providerCalls: 0, predictionChanges: 0,
    games: pairs.length, baselineLosses: report.all.baseline.losses, candidateLosses: report.all.candidate.losses,
    baselineExpectedLosses: report.all.baseline.expectedLosses, candidateExpectedLosses: report.all.candidate.expectedLosses,
    ledgerCounts: report.ledgerCounts, uncertainty: { ...report.uncertainty, blocks: undefined },
    quoted: { threeMarket353: Object.fromEntries(Object.entries(quoted.threeMarket353).map(([m, r]) => [m, { all: r.all, uncertainty: r.uncertainty }])), total635: { all: quoted.total635.all, uncertainty: quoted.total635.uncertainty } },
    report: `${dir}/cbb-loss-audit-report.json`, ledger: `${dir}/cbb-loss-audit-ledger.json` }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
