/**
 * Tests for lib/services/snapshotStalenessDetector.ts.
 *
 * The detector is pure — no I/O. Tests cover each material-change rule
 * + the no-change case + edge cases (missing rows, null fields).
 */

import {
  detectSnapshotStaleness,
  type StalenessSignalRow,
} from "../lib/services/snapshotStalenessDetector";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; const msg = `${label}${hint ? ` — ${hint}` : ""}`; console.log(`  ✗ ${msg}`); failures.push(msg); }
}

function mkSig(market: string, side: string, money: number | null, bets: number | null, steam = false, rlm = false): StalenessSignalRow {
  return {
    market_type: market,
    side,
    public_money_pct: money,
    public_betting_pct: bets,
    has_steam_move: steam,
    has_reverse_line_movement: rlm,
  };
}

console.log("\n━━━ baseline: no material change ━━━");
{
  const snap = [mkSig("moneyline", "home", 55, 50), mkSig("moneyline", "away", 45, 50)];
  const live = [mkSig("moneyline", "home", 57, 51), mkSig("moneyline", "away", 43, 49)];
  const r = detectSnapshotStaleness({ snapshotSignals: snap, liveSignals: live, pickedMl: "home", pickedTotal: null });
  check("identical-ish signals → stale=false", r.stale === false, JSON.stringify(r));
}
{
  const snap = [mkSig("moneyline", "home", 50, 50), mkSig("moneyline", "away", 50, 50)];
  const live = [mkSig("moneyline", "home", 50, 50), mkSig("moneyline", "away", 50, 50)];
  const r = detectSnapshotStaleness({ snapshotSignals: snap, liveSignals: live, pickedMl: "home", pickedTotal: null });
  check("exact match → stale=false", r.stale === false);
}

console.log("\n━━━ money-conflict flip (the STL@NYM case) ━━━");
{
  // Snapshot: opposing money 91%, bets 54% → conflict fired
  // Live: opposing money 22%, bets 52% → no conflict
  const snap = [mkSig("moneyline", "home", 9, 46), mkSig("moneyline", "away", 91, 54)];
  const live = [mkSig("moneyline", "home", 78, 48), mkSig("moneyline", "away", 22, 52)];
  const r = detectSnapshotStaleness({ snapshotSignals: snap, liveSignals: live, pickedMl: "home", pickedTotal: null });
  check("conflict flip (true→false) → stale=true", r.stale === true);
  check("reasons include money_conflict_flip_ml", r.reasons.includes("money_conflict_flip_ml"));
}
{
  // Reverse: snapshot no conflict (opp money 50/50 split), live conflict (opp money 80/40)
  const snap = [mkSig("moneyline", "home", 50, 50), mkSig("moneyline", "away", 50, 50)];
  const live = [mkSig("moneyline", "home", 20, 60), mkSig("moneyline", "away", 80, 40)];
  const r = detectSnapshotStaleness({ snapshotSignals: snap, liveSignals: live, pickedMl: "home", pickedTotal: null });
  check("conflict flip (false→true) → stale=true", r.stale === true);
  check("reasons include money_conflict_flip_ml", r.reasons.includes("money_conflict_flip_ml"));
}

console.log("\n━━━ money/bets deltas at threshold ━━━");
{
  // Picked-side money up 12pp → should fire
  const snap = [mkSig("moneyline", "home", 55, 50), mkSig("moneyline", "away", 45, 50)];
  const live = [mkSig("moneyline", "home", 67, 50), mkSig("moneyline", "away", 33, 50)];
  const r = detectSnapshotStaleness({ snapshotSignals: snap, liveSignals: live, pickedMl: "home", pickedTotal: null });
  check("picked money delta 12pp → stale=true", r.stale === true);
  check("reasons include picked_money_pct_delta", r.reasons.includes("picked_money_pct_delta"));
}
{
  // Picked-side money up 9pp → should NOT fire (below threshold)
  const snap = [mkSig("moneyline", "home", 50, 50), mkSig("moneyline", "away", 50, 50)];
  const live = [mkSig("moneyline", "home", 59, 51), mkSig("moneyline", "away", 41, 49)];
  const r = detectSnapshotStaleness({ snapshotSignals: snap, liveSignals: live, pickedMl: "home", pickedTotal: null });
  check("picked money delta 9pp → stale=false (just below threshold)", r.stale === false, JSON.stringify(r));
}
{
  // Opposing-side bets delta 11pp → should fire
  const snap = [mkSig("moneyline", "home", 50, 50), mkSig("moneyline", "away", 50, 50)];
  const live = [mkSig("moneyline", "home", 50, 50), mkSig("moneyline", "away", 50, 61)];
  const r = detectSnapshotStaleness({ snapshotSignals: snap, liveSignals: live, pickedMl: "home", pickedTotal: null });
  check("opp bets delta 11pp → stale=true", r.stale === true);
  check("reasons include opp_bets_pct_delta", r.reasons.includes("opp_bets_pct_delta"));
}

