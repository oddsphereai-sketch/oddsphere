/**
 * READ-ONLY — WC grade/held distribution probe (2026-06-12).
 *
 * For each WC fixture × market on slate 2026-06-12, dumps the public
 * columns (pick, confidence, play_grade, held, no_bet, no_bet_reason,
 * hold_reason, locked_at) + the snapshot soft-cap / hold info, then
 * classifies each row as TRUE BLOCKER vs SOFT CAUTION and summarizes
 * surfaceable vs held counts.
 *
 * Pure read. No mutations.
 *
 * Usage: npx tsx scripts/operator/_audit_wc_grade_held_dist_2026_06_12.ts
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m === null) continue;
  if (!(m[1] in process.env)) process.env[m[1]] = m[2];
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const SLATE = "2026-06-12";
const GAME_IDS = [15754, 15755];

// Hold codes that are HARD true blockers vs soft-cap codes.
const HARD_HOLD_CODES = new Set([
  "SHARP_ONLY_RECONCILIATION",
  "UNRESOLVED_PLACEHOLDER",
  "MARKET_ODDS_MISSING",
  "BOTH_PROVIDERS_STALE",
  "TOTAL_LINES_DIVERGE",
  "SPLITS_FALSE_CLAIM",
  "MODEL_WRONG_SIDE_OF_MARKET",
  "TOTAL_PUSH_RISK",
  "TOTAL_DIRECTION_CONFLICT",
]);

type Pred = {
  id: number;
  game_id: number;
  market: string | null;
  prediction_type: string | null;
  pick: string | null;
  confidence: number | null;
  play_grade: string | null;
  held: boolean | null;
  no_bet: boolean | null;
  no_bet_reason: string | null;
  hold_reason: string | null;
  locked_at: string | null;
  snapshot_json: Record<string, unknown> | null;
};

function get(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

async function main(): Promise<void> {
  console.log("\nREAD-ONLY — WC grade/held distribution  slate=" + SLATE);
  console.log("=".repeat(78));

  const { data, error } = await supabase
    .from("prediction_records")
    .select(
      "id, game_id, market, prediction_type, pick, confidence, play_grade, held, no_bet, no_bet_reason, hold_reason, locked_at, snapshot_json",
    )
    .in("game_id", GAME_IDS)
    .order("game_id", { ascending: true });

  if (error !== null) {
    console.error("query failed:", error);
    process.exit(1);
  }
  const all = (data as Pred[] | null) ?? [];
  const wc = all.filter((p) => {
    const comp = get(p.snapshot_json, ["competition"]);
    return comp === "fifa_world_cup" || comp === undefined; // some snapshots may key elsewhere
  });

  console.log(`\nrows for games ${GAME_IDS.join(",")}: ${all.length} (wc-filtered: ${wc.length})`);

  let surfaceable = 0;
  let trueBlocker = 0;
  let softCaution = 0;

  for (const gameId of GAME_IDS) {
    const rows = wc.filter((p) => p.game_id === gameId);
    console.log("\n" + "-".repeat(78));
    console.log(`GAME ${gameId}  (rows: ${rows.length})`);
    for (const r of rows) {
      const snapMarket = get(r.snapshot_json, ["market"]);
      const holdCode = get(r.snapshot_json, ["hold", "code"]) ?? get(r.snapshot_json, ["decision", "no_bet_reason"]);
      const softCaps = get(r.snapshot_json, ["decision", "soft_caps"]) ?? get(r.snapshot_json, ["soft_caps"]);
      const sideFlags = get(r.snapshot_json, ["decision", "side_disagree_flags"]) ?? get(r.snapshot_json, ["side_disagree_flags"]);
      const recon = get(r.snapshot_json, ["model", "total_reconciliation"]) ?? get(r.snapshot_json, ["total_reconciliation"]);
      const reconCap = recon !== undefined && recon !== null ? get(recon, ["grade_cap"]) : undefined;
      const reconReason = recon !== undefined && recon !== null ? get(recon, ["side_selection_reason"]) : undefined;
      const reconHold = recon !== undefined && recon !== null ? get(recon, ["hold"]) : undefined;

      // classify
      const heldBool = r.held === true || r.no_bet === true;
      let cls: string;
      const reasonText = `${r.no_bet_reason ?? ""} ${r.hold_reason ?? ""} ${String(holdCode ?? "")}`;
      const matchedHard = [...HARD_HOLD_CODES].find((c) => reasonText.includes(c));
      if (heldBool && matchedHard !== undefined) {
        cls = `TRUE BLOCKER (${matchedHard})`;
        trueBlocker++;
      } else if (heldBool) {
        cls = "BLOCKER (held, code unclassified)";
        trueBlocker++;
      } else {
        cls = "SURFACEABLE";
        surfaceable++;
        if (softCaps !== undefined && Array.isArray(softCaps) && softCaps.length > 0) softCaution++;
        if (reconCap !== undefined && reconCap !== null) softCaution++;
      }

      console.log(
        `\n  market=${r.market ?? snapMarket ?? "?"}  pick=${r.pick ?? "?"}  conf=${r.confidence ?? "?"}` +
        `  play_grade=${r.play_grade ?? "null"}`,
      );
      console.log(
        `    held=${r.held}  no_bet=${r.no_bet}  locked_at=${r.locked_at ?? "null"}`,
      );
      console.log(`    no_bet_reason=${r.no_bet_reason ?? "null"}`);
      console.log(`    hold_reason=${r.hold_reason ?? "null"}`);
      if (holdCode !== undefined) console.log(`    snapshot.hold.code=${JSON.stringify(holdCode)}`);
      if (softCaps !== undefined) console.log(`    soft_caps=${JSON.stringify(softCaps)}`);
      if (sideFlags !== undefined) console.log(`    side_disagree_flags=${JSON.stringify(sideFlags)}`);
      if (recon !== undefined && recon !== null) {
        console.log(`    total_reconciliation: grade_cap=${JSON.stringify(reconCap)} hold=${JSON.stringify(reconHold)} reason=${JSON.stringify(reconReason)}`);
      }
      console.log(`    => CLASSIFICATION: ${cls}`);
    }
  }

  console.log("\n" + "=".repeat(78));
  console.log("SUMMARY");
  console.log(`  surfaceable markets:  ${surfaceable}`);
  console.log(`  held / no_bet markets: ${trueBlocker}`);
  console.log(`  (of surfaceable, with soft caps/recon caps): ${softCaution}`);
  console.log("\n  Read-only — no DB writes occurred.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
