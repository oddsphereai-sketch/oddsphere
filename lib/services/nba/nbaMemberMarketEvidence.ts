import type {
  MarketEdgeDto,
  OddsTrailStopDto,
} from "../../../app/lab/lib/labTypes";
import type { MarketSplitDisplaySection } from "../../types/domain/RecommendationDecision";
import type { MarketIntelligence, NbaDailyEdgeGameDto } from "./buildNbaDailyEdgeDto";
import type {
  NbaReaderPriceRow,
  NbaReaderSplitRow,
  NbaReaderSide,
} from "./nbaProfessionalMarketReader";
import type { NbaMovementMarket } from "./nbaSameBookMovement";
import type { NbaApprovedLegacyLockedEvidenceRecovery } from "./nbaLockedMemberSnapshot";
import { isNbaConsumerExecutionSportsbook } from "./nbaMarketSourceEligibility";

const SPLIT_STALE_AFTER_MINUTES = 75;
const MOVEMENT_CURRENT_RELATIVE_FRESH_MINUTES = 120;

type PublicSplit = MarketEdgeDto["publicSplits"][number];

export type NbaMemberMarketEvidence = {
  publicSplits: PublicSplit[];
  sportsbookSplits: MarketSplitDisplaySection | null;
  sharpBookAvailability: NonNullable<MarketEdgeDto["sharpBookAvailability"]>;
  oddsTrail: OddsTrailStopDto[];
  lineTrail: OddsTrailStopDto[];
  opposingOddsTrail: MarketEdgeDto["opposingOddsTrail"];
  movementReferenceSportsbook: string | null;
  movementReferencePriceAmerican: number | null;
  movementReferenceObservedAt: string | null;
  /** Internal-only provenance for an explicitly approved immutable-lock recovery. */
  evidenceRecoveryRelease?: string;
};

export type NbaMemberGameEvidence = Record<NbaMovementMarket, NbaMemberMarketEvidence>;

type SplitSnapshot = {
  fetchedAt: string;
  rows: Map<NbaReaderSide, NbaReaderSplitRow>;
};

function canonical(value: string | null): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function selectionSide(selectionKey: string): NbaReaderSide | null {
  const side = selectionKey.split(":").at(-1);
  return side === "home" || side === "away" || side === "over" || side === "under"
    ? side
    : null;
}

function oppositeSide(side: NbaReaderSide): NbaReaderSide {
  if (side === "home") return "away";
  if (side === "away") return "home";
  return side === "over" ? "under" : "over";
}

function expectedSides(market: NbaMovementMarket): readonly NbaReaderSide[] {
  return market === "total" ? ["over", "under"] : ["home", "away"];
}

function pct(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;
  return normalized >= 0 && normalized <= 100 ? Math.round(normalized * 10) / 10 : null;
}

function validSplitPair(market: NbaMovementMarket, rows: Map<NbaReaderSide, NbaReaderSplitRow>): boolean {
  const sides = expectedSides(market);
  const pair = sides.map((side) => rows.get(side));
  if (pair.some((row) => !row)) return false;
  if (pair.some((row) => pct(row!.betsPct) === null && pct(row!.moneyPct) === null)) return false;
  for (const field of ["betsPct", "moneyPct"] as const) {
    const values = pair.map((row) => pct(row![field]));
    if (values.every((value) => value !== null)) {
      const sum = values.reduce<number>((total, value) => total + value!, 0);
      if (Math.abs(sum - 100) > 1.1) return false;
    }
  }
  return true;
}

function completeSplitPair(market: NbaMovementMarket, rows: Map<NbaReaderSide, NbaReaderSplitRow>): boolean {
  if (!validSplitPair(market, rows)) return false;
  return expectedSides(market).every((side) => {
    const row = rows.get(side);
    return row !== undefined && pct(row.betsPct) !== null && pct(row.moneyPct) !== null;
  });
}

