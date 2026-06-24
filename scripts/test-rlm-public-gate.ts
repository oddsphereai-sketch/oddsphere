/**
 * D1 regression: public-% ALONE never yields RLM.
 *
 * Ratified D1 (2026-06-24): RLM requires REAL same-source line movement against
 * the public side. `has_reverse_line_movement` / `rlm_direction` may ONLY come
 * from real movement, never from public betting %. `public_betting_pct` is
 * consumed only as the framework STRENGTH tier, and ONLY AFTER the real-movement
 * gate is satisfied (SHARP_SIGNAL_FRAMEWORK.md Signal 3).
 *
 * Path 1 (behavior delta = 0): the existing framework strength-tiering is
 * PRESERVED and re-asserted here; the new guarantee locked is "public-% alone
 * (no real movement flag) → no RLM", end to end.
 *
 * Run with: npm run test:rlm-public-gate
 */

import {
  classifyRlm,
  classifyEvidence,
  detectPublicSmoke,
} from "../lib/services/signalEvidenceClassifier";
import type { MarketSignalSource } from "../lib/services/marketSignalDerivationService";
import { mapPlaybookSplitsToSharpSignalRecords } from "../lib/providers/playbook/playbookPublicSplitsMapper";
import type { PlaybookSplitGame } from "../lib/providers/playbook/types";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(label: string, cond: boolean): void {
  if (cond) pass++;
  else {
    fail++;
    failures.push(label);
  }
}

function sig(over: Partial<MarketSignalSource>): MarketSignalSource {
  return {
    side: "home",
    is_plus_ev: false,
    ev_pct: null,
    has_steam_move: false,
    steam_books_count: null,
    has_reverse_line_movement: false,
    rlm_direction: null,
    public_betting_pct: null,
    public_money_pct: null,
    ...over,
  } as MarketSignalSource;
}

// ── 1. classifyRlm: public-% alone (no real movement flag) → null ──────────
check("no flag + 90% public → null", classifyRlm(false, "toward_home", 90, "home") === null);
check("no flag + 99% public, no dir → null", classifyRlm(false, null, 99, "home") === null);
check("flag true but no rlm_direction → null", classifyRlm(true, null, 90, "home") === null);

// ── 2. Gate satisfied → public-% IS the strength tier (framework preserved, Δ=0) ──
check("gate + 60% → moderate", classifyRlm(true, "toward_home", 60, "home")?.tier === "moderate");
check("gate + 65% → strong", classifyRlm(true, "toward_home", 65, "home")?.tier === "strong");
check("gate + 70% → very_strong", classifyRlm(true, "toward_home", 70, "home")?.tier === "very_strong");

// ── 3. classifyEvidence: heavy public-% but NO real movement → rlm null ────
const heavyPublicNoMove = sig({
  side: "home",
  public_betting_pct: 90,
  public_money_pct: 88,
  has_reverse_line_movement: false,
  rlm_direction: null,
});
const ev1 = classifyEvidence("home", heavyPublicNoMove);
check("evidence: heavy public, no movement → rlm null", ev1.rlm === null);
// The legitimate public lane is intact (public_smoke still fires).
check("evidence: heavy flat public → publicSmoke present", ev1.publicSmoke !== null);
check("detectPublicSmoke true on heavy flat public", detectPublicSmoke(heavyPublicNoMove) === true);

// ── 4. classifyEvidence: REAL movement flag + direction → rlm present (Δ=0) ──
const realRlm = sig({
  side: "away",
  public_betting_pct: 68,
  public_money_pct: 40,
  has_reverse_line_movement: true,
  rlm_direction: "toward_home",
});
const ev2 = classifyEvidence("home", realRlm);
check("evidence: real RLM flag → rlm tier present (strong)", ev2.rlm !== null && ev2.rlm.tier === "strong");
check("evidence: RLM aligned to model home", ev2.rlm?.aligned === true);

// ── 5. Playbook split mapper → never RLM (provider boundary) ───────────────
const pbRows: PlaybookSplitGame[] = [
  {
    gameId: "g1",
    awayTeamName: "New York Yankees",
    homeTeamName: "Boston Red Sox",
    splits: {
      moneyline: {
        bets: { homePercent: 80, awayPercent: 20 },
        money: { homePercent: 78, awayPercent: 22 },
        source: { booksUsed: 10 },
      },
    },
  } as PlaybookSplitGame,
];
const mapped = mapPlaybookSplitsToSharpSignalRecords({
  sport: "mlb",
  rows: pbRows,
  gameExternalIdByKey: new Map([["NYY@BOS", 1]]),
  computedAt: "2026-06-24T00:00:00Z",
});
const homeMl = mapped.records.find((r) => r.market_type === "moneyline" && r.side === "home");
check("Playbook split → has_reverse_line_movement false", homeMl?.has_reverse_line_movement === false);
check("Playbook split → rlm_direction null", homeMl?.rlm_direction === null);
check(
  "Playbook split (80% public) → classifyEvidence rlm null",
  classifyEvidence("home", homeMl as MarketSignalSource).rlm === null
);

// ── Report ─────────────────────────────────────────────────────────────────
console.log(`\nrlm-public-gate: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("\nFailures:");
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("✓ all assertions passed — public-% alone never yields RLM; framework strength-tiering preserved (Δ=0)");
