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
  /**
   * R-17 Step 2E.1 — ALL observed `_b\d+` suffixed event_ids for this
   * game, sorted alphabetically. Today's audit (2026-06-05) found
   * SharpAPI publishes 13 of 15 MLB events across BOTH `_b0` AND `_b3`,
   * each carrying a different subset of books in `/odds`. Multi-bucket
   * harvest in `SharpAPIOddsProvider.getGameLinesV2` calls /odds for
   * EVERY entry in this list and merges with a stable dedupe key so
   * book coverage isn't dependent on which single bucket the dedupe
   * step picked.
   *
   * Pre-2E.1 this field was `suffixedEventId: string` (singular). The
   * rename is breaking on purpose — multi-suffix is the new contract.
   */
  suffixedEventIds: string[];
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
  /**
   * R-17 Step 2D — multi-bucket drift detector. Empty in the steady-state
   * (every stripped event_id should map to exactly one `_b\d+` suffix on
   * `/opportunities/ev`). If SharpAPI ever starts publishing multiple
   * buckets per event for MLB on the slate date, this array will list
   * the offending events along with their observed suffixes so callers
   * (orchestrator banner, V2 lines preview) can surface a loud warning
   * — single-suffix harvest may start missing markets the moment this
   * fires, and an "all buckets" harvest follow-up becomes required.
   *
   * Detection is WARNING-ONLY in Step 2D — no behavior change. The
   * helper still returns one CanonicalEvent per stripped event_id
   * (first suffix wins) so existing downstream code is unaffected.
   */
  multiBucketEvents: Array<{ sharpEventId: string; suffixes: string[] }>;
};

const OPPORTUNITIES_PATHS = ["/opportunities/ev", "/opportunities/low_hold"] as const;

/**
 * Strip the `_b\d+` market-bucket suffix that `/opportunities/*`
 * event_ids carry. Idempotent on already-stripped ids. Identical
 * semantics to `_splitsDiscovery.stripEventBucketSuffix` — duplicated
 * here so this module stays self-contained.
 */
export function stripEventBucketSuffix(eventId: string): string {
  // Doubleheader IDs put the game marker after the bucket, e.g.
  // `..._b2_g1`. Preserve `_g1`/`_g2` as part of event identity while
  // removing only the market bucket.
  return eventId.replace(/_b\d+(?=_g\d+$|$)/, "");
}

/** Insert a SharpAPI market bucket before a trailing doubleheader marker. */
export function withEventBucketSuffix(eventId: string, suffix: string): string {
  const stripped = stripEventBucketSuffix(eventId);
  return /_g\d+$/.test(stripped)
    ? stripped.replace(/(_g\d+)$/, `${suffix}$1`)
    : stripped + suffix;
}

