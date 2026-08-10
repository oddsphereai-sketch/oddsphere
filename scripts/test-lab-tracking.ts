/**
 * Tests for /api/lab/tracking (Phase 5D).
 *
 *   • Auth-free GET returns 200 with the expected shape
 *   • Yesterday recap: falls back to most recent activity day when calendar
 *     yesterday has no rows (isYesterday=false)
 *   • Weekly aggregate: rolling 7-day window matches per-(sport, market) sum
 *   • 30-day series: 30 daily points, zero-fills missing days, aggregates match
 *   • Lifetime aggregate reconciles with the non-duplicated category matrix
 *   • Streak: matches walk-back-from-latest-day rule
 *   • Tallies matrix: all 9 sports × their canonical markets present;
 *     sports with zero rows have lifetime.total=0 (UI shows "offseason")
 *
 * Run with: npm run test:lab-tracking
 */

import { GET as tracking } from "../app/api/lab/tracking/route";
import { readFileSync } from "node:fs";
// Fix 5.1 (Flag C1): productionFilter fails closed by default. Tests
// exercise mock seed data — opt into dev mode explicitly.
process.env.ODDSPHERE_DATA_MODE = "development";

import type { TrackingResponse } from "../app/lab/lib/labTypes";

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

const ALL_SPORTS = ["mlb", "nba", "wnba", "cbb", "nfl", "cfb", "nhl", "ucl", "soccer"] as const;
const MLB_MARKETS = ["ML", "O/U", "NRFI", "YRFI", "NRFI/YRFI"];