function playbookConsensusSnapshots(
  market: NbaMovementMarket,
  rows: readonly NbaReaderSplitRow[],
): SplitSnapshot[] {
  const byCapture = new Map<string, Map<NbaReaderSide, NbaReaderSplitRow>>();
  for (const row of rows) {
    if (
      row.market !== market || canonical(row.provider) !== "playbook" ||
      canonical(row.sourceBook) !== "consensus" || row.sourceType !== "multi_book_consensus"
    ) continue;
    const side = selectionSide(row.selectionKey);
    if (!side || !expectedSides(market).includes(side)) continue;
    const captured = byCapture.get(row.fetchedAt) ?? new Map<NbaReaderSide, NbaReaderSplitRow>();
    captured.set(side, row);
    byCapture.set(row.fetchedAt, captured);
  }
  return [...byCapture.entries()]
    .filter(([, snapshot]) => completeSplitPair(market, snapshot))
    .map(([fetchedAt, snapshot]) => ({ fetchedAt, rows: snapshot }))
    .sort((left, right) => Date.parse(left.fetchedAt) - Date.parse(right.fetchedAt));
}

function buildPublicSplits(args: {
  market: NbaMovementMarket;
  rows: readonly NbaReaderSplitRow[];
  homeAbbr: string;
  awayAbbr: string;
  evaluatedAt: string;
}): PublicSplit[] {
  const snapshots = playbookConsensusSnapshots(args.market, args.rows);
  const latest = snapshots.at(-1);
  if (!latest) return [];
  const ageMinutes = (Date.parse(args.evaluatedAt) - Date.parse(latest.fetchedAt)) / 60_000;
  if (!Number.isFinite(ageMinutes) || ageMinutes < 0) return [];
  return expectedSides(args.market).map((side): PublicSplit => {
    const row = latest.rows.get(side)!;
    return {
      side,
      label: side === "home" ? args.homeAbbr
        : side === "away" ? args.awayAbbr
        : side === "over" ? "Over" : "Under",
      moneyPct: pct(row.moneyPct),
      betsPct: pct(row.betsPct),
      observedAt: row.sourceObservedAt ?? row.fetchedAt,
      freshnessCheckedAt: row.fetchedAt,
      staleAfterMinutes: SPLIT_STALE_AFTER_MINUTES,
      isStale: ageMinutes > SPLIT_STALE_AFTER_MINUTES,
    };
  });
}

type SharpSourceBook = "circa" | "draftkings" | "betmgm";

function sharpSourceBook(row: NbaReaderSplitRow): SharpSourceBook | null {
  const book = canonical(row.sourceBook);
  if (book === "circa" || book === "draftkings" || book === "betmgm") return book;
  return null;
}

function sharpBookSnapshots(
  market: NbaMovementMarket,
  rows: readonly NbaReaderSplitRow[],
  sourceBook: SharpSourceBook,
): SplitSnapshot[] {
  const byCapture = new Map<string, Map<NbaReaderSide, NbaReaderSplitRow>>();
  for (const row of rows) {
    if (row.market !== market || canonical(row.provider) !== "sharpapi" || sharpSourceBook(row) !== sourceBook) continue;
    const side = selectionSide(row.selectionKey);
    if (!side || !expectedSides(market).includes(side)) continue;
    const captured = byCapture.get(row.fetchedAt) ?? new Map<NbaReaderSide, NbaReaderSplitRow>();
    captured.set(side, row);
    byCapture.set(row.fetchedAt, captured);
  }
  return [...byCapture.entries()]
    .filter(([, snapshot]) => completeSplitPair(market, snapshot))
    .map(([fetchedAt, snapshot]) => ({ fetchedAt, rows: snapshot }))
    .sort((left, right) => Date.parse(left.fetchedAt) - Date.parse(right.fetchedAt));
}

