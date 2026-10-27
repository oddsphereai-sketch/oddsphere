import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  SHARED_DERIVATION_LOCK_GUARD_RELEASE,
  isUnlockedForSharedDerivation,
} from "../lib/services/sharedDerivationLockGuard";

const root = fileURLToPath(new URL("../", import.meta.url));
const marketSignalSource = readFileSync(
  `${root}lib/services/marketSignalDerivationService.ts`,
  "utf8",
);
const gradeSource = readFileSync(
  `${root}lib/services/gradeDerivationService.ts`,
  "utf8",
);

assert.equal(isUnlockedForSharedDerivation(null), true);
assert.equal(
  isUnlockedForSharedDerivation("2026-10-27T12:00:00.000Z"),
  false,
);
assert.match(
  SHARED_DERIVATION_LOCK_GUARD_RELEASE,
  /^shared_derivation_lock_guard_2026_10_27_r1_/,
);

for (const [service, source] of [
  ["market signal", marketSignalSource],
  ["grade", gradeSource],
] as const) {
  assert.match(
    source,
    /\.select\(\s*"id, game_id,[^"]*locked_at"\s*\)\s*\.in\("game_id", gameIds\)/,
    `${service} derivation must load locked_at with game_predictions`,
  );
  assert.match(
    source,
    /!isUnlockedForSharedDerivation\(row\.locked_at\)/,
    `${service} derivation must exclude already locked rows`,
  );
  assert.match(
    source,
    /\.eq\("id", id\)\s*\.is\("locked_at", null\)\s*\.select\("id"\)/,
    `${service} update must repeat the unlocked predicate and return matches`,
  );
  assert.match(
    source,
    /if \(\(updatedRows \?\? \[\]\)\.length === 0\) continue;/,
    `${service} telemetry must not count a write lost to a concurrent lock`,
  );
}

console.log(
  "shared derivation lock immutability: read filter, write predicate, and race-safe counts verified",
);
