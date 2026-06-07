/**
 * Push 4 — Final-score ingest service.
 *
 * Pulls authoritative final scores from BDL (the existing slate
 * provider) for completed games. Updates games.status + home_score
 * + away_score. NEVER modifies predictions / locked_at / slate_status.
 *
 * First-inning scores: BDL's primary `/games` endpoint does NOT
 * include inning-by-inning splits in the V1 contract our slate
 * provider uses. For V1, FI grades stay pending until an operator
 * manually enters them via `manual-grade-slate.ts`. The architecture
 * supports automatic FI ingest as soon as a per-inning provider
 * lands (placeholder field `first_inning_runs` on `games` is NOT
 * added in v17 because we don't have a populator; manual grades
 * carry the value through the grader inputs directly).
 *
 * Idempotent: re-running on a final game is a no-op. Postponed /
 * canceled statuses surface so the grader can void affected
 * predictions.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSlateProvider } from "../providers/factory";
import type { Sport } from "../types/domain/Sport";

export type ScoreIngestResult = {
  sport: Sport;
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

type GameRow = {
  id: number;
  external_id: number;
  status: string | null;
  home_score: number | null;
  away_score: number | null;
  home_team_id: number;
  away_team_id: number;
};

function classify(status: string | null): "final" | "live" | "scheduled" | "void" | "other" {
  if (status === null) return "other";
  const u = status.toUpperCase();
  if (u === "FINAL" || u === "STATUS_FINAL" || u.includes("FINAL_OT") || u.includes("FINAL_PEN")) return "final";
  if (u.includes("IN_PROGRESS") || u === "LIVE" || u === "STATUS_HALFTIME") return "live";
  if (u === "SCHEDULED" || u === "STATUS_SCHEDULED") return "scheduled";
  if (u === "POSTPONED" || u === "CANCELED" || u === "CANCELLED") return "void";
  return "other";
}

/**
 * Fetch the latest provider snapshot for a slate and update the
 * games table where any field has changed.
 */
export async function ingestFinalScores(args: {
  sport: Sport;
  slateDate: string;
  apply: boolean;
  supabase: SupabaseClient;
}): Promise<ScoreIngestResult> {
  const { sport, slateDate, apply, supabase } = args;
  const result: ScoreIngestResult = {
    sport,
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

  // 1) Load games for slate
  const { data: gameRows, error: gErr } = await supabase
    .from("games")
    .select("id, external_id, status, home_score, away_score, home_team_id, away_team_id")
    .eq("sport", sport)
    .eq("slate_date", slateDate);
  if (gErr) {
    result.errors.push({ reason: `games fetch failed: ${gErr.message}` });
    return result;
  }
  const games = (gameRows ?? []) as GameRow[];
  result.gamesScanned = games.length;
  if (games.length === 0) return result;

  // 2) Team abbreviations for display
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

  // 3) Hit provider for the same slate
  let providerGames: Array<{
    external_id: number;
    status: string | null;
    home_score: number | null;
    away_score: number | null;
  }> = [];
  try {
    const provider = getSlateProvider();
    const providerSnapshot = await provider.getGames(slateDate, sport);
    providerGames = providerSnapshot.map((pg) => ({
      external_id: pg.external_id,
      status: pg.status ?? null,
      home_score: pg.home_score ?? null,
      away_score: pg.away_score ?? null,
    }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result.errors.push({ reason: `provider fetch failed: ${msg}` });
    return result;
  }

  const byExternalId = new Map<number, (typeof providerGames)[number]>(
    providerGames.map((p) => [p.external_id, p]),
  );

  // 4) For each DB game, compare provider vs DB and write delta
  for (const g of games) {
    const matchup = `${abbrev.get(g.away_team_id) ?? "?"}@${abbrev.get(g.home_team_id) ?? "?"}`;
    const provider = byExternalId.get(g.external_id);
    if (provider === undefined) {
      result.perGame.push({
        external_id: g.external_id,
        matchup,
        before_status: g.status,
        after_status: g.status,
        home_score: g.home_score,
        away_score: g.away_score,
        action: "skipped",
        reason: "no provider row",
      });
      continue;
    }
    const cls = classify(provider.status);
    if (cls === "final") result.finalCount++;
    else if (cls === "live") result.inProgressCount++;
    else if (cls === "scheduled") result.scheduledCount++;
    else if (cls === "void") result.voidCount++;

    // Phase 6B.26 — Preserve non-null DB scores when BDL returns null.
    // 6B.23 made MLB Stats authoritative for final scores; without this
    // guard, the next BDL ingest pass overwrites those scores back to
    // null whenever BDL doesn't yet have the box score. The result was
    // an oscillation: MLB Stats fills scores → BDL clears them → ML/OU
    // grades flip back to pending. Rule: NEVER let a non-null DB value
    // get clobbered by a null provider value. We accept provider values
    // that are non-null OR introduce new data (DB was null before).
    const nextHomeScore = provider.home_score !== null ? provider.home_score : g.home_score;
    const nextAwayScore = provider.away_score !== null ? provider.away_score : g.away_score;
    // Status stays provider-driven (BDL is fine for status; MLB Stats
    // also writes "STATUS_FINAL" via the 6B.23 path, so values agree).
    const nextStatus = provider.status;

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
