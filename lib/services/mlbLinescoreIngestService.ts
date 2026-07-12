/**
 * Push 4b — MLB linescore ingest service.
 *
 * Hits MLB Stats API for a slate date, extracts first-inning scoring,
 * matches each MLB game to our `games` row via the team-name
 * normalizer, and updates ONLY the linescore fields:
 *   - games.first_inning_runs   (INT — combined 1st inning total)
 *   - games.inning_scores       (JSONB — per-side per-inning splits)
 *
 * NEVER modifies predictions. NEVER touches locked_at, slate_status,
 * or game_predictions. Idempotent — re-running on the same data
 * compares before/after and skips no-op rows.
 *
 * Wrong-game guard: a linescore is only written when BOTH the home
 * AND away team abbrev round-trip through `normalizeMlbTeamName` to
 * the abbrevs on our games row. Mismatches are reported, not written.
 *
 * Scheduled / not-started games are skipped — never write 0 as a
 * fake "no runs yet" value.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeMlbTeamName,
  type MlbTeamAbbrev,
} from "../providers/real_api/_teamNameNormalizer";

// ─── inlined MLB Stats API helpers (linescore-specific) ────────────
//
// These live in this service file instead of `_mlbStatsApiClient.ts`
// to avoid disturbing the existing pitcher-stats helpers. The MLB
// Stats API is public + unauthenticated. We hit `/schedule?hydrate=
// linescore` once per slate date — that one round-trip returns every
// game's inning-by-inning splits.

const MLB_STATS_API_BASE = "https://statsapi.mlb.com/api/v1";

/** Subset of the MLB Stats API /schedule shape we depend on. */
export type MlbStatsRawGame = {
  gamePk: number;
  gameDate?: string;
  status?: {
    abstractGameState?: string;
    detailedState?: string;
    statusCode?: string;
  };
  teams?: {
    home?: { team?: { id?: number; name?: string }; score?: number };
    away?: { team?: { id?: number; name?: string }; score?: number };
  };
  linescore?: {
    currentInning?: number;
    innings?: Array<{
      num: number;
      home?: { runs?: number; hits?: number; errors?: number };
      away?: { runs?: number; hits?: number; errors?: number };
    }>;
  };
};

type MlbStatsScheduleResponse = {
  dates?: Array<{ date: string; games?: MlbStatsRawGame[] }>;
};

export async function fetchMlbStatsSchedule(
  date: string,
  opts?: { signal?: AbortSignal; fetcher?: typeof fetch },
): Promise<MlbStatsScheduleResponse> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`fetchMlbStatsSchedule: invalid date "${date}", expected YYYY-MM-DD`);
  }
  const url = `${MLB_STATS_API_BASE}/schedule?sportId=1&date=${date}&hydrate=linescore`;
  const f = opts?.fetcher ?? fetch;
  const res = await f(url, { signal: opts?.signal });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MLB Stats API ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as MlbStatsScheduleResponse;
}

export function extractGamesFromSchedule(
  resp: MlbStatsScheduleResponse,
): MlbStatsRawGame[] {
  const out: MlbStatsRawGame[] = [];
  for (const d of resp.dates ?? []) {
    for (const g of d.games ?? []) out.push(g);
  }
  return out;
}

/**
 * Extract first-inning runs from the linescore. Both halves must
 * have scored values before we report a total — half-inning data
 * (top scored, bottom not yet) returns status="incomplete".
 */
export function extractFirstInningTotal(g: MlbStatsRawGame): {
  awayRuns: number | null;
  homeRuns: number | null;
  total: number | null;
  status: "complete" | "incomplete" | "absent";
} {
  const innings = g.linescore?.innings;
  if (!Array.isArray(innings) || innings.length === 0) {
    return { awayRuns: null, homeRuns: null, total: null, status: "absent" };
  }
  // Must find the actual num=1 inning — NEVER fall back to innings[0]
  // because MLB Stats API can return a partial linescore that starts
  // at inning 2 mid-game (we should treat 1st as absent in that case,
  // not silently use the 2nd inning's runs as "first inning").
  const first = innings.find((i) => i.num === 1) ?? null;
  if (first === null) {
    return { awayRuns: null, homeRuns: null, total: null, status: "absent" };
  }
  const awayRuns = typeof first.away?.runs === "number" ? first.away.runs : null;
  const homeRuns = typeof first.home?.runs === "number" ? first.home.runs : null;
  if (awayRuns === null || homeRuns === null) {
    return { awayRuns, homeRuns, total: null, status: "incomplete" };
  }
  return { awayRuns, homeRuns, total: awayRuns + homeRuns, status: "complete" };
}