function latestSourceSection(args: {
  market: NbaMovementMarket;
  rows: readonly NbaReaderSplitRow[];
  sourceBook: SharpSourceBook;
  homeAbbr: string;
  awayAbbr: string;
  evaluatedAt: string;
}): MarketSplitDisplaySection | null {
  const snapshots = sharpBookSnapshots(args.market, args.rows, args.sourceBook);
  const latest = snapshots.at(-1);
  if (!latest) return null;
  const first = snapshots[0]!;
  const ageMinutes = (Date.parse(args.evaluatedAt) - Date.parse(latest.fetchedAt)) / 60_000;
  if (!Number.isFinite(ageMinutes) || ageMinutes < 0) return null;
  const stale = ageMinutes > SPLIT_STALE_AFTER_MINUTES;
  return {
    // The source remains internal provenance. Members always see one stable
    // panel while Circa silently displaces or yields to an approved fallback.
    label: "Sharp Book Splits",
    sourceBook: args.sourceBook,
    sourceObservedAt: latest.fetchedAt,
    rows: expectedSides(args.market).map((side) => {
      const row = latest.rows.get(side)!;
      const firstRow = first.rows.get(side)!;
      const moneyPct = pct(row.moneyPct);
      const betsPct = pct(row.betsPct);
      const firstMoneyPct = pct(firstRow.moneyPct);
      const firstBetsPct = pct(firstRow.betsPct);
      return {
        side,
        label: side === "home" ? args.homeAbbr
          : side === "away" ? args.awayAbbr
          : side === "over" ? "Over" : "Under",
        moneyPct,
        betsPct,
        moneyDeltaPp: moneyPct !== null && firstMoneyPct !== null ? moneyPct - firstMoneyPct : null,
        betsDeltaPp: betsPct !== null && firstBetsPct !== null ? betsPct - firstBetsPct : null,
        comparisonObservedAt: first.rows.get(side)?.sourceObservedAt ?? first.fetchedAt,
        observedAt: row.sourceObservedAt ?? row.fetchedAt,
        freshnessCheckedAt: row.fetchedAt,
        staleAfterMinutes: SPLIT_STALE_AFTER_MINUTES,
        isStale: stale,
      };
    }),
    signal: null,
    lastUpdated: latest.fetchedAt,
  };
}