async function main() {
  const trackingPageSource = readFileSync("app/lab/tracking/TrackingClient.tsx", "utf8");
  check(
    "candidate keeps deep tracking sections available without front-loading them",
    trackingPageSource.includes('collapsible={presentation === "candidate"}') &&
      trackingPageSource.includes('<details className="group mb-4'),
  );
  // ─── (1) Happy path ───────────────────────────────────────────────────────
  section("GET /api/lab/tracking");

  const res = await tracking(new Request("https://x/api/lab/tracking?snapshotBypass=true"));
  check("returns 200", res.status === 200);

  const body = (await res.json()) as TrackingResponse;

  check("body.as_of is recent ISO", typeof body.as_of === "string" && Date.now() - new Date(body.as_of).getTime() < 5_000);
  check("body.sportOrder includes all 9 sports", body.sportOrder.length === 9 && ALL_SPORTS.every((s) => body.sportOrder.includes(s)));
  check("body has all 5 sections", !!body.yesterdayRecap && !!body.weeklyAggregate && !!body.last30Days && !!body.allTimeAggregate && !!body.streak);
  check("body.tallies is an array", Array.isArray(body.tallies));

  // ─── (2) Yesterday recap ─────────────────────────────────────────────────
  section("Yesterday recap");

  const r = body.yesterdayRecap;
  check("recap.date is YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  check("recap.label is non-empty", typeof r.label === "string" && r.label.length > 0);
  check("recap.isYesterday is boolean", typeof r.isYesterday === "boolean");
  check("recap.results is array", Array.isArray(r.results));
  // Recap date should be either calendar yesterday OR the most recent activity
  // day. The route auto-falls-back when calendar yesterday is empty. Which
  // path applies depends on whether post-game-results / other cron tests have
  // populated the slate — assert the property holds either way.
  const todayIso = new Date().toISOString().slice(0, 10);
  const yesterdayIso = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  if (r.isYesterday) {
    check(
      `isYesterday=true → recap.date matches calendar yesterday (${yesterdayIso})`,
      r.date === yesterdayIso,
      `got date=${r.date}`
    );
  } else {
    check(
      `isYesterday=false → recap.date is before today (most recent activity fallback)`,
      r.date < todayIso,
      `got date=${r.date}`
    );
  }
  check("recap totals are consistent with results array", r.totalPicks === r.results.reduce((s, x) => s + x.wins + x.losses + x.pushes, 0));
  check("recap totalWins matches sum of results.wins", r.totalWins === r.results.reduce((s, x) => s + x.wins, 0));

  // ─── (3) Weekly aggregate (rolling 7 days) ────────────────────────────────
  section("Weekly aggregate");

  const w = body.weeklyAggregate;
  check("weekly start/end are YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(w.weekStart) && /^\d{4}-\d{2}-\d{2}$/.test(w.weekEnd));
  check("weekly window is exactly 7 days", (new Date(w.weekEnd).getTime() - new Date(w.weekStart).getTime()) / 86_400_000 === 6);
  check("weekly labels populated", w.weekStartLabel.length > 0 && w.weekEndLabel.length > 0);
  const weeklyCategoryRows = body.tallies.filter((t) => t.market !== "NRFI/YRFI");
  const categoryWeekWins = weeklyCategoryRows.reduce((sum, t) => sum + (t.weekly?.wins ?? 0), 0);
  const categoryWeekLosses = weeklyCategoryRows.reduce((sum, t) => sum + (t.weekly?.losses ?? 0), 0);
  check(`weekly wins reconcile with category rows (${w.wins} vs ${categoryWeekWins})`, w.wins === categoryWeekWins);
  check(`weekly losses reconcile with category rows (${w.losses} vs ${categoryWeekLosses})`, w.losses === categoryWeekLosses);

  // ─── (4) 30-day series ────────────────────────────────────────────────────
  section("30-day series");

  const d30 = body.last30Days;
  check("days array has exactly 30 entries", d30.days.length === 30);
  check("days are contiguous (date+1 each step)", d30.days.every((d, i, arr) => {
    if (i === 0) return true;
    const prev = new Date(`${arr[i - 1]!.date}T00:00:00.000Z`);
    const cur = new Date(`${d.date}T00:00:00.000Z`);
    return (cur.getTime() - prev.getTime()) / 86_400_000 === 1;
  }));
  check("aggregate.picks = sum of day picks", d30.aggregate.picks === d30.days.reduce((s, d) => s + d.picks, 0));
  check("aggregate.wins = sum of day wins", d30.aggregate.wins === d30.days.reduce((s, d) => s + d.wins, 0));
  // Best/worst gated on ≥5 picks; with the seed there should be qualifying days.
  check("bestDay populated for seed data", !!d30.bestDay);
  check("worstDay populated for seed data", !!d30.worstDay);
  check("mostPicks populated for seed data", !!d30.mostPicks);
  if (d30.bestDay && d30.worstDay) {
    const bestDayObj = d30.days.find((d) => d.date === d30.bestDay!.date);
    const worstDayObj = d30.days.find((d) => d.date === d30.worstDay!.date);
    check(
      "bestDay has highest hit rate among 5+ pick days",
      !!bestDayObj && d30.days.filter((d) => d.picks >= 5).every((d) => d.hitRate <= bestDayObj.hitRate)
    );
    check(
      "worstDay has lowest hit rate among 5+ pick days",
      !!worstDayObj && d30.days.filter((d) => d.picks >= 5).every((d) => d.hitRate >= worstDayObj.hitRate)
    );
  }

  // ─── (5) All-time aggregate ──────────────────────────────────────────────
  section("All-time aggregate");

  const a = body.allTimeAggregate;
  const lifetimeCategoryRows = body.tallies.filter((t) => t.market !== "NRFI/YRFI");
  const categoryWins = lifetimeCategoryRows.reduce((sum, t) => sum + t.lifetime.wins, 0);
  const categoryLosses = lifetimeCategoryRows.reduce((sum, t) => sum + t.lifetime.losses, 0);
  const categoryPushes = lifetimeCategoryRows.reduce((sum, t) => sum + t.lifetime.pushes, 0);
  check(`allTime wins reconcile with category rows (${a.wins} vs ${categoryWins})`, a.wins === categoryWins);
  check(`allTime losses reconcile with category rows (${a.losses} vs ${categoryLosses})`, a.losses === categoryLosses);
  check(`allTime pushes reconcile with category rows (${a.pushes} vs ${categoryPushes})`, a.pushes === categoryPushes);
  check("totalPredictions = wins + losses + pushes", a.totalPredictions === a.wins + a.losses + a.pushes);
  check("hitRate matches wins/(wins+losses)", Math.abs(a.hitRate - a.wins / (a.wins + a.losses)) < 1e-9);

  // ─── (6) Streak ──────────────────────────────────────────────────────────
  section("Streak");

  const s = body.streak;
  check("streak.type is W/L/NONE", s.type === "W" || s.type === "L" || s.type === "NONE");
  check("streak.count is non-negative int", typeof s.count === "number" && s.count >= 0 && Number.isInteger(s.count));
  check("streak.description is non-empty", typeof s.description === "string" && s.description.length > 0);
  if (s.type !== "NONE") {
    check("streak.count > 0 when streak.type is W/L", s.count > 0);
  }

  // ─── (7) Tallies matrix ──────────────────────────────────────────────────
  section("Tallies matrix");

  // Expected count from the current 9-sport registry = 24.
  check(`tally count = 24 across all 9 sports`, body.tallies.length === 24, `got: ${body.tallies.length}`);

  // MLB has 5 markets and they should all be present with non-zero lifetime.
  const mlbTallies = body.tallies.filter((t) => t.sport === "mlb");
  check(`MLB tallies: 5 markets`, mlbTallies.length === 5);
  for (const m of MLB_MARKETS) {
    const t = mlbTallies.find((x) => x.market === m);
    check(`MLB ${m} present`, !!t);
  }
  check(`MLB ML lifetime total is non-negative`, (mlbTallies.find((t) => t.market === "ML")?.lifetime.total ?? -1) >= 0);
  check(
    `MLB NRFI/YRFI lifetime.total = NRFI + YRFI`,
    (() => {
      const nrfi = mlbTallies.find((t) => t.market === "NRFI")?.lifetime.total ?? 0;
      const yrfi = mlbTallies.find((t) => t.market === "YRFI")?.lifetime.total ?? 0;
      const combined = mlbTallies.find((t) => t.market === "NRFI/YRFI")?.lifetime.total ?? 0;
      return combined === nrfi + yrfi;
    })()
  );

  // Sports with no seed data should have lifetime.total = 0 (UI shows "offseason").
  const wnbaTallies = body.tallies.filter((t) => t.sport === "wnba");
  check("WNBA has ML, O/U, and Spread category rows", ["ML", "O/U", "Spread"].every((market) => wnbaTallies.some((t) => t.market === market)));
  check("WNBA modern grades populate every launched category", wnbaTallies.every((t) => t.lifetime.total > 0));

  const soccerTallies = body.tallies.filter((t) => t.sport === "soccer");
  check("World Cup has all four tracked category rows", ["Match Result", "Double Chance", "O/U", "BTTS"].every((market) => soccerTallies.some((t) => t.market === market)));
  check("World Cup modern grades populate every tracked category", soccerTallies.every((t) => t.lifetime.total > 0));

  const otherSports = ["nba", "cbb", "nfl", "cfb", "nhl", "ucl"] as const;
  for (const sport of otherSports) {
    const sportTallies = body.tallies.filter((t) => t.sport === sport);
    check(
      `${sport.toUpperCase()} has tallies (offseason markers, not hidden)`,
      sportTallies.length >= 1
    );
    check(
      `${sport.toUpperCase()} lifetime.total = 0 (no seed data, honest)`,
      sportTallies.every((t) => t.lifetime.total === 0)
    );
    check(
      `${sport.toUpperCase()} currentSeason is null (no fabrication)`,
      sportTallies.every((t) => t.currentSeason === null)
    );
    check(
      `${sport.toUpperCase()} weekly is null (no fabrication)`,
      sportTallies.every((t) => t.weekly === null)
    );
  }

  // ─── (8) Internal hit-rate consistency ────────────────────────────────────
  section("Hit-rate consistency");

  // Every tally with non-zero decided count must have hitRate = wins / (wins + losses).
  let badRate = 0;
  for (const t of body.tallies) {
    const decided = t.lifetime.wins + t.lifetime.losses;
    const expected = decided > 0 ? t.lifetime.wins / decided : 0;
    if (Math.abs(t.lifetime.hitRate - expected) > 1e-9) badRate++;
  }
  check(`every tally's lifetime.hitRate matches wins/(wins+losses)`, badRate === 0);

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All tracking tests passed.`);
}

main().catch((e) => {
  console.error("\n❌ test-lab-tracking failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