/**
 * Build inning_scores JSONB in the shape `{home:[...], away:[...]}`
 * matching the existing `games.inning_scores` column definition.
 */
export function buildInningScoresJson(
  g: MlbStatsRawGame,
): { home: Array<number | null>; away: Array<number | null> } | null {
  const innings = g.linescore?.innings;
  if (!Array.isArray(innings) || innings.length === 0) return null;
  const sorted = [...innings].sort((a, b) => a.num - b.num);
  const home: Array<number | null> = [];
  const away: Array<number | null> = [];
  for (const inn of sorted) {
    home.push(typeof inn.home?.runs === "number" ? inn.home.runs : null);
    away.push(typeof inn.away?.runs === "number" ? inn.away.runs : null);
  }
  return { home, away };
}

/** Canonicalize MLB Stats API status strings to our lifecycle enum. */
export function normalizeMlbStatsStatus(g: MlbStatsRawGame): string {
  const det = g.status?.detailedState ?? "";
  const abs = g.status?.abstractGameState ?? "";
  if (det === "Final" || det === "Game Over" || abs === "Final") return "final";
  if (det === "Postponed") return "postponed";
  if (det === "Cancelled") return "canceled";
  if (det === "Suspended" || det === "Suspended: Rain") return "suspended";
  if (det === "In Progress" || abs === "Live") return "in_progress";
  if (det === "Scheduled" || det === "Pre-Game" || det === "Warmup" || abs === "Preview") return "scheduled";
  return det.toLowerCase();
}

export type LinescoreIngestOptions = {
  date: string;
  apply: boolean;
  supabase: SupabaseClient;
  /** Inject a custom fetcher for tests. */
  fetcher?: typeof fetch;
};

export type LinescoreIngestPerGame = {
  matchup: string;
  game_id: number | null;
  external_id: number | null;
  mlb_game_pk: number;
  mlb_status: string;
  normalized_status: string;
  fi_away: number | null;
  fi_home: number | null;
  fi_total: number | null;
  fi_status: "complete" | "incomplete" | "absent";
  action: "would_update" | "updated" | "noop" | "skipped" | "error";
  reason?: string;
};

export type LinescoreIngestResult = {
  date: string;
  apply: boolean;
  mlbGamesFetched: number;
  perGame: LinescoreIngestPerGame[];
  updatedCount: number;
  pendingCount: number;
  skippedCount: number;
  errorCount: number;
  errors: Array<{ reason: string }>;
};

export type OurGameRow = {
  id: number;
  external_id: number;
  game_date: string | null;
  status: string | null;
  home_team_id: number;
  away_team_id: number;
  first_inning_runs: number | null;
  inning_scores: unknown;
  /** Phase 6B.23 — final-score columns; null until a writer fills them in. */
  home_score: number | null;
  away_score: number | null;
};

const DOUBLEHEADER_START_TIME_MATCH_WINDOW_MS = 90 * 60 * 1000;

function timestampMs(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.length === 0) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function selectOurGameForMlbStatsGame(
  mlb: MlbStatsRawGame,
  candidates: OurGameRow[],
): OurGameRow | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] ?? null;

  const mlbStartMs = timestampMs(mlb.gameDate);
  if (mlbStartMs === null) return null;

  let best: { row: OurGameRow; deltaMs: number } | null = null;
  for (const row of candidates) {
    const ourStartMs = timestampMs(row.game_date);
    if (ourStartMs === null) continue;
    const deltaMs = Math.abs(ourStartMs - mlbStartMs);
    if (best === null || deltaMs < best.deltaMs) {
      best = { row, deltaMs };
    }
  }

  if (best === null) return null;
  return best.deltaMs <= DOUBLEHEADER_START_TIME_MATCH_WINDOW_MS ? best.row : null;
}

