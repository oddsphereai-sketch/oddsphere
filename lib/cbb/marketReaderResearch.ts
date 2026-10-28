import { cbbImpliedProbability } from "./marketEvidence";
import { normalCdf } from "./model";
import { cbbThresholdProbabilities } from "./model";
import { solveCbbResearchRidge } from "./shotProfileResearch";
import type { CbbScoreFeatureRow } from "./scoreResearch";
import { predictCbbScoreTrees, trainCbbScoreTrees, type CbbScoreTrees } from "./scoreTrees";
import type { CbbForecast, CbbQuote } from "./types";
import { CBB_EVIDENCE_MATURITY_RELEASE } from "./matchupMechanismResearch";

export const CBB_MARKET_READER_RESEARCH_RELEASE = "cbb_candidate_2026_10_28_r5_coherent_market_reader";
export const CBB_MARKET_READER_FEATURES = ["intercept", "independent_margin", "independent_total", "independent_strength",
  "spread_disagreement", "moneyline_disagreement", "total_disagreement", "ml_spread_disagreement",
  "spread_dispersion", "total_dispersion", "ml_available", "spread_available", "total_available", "reference_book_count",
  "margin_disagreement_strength_interaction", "total_disagreement_environment_interaction"] as const;
export type CbbReaderQuote = { quote: CbbQuote; orientation: "fixture_corroborated" | "named_selections_verified" | "total_invariant";
  availability: "provider_archived_opening" | "observed_live" };
