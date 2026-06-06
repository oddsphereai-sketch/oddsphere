/**
 * Push 3A — verification script.
 *
 * Reads game_predictions for 2026-06-06 and confirms every row stays
 * pinned to V2.1 with locked_at set and slate_status=published.
 *
 * Run BEFORE and AFTER the shadow operator. Shadow is read-only but
 * we verify anyway because Push 3A spec requires it.
 */

import { supabase } from "../lib/db/supabase";

async function main() {
  const date = process.argv[2] ?? "2026-06-06";
  // Predictions are joined to games by game_id; query games for the date,
  // then check the corresponding predictions + slate_status.
  const { data: games, error: gamesErr } = await supabase
    .from("games")
    .select("id, external_id, slate_status, slate_date")
    .eq("slate_date", date)
    .eq("sport", "mlb");
  if (gamesErr) { console.error("games err", gamesErr); process.exit(1); }
  console.log(`\n━━━ Verify ${date} slate untouched ━━━\n`);
  const gameIds = (games ?? []).map((g) => g.id as number);
  console.log(`Games on date: ${gameIds.length}`);
  const slateStatuses: Record<string, number> = {};
  for (const g of games ?? []) {
    const s = (g.slate_status as string | null) ?? "null";
    slateStatuses[s] = (slateStatuses[s] ?? 0) + 1;
  }
  console.log(`Slate-status distribution: ${JSON.stringify(slateStatuses)}`);

  if (gameIds.length === 0) {
    console.log("No games. Done.");
    return;
  }

  const { data: preds, error: predsErr } = await supabase
    .from("game_predictions")
    .select("game_id, prediction_source, locked_at, sport_specific, created_at")
    .in("game_id", gameIds);
  if (predsErr) { console.error("preds err", predsErr); process.exit(1); }

  let v21 = 0, v22 = 0, v22fb = 0, v1 = 0, otherMu = 0;
  let lockedCount = 0;
  let withV22Audit = 0;
  for (const p of preds ?? []) {
    const sp = (p.sport_specific as Record<string, unknown> | null) ?? {};
    const mu = (sp.model_used as string | undefined) ?? "v1";
    if (mu === "v2_1") v21++;
    else if (mu === "v2_2") v22++;
    else if (mu === "v2_2_fallback_v1") v22fb++;
    else if (mu === "v1") v1++;
    else otherMu++;
    if (p.locked_at) lockedCount++;
    if (sp.v2_2_audit !== undefined && sp.v2_2_audit !== null) withV22Audit++;
  }

  console.log(`Predictions: ${preds?.length}`);
  console.log(`  model_used v1:               ${v1}`);
  console.log(`  model_used v2_1:             ${v21}`);
  console.log(`  model_used v2_2:             ${v22}        ← MUST BE 0 pre-launch`);
  console.log(`  model_used v2_2_fallback_v1: ${v22fb}      ← MUST BE 0 pre-launch`);
  console.log(`  other:                       ${otherMu}`);
  console.log(`  locked_at set:               ${lockedCount}`);
  console.log(`  rows with v2_2_audit:        ${withV22Audit} ← MUST BE 0 pre-launch`);

  const safe =
    (v22 === 0) &&
    (v22fb === 0) &&
    (withV22Audit === 0) &&
    (v21 === preds!.length) &&
    (lockedCount === preds!.length) &&
    ((slateStatuses["published"] ?? 0) === gameIds.length);

  console.log(`\n${safe ? "✅ SAFE — slate untouched, all V2.1 + locked + published" : "❌ UNSAFE — see counts above"}`);
  process.exit(safe ? 0 : 2);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