/**
 * Pure helper: classify an MLB Stats API raw game against our DB
 * counterpart. Decides what action would happen if applied. Used by
 * both the service main path AND the test harness with fixtures.
 */
export function classifyLinescoreAction(args: {
  mlb: MlbStatsRawGame;
  ours: OurGameRow | null;
  expectedHomeAbbrev: MlbTeamAbbrev | null;
  expectedAwayAbbrev: MlbTeamAbbrev | null;
}): {
  fi: ReturnType<typeof extractFirstInningTotal>;
  normalized_status: string;
  action: LinescoreIngestPerGame["action"];
  reason?: string;
} {
  const { mlb, ours, expectedHomeAbbrev, expectedAwayAbbrev } = args;
  const fi = extractFirstInningTotal(mlb);
  const normalized_status = normalizeMlbStatsStatus(mlb);

  // Wrong-game guard — refuse to write unless both team strings normalize
  // to abbrevs matching our DB game.
  const mlbHomeName = mlb.teams?.home?.team?.name ?? null;
  const mlbAwayName = mlb.teams?.away?.team?.name ?? null;
  const mlbHomeAbbrev = normalizeMlbTeamName(mlbHomeName);
  const mlbAwayAbbrev = normalizeMlbTeamName(mlbAwayName);
  if (mlbHomeAbbrev === null || mlbAwayAbbrev === null) {
    return {
      fi,
      normalized_status,
      action: "skipped",
      reason: `team normalization failed: home="${mlbHomeName}" away="${mlbAwayName}"`,
    };
  }
  if (ours === null) {
    return {
      fi,
      normalized_status,
      action: "skipped",
      reason: "no matching games row",
    };
  }
  if (
    expectedHomeAbbrev !== null &&
    expectedAwayAbbrev !== null &&
    (mlbHomeAbbrev !== expectedHomeAbbrev || mlbAwayAbbrev !== expectedAwayAbbrev)
  ) {
    return {
      fi,
      normalized_status,
      action: "skipped",
      reason: `wrong-game guard: MLB ${mlbAwayAbbrev}@${mlbHomeAbbrev} vs DB ${expectedAwayAbbrev}@${expectedHomeAbbrev}`,
    };
  }

  // Scheduled / not-started games: never write FI runs even when
  // linescore data is somehow present. Per the user spec, scheduled
  // games stay pending; writing 0 from a fixture-style empty linescore
  // would be misleading.
  if (normalized_status === "scheduled") {
    return {
      fi,
      normalized_status,
      action: "skipped",
      reason: "scheduled — do not write FI runs until game starts",
    };
  }

  // FI extraction rules
  if (fi.total === null) {
    if (normalized_status === "postponed" || normalized_status === "canceled") {
      return {
        fi,
        normalized_status,
        action: "skipped",
        reason: `game ${normalized_status} — FI stays pending`,
      };
    }
    if (fi.status === "incomplete") {
      return {
        fi,
        normalized_status,
        action: "skipped",
        reason: "first inning incomplete (top scored, bottom not yet)",
      };
    }
    return {
      fi,
      normalized_status,
      action: "skipped",
      reason:
        normalized_status === "final"
          ? "linescore_missing_first_inning"
          : "no first inning data yet",
    };
  }

  // Phase 6B.23 — even if FI total matches what's already in DB, we
  // still want to write when the game has just finalized and the DB
  // hasn't yet picked up status=STATUS_FINAL + home/away scores from
  // BDL. MLB Stats is authoritative for MLB finals; this unblocks
  // ML / OU grading when BDL is slow.
  const fiNeedsWrite = ours.first_inning_runs !== fi.total;
  const isFinal = normalized_status === "final";
  const finalNeedsWrite =
    isFinal &&
    typeof mlb.teams?.home?.score === "number" &&
    typeof mlb.teams?.away?.score === "number" &&
    (ours.status !== "STATUS_FINAL" ||
      ours.home_score !== mlb.teams.home.score ||
      ours.away_score !== mlb.teams.away.score);
  if (!fiNeedsWrite && !finalNeedsWrite) {
    return { fi, normalized_status, action: "noop" };
  }
  return { fi, normalized_status, action: "would_update" };
}

