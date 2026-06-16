/**
 * Unit tests for app/lab/lib/lineTracker.ts (pure line-tracker evidence).
 * Run: npx tsx scripts/test-line-tracker.ts
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
  buildLineTrackerEvidence({ openAmerican: -170, postedAmerican: null, currentAmerican: -157, lockedAmerican: null }),
  { evidence: "Open -170 · Current -157", hasExtraStops: false });

// Full chain Open → First Published → Current → Locked.
eq("full 4-stop chain",
  buildLineTrackerEvidence({ openAmerican: -170, postedAmerican: -165, currentAmerican: -157, lockedAmerican: -160 }),
  { evidence: "Open -170 · First Published -165 · Current -157 · Locked -160", hasExtraStops: true });

// First Published present, no Locked.
eq("open+posted+current",
  buildLineTrackerEvidence({ openAmerican: -170, postedAmerican: -165, currentAmerican: -157, lockedAmerican: null }),
  { evidence: "Open -170 · First Published -165 · Current -157", hasExtraStops: true });

// Locked-only-after-current (e.g. current null at lock): Open + Locked.
eq("open+locked (current null)",
  buildLineTrackerEvidence({ openAmerican: -170, postedAmerican: null, currentAmerican: null, lockedAmerican: -160 }),
  { evidence: "Open -170 · Locked -160", hasExtraStops: true });

// Positive odds formatting.
eq("positive odds plus sign",
  buildLineTrackerEvidence({ openAmerican: 120, postedAmerican: null, currentAmerican: 135, lockedAmerican: null }),
  { evidence: "Open +120 · Current +135", hasExtraStops: false });

// Single stop → no tracker (can't show a move with one point).
eq("single stop → null evidence",
  buildLineTrackerEvidence({ openAmerican: -170, postedAmerican: null, currentAmerican: null, lockedAmerican: null }),
  { evidence: null, hasExtraStops: false });

// No stops at all.
eq("no stops → null evidence",
  buildLineTrackerEvidence({ openAmerican: null, postedAmerican: null, currentAmerican: null, lockedAmerican: null }),
  { evidence: null, hasExtraStops: false });

// hasExtraStops true even if chain too short to render (drives caller logic).
eq("posted only → extra flag true but evidence null",
  buildLineTrackerEvidence({ openAmerican: null, postedAmerican: -165, currentAmerican: null, lockedAmerican: null }),
  { evidence: null, hasExtraStops: true });

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
