/**
 * Integration tests for Phase 4G refresh-cycle cron routes.
 *
 *   • midday-refresh
 *   • afternoon-refresh
 *   • evening-refresh
 *   • lineup-watch
 *   • pregame-sweep
 *
 * Each route is exercised with: bad auth, happy path with ?date= query,
 * expected records_updated, expected details fields.
 *
 * Prerequisite: fresh `npm run seed`.
 * Run with: npm run test:refresh-cycle-crons
 */

import { GET as midday } from "../app/api/cron/midday-refresh/route";
import { GET as afternoon } from "../app/api/cron/afternoon-refresh/route";
import { GET as evening } from "../app/api/cron/evening-refresh/route";
import { GET as lineupWatch } from "../app/api/cron/lineup-watch/route";
import { GET as pregameSweep } from "../app/api/cron/pregame-sweep/route";
import { supabase } from "../lib/db/supabase";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const msg = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(msg);
    failures.push(msg);
  }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

const TEST_SECRET = "phase4g-test-secret";
const SLATE_DATE = "2026-05-22";

function authed(url = "https://x"): Request {
  return new Request(url, { headers: { Authorization: `Bearer ${TEST_SECRET}` } });
}
function unauthed(): Request {
  return new Request("https://x", { headers: { Authorization: "Bearer wrong" } });
}

type CronRun = {
  sport: string;
  status: string;
  records_updated?: number;
  details?: Record<string, unknown>;
};

async function runAuthedFor(
  handler: (req: Request) => Promise<Response>,
  routeName: string,
  expectedMinRecords: number,
  expectedDetailsKeys: string[]
) {
  const res = await handler(authed(`https://x?date=${SLATE_DATE}`));
  check(`${routeName} → 200`, res.status === 200);
  const body = (await res.json()) as { ok: boolean; runs: CronRun[] };
  check(`${routeName}: ok=true`, body.ok === true);
  const mlb = body.runs.find((r) => r.sport === "mlb");
  check(`${routeName}: mlb run present`, mlb !== undefined);
  check(`${routeName}: mlb status=ok`, mlb?.status === "ok");
  check(
    `${routeName}: records_updated >= ${expectedMinRecords}`,
    (mlb?.records_updated ?? 0) >= expectedMinRecords
  );
  const details = (mlb?.details ?? {}) as Record<string, unknown>;
  for (const key of expectedDetailsKeys) {
    check(
      `${routeName}: details.${key} is populated`,
      typeof details[key] === "number"
    );
  }
}

async function main() {
  const origSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = TEST_SECRET;

  // Clean lock rows leftover from any previous runs
  for (const ds of ["midday_refresh", "afternoon_refresh", "evening_refresh", "lineup_watch", "pregame_sweep"]) {
    await supabase.from("data_refresh_log").delete().eq("data_source", ds);
  }

  // ─── midday-refresh ──────────────────────────────────────────────────────
  section("/api/cron/midday-refresh");
  check("midday: bad auth → 401", (await midday(unauthed())).status === 401);
  // lines (360) + signals (4) + verdicts (4) = 368
  await runAuthedFor(midday, "midday", 350, ["game_lines", "sharp_signals", "verdicts"]);

  // ─── afternoon-refresh ───────────────────────────────────────────────────
  section("/api/cron/afternoon-refresh");
  check("afternoon: bad auth → 401", (await afternoon(unauthed())).status === 401);
  // lines (360) + signals (4) + weather (12) + verdicts (4) = 380
  await runAuthedFor(afternoon, "afternoon", 370, ["game_lines", "sharp_signals", "weather", "verdicts"]);

  // ─── evening-refresh ─────────────────────────────────────────────────────
  section("/api/cron/evening-refresh");
  check("evening: bad auth → 401", (await evening(unauthed())).status === 401);
  // game_lines (360) + props (156) + signals (4) + lineups (84) + weather (12)
  //   + prop_predictions (39) + verdicts (4) = 659
  await runAuthedFor(evening, "evening", 600, [
    "game_lines",
    "player_props_lines",
    "sharp_signals",
    "lineups",
    "weather",
    "prop_predictions",
    "verdicts",
  ]);

  // ─── lineup-watch ────────────────────────────────────────────────────────
  section("/api/cron/lineup-watch");
  check("lineup-watch: bad auth → 401", (await lineupWatch(unauthed())).status === 401);
  // lineups (84) + prop_predictions (39) + verdicts (4) = 127
  await runAuthedFor(lineupWatch, "lineup-watch", 120, ["lineups", "prop_predictions", "verdicts"]);

  // ─── pregame-sweep ───────────────────────────────────────────────────────
  section("/api/cron/pregame-sweep");
  check("pregame-sweep: bad auth → 401", (await pregameSweep(unauthed())).status === 401);
  // lines (360) + signals (4) + verdicts (4) = 368
  await runAuthedFor(pregameSweep, "pregame-sweep", 350, ["game_lines", "sharp_signals", "verdicts"]);

  // Cleanup
  for (const ds of ["midday_refresh", "afternoon_refresh", "evening_refresh", "lineup_watch", "pregame_sweep"]) {
    await supabase.from("data_refresh_log").delete().eq("data_source", ds);
  }

  // Restore env
  if (origSecret) process.env.CRON_SECRET = origSecret;
  else delete process.env.CRON_SECRET;

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All refresh-cycle-crons tests passed.`);
}

main().catch((e) => {
  console.error("\n❌ test-refresh-cycle-crons failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
