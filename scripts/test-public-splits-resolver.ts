/**
 * Pure tests for dual-provider public splits resolution.
 *
 * No network, no DB, no production writes.
 */

import {
  resolvePublicSplit,
  type PublicSplitObservation,
} from "../lib/services/publicSplitsResolver";

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

const now = new Date("2026-06-24T16:00:00.000Z");

function obs(
  provider: PublicSplitObservation["provider"],
  betting: number | null,
  money: number | null,
  overrides: Partial<PublicSplitObservation> = {}
): PublicSplitObservation {
  return {
    provider,
    public_betting_pct: betting,
    public_money_pct: money,
    books_used: provider === "playbook" ? 11 : null,
    observed_at: "2026-06-24T15:45:00.000Z",
    ...overrides,
  };
}

const aligned = resolvePublicSplit({
  now,
  playbook: obs("playbook", 64, 61),
  sharpapi: obs("sharpapi", 66, 63),
});
check("aligned providers use Playbook display", aligned.displaySource === "playbook");
check("aligned display uses Playbook betting pct", aligned.displayBettingPct === 64);
check("aligned display uses Playbook money pct", aligned.displayMoneyPct === 61);
check("aligned providers are high confidence", aligned.modelConfidence === "high");
check("aligned state is aligned", aligned.agreementState === "aligned");
check("aligned max gap is computed", aligned.providerGapPct.max === 2);

const major = resolvePublicSplit({
  now,
  playbook: obs("playbook", 64, 61),
  sharpapi: obs("sharpapi", 66, 94),
});
check("major disagreement still uses Playbook display", major.displaySource === "playbook");
check("major disagreement does not average money pct", major.displayMoneyPct === 61);
check("major disagreement is low confidence", major.modelConfidence === "low");
check("major disagreement state is major", major.agreementState === "major_disagreement");
check("major disagreement money gap is preserved", major.providerGapPct.money === 33);

const mild = resolvePublicSplit({
  now,
  playbook: obs("playbook", 64, 61),
  sharpapi: obs("sharpapi", 77, 74),
});
check("mild disagreement is medium confidence", mild.modelConfidence === "medium");
check("mild disagreement state is mild", mild.agreementState === "mild_disagreement");

const playbookMissing = resolvePublicSplit({
  now,
  playbook: null,
  sharpapi: obs("sharpapi", 55, 58),
});
check("SharpAPI fills display when Playbook missing", playbookMissing.displaySource === "sharpapi");
check("single source is medium confidence", playbookMissing.modelConfidence === "medium");
check("single source state", playbookMissing.agreementState === "single_source");

const playbookIncomplete = resolvePublicSplit({
  now,
  playbook: obs("playbook", 64, null),
  sharpapi: obs("sharpapi", 59, 62),
});
check("incomplete Playbook falls back to SharpAPI", playbookIncomplete.displaySource === "sharpapi");
check("incomplete Playbook does not produce fake agreement", playbookIncomplete.agreementState === "single_source");

const playbookStale = resolvePublicSplit({
  now,
  playbook: obs("playbook", 64, 61, { observed_at: "2026-06-24T15:40:00.000Z" }),
  sharpapi: obs("sharpapi", 59, 62),
});
check("stale Playbook falls back to SharpAPI", playbookStale.displaySource === "sharpapi");

const noData = resolvePublicSplit({
  now,
  playbook: obs("playbook", null, null),
  sharpapi: null,
});
check("no usable data has no display source", noData.displaySource === null);
check("no usable data has no model confidence", noData.modelConfidence === "none");
check("no usable data state", noData.agreementState === "no_data");

console.log(`\npublic-splits-resolver: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error("\nFailures:");
  for (const f of failures) console.error(`  x ${f}`);
  process.exit(1);
}
console.log("all assertions passed");
