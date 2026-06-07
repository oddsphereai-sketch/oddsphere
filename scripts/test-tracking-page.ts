/**
 * Phase 6B.2d — Premium tracking page redesign tests.
 *
 * Grep-based structural assertions across:
 *   • app/lab/tracking/page.tsx (full rewrite)
 *   • app/lab/tracking/components/TrackingCharts.tsx (new)
 *   • app/api/lab/tracking-foundation/route.ts (expanded API)
 *   • app/lab/track-record/page.tsx (redirect — unchanged from 6B.2c)
 *   • app/lab/components/LabAppNav.tsx (canonical nav — unchanged)
 *   • lib/services/trackingAggregateService.ts (new aggregations)
 *
 * What the redesign requires that earlier 2b/2c did not:
 *   • Hero with yesterday / week / Best Angle / pending
 *   • Trend chart, daily-bars chart, Best-Angle-vs-Lean compare chart
 *   • Sport × category section grouped under sport headers
 *   • Per-category Best Angle + Lean sub-records
 *   • NRFI / YRFI surfaced separately and visible
 *   • Recent picks stacked cards
 *   • Toss-Up / Held still state-only
 *   • No giant blended "Overall record" hero
 *   • API exposes bySportMarket / yesterday / thisWeek / dailyTrend /
 *     recentPicks and no raw model audit
 */

import { existsSync, readFileSync } from "node:fs";

const PAGE = readFileSync("app/lab/tracking/page.tsx", "utf8");
const CHARTS = readFileSync("app/lab/tracking/components/TrackingCharts.tsx", "utf8");
const API = readFileSync("app/api/lab/tracking-foundation/route.ts", "utf8");
const TRACK_RECORD = readFileSync("app/lab/track-record/page.tsx", "utf8");
const LAB_NAV = readFileSync("app/lab/components/LabAppNav.tsx", "utf8");
const SERVICE = readFileSync("lib/services/trackingAggregateService.ts", "utf8");

