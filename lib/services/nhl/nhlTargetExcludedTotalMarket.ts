import { canonicalizeNhlLineRows, selectNhlBestPriceQuote } from "./nhlLineBoard";
import { isBlockedSportsbook } from "../../config/blockedSportsbooks";
import {
  nhlRegularModelV1,
  type NhlFeatureSnapshot,
  type NhlModelOutput,
  type NhlTargetExcludedTotalRead,
} from "../../automodel/nhlRegularModelV1";
import {
  arbitrateNhlMarketEpisode,
  type NhlEpisodeMarket,
  type NhlMarketEpisodeDecision,
} from "./nhlMarketEpisodeArbiter";
import { canonicalNhlSportsbookFamily } from "./nhlSportsbookFamily";

export type NhlTotalMarketLineRow = {
  market_type: string;
  sportsbook: string;
  side: string;
  line_value: number | null;
  odds_american: number | null;
  observed_at?: string | null;
  source_timestamp?: string | null;
};

const NAMED_BOOKS = new Set(["circa", "pinnacle", "bookmaker"]);

function normalizedBook(value: string): string {
  return canonicalNhlSportsbookFamily(value);
}

function impliedProbability(american: number): number {
  return american > 0
    ? 100 / (american + 100)
    : -american / (-american + 100);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle]!
    : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

type TotalPair = {
  sportsbook: string;
  normalizedSportsbook: string;
  line: number;
  overProbability: number;
};

function completeTotalPairs(
  rows: readonly NhlTotalMarketLineRow[],
  targetLine: number,
): TotalPair[] {
  const canonical = canonicalizeNhlLineRows(rows.filter((row) => !isBlockedSportsbook(row.sportsbook)));
  const byBook = new Map<string, NhlTotalMarketLineRow[]>();
  for (const row of canonical) {
    if (row.market_type !== "total") continue;
    const book = normalizedBook(row.sportsbook);
    byBook.set(book, [...(byBook.get(book) ?? []), row]);
  }
  const pairs: TotalPair[] = [];
  for (const [book, bookRows] of byBook) {
    const over = bookRows.find((row) => (
      row.side === "over"
      && row.line_value !== null
      && Math.abs(row.line_value - targetLine) < 0.01
      && row.odds_american !== null
    ));
    const under = bookRows.find((row) => (
      row.side === "under"
      && row.line_value !== null
      && Math.abs(row.line_value - targetLine) < 0.01
      && row.odds_american !== null
    ));
    if (!over || !under) continue;
    const overImplied = impliedProbability(over.odds_american!);
    const underImplied = impliedProbability(under.odds_american!);
    const hold = overImplied + underImplied;
    if (hold < 0.94 || hold > 1.20) continue;
    pairs.push({
      sportsbook: over.sportsbook,
      normalizedSportsbook: book,
      line: targetLine,
      overProbability: overImplied / hold,
    });
  }
  return pairs;
}

type SequenceDirection = {
  direction: "over" | "under" | null;
  sources: string[];
  sourceClass: "named" | "broad" | "none";
};

type SequencePoint = { at: string; axis: number };

