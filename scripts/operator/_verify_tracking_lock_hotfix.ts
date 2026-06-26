import { supabase } from "../../lib/db/supabase";

type AnyRow = Record<string, any>;

async function loadTeams(ids: number[]): Promise<Map<number, AnyRow>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from("teams")
    .select("id, abbreviation, display_name")
    .in("id", ids);
  if (error !== null) throw new Error(`load teams: ${error.message}`);
  return new Map(((data ?? []) as AnyRow[]).map((t) => [Number(t.id), t]));
}

async function verifyWnbaLaTor(): Promise<unknown> {
  const { data: games, error: gamesError } = await supabase
    .from("games")
    .select("id, external_id, status, game_date, slate_date, home_team_id, away_team_id, home_score, away_score")
    .eq("sport", "wnba")
    .eq("slate_date", "2026-06-25")
    .order("game_date", { ascending: true });
  if (gamesError !== null) throw new Error(`load wnba games: ${gamesError.message}`);
  const teamIds = new Set<number>();
  for (const g of (games ?? []) as AnyRow[]) {
    if (g.home_team_id !== null) teamIds.add(Number(g.home_team_id));
    if (g.away_team_id !== null) teamIds.add(Number(g.away_team_id));
  }
  const teams = await loadTeams([...teamIds]);
  const target = ((games ?? []) as AnyRow[]).find((g) => {
    const home = teams.get(Number(g.home_team_id))?.abbreviation;
    const away = teams.get(Number(g.away_team_id))?.abbreviation;
    return home === "TOR" && away === "LA";
  });
  if (target === undefined) return { found: false };

  const { data: records, error: recordsError } = await supabase
    .from("prediction_records")
    .select("id, market, pick, side, line_value, odds_american, confidence, model_probability, market_probability, edge, play_grade, best_angle, locked_at, published_at, no_bet, prediction_grades(result, actual_home_score, actual_away_score, actual_total, grade_notes)")
    .eq("sport", "wnba")
    .eq("game_id", target.id)
    .order("market", { ascending: true });
  if (recordsError !== null) throw new Error(`load wnba records: ${recordsError.message}`);
  return {
    found: true,
    game: {
      id: target.id,
      matchup: `${teams.get(Number(target.away_team_id))?.abbreviation}@${teams.get(Number(target.home_team_id))?.abbreviation}`,
      status: target.status,
      start: target.game_date,
      score: `${target.away_score}-${target.home_score}`,
    },
    records: (records ?? []).map((r: AnyRow) => ({
      id: r.id,
      market: r.market,
      pick: r.pick,
      side: r.side,
      line: r.line_value,
      price: r.odds_american,
      confidence: r.confidence,
      probability: r.model_probability,
      market_probability: r.market_probability,
      edge: r.edge,
      grade: r.play_grade,
      best_angle: r.best_angle === true,
      locked_at: r.locked_at,
      published_at: r.published_at,
      no_bet: r.no_bet,
      result: Array.isArray(r.prediction_grades)
        ? r.prediction_grades[0]?.result ?? null
        : r.prediction_grades?.result ?? null,
      actual: Array.isArray(r.prediction_grades)
        ? {
            away: r.prediction_grades[0]?.actual_away_score ?? null,
            home: r.prediction_grades[0]?.actual_home_score ?? null,
            total: r.prediction_grades[0]?.actual_total ?? null,
          }
        : {
            away: r.prediction_grades?.actual_away_score ?? null,
            home: r.prediction_grades?.actual_home_score ?? null,
            total: r.prediction_grades?.actual_total ?? null,
          },
      grade_notes: Array.isArray(r.prediction_grades)
        ? r.prediction_grades[0]?.grade_notes ?? null
        : r.prediction_grades?.grade_notes ?? null,
    })),
  };
}

