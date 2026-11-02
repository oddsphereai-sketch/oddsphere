import { createHash } from "node:crypto";
import type { NflPreviewBookOdds } from "./balldontlieNflPreviewSlate";
import type { NflV1WeekOneOutcomeForecast } from "./nflV1WeekOneOutcome";

type Market = "moneyline" | "spread" | "total";
export const NFL_MARKET_QUALIFICATION_RELEASE = "nfl_market_qualification_2026_11_02_r1_source_bound_law" as const;
export type NflMarketQualificationReceipt = {
  release: typeof NFL_MARKET_QUALIFICATION_RELEASE;
  market: Market;
  providerGameId: string;
  evaluatedAt: string;
  gameStartsAt: string;
  forecastSha256: string;
  basis: "market_free_independent_law" | "source_bound_joint_innovation";
  sourceMarketId: string;
  sourceReceipt: string;
  evidenceQualified: boolean;
  reason: "source_bound_law" | "source_or_law_unqualified";
};

/** Evidence qualification is an explicit source/law contract, never an empirical calibration claim. */
export function buildNflMarketQualification(args: {
  market: Market;
  providerGameId: string;
  evaluatedAt: string;
  gameStartsAt: string;
  forecast: NflV1WeekOneOutcomeForecast;
  basis: NflMarketQualificationReceipt["basis"];
  independentInputPolicy: "market_inputs_prohibited" | "unknown";
  sourceMarketId: string;
  sourceReceipt: string;
  evidenceQualified: boolean;
}): NflMarketQualificationReceipt {
  const evidenceQualified = args.evidenceQualified && args.independentInputPolicy === "market_inputs_prohibited" &&
    args.providerGameId === args.forecast.providerGameId && validLaw(args.forecast) &&
    Number.isFinite(Date.parse(args.evaluatedAt)) && Number.isFinite(Date.parse(args.gameStartsAt)) &&
    Date.parse(args.evaluatedAt) < Date.parse(args.gameStartsAt) &&
    typeof args.sourceMarketId === "string" && args.sourceMarketId.trim().length > 0 &&
    typeof args.sourceReceipt === "string" && args.sourceReceipt.trim().length > 0;
  return { release: NFL_MARKET_QUALIFICATION_RELEASE, market: args.market, providerGameId: args.providerGameId,
    evaluatedAt: args.evaluatedAt, gameStartsAt: args.gameStartsAt, forecastSha256: forecastHash(args.forecast),
    basis: args.basis, sourceMarketId: args.sourceMarketId, sourceReceipt: args.sourceReceipt,
    evidenceQualified, reason: evidenceQualified ? "source_bound_law" : "source_or_law_unqualified" };
}

export function nflMarketQualificationMatches(args: {
  receipt: NflMarketQualificationReceipt | undefined;
  market: Market;
  providerGameId: string;
  evaluatedAt: string;
  gameStartsAt: string;
  forecast: NflV1WeekOneOutcomeForecast;
}): boolean {
  const r = args.receipt;
  return !!r && r.release === NFL_MARKET_QUALIFICATION_RELEASE && r.evidenceQualified === true &&
    r.reason === "source_bound_law" && r.market === args.market && r.providerGameId === args.providerGameId &&
    r.providerGameId === args.forecast.providerGameId && r.evaluatedAt === args.evaluatedAt &&
    r.gameStartsAt === args.gameStartsAt && Number.isFinite(Date.parse(r.evaluatedAt)) &&
    Date.parse(r.evaluatedAt) < Date.parse(r.gameStartsAt) &&
    (r.basis === "market_free_independent_law" || r.basis === "source_bound_joint_innovation") &&
    typeof r.sourceMarketId === "string" && r.sourceMarketId.trim().length > 0 &&
    typeof r.sourceReceipt === "string" && r.sourceReceipt.trim().length > 0 && validLaw(args.forecast) &&
    r.forecastSha256 === forecastHash(args.forecast);
}

