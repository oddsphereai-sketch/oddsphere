import { OwlsInsightClient } from "@/lib/providers/owls/owlsInsightClient";
import {
  normalizeOwlsSharpBookSplits,
  type NormalizedOwlsSplitObservation,
  type RawOwlsSplitsResponse,
} from "@/lib/providers/owls/owlsSharpBookSplits";
import type { NflPreviewGame } from "./balldontlieNflPreviewSlate";
import type { NflEpisodeHistoryBook } from "./nflMoneylineEpisodeTransport";
import {
  nflProviderTeamMatches,
  type NflRegularSharpMarket,
  type NflRegularSharpSplit,
  type NflRegularSharpSplitSet,
} from "./sharpApiNflSplits";

export const NFL_OWLS_SPLITS_RELEASE =
  "nfl_owls_splits_2026_11_04_r5_per_market_source_qualification" as const;

const SOURCE_BOOK_PRIORITY = ["circa", "draftkings", "betmgm"] as const;

export type NflOwlsSplitsResult = {
  release: typeof NFL_OWLS_SPLITS_RELEASE;
  splitsByGame: Record<string, NflRegularSharpSplitSet>;
  requests: 1;
  events: number;
  rows: number;
  matchedGames: number;
  feedStatus: "ok" | "partial" | "unknown";
  partialReason: string | null;
  rejected: string[];
};

export async function fetchNflOwlsSplits(args: {
  games: NflPreviewGame[];
  capturedAt: string;
  apiKey?: string;
  client?: Pick<OwlsInsightClient, "splits">;
}): Promise<NflOwlsSplitsResult> {
  const key = args.apiKey ?? process.env.OWLS_INSIGHT_API_KEY;
  if (!key && !args.client) throw new Error("OWLS_INSIGHT_API_KEY is required for NFL Owls splits.");
  const client = args.client ?? new OwlsInsightClient(key!);
  const response = await client.splits<RawOwlsSplitsResponse>("nfl");
  // Request/run start is not response availability. Keep the source's as_of
  // unchanged and record when this exact response was actually received.
  const receivedAt = new Date().toISOString();
  return mapNflOwlsSplits({ games: args.games, capturedAt: receivedAt, response: response.body });
}

export function mapNflOwlsSplits(args: {
  games: NflPreviewGame[];
  capturedAt: string;
  response: RawOwlsSplitsResponse;
}): NflOwlsSplitsResult {
  const coverage = normalizeOwlsSharpBookSplits(args.response, "nfl");
  const byEvent = groupBy(coverage.observations, (row) => row.providerEventId);
  const splitsByGame: Record<string, NflRegularSharpSplitSet> = {};
  const rejected = [...coverage.rejected];
  const matchedEvents = new Map<string, NflPreviewGame>();
  const claimsByGame = new Map<string, string[]>();
  for (const [providerEventId, observations] of byEvent) {
    const matches = args.games.filter((game) => observations.every(row => exactGame(game, row)));
    if (matches.length !== 1) {
      rejected.push(`${providerEventId}: ${matches.length === 0 ? "unmatched" : "ambiguous"} NFL game`);
      continue;
    }
    const game = matches[0]!;
    matchedEvents.set(providerEventId, game);
    claimsByGame.set(game.providerGameId, [...(claimsByGame.get(game.providerGameId) ?? []), providerEventId]);
  }
  const ambiguousGames = new Set<string>();
  for (const [gameId, claims] of [...claimsByGame].sort(([a], [b]) => a.localeCompare(b))) {
    if (claims.length <= 1) continue;
    ambiguousGames.add(gameId);
    rejected.push(`${gameId}: ambiguous provider event claims for one canonical NFL game: ${claims.sort().join(", ")}`);
  }
  for (const [providerEventId, observations] of byEvent) {
    const game = matchedEvents.get(providerEventId);
    if (!game || ambiguousGames.has(game.providerGameId)) continue;
    // Markets are separate native contracts. Missing one book market must
    // not discard its complete ML or borrow another book's money percentages.
    const selected = buildSplitSet(game, providerEventId, observations, args.capturedAt);
    if (selected) splitsByGame[game.providerGameId] = selected;
  }

  return {
    release: NFL_OWLS_SPLITS_RELEASE,
    splitsByGame,
    requests: 1,
    events: coverage.eventCount,
    rows: coverage.observations.length,
    matchedGames: Object.keys(splitsByGame).length,
    feedStatus: coverage.feedStatus,
    partialReason: coverage.partialReason,
    rejected,
  };
}

