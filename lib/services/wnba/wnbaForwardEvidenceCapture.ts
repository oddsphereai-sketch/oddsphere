import type {
  WnbaDecisionMarket,
  WnbaDecisionSide,
  WnbaDecisionTuple,
} from "./wnbaDecisionTuple";

export const WNBA_FORWARD_EVIDENCE_CAPTURE_KEY =
  "wnba_forward_evidence_capture_v1" as const;
export const WNBA_FORWARD_EVIDENCE_CAPTURE_CONTRACT_VERSION =
  "wnba_forward_evidence_capture_v1_behavior_neutral_2026_09_02" as const;
export const WNBA_FORWARD_EVIDENCE_MAX_BOOKS_PER_MARKET = 24;
export const WNBA_FORWARD_EVIDENCE_MAX_PUBLIC_SOURCES = 24;
export const WNBA_FORWARD_EVIDENCE_MAX_GAME_BYTES = 64 * 1024;
export const WNBA_FORWARD_EVIDENCE_MAX_MARKET_BYTES = 24 * 1024;

type EvidenceMarket = WnbaDecisionMarket;
type EvidenceSide = WnbaDecisionSide;

export type WnbaIndependentModelEvidence = {
  home_win_probability: number;
  projected_home_margin: number;
  projected_total: number;
  margin_sigma: number;
  total_sigma: number;
  rating_uncertainty: number;
  model_stability: number;
  home_games: number;
  away_games: number;
  cold_start: boolean;
  home_cold_start_weight: number;
  away_cold_start_weight: number;
};

export type WnbaForwardEvidenceLineRow = {
  market_type: unknown;
  side: unknown;
  sportsbook: unknown;
  line_value: unknown;
  odds_american: unknown;
  fetched_at?: unknown;
  recorded_at?: unknown;
  is_opener?: unknown;
};

export type WnbaForwardEvidencePublicSignalRow = {
  market_type: unknown;
  side: unknown;
  public_betting_pct: unknown;
  public_money_pct: unknown;
  computed_at?: unknown;
};

export type WnbaForwardEvidenceSourceSplitRow = {
  canonical_event_id: unknown;
  canonical_market_id?: unknown;
  market_type: unknown;
  selection_key: unknown;
  provider: unknown;
  source_book: unknown;
  source_type: unknown;
  bets_pct: unknown;
  money_pct: unknown;
  market_line?: unknown;
  market_price?: unknown;
  split_line_basis?: unknown;
  books_used?: unknown;
  provider_event_id?: unknown;
  source_observed_at?: unknown;
  fetched_at: unknown;
  source_timestamp_verified?: unknown;
  minutes_to_start?: unknown;
  ingestion_run_id?: unknown;
};

type SideQuote = {
  side: EvidenceSide;
  line: number | null;
  american_price: number;
  raw_implied_probability: number;
  fair_probability: number;
  observed_at: string;
  fetched_at: string;
};

export type WnbaForwardBookPair = {
  sportsbook: string;
  source_class: "circa" | "named_book" | "provider_consensus_fallback";
  champion_trusted_book: boolean;
  opening_provenance: "provider_opener" | "first_observed" | null;
  pair_capture_identity: string;
  observed_at: string;
  fetched_at: string;
  pair_skew_ms: number;
  quotes: [SideQuote, SideQuote];
};

type WnbaForwardMovement = {
  sportsbook: string;
  opening_capture_identity: string;
  current_capture_identity: string;
  opening_observed_at: string;
  current_observed_at: string;
  elapsed_ms: number;
  canonical_side: "home" | "over";
  opening_line: number | null;
  current_line: number | null;
  line_delta: number | null;
  opening_american_price: number;
  current_american_price: number;
  opening_fair_probability: number;
  current_fair_probability: number;
  fair_probability_delta: number;
};

type ChampionPublicInput = {
  side: EvidenceSide;
  public_betting_pct: number | null;
  public_money_pct: number | null;
  computed_at: string | null;
  row_level_provider_provenance: null;
};

type SourceAwarePublicPair = {
  provider: string;
  source_book: string;
  source_type: string;
  canonical_market_id: string | null;
  provider_event_id: string | null;
  capture_identity: string;
  source_observed_at: string | null;
  fetched_at: string;
  source_timestamp_verified: boolean;
  minutes_to_start: number | null;
  split_line_basis: string | null;
  books_used: number | null;
  pair_skew_ms: number;
  sides: Array<{
    side: EvidenceSide;
    bets_pct: number | null;
    money_pct: number | null;
    market_line: number | null;
    market_price: number | null;
  }>;
};