function stableSequenceDirection(
  currentRows: readonly NhlTotalMarketLineRow[],
  historyRows: readonly NhlTotalMarketLineRow[],
): SequenceDirection {
  const rows = [
    ...historyRows.map((row) => ({ ...row, observed_at: row.source_timestamp ?? row.observed_at ?? null })),
    ...currentRows,
  ].filter((row) => (
    row.market_type === "total"
    && !isBlockedSportsbook(row.sportsbook)
    && row.observed_at !== null
    && row.observed_at !== undefined
  ));
  const bySnapshot = new Map<string, NhlTotalMarketLineRow[]>();
  for (const row of rows) {
    const at = row.source_timestamp ?? row.observed_at;
    if (!at) continue;
    const key = `${normalizedBook(row.sportsbook)}|${at}`;
    bySnapshot.set(key, [...(bySnapshot.get(key) ?? []), row]);
  }

  const pointsByBook = new Map<string, SequencePoint[]>();
  for (const [key, snapshot] of bySnapshot) {
    const separator = key.lastIndexOf("|");
    const book = key.slice(0, separator);
    const at = key.slice(separator + 1);
    const overs = snapshot.filter((row) => row.side === "over" && row.line_value !== null && row.odds_american !== null);
    const candidates = overs.flatMap((over) => snapshot
      .filter((under) => (
        under.side === "under"
        && under.line_value !== null
        && under.odds_american !== null
        && Math.abs(under.line_value - over.line_value!) < 0.01
      ))
      .map((under) => ({ over, under })));
    const pair = [...candidates].sort((left, right) => (
      Math.abs(left.over.line_value! - 6) - Math.abs(right.over.line_value! - 6)
    ))[0];
    if (!pair) continue;
    const overImplied = impliedProbability(pair.over.odds_american!);
    const underImplied = impliedProbability(pair.under.odds_american!);
    const hold = overImplied + underImplied;
    if (hold < 0.94 || hold > 1.20) continue;
    const probability = overImplied / hold;
    const point = { at, axis: pair.over.line_value! + 5 * (probability - 0.5) };
    pointsByBook.set(book, [...(pointsByBook.get(book) ?? []), point]);
  }

  const trails = [...pointsByBook.entries()].flatMap(([book, rawPoints]) => {
    const points = [...new Map(rawPoints.map((point) => [`${point.at}|${point.axis}`, point])).values()]
      .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
    if (points.length < 2) return [];
    const opening = points[0]!;
    const current = points.at(-1)!;
    const movement = current.axis - opening.axis;
    if (Math.abs(movement) < 0.12) return [];
    const direction = movement > 0 ? "over" as const : "under" as const;
    const excursions = points.slice(1).map((point) => point.axis - opening.axis);
    const moved = excursions.filter((value) => Math.abs(value) >= 0.12);
    const aligned = moved.filter((value) => (value > 0 ? "over" : "under") === direction);
    const reversed = moved.some((value) => (value > 0 ? "over" : "under") !== direction);
    const persistence = moved.length === 0 ? 0 : aligned.length / moved.length;
    return reversed || persistence < 0.67 ? [] : [{ book, direction, named: NAMED_BOOKS.has(book) }];
  });

  const consensus = (eligible: typeof trails, minimumSources: number, minimumAgreement: number) => {
    if (eligible.length < minimumSources) return null;
    const over = eligible.filter((trail) => trail.direction === "over");
    const under = eligible.filter((trail) => trail.direction === "under");
    const selected = over.length >= under.length ? over : under;
    if (selected.length / eligible.length < minimumAgreement) return null;
    return { direction: selected[0]!.direction, sources: selected.map((trail) => trail.book) };
  };
  const named = consensus(trails.filter((trail) => trail.named), 2, 1);
  if (named) return { ...named, sourceClass: "named" };
  const broad = consensus(trails, 4, 0.75);
  if (broad) return { ...broad, sourceClass: "broad" };
  return { direction: null, sources: [], sourceClass: "none" };
}

export function buildNhlTargetExcludedTotalRead(args: {
  currentRows: readonly NhlTotalMarketLineRow[];
  historyRows: readonly NhlTotalMarketLineRow[];
  totalLine: number | null;
  excludedSportsbook: string | null;
}): NhlTargetExcludedTotalRead | null {
  if (args.totalLine === null || args.excludedSportsbook === null) return null;
  const excludedFamily = normalizedBook(args.excludedSportsbook);
  const pairs = completeTotalPairs(args.currentRows, args.totalLine)
    .filter((pair) => pair.normalizedSportsbook !== excludedFamily);
  if (pairs.length < 2) return null;
  const overProbability = median(pairs.map((pair) => pair.overProbability));
  if (overProbability === null) return null;
  const sequence = stableSequenceDirection(args.currentRows, args.historyRows);
  return {
    exact_line: args.totalLine,
    over_probability: overProbability,
    complete_book_count: pairs.length,
    named_book_count: pairs.filter((pair) => NAMED_BOOKS.has(pair.normalizedSportsbook)).length,
    excluded_sportsbook: args.excludedSportsbook,
    excluded_sportsbook_family: excludedFamily,
    included_sportsbook_families: pairs.map((pair) => pair.normalizedSportsbook).sort(),
    stable_sequence_direction: sequence.direction,
    stable_sequence_source_class: sequence.sourceClass,
    stable_sequence_sources: sequence.sources,
  };
}

/**
 * Resolve the evaluated Total side and target book to a fixed point. A side
 * change can move the best price to another sportsbook, so r17 repeats the
 * target exclusion until the final side is priced by the same excluded family.
 * A cycle or incomplete board fails closed to the incumbent forecast.
 */
