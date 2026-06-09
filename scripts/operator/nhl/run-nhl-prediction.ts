/**
 * Phase 7L Phase 2 — NHL prediction operator (CLI wrapper).
 *
 * Reads game + team_stats + goalie_stats + lines from the DB, runs the
 * v0 NHL model, and prints structured output to stdout. Default mode
 * is dry-run (no DB writes); prediction_records writing is wired in
 * Phase 4/5 once the model output is calibrated against real games.
 *
 *   Default (today's NHL slate):
 *     npx tsx --env-file=.env.local scripts/operator/nhl/run-nhl-prediction.ts \
 *       --season 2025
 *
 *   Specific date:
 *     npx tsx --env-file=.env.local scripts/operator/nhl/run-nhl-prediction.ts \
 *       --date 2026-06-09 --season 2025
 *
 *   With manual goalie override (player_external_id from
 *   nhl_goalie_stats, e.g. via SELECT player_external_id, player_name
 *   FROM nhl_goalie_stats WHERE team_abbr='VGK'):
 *     npx tsx --env-file=.env.local scripts/operator/nhl/run-nhl-prediction.ts \
 *       --date 2026-06-09 --season 2025 \
 *       --home-goalie 8478499 --away-goalie 8475883
 *
 *   JSON mode (for piping to other tools):
 *     ... --json
 */

import { supabase } from "../../../lib/db/supabase";
import {
  buildNhlFeatureSnapshot,
} from "../../../lib/services/nhl/featureSnapshot";
import {
  nhlAutoModelV0,
  NHL_MODEL_VERSION_CONST,
} from "../../../lib/automodel/nhlAutoModelV0";
import { computeSlateDate } from "../../../lib/dates/slateDate";
import { readBoolFlag, readStringFlag, readNumberFlag } from "../_cliCommon";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const seasonRaw = readStringFlag(argv, "--season");
  if (seasonRaw === undefined) {
    console.error("✗ --season YYYY required (MoneyPuck start-year, e.g. 2025)");
    process.exit(1);
  }
  const season = Number.parseInt(seasonRaw, 10);
  const slateDate = readStringFlag(argv, "--date") ?? computeSlateDate("nhl", new Date());
  const homeGoalieExternalId = readNumberFlag(argv, "--home-goalie");
  const awayGoalieExternalId = readNumberFlag(argv, "--away-goalie");
  const jsonMode = readBoolFlag(argv, "--json");

  console.log(`[nhl-run-prediction] model=${NHL_MODEL_VERSION_CONST}  date=${slateDate}  season=${season}`);
  console.log("─".repeat(70));

  // Find all NHL games on this slate.
  const { data: games, error } = await supabase
    .from("games")
    .select("id, external_id, home_team_id, away_team_id, slate_date, game_date, status")
    .eq("sport", "nhl")
    .eq("slate_date", slateDate);
  if (error) {
    console.error(`✗ games lookup: ${error.message}`);
    process.exit(1);
  }
  if (!games || games.length === 0) {
    console.log(`(no NHL games on slate ${slateDate}; run seed-nhl-games.ts first)`);
    return;
  }

  const outputs: unknown[] = [];

  for (const g of games) {
    try {
      const { snapshot, meta } = await buildNhlFeatureSnapshot({
        gameId: g.id,
        season,
        homeGoalieExternalId,
        awayGoalieExternalId,
        logger: (m) => { if (!jsonMode) console.log(m); },
      });
      const out = nhlAutoModelV0(snapshot);

      if (jsonMode) {
        outputs.push({
          game_id: g.id,
          external_id: g.external_id,
          slate_date: g.slate_date,
          inputs: snapshot,
          meta,
          output: out,
        });
        continue;
      }

      console.log("");
      console.log(`══════ ${out.inputs_summary.away} @ ${out.inputs_summary.home} ${out.inputs_summary.series ? `(${out.inputs_summary.series})` : ""} ══════`);
      if (meta.home_goalie || meta.away_goalie) {
        console.log(`  Goalies: ${out.inputs_summary.away}=${meta.away_goalie ?? "?"}  ${out.inputs_summary.home}=${meta.home_goalie ?? "?"}`);
      }
      console.log("");
      console.log(`  Layer contributions (signed goal diff, home - away):`);
      console.log(`    Team strength (xG%):     ${out.layers.team_strength_goals.toFixed(2)}  (xG%-diff=${(out.layers.team_strength_diff_raw * 100).toFixed(1)}pp)`);
      console.log(`    Goalie advantage:        ${out.layers.goalie_advantage_goals.toFixed(2)}`);
      console.log(`    Special teams:           ${out.layers.special_teams_goals.toFixed(2)}  (raw-diff=${out.layers.special_teams_diff_raw.toFixed(3)})`);
      console.log(`    Rest advantage:          ${out.layers.rest_advantage_goals.toFixed(2)}`);
      console.log(`    Home ice:                ${out.layers.home_ice_goals.toFixed(2)}`);
      console.log(`    Series context:          ${out.layers.series_context_goals.toFixed(2)}`);
      console.log(`    ─────────────────────────────`);
      console.log(`    Expected goal diff:      ${out.expected_goal_diff.toFixed(2)}`);
      console.log(`    Expected total goals:    ${out.expected_total_goals.toFixed(2)}`);
      console.log("");
      console.log(`  Moneyline:  pick=${out.moneyline.pick}  prob=${(out.moneyline.probability * 100).toFixed(1)}%  verdict=${out.moneyline.verdict}`);
      for (const n of out.moneyline.notes) console.log(`    · ${n}`);
      console.log(`  Total:      pick=${out.total.pick}  verdict=${out.total.verdict}`);
      for (const n of out.total.notes) console.log(`    · ${n}`);
    } catch (e) {
      console.error(`✗ game ${g.id} failed: ${(e as Error).message}`);
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify(outputs, null, 2));
  }
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
