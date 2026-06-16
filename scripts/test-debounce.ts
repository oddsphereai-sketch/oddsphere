/**
 * Unit tests for lib/streaming/debounce.ts — MovementDebouncer.
 * Time is injected (ms epoch) so these are deterministic.
 * Run: npx tsx scripts/test-debounce.ts
 */
import { MovementDebouncer } from "../lib/streaming/debounce";

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) { failures++; console.error(`✗ ${name}`); }
  else console.log(`✓ ${name}`);
}

const cfg = { cooldownMs: 90_000, coalesceWindowMs: 7_000 };

// 1. Coalesce: registered trigger is NOT drained before the window elapses.
{
  const d = new MovementDebouncer(cfg);
  const t0 = 1_000_000;
  d.register(101, "moneyline", "ml_cents", t0);
  check("pendingCount=1 after register", d.pendingCount() === 1);
  check("drain before coalesce window → empty", d.drainBatch(t0 + 3_000).gameExternalIds.length === 0);
  const batch = d.drainBatch(t0 + 7_000);
  check("drain at coalesce window → game present", batch.gameExternalIds.includes(101));
  check("pending cleared after drain", d.pendingCount() === 0);
}

// 2. Cooldown: re-register within cooldown is suppressed; allowed after.
{
  const d = new MovementDebouncer(cfg);
  const t0 = 2_000_000;
  d.register(202, "total", "point_move", t0);
  d.drainBatch(t0 + 7_000); // fires → stamps cooldown at t0+7000
  const cd = t0 + 7_000;
  check("re-register within cooldown suppressed", d.register(202, "total", "point_move", cd + 10_000) === false);
  check("re-register after cooldown accepted", d.register(202, "total", "point_move", cd + 91_000) === true);
}

// 3. Coalesce batches MULTIPLE games into one drain.
{
  const d = new MovementDebouncer(cfg);
  const t0 = 3_000_000;
  d.register(301, "moneyline", "ml_cents", t0);
  d.register(302, "moneyline", "novig_pp", t0 + 1_000);
  d.register(303, "total", "key_number", t0 + 2_000);
  const batch = d.drainBatch(t0 + 7_500);
  check("coalesced batch has all 3 games", [301, 302, 303].every((g) => batch.gameExternalIds.includes(g)));
}

// 4. Per-(game,market) isolation: same game, different markets tracked separately.
{
  const d = new MovementDebouncer(cfg);
  const t0 = 4_000_000;
  d.register(401, "moneyline", "ml_cents", t0);
  d.drainBatch(t0 + 7_000); // ML cools down
  // total for same game is NOT under ML's cooldown
  check("same game different market not blocked", d.register(401, "total", "point_move", t0 + 8_000) === true);
}

// 5. Duplicate register for same (game,market) within window does not double-count.
{
  const d = new MovementDebouncer(cfg);
  const t0 = 5_000_000;
  d.register(501, "moneyline", "ml_cents", t0);
  d.register(501, "moneyline", "novig_pp", t0 + 1_000);
  check("duplicate (game,market) → pendingCount stays 1", d.pendingCount() === 1);
  const batch = d.drainBatch(t0 + 7_000);
  check("drained once", batch.gameExternalIds.filter((g) => g === 501).length === 1);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