const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };
const family = (book: string) => ["pinnacle", "ps3838", "pinnacle_mqtt"].includes(book.toLowerCase()) ? "pinnacle" : book.toLowerCase();
export function cbbInverseNormal(p: number) {
  if (!(p > 0 && p < 1)) throw new Error("invalid CBB fair probability");
  let low = -8, high = 8;
  for (let i = 0; i < 50; i++) { const mid = (low + high) / 2; if (normalCdf(mid) < p) low = mid; else high = mid; }
  return (low + high) / 2;
}
/** Price level is observed; unknown movement/splits/leadership are not synthesized. */
export function buildCbbMarketReaderFeatures(prior: CbbForecast, evidence: CbbReaderQuote[], targetBook: string, options: { archiveReplay: boolean }) {
  const asOf = Date.parse(prior.asOf);
  if (!Number.isFinite(asOf)) throw new Error("invalid CBB reader cutoff");
  const rejected: Array<{ book: string; market: string; reason: string }> = [];
  const eligible: CbbReaderQuote[] = [];
  for (const row of evidence) {
    const q = row.quote, observed = Date.parse(q.providerObservedAt), receipt = Date.parse(q.fetchedAt);
    const reason = q.gameId !== prior.gameId ? "wrong_game" : family(q.sportsbook) === family(targetBook) ? "target_family_excluded" :
      !["fixture_corroborated", "named_selections_verified", "total_invariant"].includes(row.orientation) || (q.market !== "total" && row.orientation === "total_invariant") ? "unverified_side_orientation" :
      !Number.isFinite(observed) || observed > asOf ? "future_or_invalid_quote" : asOf - observed > 48 * 3600000 ? "stale_quote" :
      row.availability === "provider_archived_opening" && (!options.archiveReplay || q.phase !== "opening") ? "archive_receipt_not_live" :
      row.availability === "observed_live" && (!Number.isFinite(receipt) || receipt > asOf || observed > receipt) ? "future_live_receipt" : null;
    if (reason) { rejected.push({ book: q.sportsbook, market: q.market, reason }); continue; }
    const p = cbbImpliedProbability(q.firstPrice) / (cbbImpliedProbability(q.firstPrice) + cbbImpliedProbability(q.secondPrice));
    const hold = cbbImpliedProbability(q.firstPrice) + cbbImpliedProbability(q.secondPrice);
    if (hold < 0.98 || hold > 1.3 || (q.market !== "moneyline" && (q.line === null || !Number.isFinite(q.line) || !Number.isInteger(q.line * 2)))) {
      rejected.push({ book: q.sportsbook, market: q.market, reason: "invalid_pair" }); continue;
    }
    if (!(p > 0 && p < 1)) throw new Error("invalid reader probability");
    eligible.push(row);
  }
  // One family/market contributes once. Multiple providers cannot multiply a book's influence.
  const groups = new Map<string, CbbReaderQuote[]>();
  for (const row of eligible) { const key = `${family(row.quote.sportsbook)}:${row.quote.market}`; groups.set(key, [...(groups.get(key) ?? []), row]); }
  const centers = { moneyline: [] as number[], spread: [] as number[], total: [] as number[] };
  const retained: CbbReaderQuote[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => b.quote.providerObservedAt.localeCompare(a.quote.providerObservedAt));
    const latest = group.filter(r => r.quote.providerObservedAt === group[0].quote.providerObservedAt);
    if (new Set(latest.map(r => JSON.stringify([r.quote.line, r.quote.firstPrice, r.quote.secondPrice]))).size !== 1) {
      rejected.push({ book: group[0].quote.sportsbook, market: group[0].quote.market, reason: "ambiguous_latest_pair" }); continue;
    }
    const q = latest[0].quote;
    const p = cbbImpliedProbability(q.firstPrice) / (cbbImpliedProbability(q.firstPrice) + cbbImpliedProbability(q.secondPrice));
    const sd = q.market === "total" ? prior.uncertainty.totalSd : prior.uncertainty.marginSd;
    const value = (q.market === "moneyline" ? 0 : q.market === "spread" ? -q.line! : q.line!) + sd * cbbInverseNormal(p);
    centers[q.market].push(value); retained.push(latest[0]);
  }
  const m = centers.moneyline.length ? median(centers.moneyline) : prior.margin;
  const s = centers.spread.length ? median(centers.spread) : prior.margin;
  const t = centers.total.length ? median(centers.total) : prior.total;
  const dispersion = (xs: number[]) => xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const marginDifference = (m + s) / 2 - prior.margin;
  const features = [1, prior.margin / 10, (prior.total - 140) / 20, Math.abs(prior.margin) / 10,
    (s - prior.margin) / 10, (m - prior.margin) / 10, (t - prior.total) / 20, (m - s) / 10,
    dispersion(centers.spread) / 5, dispersion(centers.total) / 10, Number(centers.moneyline.length > 0),
    Number(centers.spread.length > 0), Number(centers.total.length > 0), new Set(retained.map(r => family(r.quote.sportsbook))).size / 5,
    marginDifference * Math.abs(prior.margin) / 100, (t - prior.total) * (prior.total - 140) / 400];
  if (!features.every(Number.isFinite)) throw new Error("nonfinite CBB market features");
  return { features, retained, rejected, centers, inferenceScope: "opening_price_context_only" as const,
    missing: ["qualified_movement_history", "qualified_splits", "observed_book_leadership"] };
}

export type CbbMarketHead = { release: string; trainedThrough: string; trainingGameIds: number[]; mode: "ridge" | "trees";
  margin: number[]; total: number[]; trees?: CbbScoreTrees; penalty?: number; objective?: "joint_market_log_loss"; independentRelease?: string };
