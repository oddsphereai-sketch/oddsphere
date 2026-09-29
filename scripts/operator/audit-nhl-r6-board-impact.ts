import { supabase } from "../../lib/db/supabase";
import {
  nhlRegularModelV1,
  type NhlFeatureSnapshot,
  type NhlModelOutput,
  type NhlVerdictKey,
} from "../../lib/automodel/nhlRegularModelV1";
import { openingNhlOpponentAdjustedState } from "../../lib/automodel/nhlOpponentAdjustedState2026";

const ACTIVE_RELEASE = "nhl_regular_2026_r5_total_confidence_calibration";
const slateDate = process.argv[2] ?? "2026-09-29";
const rank: Record<NhlVerdictKey, number> = { pass: 0, watchlist: 1, lean: 2, best_angle: 3 };

type Row = { game_id: number; matchup: string; snapshot_json: Record<string, unknown> | null };

async function main(): Promise<void> {
const { data, error } = await supabase
  .from("prediction_records")
  .select("game_id, matchup, snapshot_json")
  .eq("sport", "nhl")
  .eq("slate_date", slateDate)
  .eq("model_version", ACTIVE_RELEASE);
if (error) throw new Error(error.message);

const unique = new Map<number, Row>();
for (const row of (data ?? []) as Row[]) if (!unique.has(row.game_id)) unique.set(row.game_id, row);
const states = openingNhlOpponentAdjustedState();
const changes: Array<Record<string, unknown>> = [];
let promotions = 0;
let demotions = 0;
let sideChanges = 0;
let activeActionable = 0;
let candidateActionable = 0;

for (const row of unique.values()) {
  const stored = row.snapshot_json?.model_output as NhlModelOutput | undefined;
  const input = row.snapshot_json?.feature_inputs as NhlFeatureSnapshot | undefined;
  if (!stored || !input) continue;
  const homeState = states.get(input.home.abbreviation);
  const awayState = states.get(input.away.abbreviation);
  const candidate = nhlRegularModelV1({
    ...input,
    home: {
      ...input.home,
      opponent_adjusted_attack: homeState?.attack ?? null,
      opponent_adjusted_defense_weakness: homeState?.defenseWeakness ?? null,
    },
    away: {
      ...input.away,
      opponent_adjusted_attack: awayState?.attack ?? null,
      opponent_adjusted_defense_weakness: awayState?.defenseWeakness ?? null,
    },
  });
  for (const market of ["moneyline", "total", "puck_line"] as const) {
    const before = stored[market];
    const after = candidate[market];
    if (rank[before.verdict] >= rank.lean) activeActionable += 1;
    if (rank[after.verdict] >= rank.lean) candidateActionable += 1;
    if (rank[after.verdict] > rank[before.verdict]) promotions += 1;
    if (rank[after.verdict] < rank[before.verdict]) demotions += 1;
    if (after.pick !== before.pick) sideChanges += 1;
  }
  changes.push({
    matchup: row.matchup,
    active_score: [stored.projected_away_goals, stored.projected_home_goals],
    candidate_score: [candidate.projected_away_goals, candidate.projected_home_goals],
    active: {
      moneyline: [stored.moneyline.pick, stored.moneyline.verdict],
      total: [stored.total.pick, stored.total.verdict],
      puck_line: [stored.puck_line.pick, stored.puck_line.verdict],
    },
    candidate: {
      moneyline: [candidate.moneyline.pick, candidate.moneyline.verdict],
      total: [candidate.total.pick, candidate.total.verdict],
      puck_line: [candidate.puck_line.pick, candidate.puck_line.verdict],
    },
  });
}

console.log(JSON.stringify({
  slate_date: slateDate,
  games: changes.length,
  markets: changes.length * 3,
  active_actionable: activeActionable,
  candidate_actionable: candidateActionable,
  promotions,
  demotions,
  side_changes: sideChanges,
  changes,
}, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
