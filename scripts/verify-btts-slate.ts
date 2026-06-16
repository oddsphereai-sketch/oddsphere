/**
 * BTTS slate verification (2026-06-16). Reads each WC fixture's STORED model λ
 * from prediction_records and runs the EXACT production BTTS computation (RAW
 * bivariate-Poisson joint → bttsFromDistribution; no λ decompression — that was
 * reverted as anti-predictive). Shows the raw model BTTS-yes, the de-vigged
 * market, and the stored pick/grade, plus the predictive-ordering check
 * (BTTS-yes should rise with the weaker team's λ).
 *
 *   npx tsx --env-file=.env.local scripts/verify-btts-slate.ts [slateFrom=2026-06-16]
 *
 * Read-only.
 */
import { supabase } from "../lib/db/supabase";
import { resolveBttsSide, bttsDistributionWarning } from "../lib/services/soccer/bttsSide";
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

  const sides: Array<"yes" | "no"> = [];
  const ordering: Array<{ weak: number; yes: number }> = [];
  console.log("matchup        λweak   model_yes  market   side   (stored/grade)");
  for (const r of rows) {
    const lh = r.snapshot_json?.model?.lambda_home, la = r.snapshot_json?.model?.lambda_away;
    if (lh == null || la == null) continue;
    const modelYes = bttsFromDistribution(bivariatePoissonScoreDistribution(lh, la, tau)).yes;
    const market = r.snapshot_json?.market?.devigged_probabilities?.["btts|yes"] ?? null;
    const side = resolveBttsSide(modelYes, 1 - modelYes);
    sides.push(side);
    const weak = Math.min(lh, la);
    ordering.push({ weak, yes: modelYes });
    console.log(
      `${r.matchup.padEnd(14)} ${weak.toFixed(2)}    ${modelYes.toFixed(3)}      ${market != null ? market.toFixed(3) : " na  "}   ${side.toUpperCase().padEnd(3)}    (${r.pick}/${r.play_grade})`,
    );
  }
  const yes = sides.filter((s) => s === "yes").length;
  // Predictive-ordering check: sort by weaker-λ, BTTS-yes should be non-decreasing.
  const sorted = [...ordering].sort((a, b) => a.weak - b.weak);
  let monotonic = true;
  for (let i = 1; i < sorted.length; i++) if (sorted[i].yes < sorted[i - 1].yes - 1e-9) monotonic = false;
  console.log(`\nmodel → YES:${yes} NO:${sides.length - yes} (of ${sides.length}) | auditor: ${bttsDistributionWarning(sides) ?? "OK"}`);
  console.log(`predictive ordering (BTTS-yes rises with weaker λ): ${monotonic ? "OK" : "VIOLATED"}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