export type WnbaForwardChampionOutput = {
  projected_score: { home: number; away: number };
  model: Record<string, unknown>;
  market: Record<string, unknown>;
  trusted: Record<string, unknown>;
  sharp: Record<string, unknown> | null;
  consensus_source: string;
  dynamic_market_weight: number;
  outcomes: Record<EvidenceMarket, Record<string, unknown>>;
};

type MarketCapture = {
  market: EvidenceMarket;
  champion_target: { side: EvidenceSide | null; line: number | null };
  evaluation: {
    tuple: WnbaDecisionTuple | null;
    economic_identity: string | null;
    evaluated_sportsbook: string | null;
    complete_pair_books: string[];
    target_excluded_complete_pair_books: string[];
    target_excluded_complete_pair_count: number;
  };
  current_book_pairs: WnbaForwardBookPair[];
  opening_book_pairs: WnbaForwardBookPair[];
  same_book_movement: WnbaForwardMovement[];
  champion_public_input: ChampionPublicInput[];
  source_aware_public_pairs: SourceAwarePublicPair[];
  coverage: {
    complete_current_books_before_cap: number;
    retained_current_books: number;
    omitted_current_books: number;
    retained_opening_books: number;
    retained_same_book_movements: number;
    retained_source_aware_public_pairs: number;
    circa_current_pair: boolean;
    circa_public_pair: boolean;
    history_rows_truncated: boolean;
    current_pair_unavailable_reason: string | null;
    opening_unavailable_reason: string | null;
    same_book_movement_unavailable_reason: string | null;
    champion_public_input_unavailable_reason: string | null;
    source_aware_unavailable_reason: string | null;
    payload_truncated: boolean;
    payload_bytes: number;
  };
};

export type WnbaForwardEvidenceCapture = {
  contract_version: typeof WNBA_FORWARD_EVIDENCE_CAPTURE_CONTRACT_VERSION;
  mode: "capture_only";
  production_decision_effect: false;
  game: {
    game_id: number;
    external_id: string | number | null;
    slate_date: string;
    starts_at: string | null;
  };
  captured_at: string;
  decision_at: string;
  releases: {
    model_version: string;
    distribution_version: string;
    grade_policy_version: string;
    decision_tuple_contract_version: string;
    prediction_record_contract_version: string;
  };
  independent_model: WnbaIndependentModelEvidence;
  unavailable_independent_inputs: {
    injury_news: null;
    reason: "not_ingested_by_current_wnba_champion";
  };
  champion_output: WnbaForwardChampionOutput;
  markets: Record<EvidenceMarket, MarketCapture>;
  coverage: {
    history_rows_received: number;
    history_rows_truncated: boolean;
    source_aware_rows_received: number;
    source_aware_rows_truncated: boolean;
    source_aware_unavailable_reason: string | null;
    payload_truncated: boolean;
    payload_bytes: number;
  };
};

export type WnbaForwardEvidenceMarketSlice = Omit<WnbaForwardEvidenceCapture, "markets" | "coverage"> & {
  markets: Partial<Record<EvidenceMarket, MarketCapture>>;
  coverage: WnbaForwardEvidenceCapture["coverage"];
};

type NormalizedLine = {
  market: EvidenceMarket;
  side: EvidenceSide;
  sportsbook: string;
  line: number | null;
  price: number;
  observedAt: string;
  fetchedAt: string;
  isOpener: boolean;
};

const MARKETS: EvidenceMarket[] = ["moneyline", "spread", "total"];

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function probability(value: unknown): number | null {
  const resolved = finite(value);
  return resolved !== null && resolved >= 0 && resolved <= 1 ? resolved : null;
}

function percentage(value: unknown): number | null {
  const resolved = finite(value);
  return resolved !== null && resolved >= 0 && resolved <= 100 ? resolved : null;
}

function boundedString(value: unknown, max = 96): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function normalizeBook(value: unknown): string | null {
  const name = boundedString(value);
  return name?.toLowerCase().replace(/\s+/g, " ") ?? null;
}

