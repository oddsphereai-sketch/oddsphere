/**
 * Phase 4.2.C.1.R-17 Step 2B — canonical SharpAPI event discovery via
 * `/opportunities/ev`.
 *
 * Replaces `_splitsDiscovery.ts` as the source of truth for slate-event
 * discovery. The 2026-06-05 SharpAPI audit confirmed:
 *
 *   • `/splits` is a consensus-splits aggregator. It returns ONLY events
 *     for which SharpAPI currently has consensus splits data, which on
 *     intra-day refreshes can be a subset of the actual slate AND can
 *     carry today's date suffix while representing yesterday's matchups
 *     (e.g. 2026-06-05 returned 9 events with `_2026-06-05` suffix but
 *     matchups that were yesterday's slate).
 *   • `/opportunities/ev` returns one row per offered +EV opportunity,
 *     across all books and markets. Once deduped by stripped event_id it
 *     produces one canonical event per game, and matches BDL's slate
 *     listing perfectly (15/15 on 2026-06-05).
 *
 * `_splitsDiscovery.ts` is retained for /splits enrichment merging only
 * (SharpAPISignalProvider). It must NOT be used for slate event discovery
 * or provider preflight.
 *
 * Pure helpers only — network provided by the injected `SharpApiClient`.
 *
 * Output contract:
 *   discoverEventsFromOpportunities(client, sport, date)
 *     → { events: CanonicalEvent[], stats: DiscoveryStats, rows: RawOpportunityRow[] }
 *
 * Each CanonicalEvent carries:
 *   • the stripped event_id (no `_b\d+` market-bucket suffix)
 *   • one observed suffixed event_id (the form `/odds` accepts) — the
 *     first one seen during dedupe. Multi-bucket harvest is a R-17 Step
 *     2D follow-up.
 *   • the home/away abbreviation already resolved through normalizer
 *   • the raw `/opportunities/ev` row used for the dedupe (for diagnostics)
 *
 * Rows missing event_id, with mismatched date suffix, with non-mlb
 * league, with unresolved team strings, or marked as player-prop /
 * alternate-line are dropped. Each drop bucket is counted in `stats`.
 */

import type { Sport } from "../../types/domain/Sport";
import { SharpApiClient, SharpApiNotFoundError } from "./_sharpApiClient";
import {
  normalizeMlbTeamName,
  type MlbTeamAbbrev,
} from "./_teamNameNormalizer";

/**
 * Subset of `/opportunities/ev` row fields we consume. Defensive shape;
 * SharpAPI's response may carry many more fields that we ignore.
 */
export type RawOpportunityRow = {
  event_id?: string | null;
  sport?: string | null;
  league?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  is_player_prop?: boolean | null;
  is_alternate_line?: boolean | null;
  market_type?: string | null;
  sportsbook?: string | null;
};

export type CanonicalEvent = {
  /** Stripped event_id (no `_b\d+` suffix). Stable key per slate game. */
  sharpEventId: string;
  /** One observed suffixed event_id (the form `/odds?event_id=` accepts).
   *  First seen during dedupe. Step 2D will extend to multi-bucket. */
  suffixedEventId: string;
  /** Date suffix parsed from sharpEventId (YYYY-MM-DD). */
  dateSuffix: string;
  home: MlbTeamAbbrev;
  away: MlbTeamAbbrev;
  rawRow: RawOpportunityRow;
};

export type DiscoveryStats = {
  totalRows: number;
  keptEvents: number;
  skippedNonMlb: number;
  skippedMissingEventId: number;
  skippedPlayerProp: number;
  skippedAlternateLine: number;
  skippedDateUnparseable: number;
  skippedWrongDate: number;
  skippedTeamUnresolved: number;
  /** Rows that resolved to an already-discovered event (dedupe). NOT a
   *  drop reason — just bookkeeping for the dedupe step. */
  dedupedRows: number;
};

const OPPORTUNITIES_PATH = "/opportunities/ev";

/**
 * Strip the `_b\d+` market-bucket suffix that `/opportunities/*`
 * event_ids carry. Idempotent on already-stripped ids. Identical
 * semantics to `_splitsDiscovery.stripEventBucketSuffix` — duplicated
 * here so this module stays self-contained.
 */
export function stripEventBucketSuffix(eventId: string): string {
  return eventId.replace(/_b\d+$/, "");
}

/**
 * Pull the YYYY-MM-DD date from a stripped event_id like
 * `mlb_athletics_cubs_2026-06-05`. Returns null when the trailing slug
 * isn't a parseable date.
 */
export function extractSlateDateFromEventId(
  eventId: string | null
): string | null {
  if (eventId === null) return null;
  const stripped = stripEventBucketSuffix(eventId);
  const m = stripped.match(/_(\d{4}-\d{2}-\d{2})$/);
  return m ? (m[1] ?? null) : null;
}

function asStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

/**
 * Build the canonical event list from already-fetched `/opportunities/ev`
 * rows. Exposed so unit tests can exercise the filter logic without HTTP.
 *
 * Order of filters (each drop is counted distinctly):
 *   1. league !== "mlb"             → skippedNonMlb
 *   2. is_player_prop === true      → skippedPlayerProp
 *   3. is_alternate_line === true   → skippedAlternateLine
 *   4. event_id missing/empty       → skippedMissingEventId
 *   5. date suffix unparseable      → skippedDateUnparseable
 *   6. date suffix != expectedDate  → skippedWrongDate
 *   7. home/away normalize fails    → skippedTeamUnresolved
 *
 * Survivors are deduped by stripped event_id. The FIRST row encountered
 * per event_id wins (its suffixed form becomes `suffixedEventId`).
 */
export function buildDiscoveryFromOpportunitiesRows(
  rows: RawOpportunityRow[],
  expectedDate: string
): { events: CanonicalEvent[]; stats: DiscoveryStats } {
  const events: CanonicalEvent[] = [];
  const byStrippedId = new Map<string, CanonicalEvent>();
  const stats: DiscoveryStats = {
    totalRows: rows.length,
    keptEvents: 0,
    skippedNonMlb: 0,
    skippedMissingEventId: 0,
    skippedPlayerProp: 0,
    skippedAlternateLine: 0,
    skippedDateUnparseable: 0,
    skippedWrongDate: 0,
    skippedTeamUnresolved: 0,
    dedupedRows: 0,
  };

  for (const row of rows) {
    const leagueTag = asStringOrNull(row.league)?.toLowerCase();
    if (leagueTag !== null && leagueTag !== undefined && leagueTag !== "mlb") {
      stats.skippedNonMlb++;
      continue;
    }
    if (row.is_player_prop === true) {
      stats.skippedPlayerProp++;
      continue;
    }
    if (row.is_alternate_line === true) {
      stats.skippedAlternateLine++;
      continue;
    }
    const rawEventId = asStringOrNull(row.event_id);
    if (rawEventId === null) {
      stats.skippedMissingEventId++;
      continue;
    }
    const strippedId = stripEventBucketSuffix(rawEventId);
    const rowDate = extractSlateDateFromEventId(strippedId);
    if (rowDate === null) {
      stats.skippedDateUnparseable++;
      continue;
    }
    if (rowDate !== expectedDate) {
      stats.skippedWrongDate++;
      continue;
    }
    // Dedupe: if we've already seen this event_id, count it but skip.
    if (byStrippedId.has(strippedId)) {
      stats.dedupedRows++;
      continue;
    }
    const home = normalizeMlbTeamName(row.home_team);
    const away = normalizeMlbTeamName(row.away_team);
    if (home === null || away === null) {
      stats.skippedTeamUnresolved++;
      continue;
    }
    const ev: CanonicalEvent = {
      sharpEventId: strippedId,
      suffixedEventId: rawEventId,
      dateSuffix: rowDate,
      home,
      away,
      rawRow: row,
    };
    byStrippedId.set(strippedId, ev);
    events.push(ev);
    stats.keptEvents++;
  }

  return { events, stats };
}

/**
 * Fetch `/opportunities/ev?sport=mlb` live and run the canonical
 * discovery filter. The caller passes the configured `SharpApiClient`
 * (tests can pass a stub). Returns an empty event list on 404 (treated
 * as "no slate") — same pattern as the other SharpAPI providers.
 */
export async function discoverEventsFromOpportunities(
  client: SharpApiClient,
  sport: Sport,
  date: string
): Promise<{
  events: CanonicalEvent[];
  stats: DiscoveryStats;
  rows: RawOpportunityRow[];
}> {
  if (sport !== "mlb") {
    return {
      events: [],
      stats: {
        totalRows: 0,
        keptEvents: 0,
        skippedNonMlb: 0,
        skippedMissingEventId: 0,
        skippedPlayerProp: 0,
        skippedAlternateLine: 0,
        skippedDateUnparseable: 0,
        skippedWrongDate: 0,
        skippedTeamUnresolved: 0,
        dedupedRows: 0,
      },
      rows: [],
    };
  }

  let rows: RawOpportunityRow[];
  try {
    rows = await client.fetchAll<RawOpportunityRow>({
      path: OPPORTUNITIES_PATH,
      query: { sport: "mlb" },
      maxPages: 5,
    });
  } catch (e) {
    if (e instanceof SharpApiNotFoundError) rows = [];
    else throw e;
  }

  const { events, stats } = buildDiscoveryFromOpportunitiesRows(rows, date);
  return { events, stats, rows };
}