function sectionTime(section: MarketSplitDisplaySection | null): number {
  if (!section?.lastUpdated) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(section.lastUpdated);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function buildSharpBookEvidence(args: {
  market: NbaMovementMarket;
  rows: readonly NbaReaderSplitRow[];
  homeAbbr: string;
  awayAbbr: string;
  evaluatedAt: string;
}): Pick<NbaMemberMarketEvidence, "sportsbookSplits" | "sharpBookAvailability"> {
  const section = (sourceBook: SharpSourceBook) => latestSourceSection({ ...args, sourceBook });
  const circa = section("circa");
  const fallback = [section("draftkings"), section("betmgm")]
    .filter((candidate): candidate is MarketSplitDisplaySection => candidate !== null)
    .sort((left, right) => sectionTime(right) - sectionTime(left))[0] ?? null;
  const circaIsStale = circa?.rows.some((row) => row.isStale === true) ?? false;
  const displayed = circa === null
    ? fallback
    : circaIsStale && sectionTime(fallback) > sectionTime(circa)
      ? fallback
      : circa;
  const rawSharp = args.rows.filter((row) =>
    row.market === args.market && canonical(row.provider) === "sharpapi" && sharpSourceBook(row) !== null);
  const lastRawUpdate = rawSharp
    .map((row) => row.fetchedAt)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort()
    .at(-1) ?? null;
  if (displayed !== null) {
    const stale = displayed.rows.some((row) => row.isStale === true);
    return {
      sportsbookSplits: displayed,
      sharpBookAvailability: {
        status: stale ? "stale" : "complete",
        message: stale
          ? "The last complete two-sided sharp-book split snapshot is retained while the next update is pending."
          : "Complete two-sided sharp-book money and ticket percentages are available.",
        lastUpdated: displayed.lastUpdated,
      },
    };
  }
  return {
    sportsbookSplits: null,
    sharpBookAvailability: rawSharp.length > 0 ? {
      status: "provider_limited",
      message: "Sharp-book data is partial for this market; percentages remain hidden until both sides include money and ticket shares.",
      lastUpdated: lastRawUpdate,
    } : {
      status: "pending",
      message: "Sharp-book splits are awaiting the next verified source snapshot.",
      lastUpdated: null,
    },
  };
}

function observationTime(row: NbaReaderPriceRow): string {
  return row.providerTimestamp ?? row.fetchedAt;
}

function sameQuote(left: NbaReaderPriceRow, right: NbaReaderPriceRow): boolean {
  return left.americanPrice === right.americanPrice && left.line === right.line;
}

function compactTrail(rows: NbaReaderPriceRow[]): NbaReaderPriceRow[] {
  if (rows.length <= 2) return rows;
  const compacted = [rows[0]!];
  for (let index = 1; index < rows.length - 1; index++) {
    const row = rows[index]!;
    if (!sameQuote(row, compacted[compacted.length - 1]!)) compacted.push(row);
  }
  const terminal = rows.at(-1)!;
  if (observationTime(compacted.at(-1)!) !== observationTime(terminal)) compacted.push(terminal);
  return compacted;
}

type NbaMovementReference = {
  sportsbook: string;
  selectedRows: NbaReaderPriceRow[];
  opposingRows: NbaReaderPriceRow[];
};

function coherentPair(
  market: NbaMovementMarket,
  selected: NbaReaderPriceRow,
  opposing: NbaReaderPriceRow,
): boolean {
  if (market === "moneyline") return selected.line === null && opposing.line === null;
  if (selected.line === null || opposing.line === null) return false;
  return market === "spread"
    ? Math.abs(selected.line + opposing.line) < 0.01
    : Math.abs(selected.line - opposing.line) < 0.01;
}

/**
 * Pick one complete same-book consumer chronology for the member movement
 * panel. Circa/Pinnacle remain available to the professional reader, but the
 * member trail must describe a line that a mainstream consumer can actually
 * execute. Prefer the exact evaluated book when it has a fresh complete pair;
 * otherwise use the deepest fresh consumer-book trail.
 */
export function selectNbaMovementReference(args: {
  market: NbaMovementMarket;
  selectedSide: NbaReaderSide;
  preferredSportsbook: string | null;
  rows: readonly NbaReaderPriceRow[];
  evaluatedAt: string;
}): NbaMovementReference | null {
  const evaluatedMs = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluatedMs)) return null;
  const opposingSide = oppositeSide(args.selectedSide);
  const byBookAndTime = new Map<string, Map<string, NbaReaderPriceRow[]>>();
  for (const row of args.rows) {
    const side = selectionSide(row.selectionKey);
    const observedAt = observationTime(row);
    const observedMs = Date.parse(observedAt);
    const book = canonical(row.sportsbook);
    if (
      row.market !== args.market || !book || row.americanPrice === null || row.americanPrice === 0 ||
      !isNbaConsumerExecutionSportsbook(row.sportsbook) ||
      (side !== args.selectedSide && side !== opposingSide) ||
      !Number.isFinite(observedMs) || observedMs > evaluatedMs
    ) continue;
    const byTime = byBookAndTime.get(book) ?? new Map<string, NbaReaderPriceRow[]>();
    const atTime = byTime.get(observedAt) ?? [];
    atTime.push(row);
    byTime.set(observedAt, atTime);
    byBookAndTime.set(book, byTime);
  }

  const candidates = [...byBookAndTime.entries()].flatMap(([book, byTime]) => {
    const pairs = [...byTime.entries()].flatMap(([observedAt, rows]) => {
      const selected = rows.find((row) => selectionSide(row.selectionKey) === args.selectedSide);
      const opposing = rows.find((row) => selectionSide(row.selectionKey) === opposingSide);
      return selected && opposing && coherentPair(args.market, selected, opposing)
        ? [{ observedAt, selected, opposing }]
        : [];
    }).sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
    const current = pairs.at(-1);
    return current ? [{
      book,
      sportsbook: current.selected.sportsbook,
      selectedRows: pairs.map((pair) => pair.selected),
      opposingRows: pairs.map((pair) => pair.opposing),
      currentMs: Date.parse(current.observedAt),
      displayDepth: Math.min(3, pairs.length),
    }] : [];
  });
  if (candidates.length === 0) return null;
  const freshestMs = Math.max(...candidates.map((candidate) => candidate.currentMs));
  const freshestCandidates = candidates.filter((candidate) =>
    freshestMs - candidate.currentMs <= MOVEMENT_CURRENT_RELATIVE_FRESH_MINUTES * 60_000);
  const preferred = canonical(args.preferredSportsbook);
  const selected = freshestCandidates.sort((left, right) =>
    Number(right.book === preferred) - Number(left.book === preferred) ||
    right.displayDepth - left.displayDepth ||
    left.book.localeCompare(right.book)
  )[0];
  return selected ? {
    sportsbook: selected.sportsbook,
    selectedRows: selected.selectedRows,
    opposingRows: selected.opposingRows,
  } : null;
}