/**
 * Full ingest flow. Default dry-run.
 */
export async function ingestMlbLinescores(
  opts: LinescoreIngestOptions,
): Promise<LinescoreIngestResult> {
  const { date, apply, supabase } = opts;
  const result: LinescoreIngestResult = {
    date,
    apply,
    mlbGamesFetched: 0,
    perGame: [],
    updatedCount: 0,
    pendingCount: 0,
    skippedCount: 0,
    errorCount: 0,
    errors: [],
  };

  // 1) Fetch MLB schedule with linescores
  let mlbGames: MlbStatsRawGame[];
  try {
    const resp = await fetchMlbStatsSchedule(date, { fetcher: opts.fetcher });
    mlbGames = extractGamesFromSchedule(resp);
    result.mlbGamesFetched = mlbGames.length;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push({ reason: `MLB Stats API fetch failed: ${msg}` });
    result.errorCount = 1;
    return result;
  }
  if (mlbGames.length === 0) return result;

  // 2) Load our games for the slate
  const { data: ourRows, error: ourErr } = await supabase
    .from("games")
    .select(
      "id, external_id, game_date, status, home_team_id, away_team_id, first_inning_runs, inning_scores, home_score, away_score",
    )
    .eq("sport", "mlb")
    .eq("slate_date", date);
  if (ourErr) {
    result.errors.push({ reason: `games fetch failed: ${ourErr.message}` });
    result.errorCount = 1;
    return result;
  }
  const ours = (ourRows ?? []) as OurGameRow[];

  // 3) Load team abbreviations
  const teamIds = Array.from(
    new Set([
      ...ours.map((g) => g.home_team_id),
      ...ours.map((g) => g.away_team_id),
    ]),
  );
  const { data: teamRows } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .in("id", teamIds);
  const abbrevByTeamId = new Map<number, string>(
    ((teamRows ?? []) as Array<{ id: number; abbreviation: string }>).map(
      (t) => [t.id, t.abbreviation],
    ),
  );

  // 4) Build a lookup from (homeAbbrev, awayAbbrev) → our rows. Multiple
  // rows are possible on MLB doubleheaders, so later we select by start time.
  const oursByPair = new Map<string, OurGameRow[]>();
  for (const o of ours) {
    const home = abbrevByTeamId.get(o.home_team_id) ?? null;
    const away = abbrevByTeamId.get(o.away_team_id) ?? null;
    if (home !== null && away !== null) {
      const key = `${home}|${away}`;
      const bucket = oursByPair.get(key) ?? [];
      bucket.push(o);
      oursByPair.set(key, bucket);
    }
  }

  // 5) Walk MLB games; classify; write when apply=true
  for (const mlb of mlbGames) {
    const mlbHomeAbbrev = normalizeMlbTeamName(mlb.teams?.home?.team?.name);
    const mlbAwayAbbrev = normalizeMlbTeamName(mlb.teams?.away?.team?.name);
    const candidateRows =
      mlbHomeAbbrev !== null && mlbAwayAbbrev !== null
        ? oursByPair.get(`${mlbHomeAbbrev}|${mlbAwayAbbrev}`) ?? []
        : [];
    const ourRow =
      mlbHomeAbbrev !== null && mlbAwayAbbrev !== null
        ? selectOurGameForMlbStatsGame(mlb, candidateRows)
        : null;
    if (candidateRows.length > 1 && ourRow === null) {
      result.errors.push({
        reason: `doubleheader match failed for ${mlbAwayAbbrev ?? "?"}@${mlbHomeAbbrev ?? "?"} gameDate=${mlb.gameDate ?? "unknown"}`,
      });
      result.errorCount++;
    }
    const expectedHome = ourRow
      ? (abbrevByTeamId.get(ourRow.home_team_id) as MlbTeamAbbrev | undefined) ?? null
      : null;
    const expectedAway = ourRow
      ? (abbrevByTeamId.get(ourRow.away_team_id) as MlbTeamAbbrev | undefined) ?? null
      : null;
    const cls = classifyLinescoreAction({
      mlb,
      ours: ourRow,
      expectedHomeAbbrev: expectedHome,
      expectedAwayAbbrev: expectedAway,
    });

    const matchup = `${mlbAwayAbbrev ?? "?"}@${mlbHomeAbbrev ?? "?"}`;

    if (cls.action === "skipped" || cls.action === "noop") {
      if (cls.action === "skipped") result.skippedCount++;
      if (cls.fi.total === null) result.pendingCount++;
      result.perGame.push({
        matchup,
        game_id: ourRow?.id ?? null,
        external_id: ourRow?.external_id ?? null,
        mlb_game_pk: mlb.gamePk,
        mlb_status: mlb.status?.detailedState ?? "?",
        normalized_status: cls.normalized_status,
        fi_away: cls.fi.awayRuns,
        fi_home: cls.fi.homeRuns,
        fi_total: cls.fi.total,
        fi_status: cls.fi.status,
        action: cls.action,
        reason: cls.reason,
      });
      continue;
    }

    if (cls.action === "would_update") {
      if (!apply) {
        result.perGame.push({
          matchup,
          game_id: ourRow!.id,
          external_id: ourRow!.external_id,
          mlb_game_pk: mlb.gamePk,
          mlb_status: mlb.status?.detailedState ?? "?",
          normalized_status: cls.normalized_status,
          fi_away: cls.fi.awayRuns,
          fi_home: cls.fi.homeRuns,
          fi_total: cls.fi.total,
          fi_status: cls.fi.status,
          action: "would_update",
        });
        continue;
      }

      const inningScores = buildInningScoresJson(mlb);
      // Phase 6B.23 — when MLB Stats reports the game Final and has
      // both team scores, also write status + home_score + away_score.
      // MLB Stats is the authoritative source for MLB game finals; this
      // unblocks ML / OU grading when the BDL slate provider is slow or
      // unreliable to surface scores (the 2026-06-07 launch incident:
      // BDL flipped status to STATUS_FINAL but never populated the box
      // score, leaving all ML / OU picks pending after the games ended).
      const payload: Record<string, unknown> = {
        first_inning_runs: cls.fi.total,
        inning_scores: inningScores,
      };
      if (cls.normalized_status === "final") {
        const homeScore = typeof mlb.teams?.home?.score === "number" ? mlb.teams.home.score : null;
        const awayScore = typeof mlb.teams?.away?.score === "number" ? mlb.teams.away.score : null;
        if (homeScore !== null && awayScore !== null) {
          payload.status = "STATUS_FINAL";
          payload.home_score = homeScore;
          payload.away_score = awayScore;
          payload.total_runs = homeScore + awayScore;
        }
      }
      const { error: upErr } = await supabase
        .from("games")
        .update(payload)
        .eq("id", ourRow!.id);
      if (upErr) {
        result.errors.push({ reason: `update id=${ourRow!.id}: ${upErr.message}` });
        result.errorCount++;
        result.perGame.push({
          matchup,
          game_id: ourRow!.id,
          external_id: ourRow!.external_id,
          mlb_game_pk: mlb.gamePk,
          mlb_status: mlb.status?.detailedState ?? "?",
          normalized_status: cls.normalized_status,
          fi_away: cls.fi.awayRuns,
          fi_home: cls.fi.homeRuns,
          fi_total: cls.fi.total,
          fi_status: cls.fi.status,
          action: "error",
          reason: upErr.message,
        });
        continue;
      }
      result.updatedCount++;
      result.perGame.push({
        matchup,
        game_id: ourRow!.id,
        external_id: ourRow!.external_id,
        mlb_game_pk: mlb.gamePk,
        mlb_status: mlb.status?.detailedState ?? "?",
        normalized_status: cls.normalized_status,
        fi_away: cls.fi.awayRuns,
        fi_home: cls.fi.homeRuns,
        fi_total: cls.fi.total,
        fi_status: cls.fi.status,
        action: "updated",
      });
    }
  }

  return result;
}
