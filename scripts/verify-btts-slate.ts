/**
 * BTTS slate verification (2026-06-16). Reads each WC fixture's STORED model λ
 * from prediction_records and runs the EXACT production BTTS computation
 * (decompressLambdasForBtts → bivariate Poisson → bttsFromDistribution) to show
 * what the deployed model produces, vs the raw (pre-decompression) and the
 * de-vigged market. Use this to confirm the fix is flowing after a soccer
 * refresh (or to spot stale rows written by old code).
 *
 *   npx tsx --env-file=.env.local scripts/verify-btts-slate.ts [slateFrom=2026-06-16]
 *
 * Read-only. Prints: matchup, raw_btts_yes_pre_decompression, decompressed_btts_yes,
 * final_snapshot_btts_yes (what's in the DB now), final_btts_side, grade.
 */
import { supabase } from "../lib/db/supabase";
import { decompressLambdasForBtts, resolveBttsSide, bttsDistributionWarning } from "../lib/services/soccer/bttsSide";
import { bivariatePoissonScoreDistribution } from "../lib/services/soccer/dixonColes";
import { bttsFromDistribution } from "../lib/services/soccer/soccerMarketProbabilities";
import { EXTERNAL_PRIORS_V1 } from "../lib/services/soccer/_externalPriorsV1";

const tau = EXTERNAL_PRIORS_V1.tau;
const from = process.argv[2] ?? "2026-06-16";

async function main() {
  const { data } = await supabase
    .from("prediction_records")
    .select("game_id, matchup, slate_date, pick, play_grade, created_at, snapshot_json")
    .eq("sport", "soccer").eq("market", "btts").gte("slate_date", from)
    .order("slate_date").order("game_id");
  const rows = (data ?? []) as Array<{ game_id: number; matchup: string; pick: string | null; play_grade: string | null; created_at: string; snapshot_json: { model?: { lambda_home?: number; lambda_away?: number; raw_probabilities?: { btts?: { yes?: number } } }; market?: { devigged_probabilities?: Record<string, number> } } | null }>;

  const newSides: Array<"yes" | "no"> = [];
  console.log("matchup        rawPre   market   decompressed  newSide  (DBside/grade)  written");
  for (const r of rows) {
    const lh = r.snapshot_json?.model?.lambda_home, la = r.snapshot_json?.model?.lambda_away;
    if (lh == null || la == null) continue;
    const rawPre = bttsFromDistribution(bivariatePoissonScoreDistribution(lh, la, tau)).yes;
    const [h, a] = decompressLambdasForBtts(lh, la);
    const decompressed = bttsFromDistribution(bivariatePoissonScoreDistribution(h, a, tau)).yes;
    const dbSnapYes = r.snapshot_json?.model?.raw_probabilities?.btts?.yes ?? null;
    const market = r.snapshot_json?.market?.devigged_probabilities?.["btts|yes"] ?? null;
    const newSide = resolveBttsSide(decompressed, 1 - decompressed);
    newSides.push(newSide);
    const stale = dbSnapYes != null && Math.abs(dbSnapYes - rawPre) < 0.001 ? "STALE(old code)" : "fresh";
    console.log(
      `${r.matchup.padEnd(14)} ${rawPre.toFixed(3)}    ${market != null ? market.toFixed(3) : " na  "}   ${decompressed.toFixed(3)}        ${newSide.toUpperCase().padEnd(3)}     (${r.pick}/${r.play_grade})  ${stale}`,
    );
  }
  const yes = newSides.filter((s) => s === "yes").length;
  console.log(`\nNEW model → YES:${yes} NO:${newSides.length - yes} (of ${newSides.length}) | auditor: ${bttsDistributionWarning(newSides) ?? "OK"}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
