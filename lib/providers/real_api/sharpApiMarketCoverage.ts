/**
 * Push 2 — SharpAPI direct /odds fetch + row mapping for slate-driven
 * recovery. Used as the fallback when /opportunities/ev or /splits
 * discovery misses an expected game.
 *
 * This module is a thin wrapper around SharpAPI's `/odds?event_id=...`
 * endpoint that applies the SAME row-level filtering rules as the
 * primary V1/V2 ingest path (mapMarketType, mapSportsbook, mapSide,
 * is_alternate_line, league check, R-16G-A home/away sanity guard).
 * The shared helpers are imported from SharpAPIOddsProvider so any
 * future tightening of those filters lands in both paths together.
 *
 * Additions on top of the primary path:
 *   1. Book-quality classification (high / normal / low) so the audit
 *      can distinguish kalshi-only coverage from real-sportsbook
 *      coverage without re-implementing rules in three places.
 *   2. Per-row drop reasons that map to the Push 2 reason-code enum,
 *      so the audit report can explain every absence.
 *   3. Stricter wrong-game guard: requires the candidate event_id's
 *      home/away mascots to match the expected game's normalized
 *      abbrevs based on the row's home_team / away_team strings.
 *      Rejects cross-game contamination.
 *
 * Pure-ish: takes a SharpApiClient instance (DI for tests + reuse),
 * does not touch the DB, returns a typed result.
 */

import type { MarketType, Side, Sportsbook } from "../../types/domain/Lines";
import type { LineRecord } from "../interfaces/IOddsProvider";
import { SharpApiClient, SharpApiNotFoundError } from "./_sharpApiClient";
import {
  asNumberOrNull,
  asStringOrNull,
  mapMarketType,
  mapSide,
  mapSportsbook,
} from "./SharpAPIOddsProvider";
import {
  normalizeMlbTeamName,
  type MlbTeamAbbrev,
} from "./_teamNameNormalizer";

// ─── book quality classification ────────────────────────────────────

/**
 * Book-quality bucket used by the coverage audit and downstream
 * decisions. Higher quality = better suited for market-baseline math.
 *
 * "high":   tier-1 US sportsbooks with deep liquidity (DraftKings,
 *           FanDuel, BetMGM, Caesars, Circa, etc.). Two-sided pairs
 *           from any of these are gold-standard for de-vig.
 * "normal": secondary sportsbooks (saba, fliff, ballybet, onexbet,
 *           bovada, bookmaker). Useful and trustworthy enough to
 *           drive the model when tier-1 isn't available.
 * "low":    prediction-market / exchange (kalshi, polymarket). NOT
 *           comparable to sportsbook consensus — model can use as
 *           weak signal but never as sole baseline for Best Angle.
 * "unknown": anything not on our list. Tracked separately so a new
 *           book showing up is visible in the audit.
 */
export type BookQuality = "high" | "normal" | "low" | "unknown";

const BOOK_TIER_HIGH: ReadonlySet<string> = new Set([
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "circa",
  "bet365 us",
  "bet365",
  "betrivers",
  "espnbet",
  "espn bet",
  "pointsbet",
]);

const BOOK_TIER_NORMAL: ReadonlySet<string> = new Set([
  "saba",
  "fliff",
  "ballybet",
  "onexbet",
  "1xbet",
  "bovada",
  "bookmaker",
  "betonline",
  "wynnbet",
  "barstool",
  "twinspires",
]);

const BOOK_TIER_LOW: ReadonlySet<string> = new Set([
  "kalshi",
  "polymarket",
  "robinhood",
]);

export function classifyBookQuality(book: string | null | undefined): BookQuality {
  if (book === null || book === undefined) return "unknown";
  const k = book.trim().toLowerCase();
  if (BOOK_TIER_HIGH.has(k)) return "high";
  if (BOOK_TIER_NORMAL.has(k)) return "normal";
  if (BOOK_TIER_LOW.has(k)) return "low";
  return "unknown";
}

// ─── per-row drop reasons ──────────────────────────────────────────