function sourceClass(book: string): WnbaForwardBookPair["source_class"] {
  if (book === "circa") return "circa";
  if (book === "playbook_consensus") return "provider_consensus_fallback";
  return "named_book";
}

function impliedProbability(american: number): number {
  return american > 0
    ? 100 / (american + 100)
    : Math.abs(american) / (Math.abs(american) + 100);
}

function isMarket(value: unknown): value is EvidenceMarket {
  return value === "moneyline" || value === "spread" || value === "total";
}

function isSide(value: unknown): value is EvidenceSide {
  return value === "home" || value === "away" || value === "over" || value === "under";
}

function sidesForMarket(market: EvidenceMarket): [EvidenceSide, EvidenceSide] {
  return market === "total" ? ["over", "under"] : ["home", "away"];
}

function sameLine(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) < 0.000_001;
}

function linesPair(market: EvidenceMarket, first: number | null, second: number | null): boolean {
  if (market === "moneyline") return first === null && second === null;
  if (first === null || second === null) return false;
  return market === "total" ? sameLine(first, second) : Math.abs(first + second) < 0.000_001;
}

function normalizedLines(
  rows: readonly WnbaForwardEvidenceLineRow[],
  decisionAt: string,
  startsAt: string | null,
): NormalizedLine[] {
  const decisionMs = Date.parse(decisionAt);
  const startMs = startsAt === null ? Number.POSITIVE_INFINITY : Date.parse(startsAt);
  return rows.flatMap((row) => {
    if (!isMarket(row.market_type) || !isSide(row.side)) return [];
    const sportsbook = normalizeBook(row.sportsbook);
    const price = finite(row.odds_american);
    const line = row.line_value === null ? null : finite(row.line_value);
    const observedAt = timestamp(row.recorded_at ?? row.fetched_at);
    const fetchedAt = timestamp(row.fetched_at ?? row.recorded_at);
    if (
      sportsbook === null ||
      price === null || price === 0 ||
      (row.line_value !== null && line === null) ||
      observedAt === null || fetchedAt === null ||
      Date.parse(observedAt) > decisionMs ||
      Date.parse(observedAt) >= startMs
    ) return [];
    return [{
      market: row.market_type,
      side: row.side,
      sportsbook,
      line,
      price,
      observedAt,
      fetchedAt,
      isOpener: row.is_opener === true,
    }];
  });
}

