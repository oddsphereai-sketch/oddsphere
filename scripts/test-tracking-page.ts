/**
 * Phase 6B.2e — Tracking page design reset tests.
 *
 * Asserts the redesigned page's *structural* invariants:
 *   • No hero metric cards on top
 *   • Yesterday is the lead content section
 *   • This Week is a single chart (CategoryBars)
 *   • Best Angles is grouped by sport and model category
 *   • Latest Results is the candidate's only member-facing activity feed
 *   • Method consolidates glossary + baselines +
 *     a secondary "all tracked actionable picks" footer
 *   • No standalone "Overall record" / "All picks" hero
 *   • No 14-day TrendChart or DailyBars (removed)
 *   • MLB ML / O-U / NRFI / YRFI surfaced separately
 *   • Toss-Up / Held still state-only
 *   • Canonical /lab/tracking route + redirect from /lab/track-record
 *
 * Carries the service + API expectations forward from 6B.2d
 * (bySportMarket / yesterday / thisWeek / recentPicks etc.) so we
 * still guarantee the backend hasn't regressed.
 */

import { existsSync, readFileSync } from "node:fs";

const PAGE = readFileSync("app/lab/tracking/TrackingClient.tsx", "utf8");
const CHARTS = readFileSync("app/lab/tracking/components/TrackingCharts.tsx", "utf8");
const API = readFileSync("app/api/lab/tracking-foundation/route.ts", "utf8");
const TRACKING_PRIMER = readFileSync("scripts/operator/prime-tracking-experience-snapshot.ts", "utf8");
const TRACK_RECORD = readFileSync("app/lab/track-record/page.tsx", "utf8");
const LAB_NAV = readFileSync("app/lab/components/LabAppNav.tsx", "utf8");
const SERVICE = readFileSync("lib/services/trackingAggregateService.ts", "utf8");
const TRACKING_LOADING = readFileSync("app/lab/tracking/loading.tsx", "utf8");
const PROPS_LOADING = readFileSync("app/mlb/props/loading.tsx", "utf8");
const PUBLIC_TRACKING_SUMMARY = readFileSync("lib/services/tracking/publicTrackRecordSummary.ts", "utf8");

