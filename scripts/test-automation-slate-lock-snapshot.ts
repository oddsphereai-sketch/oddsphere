/**
 * Phase 4.2.C.1.R-19 Phase 4b — tests for the slate lock-state snapshot
 * helper (lib/services/automationSlateLockSnapshot.ts).
 *
 * Pure tests — no DB, no env, no network. The helper wraps the existing
 * Phase 4.2.B `partitionByLockState` from lockState.ts; these tests
 * verify the report-shape mapping (counts + per-game entries) and the
 * lock-window edge behavior.
 *
 * Run: npx tsx scripts/test-automation-slate-lock-snapshot.ts
 */

import {
  assessSlateLockSnapshot,
  deriveLockWarnings,
  anyLockWarningBlocks,
  extractLockMissExclusions,
  PREGAME_SWEEP_CRON_ACTIVE_ENV,
  type SlateLockGameInput,
} from "../lib/services/automationSlateLockSnapshot";
import { LOCK_WINDOW_MINUTES_DEFAULT } from "../lib/automodel/lockState";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const m = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(m);
    failures.push(m);
  }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

// Fixed reference moment so tests are deterministic.
const NOW = new Date("2026-06-05T22:00:00Z"); // 6 PM ET on slate day

/** Helper to build a game input with a relative game_date. */
function game(opts: {
  ext: number;
  minutesFromNow: number | null;
  locked?: boolean;
  matchup?: string;
}): SlateLockGameInput {
  const gd =
    opts.minutesFromNow === null
      ? null
      : new Date(NOW.getTime() + opts.minutesFromNow * 60_000).toISOString();
  return {
    game_external_id: opts.ext,
    game_date: gd,
    locked_at: opts.locked === true ? "2026-06-05T21:00:00Z" : null,
    matchup: opts.matchup ?? null,
  };
}

