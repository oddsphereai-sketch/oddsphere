import { invariant, instant, etDate } from "./core";
import type { Sport, Stage } from "./catalog";

/** Standard rates verified 2026-11-06. No cache or Batch discount is assumed. */
export const RATES = {
  "gpt-6-luna": { input: 0.10, output: 0.50 },
  "gpt-6.1-terra": { input: 1, output: 5 },
} as const;
export type Model = keyof typeof RATES;
export type Usage = { input: number; output: number; cacheWrite30m?: number; cacheWrite12h?: number };
export function bill(model: Model, usage: Usage) {
  invariant(model in RATES, "Unpriced model");
  invariant([usage.input, usage.output].every(v => Number.isSafeInteger(v) && v >= 0), "Invalid billed usage");
  const write30 = usage.cacheWrite30m ?? 0, write12 = usage.cacheWrite12h ?? 0;
  invariant([write30, write12].every(v => Number.isSafeInteger(v) && v >= 0) && write30 + write12 <= usage.input, "Invalid cache-write usage");
  // Conservative at the documented 272K boundary. Output includes invisible reasoning tokens.
  const long = usage.input >= 272_000;
  // Charge reads at uncached rates conservatively; write rates are total 1.25x/2.5x.
  return ((usage.input + write30 * 0.25 + write12 * 1.5) * RATES[model].input * (long ? 2 : 1) + usage.output * RATES[model].output * (long ? 1.5 : 1)) / 1_000_000;
}
export type PlannedGame = { sport: Sport; id: string; start: string; input: Record<Stage, number>; maxOutput: Record<Stage, number>; finalModel?: Model };
export type Receipt = { jobKey: string; attemptId: string; model: Model; usage: Usage };
/** A failed/incomplete API attempt still consumes its receipt. Duplicate receipt IDs cannot disappear into a row limit. */
export function receiptTotal(receipts: Receipt[]) {
  invariant(new Set(receipts.map(r => r.attemptId)).size === receipts.length, "Duplicate receipt");
  return receipts.reduce((sum, r) => sum + bill(r.model, r.usage), 0);
}
export function monthPlan(args: {
  month: string; games: PlannedGame[]; fullScheduleConfirmed: boolean; completeEvidenceConfirmed: boolean;
  inputCounts: "api" | "proxy"; observedOutputQualityPassed: boolean;
  /** Explicit plan comparison only: a stronger final replaces the cheap final, never adds a third review. */
  maxStrongFinalFraction?: number;
  allowance?: number; evaluationReserve?: number; ceiling?: number;
}) {
  invariant(/^\d{4}-(0[1-9]|1[0-2])$/.test(args.month), "Invalid month");
  const allowance = args.allowance ?? 0.20, evaluationReserve = args.evaluationReserve ?? 5, ceiling = args.ceiling ?? 50;
  invariant([allowance, evaluationReserve, ceiling].every(v => Number.isFinite(v) && v >= 0), "Invalid budget configuration");
  const seen = new Set<string>();
  const maxStrong = args.maxStrongFinalFraction ?? 1;
  invariant(Number.isFinite(maxStrong) && maxStrong >= 0 && maxStrong <= 1, "Invalid stronger-final fraction");
  let early = 0, final = 0, strongerFinals = 0;
  for (const g of args.games) {
    invariant(etDate(g.start).startsWith(args.month), "Game outside selected month");
    invariant(!seen.has(`${g.sport}:${g.id}`), "Duplicate monthly game"); seen.add(`${g.sport}:${g.id}`);
    early += bill("gpt-6-luna", { input: g.input.early, output: g.maxOutput.early });
    const model = g.finalModel ?? "gpt-6.1-terra";
    final += bill(model, { input: g.input.final, output: g.maxOutput.final });
    if (model === "gpt-6.1-terra") strongerFinals++;
  }
  const estimated = (early + final) * (1 + allowance) + evaluationReserve;
  const gaps = [
    ...(!args.fullScheduleConfirmed || !args.games.length ? ["complete monthly game calendar not verified"] : []),
    ...(!args.completeEvidenceConfirmed ? ["full product evidence coverage not verified"] : []),
    ...(args.inputCounts !== "api" ? ["model-specific input tokens not measured"] : []),
    ...(!args.observedOutputQualityPassed ? ["complete useful output at these output limits not demonstrated"] : []),
    ...(strongerFinals > Math.floor(args.games.length * maxStrong) ? ["stronger-final allocation exceeds explicit plan fraction"] : []),
    ...(estimated > ceiling ? ["full plan exceeds ceiling"] : []),
  ];
  return { games: args.games.length, logicalReviews: args.games.length * 2,
    early, final, strongerFinals, maxStrongFinalFraction: maxStrong, evaluationReserve, allowance, estimated, ceiling,
    /** Reserve ALL final reviews before admitting early reviews; no first-come-first-served monthly rollout. */
    finalReviewReserve: final * (1 + allowance),
    budgetValidated: gaps.length === 0, gaps,
    excludedCosts: ["existing/new sports-data subscriptions", "hosting and database", "taxes", "other AI products"],
  };
}