function buildSplitSet(
  game: NflPreviewGame,
  providerEventId: string,
  observations: NormalizedOwlsSplitObservation[],
  capturedAt: string,
): NflRegularSharpSplitSet | null {
  const percentage = (value: number | null) => value === null ? null : Number((value * 100).toFixed(6));
  const market = (value: NflRegularSharpMarket) => {
    const expected = value === "total" ? ["over", "under"] : ["away", "home"];
    return SOURCE_BOOK_PRIORITY.flatMap(book => {
      const rows = observations.filter(row => row.sourceBook === book && row.market === value && row.complete);
      if (rows.length !== 2 || expected.some(side => rows.filter(row => row.side === side).length !== 1) ||
          rows[0]!.observedAt !== rows[1]!.observedAt) return [];
      const home = rows.find(row => row.side === (value === "total" ? "over" : "home"))!;
      const away = rows.find(row => row.side === (value === "total" ? "under" : "away"))!;
      // The normalized collector permits rounded published pairs. Retain
      // those exact values, without deriving missing money from ticket data.
      if (!nflPublishedSourcePressure([percentage(home.moneyPct), percentage(away.moneyPct),
          percentage(home.betsPct), percentage(away.betsPct)])) return [];
      if (value === "spread" && (home.line === null || away.line === null ||
          !Number.isFinite(home.line) || !Number.isFinite(away.line) || Math.abs(home.line + away.line) > 1e-9)) return [];
      if (value === "total" && (home.line === null || !Number.isFinite(home.line) || home.line <= 0 || home.line !== away.line)) return [];
      return [rows];
    })[0] ?? [];
  };
  const selected = { moneyline: market("moneyline"), spread: market("spread"), total: market("total") };
  if (!Object.values(selected).some(rows => rows.length === 2)) return null;
  return Object.fromEntries((["moneyline","spread","total"] as const).map(kind => {
    const rows = selected[kind], first = rows[0];
    const home = rows.find(row => row.side === (kind === "total" ? "over" : "home"));
    const away = rows.find(row => row.side === (kind === "total" ? "under" : "away"));
    return [kind, {
      provider: "owls", providerGameId: game.providerGameId, sourceEventId: providerEventId,
      sourceSportsbook: first?.sourceBook ?? null, sourceLine: kind === "moneyline" ? null : home?.line ?? null,
      capturedAt, providerFetchedAt: first?.observedAt ?? null,
      homeMoneyPct: kind === "total" ? null : percentage(home?.moneyPct ?? null),
      awayMoneyPct: kind === "total" ? null : percentage(away?.moneyPct ?? null),
      homeBetsPct: kind === "total" ? null : percentage(home?.betsPct ?? null),
      awayBetsPct: kind === "total" ? null : percentage(away?.betsPct ?? null),
      overMoneyPct: kind === "total" ? percentage(home?.moneyPct ?? null) : null,
      underMoneyPct: kind === "total" ? percentage(away?.moneyPct ?? null) : null,
      overBetsPct: kind === "total" ? percentage(home?.betsPct ?? null) : null,
      underBetsPct: kind === "total" ? percentage(away?.betsPct ?? null) : null,
    }];
  })) as NflRegularSharpSplitSet;
}

/** Feed availability is independent of full three-market model eligibility. */
export function hasNflOwlsSplitMarketCoverage(splits: NflRegularSharpSplitSet | null): boolean {
  return splits !== null && Object.entries(splits).some(([market, row]) =>
    row.provider === "owls" && nflPublishedSourcePressure(market === "total"
      ? [row.overMoneyPct, row.underMoneyPct, row.overBetsPct, row.underBetsPct]
      : [row.homeMoneyPct, row.awayMoneyPct, row.homeBetsPct, row.awayBetsPct]) !== null);
}

export type NflOwlsModelSplitQualification = {
  splits: NflRegularSharpSplitSet | null;
  qualifiedMarkets: NflRegularSharpMarket[];
  reasons: Partial<Record<NflRegularSharpMarket, "missing_or_unverified_circa" | "stale_or_future" | "different_line" | "incomplete_source_market">>;
};