async function verifyMlbFirstInning(): Promise<unknown> {
  const slates = ["2026-06-25", "2026-06-26"];
  const { data: records, error: recordsError } = await supabase
    .from("prediction_records")
    .select("id, game_id, slate_date, market, pick, side, line_value, locked_at, prediction_grades(result, actual_first_inning_runs)")
    .eq("sport", "mlb")
    .eq("market", "first_inning")
    .in("slate_date", slates);
  if (recordsError !== null) throw new Error(`load mlb fi records: ${recordsError.message}`);
  const rows = (records ?? []) as AnyRow[];
  const gameIds = [...new Set(rows.map((r) => Number(r.game_id)))];
  const { data: games, error: gamesError } = await supabase
    .from("games")
    .select("id, status, game_date, slate_date, first_inning_runs, home_score, away_score")
    .in("id", gameIds);
  if (gamesError !== null) throw new Error(`load mlb games: ${gamesError.message}`);
  const gameById = new Map(((games ?? []) as AnyRow[]).map((g) => [Number(g.id), g]));
  const settled = rows.filter((r) => gameById.get(Number(r.game_id))?.first_inning_runs !== null);
  const missing = settled.filter((r) => {
    const grade = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades;
    return grade === null || grade === undefined || grade.result === null || grade.result === "pending";
  });
  return {
    slates,
    fi_records: rows.length,
    games_with_fi_runs: settled.length,
    missing_or_pending_fi_grades: missing.length,
    missing_examples: missing.slice(0, 5).map((r) => ({
      record_id: r.id,
      game_id: r.game_id,
      slate_date: r.slate_date,
      pick: r.pick,
      first_inning_runs: gameById.get(Number(r.game_id))?.first_inning_runs ?? null,
      grade: Array.isArray(r.prediction_grades)
        ? r.prediction_grades[0]?.result ?? null
        : r.prediction_grades?.result ?? null,
    })),
  };
}

async function verifySoccerLocks(): Promise<unknown> {
  const nowIso = new Date().toISOString();
  const { data: games, error: gamesError } = await supabase
    .from("games")
    .select("id, game_date, slate_date")
    .eq("sport", "soccer")
    .gte("slate_date", "2026-06-14")
    .lte("game_date", nowIso);
  if (gamesError !== null) throw new Error(`load soccer games: ${gamesError.message}`);
  const gameIds = ((games ?? []) as AnyRow[]).map((g) => Number(g.id));
  const { count, error: countError } = await supabase
    .from("prediction_records")
    .select("id", { count: "exact", head: true })
    .eq("sport", "soccer")
    .eq("model_version", "soccer_dixon_coles_v1")
    .is("locked_at", null)
    .in("game_id", gameIds);
  if (countError !== null) throw new Error(`count soccer unlocked: ${countError.message}`);
  return {
    started_soccer_games_since_tracking_start: gameIds.length,
    started_soccer_prediction_rows_still_unlocked: count ?? 0,
  };
}

async function verifyLeases(): Promise<unknown> {
  const { data, error } = await supabase
    .from("cron_job_leases")
    .select("job_name, run_id, lease_expires_at, acquired_at, heartbeat_at")
    .gt("lease_expires_at", new Date().toISOString())
    .order("lease_expires_at", { ascending: false })
    .limit(20);
  if (error !== null) return { available: false, error: error.message };
  return {
    active_unexpired_leases: (data ?? []).length,
    leases: (data ?? []).map((l: AnyRow) => ({
      job_name: l.job_name,
      run_id: l.run_id,
      lease_expires_at: l.lease_expires_at,
      acquired_at: l.acquired_at,
      heartbeat_at: l.heartbeat_at,
    })),
  };
}

async function main(): Promise<void> {
  console.log(
    JSON.stringify(
      {
        verified_at: new Date().toISOString(),
        wnba_la_tor: await verifyWnbaLaTor(),
        mlb_first_inning: await verifyMlbFirstInning(),
        soccer_world_cup_locks: await verifySoccerLocks(),
        cron_leases: await verifyLeases(),
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
