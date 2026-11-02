import { OwlsInsightClient } from "@/lib/providers/owls/owlsInsightClient";
import {
  normalizeOwlsSharpBookSplits,
  type NormalizedOwlsSplitObservation,
  type RawOwlsSplitsResponse,
} from "@/lib/providers/owls/owlsSharpBookSplits";
import type { NflPreviewGame } from "./balldontlieNflPreviewSlate";
import type { NflEpisodeHistoryBook } from "./nflMoneylineEpisodeTransport";
import {
  completeSharpApiNflSplitSet,
  nflProviderTeamMatches,
  type NflRegularSharpMarket,
  type NflRegularSharpSplit,
  type NflRegularSharpSplitSet,
} from "./sharpApiNflSplits";

export const NFL_OWLS_SPLITS_RELEASE =
  "nfl_owls_splits_2026_11_02_r3_unique_canonical_game_claims" as const;

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
  return mapNflOwlsSplits({ games: args.games, capturedAt: args.capturedAt, response: response.body });
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
    const selected = SOURCE_BOOK_PRIORITY.flatMap((sportsbook) => {
      const bookRows = observations.filter((row) => row.sourceBook === sportsbook);
      const split = buildSplitSet(game, providerEventId, bookRows, args.capturedAt);
      return split && completeSharpApiNflSplitSet(split) ? [split] : [];
    })[0] ?? null;
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
  const market = (value: NflRegularSharpMarket) => {
    const rows = observations.filter((row) => row.market === value && row.complete);
    const expected = value === "total" ? ["over", "under"] : ["away", "home"];
    if (rows.length !== 2 || expected.some((side) => rows.filter((row) => row.side === side).length !== 1)) return [];
    if (rows[0]!.observedAt !== rows[1]!.observedAt) return [];
    return rows;
  };
  const moneyline = market("moneyline");
  const spread = market("spread");
  const total = market("total");
  if (moneyline.length !== 2 || spread.length !== 2 || total.length !== 2) return null;
  const row = (rows: NormalizedOwlsSplitObservation[], side: string) => rows.find((candidate) => candidate.side === side)!;
  const spreadHomeLine = row(spread, "home").line;
  const spreadAwayLine = row(spread, "away").line;
  const totalLine = row(total, "over").line;
  if (spreadHomeLine === null || spreadAwayLine === null ||
      Math.abs(spreadHomeLine + spreadAwayLine) > 1e-9 ||
      totalLine === null || row(total, "under").line !== totalLine) return null;
  const sportsbook = observations[0]!.sourceBook;
  const base = (marketRows: NormalizedOwlsSplitObservation[]) => ({
    provider: "owls" as const,
    providerGameId: game.providerGameId,
    sourceEventId: providerEventId,
    sourceSportsbook: sportsbook,
    sourceLine: marketRows[0]!.market === "spread" ? spreadHomeLine
      : marketRows[0]!.market === "total" ? totalLine : null,
    capturedAt,
    providerFetchedAt: marketRows[0]!.observedAt,
  });
  const percentage = (value: number | null) => value === null ? null : Number((value * 100).toFixed(6));
  const sideMarket = (marketRows: NormalizedOwlsSplitObservation[]): NflRegularSharpSplit => ({
    ...base(marketRows),
    homeMoneyPct: percentage(row(marketRows, "home").moneyPct),
    awayMoneyPct: percentage(row(marketRows, "away").moneyPct),
    homeBetsPct: percentage(row(marketRows, "home").betsPct),
    awayBetsPct: percentage(row(marketRows, "away").betsPct),
    overMoneyPct: null,
    underMoneyPct: null,
    overBetsPct: null,
    underBetsPct: null,
  });
  return {
    moneyline: sideMarket(moneyline),
    spread: sideMarket(spread),
    total: {
      ...base(total),
      homeMoneyPct: null,
      awayMoneyPct: null,
      homeBetsPct: null,
      awayBetsPct: null,
      overMoneyPct: percentage(row(total, "over").moneyPct),
      underMoneyPct: percentage(row(total, "under").moneyPct),
      overBetsPct: percentage(row(total, "over").betsPct),
      underBetsPct: percentage(row(total, "under").betsPct),
    },
  };
}

export type NflOwlsModelSplitQualification = {
  splits: NflRegularSharpSplitSet | null;
  qualifiedMarkets: NflRegularSharpMarket[];
  reasons: Partial<Record<NflRegularSharpMarket, "missing_or_unverified_circa" | "stale_or_future" | "different_line">>;
};

export const NFL_OWLS_SOURCE_REACTION_RELEASE = "nfl_owls_source_reaction_2026_11_02_r2_latest_preflow_economic_baseline" as const;
export type NflSourceContractReactionFlow = {
  market: NflRegularSharpMarket;
  book: "circa" | "pinnacle";
  sourceLine: number | null;
  sourceEventId: string;
  providerGameId: string;
  observedAt: string;
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
    const observed = Date.parse(row.providerFetchedAt ?? "");
    if (![evaluated, starts, observed].every(Number.isFinite) || observed > evaluated || evaluated >= starts ||
      evaluated - observed > 120 * 60_000) { reject("stale_future_or_post_start"); continue; }
    const percentages = market === "total"
      ? [row.overMoneyPct, row.underMoneyPct, row.overBetsPct, row.underBetsPct]
      : [row.homeMoneyPct, row.awayMoneyPct, row.homeBetsPct, row.awayBetsPct];
    if (!percentages.every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100) ||
      Math.abs(percentages[0]! + percentages[1]! - 100) > 1e-4 ||
      Math.abs(percentages[2]! + percentages[3]! - 100) > 1e-4) { reject("incomplete_source_percentages"); continue; }
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
    const moneyPct = percentages[0]!;
    const ticketPct = percentages[2]!;
    const gap = moneyPct - ticketPct;
    const pressure = Math.abs(gap) > 1e-9 ? Math.sign(gap) : Math.sign(moneyPct - 50);
    if (!pressure) { reject("balanced_source_pressure"); continue; }
    result.flows[market] = [{ market, book, sourceLine: sourceLine ?? null,
      sourceEventId: row.sourceEventId, providerGameId: args.providerGameId,
      observedAt: row.providerFetchedAt!, pairedQuoteObservedAt: paired[0].marketObservedAt?.[market] ?? paired[0].observedAt,
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
  if (!value || !completeSharpApiNflSplitSet(value)) return empty;
  const rows = markets.map((market) => value[market]);
  if (rows.some((row) => row.provider !== "owls" || row.sourceSportsbook !== "circa" ||
      row.providerGameId !== args.providerGameId || !row.sourceEventId) ||
      new Set(rows.map((row) => row.sourceEventId)).size !== 1) return empty;
  const evaluatedMs = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluatedMs)) return empty;
  const reasons: NflOwlsModelSplitQualification["reasons"] = {};
  const qualifiedMarkets = markets.filter((market) => {
    const row = value[market];
    const observedMs = Date.parse(row.providerFetchedAt ?? "");
    if (!Number.isFinite(observedMs) || observedMs > evaluatedMs || evaluatedMs - observedMs > 120 * 60_000) {
      reasons[market] = "stale_or_future";
      return false;
    }
    const targetLine = market === "spread" ? args.currentHomeSpread
      : market === "total" ? args.currentTotal : null;
    if (market !== "moneyline" && (targetLine === null || row.sourceLine === null ||
        row.sourceLine === undefined || Math.abs(row.sourceLine - targetLine) > 1e-9)) {
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
