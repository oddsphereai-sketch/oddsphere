/**
 * READ-ONLY: compute BEFORE/AFTER edge for CZE@KOR and RSA@MEX using
 * the model probabilities + market implied probabilities already
 * captured in the locked snapshots, so we can show Daniel the exact
 * impact of the DC de-vig fix without re-running the model against
 * the DB.
 *
 * No writes. Safe to run anytime.
 */
import { supabase } from "../../lib/db/supabase";
import { devigImplied } from "../../lib/services/soccer/soccerMarketComparison";

type Snap = {
  model: { raw_probabilities: Record<string, Record<string, number>> };
  market: { implied_probabilities: Record<string, number>; devigged_probabilities: Record<string, number> };
};

function edgePp(modelP: number, devigP: number): number {
  return (modelP - devigP) * 100;
}

async function main(): Promise<void> {
  // Pull one snapshot per game; all 4 markets share the same model + market bundle per fixture.
  const { data } = await supabase
    .from("prediction_records")
    .select("game_id, market, pick, snapshot_json")
    .in("game_id", [15721, 15687])
    .order("id", { ascending: true });

  // Group by game_id; one snapshot per game (any of its 4 records works for the bundle).
  const byGame = new Map<number, Snap>();
  for (const r of (data ?? []) as Array<{ game_id: number; snapshot_json: Snap }>) {
    if (!byGame.has(r.game_id)) byGame.set(r.game_id, r.snapshot_json);
  }

  for (const [gameId, snap] of byGame.entries()) {
    const label = gameId === 15721 ? "CZE @ KOR" : "RSA @ MEX";
    console.log(`\n══════════════════════════════════════════════════════════════════`);
    console.log(`${label} (game_id=${gameId})`);
    console.log(`══════════════════════════════════════════════════════════════════`);

    const modelP = snap.model.raw_probabilities;
    const implied = snap.market.implied_probabilities;
    const devigBefore = snap.market.devigged_probabilities;

    // ── Match Result (unchanged; target=1.0) ───────────────────────────
    console.log(`\n── match_result (target sum=1.0, unchanged) ──`);
    for (const sel of ["home", "draw", "away"] as const) {
      const k = `match_result|${sel}`;
      const mp = modelP.match_result[sel];
      const d_before = devigBefore[k];
      const d_after = d_before;
      console.log(`  ${sel.padEnd(10)} model_p=${mp.toFixed(3)}  devig=${d_before.toFixed(3)}  edge_pp=${edgePp(mp, d_after).toFixed(2)}  (unchanged)`);
    }

    // ── Double Chance (CHANGED; target was 1.0 → now 2.0) ──────────────
    console.log(`\n── double_chance (target sum was 1.0 → now 2.0) ──`);
    const dcKeys = ["home_or_draw", "away_or_draw", "home_or_away"] as const;
    const dcImplied = dcKeys.map((k) => implied[`double_chance|${k}`] ?? 0);
    const dcDevigAfter = devigImplied(dcImplied, 2.0);
    for (let i = 0; i < dcKeys.length; i++) {
      const sel = dcKeys[i];
      const k = `double_chance|${sel}`;
      const mp = modelP.double_chance[sel];
      const d_before = devigBefore[k];
      const d_after = dcDevigAfter[i];
      const e_before = edgePp(mp, d_before);
      const e_after = edgePp(mp, d_after);
      console.log(`  ${sel.padEnd(13)} model_p=${mp.toFixed(3)}  devig BEFORE=${d_before.toFixed(3)} AFTER=${d_after.toFixed(3)}  edge_pp BEFORE=${e_before > 0 ? "+" : ""}${e_before.toFixed(2)} → AFTER=${e_after > 0 ? "+" : ""}${e_after.toFixed(2)}`);
    }

    // ── Total (unchanged; target=1.0) ───────────────────────────────────
    console.log(`\n── total (target sum=1.0, unchanged) ──`);
    const totalKeys = Object.keys(implied).filter((k) => k.startsWith("total|"));
    for (const k of totalKeys) {
      const [, sel] = k.split("|");
      const tp = (modelP as Record<string, Record<string, number>>).total_at_canonical?.[sel];
      const d_before = devigBefore[k];
      const d_after = d_before;
      const edge = tp !== undefined ? edgePp(tp, d_after) : null;
      console.log(`  ${k.padEnd(20)} model_p=${tp?.toFixed(3) ?? "?"}  devig=${d_before.toFixed(3)}  edge_pp=${edge?.toFixed(2) ?? "?"}  (unchanged)`);
    }

    // ── BTTS (unchanged; target=1.0) ────────────────────────────────────
    console.log(`\n── btts (target sum=1.0, unchanged) ──`);
    for (const sel of ["yes", "no"] as const) {
      const k = `btts|${sel}`;
      const mp = modelP.btts[sel];
      const d_before = devigBefore[k];
      const d_after = d_before;
      console.log(`  ${sel.padEnd(10)} model_p=${mp.toFixed(3)}  devig=${d_before.toFixed(3)}  edge_pp=${edgePp(mp, d_after).toFixed(2)}  (unchanged)`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
