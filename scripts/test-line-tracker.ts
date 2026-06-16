/**
 * Unit tests for app/lab/lib/lineTracker.ts (pure line-tracker evidence).
 * Run: npx tsx scripts/test-line-tracker.ts
 *
 * NOTE (2026-06-16): "First Published" / "Model Posted" is no longer a tracker
 * stop. Stops are only Open · Previous · Current · Locked.
 */
import { buildLineTrackerEvidence } from "../app/lab/lib/lineTracker";

let failures = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failures++; console.error(`✗ ${name}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`); }
  else console.log(`✓ ${name}`);
}

// Degrade: only Open + Current → labeled two-stop (no extra stops).
eq("open+current only",
  buildLineTrackerEvidence({ openAmerican: -170, currentAmerican: -157, lockedAmerican: null }),
  { evidence: "Open -170 · Current -157", hasExtraStops: false });

// Full chain Open → Previous → Current → Locked.
eq("full 4-stop chain",
  buildLineTrackerEvidence({ openAmerican: -170, previousAmerican: -150, currentAmerican: -157, lockedAmerican: -160 }),
  { evidence: "Open -170 · Previous -150 · Current -157 · Locked -160", hasExtraStops: true });

// Previous stop (last move) inserted before Current when it differs.
eq("previous stop present when differs from current",
  buildLineTrackerEvidence({ openAmerican: -170, previousAmerican: -150, currentAmerican: -157, lockedAmerican: null }),
  { evidence: "Open -170 · Previous -150 · Current -157", hasExtraStops: true });
eq("previous stop omitted when equal to current (no redundant stop)",
  buildLineTrackerEvidence({ openAmerican: -170, previousAmerican: -157, currentAmerican: -157, lockedAmerican: null }),
  { evidence: "Open -170 · Current -157", hasExtraStops: false });

// Open + Current, no Previous/Locked.
eq("open+current (no previous, no locked)",
  buildLineTrackerEvidence({ openAmerican: -170, currentAmerican: -157, lockedAmerican: null }),
  { evidence: "Open -170 · Current -157", hasExtraStops: false });

// Locked-only-after-current (e.g. current null at lock): Open + Locked.
eq("open+locked (current null)",
  buildLineTrackerEvidence({ openAmerican: -170, currentAmerican: null, lockedAmerican: -160 }),
  { evidence: "Open -170 · Locked -160", hasExtraStops: true });

// Positive odds formatting.
eq("positive odds plus sign",
  buildLineTrackerEvidence({ openAmerican: 120, currentAmerican: 135, lockedAmerican: null }),
  { evidence: "Open +120 · Current +135", hasExtraStops: false });

// Single stop → no tracker (can't show a move with one point).
eq("single stop → null evidence",
  buildLineTrackerEvidence({ openAmerican: -170, currentAmerican: null, lockedAmerican: null }),
  { evidence: null, hasExtraStops: false });

// No stops at all.
eq("no stops → null evidence",
  buildLineTrackerEvidence({ openAmerican: null, currentAmerican: null, lockedAmerican: null }),
  { evidence: null, hasExtraStops: false });

// hasExtraStops true via previous even if chain too short to render.
eq("previous only → extra flag true but evidence null",
  buildLineTrackerEvidence({ openAmerican: null, previousAmerican: -165, currentAmerican: null, lockedAmerican: null }),
  { evidence: null, hasExtraStops: true });

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