function buildTrail(args: {
  market: NbaMovementMarket;
  side: NbaReaderSide;
  sportsbook: string | null;
  rows: readonly NbaReaderPriceRow[];
  current?: { price: number | null; line: number | null; observedAt: string | null };
}): OddsTrailStopDto[] {
  const book = canonical(args.sportsbook);
  if (!book) return [];
  const matching = args.rows
    .filter((row) =>
      row.market === args.market && selectionSide(row.selectionKey) === args.side &&
      canonical(row.sportsbook) === book && row.americanPrice !== null && row.americanPrice !== 0 &&
      Number.isFinite(Date.parse(observationTime(row))))
    .sort((left, right) => Date.parse(observationTime(left)) - Date.parse(observationTime(right)));
  const distinct = matching.filter((row, index) => {
    const prior = matching[index - 1];
    return !prior || observationTime(prior) !== observationTime(row) || !sameQuote(prior, row);
  });
  if (
    args.current?.price !== null && args.current?.price !== undefined && args.current.price !== 0 &&
    args.current.observedAt && Number.isFinite(Date.parse(args.current.observedAt)) &&
    (!distinct.at(-1) || distinct.at(-1)!.americanPrice !== args.current.price ||
      distinct.at(-1)!.line !== args.current.line ||
      Date.parse(observationTime(distinct.at(-1)!)) < Date.parse(args.current.observedAt))
  ) {
    distinct.push({
      sportsbook: args.sportsbook!,
      sharpBook: false,
      market: args.market,
      selectionKey: `display:${args.market}:${args.side}`,
      americanPrice: args.current.price,
      line: args.current.line,
      providerTimestamp: args.current.observedAt,
      fetchedAt: args.current.observedAt,
    });
  }
  const compacted = compactTrail(distinct);
  return compacted.map((row, index): OddsTrailStopDto => ({
    american: row.americanPrice!,
    line: row.line,
    observedAt: observationTime(row),
    sportsbook: row.sportsbook,
    source: index === compacted.length - 1 ? "current_line" : "line_history",
    label: compacted.length === 1 ? "current" : index === 0 ? "first" : index === compacted.length - 1 ? "current" : "move",
  }));
}

function marketIntel(game: NbaDailyEdgeGameDto, market: NbaMovementMarket): MarketIntelligence {
  return market === "moneyline" ? game.intelligence.ml
    : market === "spread" ? game.intelligence.spread : game.intelligence.total;
}

