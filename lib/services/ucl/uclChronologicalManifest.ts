import { createHash } from "node:crypto";
import type { BdlUclMatch, BdlUclTeamMatchStats, UclHistoryFetchTelemetry } from "@/lib/providers/real_api/BallDontLieUclProvider";
import { regulationScore } from "./uclCompetitionContext";

export const UCL_CHRONOLOGICAL_MANIFEST = {
  release: "ucl_history_manifest_2026_09_03_r1",
  trainSeason: 2024,
  confirmationSeason: 2025,
  train: 185,
  calibration: 126,
  holdout: 63,
  cutoff: "2026-01-28T20:00:00.000Z",
  sha256: "00d3761b7d94851776ffb5b893bdaded8dec85657f769140a2aef0dacd306d36",
  providerRows: 378,
  providerRowsBySeason: { "2024": 189, "2025": 189 },
  statsRows: 754,
  statsSha256: "3b817b9aa164ebc5141c26dddf9194611735d98708deef2b5b7f16df91314f88",
} as const;

export function regulationFinalUclRows(matches: BdlUclMatch[]): BdlUclMatch[] {
  return matches
    .filter((match) => match.status_state === "final" && regulationScore(match).score !== null)
    .sort((left, right) => Date.parse(left.date) - Date.parse(right.date) || left.id - right.id);
}

/** Hash every cohort-defining and score-bearing field, not just the row count,
 * so a provider backfill/correction cannot silently redefine the frozen audit. */
export function uclHistoricalMatchManifestDigest(matches: BdlUclMatch[]): string {
  const canonical = regulationFinalUclRows(matches).map((match) => {
    const score = regulationScore(match).score!;
    return [match.id, match.season, match.date, match.home_team_id, match.away_team_id, score.home, score.away].join(":");
  }).join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

export function assertFrozenUclChronologicalManifest(matches: BdlUclMatch[]): void {
  const rows = regulationFinalUclRows(matches);
  const train = rows.filter((match) => match.season === UCL_CHRONOLOGICAL_MANIFEST.trainSeason);
  const confirmation = rows.filter((match) => match.season === UCL_CHRONOLOGICAL_MANIFEST.confirmationSeason);
  const calibration = confirmation.filter((match) => match.date < UCL_CHRONOLOGICAL_MANIFEST.cutoff);
  const holdout = confirmation.filter((match) => match.date >= UCL_CHRONOLOGICAL_MANIFEST.cutoff);
  const digest = uclHistoricalMatchManifestDigest(matches);
  if (
    train.length !== UCL_CHRONOLOGICAL_MANIFEST.train
    || calibration.length !== UCL_CHRONOLOGICAL_MANIFEST.calibration
    || holdout.length !== UCL_CHRONOLOGICAL_MANIFEST.holdout
    || digest !== UCL_CHRONOLOGICAL_MANIFEST.sha256
  ) {
    throw new Error(
      `UCL frozen chronological manifest mismatch: train=${train.length} calibration=${calibration.length} holdout=${holdout.length} cutoff=${UCL_CHRONOLOGICAL_MANIFEST.cutoff} sha256=${digest}`,
    );
  }
}

const STAT_FIELDS = [
  "match_id", "team_id", "possession_pct", "shots", "shots_on_target",
  "expected_goals", "big_chances", "red_cards", "corners", "passes",
  "pass_accuracy_pct", "big_chances_missed", "shots_inside_box",
  "shots_outside_box", "tackles", "interceptions", "clearances",
] as const satisfies ReadonlyArray<keyof BdlUclTeamMatchStats>;

/** Reject orphaned, misattributed, or duplicate stats before they can become
 * xG-weighted model inputs. */
export function assertUclHistoricalStatsIdentity(matches: BdlUclMatch[], stats: BdlUclTeamMatchStats[]): void {
  const matchesById = new Map(matches.map((match) => [match.id, match]));
  const seen = new Set<string>();
  for (const row of stats) {
    const match = matchesById.get(row.match_id);
    if (!match) throw new Error(`UCL team-stat row references unknown match ${row.match_id}`);
    if (row.team_id !== match.home_team_id && row.team_id !== match.away_team_id) {
      throw new Error(`UCL team-stat row ${row.match_id}:${row.team_id} does not belong to either fixture team`);
    }
    const key = `${row.match_id}:${row.team_id}`;
    if (seen.has(key)) throw new Error(`UCL team-stat duplicate identity ${key}`);
    seen.add(key);
  }
}

export function uclHistoricalStatsManifestDigest(stats: BdlUclTeamMatchStats[]): string {
  const canonical = [...stats]
    .sort((left, right) => left.match_id - right.match_id || left.team_id - right.team_id)
    .map((row) => STAT_FIELDS.map((field) => row[field] ?? null).join(":"))
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

export function assertFrozenUclHistoricalStats(matches: BdlUclMatch[], stats: BdlUclTeamMatchStats[]): void {
  assertUclHistoricalStatsIdentity(matches, stats);
  const digest = uclHistoricalStatsManifestDigest(stats);
  if (stats.length !== UCL_CHRONOLOGICAL_MANIFEST.statsRows || digest !== UCL_CHRONOLOGICAL_MANIFEST.statsSha256) {
    throw new Error(`UCL frozen team-stat manifest mismatch: rows=${stats.length} sha256=${digest}`);
  }
}

export function assertFrozenUclHistoryTelemetry(telemetry: UclHistoryFetchTelemetry): void {
  const expected = UCL_CHRONOLOGICAL_MANIFEST.providerRowsBySeason;
  if (
    telemetry.status !== "ready"
    || telemetry.strategy !== "singular_season_provider_deviation"
    || telemetry.requestedSeasons.join(",") !== "2024,2025"
    || telemetry.rows !== UCL_CHRONOLOGICAL_MANIFEST.providerRows
    || telemetry.rowsBySeason["2024"] !== expected["2024"]
    || telemetry.rowsBySeason["2025"] !== expected["2025"]
    || Object.keys(telemetry.rowsBySeason).sort().join(",") !== "2024,2025"
    || !telemetry.providerContractDeviation.trim()
  ) {
    throw new Error("UCL frozen provider-history telemetry mismatch");
  }
}

export function assertFrozenUclHistoricalInputs(input: {
  matches: BdlUclMatch[];
  stats: BdlUclTeamMatchStats[];
  telemetry?: UclHistoryFetchTelemetry;
}): void {
  assertFrozenUclChronologicalManifest(input.matches);
  assertFrozenUclHistoricalStats(input.matches, input.stats);
  if (input.telemetry) assertFrozenUclHistoryTelemetry(input.telemetry);
}
