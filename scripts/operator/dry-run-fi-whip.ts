/**
 * Operator dry-run — FI WHIP modifier impact on the current visible slate.
 *
 * READ-ONLY. No DB writes. No prediction regeneration. Pure compute on
 * snapshots in memory. Outputs a comparison table:
 *
 *   per game: old expected_runs vs new (with WHIP) vs delta
 *   per game: old zone / pick / confidence / decision_kind vs new
 *   per game: WHIP-related reason codes added
 *
 * Usage:
 *   npm run dev    # (don't need; this hits supabase directly)
 *   set -a && . .env.local && set +a
 *   npx tsx scripts/operator/dry-run-fi-whip.ts
 *
 * The script:
 *   1. Loads feature snapshots for the most recent visible slate
 *   2. For each game, runs the model TWICE:
 *      a. "OLD": clones the snapshot with both starters' first_inning_whip
 *         set to null → forces the WHIP modifier to 1.0
 *      b. "NEW": runs against the snapshot as-is, with WHIP from DB
 *   3. Prints a comparison table
 *
 * Use this output to manually verify no game swings wildly before
 * approving any prediction regeneration.
 */

import { supabase } from "../../lib/db/supabase";
import { buildFeatureSnapshots } from "../../lib/automodel/featureSnapshot";
import { runMlbAutoModelV1 } from "../../lib/automodel/mlbAutoModelV1";
import type { GameSnapshot, StarterSnapshot } from "../../lib/automodel/types";

function stripWhip(s: StarterSnapshot | null): StarterSnapshot | null {
  if (s === null) return null;
  return { ...s, first_inning_whip: null };
}