function memberEvidenceForMarket(args: {
  game: NbaDailyEdgeGameDto;
  market: NbaMovementMarket;
  priceRows: readonly NbaReaderPriceRow[];
  splitRows: readonly NbaReaderSplitRow[];
  evaluatedAt: string;
}): NbaMemberMarketEvidence {
  const intel = marketIntel(args.game, args.market);
  const selectedSide = intel.pick_side;
  const reference = selectedSide === null ? null : selectNbaMovementReference({
    market: args.market,
    selectedSide,
    preferredSportsbook: intel.current_price.sportsbook,
    rows: args.priceRows,
    evaluatedAt: args.evaluatedAt,
  });
  const sportsbook = reference?.sportsbook ?? intel.current_price.sportsbook;
  const referenceRows = reference === null
    ? args.priceRows
    : [...reference.selectedRows, ...reference.opposingRows];
  const selected = selectedSide === null ? [] : buildTrail({
    market: args.market,
    side: selectedSide,
    sportsbook,
    rows: referenceRows,
    current: reference === null ? {
        price: intel.current_price.odds_american,
        line: intel.consensus_line,
        observedAt: intel.current_price.fetched_at,
      } : undefined,
  });
  const opposingSide = selectedSide === null ? null : oppositeSide(selectedSide);
  const opposing = opposingSide === null ? [] : buildTrail({
    market: args.market,
    side: opposingSide,
    sportsbook,
    rows: referenceRows,
  });
  const terminal = selected.at(-1) ?? null;
  const sharpBookEvidence = buildSharpBookEvidence({
    market: args.market,
    rows: args.splitRows,
    homeAbbr: args.game.home_abbr,
    awayAbbr: args.game.away_abbr,
    evaluatedAt: args.evaluatedAt,
  });
  return {
    publicSplits: buildPublicSplits({
      market: args.market,
      rows: args.splitRows,
      homeAbbr: args.game.home_abbr,
      awayAbbr: args.game.away_abbr,
      evaluatedAt: args.evaluatedAt,
    }),
    ...sharpBookEvidence,
    oddsTrail: selected,
    lineTrail: args.market === "moneyline" ? [] : selected,
    opposingOddsTrail: opposingSide !== null && opposing.length > 0 ? {
      side: opposingSide,
      label: opposingSide === "home" ? args.game.home_abbr
        : opposingSide === "away" ? args.game.away_abbr
        : opposingSide === "over" ? "Over" : "Under",
      stops: opposing,
    } : null,
    movementReferenceSportsbook: terminal?.sportsbook ?? null,
    movementReferencePriceAmerican: terminal?.american ?? null,
    movementReferenceObservedAt: terminal?.observedAt ?? null,
  };
}

/**
 * Member evidence is a display-only projection of the exact stored inputs that
 * the NBA reader already consumed. It cannot alter forecasts, grades, stakes,
 * or locks. Callers must not attach it to an immutable locked snapshot.
 */
export function buildNbaMemberGameEvidence(args: {
  game: NbaDailyEdgeGameDto;
  priceRows: readonly NbaReaderPriceRow[];
  splitRows: readonly NbaReaderSplitRow[];
  evaluatedAt: string;
}): NbaMemberGameEvidence {
  return {
    moneyline: memberEvidenceForMarket({ ...args, market: "moneyline" }),
    spread: memberEvidenceForMarket({ ...args, market: "spread" }),
    total: memberEvidenceForMarket({ ...args, market: "total" }),
  };
}

/**
 * Rebuild only fields that were absent from the approved legacy member-card
 * capture. Public splits come verbatim from the immutable prediction records;
 * movement comes only from append-only observations captured no later than
 * the authoritative lock. Current/post-lock provider state is never eligible.
 */
export function buildApprovedNbaLegacyLockedMemberGameEvidence(args: {
  game: NbaDailyEdgeGameDto;
  priceRows: readonly NbaReaderPriceRow[];
  recovery: NbaApprovedLegacyLockedEvidenceRecovery;
}): NbaMemberGameEvidence {
  const cutoffMs = Date.parse(args.recovery.lockedAt);
  const preLockPriceRows = args.priceRows.filter((row) => {
    const providerMs = Date.parse(row.providerTimestamp ?? row.fetchedAt);
    const fetchedMs = Date.parse(row.fetchedAt);
    return Number.isFinite(providerMs) && Number.isFinite(fetchedMs) &&
      providerMs <= cutoffMs && fetchedMs <= cutoffMs;
  });
  const base = buildNbaMemberGameEvidence({
    game: args.game,
    priceRows: preLockPriceRows,
    splitRows: [],
    evaluatedAt: args.recovery.lockedAt,
  });
  return Object.fromEntries((['moneyline', 'spread', 'total'] as const).map((market) => [
    market,
    {
      ...base[market],
      publicSplits: args.recovery.publicSplits[market].map((row) => ({ ...row })),
      sportsbookSplits: null,
      sharpBookAvailability: {
        status: "provider_limited",
        message: "The locked record did not preserve a complete two-sided sharp-book split snapshot.",
        lastUpdated: args.recovery.capturedAt,
      },
      evidenceRecoveryRelease: args.recovery.release,
    },
  ])) as NbaMemberGameEvidence;
}
