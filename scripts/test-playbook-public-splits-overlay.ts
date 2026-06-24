/**
 * Pure tests for Playbook public-splits overlay.
 *
 * No network, no DB, no production writes.
 */

import { overlayPlaybookPublicSplits } from "../lib/providers/playbook/playbookPublicSplitsOverlay";
import type { SharpSignalRecord } from "../lib/providers/interfaces/ISharpSignalProvider";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, ok: boolean) {
  if (ok) pass++;
  else {
    fail++;
    failures.push(label);
  }
}

function signal(overrides: Partial<SharpSignalRecord> = {}): SharpSignalRecord {
  return {
    game_external_id: 1001,
    market_type: "moneyline",
    side: "home",
    pinnacle_fair_probability: 0.56,
    is_plus_ev: true,
    ev_pct: 3.2,
    has_steam_move: true,
    steam_detected_at: "2026-06-24T13:00:00.000Z",
    steam_books_count: 4,
    has_reverse_line_movement: true,
    rlm_direction: "toward_home",
    public_betting_pct: 52,
    public_money_pct: 57,
    signal_strength: "strong",
    signal_summary: "SharpAPI-owned context",
    computed_at: "2026-06-24T13:00:00.000Z",
    ...overrides,
  };
}

const base = signal();
const playbookOverlay = signal({
  pinnacle_fair_probability: null,
  is_plus_ev: false,
  ev_pct: null,
  has_steam_move: false,
  steam_detected_at: null,
  steam_books_count: null,
  has_reverse_line_movement: false,
  rlm_direction: null,
  public_betting_pct: 64,
  public_money_pct: 71,
  signal_strength: null,
  signal_summary: null,
  computed_at: "2026-06-24T14:00:00.000Z",
});

const merged = overlayPlaybookPublicSplits([base], [playbookOverlay]);
const out = merged.records[0]!;

check("updates public betting pct", out.public_betting_pct === 64);
check("updates public money pct", out.public_money_pct === 71);
check("uses overlay freshness when public field changes", out.computed_at === "2026-06-24T14:00:00.000Z");
check("preserves SharpAPI fair probability", out.pinnacle_fair_probability === 0.56);
check("preserves SharpAPI +EV", out.is_plus_ev === true && out.ev_pct === 3.2);
check("preserves SharpAPI steam", out.has_steam_move === true && out.steam_books_count === 4);
check("preserves SharpAPI RLM", out.has_reverse_line_movement === true && out.rlm_direction === "toward_home");
check("preserves signal summary/strength", out.signal_strength === "strong" && out.signal_summary === "SharpAPI-owned context");
check("counts one public update", merged.stats.publicFieldsUpdated === 1);

const partial = overlayPlaybookPublicSplits(
  [signal({ public_betting_pct: 58, public_money_pct: 62 })],
  [signal({ public_betting_pct: null, public_money_pct: 68, computed_at: "2026-06-24T15:00:00.000Z" })]
).records[0]!;
check("null Playbook betting pct preserves base pct", partial.public_betting_pct === 58);
check("non-null Playbook money pct overlays base pct", partial.public_money_pct === 68);

const playbookOnly = signal({
  game_external_id: 2002,
  market_type: "total",
  side: "over",
  pinnacle_fair_probability: null,
  is_plus_ev: false,
  ev_pct: null,
  has_steam_move: false,
  steam_detected_at: null,
  steam_books_count: null,
  has_reverse_line_movement: false,
  rlm_direction: null,
  public_betting_pct: 61,
  public_money_pct: 59,
  signal_strength: null,
  signal_summary: null,
});
const appended = overlayPlaybookPublicSplits([], [playbookOnly]);
check("appends Playbook-only public row", appended.records.length === 1);
check("appended row remains public-only", appended.records[0]!.is_plus_ev === false && appended.records[0]!.ev_pct === null);
check("counts appended public row", appended.stats.playbookOnlyRowsAppended === 1);

const skipped = overlayPlaybookPublicSplits([base], [
  signal({ public_betting_pct: null, public_money_pct: null }),
]);
check("skips overlay rows with no public cells", skipped.stats.overlayRowsSkippedNoPublicCells === 1);
check("empty-public overlay leaves base untouched", skipped.records[0]!.public_betting_pct === 52);

const dupes = overlayPlaybookPublicSplits([base], [playbookOverlay, signal({ public_betting_pct: 99 })]);
check("ignores duplicate overlay rows deterministically", dupes.stats.duplicateOverlayRowsIgnored === 1);
check("first overlay row wins duplicate key", dupes.records[0]!.public_betting_pct === 64);

console.log(`\nplaybook-public-splits-overlay: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("\nFailures:");
  for (const f of failures) console.error(`  x ${f}`);
  process.exit(1);
}
console.log("all assertions passed");
