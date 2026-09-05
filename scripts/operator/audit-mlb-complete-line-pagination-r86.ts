/** SELECT-only acceptance audit for the MLB r86 complete-line pagination correction. */
import { buildFeatureSnapshots } from "../../lib/automodel/featureSnapshot";
import { currentSlateDate } from "../../lib/dates/slateDate";
import { supabase } from "../../lib/db/supabase";
import { createPredictionRecords } from "../../lib/services/predictionRecordService";

const slateDate = process.argv[2] ?? currentSlateDate("mlb");

function grade(row: { best_angle?: boolean; play_grade?: unknown; held?: boolean }): string {
  if (row.held) return "operational_hold";
  if (row.best_angle) return "best_angle";
  return typeof row.play_grade === "string" ? row.play_grade : "no_play";
}

async function main(): Promise<void> {
  const [snapshots, dry] = await Promise.all([
    buildFeatureSnapshots("mlb", slateDate),
    createPredictionRecords({ sport: "mlb", slateDate, launchDay: false, apply: false, supabase }),
  ]);
  if (dry.errors.length > 0) throw new Error(JSON.stringify(dry.errors));

  const fullGameRows = dry.proposed.filter((row) => row.market === "moneyline" || row.market === "total");
  const gradeCounts = new Map<string, number>();
  for (const row of fullGameRows) {
    const key = grade(row);
    gradeCounts.set(key, (gradeCounts.get(key) ?? 0) + 1);
  }

  console.log(JSON.stringify({
    release: "mlb_complete_line_pagination_2026_09_05_r86",
    readOnly: true,
    writes: 0,
    slateDate,
    snapshots: snapshots.length,
    marketPriceCoverage: snapshots.map((snapshot) => ({
      matchup: `${snapshot.away_team.abbreviation}@${snapshot.home_team.abbreviation}`,
      moneyline: snapshot.market.home_ml_odds_american !== null && snapshot.market.away_ml_odds_american !== null,
      total: snapshot.market.listed_total !== null && snapshot.market.over_odds_american !== null && snapshot.market.under_odds_american !== null,
      homeMl: snapshot.market.home_ml_odds_american,
      awayMl: snapshot.market.away_ml_odds_american,
      listedTotal: snapshot.market.listed_total,
      over: snapshot.market.over_odds_american,
      under: snapshot.market.under_odds_american,
    })),
    proposedFullGameMarkets: fullGameRows.length,
    gradeCounts: Object.fromEntries([...gradeCounts].sort(([a], [b]) => a.localeCompare(b))),
    proposed: fullGameRows.map((row) => ({
      matchup: row.matchup,
      market: row.market,
      side: row.side,
      price: row.odds_american,
      grade: grade(row),
      noBet: row.no_bet,
      held: row.held,
      reason: row.no_bet_reason ?? null,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