export type CoverageDropReason =
  | "wrong_league"
  | "alternate_line_dropped"
  | "unsupported_market"
  | "unknown_book"
  | "unsupported_side"
  | "wrong_game_guard_rejected";

// ─── core fetch + map ──────────────────────────────────────────────

export type ExpectedEventGuard = {
  /** Canonical 3-letter abbrev for the home team. */
  homeAbbrev: MlbTeamAbbrev;
  /** Canonical 3-letter abbrev for the away team. */
  awayAbbrev: MlbTeamAbbrev;
  /** BDL external_id this fetch should resolve to. Used as game_external_id on LineRecord. */
  gameExternalId: number;
};

export type CoverageFetchResult = {
  /** Whether the /odds call succeeded with any rows. */
  ok: boolean;
  /** Mapped LineRecord rows ready for ingest. Empty when ok=false. */
  records: LineRecord[];
  /**
   * Per-reason drop counts. Sums to (rawRowCount - records.length).
   * Caller can surface these in the audit report.
   */
  drops: Partial<Record<CoverageDropReason, number>>;
  /** Total raw rows returned by /odds. */
  rawRowCount: number;
  /** Distinct sportsbooks observed on the mapped rows. */
  booksMapped: string[];
  /** Aggregate book quality from `booksMapped`. */
  bookQuality: BookQuality;
};

const HTTP_NOT_FOUND_RESULT: CoverageFetchResult = {
  ok: false,
  records: [],
  drops: {},
  rawRowCount: 0,
  booksMapped: [],
  bookQuality: "unknown",
};

type RawOddsRow = {
  market_type?: string;
  sportsbook?: string;
  selection_type?: string;
  line?: number | string | null;
  odds_american?: number | string | null;
  odds_decimal?: number | string | null;
  odds_probability?: number | string | null;
  is_alternate_line?: boolean;
  home_team?: string;
  away_team?: string;
  league?: string;
  last_seen_at?: string;
  wire_received_at?: string;
};

/**
 * Hit `/odds?event_id=<candidate>` and map the response into LineRecords
 * for ingest. Applies the production filter rules + the Push 2 wrong-
 * game guard + book-quality classification.
 *
 * Returns a result with ok=false (and empty records) when SharpAPI
 * returns 404 / 0 rows / every row failed a guard. Caller can iterate
 * through multiple candidates and stop on the first ok=true result.
 *
 * Pure-ish: depends only on the injected SharpApiClient + the inputs.
 * No DB access, no logging side effects beyond the returned drop map.
 */