/** SharpAPI appends `_g1`, `_g2`, ... for doubleheader games. */
export function extractDoubleheaderGameNumberFromEventId(
  eventId: string | null,
): number | null {
  if (eventId === null) return null;
  const match = stripEventBucketSuffix(eventId).match(/_g(\d+)$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
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
  const m = stripped.match(/_(\d{4}-\d{2}-\d{2})(?:_g\d+)?$/);
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
  // SharpAPI can expose a doubleheader game only through prop/alternate
  // opportunity rows even while its /odds endpoint has full game prices.
  // Preserve one normalized row so that game identity is not lost merely
  // because no main-line opportunity happened to be +EV at this poll.
  const doubleheaderFallbackByStrippedId = new Map<
    string,
    {
      rawEventId: string;
      rowDate: string;
      home: MlbTeamAbbrev;
      away: MlbTeamAbbrev;
      rawRow: RawOpportunityRow;
    }
  >();
  // R-17 Step 2D — track every observed suffix per stripped event_id so
  // we can detect multi-bucket drift after the build loop completes.
  // Populated for ALL rows that pass the league + non-prop + non-alt
  // filters, even if a row is otherwise deduped. The detector cares
  // about "did SharpAPI publish multiple buckets for this game", not
  // "did our dedupe drop a row" (those overlap but are not identical).
  const suffixesByStrippedId = new Map<string, Set<string>>();
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
    multiBucketEvents: [],
  };

  for (const row of rows) {
    // ── Stage 1: filters that must pass before suffix tracking ──
    // The suffix tracker (multi-bucket detector) needs league + event_id
    // + slate-date filtering to apply BEFORE it touches the row, so
    // cross-sport / cross-slate rows can't poison the detector with
    // unrelated buckets. R-17 Step 2E.0 (2026-06-05) — moved suffix
    // tracking to BEFORE the player-prop / alt-line filters because
    // those flags are row-level annotations, not bucket identifiers:
    // SharpAPI publishes both `_b0` AND `_b3` for many events, but most
    // of their /opportunities/ev rows carry is_player_prop=true or
    // is_alternate_line=true. The old order tracked suffix only on
    // surviving rows → detector falsely reported zero drift on slates
    // that DID have multiple buckets. The new order tracks the bucket
    // identity from any prop/alt row too so drift surfaces correctly.
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

    // ── Stage 2: suffix tracking for the multi-bucket detector ──
    // Runs on every row that belongs to the right league + slate, even
    // alt-line / player-prop rows. The detector's job is to see which
    // buckets SharpAPI publishes per event — orthogonal to which rows
    // we'd actually harvest. Step 2E.1 (multi-bucket /odds harvest)
    // consumes the same `suffixesByStrippedId` map to populate the
    // canonical event's full suffix list.
    const suffixMatch = rawEventId.match(/_b\d+(?=_g\d+$|$)/);
    const suffix = suffixMatch ? suffixMatch[0] : "";
    let suffixSet = suffixesByStrippedId.get(strippedId);
    if (!suffixSet) {
      suffixSet = new Set<string>();
      suffixesByStrippedId.set(strippedId, suffixSet);
    }
    suffixSet.add(suffix);

    if (
      extractDoubleheaderGameNumberFromEventId(strippedId) !== null &&
      !doubleheaderFallbackByStrippedId.has(strippedId)
    ) {
      const fallbackHome = normalizeMlbTeamName(row.home_team);
      const fallbackAway = normalizeMlbTeamName(row.away_team);
      if (fallbackHome !== null && fallbackAway !== null) {
        doubleheaderFallbackByStrippedId.set(strippedId, {
          rawEventId,
          rowDate,
          home: fallbackHome,
          away: fallbackAway,
          rawRow: row,
        });
      }
    }

    // ── Stage 3: row-level harvest filters ──
    // These flags don't change the event's bucket identity — they just
    // mark this PARTICULAR row as not-for-V2-harvest. Drop the row but
    // keep its bucket in the suffix set above.
    if (row.is_player_prop === true) {
      stats.skippedPlayerProp++;
      continue;
    }
    if (row.is_alternate_line === true) {
      stats.skippedAlternateLine++;
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
      // Initialized with this row's suffix; the post-loop pass below
      // supplements this list with EVERY other observed suffix (from
      // suffixesByStrippedId) so multi-bucket /odds harvest sees them.
      suffixedEventIds: [rawEventId],
      dateSuffix: rowDate,
      home,
      away,
      rawRow: row,
    };
    byStrippedId.set(strippedId, ev);
    events.push(ev);
    stats.keptEvents++;
  }

  // Promote only missing doubleheader identities. Ordinary prop/alternate
  // rows remain excluded exactly as before; this narrow recovery prevents
  // Game 2 from disappearing when Game 1 has the only main-line opportunity.
  for (const [strippedId, fallback] of doubleheaderFallbackByStrippedId) {
    if (byStrippedId.has(strippedId)) continue;
    const ev: CanonicalEvent = {
      sharpEventId: strippedId,
      suffixedEventIds: [fallback.rawEventId],
      dateSuffix: fallback.rowDate,
      home: fallback.home,
      away: fallback.away,
      rawRow: fallback.rawRow,
    };
    byStrippedId.set(strippedId, ev);
    events.push(ev);
    stats.keptEvents++;
  }

  // ── R-17 Step 2E.1 — post-loop suffix expansion ──
  //
  // The build loop only assigned one `suffixedEventIds` entry per
  // canonical event (the row that won dedupe). Multi-bucket harvest
  // needs the FULL list, including suffixes that only appeared on rows
  // we dropped earlier (player-prop / alt-line / later-dedupe rows).
  // `suffixesByStrippedId` already carries that data — Step 2E.0
  // ensured suffix tracking runs before the prop/alt filters. Walk the
  // map here and merge each event's complete suffix set into its
  // CanonicalEvent.suffixedEventIds, then sort for deterministic
  // downstream behavior + test stability.
  for (const ev of events) {
    const suffixSet = suffixesByStrippedId.get(ev.sharpEventId);
    if (!suffixSet) continue;
    const seen = new Set(ev.suffixedEventIds);
    for (const sfx of suffixSet) {
      // Skip empty suffixes — /odds requires `_b\d+`. An empty suffix
      // would land on the stripped id, which the SharpAPI audit
      // confirmed returns 0 rows.
      if (sfx === "") continue;
      const fullId = withEventBucketSuffix(ev.sharpEventId, sfx);
      if (!seen.has(fullId)) {
        ev.suffixedEventIds.push(fullId);
        seen.add(fullId);
      }
    }
    ev.suffixedEventIds.sort();
  }

  // R-17 Step 2D — post-loop multi-bucket detection. Any stripped
  // event_id whose suffix set has more than one entry means SharpAPI
  // is publishing the event across multiple `_b\d+` buckets. Single-
  // suffix harvest currently picks the first one and skips the rest;
  // this detector surfaces the condition for the orchestrator banner
  // to warn loudly so we can react if SharpAPI ever starts splitting
  // markets across buckets. Sorted for stable test output.
  const multiBucketIds: Array<{ sharpEventId: string; suffixes: string[] }> = [];
  for (const [strippedId, suffixes] of suffixesByStrippedId) {
    if (suffixes.size > 1) {
      multiBucketIds.push({
        sharpEventId: strippedId,
        suffixes: [...suffixes].sort(),
      });
    }
  }
  multiBucketIds.sort((a, b) =>
    a.sharpEventId.localeCompare(b.sharpEventId)
  );
  stats.multiBucketEvents = multiBucketIds;

  return { events, stats };
}

/**
 * Fetch both verified current-event feeds and run the canonical discovery
 * filter over their union. `/opportunities/ev` can omit a game whenever no
 * current offer qualifies as +EV; `/opportunities/low_hold` still carries
 * the provider event id for those games. Neither feed is allowed to bypass
 * the existing league/date/team identity guards.
 */
export async function discoverEventsFromOpportunities(
  client: SharpApiClient,
  sport: Sport,
  date: string,
  opts?: { signal?: AbortSignal },
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
        multiBucketEvents: [],
      },
      rows: [],
    };
  }

  const fetched = await Promise.all(
    OPPORTUNITIES_PATHS.map(async (path) => {
      try {
        return await client.fetchAll<RawOpportunityRow>({
          path,
          query: { sport: "mlb" },
          maxPages: 5,
          signal: opts?.signal,
        });
      } catch (e) {
        if (e instanceof SharpApiNotFoundError) return [];
        throw e;
      }
    }),
  );
  const rows = fetched.flat();

  const { events, stats } = buildDiscoveryFromOpportunitiesRows(rows, date);
  return { events, stats, rows };
}