function cloneWithoutWhip(snapshot: GameSnapshot): GameSnapshot {
  return {
    ...snapshot,
    home_starter: stripWhip(snapshot.home_starter),
    away_starter: stripWhip(snapshot.away_starter),
  };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

function padNum(v: number | null | undefined, width = 6, decimals = 2): string {
  if (v === null || v === undefined) return pad("—", width);
  return pad(v.toFixed(decimals), width);
}

async function main() {
  // Pick a slate via SLATE_DATE env override, OR the most recent
  // PUBLISHED slate (matches what /api/lab/daily-edge falls back to).
  // The most recent draft slate often has no confirmed starters, which
  // makes the dry-run uninformative.
  const slateOverride = process.env.SLATE_DATE;
  let slateDate: string;
  if (slateOverride) {
    slateDate = slateOverride;
  } else {
    const { data: latestGames, error: lgErr } = await supabase
      .from("games")
      .select("slate_date")
      .eq("sport", "mlb")
      .eq("slate_status", "published")
      .order("slate_date", { ascending: false })
      .limit(1);
    if (lgErr || !latestGames || latestGames.length === 0) {
      console.error("No visible slate found:", lgErr);
      process.exit(1);
    }
    slateDate = latestGames[0]!.slate_date as string;
  }
  console.log(`Slate: ${slateDate}\n`);

  // Build feature snapshots for that slate
  const snapshots = await buildFeatureSnapshots("mlb", slateDate);
  console.log(`Loaded ${snapshots.length} game snapshots\n`);

  // Run model twice per game
  type Row = {
    matchup: string;
    homeWhip: number | null;
    homeStarts: number | null;
    awayWhip: number | null;
    awayStarts: number | null;
    oldExpected: number | null;
    newExpected: number | null;
    delta: number | null;
    oldZone: string | null;
    newZone: string | null;
    oldPick: string;
    newPick: string;
    oldConf: number | null;
    newConf: number | null;
    oldDecisionKind: string | null;
    newDecisionKind: string | null;
    whipCodesAdded: string[];
    whipCodesRemoved: string[];
  };
  const rows: Row[] = [];

  for (const snap of snapshots) {
    const oldOut = runMlbAutoModelV1(cloneWithoutWhip(snap), "morning_draft");
    const newOut = runMlbAutoModelV1(snap, "morning_draft");

    const oldSS = oldOut.sport_specific;
    const newSS = newOut.sport_specific;
    const oldRuns = oldSS.auto_factors.nrfi_expected_runs;
    const newRuns = newSS.auto_factors.nrfi_expected_runs;
    const oldCodes = new Set(oldSS.nrfi_reason_codes ?? []);
    const newCodes = new Set(newSS.nrfi_reason_codes ?? []);
    const whipPrefix = ["fi_whip_", "low_fi_whip_"];
    const added: string[] = [];
    const removed: string[] = [];
    for (const c of newCodes) {
      if (!oldCodes.has(c) && whipPrefix.some((p) => c.startsWith(p))) added.push(c);
    }
    for (const c of oldCodes) {
      if (!newCodes.has(c) && whipPrefix.some((p) => c.startsWith(p))) removed.push(c);
    }

    rows.push({
      matchup: `${snap.away_team.abbreviation} @ ${snap.home_team.abbreviation}`,
      homeWhip: snap.home_starter?.first_inning_whip ?? null,
      homeStarts: snap.home_starter?.first_inning_starts ?? null,
      awayWhip: snap.away_starter?.first_inning_whip ?? null,
      awayStarts: snap.away_starter?.first_inning_starts ?? null,
      oldExpected: oldRuns,
      newExpected: newRuns,
      delta:
        oldRuns !== null && newRuns !== null ? newRuns - oldRuns : null,
      oldZone: oldSS.nrfi_threshold_zone ?? null,
      newZone: newSS.nrfi_threshold_zone ?? null,
      oldPick:
        oldOut.predicted_nrfi === true
          ? "NRFI"
          : oldOut.predicted_nrfi === false
            ? "YRFI"
            : oldSS.nrfi_decision_kind === "toss_up"
              ? "Toss-Up"
              : oldSS.nrfi_decision_kind === "held"
                ? "Held"
                : "—",
      newPick:
        newOut.predicted_nrfi === true
          ? "NRFI"
          : newOut.predicted_nrfi === false
            ? "YRFI"
            : newSS.nrfi_decision_kind === "toss_up"
              ? "Toss-Up"
              : newSS.nrfi_decision_kind === "held"
                ? "Held"
                : "—",
      oldConf: oldOut.nrfi_confidence ?? null,
      newConf: newOut.nrfi_confidence ?? null,
      oldDecisionKind: oldSS.nrfi_decision_kind ?? null,
      newDecisionKind: newSS.nrfi_decision_kind ?? null,
      whipCodesAdded: added,
      whipCodesRemoved: removed,
    });
  }

  // Sort by absolute delta descending so the biggest movers are at the top
  rows.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));

  // Header
  console.log(
    pad("Game", 14),
    pad("AWAY WHIP/St", 14),
    pad("HOME WHIP/St", 14),
    pad("Old E[R]", 9),
    pad("New E[R]", 9),
    pad("Δ", 8),
    pad("Old Zone", 12),
    pad("New Zone", 12),
    pad("Pick old→new", 18),
    pad("Conf old→new", 14),
  );
  console.log("─".repeat(140));

  let bigMovers = 0;
  let pickChanges = 0;
  let zoneChanges = 0;
  let confChanges = 0;

  for (const r of rows) {
    const dAbs = Math.abs(r.delta ?? 0);
    if (dAbs > 0.10) bigMovers++;
    if (r.oldPick !== r.newPick) pickChanges++;
    if (r.oldZone !== r.newZone) zoneChanges++;
    if ((r.oldConf ?? -1) !== (r.newConf ?? -1)) confChanges++;
    const flag = dAbs > 0.10 ? "⚠" : " ";
    console.log(
      flag + " ",
      pad(r.matchup, 12),
      pad(
        `${padNum(r.awayWhip, 5)}/${r.awayStarts ?? "—"}`,
        14
      ),
      pad(
        `${padNum(r.homeWhip, 5)}/${r.homeStarts ?? "—"}`,
        14
      ),
      padNum(r.oldExpected, 9),
      padNum(r.newExpected, 9),
      pad(
        (r.delta !== null
          ? (r.delta >= 0 ? "+" : "") + r.delta.toFixed(3)
          : "—"),
        8
      ),
      pad(r.oldZone ?? "—", 12),
      pad(r.newZone ?? "—", 12),
      pad(`${r.oldPick} → ${r.newPick}`, 18),
      pad(`${r.oldConf ?? "—"} → ${r.newConf ?? "—"}`, 14),
    );
    if (r.whipCodesAdded.length > 0) {
      console.log(
        pad("", 16),
        "  + reason codes:",
        r.whipCodesAdded.join(", ")
      );
    }
  }

  console.log("─".repeat(140));
  console.log(`\nTotal games: ${rows.length}`);
  console.log(`Games with |Δ expected_runs| > 0.10: ${bigMovers}`);
  console.log(`Games where pick label changed: ${pickChanges}`);
  console.log(`Games where threshold_zone changed: ${zoneChanges}`);
  console.log(`Games where confidence changed: ${confChanges}`);

  console.log("\nLegend:");
  console.log("  Old = model run with first_inning_whip forced to null on both starters (pre-WHIP behavior)");
  console.log("  New = model run with first_inning_whip from DB (WHIP modifier active)");
  console.log("  ⚠   = expected_runs delta exceeds 0.10 (worth manual review)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
