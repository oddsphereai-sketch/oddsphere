/**
 * READ-ONLY projection of Pass 2 behavior on tonight's locked
 * snapshots, using the existing snapshot's model_p + market_devig
 * (post Change A's DC math) to predict the new hold/grade decisions.
 *
 * No writes. Does not call the model — re-derives just deriveHold +
 * deriveSoccerGrade for the argmax(model_p) pick per market.
 */
import { supabase } from "../../lib/db/supabase";
import { deriveHold, type HoldInputContext } from "../../lib/services/soccer/soccerHoldLogic";
import { deriveSoccerGrade } from "../../lib/services/soccer/soccerConfidenceGrade";
import { devigImplied } from "../../lib/services/soccer/soccerMarketComparison";
import { EXTERNAL_PRIORS_V1 } from "../../lib/services/soccer/_externalPriorsV1";

const AGREEMENT_BAND_PP = 4;

async function main(): Promise<void> {
  const { data } = await supabase
    .from("prediction_records")
    .select("game_id, market, pick, snapshot_json")
    .in("game_id", [15721, 15687])
    .order("id", { ascending: true });

  const byGame = new Map<number, any>();
  for (const r of (data ?? []) as any[]) {
    if (!byGame.has(r.game_id)) byGame.set(r.game_id, r.snapshot_json);
  }

  for (const [gameId, snap] of byGame.entries()) {
    const label = gameId === 15721 ? "CZE @ KOR" : "RSA @ MEX";
    console.log(`\n══════════════════════════════════════════════════════════════════`);
    console.log(`${label} (game_id=${gameId}) — projected Pass 2 + Change A decisions`);
    console.log(`══════════════════════════════════════════════════════════════════`);

    const modelP = snap.model.raw_probabilities;
    const implied = snap.market.implied_probabilities as Record<string, number>;
    const lambdaH = snap.model.lambda_home as number;
    const lambdaA = snap.model.lambda_away as number;
    const predictedTotal = snap.model.expected_total as number;
    const listedLine = 2.5; // from snapshot total_at_canonical

    // Recompute devig with Change A applied (DC sums to 2.0).
    const mrKeys = ["match_result|home", "match_result|draw", "match_result|away"];
    const dcKeys = ["double_chance|home_or_draw", "double_chance|away_or_draw", "double_chance|home_or_away"];
    const totKeys = ["total|over|2.5", "total|under|2.5"];
    const bttsKeys = ["btts|yes", "btts|no"];

    const mrDevig = devigImplied(mrKeys.map((k) => implied[k] ?? 0), 1.0);
    const dcDevig = devigImplied(dcKeys.map((k) => implied[k] ?? 0), 2.0);
    const totDevig = devigImplied(totKeys.map((k) => implied[k] ?? 0), 1.0);
    const bttsDevig = devigImplied(bttsKeys.map((k) => implied[k] ?? 0), 1.0);

    const markets = [
      { market: "match_result" as const, sels: ["home", "draw", "away"] as const,
        mps: [modelP.match_result.home, modelP.match_result.draw, modelP.match_result.away], devigs: mrDevig },
      { market: "double_chance" as const, sels: ["home_or_draw", "away_or_draw", "home_or_away"] as const,
        mps: [modelP.double_chance.home_or_draw, modelP.double_chance.away_or_draw, modelP.double_chance.home_or_away], devigs: dcDevig },
      { market: "total" as const, sels: ["over", "under"] as const,
        mps: [modelP.total_at_canonical.over, modelP.total_at_canonical.under], devigs: totDevig },
      { market: "btts" as const, sels: ["yes", "no"] as const,
        mps: [modelP.btts.yes, modelP.btts.no], devigs: bttsDevig },
    ];

    for (const M of markets) {
      // argmax(model_p) pick.
      let bestIx = 0;
      for (let i = 1; i < M.mps.length; i++) if (M.mps[i] > M.mps[bestIx]) bestIx = i;
      const pick = M.sels[bestIx];
      const mp = M.mps[bestIx];
      const dp = M.devigs[bestIx];
      const edgePp = (mp - dp) * 100;
      const agreement = Math.abs(edgePp) < AGREEMENT_BAND_PP;
      const isFarFromMarket = Math.abs(edgePp) > EXTERNAL_PRIORS_V1.edge_thresholds.far_from_market_hard_hold;
      const isFarHard = isFarFromMarket;

      const holdCtx: HoldInputContext = {
        market: M.market,
        market_odds_missing: false,
        reconciliation: "MATCHED",
        has_unresolved_placeholder: false,
        both_providers_stale: false,
        total_lines_diverge: M.market === "total" && (snap.market.model_far_from_market === true ? false : false),
        splits_falsely_claimed: false,
        splits_status: "empty_as_of_probe",
        edge_pp: edgePp,
        is_far_from_market_hard: isFarHard,
        predicted_total: predictedTotal,
        listed_total_line: M.market === "total" ? listedLine : null,
        lambda_home: lambdaH,
        lambda_away: lambdaA,
        joint: null,
        calibration_evidence_level: "external_priors_only",
        pre_calibration_publish_whitelist: ["total", "btts"],
      };
      const hold = deriveHold(holdCtx);

      const softCaps = hold.hold === false ? hold.soft_caps ?? [] : [];

      const grade = deriveSoccerGrade({
        market: M.market,
        selection: pick,
        model_p: mp,
        edge_pp: edgePp,
        model_market_agreement: agreement,
        ctx: {
          calibration_evidence_level: "external_priors_only",
          market_supports_pick: false,
          is_stale_market: false,
          is_single_source: false,
          is_far_from_market: isFarFromMarket,
          is_match_favorite: false,
          market_moving_against_pick: false,
          is_short_price_dc: false,
          short_price_dc_market_implied_p: null,
          splits_provider_error: false,
          is_draw_pick: M.market === "match_result" && pick === "draw",
          lambda_total: lambdaH + lambdaA,
          is_btts_yes_pick: M.market === "btts" && pick === "yes",
          lambda_min: Math.min(lambdaH, lambdaA),
        },
        soft_caps: softCaps,
      });

      const heldStr = hold.hold === true ? `HOLD (${hold.code})` : "publish";
      const softStr = softCaps.length > 0 ? `softcap=${softCaps.map((c) => c.code).join(",")}` : "";
      console.log(
        `  ${M.market.padEnd(15)} pick=${pick.padEnd(13)} edge=${edgePp >= 0 ? "+" : ""}${edgePp.toFixed(2)}pp  agree=${agreement}  ` +
        `→ ${heldStr.padEnd(35)} grade=${grade.grade.padEnd(10)} best_angle=${grade.best_angle} ${softStr}`,
      );
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
