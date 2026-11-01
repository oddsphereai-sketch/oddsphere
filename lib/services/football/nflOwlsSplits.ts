import { OwlsInsightClient } from "@/lib/providers/owls/owlsInsightClient";
import {
  normalizeOwlsSharpBookSplits,
  type NormalizedOwlsSplitObservation,
  type RawOwlsSplitsResponse,
} from "@/lib/providers/owls/owlsSharpBookSplits";
import type { NflPreviewGame } from "./balldontlieNflPreviewSlate";
import {
  completeSharpApiNflSplitSet,
  nflProviderTeamMatches,
  type NflRegularSharpMarket,
  type NflRegularSharpSplit,
  type NflRegularSharpSplitSet,
} from "./sharpApiNflSplits";

export const NFL_OWLS_SPLITS_RELEASE =
  "nfl_owls_splits_2026_10_31_r2_exact_line_model_qualification" as const;

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
  const claimedEvents = new Set<string>();

  for (const [providerEventId, observations] of byEvent) {
    const matches = args.games.filter((game) => exactGame(game, observations[0]!));
    if (matches.length !== 1) {
      rejected.push(`${providerEventId}: ${matches.length === 0 ? "unmatched" : "ambiguous"} NFL game`);
      continue;
    }
    if (claimedEvents.has(providerEventId)) {
      rejected.push(`${providerEventId}: provider event matched multiple NFL games`);
      continue;
    }
    claimedEvents.add(providerEventId);
    const game = matches[0]!;
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
