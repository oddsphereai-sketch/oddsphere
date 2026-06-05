/**
 * R-19 Phase 5h — operator read-only helper for pregame-sweep / T-60
 * lock-state readiness.
 *
 * USAGE:
 *   npx tsx --env-file=.env.local scripts/operator/pregame-sweep-status.ts \
 *     [--date YYYY-MM-DD]  (default: today UTC)
 *     [--sport mlb]        (V1: MLB only — other sports rendered but not
 *                            currently handled by the production
 *                            pregame-sweep route)
 *     [--json]             (machine-readable output)
 *     [--verbose]          (per-game detail rows)
 *
 * READ-ONLY. Never calls applyLocks. Never invokes the model. Never
 * writes to DB. Never touches Vercel env / vercel.json. Rejects --write.
 *
 * What it does:
 *   1. Loads today's (or --date's) slate from `games` + the locked_at
 *      column on `game_predictions` (single SELECT join, matching the
 *      pregame-sweep route's loadSlateCandidates).
 *   2. Joins to home/away_team for matchup labels.
 *   3. Partitions by lock state using the production pure classifier
 *      `partitionByLockState` from lib/automodel/lockState — exact same
 *      logic the live route uses.
 *   4. Reports counts per state + per-game detail with operator labels
 *      explaining what each state means for the lock workflow.
 *
 * Operator use cases:
 *   • "If pregame-sweep fired RIGHT NOW, what would happen?"
 *     → would_lock_count + the list of entering_lock games
 *   • "Are there any lock_miss candidates? (games started without ever
 *     being locked because cron didn't fire in time)"
 *     → already_started count + warning label
 *   • Validate the partition matches the live pregame-sweep route's
 *     dry-run response — same SELECT, same classifier, same answer.
 *
 * Anti-flag:
 *   --write → exits with error pointing at the actual write path
 *     (PREGAME_SWEEP_CRON_ACTIVE env + scheduled cron invocation). This
 *     script never writes.
 */

import {
  parseCommonCliOptions,
  printBanner,
  rejectWriteFlag,
  emitReport,
} from "./_cliCommon";
import { supabase } from "../../lib/db/supabase";
import {
  partitionByLockState,
  classifyLockState,
  LOCK_WINDOW_MINUTES_DEFAULT,
  type LockCandidate,
  type LockState,
} from "../../lib/automodel/lockState";
import type { Sport } from "../../lib/types/domain/Sport";

// ─── Per-game shape ─────────────────────────────────────────────────────

type GameRow = LockCandidate & {
  sport: Sport;
  slate_date: string;
  game_id: number;
  external_id: number;
  away_code: string | null;
  home_code: string | null;
};

type GameReport = GameRow & {
  classifier_state: LockState;
  matchup: string;
  minutes_to_first_pitch: number | null;
};

type StatusReport = {
  sport: Sport;
  slate_date: string;
  generated_at: string;
  window_minutes: number;
  games_count: number;
  counts: Record<LockState, number>;
  would_lock_count: number;
  would_lock_external_ids: number[];
  lock_miss_count: number;
  lock_miss_external_ids: number[];
  games: GameReport[];
};

// ─── DB load ────────────────────────────────────────────────────────────

