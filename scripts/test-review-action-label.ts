/**
 * Unit tests for app/lab/lib/reviewActionLabel.ts — member-facing reviewer
 * action labels. Guards against raw "cap"/"dampen" jargon reaching members.
 * Run: npx tsx scripts/test-review-action-label.ts
 */
import { reviewActionLabel } from "../app/lab/lib/reviewActionLabel";

let failures = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) { failures++; console.error(`✗ ${name}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`); }
  else console.log(`✓ ${name}`);
}

// Plain-English mappings (no raw cap/dampen jargon).
eq("cap_confidence → Confidence limited", reviewActionLabel("cap_confidence"), "Confidence limited");
eq("dampen_confidence → Confidence limited", reviewActionLabel("dampen_confidence"), "Confidence limited");
eq("hold → Market conflict", reviewActionLabel("hold"), "Market conflict");
eq("adjust_score_toward_market → Projection eased toward market", reviewActionLabel("adjust_score_toward_market"), "Projection eased toward market");
eq("downgrade_grade → Signal mixed", reviewActionLabel("downgrade_grade"), "Signal mixed");
eq("flip_side → Signal mixed", reviewActionLabel("flip_side"), "Signal mixed");
eq("keep → null (nothing shown)", reviewActionLabel("keep"), null);

// No label contains banned raw jargon.
const banned = /capped|confidence cap|grade_cap|distance_cap|dampen/i;
const actions = ["cap_confidence", "dampen_confidence", "hold", "adjust_score_toward_market", "downgrade_grade", "flip_side", "keep"] as const;
for (const a of actions) {
  const label = reviewActionLabel(a);
  eq(`'${a}' label free of raw jargon`, label === null ? true : !banned.test(label), true);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