export const CBB_MATCHUP_MARKET_RESEARCH_RELEASE = "cbb_candidate_2026_10_28_r9_joint_matchup_market";
export function fitCbbMarketHead(rows: CbbScoreFeatureRow[], options: { penalty: number } | { rounds: number }): CbbMarketHead {
  if (rows.length < 100 || rows.some(r => r.features.length !== CBB_MARKET_READER_FEATURES.length || !r.features.every(Number.isFinite))) throw new Error("insufficient/invalid CBB reader training");
  if (new Set(rows.map(r => r.game.id)).size !== rows.length) throw new Error("duplicate CBB training games");
  const trainedThrough = new Date(Math.max(...rows.map(r => Date.parse(r.game.date) + 21600000))).toISOString();
  const base = { release: CBB_MARKET_READER_RESEARCH_RELEASE, trainedThrough, trainingGameIds: rows.map(r => r.game.id), margin: [], total: [] };
  if ("rounds" in options) {
    const trees = trainCbbScoreTrees(rows, Math.max(...rows.map(r => r.game.season)), { depth: 2, rounds: options.rounds, learningRate: 0.05, minLeaf: 50, bins: 16 });
    return { ...base, mode: "trees", trees };
  }
  const x = rows.map(r => r.features), weights = rows.map(() => 1);
  return { ...base, mode: "ridge", penalty: options.penalty,
    margin: solveCbbResearchRidge(x, rows.map(r => r.game.homeScore - r.game.awayScore - r.forecast.margin), weights, options.penalty),
    total: solveCbbResearchRidge(x, rows.map(r => r.game.homeScore + r.game.awayScore - r.forecast.total), weights, options.penalty) };
}
export function applyCbbMarketHead(row: CbbScoreFeatureRow, head: CbbMarketHead): CbbForecast {
  if (row.forecast.gameId !== row.game.id || row.forecast.homeId !== row.game.homeId || row.forecast.awayId !== row.game.awayId) throw new Error("CBB reader exact-game prior mismatch");
  if (![CBB_MARKET_READER_RESEARCH_RELEASE, CBB_MATCHUP_MARKET_RESEARCH_RELEASE].includes(head.release) || !Number.isFinite(Date.parse(row.forecast.asOf)) || !Number.isFinite(Date.parse(head.trainedThrough)) || Date.parse(head.trainedThrough) > Date.parse(row.forecast.asOf) || head.trainingGameIds.includes(row.game.id)) throw new Error("future/in-sample CBB reader model");
  if ((head.release === CBB_MATCHUP_MARKET_RESEARCH_RELEASE && head.independentRelease !== CBB_EVIDENCE_MATURITY_RELEASE) ||
    (head.independentRelease !== undefined && head.independentRelease !== row.forecast.release)) throw new Error("CBB reader independent release mismatch");
  if (row.features.length !== CBB_MARKET_READER_FEATURES.length || !row.features.every(Number.isFinite)) throw new Error("invalid CBB reader inference features");
  if (row.features[CBB_MARKET_READER_FEATURES.indexOf("reference_book_count")] === 0) return row.forecast;
  if (head.mode === "trees") {
    if (!head.trees) throw new Error("missing CBB reader trees");
    return { ...predictCbbScoreTrees(row.forecast, row.features, head.trees), release: head.release };
  }
  if (head.margin.length !== row.features.length || head.total.length !== row.features.length) throw new Error("CBB reader head width mismatch");
  const dot = (a: number[]) => a.reduce((s, v, i) => s + v * row.features[i], 0);
  const margin = row.forecast.margin + dot(head.margin), total = row.forecast.total + dot(head.total);
  const homeScore = (total + margin) / 2, awayScore = (total - margin) / 2, sd = row.forecast.uncertainty.marginSd;
  if (![margin, total, homeScore, awayScore].every(Number.isFinite) || homeScore <= 0 || awayScore <= 0) throw new Error("invalid CBB reader score");
  const zero = normalCdf((0.5 - margin) / sd) - normalCdf((-0.5 - margin) / sd);
  return { ...row.forecast, release: head.release, margin, total, homeScore, awayScore,
    homeWinProbability: (1 - normalCdf((0.5 - margin) / sd)) / (1 - zero) };
}