let pass = 0, fail = 0;
function check(name: string, cond: boolean, msg?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${msg ? `\n     ${msg}` : ""}`); fail++; }
}

console.log(`\n━━━ tracking page tests (6B.2e — design reset) ━━━\n`);

check(
  "Homepage current tracking converts the canonical 0..1 hit rate to a display percentage",
  PUBLIC_TRACKING_SUMMARY.includes("currentSnapshot.payload.allTimeAggregate.hitRate * 1_000) / 10"),
);

// ── Page no longer leads with hero metric cards ─────────────────────

check(
  "Page does NOT render 'Overall record' as a section",
  !/<Section[^>]*title="Overall record"/.test(PAGE),
);
check(
  "Page does NOT render an 'All picks' hero card",
  !/title="All picks"/.test(PAGE),
);
check(
  "Page does NOT render a 4-up HeroCard grid",
  !/HeroCard/.test(PAGE),
);
check(
  "Candidate uses a compact product header instead of marketing hero copy",
  /presentation === "candidate"[\s\S]{0,500}OddSphere[\s\S]{0,300}>Tracking</.test(PAGE) &&
    PAGE.includes("Results by sport, model, and prediction category."),
);
check(
  "Page does NOT render the deprecated 14-day TrendChart",
  !PAGE.includes("TrendChart"),
);
check(
  "Page does NOT render the deprecated DailyBars chart",
  !PAGE.includes("DailyBars"),
);
check(
  "Charts file removes TrendChart export",
  !CHARTS.includes("export function TrendChart"),
);
check(
  "Charts file removes DailyBars export",
  !CHARTS.includes("export function DailyBars"),
);

// ── Required sections in the brief ──────────────────────────────────

for (const required of [
  "Yesterday's results",
  "Tracking by category",
  "Lifetime Tracking",
  "Best Angles by category",
  "Recent Predictions",
  "Method",
]) {
  check(`Page renders required section: '${required}'`, PAGE.includes(required));
}

// Hero copy from the brief
check(
  "Header subtitle uses prediction-type language",
  PAGE.includes("Performance by sport, market, and prediction type."),
);
check(
  "Header carries the brief's small copy",
  /Records update after games are graded\.[\s\S]{0,140}Every sided prediction counts[\s\S]{0,140}Toss-Up and Held are not counted as wins or losses/.test(PAGE),
);

// ── Order: Yesterday → Tracking by category → Best Angles → Latest → Recent → Method

check("Page order: Yesterday → Tracking by category → Best Angles → Latest → Recent → Method", (() => {
  const idx = {
    yesterday: PAGE.indexOf('title="Yesterday\'s results"'),
    tracking:  PAGE.indexOf('title="Tracking by category"'),
    best:      PAGE.indexOf('title="Best Angles by category"'),
    latest:    PAGE.indexOf('title="Latest Results"'),
    recent:    PAGE.indexOf('title="Recent Predictions"'),
    method:    PAGE.indexOf('title="Method"'),
  };
  return (
    idx.yesterday !== -1 && idx.tracking !== -1 &&
    idx.best !== -1 && idx.latest !== -1 && idx.recent !== -1 && idx.method !== -1 &&
    idx.yesterday < idx.tracking &&
    idx.tracking < idx.best &&
    idx.best < idx.latest &&
    idx.latest < idx.recent &&
    idx.recent < idx.method
  );
})());

// ── This Week uses the single CategoryBars chart, not multiple ──────

check("Tracking by category section uses the grouped CategoryBars chart", /Tracking by category[\s\S]{0,1800}CategoryTrackingBoard/.test(PAGE) && /function CategoryTrackingBoard[\s\S]{0,1800}<CategoryBars/.test(PAGE));
check("CategoryBars chart component exists", CHARTS.includes("export function CategoryBars"));
check(
  "CategoryBars renders progress-bar rows",
  /CategoryBars[\s\S]{0,2400}rounded-full bg-white/.test(CHARTS),
);
check(
  "CategoryBars has honest empty state",
  /CategoryBars[\s\S]{0,800}!anyDecided[\s\S]{0,400}<EmptyState/.test(CHARTS),
);

// ── Yesterday and Best Angles are lists; Lifetime shares category bars ──

check(
  "Yesterday board renders divider-list rows, not card grid",
  /YesterdayBoard[\s\S]{0,800}divide-y/.test(PAGE),
);
check(
  "Weekly, monthly, and lifetime share the sport-grouped CategoryTrackingBoard",
  /trackWindow === "lifetime"[\s\S]{0,1800}<CategoryTrackingBoard/.test(PAGE) &&
    /LifetimeTrackingBoard[\s\S]{0,900}<CategoryTrackingBoard/.test(PAGE),
);
check(
  "Lifetime Tracking preserves honest historical/live source labels",
  /lifetimeSourceLabel[\s\S]{0,500}Lifetime · live \+\$\{record\.live_decided_contribution\}[\s\S]{0,300}Since launch/.test(PAGE),
);
check(
  "Category tracking visibly groups models by sport with restrained separators",
  /function CategoryTrackingBoard/.test(PAGE) &&
    /divide-y divide-white\/\[0\.07\]/.test(PAGE) &&
    /\{prettySport\(group\.sport\)\} models/.test(PAGE),
);
check(
  "Lifetime records expose numeric metrics without replacing merged history",
  /type LifetimeRecord[\s\S]{0,1200}metrics:\s*Metrics/.test(PAGE) &&
    /source_type:\s*"lifetime_merged"[\s\S]{0,1000}metrics:\s*\{[\s\S]{0,300}wins:\s*mergedWins/.test(PAGE),
);
check(
  "Lifetime Tracking uses merged buildLifetimeRecords helper",
  /lifetimeRecords\s*=\s*useMemo[\s\S]{0,300}buildLifetimeRecords/.test(PAGE),
);
// Phase 6B.24 — Lifetime merge: baseline + live MUST combine when both
// exist (no longer silently picks one or the other). Three source types
// reflect the new honest categorisation.
check(
  "Lifetime merge combines baseline + live when both exist (lifetime_merged)",
  /buildLifetimeRecords[\s\S]{0,3000}source_type:\s*"lifetime_merged"/.test(PAGE),
);
check(
  "Lifetime merge falls back to baseline-only when live has no decided picks (lifetime_baseline)",
  /buildLifetimeRecords[\s\S]{0,3000}source_type:\s*"lifetime_baseline"/.test(PAGE),
);
check(
  "Lifetime merge labels live-only categories 'since_launch' so members don't read them as all-time",
  /buildLifetimeRecords[\s\S]{0,3000}source_type:\s*"since_launch"/.test(PAGE),
);
check(
  "Merge math: mergedWins = baseline.lifetime_wins + liveWins",
  /mergedWins\s*=\s*base\.lifetime_wins\s*\+\s*liveWins/.test(PAGE),
);
check(
  "Merge math: mergedTotal = baseline.lifetime_total + liveDecided",
  /mergedTotal\s*=\s*base\.lifetime_total\s*\+\s*liveDecided/.test(PAGE),
);
check(
  "Lifetime row shows source label so merged vs baseline-only is visible",
  /lifetimeSourceLabel[\s\S]{0,400}Lifetime · live \+/.test(PAGE),
);
check(
  "Lifetime row shows 'Since launch' for live-only categories",
  /lifetimeSourceLabel[\s\S]{0,400}"Since launch"/.test(PAGE),
);
check(
  "Lifetime Tracking explains MLB auto-update + maintained other sports",
  /MLB updates automatically as games grade[\s\S]{0,200}Other sports are maintained/.test(PAGE),
);
check(
  "Best Angles groups model categories inside separate sport sections",
  /BestAnglesBoard[\s\S]{0,1800}groups\.map[\s\S]{0,700}\{prettySport\(group\.sport\)\} models/.test(PAGE) &&
    /BestAnglesBoard[\s\S]{0,2600}group\.rows\.map/.test(PAGE),
);
check(
  "Best Angles section surfaces per-category records",
  /BestAnglesBoard[\s\S]{0,2000}bestAngles[\s\S]{0,400}leans/.test(PAGE),
);
check(
  "Best Angles is visible without another disclosure click",
  /title="Best Angles by category"[\s\S]{0,120}<BestAnglesBoard/.test(PAGE),
);

// ── MLB categories distinct ─────────────────────────────────────────

check("Market label: Moneyline",      PAGE.includes('moneyline: "Moneyline"'));
check("Market label: Over / Under",   PAGE.includes('total: "Over / Under"'));
check("Market label: NRFI distinct",  PAGE.includes('nrfi: "NRFI"'));
check("Market label: YRFI distinct",  PAGE.includes('yrfi: "YRFI"'));
check(
  "MLB order: ML, O/U, NRFI, YRFI",
  /moneyline: 1,[\s\S]{0,80}total: 2,[\s\S]{0,80}nrfi: 3,[\s\S]{0,80}yrfi: 4/.test(PAGE),
);
check(
  "first_inning rollup suppressed when NRFI/YRFI present",
  /hasNrfiOrYrfi[\s\S]{0,200}first_inning/.test(PAGE),
);

// Future-sport support
for (const sport of [["nba", "NBA"], ["nfl", "NFL"], ["nhl", "NHL"], ["cfb", "CFB"], ["cbb", "CBB"]]) {
  check(`Sport label supported: ${sport[1]}`, PAGE.includes(`${sport[0]}: "${sport[1]}"`));
}
const sportOrderBlock = PAGE.slice(PAGE.indexOf("const SPORT_ORDER"), PAGE.indexOf("// ─── Format helpers"));
check(
  "Tracking keeps related sports adjacent and World Cup beside UCL",
  ["mlb", "nba", "cbb", "wnba", "nfl", "cfb", "nhl", "soccer", "ucl"]
    .every((sport, index, order) => index === 0 || sportOrderBlock.indexOf(`${order[index - 1]}:`) < sportOrderBlock.indexOf(`${sport}:`)),
);

// ── Method section consolidates everything secondary ────────────────

check(
  "Method section combines glossary",
  /Method[\s\S]{0,2000}<Glossary/.test(PAGE),
);
check(
  "Candidate Method is an always-visible bottom reference",
  /title="Method">[\s\S]{0,300}<Card>/.test(PAGE) &&
    !/title="Method"[^>]*collapsible/.test(PAGE),
);
check(
  "Method section does NOT expose model versions",
  !/Method[\s\S]{0,2000}<ModelVersions/.test(PAGE),
);
check(
  "Page does NOT render model_version values in member-facing cards",
  !/pick\.model_version|model_version\}/.test(PAGE),
);
// "Legacy Historical Baseline" must NOT appear on the member-facing page
check(
  "Page does NOT use member-facing 'Legacy Historical Baseline' label",
  !PAGE.includes("Legacy Historical Baseline"),
);
check(
  "Page does NOT use 'Frozen at import' member-facing copy",
  !PAGE.includes("Frozen at import"),
);
check(
  "Page does NOT use 'pre-automated tracking' member-facing copy",
  !PAGE.includes("pre-automated tracking"),
);
check(
  "Page does NOT use 'Imported reference record' member-facing copy",
  !PAGE.includes("Imported reference record"),
);
check(
  "Page does NOT render a standalone Baselines section in Method",
  !/<Baselines/.test(PAGE),
);
check(
  "Method section ends with secondary 'All tracked predictions' footer",
  /Method[\s\S]{0,2400}<AllActionableFooter/.test(PAGE),
);
check(
  "Blended overall is labeled 'All tracked predictions'",
  PAGE.includes("All tracked predictions"),
);
check(
  "Blended overall lives at the bottom of Method, not as a hero",
  PAGE.indexOf("AllActionableFooter") > PAGE.indexOf('title="Recent Predictions"'),
);

// Baselines are NOT rendered as a wide standalone table anymore
check(
  "Baselines no longer rendered as a major <table>",
  !/<table[\s\S]{0,300}Lifetime[\s\S]{0,300}Win/.test(PAGE),
);

// Glossary terms
for (const term of ["Best Angle", "Lean", "No Bet", "Toss-Up", "Held", "Pending", "Push / Void"]) {
  check(`Glossary term present: ${term}`, PAGE.includes(term));
}

// ── Data hygiene ────────────────────────────────────────────────────

check(
  "Page marks Toss-Up and Held as state-only in recent",
  /isStateOnly[\s\S]{0,200}toss_up[\s\S]{0,80}held/.test(PAGE),
);
check(
  "Page does not roll Toss-Up/Held into win count",
  !/toss_up[\s\S]{0,80}\+=\s*wins/.test(PAGE),
);
check(
  "Page explains sided No Play / No Bet counts for prediction accuracy",
  PAGE.includes("Sided No Play stand-downs still count for prediction accuracy") &&
    PAGE.includes("still counted for prediction accuracy when it has a side"),
);
check(
  "Yesterday board uses honest empty state, not zeros",
  /Yesterday's results are pending grading/.test(PAGE),
);
check("Page renders pre-init state", PAGE.includes("Tracking is initializing"));
check("Page renders error state",    PAGE.includes("temporarily unavailable"));

// Recent picks
check(
  "Recent pick card supports Win/Loss/Push/Void/Pending/Toss-Up/Held",
  /win:\s*\{\s*label:\s*"Win"/.test(PAGE) &&
    /loss:\s*\{\s*label:\s*"Loss"/.test(PAGE) &&
    /push:\s*\{\s*label:\s*"Push"/.test(PAGE) &&
    /void:\s*\{\s*label:\s*"Void"/.test(PAGE) &&
    /pending:\s*\{\s*label:\s*"Pending"/.test(PAGE) &&
    /toss_up:\s*\{\s*label:\s*"Toss-Up"/.test(PAGE) &&
    /held:\s*\{\s*label:\s*"Held"/.test(PAGE),
);
check(
  "Recent Predictions capped at ~12 by default",
  /recentPicks[\s\S]{0,400}\.slice\(0, 12\)/.test(PAGE),
);
check(
  "Recent Predictions empty state uses 'predictions' language",
  /Recent predictions appear once the first slate has run/.test(PAGE),
);
check(
  "Candidate hides the internal Recent Predictions activity stream",
  /presentation === "current" \? \([\s\S]{0,160}<Section eyebrow="Latest activity" title="Recent Predictions">/.test(PAGE),
);
check(
  "Candidate keeps Latest Results as its member-facing graded feed",
  /title="Latest Results"[\s\S]{0,500}RecentlySettledCard/.test(PAGE),
);

// ── Mobile / layout ─────────────────────────────────────────────────

check("Page constrains content max width 4xl",  PAGE.includes("max-w-4xl"));
check("Page has lg breakpoint padding",          PAGE.includes("lg:px-8"));
check("Header drops big metric grid",            !/grid-cols-2 lg:grid-cols-4/.test(PAGE));

// ── Service / API (carried forward, unchanged this push) ────────────

check("Service exposes SportMarketBucket",        SERVICE.includes("export type SportMarketBucket"));
check("Service exposes RecentPickRow",            SERVICE.includes("export type RecentPickRow"));
check("Service computes bySportMarket",           /bySportMarket:\s*SportMarketBucket\[\]/.test(SERVICE));
check(
  "Service pages prediction_records instead of relying on capped select('*')",
  SERVICE.includes("TRACKING_PAGE_SIZE") &&
    SERVICE.includes("fetchAllPredictionRecords") &&
    /\.range\(fromRow, fromRow \+ TRACKING_PAGE_SIZE - 1\)/.test(SERVICE),
);
check(
  "Member Tracking projects grade labels instead of downloading full audit snapshots",
  SERVICE.includes("tracking_display_grade_override:snapshot_json->>tracking_display_grade_override") &&
    SERVICE.includes("member_facing_grade:snapshot_json->member_facing_at_lock->>grade") &&
    !/TRACKING_RECORD_SELECT[\s\S]{0,2200}\n\s*"snapshot_json",/.test(SERVICE),
);
check(
  "Service chunks prediction_grades loads so all paged records can grade",
  SERVICE.includes("TRACKING_GRADE_ID_CHUNK_SIZE") &&
    SERVICE.includes("fetchGradesForRecordIds"),
);
check(
  "Service applies official public tracking start boundary before member aggregation",
  SERVICE.includes("isPublicallyTracked") &&
    /publicStartFiltered[\s\S]{0,300}isPublicallyTracked\(r\.sport, r\.slate_date\)/.test(SERVICE),
);
check(
  "Service prefers explicit tracking display override before member_facing_at_lock",
  SERVICE.includes("memberFacingGradeAtLock") &&
    SERVICE.includes("displayGradeOverride") &&
    SERVICE.includes("member_facing_at_lock") &&
    /displayGradeOverride\(record\)[\s\S]{0,160}memberFacingGradeAtLock\(record\)/.test(SERVICE),
);
// Phase 6B.24 — first_inning records must split into virtual NRFI / YRFI
// buckets so the public Tracking page's NRFI / YRFI categories see
// today's grades alongside the historical baselines.
check(
  "Service emits virtual mlb::nrfi bucket from first_inning + pick=NRFI",
  /groups\.set\("mlb::nrfi", nrfiRows\)/.test(SERVICE),
);
check(
  "Service emits virtual mlb::yrfi bucket from first_inning + pick=YRFI",
  /groups\.set\("mlb::yrfi", yrfiRows\)/.test(SERVICE),
);
check(
  "Service splits NRFI / YRFI by uppercased pick (case-safe)",
  /String\(r\.record\.pick \?\? ""\)\.toUpperCase\(\)\s*===\s*"NRFI"/.test(SERVICE) &&
    /String\(r\.record\.pick \?\? ""\)\.toUpperCase\(\)\s*===\s*"YRFI"/.test(SERVICE),
);
check("API surfaces bySportMarket",               API.includes("bySportMarket: result.bySportMarket"));
check("API surfaces yesterday",                   API.includes("yesterday: result.yesterday"));
check("API surfaces thisWeek",                    API.includes("thisWeek: result.thisWeek"));
check("API surfaces recentPicks",                 API.includes("recentPicks: result.recentPicks"));
check("API surfaces recentlySettled (6B.21)",     API.includes("recentlySettled: result.recentlySettled"));
check("API does not expose raw audit fields",     !/sport_specific|fi_v2_audit|v2_2_audit|snapshot_json/.test(API));
check(
  "member tracking reads a cron-published fast snapshot before the expensive aggregate",
  API.includes("trackingFoundationSnapshotKey") &&
    API.includes("readLabResponseSnapshot") &&
    API.includes('snapshotBypass") !== "true"'),
);
check(
  "Tracking cutover primer is read-only unless explicitly applied",
  TRACKING_PRIMER.includes('process.argv.includes("--apply")') &&
    TRACKING_PRIMER.includes("buildTrackingFoundationSnapshotBody") &&
    TRACKING_PRIMER.includes("No snapshot was written") &&
    TRACKING_PRIMER.includes("refreshTrackingFoundationResponseSnapshot"),
);
check(
  "background Tracking snapshot builds have a cron-safe budget while member requests still fail fast",
  API.includes("TRACKING_AGGREGATE_TIMEOUT_MS = 30000") &&
    API.includes("TRACKING_SNAPSHOT_BUILD_TIMEOUT_MS = 120000") &&
    API.includes("input.timeoutMs ?? TRACKING_SNAPSHOT_BUILD_TIMEOUT_MS"),
);
check("API does not expose model-version breakdowns to members", !API.includes("byModelVersion"));
check("API excludes launch-day picks",            API.includes("includeLaunchDay: false"));
check(
  "API privately caches the expensive tracking snapshot",
  API.includes("TRACKING_RESPONSE_CACHE_CONTROL") &&
    API.includes('"Cache-Control": TRACKING_RESPONSE_CACHE_CONTROL') &&
    API.includes('"X-Oddsphere-Tracking-Cache"') &&
    API.includes('"Vary": "Cookie"'),
);
check(
  "Tracking avoids stacked browser stale cache over the server aggregate",
  API.includes('TRACKING_RESPONSE_CACHE_CONTROL = "private, no-store"') &&
    !API.includes("cached.freshUntilMs > nowMs"),
);
check(
  "API shares the five-minute aggregate cache across server instances",
  API.includes("unstable_cache") &&
    API.includes('"member-tracking-aggregate-v1"') &&
    API.includes("TRACKING_RESPONSE_CACHE_TTL_MS / 1000"),
);
check(
  "Slow member routes provide immediate loading states",
  TRACKING_LOADING.includes("Loading verified tracking results") &&
    PROPS_LOADING.includes("Loading the latest player props"),
);
check(
  "Tracking retries one transient cold load and leaves a manual recovery action",
  PAGE.includes("loadAttempt === 0") &&
    PAGE.includes("setLoadAttempt(1)") &&
    PAGE.includes("Retry tracking") &&
    PAGE.includes("setLoadAttempt((attempt) => attempt + 1)"),
);
check(
  "Lab navigation shows pending feedback without changing destinations",
  LAB_NAV.includes("useLinkStatus") && LAB_NAV.includes("NavigationPendingIndicator"),
);

// ── 6B.21 — Recently Settled feed ─────────────────────────────────
check(
  "Service exposes RecentlySettledPickRow",
  SERVICE.includes("export type RecentlySettledPickRow"),
);
check(
  "Service populates result.recentlySettled",
  SERVICE.includes("result.recentlySettled ="),
);
check(
  "Service sorts recentlySettled by graded_at DESC",
  /sort\([^)]*\)[\s\S]{0,400}graded_at[\s\S]{0,200}slice\(0, 20\)/.test(SERVICE) ||
    /settledRows[\s\S]{0,400}graded_at[\s\S]{0,200}slice\(0, 20\)/.test(SERVICE),
);
check(
  "Service filters out pending from recentlySettled",
  /settledRows\s*=\s*rows\.filter[\s\S]{0,200}result !== "pending"/.test(SERVICE),
);
check(
  "Page declares RecentlySettledRow type",
  PAGE.includes("type RecentlySettledRow"),
);
check(
  "Page renders Latest Results section",
  /title="Latest Results"/.test(PAGE),
);
check(
  "Page caps Latest Results at ~12",
  /recentlySettled[\s\S]{0,300}\.slice\(0, 12\)/.test(PAGE),
);
check(
  "Page RecentlySettledCard handles win/loss/push/void only (no pending)",
  /RecentlySettledCard[\s\S]{0,1200}resultStyles[\s\S]{0,400}win:[\s\S]{0,400}loss:[\s\S]{0,400}push:[\s\S]{0,400}void:/.test(PAGE) &&
    !/RecentlySettledCard[\s\S]{0,1500}pending:\s*\{/.test(PAGE),
);

// ── Canonical route (from 6B.2c) ────────────────────────────────────

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
