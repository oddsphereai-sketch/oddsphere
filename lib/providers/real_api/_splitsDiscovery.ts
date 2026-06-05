/**
 * Phase 4.2.C.1.R-16D — shared /splits-anchored event discovery.
 *
 * ⚠ R-17 Step 2B (2026-06-05) — SCOPE NARROWED TO ENRICHMENT ONLY.
 *
 *   Live probing confirmed `/splits` is a consensus-splits aggregator,
 *   NOT a slate listing. On 2026-06-05 it returned 9 events with
 *   `_2026-06-05` event_id suffixes whose matchups were yesterday's
 *   slate, while BDL and SharpAPI `/opportunities/ev` both returned
 *   tonight's 15 actual games. Using `/splits` for slate-event
 *   discovery silently shrunk coverage to a stale subset AND produced
 *   false-positive preflight "OK" results.
 *
 *   Canonical event discovery is now `_opportunitiesDiscovery.ts` (via
 *   `discoverEventsFromOpportunities`). This module remains in use for
 *   ONE purpose only: per-(home,away) lookup of /splits enrichment
 *   data feeding the R-16E per-market fallback in
 *   `SharpAPIOddsProvider.getGameLinesV2`, and the splits-merge step
 *   in `SharpAPISignalProvider.getSharpSignals` (public bets/money %).
 *
 *   DO NOT add new callers that use this helper for slate discovery
 *   or for provider date alignment / preflight.
 *
 * (Original header below for historical context.)
 *
 * Both the V2 line-refresh strategy (SharpAPIOddsProvider.getGameLinesV2)
 * and any future component that needs all-slate event discovery use this
 * helper. The V1 line refresh used `/opportunities/ev` for both discovery
 * and odds payload, which silently shrinks coverage to games with active
 * +EV opportunities at that minute. `/splits?sport=mlb` returns one row
 * per slate game regardless of opportunity status, so it is the
 * appropriate "all games" discovery surface at our SharpAPI tier.
 *
 * Pure functions only — no DB / no service imports. Network is provided
 * by the injected `SharpApiClient`.
 *
 * Output contract:
 *   discoverEventsFromSplits(client, date) → DiscoveredEvent[]
 * Each DiscoveredEvent carries:
 *   • the stripped event_id from /splits (no _b\d+ suffix)
 *   • the home/away abbreviation already resolved through normalizer
 *   • the raw /splits row (for downstream tagging / debug)
 * Rows missing event_id, with mismatched date, with non-mlb league, or
 * with unresolved team strings are dropped. Each drop bucket is counted
 * in the returned `stats` so the operator can see *why* discovery
 * shrank if it ever does.
 */

import type { Sport } from "../../types/domain/Sport";
import { SharpApiClient, SharpApiNotFoundError } from "./_sharpApiClient";
import {
  normalizeMlbTeamName,
  type MlbTeamAbbrev,
} from "./_teamNameNormalizer";

/**
 * Subset of /splits row fields we consume. Mirrors RawSplitsRow in
 * SharpAPISignalProvider but kept independent so this module stays
 * self-contained — no cross-import from a sibling provider.
 */
export type RawSplitsRow = {
  event_id?: string | null;
  sport?: string | null;
  league?: string | null;
  away_team?: string | null;
  home_team?: string | null;
  sportsbook?: string | null;
  moneyline?: unknown;
  spread?: unknown;
  total?: unknown;
  fetched_at?: string | null;
};

export type DiscoveredEvent = {
  /** Stripped event_id (no _b\d+ bucket suffix). */
  splitsEventId: string;
  home: MlbTeamAbbrev;
  away: MlbTeamAbbrev;
  rawRow: RawSplitsRow;
};

export type DiscoveryStats = {
  totalRows: number;
  keptRows: number;
  skippedNonMlb: number;
  skippedMissingEventId: number;
  skippedDateUnparseable: number;
  skippedWrongDate: number;
  skippedTeamUnresolved: number;
};

const SPLITS_PATH = "/splits";