export function fitCbbJointMarketLogLoss(rows: Array<CbbScoreFeatureRow & { targets: CbbQuote[] }>, penalty: number,
  options?: { release: typeof CBB_MATCHUP_MARKET_RESEARCH_RELEASE; independentRelease: string }): CbbMarketHead {
  if (options && (options.release !== CBB_MATCHUP_MARKET_RESEARCH_RELEASE || options.independentRelease !== CBB_EVIDENCE_MATURITY_RELEASE ||
    rows.some(r => r.forecast.release !== options.independentRelease))) throw new Error("CBB joint independent release mismatch");
  if (rows.length < 100 || !(penalty > 0) || rows.some(r => r.features.length !== CBB_MARKET_READER_FEATURES.length || !r.features.every(Number.isFinite))) throw new Error("invalid joint CBB fitting cohort");
  if (new Set(rows.map(r => r.game.id)).size !== rows.length) throw new Error("duplicate joint CBB training games");
  if (rows.some(r => !Number.isFinite(Date.parse(r.game.date)) || r.targets.length !== 3 || new Set(r.targets.map(q => q.market)).size !== 3 || r.targets.some(q => q.gameId !== r.game.id))) throw new Error("invalid joint CBB exact-target identity");
  const width = CBB_MARKET_READER_FEATURES.length;
  const coefficients = Array(width * 2).fill(0) as number[], firstMoment = [...coefficients], secondMoment = [...coefficients];
  const withScore = (prior: CbbForecast, margin: number, total: number): CbbForecast => {
    const sd = prior.uncertainty.marginSd, zero = normalCdf((0.5 - margin) / sd) - normalCdf((-0.5 - margin) / sd);
    return { ...prior, margin, total, homeScore: (total + margin) / 2, awayScore: (total - margin) / 2,
      homeWinProbability: (1 - normalCdf((0.5 - margin) / sd)) / (1 - zero) };
  };
  const loss = (row: typeof rows[number], margin: number, total: number, totalOnly: boolean) => {
    const forecast = withScore(row.forecast, margin, total);
    let value = 0;
    for (const quote of row.targets.filter(q => (q.market === "total") === totalOnly)) {
      const actual = quote.market === "total" ? row.game.homeScore + row.game.awayScore - quote.line! :
        row.game.homeScore - row.game.awayScore + (quote.market === "spread" ? quote.line! : 0);
      if (!actual) continue;
      const p = cbbThresholdProbabilities(forecast, quote.market, quote.line);
      const binary = Math.max(1e-9, Math.min(1 - 1e-9, p.first / (p.first + p.second)));
      value -= actual > 0 ? Math.log(binary) : Math.log(1 - binary);
    }
    return value;
  };
  for (let iteration = 1; iteration <= 500; iteration++) {
    const gradient = coefficients.map(c => penalty * c / rows.length);
    for (const row of rows) {
      const margin = row.forecast.margin + row.features.reduce((s, x, i) => s + x * coefficients[i], 0);
      const total = row.forecast.total + row.features.reduce((s, x, i) => s + x * coefficients[width + i], 0);
      const marginDerivative = (loss(row, margin + 0.001, total, false) - loss(row, margin - 0.001, total, false)) / 0.002;
      const totalDerivative = (loss(row, margin, total + 0.001, true) - loss(row, margin, total - 0.001, true)) / 0.002;
      row.features.forEach((x, i) => { gradient[i] += x * marginDerivative / rows.length; gradient[width + i] += x * totalDerivative / rows.length; });
    }
    coefficients.forEach((_, i) => {
      firstMoment[i] = 0.9 * firstMoment[i] + 0.1 * gradient[i];
      secondMoment[i] = 0.999 * secondMoment[i] + 0.001 * gradient[i] ** 2;
      coefficients[i] -= 0.03 * firstMoment[i] / (1 - 0.9 ** iteration) / (Math.sqrt(secondMoment[i] / (1 - 0.999 ** iteration)) + 1e-8);
    });
  }
  return { release: options?.release ?? CBB_MARKET_READER_RESEARCH_RELEASE, ...(options ? { independentRelease: options.independentRelease } : {}), trainedThrough: new Date(Math.max(...rows.map(r => Date.parse(r.game.date) + 21600000))).toISOString(),
    trainingGameIds: rows.map(r => r.game.id), mode: "ridge", objective: "joint_market_log_loss", penalty,
    margin: coefficients.slice(0, width), total: coefficients.slice(width) };
}