export const NFL_OWLS_SOURCE_REACTION_RELEASE = "nfl_owls_source_reaction_2026_11_02_r3_published_rounding_pressure" as const;

/** Preserve the provider's published percentages. Independently rounded whole
 * percentages can sum to 99 or 101; that is not missing source data. Decimal
 * inconsistencies and larger discrepancies remain invalid. A newly admitted
 * rounded pair cannot manufacture a direction from a one-point uncertain gap. */
export function nflPublishedSourcePressure(values: Array<number | null | undefined>): {
  direction: -1 | 0 | 1; moneyPct: number; ticketPct: number; gap: number; rounded: boolean;
} | null {
  if (values.length !== 4 || !values.every(value => typeof value === "number" &&
      Number.isFinite(value) && value >= 0 && value <= 100)) return null;
  const numbers = values as number[];
  let rounded = false;
  for (const pair of [numbers.slice(0, 2), numbers.slice(2, 4)]) {
    const discrepancy = Math.abs(pair[0]! + pair[1]! - 100);
    if (discrepancy <= 1e-4) continue;
    if (!pair.every(Number.isInteger) || discrepancy > 1) return null;
    rounded = true;
  }
  const moneyPct = numbers[0]!, ticketPct = numbers[2]!, gap = moneyPct - ticketPct;
  const pressure = rounded && Math.abs(gap) <= 1 && gap !== 0 ? 0
    : Math.abs(gap) > 1e-9 ? Math.sign(gap) : Math.sign(moneyPct - 50);
  return { direction: pressure > 0 ? 1 : pressure < 0 ? -1 : 0,
    moneyPct, ticketPct, gap, rounded };
}
export type NflSourceContractReactionFlow = {
  market: NflRegularSharpMarket;
  book: "circa" | "pinnacle";
  sourceLine: number | null;
  sourceEventId: string;
  providerGameId: string;
  observedAt: string;
  availableAt?: string;
  pairedQuoteObservedAt: string;
  /** Latest complete same-book paired quote before flow, across contracts; never borrow an older handicap for reaction economics. */
  reactionBaselineObservedAt: string;
  direction: -1 | 1;
  moneyPct: number;
  ticketPct: number;
  moneyTicketDifferencePp: number;
  authority: "source_contract_reaction_context_only";
};

/** Preserve qualified pressure on the source's actual contract. This does not
 * relax direct-target qualification or confer target probability authority.
 * The original split clock must have a complete, fresh, same-event paired
 * quote on that source line already available at or before that clock.
 */