export type PairedForecast = {
  id: string; gameId: string; sport: Sport; market: string;
  baselineRelease: string; candidateRelease: string;
  issuedAt: string; lock: string; outcomeAvailableAt: string;
  /** Same exact executable line/price for baseline and candidate. y = Over/Yes; pushes excluded explicitly. */
  line: number; americanOver: number; americanUnder: number | null;
  outcome: 0 | 1 | "push";
  baselineOver: number; candidateOver: number;
  baselineAction: "over" | "under" | null; candidateAction: "over" | "under" | null;
};
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
function score(rows: PairedForecast[], key: "baselineOver" | "candidateOver") {
  const settled = rows.filter(r => r.outcome !== "push");
  if (!settled.length) return { settled: 0, brier: null, logLoss: null, accuracy: null, calibration: [] };
  const clamped = (r: PairedForecast) => Math.max(1e-12, Math.min(1 - 1e-12, r[key]));
  return { settled: settled.length,
    brier: mean(settled.map(r => (r[key] - Number(r.outcome)) ** 2)),
    logLoss: mean(settled.map(r => -(Number(r.outcome) * Math.log(clamped(r)) + (1 - Number(r.outcome)) * Math.log(1 - clamped(r))))),
    accuracy: mean(settled.map(r => Number(Number(r[key] >= 0.5) === r.outcome))),
    calibration: Array.from({ length: 10 }, (_, i) => {
      const bin = settled.filter(r => Math.min(9, Math.floor(r[key] * 10)) === i);
      return { lower: i / 10, n: bin.length, forecast: bin.length ? mean(bin.map(r => r[key])) : null, observed: bin.length ? mean(bin.map(r => Number(r.outcome))) : null };
    }),
  };
}
function actions(rows: PairedForecast[], which: "baseline" | "candidate") {
  const selected = rows.filter(r => r[`${which}Action`] !== null);
  const settled = selected.filter(r => r.outcome !== "push");
  const profit = (r: PairedForecast) => {
    if (r.outcome === "push") return 0;
    const over = r[`${which}Action`] === "over", won = over ? r.outcome === 1 : r.outcome === 0;
    const american = over ? r.americanOver : r.americanUnder;
    invariant(american !== null, "Selected Under lacks exact Under price");
    return won ? american > 0 ? american / 100 : 100 / -american : -1;
  };
  return { count: selected.length, over: selected.filter(r => r[`${which}Action`] === "over").length,
    under: selected.filter(r => r[`${which}Action`] === "under").length,
    wins: settled.filter(r => (r[`${which}Action`] === "over") === Boolean(r.outcome)).length,
    profitAtOneUnit: selected.reduce((n, r) => n + profit(r), 0) };
}
/** No mixed-release performance. Fitting/tuning must end before this held-out interval. */
export function evaluate(rows: PairedForecast[], trainingThrough: string) {
  invariant(rows.length > 0 && new Set(rows.map(r => r.id)).size === rows.length, "Missing/duplicate paired records");
  const training = instant(trainingThrough);
  for (const r of rows) {
    invariant(instant(r.issuedAt) > training && instant(r.issuedAt) <= instant(r.lock) && instant(r.lock) < instant(r.outcomeAvailableAt), "Forecast leakage / invalid held-out boundary");
    invariant([r.baselineOver, r.candidateOver].every(p => Number.isFinite(p) && p >= 0 && p <= 1), "Invalid probability");
    invariant(Number.isFinite(r.line) && Number.isFinite(r.americanOver) && Math.abs(r.americanOver) >= 100 && (r.americanUnder === null || Number.isFinite(r.americanUnder) && Math.abs(r.americanUnder) >= 100), "Invalid exact-price pair");
    invariant([0, 1, "push"].includes(r.outcome), "Invalid outcome");
    invariant([r.baselineAction, r.candidateAction].every(v => v === null || v === "over" || v === "under"), "Invalid action");
    invariant(r.baselineRelease && r.candidateRelease && r.gameId && r.market, "Missing provenance");
  }
  const groups = new Map<string, PairedForecast[]>();
  for (const r of rows) {
    const key = `${r.sport}|${r.market}|${r.baselineRelease}|${r.candidateRelease}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups].map(([group, values]) => {
    const baseline = score(values, "baselineOver"), candidate = score(values, "candidateOver");
    const promotions = values.filter(r => r.baselineAction === null && r.candidateAction !== null);
    const demotions = values.filter(r => r.baselineAction !== null && r.candidateAction === null);
    return { group, records: values.length, games: new Set(values.map(r => r.gameId)).size,
      baseline, candidate, baselineActions: actions(values, "baseline"), candidateActions: actions(values, "candidate"),
      promotions: { count: promotions.length, performance: actions(promotions, "candidate") },
      demotions: { count: demotions.length, priorPerformance: actions(demotions, "baseline") },
      flips: values.filter(r => r.baselineAction && r.candidateAction && r.baselineAction !== r.candidateAction).length,
      /** Descriptive evidence only. Repeated props from one game are not independent samples. */
      productionQualified: false,
    };
  });
}