/**
 * Strip the `_b\d+` market-bucket suffix that /opportunities/* event_ids
 * carry but /splits event_ids do not. Idempotent on already-stripped ids.
 */
export function stripEventBucketSuffix(eventId: string): string {
  return eventId.replace(/_b\d+$/, "");
}

/**
 * Pull the YYYY-MM-DD date from a stripped event_id like
 * `mlb_athletics_cubs_2026-06-04`. Returns null when the trailing slug
 * isn't a parseable date. Callers treat null as "do not trust this row."
 */
export function extractSlateDateFromEventId(
  eventId: string | null
): string | null {
  if (eventId === null) return null;
  const stripped = stripEventBucketSuffix(eventId);
  const m = stripped.match(/_(\d{4}-\d{2}-\d{2})$/);
  return m ? m[1] ?? null : null;
}

function asStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

/**
 * Build the discovery list from already-fetched /splits rows. Exposed so
 * unit tests can exercise the filter logic without HTTP.
 */
export function buildDiscoveryFromSplitsRows(
  rows: RawSplitsRow[],
  expectedDate: string
): { events: DiscoveredEvent[]; stats: DiscoveryStats } {
  const events: DiscoveredEvent[] = [];
  const seenPairs = new Set<string>();
  const stats: DiscoveryStats = {
    totalRows: rows.length,
    keptRows: 0,
    skippedNonMlb: 0,
    skippedMissingEventId: 0,
    skippedDateUnparseable: 0,
    skippedWrongDate: 0,
    skippedTeamUnresolved: 0,
  };

  for (const row of rows) {
    const leagueTag = asStringOrNull(row.league)?.toLowerCase();
    if (leagueTag !== null && leagueTag !== undefined && leagueTag !== "mlb") {
      stats.skippedNonMlb++;
      continue;
    }
    const rawEventId = asStringOrNull(row.event_id);
    if (rawEventId === null) {
      stats.skippedMissingEventId++;
      continue;
    }
    const rowDate = extractSlateDateFromEventId(rawEventId);
    if (rowDate === null) {
      stats.skippedDateUnparseable++;
      continue;
    }
    if (rowDate !== expectedDate) {
      stats.skippedWrongDate++;
      continue;
    }
    const home = normalizeMlbTeamName(row.home_team);
    const away = normalizeMlbTeamName(row.away_team);
    if (home === null || away === null) {
      stats.skippedTeamUnresolved++;
      continue;
    }
    const pairKey = `${home}|${away}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    events.push({
      splitsEventId: stripEventBucketSuffix(rawEventId),
      home,
      away,
      rawRow: row,
    });
    stats.keptRows++;
  }

  return { events, stats };
}

/**
 * Fetch /splits live and run the same discovery filter. Caller passes
 * the configured SharpApiClient (test code can pass a stub). Returns
 * an empty event list on 404 (treated as "no slate") — same pattern as
 * the other SharpAPI providers.
 */
export async function discoverEventsFromSplits(
  client: SharpApiClient,
  sport: Sport,
  date: string
): Promise<{ events: DiscoveredEvent[]; stats: DiscoveryStats; rows: RawSplitsRow[] }> {
  if (sport !== "mlb") {
    return {
      events: [],
      stats: {
        totalRows: 0,
        keptRows: 0,
        skippedNonMlb: 0,
        skippedMissingEventId: 0,
        skippedDateUnparseable: 0,
        skippedWrongDate: 0,
        skippedTeamUnresolved: 0,
      },
      rows: [],
    };
  }

  let rows: RawSplitsRow[];
  try {
    rows = await client.fetchAll<RawSplitsRow>({
      path: SPLITS_PATH,
      query: { sport: "mlb" },
      maxPages: 3,
    });
  } catch (e) {
    if (e instanceof SharpApiNotFoundError) rows = [];
    else throw e;
  }

  const { events, stats } = buildDiscoveryFromSplitsRows(rows, date);
  return { events, stats, rows };
}