console.log("\n━━━ steam + rlm flips ━━━");
{
  const snap = [mkSig("moneyline", "home", 50, 50, false, false), mkSig("moneyline", "away", 50, 50, false, false)];
  const live = [mkSig("moneyline", "home", 50, 50, true, false), mkSig("moneyline", "away", 50, 50, false, false)];
  const r = detectSnapshotStaleness({ snapshotSignals: snap, liveSignals: live, pickedMl: "home", pickedTotal: null });
  check("steam true on picked side → stale=true", r.stale === true);
  check("reasons include steam_flip", r.reasons.includes("steam_flip"));
}
{
  const snap = [mkSig("moneyline", "home", 50, 50, false, false), mkSig("moneyline", "away", 50, 50, false, false)];
  const live = [mkSig("moneyline", "home", 50, 50, false, false), mkSig("moneyline", "away", 50, 50, false, true)];
  const r = detectSnapshotStaleness({ snapshotSignals: snap, liveSignals: live, pickedMl: "home", pickedTotal: null });
  check("rlm true on opp side → stale=true", r.stale === true);
  check("reasons include rlm_flip", r.reasons.includes("rlm_flip"));
}

console.log("\n━━━ total market independently checked ━━━");
{
  const snap = [
    mkSig("moneyline", "home", 50, 50), mkSig("moneyline", "away", 50, 50),
    mkSig("total", "over", 50, 50), mkSig("total", "under", 50, 50),
  ];
  const live = [
    mkSig("moneyline", "home", 50, 50), mkSig("moneyline", "away", 50, 50),
    mkSig("total", "over", 70, 50), mkSig("total", "under", 30, 50),
  ];
  const r = detectSnapshotStaleness({ snapshotSignals: snap, liveSignals: live, pickedMl: "home", pickedTotal: "over" });
  check("total picked-side money delta 20pp → stale=true", r.stale === true);
  check("reasons include picked_money_pct_delta", r.reasons.includes("picked_money_pct_delta"));
}
{
  const snap = [
    mkSig("total", "over", 50, 50), mkSig("total", "under", 50, 50),
  ];
  const live = [
    mkSig("total", "over", 100, 59), mkSig("total", "under", 0, 41),
  ];
  // The user's SEA@BAL 100/0 case: total flipped to extreme conflict (under was picked say)
  const r = detectSnapshotStaleness({ snapshotSignals: snap, liveSignals: live, pickedMl: null, pickedTotal: "under" });
  check("100/0 flip → stale=true", r.stale === true);
  check("reasons include money_conflict_flip_total", r.reasons.includes("money_conflict_flip_total"));
}

console.log("\n━━━ null / missing data — defensive ━━━");
{
  // Snapshot has signals but live doesn't (provider dropped them)
  const snap = [mkSig("moneyline", "home", 50, 50), mkSig("moneyline", "away", 50, 50)];
  const live: StalenessSignalRow[] = [];
  const r = detectSnapshotStaleness({ snapshotSignals: snap, liveSignals: live, pickedMl: "home", pickedTotal: null });
  check("live signals empty → stale=true (missing_live_signal)", r.stale === true);
  check("reasons include missing_live_signal", r.reasons.includes("missing_live_signal"));
}
{
  // Live has signals but snapshot doesn't (very new game)
  const snap: StalenessSignalRow[] = [];
  const live = [mkSig("moneyline", "home", 50, 50), mkSig("moneyline", "away", 50, 50)];
  const r = detectSnapshotStaleness({ snapshotSignals: snap, liveSignals: live, pickedMl: "home", pickedTotal: null });
  check("snapshot signals empty → stale=true (missing_snapshot_signal)", r.stale === true);
  check("reasons include missing_snapshot_signal", r.reasons.includes("missing_snapshot_signal"));
}
{
  // Both null → no triggers
  const snap = [{ market_type: "moneyline", side: "home", public_money_pct: null, public_betting_pct: null, has_steam_move: null, has_reverse_line_movement: null }, { market_type: "moneyline", side: "away", public_money_pct: null, public_betting_pct: null, has_steam_move: null, has_reverse_line_movement: null }];
  const live = [{ market_type: "moneyline", side: "home", public_money_pct: null, public_betting_pct: null, has_steam_move: null, has_reverse_line_movement: null }, { market_type: "moneyline", side: "away", public_money_pct: null, public_betting_pct: null, has_steam_move: null, has_reverse_line_movement: null }];
  const r = detectSnapshotStaleness({ snapshotSignals: snap, liveSignals: live, pickedMl: "home", pickedTotal: null });
  check("both sides null on both sides → stale=false (nothing observable)", r.stale === false);
}
{
  // pickedMl null + pickedTotal null → trivially no-op
  const snap = [mkSig("moneyline", "home", 0, 0), mkSig("moneyline", "away", 100, 100)];
  const live = [mkSig("moneyline", "home", 100, 100), mkSig("moneyline", "away", 0, 0)];
  const r = detectSnapshotStaleness({ snapshotSignals: snap, liveSignals: live, pickedMl: null, pickedTotal: null });
  check("no picks → stale=false (no comparison performed)", r.stale === false);
}

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n✅ snapshot-staleness-detector tests passed.");
