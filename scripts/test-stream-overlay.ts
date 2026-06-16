/**
 * Unit tests for lib/services/streamOverlay.ts pickFresherCurrent (pure).
 * Proves the overlay uses the stream price ONLY when it is fresher than cron.
 * Run: npx tsx scripts/test-stream-overlay.ts
 */
import { pickFresherCurrent, streamKey } from "../lib/services/streamOverlay";

let failures = 0;
function eq(name: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failures++; console.error(`✗ ${name}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`); }
  else console.log(`✓ ${name}`);
}

const NOW = Date.parse("2026-06-16T18:00:00Z");
const OLD = "2026-06-16T17:00:00Z"; // 1h before now
const NEW = "2026-06-16T17:59:00Z"; // 1m before now (fresher than OLD)

// No stream → cron unchanged.
eq("no stream → cron",
  pickFresherCurrent({ american: -150, observedAt: OLD }, null, NOW),
  { american: -150, observedAt: OLD });

// Stream with null price → cron unchanged.
eq("stream null price → cron",
  pickFresherCurrent({ american: -150, observedAt: OLD }, { american: null, line: null, observedAt: NEW }, NOW),
  { american: -150, observedAt: OLD });

// Cron stale (OLD), stream newer (NEW) → stream wins.
eq("stream fresher than stale cron → stream",
  pickFresherCurrent({ american: -150, observedAt: OLD }, { american: -135, line: null, observedAt: NEW }, NOW),
  { american: -135, observedAt: NEW });

// Cron from LIVE lines (null stamp = now) beats an older stream tick.
eq("live cron (null stamp) beats older stream",
  pickFresherCurrent({ american: -150, observedAt: null }, { american: -135, line: null, observedAt: OLD }, NOW),
  { american: -150, observedAt: null });

// Cron price null → stream fills in (any timestamp).
eq("cron null price → stream fills",
  pickFresherCurrent({ american: null, observedAt: null }, { american: -135, line: null, observedAt: OLD }, NOW),
  { american: -135, observedAt: OLD });

// Stream older than cron stamp → cron wins.
eq("stream older than cron → cron",
  pickFresherCurrent({ american: -150, observedAt: NEW }, { american: -135, line: null, observedAt: OLD }, NOW),
  { american: -150, observedAt: NEW });

// Equal timestamps → cron wins (stream must be strictly newer).
eq("equal timestamps → cron",
  pickFresherCurrent({ american: -150, observedAt: NEW }, { american: -135, line: null, observedAt: NEW }, NOW),
  { american: -150, observedAt: NEW });

// streamKey shape.
eq("streamKey", streamKey(777, "moneyline", "home"), "777::moneyline::home");

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
