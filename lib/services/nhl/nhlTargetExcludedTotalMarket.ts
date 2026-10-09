import { canonicalizeNhlLineRows, selectNhlBestPriceQuote } from "./nhlLineBoard";
import { isBlockedSportsbook } from "../../config/blockedSportsbooks";
import {
  nhlRegularModelV1,
  type NhlFeatureSnapshot,
  type NhlModelOutput,
  type NhlTargetExcludedTotalRead,
} from "../../automodel/nhlRegularModelV1";

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
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
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
      target_excluded_total_read: null,
      target_exclusion_status: "unavailable",
    },
  };
  const seedModel = nhlRegularModelV1(seedSnapshot);
  const line = seedSnapshot.market.market_total_line;
  if (line === null) {
    return {
      snapshot: seedSnapshot,
      model: seedModel,
      seedModel,
      targetExcludedTotalRead: null,
      targetExclusionStatus: "unavailable",
    };
  }

  let side: "over" | "under" = seedModel.total.pick.startsWith("OVER") ? "over" : "under";
  let target = selectNhlBestPriceQuote({ rows: currentRows, market: "total", side, line });
  const visited = new Set<string>();
  for (let iteration = 0; iteration < 6; iteration += 1) {
    if (!target) break;
    const state = `${side}|${normalizedBook(target.sportsbook)}`;
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
    const targetExcludedTotalRead = buildNhlTargetExcludedTotalRead({
      currentRows,
      historyRows: args.historyRows,
      totalLine: line,
      excludedSportsbook: target.sportsbook,
    });
    if (!targetExcludedTotalRead) break;
    const snapshot: NhlFeatureSnapshot = {
      ...seedSnapshot,
      market: {
        ...seedSnapshot.market,
        target_excluded_total_read: targetExcludedTotalRead,
        target_exclusion_status: "stable",
      },
    };
    const model = nhlRegularModelV1(snapshot);
    if (model.layers.total_market_target_goals === null) break;
    const finalSide = model.total.pick.startsWith("OVER") ? "over" : "under";
    const finalTarget = selectNhlBestPriceQuote({
      rows: currentRows,
      market: "total",
      side: finalSide,
      line,
    });
    if (finalTarget && normalizedBook(finalTarget.sportsbook) === normalizedBook(target.sportsbook)) {
      return {
        snapshot,
        model,
        seedModel,
        targetExcludedTotalRead,
        targetExclusionStatus: "stable",
      };
    }
    side = finalSide;
    target = finalTarget;
  }
  return {
    snapshot: seedSnapshot,
    model: seedModel,
    seedModel,
    targetExcludedTotalRead: null,
    targetExclusionStatus: "unavailable",
  };
}
