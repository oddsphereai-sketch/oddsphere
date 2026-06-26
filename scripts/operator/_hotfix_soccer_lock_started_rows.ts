/**
 * One-time safety hotfix for World Cup soccer rows that were written before
 * T-60 but never received locked_at because the next writer run happened after
 * kickoff and skipped preservation. This script only stamps locked_at on
 * already-started, currently-unlocked soccer prediction_records.
 *
 * Dry run:
 *   npx tsx --env-file=.env.local scripts/operator/_hotfix_soccer_lock_started_rows.ts
 *
 * Apply:
 *   npx tsx --env-file=.env.local scripts/operator/_hotfix_soccer_lock_started_rows.ts --write
 */

import { writeFileSync } from "node:fs";
import { supabase } from "../../lib/db/supabase";

const SOCCER_MODEL_VERSION = "soccer_dixon_coles_v1";
const START_SLATE_DATE = "2026-06-14";
const LOCK_WINDOW_MINUTES = 60;

type GameRow = {
  id: number;
  external_id: number;
  game_date: string;
  slate_date: string;
  status: string | null;
  home_team_id: number | null;
  away_team_id: number | null;
};

type PredictionRow = {
  id: number;
  game_id: number;
  sport: string;
  market: string;
  pick: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  confidence: number | null;
  model_probability: number | null;
  play_grade: string | null;
  locked_at: string | null;
  published_at: string | null;
  model_version: string | null;
  slate_date: string;
  snapshot_json: unknown;
};

function scheduledLockAt(gameDateIso: string): string {
  const kickoff = new Date(gameDateIso).getTime();
  return new Date(kickoff - LOCK_WINDOW_MINUTES * 60 * 1000).toISOString();
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const nowIso = new Date().toISOString();

  const { data: gamesData, error: gamesError } = await supabase
    .from("games")
    .select("id, external_id, game_date, slate_date, status, home_team_id, away_team_id")
    .eq("sport", "soccer")
    .gte("slate_date", START_SLATE_DATE)
    .lte("game_date", nowIso)
    .order("game_date", { ascending: true });

  if (gamesError !== null) throw new Error(`load soccer games: ${gamesError.message}`);
  const games = (gamesData ?? []) as GameRow[];
  const gameById = new Map(games.map((g) => [g.id, g]));
  const gameIds = games.map((g) => g.id);

  let rows: PredictionRow[] = [];
  if (gameIds.length > 0) {
    const { data: rowsData, error: rowsError } = await supabase
      .from("prediction_records")
      .select(
        "id, game_id, sport, market, pick, side, line_value, odds_american, confidence, model_probability, play_grade, locked_at, published_at, model_version, slate_date, snapshot_json",
      )
      .eq("sport", "soccer")
      .eq("model_version", SOCCER_MODEL_VERSION)
      .is("locked_at", null)
      .in("game_id", gameIds)
      .order("game_id", { ascending: true })
      .order("market", { ascending: true });

    if (rowsError !== null) throw new Error(`load prediction_records: ${rowsError.message}`);
    rows = (rowsData ?? []) as PredictionRow[];
  }

  const backup = rows.map((row) => ({
    game: gameById.get(row.game_id) ?? null,
    prediction_record: row,
    intended_locked_at: scheduledLockAt(gameById.get(row.game_id)?.game_date ?? nowIso),
  }));

  const backupPath = `/private/tmp/oddsphere-soccer-unlocked-started-backup-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.json`;
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));

  const byGame = new Map<number, PredictionRow[]>();
  for (const row of rows) {
    const bucket = byGame.get(row.game_id) ?? [];
    bucket.push(row);
    byGame.set(row.game_id, bucket);
  }

  const updates: Array<{ game_id: number; locked_at: string; rows: number }> = [];
  if (write) {
    for (const [gameId, gameRows] of byGame.entries()) {
      const game = gameById.get(gameId);
      if (game === undefined) continue;
      const lockAt = scheduledLockAt(game.game_date);
      const { error: updateError } = await supabase
        .from("prediction_records")
        .update({ locked_at: lockAt })
        .eq("sport", "soccer")
        .eq("model_version", SOCCER_MODEL_VERSION)
        .eq("game_id", gameId)
        .is("locked_at", null);
      if (updateError !== null) {
        throw new Error(`update game_id=${gameId}: ${updateError.message}`);
      }
      updates.push({ game_id: gameId, locked_at: lockAt, rows: gameRows.length });
    }
  }

  let remainingUnlocked = rows.length;
  if (write && gameIds.length > 0) {
    const { count, error: countError } = await supabase
      .from("prediction_records")
      .select("id", { count: "exact", head: true })
      .eq("sport", "soccer")
      .eq("model_version", SOCCER_MODEL_VERSION)
      .is("locked_at", null)
      .in("game_id", gameIds);
    if (countError !== null) throw new Error(`count remaining unlocked: ${countError.message}`);
    remainingUnlocked = count ?? 0;
  }

  console.log(
    JSON.stringify(
      {
        mode: write ? "write" : "dry-run",
        now: nowIso,
        started_games: games.length,
        affected_games: byGame.size,
        affected_rows: rows.length,
        backup_path: backupPath,
        backup_rows: backup.length,
        updates,
        remaining_started_unlocked_rows: remainingUnlocked,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