export function buildNhlRegularMarketAwareForecast(args: {
  snapshot: NhlFeatureSnapshot;
  currentRows: readonly NhlTotalMarketLineRow[];
  historyRows: readonly NhlTotalMarketLineRow[];
}): {
  snapshot: NhlFeatureSnapshot;
  model: NhlModelOutput;
  seedModel: NhlModelOutput;
  targetExcludedTotalRead: NhlTargetExcludedTotalRead | null;
  targetExclusionStatus: "stable" | "unavailable" | "cycle_fail_closed";
} {
  const currentRows = args.currentRows.filter((row) => !isBlockedSportsbook(row.sportsbook));
  const seedSnapshot: NhlFeatureSnapshot = {
    ...args.snapshot,
    market: {
      ...args.snapshot.market,
      moneyline_market_episode: null,
      spread_market_episode: null,
      total_market_episode: null,
      target_excluded_total_read: null,
      target_exclusion_status: "unavailable",
    },
  };
  const seedModel = nhlRegularModelV1(seedSnapshot);
  const paths = seedSnapshot.market.market_episode_paths ?? [];
  const decisionAt = seedSnapshot.market.market_decision_at ?? new Date().toISOString();
  const totalLine = seedSnapshot.market.market_total_line;
  const homePuckLine = seedSnapshot.market.market_home_puck_line;
  const awayPuckLine = seedSnapshot.market.market_away_puck_line;
  const contractKey = (market: NhlEpisodeMarket): string => market === "moneyline"
    ? "full_game_ml"
    : market === "total"
      ? `total:${totalLine?.toFixed(1) ?? "none"}`
      : `spread:${homePuckLine?.toFixed(1) ?? "none"}:${awayPuckLine?.toFixed(1) ?? "none"}`;
  const modelSide = (model: NhlModelOutput, market: NhlEpisodeMarket): "home" | "away" | "over" | "under" => {
    if (market === "total") return model.total.pick.startsWith("OVER") ? "over" : "under";
    const pick = market === "moneyline" ? model.moneyline.pick : model.puck_line.pick;
    return pick.startsWith(seedSnapshot.home.abbreviation) ? "home" : "away";
  };
  const modelLine = (model: NhlModelOutput, market: NhlEpisodeMarket): number | null => {
    if (market === "moneyline") return null;
    if (market === "total") return totalLine;
    return model.puck_line.puck_line_value;
  };
  const executionQuote = (model: NhlModelOutput, market: NhlEpisodeMarket) => selectNhlBestPriceQuote({
    rows: currentRows,
    market,
    side: modelSide(model, market),
    line: modelLine(model, market),
  });
  const decision = (market: NhlEpisodeMarket, model: NhlModelOutput): NhlMarketEpisodeDecision => {
    const quote = executionQuote(model, market);
    const pressure = market === "moneyline"
      ? seedSnapshot.market.moneyline_pressure_receipt
      : market === "spread"
        ? seedSnapshot.market.spread_pressure_receipt
        : seedSnapshot.market.total_pressure_receipt;
    return arbitrateNhlMarketEpisode({
      market,
      contractKey: contractKey(market),
      decisionAt,
      executionSportsbookFamily: quote?.sportsbook ?? null,
      paths,
      pressure,
      materialMove: market === "moneyline" ? 0.01 : 0.12,
      maximumPathAgeMs: 3 * 60 * 60 * 1_000,
      maximumPressureAgeMs: 3 * 60 * 60 * 1_000,
      followerWindowMs: 45 * 60 * 1_000,
    });
  };
  const executionFingerprint = (model: NhlModelOutput): string => (["moneyline", "spread", "total"] as const)
    .map((market) => {
      const quote = executionQuote(model, market);
      return `${market}:${modelSide(model, market)}:${modelLine(model, market) ?? "none"}:${normalizedBook(quote?.sportsbook ?? "none")}`;
    })
    .join("|");

  let incumbentModel = seedModel;
  const visited = new Set<string>();
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const state = executionFingerprint(incumbentModel);
    if (visited.has(state)) {
      const snapshot: NhlFeatureSnapshot = {
        ...seedSnapshot,
        market: { ...seedSnapshot.market, target_exclusion_status: "cycle_fail_closed" },
      };
      return {
        snapshot,
        model: seedModel,
        seedModel,
        targetExcludedTotalRead: null,
        targetExclusionStatus: "cycle_fail_closed",
      };
    }
    visited.add(state);
    const moneylineEpisode = decision("moneyline", incumbentModel);
    const spreadEpisode = decision("spread", incumbentModel);
    const totalEpisode = decision("total", incumbentModel);
    const snapshot: NhlFeatureSnapshot = {
      ...seedSnapshot,
      market: {
        ...seedSnapshot.market,
        moneyline_market_episode: moneylineEpisode,
        spread_market_episode: spreadEpisode,
        total_market_episode: totalEpisode,
        target_exclusion_status: "stable",
      },
    };
    const model = nhlRegularModelV1(snapshot);
    const finalState = executionFingerprint(model);
    if (finalState === state) {
      return {
        snapshot,
        model,
        seedModel,
        targetExcludedTotalRead: null,
        targetExclusionStatus: "stable",
      };
    }
    incumbentModel = model;
  }
  const snapshot: NhlFeatureSnapshot = {
    ...seedSnapshot,
    market: { ...seedSnapshot.market, target_exclusion_status: "cycle_fail_closed" },
  };
  return {
    snapshot,
    model: seedModel,
    seedModel,
    targetExcludedTotalRead: null,
    targetExclusionStatus: "cycle_fail_closed",
  };
}
