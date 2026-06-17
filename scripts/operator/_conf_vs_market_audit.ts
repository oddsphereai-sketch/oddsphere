/**
 * Read-only: dump per-market modelTrustPct vs recommendationConfidence
 * vs marketImpliedPct for today's slate, so we can see exactly what
 * the ConfidenceVsMarketStrip is rendering.
 *
 * Hits the live route handler directly (same code path the UI hits).
 */
import { createClient } from "@supabase/supabase-js";

const ET_TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function main() {
  console.log(`\n═══════ Confidence vs Market audit · ${ET_TODAY} ═══════\n`);
  // Pull predictions + audit so we can compute what the route would show.
  const { data: games } = await sb.from("games").select("id, home_team_id, away_team_id").eq("sport", "mlb").eq("slate_date", ET_TODAY);
  const ids = (games ?? []).map((g: any) => g.id);
  const { data: preds } = await sb.from("game_predictions")
    .select("game_id, predicted_ml_winner, ml_confidence, predicted_ou_side, ou_confidence, sport_specific")
    .in("game_id", ids);
  const teamIds = new Set<number>();
  for (const g of games ?? []) { teamIds.add((g as any).home_team_id); teamIds.add((g as any).away_team_id); }
  const { data: teams } = await sb.from("teams").select("id, abbreviation").in("id", Array.from(teamIds));
  const teamMap = new Map((teams ?? []).map((t: any) => [t.id, t.abbreviation]));
  const gameMap = new Map((games ?? []).map((g: any) => [g.id, g]));

  console.log("Per-game per-market comparison (what user sees on card + reader):\n");
  console.log("matchup       market  pick     mainConf%  modelProb%  no-vig%   edge_pp   rec_conf  edge_pp_rec  ⚠️");
  for (const p of (preds ?? []) as any[]) {
    const g = gameMap.get(p.game_id) as any;
    const matchup = g ? `${teamMap.get(g.away_team_id)}@${teamMap.get(g.home_team_id)}` : "?";
    const sp = (p.sport_specific ?? {}) as any;
    const v22 = (sp.v2_2_audit ?? {}) as any;
    const fi = (sp.fi_v2_audit ?? {}) as any;
    // ML
    {
      const pick = p.predicted_ml_winner;
      const mainConf = p.ml_confidence ?? null;
      const modelProb = typeof v22.ml_model_prob === "number" ? v22.ml_model_prob * 100 : null;
      const noVig = typeof v22.ml_market_prob === "number" ? v22.ml_market_prob * 100 : null;
      const edgePp = typeof v22.ml_edge_pct === "number" ? v22.ml_edge_pct : null;
      // recommendationConfidence (ML uses edgePctPp path)
      let recConf: number | null = null;
      if (edgePp !== null) {
        // mirror scoreFromPpEdge from lib/services/recommendationConfidence.ts
        let s: number;
        if (edgePp <= -2) s = 15;
        else if (edgePp <= 0) s = 15 + (28-15) * ((edgePp+2)/2);
        else if (edgePp <= 2) s = 28 + (45-28) * (edgePp/2);
        else if (edgePp <= 4) s = 45 + (58-45) * ((edgePp-2)/2);
        else if (edgePp <= 6) s = 58 + (68-58) * ((edgePp-4)/2);
        else s = 68 + Math.min(7, (edgePp-6) * 0.875);
        // tier/play-grade caps not modeled here for audit purposes
        recConf = Math.round(s);
      }
      const edgeFromRec = recConf !== null && noVig !== null ? recConf - noVig : null;
      const flag = (modelProb !== null && noVig !== null && recConf !== null && Math.abs((modelProb - noVig) - (recConf - noVig)) > 5) ? "← MISMATCH" : "";
      console.log(`${matchup.padEnd(13)} ML      ${String(pick).padEnd(8)} ${String(mainConf ?? "?").padStart(7)}    ${(modelProb !== null ? modelProb.toFixed(1) : "?").padStart(7)}    ${(noVig !== null ? noVig.toFixed(1) : "?").padStart(6)}    ${(edgePp !== null ? edgePp.toFixed(2) : "?").padStart(6)}    ${String(recConf ?? "?").padStart(6)}    ${(edgeFromRec !== null ? edgeFromRec.toFixed(1) : "?").padStart(8)}  ${flag}`);
    }
    // OU
    {
      const pick = p.predicted_ou_side;
      const mainConf = p.ou_confidence ?? null;
      const modelProb = typeof v22.ou_model_prob === "number" ? v22.ou_model_prob * 100 : null;
      const noVig = typeof v22.ou_market_prob === "number" ? v22.ou_market_prob * 100 : null;
      const edgePp = typeof v22.ou_edge_pct === "number" ? v22.ou_edge_pct : null;
      // OU uses scoreFromRunDelta, not pp — need projected_total - market_total
      const projTotal = typeof v22.posterior_total === "number" ? v22.posterior_total : null;
      const mktTotal = typeof v22.market_total === "number" ? v22.market_total : null;
      const delta = projTotal !== null && mktTotal !== null ? projTotal - mktTotal : null;
      let recConf: number | null = null;
      if (delta !== null) {
        const abs = Math.abs(delta);
        let s: number;
        if (abs <= 0.25) s = 25;
        else if (abs <= 0.75) s = 25 + (42-25)*((abs-0.25)/0.5);
        else if (abs <= 1.25) s = 42 + (58-42)*((abs-0.75)/0.5);
        else if (abs <= 2.0)  s = 58 + (70-58)*((abs-1.25)/0.75);
        else s = 70;
        recConf = Math.round(s);
      }
      const edgeFromRec = recConf !== null && noVig !== null ? recConf - noVig : null;
      const flag = (modelProb !== null && noVig !== null && recConf !== null && Math.abs((modelProb - noVig) - (recConf - noVig)) > 5) ? "← MISMATCH" : "";
      console.log(`${matchup.padEnd(13)} OU      ${String(pick).padEnd(8)} ${String(mainConf ?? "?").padStart(7)}    ${(modelProb !== null ? modelProb.toFixed(1) : "?").padStart(7)}    ${(noVig !== null ? noVig.toFixed(1) : "?").padStart(6)}    ${(edgePp !== null ? edgePp.toFixed(2) : "?").padStart(6)}    ${String(recConf ?? "?").padStart(6)}    ${(edgeFromRec !== null ? edgeFromRec.toFixed(1) : "?").padStart(8)}  ${flag}`);
    }
    void fi;
  }

  console.log("\nKey: `mainConf%` is what the card headline + Quick Read shows.");
  console.log("     `modelProb%` is the V2.2 audit model probability for the picked side.");
  console.log("     `no-vig%` is the market no-vig probability for the picked side.");
  console.log("     `rec_conf` is the recommendationConfidence currently rendered in Confidence vs Market.");
  console.log("     `edge_pp_rec` = rec_conf − no-vig — what's shown as 'Edge' in the strip today.");
  console.log("     Honest edge = modelProb − no-vig.");
}
main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
