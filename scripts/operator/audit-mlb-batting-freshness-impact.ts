import { supabase } from "../../lib/db/supabase";
import { getMlbHitterSeasonStats } from "../../lib/providers/real_api/_mlbStatsApiClient";
import { generatePredictionsForSlate } from "../../lib/services/automodelService";
import type { AutoModelOutput, GameSnapshot } from "../../lib/automodel/types";

const date = process.argv.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg))
  ?? new Date().toISOString().slice(0, 10);
const season = Number(date.slice(0, 4));

function grade(row: AutoModelOutput, market: "ml" | "ou" | "fi"): string | null {
  const sportSpecific = row.sport_specific as Record<string, unknown>;
  if (market === "fi") {
    const audit = sportSpecific.fi_v2_audit as Record<string, unknown> | undefined;
    return typeof audit?.play_grade === "string" ? audit.play_grade : null;
  }
  const audit = sportSpecific.v2_2_audit as Record<string, unknown> | undefined;
  const value = market === "ml" ? audit?.ml_play_grade : audit?.ou_play_grade;
  return typeof value === "string" ? value : null;
}

function actionable(value: string | null): boolean {
  return value === "best_angle" || value === "lean";
}

function gradeCounts(rows: AutoModelOutput[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    for (const market of ["ml", "ou", "fi"] as const) {
      const value = grade(row, market) ?? "ungraded";
      const key = `${market}:${value}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

async function main(): Promise<void> {
  const providerRows = await getMlbHitterSeasonStats(season, { quiet: true });
  if (!providerRows?.length) throw new Error("MLB hitter bulk response was empty");

  const { data: games, error: gamesError } = await supabase
    .from("games")
    .select("home_team_id, away_team_id")
    .eq("sport", "mlb")
    .eq("slate_date", date);
  if (gamesError) throw new Error(gamesError.message);
  const teamIds = Array.from(new Set(
    (games ?? []).flatMap((game) => [game.home_team_id, game.away_team_id])
      .filter((id): id is number => typeof id === "number"),
  ));
  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("id, external_id")
    .in("id", teamIds);
  if (teamsError) throw new Error(teamsError.message);
  const externalByInternal = new Map(
    (teams ?? []).map((team) => [team.id as number, team.external_id as number]),
  );
  const { data: players, error: playersError } = await supabase
    .from("players")
    .select("id, team_id, mlb_person_id, provider_ids")
    .in("team_id", teamIds)
    .eq("active", true)
    .eq("is_pitcher", false);
  if (playersError) throw new Error(playersError.message);

  const providerById = new Map(providerRows.map((row) => [row.mlb_person_id, row]));
  const aggregates = new Map<number, { weighted: number; pa: number }>();
  for (const player of players ?? []) {
    const providerIds = player.provider_ids as Record<string, unknown> | null;
    const mlbValue = providerIds?.mlb_stats;
    const providerId = typeof mlbValue === "object" && mlbValue !== null
      ? Number((mlbValue as { id?: unknown }).id)
      : NaN;
    const mlbId = Number.isSafeInteger(providerId)
      ? providerId
      : Number(player.mlb_person_id);
    const stat = providerById.get(mlbId);
    const teamExternalId = externalByInternal.get(player.team_id as number);
    if (!stat || teamExternalId === undefined || stat.ops === null || stat.plate_appearances === null || stat.plate_appearances < 100) continue;
    const aggregate = aggregates.get(teamExternalId) ?? { weighted: 0, pa: 0 };
    aggregate.weighted += stat.ops * stat.plate_appearances;
    aggregate.pa += stat.plate_appearances;
    aggregates.set(teamExternalId, aggregate);
  }

  const transform = (snapshots: GameSnapshot[]): GameSnapshot[] => snapshots.map((snapshot) => {
    const home = aggregates.get(snapshot.home_team.team_external_id);
    const away = aggregates.get(snapshot.away_team.team_external_id);
    return {
      ...snapshot,
      home_team: {
        ...snapshot.home_team,
        team_avg_batter_ops: home?.pa ? home.weighted / home.pa : snapshot.home_team.team_avg_batter_ops,
        team_avg_batter_ops_sample: home?.pa ?? snapshot.home_team.team_avg_batter_ops_sample,
      },
      away_team: {
        ...snapshot.away_team,
        team_avg_batter_ops: away?.pa ? away.weighted / away.pa : snapshot.away_team.team_avg_batter_ops,
        team_avg_batter_ops_sample: away?.pa ?? snapshot.away_team.team_avg_batter_ops_sample,
      },
    };
  });

  const [baseline, refreshed] = await Promise.all([
    generatePredictionsForSlate("mlb", date, "morning_draft", {
      writeToDb: false,
      respectLocks: false,
    }),
    generatePredictionsForSlate("mlb", date, "morning_draft", {
      writeToDb: false,
      respectLocks: false,
      auditSnapshotTransform: transform,
    }),
  ]);
  const refreshedByGame = new Map(refreshed.predictions.map((row) => [row.game_external_id, row]));
  let promotions = 0;
  let demotions = 0;
  const changes = baseline.predictions.flatMap((before) => {
    const after = refreshedByGame.get(before.game_external_id);
    if (!after) return [];
    for (const market of ["ml", "ou", "fi"] as const) {
      const beforeActionable = actionable(grade(before, market));
      const afterActionable = actionable(grade(after, market));
      if (!beforeActionable && afterActionable) promotions++;
      if (beforeActionable && !afterActionable) demotions++;
    }
    const changed =
      before.predicted_ml_winner !== after.predicted_ml_winner ||
      before.predicted_ou_side !== after.predicted_ou_side ||
      before.predicted_nrfi !== after.predicted_nrfi ||
      grade(before, "ml") !== grade(after, "ml") ||
      grade(before, "ou") !== grade(after, "ou") ||
      grade(before, "fi") !== grade(after, "fi");
    if (!changed) return [];
    return [{
      game_external_id: before.game_external_id,
      ml: { before: before.predicted_ml_winner, after: after.predicted_ml_winner, gradeBefore: grade(before, "ml"), gradeAfter: grade(after, "ml") },
      total: { before: before.predicted_ou_side, after: after.predicted_ou_side, gradeBefore: grade(before, "ou"), gradeAfter: grade(after, "ou") },
      first_inning: { before: before.predicted_nrfi, after: after.predicted_nrfi, gradeBefore: grade(before, "fi"), gradeAfter: grade(after, "fi") },
    }];
  });
  console.log(JSON.stringify({
    mode: "mlb_batting_freshness_old_vs_new",
    date,
    providerRows: providerRows.length,
    teamsWithFreshAggregate: aggregates.size,
    baselineGames: baseline.game_count,
    refreshedGames: refreshed.game_count,
    baselineGradeCounts: gradeCounts(baseline.predictions),
    refreshedGradeCounts: gradeCounts(refreshed.predictions),
    promotions,
    demotions,
    actionableNet: promotions - demotions,
    decisionChanges: changes.length,
    changes,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
