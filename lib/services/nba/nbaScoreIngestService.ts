/**
 * Phase 7H — NBA final-score ingest.
 *
 * Mirrors `scoreIngestService.ingestFinalScores` (MLB) for NBA but
 * pulls from ESPN's public scoreboard rather than BDL, since the
 * shared BDL slate provider's URL is MLB-only and the existing NBA
 * data pipeline already relies on the ESPN client for scheduling +
 * scores (see `_espnNbaScoreboardClient` and the seed-nba-finals.ts
 * operator script).
 *
 * Updates `games.{status, home_score, away_score}` for the slate's
 * NBA games. NEVER modifies predictions / locked_at / slate_status.
 *
 * Idempotent: re-running on a final game is a no-op (compares
 * provider state to DB before writing).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchNbaScoreboard } from "../../providers/real_api/_espnNbaScoreboardClient";

export type NbaScoreIngestResult = {
  slateDate: string;
  apply: boolean;
  gamesScanned: number;
  finalCount: number;
  inProgressCount: number;
  scheduledCount: number;
  voidCount: number;
  updatedCount: number;
  perGame: Array<{
    external_id: number;
    matchup: string;
    before_status: string | null;
    after_status: string | null;
    home_score: number | null;
    away_score: number | null;
    action: "updated" | "noop" | "skipped" | "error";
    reason?: string;
  }>;
  errors: Array<{ external_id?: number; reason: string }>;
};

type DbGameRow = {
  id: number;
  external_id: number;
  status: string | null;
  home_score: number | null;
  away_score: number | null;
  home_team_id: number;
  away_team_id: number;
};

// ESPN → games.status normalizer. The grader treats status="final" and
// "STATUS_FINAL" identically (see predictionGrader.isFinalStatus), so
// preserving ESPN's STATUS_FINAL is safe here.
function normalizeStatus(espn: string | null): string | null {
  if (espn === null) return null;
  return espn.toUpperCase();
}

function classify(status: string | null): "final" | "live" | "scheduled" | "void" | "other" {
  if (status === null) return "other";
  const u = status.toUpperCase();
  if (u === "STATUS_FINAL" || u === "FINAL") return "final";
  if (u === "STATUS_IN_PROGRESS" || u === "STATUS_HALFTIME" || u === "LIVE") return "live";
  if (u === "STATUS_SCHEDULED" || u === "SCHEDULED") return "scheduled";
  if (u === "STATUS_POSTPONED" || u === "POSTPONED" || u === "CANCELED" || u === "CANCELLED") return "void";
  return "other";
}

/**
 * Pull ESPN scoreboard for `slateDate` (ET) and update each matching
 * NBA game row in `games`. Calling shape matches the MLB
 * `ingestFinalScores` return so trackingRefreshService can consume it
 * the same way.
 */
export async function ingestNbaFinalScores(args: {
  slateDate: string;
  apply: boolean;
  supabase: SupabaseClient;
}): Promise<NbaScoreIngestResult> {
  const { slateDate, apply, supabase } = args;
  const result: NbaScoreIngestResult = {
    slateDate,
    apply,
    gamesScanned: 0,
    finalCount: 0,
    inProgressCount: 0,
    scheduledCount: 0,
    voidCount: 0,
    updatedCount: 0,
    perGame: [],
    errors: [],
  };

  const { data: gameRows, error: gErr } = await supabase
    .from("games")
    .select("id, external_id, status, home_score, away_score, home_team_id, away_team_id")
    .eq("sport", "nba")
    .eq("slate_date", slateDate);
  if (gErr) {
    result.errors.push({ reason: `games fetch failed: ${gErr.message}` });
    return result;
  }
  const games = (gameRows ?? []) as DbGameRow[];
  result.gamesScanned = games.length;
  if (games.length === 0) return result;

  const teamIds = Array.from(
    new Set([...games.map((g) => g.home_team_id), ...games.map((g) => g.away_team_id)]),
  );
  const { data: teamRows } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .in("id", teamIds);
  const abbrev = new Map<number, string>(
    ((teamRows ?? []) as Array<{ id: number; abbreviation: string }>).map((t) => [t.id, t.abbreviation]),
  );

  // ESPN scoreboard takes YYYYMMDD with no separators.
  const espnDate = slateDate.replace(/-/g, "");
  let events: Awaited<ReturnType<typeof fetchNbaScoreboard>> = [];
  try {
    events = await fetchNbaScoreboard({ dateYYYYMMDD: espnDate });
  } catch (e) {
    result.errors.push({
      reason: `espn scoreboard fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    });
    return result;
  }

  const byExternalId = new Map<number, (typeof events)[number]>();
  for (const ev of events) {
    const ext = Number.parseInt(ev.espn_event_id, 10);
    if (Number.isFinite(ext)) byExternalId.set(ext, ev);
  }

  for (const g of games) {
    const matchup = `${abbrev.get(g.away_team_id) ?? "?"}@${abbrev.get(g.home_team_id) ?? "?"}`;
    const ev = byExternalId.get(g.external_id);
    if (ev === undefined) {
      result.perGame.push({
        external_id: g.external_id,
        matchup,
        before_status: g.status,
        after_status: g.status,
        home_score: g.home_score,
        away_score: g.away_score,
        action: "skipped",
        reason: "no espn event for game",
      });
      continue;
    }

    const cls = classify(ev.status);
    if (cls === "final") result.finalCount++;
    else if (cls === "live") result.inProgressCount++;
    else if (cls === "scheduled") result.scheduledCount++;
    else if (cls === "void") result.voidCount++;

    // Preserve non-null DB scores when provider transiently nulls them
    // (same guard as MLB scoreIngestService).
    const nextHomeScore = ev.home.score !== null ? ev.home.score : g.home_score;
    const nextAwayScore = ev.away.score !== null ? ev.away.score : g.away_score;
    const nextStatus = normalizeStatus(ev.status);

    const changed =
      g.status !== nextStatus ||
      g.home_score !== nextHomeScore ||
      g.away_score !== nextAwayScore;
    if (!changed) {
      result.perGame.push({
        external_id: g.external_id,
        matchup,
        before_status: g.status,
        after_status: g.status,
        home_score: g.home_score,
        away_score: g.away_score,
        action: "noop",
      });
      continue;
    }
    if (!apply) {
      result.perGame.push({
        external_id: g.external_id,
        matchup,
        before_status: g.status,
        after_status: nextStatus,
        home_score: nextHomeScore,
        away_score: nextAwayScore,
        action: "updated",
        reason: "dry-run (would update)",
      });
      continue;
    }
    const { error: upErr } = await supabase
      .from("games")
      .update({
        status: nextStatus,
        home_score: nextHomeScore,
        away_score: nextAwayScore,
      })
      .eq("id", g.id);
    if (upErr) {
      result.errors.push({ external_id: g.external_id, reason: upErr.message });
      result.perGame.push({
        external_id: g.external_id,
        matchup,
        before_status: g.status,
        after_status: g.status,
        home_score: g.home_score,
        away_score: g.away_score,
        action: "error",
        reason: upErr.message,
      });
      continue;
    }
    result.updatedCount++;
    result.perGame.push({
      external_id: g.external_id,
      matchup,
      before_status: g.status,
      after_status: nextStatus,
      home_score: nextHomeScore,
      away_score: nextAwayScore,
      action: "updated",
    });
  }

  return result;
}