async function loadSlate(sport: Sport, slate_date: string): Promise<GameRow[]> {
  const { data, error } = await supabase
    .from("games")
    .select(
      "id, external_id, game_date, " +
        "home_team:home_team_id ( abbreviation ), " +
        "away_team:away_team_id ( abbreviation ), " +
        "game_predictions ( locked_at )"
    )
    .eq("sport", sport)
    .eq("slate_date", slate_date)
    .order("game_date", { ascending: true });
  if (error) {
    throw new Error(
      `pregame-sweep-status loadSlate failed for ${sport}/${slate_date}: ${error.message}`
    );
  }
  type Raw = {
    id: number;
    external_id: number;
    game_date: string | null;
    home_team: { abbreviation: string } | null;
    away_team: { abbreviation: string } | null;
    // Supabase one-to-one returns object, one-to-many returns array.
    // The game_predictions FK relation is effectively one-to-one
    // (single row per game) but Supabase typegen sometimes models it
    // as an array. Accept both.
    game_predictions:
      | Array<{ locked_at: string | null }>
      | { locked_at: string | null }
      | null;
  };
  return ((data ?? []) as unknown as Raw[]).map((r) => {
    const pred = Array.isArray(r.game_predictions)
      ? (r.game_predictions[0] ?? null)
      : r.game_predictions;
    return {
      sport,
      slate_date,
      game_id: r.id,
      external_id: r.external_id,
      game_date: r.game_date,
      locked_at: pred?.locked_at ?? null,
      away_code: r.away_team?.abbreviation ?? null,
      home_code: r.home_team?.abbreviation ?? null,
    };
  });
}

// ─── Report build ───────────────────────────────────────────────────────

function minutesUntil(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.round((t - now.getTime()) / 60000);
}

function buildReport(rows: GameRow[], now: Date): StatusReport {
  const window = LOCK_WINDOW_MINUTES_DEFAULT;
  const partition = partitionByLockState(rows, now, window);

  const games: GameReport[] = rows.map((r) => {
    const state = classifyLockState(r, now, window);
    const away = r.away_code ?? "?";
    const home = r.home_code ?? "?";
    return {
      ...r,
      classifier_state: state,
      matchup: `${away} @ ${home}`,
      minutes_to_first_pitch: minutesUntil(r.game_date, now),
    };
  });

  const sport = rows[0]?.sport ?? "mlb";
  const slate_date = rows[0]?.slate_date ?? "";

  return {
    sport,
    slate_date,
    generated_at: now.toISOString(),
    window_minutes: window,
    games_count: rows.length,
    counts: {
      locked: partition.locked.length,
      entering_lock: partition.entering_lock.length,
      still_unlocked: partition.still_unlocked.length,
      already_started: partition.already_started.length,
    },
    would_lock_count: partition.entering_lock.length,
    would_lock_external_ids: partition.entering_lock.map((g) => g.external_id),
    lock_miss_count: partition.already_started.filter(
      (g) => g.locked_at === null
    ).length,
    lock_miss_external_ids: partition.already_started
      .filter((g) => g.locked_at === null)
      .map((g) => g.external_id),
    games,
  };
}

// ─── Text formatter ─────────────────────────────────────────────────────

const STATE_LABEL: Record<LockState, string> = {
  locked: "🔒 LOCKED",
  entering_lock: "⏰ ENTERING_LOCK",
  still_unlocked: "✓  STILL_UNLOCKED",
  already_started: "🔓 ALREADY_STARTED",
};

const STATE_EXPLAIN: Record<LockState, string> = {
  locked:
    "predictions frozen — pregame-sweep will skip; intraday slate-cycle's " +
    "Layer 2 filter pre-excludes these",
  entering_lock:
    "within T-60 window AND locked_at=null — NEXT pregame-sweep would " +
    "run the t60_locked model pass for this game, then set locked_at",
  still_unlocked:
    "beyond T-60 OR no game_date yet — refreshable on intraday cycles; " +
    "pregame-sweep takes no action",
  already_started:
    "game_date in the past — would either be 🔒 (already locked) or " +
    "the LOCK_MISS pattern (locked_at=null + started). lock_miss is the " +
    "exact case Phase 5c per-game exclusion handles in slate-cycle.",
};

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return "—";
  }
}

function fmtIso(iso: string | Date | null | undefined): string {
  if (iso === null || iso === undefined) return "null";
  return typeof iso === "string" ? iso : iso.toISOString();
}