let pass = 0, fail = 0;
function check(name: string, cond: boolean, msg?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${msg ? `\n     ${msg}` : ""}`); fail++; }
}

console.log(`\n━━━ tracking page tests (6B.2d) ━━━\n`);

// ── Service additions ────────────────────────────────────────────────

check("Service exports SportMarketBucket type",        SERVICE.includes("export type SportMarketBucket"));
check("Service exports DailyBucket type",              SERVICE.includes("export type DailyBucket"));
check("Service exports RecentPickRow type",            SERVICE.includes("export type RecentPickRow"));
check("Service result carries bySportMarket",          /bySportMarket:\s*SportMarketBucket\[\]/.test(SERVICE));
check("Service result carries yesterday slice",        /yesterday:\s*\{[^}]*bySportMarket/.test(SERVICE));
check("Service result carries thisWeek slice",         /thisWeek:\s*\{[^}]*daily:\s*DailyBucket/.test(SERVICE));
check("Service result carries dailyTrend",             /dailyTrend:\s*DailyBucket\[\]/.test(SERVICE));
check("Service result carries recentPicks",            /recentPicks:\s*RecentPickRow\[\]/.test(SERVICE));
check("Service builds per sport+market joint buckets", SERVICE.includes("buildSportMarketBuckets"));
check("Service builds 14-day trailing trend",          SERVICE.includes("shiftDate(today, -13)"));
check("Service builds 7-day weekly window",            SERVICE.includes("shiftDate(today, -6)"));
check("Recent picks shape excludes raw audit fields",  !/recentPicks[\s\S]{0,400}snapshot_json|recentPicks[\s\S]{0,400}model_probability/.test(SERVICE));

// ── API surface ──────────────────────────────────────────────────────

check("API surfaces bySportMarket",                    API.includes("bySportMarket: result.bySportMarket"));
check("API surfaces yesterday",                        API.includes("yesterday: result.yesterday"));
check("API surfaces thisWeek",                         API.includes("thisWeek: result.thisWeek"));
check("API surfaces dailyTrend",                       API.includes("dailyTrend: result.dailyTrend"));
check("API surfaces recentPicks",                      API.includes("recentPicks: result.recentPicks"));
check("API does not expose snapshot_json",             !API.includes("snapshot_json"));
check("API does not expose raw model audit fields",    !/model_probability|fi_v2_audit|v2_2_audit|sport_specific/.test(API));
check("API excludes launch-day picks",                 API.includes("includeLaunchDay: false"));
check("API marks no-store",                            API.includes('"Cache-Control": "no-store"'));

// ── Chart primitives ────────────────────────────────────────────────

check("TrendChart component exists",                   CHARTS.includes("export function TrendChart"));
check("DailyBars component exists",                    CHARTS.includes("export function DailyBars"));
check("CompareBars component exists",                  CHARTS.includes("export function CompareBars"));
check("Trend chart renders SVG line",                  /TrendChart[\s\S]{0,2400}<svg/.test(CHARTS));
check("Daily bars renders SVG rects",                  /DailyBars[\s\S]{0,2400}<rect/.test(CHARTS));
check("CompareBars uses progress bar style",           /CompareBars[\s\S]{0,2400}rounded-full bg-white/.test(CHARTS));
check("Trend chart has honest low-sample empty state", /TrendChart[\s\S]{0,400}decidedDays < 2[\s\S]{0,200}Trend chart appears after/.test(CHARTS));
check("CompareBars has honest empty state",            /CompareBars[\s\S]{0,500}Best Angle vs Lean comparison appears/.test(CHARTS));

// ── Page structure ───────────────────────────────────────────────────

check("Page is client component",                      PAGE.includes('"use client"'));
check("Page consumes tracking-foundation API",         PAGE.includes("/api/lab/tracking-foundation"));
check("Page renders Model Tracking title",             PAGE.includes("Model Tracking"));
check("Page renders premium gradient backdrop",        /radial-gradient\(1100px 540px at 50% -120px/.test(PAGE));

// Hero
check("Page hero shows yesterday",                     PAGE.includes('title="Yesterday"') && PAGE.includes('kind="yesterday"'));
check("Page hero shows this week",                     PAGE.includes('title="This week"') && PAGE.includes('kind="week"'));
check("Page hero shows Best Angle",                    PAGE.includes('title="Best Angle"') && PAGE.includes('kind="best"'));
check("Page hero shows Pending",                       PAGE.includes('title="Pending"') && PAGE.includes('kind="pending"'));
check(
  "Page does NOT lead with a blended 'Overall record' hero",
  // The redesign explicitly drops the all-time blended hero. The
  // word may appear inside the explainer copy but not as a section.
  !/<Section[^>]*title="Overall record"/.test(PAGE) &&
    !/title="All picks"/.test(PAGE),
);

// Sections
for (const label of [
  "Performance trend",
  "This week",
  "By sport and category",
  "Best Angle vs Lean",
  "By model version",
  "Recent picks",
  "What this means",
  "Historical baselines",
]) {
  check(`Page renders '${label}' section`, PAGE.includes(label));
}

// Sport × category core
check("Page groups categories under sport sections",   PAGE.includes("SportSection") && PAGE.includes("CategoryCard"));
check("Page surfaces per-category Best Angle",         /<SubMetric label="Best Angle"/.test(PAGE));
check("Page surfaces per-category Lean",               /<SubMetric label="Lean"/.test(PAGE));
check("Page renders MLB sport label",                  PAGE.includes("MLB"));
check("Page maps Moneyline label",                     PAGE.includes('moneyline: "Moneyline"'));
check("Page maps Total O/U label",                     PAGE.includes('total: "Total O/U"'));
check("Page surfaces NRFI as first-class category",    PAGE.includes('nrfi: "NRFI"'));
check("Page surfaces YRFI as first-class category",    PAGE.includes('yrfi: "YRFI"'));
check("Page MLB order: ML, O/U, NRFI, YRFI",           /moneyline: 1, total: 2, nrfi: 3, yrfi: 4/.test(PAGE));
check(
  "First Inning rollup is suppressed when NRFI/YRFI present",
  /hasNrfiOrYrfi[\s\S]{0,300}first_inning/.test(PAGE),
);

// Future-sport support
check("Page supports NBA sport label",                 /nba:\s*"NBA"/.test(PAGE));
check("Page supports NFL sport label",                 /nfl:\s*"NFL"/.test(PAGE));
check("Page supports NHL sport label",                 /nhl:\s*"NHL"/.test(PAGE));
check("Page supports CFB sport label",                 /cfb:\s*"CFB"/.test(PAGE));
check("Page supports CBB sport label",                 /cbb:\s*"CBB"/.test(PAGE));

// Recent picks
check("Page renders RecentPickCard component",         PAGE.includes("RecentPickCard"));
check("Recent picks support pending result badge",     /pending:\s*\{\s*label:\s*"Pending"/.test(PAGE));
check("Recent picks support push result badge",        /push:\s*\{\s*label:\s*"Push"/.test(PAGE));
check("Recent picks support void result badge",        /void:\s*\{\s*label:\s*"Void"/.test(PAGE));
check("Recent picks render score line for ML/total",   /actual_away_score[\s\S]{0,200}actual_home_score/.test(PAGE));
check("Recent picks render FI runs for NRFI/YRFI",     /actual_first_inning_runs[\s\S]{0,200}1st-inning/.test(PAGE));

// Data hygiene
check(
  "Page marks Toss-Up and Held as state-only in recent",
  /isStateOnly[\s\S]{0,200}toss_up[\s\S]{0,80}held/.test(PAGE),
);
check(
  "Page does not roll Toss-Up/Held into win count",
  !/toss_up[\s\S]{0,80}\+=\s*wins/.test(PAGE),
);
check(
  "Page renders pre-init state",
  PAGE.includes("Tracking is initializing"),
);
check(
  "Page renders error state",
  PAGE.includes("temporarily unavailable"),
);

// Mobile-first / responsive
check("Hero grid stacks on mobile",                    /grid-cols-2 lg:grid-cols-4/.test(PAGE));
check("Sport sections stack on mobile",                /grid-cols-1 sm:grid-cols-2/.test(PAGE));
check("Page constrains content max width",             PAGE.includes("max-w-5xl"));
check("Page has sm breakpoint padding",                PAGE.includes("sm:px-6"));

// Empty / honest states
check("Page renders honest empty for yesterday",       /Yesterday's graded results appear after/.test(PAGE));
check("Page renders honest empty for weekly trend",    PAGE.includes("Weekly trend builds as graded slates accumulate"));
check("Page renders honest empty for sport buckets",   /No category data yet/.test(PAGE));
check("Page renders honest empty for recent picks",    /No recent picks yet/.test(PAGE));

// Explainer
for (const term of ["Model Prob", "Edge", "Rec", "Best Angle", "Toss-Up", "Push"]) {
  check(`Explainer mentions '${term}'`, PAGE.includes(term));
}

// ── Canonical route (carried from 6B.2c) ────────────────────────────

check(
  "/lab/track-record permanently redirects to /lab/tracking",
  TRACK_RECORD.includes('permanentRedirect("/lab/tracking")') &&
    TRACK_RECORD.includes('from "next/navigation"'),
);
check(
  "Lab nav points the Tracking tab to /lab/tracking",
  /href:\s*"\/lab\/tracking"[\s\S]{0,40}label:\s*"Tracking"/.test(LAB_NAV),
);
check(
  "Stale TrackingView component still removed",
  !existsSync("app/lab/components/TrackingView.tsx"),
);
check(
  "Stale useTracking hook still removed",
  !existsSync("app/lab/hooks/useTracking.ts"),
);

console.log(`\n  result: ${pass}/${pass + fail} pass`);
if (fail > 0) process.exit(1);