export function qualifyNflOwlsSplitsForSourceReaction(args: {
  splits: NflRegularSharpSplitSet | null;
  providerGameId: string;
  evaluatedAt: string;
  gameStartsAt: string;
  history: NflEpisodeHistoryBook[];
  excludedFamiliesByMarket: Record<NflRegularSharpMarket, string[]>;
}): {
  release: typeof NFL_OWLS_SOURCE_REACTION_RELEASE;
  flows: Partial<Record<NflRegularSharpMarket, NflSourceContractReactionFlow[]>>;
  reasons: Partial<Record<NflRegularSharpMarket, string>>;
} {
  const result: ReturnType<typeof qualifyNflOwlsSplitsForSourceReaction> = {
    release: NFL_OWLS_SOURCE_REACTION_RELEASE, flows: {}, reasons: {},
  };
  const evaluated = Date.parse(args.evaluatedAt);
  const starts = Date.parse(args.gameStartsAt);
  for (const market of ["moneyline", "spread", "total"] as const) {
    const row = args.splits?.[market];
    const reject = (reason: string) => { result.reasons[market] = reason; };
    const book = row?.sourceSportsbook?.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!row || row.provider !== "owls" || (book !== "circa" && book !== "pinnacle") ||
      row.providerGameId !== args.providerGameId || !row.sourceEventId) { reject("source_identity_unverified"); continue; }
    if (args.excludedFamiliesByMarket[market].some(value => value.toLowerCase().replace(/[^a-z0-9]/g, "") === book)) {
      reject("evaluated_family_excluded"); continue;
    }
    const observed = Date.parse(row.providerFetchedAt ?? ""), received = Date.parse(row.capturedAt);
    if (![evaluated, starts, observed, received].every(Number.isFinite) || observed > received ||
      received > evaluated || evaluated >= starts ||
      evaluated - observed > 120 * 60_000) { reject("stale_future_or_post_start"); continue; }
    const percentages = market === "total"
      ? [row.overMoneyPct, row.underMoneyPct, row.overBetsPct, row.underBetsPct]
      : [row.homeMoneyPct, row.awayMoneyPct, row.homeBetsPct, row.awayBetsPct];
    const publishedPressure = nflPublishedSourcePressure(percentages);
    if (!publishedPressure) { reject("incomplete_source_percentages"); continue; }
    const sourceLine = market === "moneyline" ? null : row.sourceLine;
    if (market !== "moneyline" && (typeof sourceLine !== "number" || !Number.isFinite(sourceLine) ||
      (market === "total" && sourceLine <= 0))) { reject("source_contract_missing"); continue; }
    const priorPairs = args.history.filter(quote => {
      if (quote.providerGameId !== args.providerGameId || quote.provider !== "owls" ||
        quote.providerEventId !== row.sourceEventId ||
        quote.sportsbook.toLowerCase().replace(/[^a-z0-9]/g, "") !== book) return false;
      const stamp = Date.parse(quote.marketObservedAt?.[market] ?? quote.observedAt);
      if (!Number.isFinite(stamp) || stamp > observed || observed - stamp > 120 * 60_000) return false;
      const data = quote[market];
      if (!data) return false;
      const prices = market === "moneyline" ? [quote.moneyline!.homePrice, quote.moneyline!.awayPrice]
        : market === "spread" ? [quote.spread!.homePrice, quote.spread!.awayPrice]
          : [quote.total!.overPrice, quote.total!.underPrice];
      if (!prices.every(price => Number.isFinite(price) && (price <= -100 || price >= 100))) return false;
      return market === "moneyline" || (market === "spread"
        ? Number.isFinite(quote.spread!.homeLine) && quote.spread!.awayLine === -quote.spread!.homeLine
        : Number.isFinite(quote.total!.line) && quote.total!.line > 0);
    }).sort((a, b) => Date.parse(b.marketObservedAt?.[market] ?? b.observedAt) - Date.parse(a.marketObservedAt?.[market] ?? a.observedAt));
    const paired = priorPairs.filter(quote => market === "moneyline" || (market === "spread"
      ? Math.abs(quote.spread!.homeLine - sourceLine!) <= 1e-9
      : Math.abs(quote.total!.line - sourceLine!) <= 1e-9));
    if (!paired[0]) { reject("no_prior_complete_source_contract_pair"); continue; }
    const baseline = priorPairs[0]!;
    const baselineClock = Date.parse(baseline.marketObservedAt?.[market] ?? baseline.observedAt);
    const pairClock = Date.parse(paired[0].marketObservedAt?.[market] ?? paired[0].observedAt);
    if (new Set(paired.filter(quote => Date.parse(quote.marketObservedAt?.[market] ?? quote.observedAt) === pairClock)
      .map(quote => JSON.stringify(quote[market]))).size > 1) { reject("conflicting_source_contract_pairs"); continue; }
    if (new Set(priorPairs.filter(quote => Date.parse(quote.marketObservedAt?.[market] ?? quote.observedAt) === baselineClock)
      .map(quote => JSON.stringify(quote[market]))).size > 1) { reject("conflicting_source_economic_baselines"); continue; }
    const { moneyPct, ticketPct, gap, direction: pressure } = publishedPressure;
    if (!pressure) { reject(publishedPressure.rounded ? "ambiguous_rounded_source_pressure" : "balanced_source_pressure"); continue; }
    result.flows[market] = [{ market, book, sourceLine: sourceLine ?? null,
      sourceEventId: row.sourceEventId, providerGameId: args.providerGameId,
      observedAt: row.providerFetchedAt!, availableAt: row.capturedAt, pairedQuoteObservedAt: paired[0].marketObservedAt?.[market] ?? paired[0].observedAt,
      reactionBaselineObservedAt: baseline.marketObservedAt?.[market] ?? baseline.observedAt,
      direction: pressure > 0 ? 1 : -1, moneyPct, ticketPct, moneyTicketDifferencePp: gap,
      authority: "source_contract_reaction_context_only" }];
  }
  return result;
}

/**
 * Reuse the exact-game Owls capture, but never equate a split on another line
 * with the evaluated main-line contract. A partial set masks only the mismatched
 * market; it does not turn DraftKings/BetMGM display fallback into sharp flow.
 */
