import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { isInactiveMlbPropsRefresh, nbaPlayerPropsRefreshFailure, mlbPlayerPropsRefreshFailure } from "../lib/cron/playerPropsRefreshTelemetry";

const processHealth={status:'active',newlyCompletedReviews:0,findings:['source_or_review_unavailable:nba-bdl:21718081:source_or_preparation_timeout'],observedAt:'2026-11-11T22:47:38Z'};
assert.match(nbaPlayerPropsRefreshFailure({status:'published_private',aiReviewRuntime:processHealth})!,/scheduled coverage unverified/,'A native board publication cannot hide failed AI preparation');
assert.match(nbaPlayerPropsRefreshFailure({status:'published_private',aiReviewRuntime:{...processHealth,status:'unavailable',findings:[]}})!,/AI process unavailable/);
for(const finding of ['ai_process_finding_redacted','lock_source_unavailable:nba-bdl:21718081:source_or_preparation_timeout','pending_review_inventory_exceeds_two_slots_per_game','review_deferred_writer_game_bound','current_source_unavailable:g:unclassified','ai_process_findings_truncated'])assert.match(nbaPlayerPropsRefreshFailure({status:'published_private',aiReviewRuntime:{...processHealth,findings:[finding]}})!,/scheduled coverage unverified/,'Unknown or source-failed review health cannot become a green publication');
assert.equal(nbaPlayerPropsRefreshFailure({status:'published_private',aiReviewRuntime:{...processHealth,newlyCompletedReviews:1,findings:[]}}),null,'A healthy completed review clears the process exception');
assert.equal(nbaPlayerPropsRefreshFailure({status:'published_private',aiReviewRuntime:{...processHealth,status:'paid_disabled',findings:[]}}),null,'An intentional paid switch does not fabricate a failed scheduled review');
assert.equal(nbaPlayerPropsRefreshFailure({status:'published_private',aiReviewRuntime:{...processHealth,findings:['review_deferred_empty_current_offers:nba-bdl:21718081']}}),null,'Honest empty offered inventory is distinct from failed input preparation');
import type { MlbPropsBoardRefreshResult } from "../lib/mlb/props/liveBoard";

for (const status of ["bootstrap_required", "last_known_good_preserved"] as const) {
  assert.match(nbaPlayerPropsRefreshFailure({ status })!, /fresh publication unavailable/);
}
for (const status of ["published_private", "no_games"] as const) {
  assert.equal(nbaPlayerPropsRefreshFailure({ status }), null);
}

// Telemetry only consumes this narrow subset of the real writer result.
const inactive = {
  published: false,
  snapshot: { data: { slate: { matchups: [] }, props: [] },
    validation: { sourceRows: 0, errors: ["PROP_ODDS_UNAVAILABLE"] } },
} as unknown as MlbPropsBoardRefreshResult;
const original = JSON.stringify(inactive);
assert.equal(isInactiveMlbPropsRefresh(inactive), true);
const active = structuredClone(inactive);
active.snapshot.data.slate!.matchups.push({ awayTeam: "A", homeTeam: "B" } as never);
assert.equal(isInactiveMlbPropsRefresh(active), false, "missing odds for a real game must remain partial");
const broken = structuredClone(inactive);
broken.snapshot.validation.errors.push("ODDS_GAME_MAPPING_BELOW_90_PERCENT");
assert.equal(isInactiveMlbPropsRefresh(broken), false, "additional validation failures remain visible");
const sourceMismatch = structuredClone(inactive);
sourceMismatch.snapshot.validation.sourceRows = 1;
assert.equal(isInactiveMlbPropsRefresh(sourceMismatch), false, "unmatched provider rows are not an off-day");
const populated = structuredClone(inactive);
populated.snapshot.data.props.push({ lockedAt: "2026-11-01T00:00:00Z" } as never);
assert.equal(isInactiveMlbPropsRefresh(populated), false, "retained member records are not an empty slate");
assert.equal(JSON.stringify(inactive), original, "classification must never modify the stored candidate");
const unknownSchedule = structuredClone(inactive);
delete unknownSchedule.snapshot.data.slate;
assert.equal(isInactiveMlbPropsRefresh(unknownSchedule), false, "missing schedule evidence must not be called inactive");

const nbaRoute = readFileSync("app/api/cron/nba-daily-refresh/route.ts", "utf8");
assert.match(nbaRoute, /privatePlayerPropsError = nbaPlayerPropsRefreshFailure\(privatePlayerProps\)/);
assert.match(nbaRoute, /if \(privatePlayerPropsError\) partial = true/);
assert.match(nbaRoute, /leaseGroup: "prediction_pipeline"/);

async function testMlbRoute(): Promise<void> {
  let supplied = Object.assign(structuredClone(inactive), {
    tracking: { status: "disabled", error: null },
    providerCalls: { balldontlie: 2 },
  });
  let refreshes = 0;
  const code = ts.transpileModule(readFileSync("app/api/cron/mlb-player-props-refresh/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exported: Record<string, unknown> = {};
  const dependencies: Record<string, unknown> = {
    "@/lib/cron/runCron": { cronHandler: async (_request: Request, _source: string, run: (context:{runId:string}) => Promise<unknown>, options: Record<string, unknown>) => {
      assert.equal(options.leaseGroup, "prediction_pipeline");
      assert.equal(options.requireLease, true);
      return run({runId:'offline-shared-mlb-writer'});
    } },
    "@/lib/cron/playerPropsRefreshTelemetry": { isInactiveMlbPropsRefresh,mlbPlayerPropsRefreshFailure },
    "@/lib/mlb/props/liveBoard": { easternSlateDate: () => "2026-11-04", refreshMlbPropsBoard: async () => { refreshes++; return supplied; } },
    "@/lib/mlb/props/boardSnapshotStore": {},
    "@/lib/mlb/props/memberReadSnapshotStore": {},
    "@/lib/mlb/props/internalTracking": {},
  };
  vm.runInNewContext(code, { exports: exported, URL, console,
    process: { env: { MLB_PLAYER_PROPS_CRON_ENABLED: "true" } },
    require: (key: string) => { assert.ok(key in dependencies, `unexpected dependency ${key}`); return dependencies[key]; },
  });
  const get = exported.GET as (request: Request) => Promise<{ partial: boolean; error_message: string | null; details: { inactive: boolean; published: boolean } }>;
  const before = JSON.stringify(supplied);
  const empty = await get(new Request("https://test/api/cron/mlb-player-props-refresh"));
  assert.equal(empty.partial, false);
  assert.equal(empty.details.inactive, true);
  assert.equal(empty.details.published, false, "inactive classification cannot publish an empty replacement");
  assert.equal(empty.error_message, null);
  assert.equal(JSON.stringify(supplied), before);
  supplied = Object.assign(structuredClone(active), { tracking: { status: "disabled", error: null }, providerCalls: { balldontlie: 2 } });
  const missing = await get(new Request("https://test/api/cron/mlb-player-props-refresh"));
  assert.equal(missing.partial, true);
  assert.equal(missing.error_message, "PROP_ODDS_UNAVAILABLE");
  assert.equal(refreshes, 2, "telemetry must not introduce a second refresh or writer");
}

testMlbRoute().then(() => console.log("Player-props refresh telemetry and actual route tests passed.")).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