function formatText(r: StatusReport, verbose: boolean): void {
  console.log(
    `\n━━━ Pregame-sweep status · ${r.sport} · ${r.slate_date} ━━━\n`
  );
  console.log(
    `  ${r.games_count} games on slate · ` +
      `lock window = ${r.window_minutes} min · ` +
      `assessed at ${new Date(r.generated_at).toLocaleString("en-US", { timeZone: "America/New_York" })} ET`
  );

  console.log(`\n  ┌─ Lock-state partition (next sweep) ───────────────┐`);
  console.log(`  │  🔒 locked          : ${String(r.counts.locked).padStart(3)}                          │`);
  console.log(`  │  ⏰ entering_lock   : ${String(r.counts.entering_lock).padStart(3)}                          │`);
  console.log(`  │  ✓  still_unlocked  : ${String(r.counts.still_unlocked).padStart(3)}                          │`);
  console.log(`  │  🔓 already_started : ${String(r.counts.already_started).padStart(3)}                          │`);
  console.log(`  └────────────────────────────────────────────────────┘`);

  console.log(`\n  Operator signals:`);
  if (r.would_lock_count === 0) {
    console.log(`    ⏰ would_lock=0     — next sweep would NOT lock any game`);
  } else {
    console.log(
      `    ⏰ would_lock=${r.would_lock_count}     — next sweep would lock these external_ids:`
    );
    console.log(
      `        [${r.would_lock_external_ids.join(", ")}]`
    );
  }
  if (r.lock_miss_count === 0) {
    console.log(`    🔓 lock_miss=0      — no started-but-unlocked games`);
  } else {
    console.log(
      `    🔓 lock_miss=${r.lock_miss_count}      — these games started WITHOUT being locked:`
    );
    console.log(
      `        [${r.lock_miss_external_ids.join(", ")}]  ← Phase 5c per-game exclusion in slate-cycle handles these`
    );
  }

  if (verbose) {
    console.log(`\n  Per-game detail:`);
    console.log(
      `    ${"first_pitch".padEnd(13)}  ${"matchup".padEnd(11)}  ${"min_to_fp".padEnd(9)}  ${"locked_at".padEnd(28)}  state`
    );
    console.log(`    ${"─".repeat(13)}  ${"─".repeat(11)}  ${"─".repeat(9)}  ${"─".repeat(28)}  ─────────────`);
    for (const g of r.games) {
      const fp = fmtTime(g.game_date).padEnd(13);
      const mu = g.matchup.padEnd(11);
      const mtf =
        g.minutes_to_first_pitch === null
          ? "—".padEnd(9)
          : (g.minutes_to_first_pitch > 0
              ? `+${g.minutes_to_first_pitch}`
              : `${g.minutes_to_first_pitch}`
            ).padEnd(9);
      const la = fmtIso(g.locked_at).padEnd(28);
      const isLockMiss =
        g.classifier_state === "already_started" && g.locked_at === null;
      const stateTag = isLockMiss
        ? `🚨 LOCK_MISS (already_started, locked_at=null)`
        : STATE_LABEL[g.classifier_state];
      console.log(`    ${fp}  ${mu}  ${mtf}  ${la}  ${stateTag}`);
    }
  }

  console.log(`\n  Operator legend:`);
  for (const state of ["locked", "entering_lock", "still_unlocked", "already_started"] as const) {
    console.log(`    ${STATE_LABEL[state]}: ${STATE_EXPLAIN[state]}`);
  }

  console.log(
    `\n  READ-ONLY. No DB writes. No model invocation. No env reads.` +
      ` No pregame-sweep apply.\n`
  );
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  rejectWriteFlag(process.argv);
  const opts = parseCommonCliOptions(process.argv);
  printBanner("pregame-sweep-status", opts);

  const rows = await loadSlate(opts.sport, opts.date);
  if (rows.length === 0) {
    console.log(
      `\n  No games found for ${opts.sport} on ${opts.date}.` +
        ` Slate may not be ingested yet (or wrong date).\n`
    );
    if (opts.json) {
      console.log(
        JSON.stringify(
          { sport: opts.sport, slate_date: opts.date, games_count: 0 },
          null,
          2
        )
      );
    }
    return;
  }

  const now = new Date();
  const report = buildReport(rows, now);
  emitReport(report, opts, () => formatText(report, opts.verbose));
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("FATAL:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
);