async function main() {
  // ── [A] Constants + empty input ──────────────────────────────────────
  section("Lock window default exposure");
  {
    const r = assessSlateLockSnapshot({ sport: "mlb", games: [], now: NOW });
    check("LOCK_WINDOW_MINUTES_DEFAULT is 60", LOCK_WINDOW_MINUTES_DEFAULT === 60);
    check("lock_window_minutes = 60", r.lock_window_minutes === 60);
    check("empty games → total_games = 0", r.total_games === 0);
    check("empty games → unlocked_games = 0", r.unlocked_games === 0);
    check("empty games → would_lock_games = 0", r.would_lock_games === 0);
    check("empty games → already_locked_games = 0", r.already_locked_games === 0);
    check("empty games → already_started_games = 0", r.already_started_games === 0);
    check("empty games → effectively_locked_count = 0", r.effectively_locked_count === 0);
    check("empty games → per_game is empty", r.per_game.length === 0);
  }

  // ── [B] Single game far from lock ─────────────────────────────────────
  section("Single game 180 min from start (still unlocked)");
  {
    const r = assessSlateLockSnapshot({
      sport: "mlb",
      games: [game({ ext: 1, minutesFromNow: 180, matchup: "BOS@NYY" })],
      now: NOW,
    });
    check("total_games = 1", r.total_games === 1);
    check("unlocked_games = 1", r.unlocked_games === 1);
    check("would_lock_games = 0", r.would_lock_games === 0);
    check("already_locked_games = 0", r.already_locked_games === 0);
    check("effectively_locked_count = 0", r.effectively_locked_count === 0);
    check("per_game[0].lock_state = still_unlocked", r.per_game[0]?.lock_state === "still_unlocked");
    check("per_game[0].matchup = BOS@NYY", r.per_game[0]?.matchup === "BOS@NYY");
    check("per_game[0].locks_at non-null", r.per_game[0]?.locks_at !== null);
  }

  // ── [C] Single game inside T-60 window — would_lock ──────────────────
  section("Single game 30 min from start, not yet locked → would_lock");
  {
    const r = assessSlateLockSnapshot({
      sport: "mlb",
      games: [game({ ext: 2, minutesFromNow: 30 })],
      now: NOW,
    });
    check("would_lock_games = 1", r.would_lock_games === 1);
    check("unlocked_games = 0", r.unlocked_games === 0);
    check("effectively_locked_count = 1 (entering_lock counts)", r.effectively_locked_count === 1);
    check("per_game[0].lock_state = entering_lock", r.per_game[0]?.lock_state === "entering_lock");
  }

  // ── [D] Single game exactly at T-60 (boundary) ───────────────────────
  section("Single game exactly 60 min from start → entering_lock");
  {
    const r = assessSlateLockSnapshot({
      sport: "mlb",
      games: [game({ ext: 3, minutesFromNow: 60 })],
      now: NOW,
    });
    check("60-min boundary trips entering_lock", r.would_lock_games === 1);
    check("not still_unlocked", r.unlocked_games === 0);
  }

  // ── [E] Single game just outside T-60 (61 min) ───────────────────────
  section("Single game 61 min from start → still_unlocked");
  {
    const r = assessSlateLockSnapshot({
      sport: "mlb",
      games: [game({ ext: 4, minutesFromNow: 61 })],
      now: NOW,
    });
    check("61-min stays still_unlocked", r.unlocked_games === 1);
    check("would_lock_games = 0", r.would_lock_games === 0);
  }

  // ── [F] Already locked game ──────────────────────────────────────────
  section("Game with locked_at set → already_locked");
  {
    const r = assessSlateLockSnapshot({
      sport: "mlb",
      games: [game({ ext: 5, minutesFromNow: 120, locked: true })],
      now: NOW,
    });
    check("already_locked_games = 1", r.already_locked_games === 1);
    check("unlocked_games = 0 (locked beats time math)", r.unlocked_games === 0);
    check("effectively_locked_count = 1", r.effectively_locked_count === 1);
    check("per_game[0].lock_state = locked", r.per_game[0]?.lock_state === "locked");
    check("per_game[0].locked_at preserved",
      r.per_game[0]?.locked_at === "2026-06-05T21:00:00Z");
  }

  // ── [G] Already started game (in past, not locked) ───────────────────
  section("Game with game_date in past + not locked → already_started");
  {
    const r = assessSlateLockSnapshot({
      sport: "mlb",
      games: [game({ ext: 6, minutesFromNow: -30 })],
      now: NOW,
    });
    check("already_started_games = 1", r.already_started_games === 1);
    check("unlocked_games = 0", r.unlocked_games === 0);
    check("effectively_locked_count = 1 (already_started counts)", r.effectively_locked_count === 1);
    check("per_game[0].lock_state = already_started", r.per_game[0]?.lock_state === "already_started");
  }

  // ── [H] Mixed slate — the real-world case ───────────────────────────
  section("Realistic mixed slate: 9 unlocked + 2 entering + 1 locked + 1 already_started");
  {
    const games: SlateLockGameInput[] = [
      ...Array.from({ length: 9 }, (_, i) =>
        game({ ext: 100 + i, minutesFromNow: 180 + i * 10 })
      ),
      game({ ext: 200, minutesFromNow: 25 }), // entering_lock
      game({ ext: 201, minutesFromNow: 55 }), // entering_lock
      game({ ext: 300, minutesFromNow: 90, locked: true }), // locked
      game({ ext: 400, minutesFromNow: -10 }), // already_started
    ];
    const r = assessSlateLockSnapshot({ sport: "mlb", games, now: NOW });
    check("total_games = 13", r.total_games === 13);
    check("unlocked_games = 9", r.unlocked_games === 9);
    check("would_lock_games = 2", r.would_lock_games === 2);
    check("already_locked_games = 1", r.already_locked_games === 1);
    check("already_started_games = 1", r.already_started_games === 1);
    check("effectively_locked_count = 4 (entering+locked+started)", r.effectively_locked_count === 4);
    check("per_game.length = 13", r.per_game.length === 13);
  }

  // ── [I] Missing game_date — treated as still_unlocked ────────────────
  section("Game with null game_date → still_unlocked (no time data)");
  {
    const r = assessSlateLockSnapshot({
      sport: "mlb",
      games: [{ game_external_id: 7, game_date: null, locked_at: null }],
      now: NOW,
    });
    check("null game_date → still_unlocked", r.unlocked_games === 1);
    check("per_game[0].locks_at = null", r.per_game[0]?.locks_at === null);
  }

  // ── [J] Locked beats null game_date ──────────────────────────────────
  section("Game with locked_at + null game_date → still locked (locked_at wins)");
  {
    const r = assessSlateLockSnapshot({
      sport: "mlb",
      games: [{ game_external_id: 8, game_date: null, locked_at: "2026-06-05T20:00:00Z" }],
      now: NOW,
    });
    check("locked_at wins over null game_date", r.already_locked_games === 1);
    check("per_game[0].lock_state = locked", r.per_game[0]?.lock_state === "locked");
  }

  // ── [K] Custom window override ───────────────────────────────────────
  section("Custom window override (90 min)");
  {
    const r = assessSlateLockSnapshot({
      sport: "mlb",
      games: [
        game({ ext: 9, minutesFromNow: 75 }),
        game({ ext: 10, minutesFromNow: 95 }),
      ],
      now: NOW,
      windowMinutes: 90,
    });
    check("lock_window_minutes echoed as 90", r.lock_window_minutes === 90);
    check("75-min inside 90-min window → would_lock", r.would_lock_games === 1);
    check("95-min outside 90-min window → still_unlocked", r.unlocked_games === 1);
  }

  // ── [L] per_game.locks_at correctness ────────────────────────────────
  section("per_game.locks_at = game_date - window_minutes");
  {
    // Game 60 min ahead. locks_at = now (since window=60 → locks_at = game_date - 60min = now).
    const r = assessSlateLockSnapshot({
      sport: "mlb",
      games: [game({ ext: 11, minutesFromNow: 60 })],
      now: NOW,
    });
    check(
      "locks_at computed for 60-min-ahead game",
      r.per_game[0]?.locks_at === NOW.toISOString()
    );
  }

  // ── [M] Order preservation ──────────────────────────────────────────
  section("per_game order preserved (input order matches output order)");
  {
    const games: SlateLockGameInput[] = [
      game({ ext: 50, minutesFromNow: -10 }),  // started
      game({ ext: 51, minutesFromNow: 25 }),   // entering_lock
      game({ ext: 52, minutesFromNow: 200 }),  // unlocked
      game({ ext: 53, minutesFromNow: 30, locked: true }), // locked
    ];
    const r = assessSlateLockSnapshot({ sport: "mlb", games, now: NOW });
    check("per_game[0].ext = 50", r.per_game[0]?.game_external_id === 50);
    check("per_game[1].ext = 51", r.per_game[1]?.game_external_id === 51);
    check("per_game[2].ext = 52", r.per_game[2]?.game_external_id === 52);
    check("per_game[3].ext = 53", r.per_game[3]?.game_external_id === 53);
  }

  // ── [N] Critical regression: lock cascade ────────────────────────────
  // Every "lock-protected" category is counted in effectively_locked_count.
  section("effectively_locked_count = locked + entering + already_started");
  {
    const games: SlateLockGameInput[] = [
      game({ ext: 60, minutesFromNow: 180 }), // unlocked
      game({ ext: 61, minutesFromNow: 30 }),  // entering
      game({ ext: 62, minutesFromNow: 90, locked: true }), // locked
      game({ ext: 63, minutesFromNow: -5 }),  // already_started
    ];
    const r = assessSlateLockSnapshot({ sport: "mlb", games, now: NOW });
    check("effectively_locked_count = 3 (entering + locked + started)",
      r.effectively_locked_count === 3);
    check("unlocked NOT counted as effectively locked", r.unlocked_games === 1);
  }

  // ── [O] deriveLockWarnings — pregame_sweep_not_active ──────────────
  section("deriveLockWarnings — pregame_sweep_not_active (env flag missing)");
  {
    const ws = deriveLockWarnings({ snapshot: null, env: {} });
    check("env empty + null snapshot → 1 warning", ws.length === 1);
    check("the only warning is pregame_sweep_not_active", ws[0]?.code === "pregame_sweep_not_active");
    check("severity is warn (not block)", ws[0]?.severity === "warn");
    check("message mentions env flag name", ws[0]?.message.includes("PREGAME_SWEEP_CRON_ACTIVE"));
    check("affected_count = 0", ws[0]?.affected_count === 0);
  }
  {
    const ws = deriveLockWarnings({
      snapshot: null,
      env: { PREGAME_SWEEP_CRON_ACTIVE: "true" },
    });
    check("env flag = 'true' + null snapshot → 0 warnings", ws.length === 0);
  }
  {
    // Strict equality — typos / casing don't count
    const ws = deriveLockWarnings({ snapshot: null, env: { PREGAME_SWEEP_CRON_ACTIVE: "TRUE" } });
    check("'TRUE' does not satisfy strict check → still warns", ws.length === 1);
    check("the warning is pregame_sweep_not_active", ws[0]?.code === "pregame_sweep_not_active");
  }
  {
    const ws = deriveLockWarnings({ snapshot: null, env: { PREGAME_SWEEP_CRON_ACTIVE: "1" } });
    check("'1' does not satisfy strict check → still warns", ws.length === 1);
  }

  // ── [P] deriveLockWarnings — lock_miss (the launch-critical case) ───
  section("deriveLockWarnings — lock_miss (already_started > 0 AND already_locked === 0)");
  {
    const snap = assessSlateLockSnapshot({
      sport: "mlb",
      games: [game({ ext: 1, minutesFromNow: -10 })], // already_started
      now: NOW,
    });
    const ws = deriveLockWarnings({
      snapshot: snap,
      env: { PREGAME_SWEEP_CRON_ACTIVE: "true" }, // suppress the other warning
    });
    check("snapshot has 1 already_started, 0 locked → lock_miss fires", ws.length === 1);
    check("code = lock_miss", ws[0]?.code === "lock_miss");
    check("severity = block", ws[0]?.severity === "block");
    check("affected_count = 1", ws[0]?.affected_count === 1);
    check("message mentions pregame-sweep didn't fire", ws[0]?.message.includes("pregame-sweep cron didn't fire"));
    check("message mentions blocking", ws[0]?.message.includes("blocking"));
  }
  {
    // already_started + already_locked > 0 should NOT trip lock_miss
    // (at least one game IS locked, so pregame-sweep clearly did fire)
    const snap = assessSlateLockSnapshot({
      sport: "mlb",
      games: [
        game({ ext: 1, minutesFromNow: -10 }), // already_started
        game({ ext: 2, minutesFromNow: 120, locked: true }), // locked
      ],
      now: NOW,
    });
    const ws = deriveLockWarnings({
      snapshot: snap,
      env: { PREGAME_SWEEP_CRON_ACTIVE: "true" },
    });
    const codes = ws.map((w) => w.code);
    check("started + locked mix → lock_miss does NOT fire", !codes.includes("lock_miss"));
  }

  // ── [Q] deriveLockWarnings — entering_lock_no_transition ────────────
  section("deriveLockWarnings — entering_lock_no_transition (would_lock > 0)");
  {
    const snap = assessSlateLockSnapshot({
      sport: "mlb",
      games: [game({ ext: 1, minutesFromNow: 30 })], // entering_lock
      now: NOW,
    });
    const ws = deriveLockWarnings({
      snapshot: snap,
      env: { PREGAME_SWEEP_CRON_ACTIVE: "true" },
    });
    check("would_lock=1 → entering_lock_no_transition warning", ws.length === 1);
    check("code = entering_lock_no_transition", ws[0]?.code === "entering_lock_no_transition");
    check("severity = warn", ws[0]?.severity === "warn");
    check("affected_count = 1", ws[0]?.affected_count === 1);
    check("message mentions pregame-sweep owns transition", ws[0]?.message.includes("pregame-sweep"));
  }
  {
    // would_lock=0 → no warning
    const snap = assessSlateLockSnapshot({
      sport: "mlb",
      games: [game({ ext: 1, minutesFromNow: 180 })], // unlocked, far from lock
      now: NOW,
    });
    const ws = deriveLockWarnings({
      snapshot: snap,
      env: { PREGAME_SWEEP_CRON_ACTIVE: "true" },
    });
    check("would_lock=0 + no other issues → 0 warnings", ws.length === 0);
  }

  // ── [R] deriveLockWarnings — multiple codes at once ─────────────────
  section("deriveLockWarnings — multiple warnings co-fire");
  {
    // 3-way scenario: env flag missing AND already_started > 0 AND
    // entering_lock > 0. All three warnings should fire.
    const snap = assessSlateLockSnapshot({
      sport: "mlb",
      games: [
        game({ ext: 1, minutesFromNow: -10 }), // already_started
        game({ ext: 2, minutesFromNow: 30 }),  // entering_lock
        game({ ext: 3, minutesFromNow: 180 }), // unlocked
      ],
      now: NOW,
    });
    const ws = deriveLockWarnings({ snapshot: snap, env: {} });
    const codes = new Set(ws.map((w) => w.code));
    check("3 warnings total", ws.length === 3);
    check("includes lock_miss", codes.has("lock_miss"));
    check("includes entering_lock_no_transition", codes.has("entering_lock_no_transition"));
    check("includes pregame_sweep_not_active", codes.has("pregame_sweep_not_active"));
    check("exactly 1 block-severity (lock_miss)",
      ws.filter((w) => w.severity === "block").length === 1
    );
    check("exactly 2 warn-severity",
      ws.filter((w) => w.severity === "warn").length === 2
    );
  }

  // ── [S] anyLockWarningBlocks predicate ──────────────────────────────
  section("anyLockWarningBlocks predicate");
  {
    check("empty array → false", anyLockWarningBlocks([]) === false);
    // Two warn-severity, no blocker
    const warnsOnly = deriveLockWarnings({
      snapshot: assessSlateLockSnapshot({
        sport: "mlb",
        games: [game({ ext: 1, minutesFromNow: 30 })],
        now: NOW,
      }),
      env: {}, // pregame_sweep_not_active also fires
    });
    check("warn-only → false", anyLockWarningBlocks(warnsOnly) === false);
    // Throw in a lock_miss
    const withBlock = deriveLockWarnings({
      snapshot: assessSlateLockSnapshot({
        sport: "mlb",
        games: [game({ ext: 2, minutesFromNow: -5 })],
        now: NOW,
      }),
      env: { PREGAME_SWEEP_CRON_ACTIVE: "true" }, // suppress sweep warn
    });
    check("with lock_miss → true", anyLockWarningBlocks(withBlock) === true);
  }

  // ── [T] Constant exposure ────────────────────────────────────────────
  section("Lock-warning constants");
  {
    check(
      "PREGAME_SWEEP_CRON_ACTIVE_ENV = 'PREGAME_SWEEP_CRON_ACTIVE'",
      PREGAME_SWEEP_CRON_ACTIVE_ENV === "PREGAME_SWEEP_CRON_ACTIVE"
    );
  }

  // ── [U] Critical regression — the user's scenario ────────────────────
  // User said: "Started/final but never locked must be treated as
  // protected/degraded." The combination that triggers this is
  // already_started > 0 AND already_locked === 0. Verify it produces
  // a BLOCKING warning that anyLockWarningBlocks reports true on.
  section("Critical regression — started-without-lock blocks");
  {
    const snap = assessSlateLockSnapshot({
      sport: "mlb",
      games: Array.from({ length: 9 }, (_, i) => game({ ext: 1000 + i, minutesFromNow: -10 - i })),
      now: NOW,
    });
    const ws = deriveLockWarnings({
      snapshot: snap,
      env: { PREGAME_SWEEP_CRON_ACTIVE: "true" },
    });
    const lockMiss = ws.find((w) => w.code === "lock_miss");
    check("9 already_started, 0 locked → lock_miss present", lockMiss !== undefined);
    check("lock_miss severity = block", lockMiss?.severity === "block");
    check("lock_miss affected_count = 9", lockMiss?.affected_count === 9);
    check("anyLockWarningBlocks → true", anyLockWarningBlocks(ws) === true);
  }

  // ── [V] R-19 Phase 5c — extractLockMissExclusions ─────────────────
  // The pure exclusion-list extractor that converts the snapshot into
  // the external_ids the orchestrator feeds to generatePredictionsForSlate.
  section("R-19 P5c — extractLockMissExclusions (the per-game exclusion list)");
  {
    check("null snapshot → empty exclusion list", extractLockMissExclusions(null).length === 0);
  }
  {
    // All games unlocked, far from start → no exclusions
    const snap = assessSlateLockSnapshot({
      sport: "mlb",
      games: Array.from({ length: 15 }, (_, i) => game({ ext: 5000 + i, minutesFromNow: 180 + i })),
      now: NOW,
    });
    check("15 unlocked games → empty exclusion list", extractLockMissExclusions(snap).length === 0);
  }
  {
    // The user's actual scenario today: 1 already_started + 14 unlocked
    const snap = assessSlateLockSnapshot({
      sport: "mlb",
      games: [
        game({ ext: 5058709, minutesFromNow: -30 }), // SF@CHC pattern
        ...Array.from({ length: 14 }, (_, i) => game({ ext: 5058710 + i, minutesFromNow: 120 + i * 10 })),
      ],
      now: NOW,
    });
    const ex = extractLockMissExclusions(snap);
    check("1 already_started + 14 unlocked → exclusion list = [1 game]", ex.length === 1);
    check("exclusion = [5058709] (the SF@CHC-style game)", ex[0] === 5058709);
    check("14 unlocked games NOT in exclusion list",
      ex.every((id) => id < 5058710));
  }
  {
    // Already_started AND already_locked → NOT a lock_miss (pregame-sweep DID fire)
    const games: SlateLockGameInput[] = [
      { game_external_id: 100, game_date: "2026-06-05T20:00:00Z", locked_at: "2026-06-05T19:00:00Z" },
      ...Array.from({ length: 5 }, (_, i) => game({ ext: 200 + i, minutesFromNow: 60 + i * 10 })),
    ];
    // Note: locked_at takes precedence over time math — `locked` not `already_started`
    const snap = assessSlateLockSnapshot({ sport: "mlb", games, now: NOW });
    const ex = extractLockMissExclusions(snap);
    check("locked game is NOT in lock_miss exclusions (it's locked, not lock-missed)", ex.length === 0);
  }
  {
    // Multiple already_started games with null locked_at → all excluded, sorted
    const snap = assessSlateLockSnapshot({
      sport: "mlb",
      games: [
        game({ ext: 9003, minutesFromNow: -50 }),
        game({ ext: 9001, minutesFromNow: -20 }),
        game({ ext: 9002, minutesFromNow: -10 }),
        game({ ext: 9004, minutesFromNow: 120 }), // unlocked
      ],
      now: NOW,
    });
    const ex = extractLockMissExclusions(snap);
    check("3 already_started + 1 unlocked → exclusion list length 3", ex.length === 3);
    check("exclusion list sorted ascending",
      JSON.stringify(ex) === JSON.stringify([9001, 9002, 9003]));
  }
  {
    // All games started without lock → exclusion list = full slate
    const snap = assessSlateLockSnapshot({
      sport: "mlb",
      games: Array.from({ length: 9 }, (_, i) => game({ ext: 7000 + i, minutesFromNow: -10 - i })),
      now: NOW,
    });
    const ex = extractLockMissExclusions(snap);
    check("9/9 already_started → exclusion list length 9 (M2 will write 0)", ex.length === 9);
  }
  {
    // Mixed locked + already_started + unlocked
    const snap = assessSlateLockSnapshot({
      sport: "mlb",
      games: [
        game({ ext: 100, minutesFromNow: 90, locked: true }),    // locked (Layer 2 catches this)
        game({ ext: 200, minutesFromNow: -10 }),                  // already_started (lock_miss)
        game({ ext: 300, minutesFromNow: 180 }),                  // unlocked (M2 runs)
      ],
      now: NOW,
    });
    const ex = extractLockMissExclusions(snap);
    check("locked game NOT in lock_miss exclusions", !ex.includes(100));
    check("already_started game IS in lock_miss exclusions", ex.includes(200));
    check("unlocked game NOT in lock_miss exclusions", !ex.includes(300));
    check("exclusion list length exactly 1", ex.length === 1);
  }

  // ── [W] CRITICAL REGRESSION — user's launch scenario ───────────────
  // The exact case from today's rollout: 15 BDL games, SF@CHC already
  // started without lock, 14 pregame. Convert the lock_miss block from
  // slate-wide to per-game.
  section("R-19 P5c critical regression — today's launch scenario");
  {
    // Build the snapshot
    const snap = assessSlateLockSnapshot({
      sport: "mlb",
      games: [
        // SF@CHC: already started, no lock (the launch-day exception)
        { game_external_id: 5058709, game_date: "2026-06-05T15:35:00Z", locked_at: null, matchup: "SF@CHC" },
        // 14 other games, all pregame
        ...Array.from({ length: 14 }, (_, i) => ({
          game_external_id: 5058710 + i,
          game_date: new Date(NOW.getTime() + (180 + i * 15) * 60_000).toISOString(),
          locked_at: null,
          matchup: `GAME${i}`,
        })),
      ],
      now: NOW,
    });
    const warns = deriveLockWarnings({
      snapshot: snap,
      env: { PREGAME_SWEEP_CRON_ACTIVE: "true" }, // suppress unrelated warning
    });
    const exclusions = extractLockMissExclusions(snap);

    check("snapshot total_games = 15", snap.total_games === 15);
    check("snapshot already_started = 1", snap.already_started_games === 1);
    check("snapshot already_locked = 0", snap.already_locked_games === 0);
    check("snapshot unlocked = 14", snap.unlocked_games === 14);
    check("lock_miss warning fires (severity: block)",
      warns.some((w) => w.code === "lock_miss" && w.severity === "block"));
    check("anyLockWarningBlocks → true (publish gate uses this)", anyLockWarningBlocks(warns) === true);
    check("exclusion list = [SF@CHC] only", exclusions.length === 1 && exclusions[0] === 5058709);
    check("14 valid games NOT in exclusion list — M2 can write for them",
      exclusions.every((id) => id !== 5058710 && id !== 5058711 /* etc */));
    // Confirm that the launch-day exception scope is exactly 1
    check("exactly 1 game excluded (SF@CHC); other 14 eligible", exclusions.length === 1);
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All slate-lock-snapshot tests passed.`);
}

main().then(
  () => process.exit(0),
  (e) => { console.error("FATAL:", e); process.exit(1); }
);