export async function fetchOddsAndMapForEventId(
  client: SharpApiClient,
  eventId: string,
  expected: ExpectedEventGuard,
): Promise<CoverageFetchResult> {
  let rows: RawOddsRow[];
  try {
    rows = await client.fetchAll<RawOddsRow>({
      path: "/odds",
      query: { event_id: eventId },
      maxPages: 5,
    });
  } catch (e) {
    if (e instanceof SharpApiNotFoundError) {
      return HTTP_NOT_FOUND_RESULT;
    }
    throw e;
  }

  if (rows.length === 0) {
    return HTTP_NOT_FOUND_RESULT;
  }

  const drops: Partial<Record<CoverageDropReason, number>> = {};
  const records: LineRecord[] = [];
  const fetchedAtFallback = new Date().toISOString();

  for (const row of rows) {
    const rowLeague = asStringOrNull(row.league)?.toLowerCase();
    if (rowLeague !== null && rowLeague !== undefined && rowLeague !== "mlb") {
      drops.wrong_league = (drops.wrong_league ?? 0) + 1;
      continue;
    }
    if (row.is_alternate_line === true) {
      drops.alternate_line_dropped = (drops.alternate_line_dropped ?? 0) + 1;
      continue;
    }
    const market = mapMarketType(asStringOrNull(row.market_type ?? null));
    if (market === null) {
      drops.unsupported_market = (drops.unsupported_market ?? 0) + 1;
      continue;
    }
    const sportsbook = mapSportsbook(asStringOrNull(row.sportsbook ?? null));
    if (sportsbook === null) {
      drops.unknown_book = (drops.unknown_book ?? 0) + 1;
      continue;
    }
    const side = mapSide(row.selection_type ?? null);
    if (side === null) {
      drops.unsupported_side = (drops.unsupported_side ?? 0) + 1;
      continue;
    }

    // Wrong-game guard: when the row carries home/away team strings
    // AND the row's side is home or away (so home/away identity is
    // load-bearing), reject any row whose own home/away normalizes
    // to a team not in our expected pair. Same idea as R-16G-A in
    // the primary path; we apply it here too because direct event_id
    // candidates can occasionally collide with an unrelated event
    // (e.g., a future / spring-training / minor-league fixture
    // happening to share a mascot pair on the same date).
    if (side === "home" || side === "away") {
      const rowHomeAbbr = normalizeMlbTeamName(asStringOrNull(row.home_team));
      const rowAwayAbbr = normalizeMlbTeamName(asStringOrNull(row.away_team));
      if (
        rowHomeAbbr !== null &&
        rowAwayAbbr !== null &&
        (rowHomeAbbr !== expected.homeAbbrev ||
          rowAwayAbbr !== expected.awayAbbrev)
      ) {
        drops.wrong_game_guard_rejected = (drops.wrong_game_guard_rejected ?? 0) + 1;
        continue;
      }
    }

    records.push({
      game_external_id: expected.gameExternalId,
      market_type: market as MarketType,
      player_external_id: null,
      sportsbook: sportsbook as Sportsbook,
      side: side as Side,
      line_value: asNumberOrNull(row.line),
      odds_american: asNumberOrNull(row.odds_american),
      odds_decimal: asNumberOrNull(row.odds_decimal),
      implied_probability: asNumberOrNull(row.odds_probability),
      ev_percent: null,
      fair_odds: null,
      is_ev_positive: null,
      fetched_at:
        asStringOrNull(row.last_seen_at) ??
        asStringOrNull(row.wire_received_at) ??
        fetchedAtFallback,
    });
  }

  const books = Array.from(new Set(records.map((r) => r.sportsbook as string)));
  const bookQuality = aggregateBookQuality(books);

  return {
    ok: records.length > 0,
    records,
    drops,
    rawRowCount: rows.length,
    booksMapped: books,
    bookQuality,
  };
}

/**
 * Aggregate the book-quality of a recovered set of rows. Best quality
 * across the set wins — a single tier-1 book pulls the aggregate up.
 */
export function aggregateBookQuality(books: ReadonlyArray<string>): BookQuality {
  if (books.length === 0) return "unknown";
  let best: BookQuality = "unknown";
  for (const b of books) {
    const q = classifyBookQuality(b);
    if (q === "high") return "high";
    if (q === "normal") best = "normal";
    else if (q === "low" && best === "unknown") best = "low";
  }
  return best;
}

// ─── two-sided pair detection per market ────────────────────────────

/**
 * Test whether a set of LineRecords includes at least one book with
 * BOTH sides of a market populated. de-vig requires a two-sided pair
 * from the same book; this lets the audit distinguish "1 book one-
 * sided" (`one_sided_market_only`) from "no rows at all".
 */
export function hasTwoSidedPairForMarket(
  records: ReadonlyArray<LineRecord>,
  market: MarketType,
  sideA: Side,
  sideB: Side,
): boolean {
  const byBook = new Map<string, Set<Side>>();
  for (const r of records) {
    if (r.market_type !== market) continue;
    if (r.side === null) continue;
    let s = byBook.get(r.sportsbook);
    if (s === undefined) {
      s = new Set<Side>();
      byBook.set(r.sportsbook, s);
    }
    s.add(r.side);
  }
  for (const s of byBook.values()) {
    if (s.has(sideA) && s.has(sideB)) return true;
  }
  return false;
}

export const __TEST__ = {
  BOOK_TIER_HIGH,
  BOOK_TIER_NORMAL,
  BOOK_TIER_LOW,
};