export function qualifyNflOwlsSplitsForModel(args: {
  splits: NflRegularSharpSplitSet | null;
  providerGameId: string;
  evaluatedAt: string;
  currentHomeSpread: number | null;
  currentTotal: number | null;
}): NflOwlsModelSplitQualification {
  const markets: NflRegularSharpMarket[] = ["moneyline", "spread", "total"];
  const value = args.splits;
  const empty = { splits: null, qualifiedMarkets: [],
    reasons: Object.fromEntries(markets.map((market) => [market, "missing_or_unverified_circa"])) as
      NflOwlsModelSplitQualification["reasons"] };
  if (!value) return empty;
  // Native identities cannot be combined merely because participants or
  // percentages happen to agree; the mapper already attests one event claim.
  const identities = markets.map(market => value[market]).filter(row => row?.sourceSportsbook && row.sourceEventId);
  if (new Set(identities.map(row => row.sourceEventId)).size > 1) return empty;
  const evaluatedMs = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluatedMs)) return empty;
  const reasons: NflOwlsModelSplitQualification["reasons"] = {};
  const qualifiedMarkets = markets.filter((market) => {
    const row = value[market];
    if (!row || row.provider !== "owls" || row.sourceSportsbook !== "circa" ||
        row.providerGameId !== args.providerGameId || !row.sourceEventId) {
      reasons[market] = "missing_or_unverified_circa"; return false;
    }
    const percentages = market === "total"
      ? [row.overMoneyPct,row.underMoneyPct,row.overBetsPct,row.underBetsPct]
      : [row.homeMoneyPct,row.awayMoneyPct,row.homeBetsPct,row.awayBetsPct];
    if (!nflPublishedSourcePressure(percentages)) { reasons[market] = "incomplete_source_market"; return false; }
    const observedMs = Date.parse(row.providerFetchedAt ?? ""), receivedMs = Date.parse(row.capturedAt);
    if (![observedMs,receivedMs].every(Number.isFinite) || observedMs > receivedMs || receivedMs > evaluatedMs ||
        evaluatedMs - observedMs > 120 * 60_000) {
      reasons[market] = "stale_or_future";
      return false;
    }
    const targetLine = market === "spread" ? args.currentHomeSpread
      : market === "total" ? args.currentTotal : null;
    if (market !== "moneyline" && (targetLine === null || !Number.isFinite(targetLine) ||
        row.sourceLine === null || row.sourceLine === undefined || !Number.isFinite(row.sourceLine) ||
        Math.abs(row.sourceLine - targetLine) > 1e-9)) {
      reasons[market] = "different_line";
      return false;
    }
    return true;
  });
  if (qualifiedMarkets.length === 0) return { splits: null, qualifiedMarkets, reasons };
  const masked = (row: NflRegularSharpSplit): NflRegularSharpSplit => ({ ...row,
    homeMoneyPct: null, awayMoneyPct: null, homeBetsPct: null, awayBetsPct: null,
    overMoneyPct: null, underMoneyPct: null, overBetsPct: null, underBetsPct: null,
  });
  return { splits: Object.fromEntries(markets.map((market) => [market,
    qualifiedMarkets.includes(market) ? value[market] : masked(value[market]),
  ])) as NflRegularSharpSplitSet, qualifiedMarkets, reasons };
}

function exactGame(game: NflPreviewGame, row: NormalizedOwlsSplitObservation): boolean {
  if (!nflProviderTeamMatches(row.homeTeam, game.home.abbreviation, game.home.name) ||
      !nflProviderTeamMatches(row.awayTeam, game.away.abbreviation, game.away.name)) return false;
  const eventDate = providerEventDate(row.providerEventId);
  return eventDate === null || acceptedGameDates(game.scheduledStart).has(eventDate);
}

function providerEventDate(value: string): string | null {
  const match = value.match(/(?:-|_)(\d{4})-?(\d{2})-?(\d{2})(?:\D|$)/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function acceptedGameDates(scheduledStart: string): Set<string> {
  return new Set([
    scheduledStart.slice(0, 10),
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(scheduledStart)),
  ]);
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) result.set(key(row), [...(result.get(key(row)) ?? []), row]);
  return result;
}

export const __TEST__ = { providerEventDate, exactGame };