function forecastHash(forecast: NflV1WeekOneOutcomeForecast): string {
  return createHash("sha256").update(JSON.stringify({ providerGameId: forecast.providerGameId,
    awayTeam: forecast.awayTeam, homeTeam: forecast.homeTeam,
    expectedAwayScore: forecast.expectedAwayScore, expectedHomeScore: forecast.expectedHomeScore,
    homeWinProbability: forecast.homeWinProbability, awayWinProbability: forecast.awayWinProbability,
    tieProbability: forecast.tieProbability,
    margin: forecast.marginDistribution, total: forecast.totalDistribution })).digest("hex");
}
function validLaw(f: NflV1WeekOneOutcomeForecast): boolean {
  const pmf = (d: typeof f.marginDistribution) => d.values.length > 0 && d.values.length === d.probabilities.length &&
    d.values.every(Number.isFinite) && d.probabilities.every(p => Number.isFinite(p) && p >= 0) &&
    Math.abs(d.probabilities.reduce((a, b) => a + b, 0) - 1) < 1e-8;
  if (!pmf(f.marginDistribution) || !pmf(f.totalDistribution)) return false;
  const mean = (d: typeof f.marginDistribution) => d.values.reduce((sum, x, i) => sum + x * d.probabilities[i]!, 0);
  const margin = mean(f.marginDistribution), total = mean(f.totalDistribution);
  const home = f.marginDistribution.values.reduce((sum, x, i) => sum + (x > 0 ? f.marginDistribution.probabilities[i]! : 0), 0);
  const away = f.marginDistribution.values.reduce((sum, x, i) => sum + (x < 0 ? f.marginDistribution.probabilities[i]! : 0), 0);
  return total > Math.abs(margin) && f.totalDistribution.values.every(x => x >= 0) && home + away > 0 &&
    Math.abs(f.expectedHomeScore - (total + margin) / 2) < 1e-8 &&
    Math.abs(f.expectedAwayScore - (total - margin) / 2) < 1e-8 &&
    Math.abs(f.homeWinProbability - home / (home + away)) < 1e-8 &&
    Math.abs(f.awayWinProbability - away / (home + away)) < 1e-8 &&
    Math.abs(f.tieProbability - (1 - home - away)) < 1e-8;
}

export function nflSportsbookFamily(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
export function nflMarketSourceAt(book: NflPreviewBookOdds, market: Market): string {
  return book.marketObservedAt?.[market] ?? book.observedAt;
}

/** One intact, fresh paired observation per physical family, for this market only. */
export function nflPairedReferenceBooksAt(args: {
  books: NflPreviewBookOdds[];
  market: Market;
  providerGameId: string;
  evaluatedAt: string;
  gameStartsAt: string;
  executionOnly?: boolean;
}): NflPreviewBookOdds[] {
  const evaluated = Date.parse(args.evaluatedAt), kickoff = Date.parse(args.gameStartsAt);
  if (!Number.isFinite(evaluated) || !Number.isFinite(kickoff) || evaluated >= kickoff) return [];
  const families = new Map<string, { book: NflPreviewBookOdds; at: number; signature: string; conflicted: boolean }>();
  for (const book of args.books) {
    if (book.providerGameId !== args.providerGameId || args.executionOnly && book.targetEligible === false) continue;
    const at = Date.parse(nflMarketSourceAt(book, args.market));
    if (!Number.isFinite(at) || at > evaluated || at >= kickoff || evaluated - at > 120 * 60_000) continue;
    const m = book[args.market];
    if (!m) continue;
    const pair = args.market === "moneyline" ? [book.moneyline!.homePrice, book.moneyline!.awayPrice]
      : args.market === "spread" ? [book.spread!.homePrice, book.spread!.awayPrice]
        : [book.total!.overPrice, book.total!.underPrice];
    if (args.market === "spread" && (!Number.isFinite(book.spread!.homeLine) || book.spread!.awayLine !== -book.spread!.homeLine) ||
        args.market === "total" && (!Number.isFinite(book.total!.line) || book.total!.line <= 0) || !validPair(pair[0]!, pair[1]!)) continue;
    const family = nflSportsbookFamily(book.sportsbook);
    if (!family) continue;
    const signature = JSON.stringify([args.market === "spread" ? book.spread!.homeLine
      : args.market === "total" ? book.total!.line : null, pair[0], pair[1]]);
    const prior = families.get(family);
    if (!prior || at > prior.at) families.set(family, { book, at, signature, conflicted: false });
    else if (at === prior.at && signature !== prior.signature) prior.conflicted = true;
  }
  return [...families.values()].filter(row => !row.conflicted).map(row => row.book);
}
function validPair(first: number, second: number): boolean {
  const implied = (p: number) => p > 0 ? 100 / (100 + p) : -p / (100 - p);
  return [first, second].every(p => Number.isFinite(p) && (p >= 100 || p <= -100)) &&
    implied(first) + implied(second) >= .8 && implied(first) + implied(second) <= 1.2;
}