function pairCandidates(
  rows: readonly NormalizedLine[],
  market: EvidenceMarket,
  trustedBooks: ReadonlySet<string>,
): WnbaForwardBookPair[] {
  const [firstSide, secondSide] = sidesForMarket(market);
  const groups = new Map<string, NormalizedLine[]>();
  for (const row of rows.filter((candidate) => candidate.market === market)) {
    const key = `${row.sportsbook}\u0000${row.observedAt}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const pairs: WnbaForwardBookPair[] = [];
  for (const group of groups.values()) {
    const firstRows = group.filter((row) => row.side === firstSide);
    const secondRows = group.filter((row) => row.side === secondSide);
    for (const first of firstRows) {
      const second = secondRows
        .filter((candidate) => linesPair(market, first.line, candidate.line))
        .sort((left, right) =>
          left.price - right.price ||
          (left.line ?? 0) - (right.line ?? 0)
        )[0];
      if (!second) continue;
      const firstImplied = impliedProbability(first.price);
      const secondImplied = impliedProbability(second.price);
      const total = firstImplied + secondImplied;
      if (!(total > 0)) continue;
      const quoteA: SideQuote = {
        side: first.side,
        line: first.line,
        american_price: first.price,
        raw_implied_probability: firstImplied,
        fair_probability: firstImplied / total,
        observed_at: first.observedAt,
        fetched_at: first.fetchedAt,
      };
      const quoteB: SideQuote = {
        side: second.side,
        line: second.line,
        american_price: second.price,
        raw_implied_probability: secondImplied,
        fair_probability: secondImplied / total,
        observed_at: second.observedAt,
        fetched_at: second.fetchedAt,
      };
      const pairCaptureIdentity = JSON.stringify([
        market,
        first.sportsbook,
        first.observedAt,
        quoteA.side,
        quoteA.line,
        quoteA.american_price,
        quoteB.side,
        quoteB.line,
        quoteB.american_price,
      ]);
      pairs.push({
        sportsbook: first.sportsbook,
        source_class: sourceClass(first.sportsbook),
        champion_trusted_book: trustedBooks.has(first.sportsbook),
        opening_provenance: first.isOpener && second.isOpener ? "provider_opener" : null,
        pair_capture_identity: pairCaptureIdentity,
        observed_at: first.observedAt,
        fetched_at: first.fetchedAt > second.fetchedAt ? first.fetchedAt : second.fetchedAt,
        pair_skew_ms: Math.abs(Date.parse(first.observedAt) - Date.parse(second.observedAt)),
        quotes: [quoteA, quoteB],
      });
      break;
    }
  }
  return pairs;
}

function selectedPairPerBook(
  pairs: readonly WnbaForwardBookPair[],
  newest: boolean,
): WnbaForwardBookPair[] {
  const byBook = new Map<string, WnbaForwardBookPair>();
  for (const pair of [...pairs].sort((left, right) =>
    (newest
      ? right.observed_at.localeCompare(left.observed_at)
      : left.observed_at.localeCompare(right.observed_at)) ||
    left.sportsbook.localeCompare(right.sportsbook) ||
    (left.quotes[0].line ?? 0) - (right.quotes[0].line ?? 0)
  )) {
    if (!byBook.has(pair.sportsbook)) byBook.set(pair.sportsbook, pair);
  }
  return [...byBook.values()];
}

function prioritizedPairs(
  pairs: readonly WnbaForwardBookPair[],
  evaluatedBook: string | null,
): WnbaForwardBookPair[] {
  return [...pairs].sort((left, right) => {
    const priority = (pair: WnbaForwardBookPair): number =>
      pair.sportsbook === evaluatedBook ? 0 : pair.source_class === "circa" ? 1 : 2;
    return priority(left) - priority(right) || left.sportsbook.localeCompare(right.sportsbook);
  });
}

function movement(
  opening: WnbaForwardBookPair,
  current: WnbaForwardBookPair,
  market: EvidenceMarket,
): WnbaForwardMovement | null {
  const elapsedMs = Date.parse(current.observed_at) - Date.parse(opening.observed_at);
  if (elapsedMs < 0 || opening.sportsbook !== current.sportsbook) return null;
  const openingQuote = opening.quotes[0];
  const currentQuote = current.quotes[0];
  return {
    sportsbook: current.sportsbook,
    opening_capture_identity: opening.pair_capture_identity,
    current_capture_identity: current.pair_capture_identity,
    opening_observed_at: opening.observed_at,
    current_observed_at: current.observed_at,
    elapsed_ms: elapsedMs,
    canonical_side: market === "total" ? "over" : "home",
    opening_line: openingQuote.line,
    current_line: currentQuote.line,
    line_delta:
      openingQuote.line === null || currentQuote.line === null
        ? null
        : currentQuote.line - openingQuote.line,
    opening_american_price: openingQuote.american_price,
    current_american_price: currentQuote.american_price,
    opening_fair_probability: openingQuote.fair_probability,
    current_fair_probability: currentQuote.fair_probability,
    fair_probability_delta: currentQuote.fair_probability - openingQuote.fair_probability,
  };
}

function publicSide(selectionKey: unknown): EvidenceSide | null {
  const key = boundedString(selectionKey, 240);
  const side = key?.split(":").at(-1);
  return isSide(side) ? side : null;
}

function sourceAwarePublicPairs(
  rows: readonly WnbaForwardEvidenceSourceSplitRow[],
  market: EvidenceMarket,
  decisionAt: string,
  startsAt: string | null,
): SourceAwarePublicPair[] {
  const decisionMs = Date.parse(decisionAt);
  const startMs = startsAt === null ? Number.POSITIVE_INFINITY : Date.parse(startsAt);
  const groups = new Map<string, Array<{
    row: WnbaForwardEvidenceSourceSplitRow;
    side: EvidenceSide;
    fetchedAt: string;
    observedAt: string | null;
  }>>();
  for (const row of rows) {
    if (row.market_type !== market) continue;
    const side = publicSide(row.selection_key);
    const provider = boundedString(row.provider);
    const sourceBook = normalizeBook(row.source_book);
    const sourceType = boundedString(row.source_type);
    const fetchedAt = timestamp(row.fetched_at);
    const observedAt = timestamp(row.source_observed_at);
    if (
      side === null || provider === null || sourceBook === null || sourceType === null ||
      fetchedAt === null || Date.parse(fetchedAt) > decisionMs || Date.parse(fetchedAt) >= startMs ||
      (observedAt !== null && (Date.parse(observedAt) > decisionMs || Date.parse(observedAt) >= startMs))
    ) continue;
    const ingestion = boundedString(row.ingestion_run_id, 160);
    const capture = ingestion ?? fetchedAt;
    const key = `${provider}\u0000${sourceBook}\u0000${sourceType}\u0000${capture}`;
    const list = groups.get(key) ?? [];
    list.push({ row, side, fetchedAt, observedAt });
    groups.set(key, list);
  }

  const [firstSide, secondSide] = sidesForMarket(market);
  const candidates: SourceAwarePublicPair[] = [];
  for (const group of groups.values()) {
    const first = group.find((entry) => entry.side === firstSide);
    const second = group.find((entry) => entry.side === secondSide);
    if (!first || !second) continue;
    const entries = [first, second];
    const sides = entries.map((entry) => ({
      side: entry.side,
      bets_pct: probability(entry.row.bets_pct),
      money_pct: probability(entry.row.money_pct),
      market_line: finite(entry.row.market_line),
      market_price: finite(entry.row.market_price),
    }));
    if (sides.some((side) => side.bets_pct === null && side.money_pct === null)) continue;
    const provider = boundedString(first.row.provider)!;
    const sourceBook = normalizeBook(first.row.source_book)!;
    const sourceType = boundedString(first.row.source_type)!;
    const fetchedAt = first.fetchedAt > second.fetchedAt ? first.fetchedAt : second.fetchedAt;
    const observedTimes = entries.map((entry) => entry.observedAt).filter((value): value is string => value !== null);
    candidates.push({
      provider,
      source_book: sourceBook,
      source_type: sourceType,
      canonical_market_id: boundedString(first.row.canonical_market_id, 160),
      provider_event_id: boundedString(first.row.provider_event_id, 160),
      capture_identity: boundedString(first.row.ingestion_run_id, 160) ?? fetchedAt,
      source_observed_at: observedTimes.sort().at(-1) ?? null,
      fetched_at: fetchedAt,
      source_timestamp_verified:
        first.row.source_timestamp_verified === true && second.row.source_timestamp_verified === true,
      minutes_to_start: finite(first.row.minutes_to_start),
      split_line_basis: boundedString(first.row.split_line_basis),
      books_used: finite(first.row.books_used),
      pair_skew_ms:
        observedTimes.length === 2
          ? Math.abs(Date.parse(observedTimes[0]!) - Date.parse(observedTimes[1]!))
          : 0,
      sides,
    });
  }

  const latestBySource = new Map<string, SourceAwarePublicPair>();
  for (const pair of candidates.sort((left, right) =>
    right.fetched_at.localeCompare(left.fetched_at) ||
    left.provider.localeCompare(right.provider) ||
    left.source_book.localeCompare(right.source_book)
  )) {
    const key = `${pair.provider}\u0000${pair.source_book}\u0000${pair.source_type}`;
    if (!latestBySource.has(key)) latestBySource.set(key, pair);
  }
  return [...latestBySource.values()]
    .sort((left, right) =>
      (left.source_book === "circa" ? -1 : 0) - (right.source_book === "circa" ? -1 : 0) ||
      left.provider.localeCompare(right.provider) ||
      left.source_book.localeCompare(right.source_book)
    )
    .slice(0, WNBA_FORWARD_EVIDENCE_MAX_PUBLIC_SOURCES);
}

function championPublicInputs(
  rows: readonly WnbaForwardEvidencePublicSignalRow[],
  market: EvidenceMarket,
): ChampionPublicInput[] {
  return rows.flatMap((row) => {
    if (row.market_type !== market || !isSide(row.side)) return [];
    const bets = percentage(row.public_betting_pct);
    const money = percentage(row.public_money_pct);
    if (bets === null && money === null) return [];
    return [{
      side: row.side,
      public_betting_pct: bets,
      public_money_pct: money,
      computed_at: timestamp(row.computed_at),
      row_level_provider_provenance: null,
    }];
  }).sort((left, right) => left.side.localeCompare(right.side));
}

function tupleIdentity(tuple: WnbaDecisionTuple | null): string | null {
  if (!tuple) return null;
  return JSON.stringify([
    tuple.market,
    tuple.side,
    tuple.line,
    tuple.evaluated_sportsbook,
    tuple.evaluated_price_american,
    tuple.evaluated_at,
    tuple.decision_at,
    tuple.model_probability,
    tuple.market_fair_probability,
    tuple.outcome_confidence,
    tuple.bet_grade,
    tuple.model_version,
    tuple.distribution_version,
    tuple.grade_policy_version,
    tuple.contract_version,
  ]);
}

function trimMarketToBytes(market: MarketCapture): void {
  while (byteLength(market) > WNBA_FORWARD_EVIDENCE_MAX_MARKET_BYTES) {
    if (market.current_book_pairs.length > 1) {
      const removed = market.current_book_pairs.pop()!;
      market.opening_book_pairs = market.opening_book_pairs.filter((pair) => pair.sportsbook !== removed.sportsbook);
      market.same_book_movement = market.same_book_movement.filter((move) => move.sportsbook !== removed.sportsbook);
      market.coverage.omitted_current_books += 1;
      market.coverage.payload_truncated = true;
      continue;
    }
    if (market.source_aware_public_pairs.length > 0) {
      market.source_aware_public_pairs.pop();
      market.coverage.payload_truncated = true;
      continue;
    }
    break;
  }
  refreshMarketCoverage(market);
}

function refreshMarketCoverage(market: MarketCapture): void {
  market.coverage.retained_current_books = market.current_book_pairs.length;
  market.coverage.retained_opening_books = market.opening_book_pairs.length;
  market.coverage.retained_same_book_movements = market.same_book_movement.length;
  market.coverage.retained_source_aware_public_pairs = market.source_aware_public_pairs.length;
  market.coverage.circa_current_pair = market.current_book_pairs.some((pair) => pair.source_class === "circa");
  market.coverage.circa_public_pair = market.source_aware_public_pairs.some((pair) => pair.source_book === "circa");
  market.evaluation.complete_pair_books = market.current_book_pairs.map((pair) => pair.sportsbook);
  const evaluatedBook = normalizeBook(market.evaluation.evaluated_sportsbook);
  market.evaluation.target_excluded_complete_pair_books = market.evaluation.complete_pair_books
    .filter((book) => book !== evaluatedBook);
  market.evaluation.target_excluded_complete_pair_count = market.evaluation.target_excluded_complete_pair_books.length;
  market.coverage.payload_bytes = 0;
  market.coverage.payload_bytes = byteLength(market);
  market.coverage.payload_bytes = byteLength(market);
}

function trimGameToBytes(capture: WnbaForwardEvidenceCapture): void {
  for (const market of MARKETS) trimMarketToBytes(capture.markets[market]);
  while (byteLength(capture) > WNBA_FORWARD_EVIDENCE_MAX_GAME_BYTES) {
    const candidates = MARKETS
      .map((market) => capture.markets[market])
      .filter((market) => market.current_book_pairs.length > 1 || market.source_aware_public_pairs.length > 0)
      .sort((left, right) => byteLength(right) - byteLength(left));
    const largest = candidates[0];
    if (!largest) break;
    if (largest.current_book_pairs.length > 1) {
      const removed = largest.current_book_pairs.pop()!;
      largest.opening_book_pairs = largest.opening_book_pairs.filter((pair) => pair.sportsbook !== removed.sportsbook);
      largest.same_book_movement = largest.same_book_movement.filter((move) => move.sportsbook !== removed.sportsbook);
      largest.coverage.omitted_current_books += 1;
    } else {
      largest.source_aware_public_pairs.pop();
    }
    largest.coverage.payload_truncated = true;
    capture.coverage.payload_truncated = true;
    refreshMarketCoverage(largest);
  }
  capture.coverage.payload_truncated =
    capture.coverage.payload_truncated || MARKETS.some((market) => capture.markets[market].coverage.payload_truncated);
  capture.coverage.payload_bytes = 0;
  capture.coverage.payload_bytes = byteLength(capture);
  capture.coverage.payload_bytes = byteLength(capture);
}

export function buildWnbaForwardEvidenceCapture(args: {
  game: {
    gameId: number;
    externalId: string | number | null;
    slateDate: string;
    startsAt: string | null;
  };
  capturedAt: string;
  decisionAt: string;
  releases: WnbaForwardEvidenceCapture["releases"];
  trustedBooks: ReadonlySet<string>;
  currentRows: readonly WnbaForwardEvidenceLineRow[];
  historyRows: readonly WnbaForwardEvidenceLineRow[];
  historyRowsTruncated: boolean;
  publicSignalRows: readonly WnbaForwardEvidencePublicSignalRow[];
  sourceAwareSplitRows: readonly WnbaForwardEvidenceSourceSplitRow[];
  sourceAwareRowsTruncated: boolean;
  sourceAwareUnavailableReason: string | null;
  decisionTuples: Partial<Record<EvidenceMarket, WnbaDecisionTuple>>;
  independentModel: WnbaIndependentModelEvidence;
  championOutput: WnbaForwardChampionOutput;
}): WnbaForwardEvidenceCapture {
  const startsAt = timestamp(args.game.startsAt);
  const current = normalizedLines(args.currentRows, args.decisionAt, startsAt);
  const history = normalizedLines(args.historyRows, args.decisionAt, startsAt);
  const trustedBooks = new Set([...args.trustedBooks].map((book) => book.toLowerCase()));
  const markets = {} as Record<EvidenceMarket, MarketCapture>;

  for (const market of MARKETS) {
    const tuple = args.decisionTuples[market] ?? null;
    const evaluatedBook = normalizeBook(tuple?.evaluated_sportsbook);
    const allCurrent = selectedPairPerBook(pairCandidates(current, market, trustedBooks), true);
    const retainedCurrent = prioritizedPairs(allCurrent, evaluatedBook)
      .slice(0, WNBA_FORWARD_EVIDENCE_MAX_BOOKS_PER_MARKET);
    const retainedBooks = new Set(retainedCurrent.map((pair) => pair.sportsbook));
    const openingCandidates = (args.historyRowsTruncated
      ? []
      : selectedPairPerBook(pairCandidates(history, market, trustedBooks), false))
      .filter((pair) => retainedBooks.has(pair.sportsbook))
      .map((pair) => ({
        ...pair,
        opening_provenance: pair.opening_provenance ?? "first_observed" as const,
      }));
    const openingByBook = new Map(openingCandidates.map((pair) => [pair.sportsbook, pair]));
    const movements = retainedCurrent.flatMap((pair) => {
      const opener = openingByBook.get(pair.sportsbook);
      const resolved = opener ? movement(opener, pair, market) : null;
      return resolved ? [resolved] : [];
    });
    const championOutcome = args.championOutput.outcomes[market];
    const targetSide = championOutcome && isSide(championOutcome.side) ? championOutcome.side : tuple?.side ?? null;
    const targetLine = championOutcome ? finite(championOutcome.line) : tuple?.line ?? null;
    const championPublic = championPublicInputs(args.publicSignalRows, market);
    const sourceAwarePublic = sourceAwarePublicPairs(
      args.sourceAwareSplitRows,
      market,
      args.decisionAt,
      startsAt,
    );
    markets[market] = {
      market,
      champion_target: { side: targetSide, line: targetLine },
      evaluation: {
        tuple,
        economic_identity: tupleIdentity(tuple),
        evaluated_sportsbook: tuple?.evaluated_sportsbook ?? null,
        complete_pair_books: [],
        target_excluded_complete_pair_books: [],
        target_excluded_complete_pair_count: 0,
      },
      current_book_pairs: retainedCurrent,
      opening_book_pairs: openingCandidates,
      same_book_movement: movements,
      champion_public_input: championPublic,
      source_aware_public_pairs: sourceAwarePublic,
      coverage: {
        complete_current_books_before_cap: allCurrent.length,
        retained_current_books: retainedCurrent.length,
        omitted_current_books: Math.max(0, allCurrent.length - retainedCurrent.length),
        retained_opening_books: openingCandidates.length,
        retained_same_book_movements: movements.length,
        retained_source_aware_public_pairs: 0,
        circa_current_pair: false,
        circa_public_pair: false,
        history_rows_truncated: args.historyRowsTruncated,
        current_pair_unavailable_reason: allCurrent.length === 0
          ? "no_complete_same_book_current_pair_in_incumbent_result_set"
          : null,
        opening_unavailable_reason: args.historyRowsTruncated
          ? "incumbent_history_result_set_truncated"
          : openingCandidates.length === 0
            ? "no_complete_same_book_history_pair_in_incumbent_result_set"
            : null,
        same_book_movement_unavailable_reason: args.historyRowsTruncated
          ? "incumbent_history_result_set_truncated"
          : movements.length === 0
            ? "no_same_book_opening_current_pair_in_incumbent_result_set"
            : null,
        champion_public_input_unavailable_reason: championPublic.length === 0
          ? "no_champion_public_rows_in_incumbent_result_set"
          : null,
        source_aware_unavailable_reason: boundedString(args.sourceAwareUnavailableReason, 240),
        payload_truncated: allCurrent.length > retainedCurrent.length,
        payload_bytes: 0,
      },
    };
    refreshMarketCoverage(markets[market]);
  }

  const capture: WnbaForwardEvidenceCapture = {
    contract_version: WNBA_FORWARD_EVIDENCE_CAPTURE_CONTRACT_VERSION,
    mode: "capture_only",
    production_decision_effect: false,
    game: {
      game_id: args.game.gameId,
      external_id: args.game.externalId,
      slate_date: args.game.slateDate,
      starts_at: startsAt,
    },
    captured_at: timestamp(args.capturedAt) ?? args.capturedAt,
    decision_at: timestamp(args.decisionAt) ?? args.decisionAt,
    releases: args.releases,
    independent_model: args.independentModel,
    unavailable_independent_inputs: {
      injury_news: null,
      reason: "not_ingested_by_current_wnba_champion",
    },
    champion_output: args.championOutput,
    markets,
    coverage: {
      history_rows_received: args.historyRows.length,
      history_rows_truncated: args.historyRowsTruncated,
      source_aware_rows_received: args.sourceAwareSplitRows.length,
      source_aware_rows_truncated: args.sourceAwareRowsTruncated,
      source_aware_unavailable_reason: boundedString(args.sourceAwareUnavailableReason, 240),
      payload_truncated: false,
      payload_bytes: 0,
    },
  };
  trimGameToBytes(capture);
  return capture;
}

export function readWnbaForwardEvidenceCapture(value: unknown): WnbaForwardEvidenceCapture | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const capture = value as Partial<WnbaForwardEvidenceCapture>;
  if (
    capture.contract_version !== WNBA_FORWARD_EVIDENCE_CAPTURE_CONTRACT_VERSION ||
    capture.mode !== "capture_only" ||
    capture.production_decision_effect !== false ||
    !capture.markets ||
    !capture.coverage ||
    byteLength(capture) > WNBA_FORWARD_EVIDENCE_MAX_GAME_BYTES
  ) return null;
  return capture as WnbaForwardEvidenceCapture;
}

export function wnbaForwardEvidenceMarketSlice(
  value: unknown,
  market: string,
): WnbaForwardEvidenceMarketSlice | null {
  const capture = readWnbaForwardEvidenceCapture(value);
  if (!capture || !isMarket(market)) return null;
  const marketCapture = structuredClone(capture.markets[market]);
  const slice: WnbaForwardEvidenceMarketSlice = {
    ...capture,
    markets: { [market]: marketCapture },
  };
  while (byteLength(slice) > WNBA_FORWARD_EVIDENCE_MAX_MARKET_BYTES) {
    if (marketCapture.current_book_pairs.length > 1) {
      const removed = marketCapture.current_book_pairs.pop()!;
      marketCapture.opening_book_pairs = marketCapture.opening_book_pairs
        .filter((pair) => pair.sportsbook !== removed.sportsbook);
      marketCapture.same_book_movement = marketCapture.same_book_movement
        .filter((move) => move.sportsbook !== removed.sportsbook);
      marketCapture.coverage.omitted_current_books += 1;
      marketCapture.coverage.payload_truncated = true;
      refreshMarketCoverage(marketCapture);
      continue;
    }
    if (marketCapture.source_aware_public_pairs.length > 0) {
      marketCapture.source_aware_public_pairs.pop();
      marketCapture.coverage.payload_truncated = true;
      refreshMarketCoverage(marketCapture);
      continue;
    }
    return null;
  }
  return slice;
}

export const __WNBA_FORWARD_EVIDENCE_TEST__ = {
  byteLength,
  impliedProbability,
  sourceAwarePublicPairs,
};
