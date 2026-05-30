/**
 * Phase 4.1.3 — operator-run live smoke for pickBreakdownGenerator.
 *
 * Reads the 2026-05-22 slate, generates breakdowns for each game's
 * AutoModelOutput, prints member + operator text per game.
 *
 * Run: npx tsx --env-file=.env.local scripts/test-pick-breakdown-generator-live.ts
 *
 * No DB writes — this script runs generatePredictionsForSlate with
 * writeToDb=false and pipes each prediction through the generator
 * directly. No env flag is set; we invoke the generator explicitly
 * so the operator can review the output regardless of gate state.
 */
import { generatePredictionsForSlate } from "../lib/services/automodelService";
import { generatePickBreakdown } from "../lib/services/pickBreakdownGenerator";
import { buildFeatureSnapshots } from "../lib/automodel/featureSnapshot";

async function main(): Promise<void> {
  const slate_date = "2026-05-22";
  console.log(`\nPhase 4.1.3 live smoke — pick breakdowns for ${slate_date}\n`);

  // Build snapshots (read-only) so we have context for each game.
  const snapshots = await buildFeatureSnapshots("mlb", slate_date);
  const snapByExt = new Map<number, typeof snapshots[number]>();
  for (const s of snapshots) snapByExt.set(s.game_external_id, s);

  // Run the model (writeToDb=false), then for each prediction call
  // the generator with the matching snapshot's context.
  const result = await generatePredictionsForSlate(
    "mlb",
    slate_date,
    "morning_draft",
    { writeToDb: false }
  );

  for (const pred of result.predictions) {
    const snap = snapByExt.get(pred.game_external_id);
    if (!snap) {
      console.log(`\n--- ext=${pred.game_external_id}: NO SNAPSHOT (skipping)`);
      continue;
    }
    const breakdown = generatePickBreakdown(pred, {
      sport: "mlb",
      home_pitcher_name: snap.home_starter?.player_name ?? null,
      away_pitcher_name: snap.away_starter?.player_name ?? null,
      home_team_abbr: snap.home_team.abbreviation,
      away_team_abbr: snap.away_team.abbreviation,
      home_first_inning_starts: snap.home_starter?.first_inning_starts ?? null,
      away_first_inning_starts: snap.away_starter?.first_inning_starts ?? null,
      home_first_inning_era: snap.home_starter?.first_inning_era ?? null,
      away_first_inning_era: snap.away_starter?.first_inning_era ?? null,
      home_season_era: snap.home_starter?.season_era ?? null,
      away_season_era: snap.away_starter?.season_era ?? null,
    });

    console.log("─".repeat(96));
    console.log(
      `ext=${pred.game_external_id}  ${snap.away_team.abbreviation} @ ${snap.home_team.abbreviation}` +
        `  (${snap.away_starter?.player_name ?? "?"} vs ${snap.home_starter?.player_name ?? "?"})`
    );
    console.log("");
    console.log(`MEMBER (${breakdown.member_summary.length} chars):`);
    console.log(`  ${breakdown.member_summary}`);
    console.log("");
    console.log(`OPERATOR:`);
    for (const line of breakdown.operator_detail.split("\n")) {
      console.log(`  ${line}`);
    }
  }

  console.log("\n" + "═".repeat(96));
  console.log(`Slate complete — ${result.predictions.length} games processed.`);
  console.log(
    `breakdown_version: ${BREAKDOWN_VERSION_CONST}, member text cap: 280 chars.`
  );
}

// Imported here so we can print the version constant without import * shenanigans.
import { BREAKDOWN_VERSION as BREAKDOWN_VERSION_CONST } from "../lib/services/pickBreakdownGenerator";

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
