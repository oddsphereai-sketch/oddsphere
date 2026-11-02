import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import type { DailyEdgeResponse } from "../app/lab/lib/labTypes";
import { encodePublishedMemberPayload, decodePublishedMemberPayload } from "../lib/services/publishedMemberPayloadCache";

async function main() {
  const locked = { id: "cbb-123", lockedAt: "2026-11-02T14:30:00.000Z", projected: {away: 71.23, home: 82.34},
    markets: {total: {pick: "Under 153.5", priceAmerican: -115, sportsbook: "draftkings", line: 153.5,
      sourceObservedAt: "2026-11-02T14:29:00.000Z", probability: 0.56789,
      oddsTrail: Array.from({length: 400}, (_, i) => ({observedAt: `2026-11-02T14:29:${String(i % 60).padStart(2,"0")}.000Z`, american: -115, line: 153.5, sportsbook: "draftkings"}))}}};
  const payload = {sport: "cbb", date: "2026-11-02", as_of: "2026-11-02T14:30:00.000Z",
    games: Array.from({length: 116}, () => structuredClone(locked))} as unknown as DailyEdgeResponse;
  assert.ok(JSON.stringify(payload).length > 2 * 1024 * 1024, "fixture reproduces the framework cache limit");
  const compressed = encodePublishedMemberPayload(payload);
  assert.ok(JSON.stringify(compressed).length < 2 * 1024 * 1024);
  assert.deepEqual(decodePublishedMemberPayload(compressed), payload, "locked values and full evidence remain exactly equal");
  assert.equal(payload.games[0].lockedAt, locked.lockedAt, "encoding never mutates the input");
  for (const sport of ["nba", "nfl", "nhl", "mlb"] as const) {
    const other = {...payload, sport};
    assert.equal(encodePublishedMemberPayload(other), other, "other sports keep the original representation");
  }
  assert.throws(() => decodePublishedMemberPayload({encoding: "gzip-base64", payload: "corrupt"}));

  let available = true;
  let revalidating = false;
  let reads = 0;
  let cached: unknown;
  const dependencies: Record<string, unknown> = {
    "next/cache": {unstable_cache(callback: (...args: unknown[]) => Promise<unknown>, _keys: string[], options: {revalidate: number}) {
      return async (...args: unknown[]) => {
        if (options.revalidate !== 15) return callback(...args);
        if (cached !== undefined && !revalidating) return cached;
        try {
          const value = await callback(...args);
          assert.ok(JSON.stringify(value).length < 2 * 1024 * 1024, "actual reader returns a cacheable envelope");
          cached = value;
          return value;
        } catch (error) {
          if (cached !== undefined) return cached; // framework stale-on-revalidation-error
          throw error;
        }
      };
    }},
    "@/lib/services/publishedMemberPayloadCache": {encodePublishedMemberPayload, decodePublishedMemberPayload},
    "@/lib/services/labResponseSnapshots": {
      DAILY_EDGE_PUBLISHED_MEMBER_CACHE_RELEASE: "daily-edge-published-member-payload-v3-lossless-cbb-history",
      DAILY_EDGE_PUBLISHED_MEMBER_CACHE_TAG: "published", dailyEdgeSnapshotKey: () => "cbb::today",
      async readLabResponseSnapshot() { reads++; return available ? {payload} : null; },
    },
    "@/lib/dates/slateDate": {currentSlateDate: () => "2026-11-02"},
    "@/app/lab/lib/dailyEdgeMarketPresentation": {},
    "@/app/lab/lib/dailyEdgeResponseCoherence": {finalizeDailyEdgeResponseCoherence: (value: DailyEdgeResponse) => value},
    "@/lib/db/supabase": {},
    "@/app/lab/lib/dailyEdgeFirstInningHistory": {},
  };
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(ts.transpileModule(readFileSync("app/dev/experience-preview/previewData.ts", "utf8"), {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS},
  }).outputText, {exports, console, structuredClone, require(name: string) {
    assert.ok(Object.hasOwn(dependencies, name), `unexpected dependency ${name}`);
    return dependencies[name];
  }});
  const load = exports.loadPublishedDailyEdgeSnapshot as (sport: string) => Promise<DailyEdgeResponse>;
  assert.deepEqual(await load("cbb"), payload);
  const initialReads = reads;
  assert.deepEqual(await load("cbb"), payload);
  assert.equal(reads, initialReads, "warm reads avoid the database download");
  available = false;
  revalidating = true;
  assert.deepEqual(await load("cbb"), payload, "transient missing DB read cannot cache null over the verified record");
  cached = undefined;
  await assert.rejects(load("cbb"), /snapshot unavailable/, "a cold outage remains explicit, never synthesizes a board");
  available = true;
  assert.deepEqual(await load("cbb"), payload, "a prior missing read does not poison later recovery");
  console.log("PASS oversized CBB cache roundtrip, exact locked evidence, warm database avoidance, stale-on-error continuity and cold recovery");
}

main().catch(error => {console.error(error); process.exitCode = 1;});
