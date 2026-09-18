import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MEMBER_DATA_READ_TIMEOUT_MS } from "../lib/services/memberDataAvailability";

const page = readFileSync("app/lab/daily-edge/CandidateDailyEdgePage.tsx", "utf8");
const reader = readFileSync("app/dev/experience-preview/ActualDailyEdgePreview.tsx", "utf8");
const snapshotStore = readFileSync("lib/services/football/cfbForwardMemberSnapshotStore.ts", "utf8");

assert.match(page, /const readCachedCfbMemberFixture = unstable_cache\(/);
assert.match(page, /readCfbForwardMemberSnapshot\(\{ client: supabase, season \}\)/);
assert.match(page, /return published\?\.fixture \?\? null/);
assert.doesNotMatch(page, /readCurrentCfbMemberFixture/, "the member request must never rebuild the full immutable evidence season");
assert.match(page, /CFB_MEMBER_SNAPSHOT_READER_RELEASE/);
assert.match(page, /revalidate: 60, tags: \[CFB_MEMBER_FIXTURE_RELEASE\]/);
assert.match(page, /const CFB_MEMBER_DATA_READ_TIMEOUT_MS = 20_000/);
assert.match(page, /return cached \?\? readUncachedCfbMemberFixture\(season\)/, "a cached miss must retry the compact snapshot directly");
assert.match(page, /label: "cfb-daily-edge-fixture",[\s\S]*timeoutMs: CFB_MEMBER_DATA_READ_TIMEOUT_MS,[\s\S]*read: \(\) => readResilientCfbMemberFixture\(/);
assert.equal(MEMBER_DATA_READ_TIMEOUT_MS, 8_000, "other member reads retain the existing bounded deadline");
assert.match(snapshotStore, /CFB_FORWARD_PREVIOUS_MEMBER_SNAPSHOT_RELEASE/);
assert.match(snapshotStore, /source", "cfb_forward_evidence_writer"/);
assert.match(snapshotStore, /SUPPORTED_MEMBER_SNAPSHOT_RELEASES/, "only explicit current and previous release pairs may bridge a rollout");
assert.match(page, /label: "CFB · Weekly slate · evidence temporarily unavailable"[\s\S]*unavailable: true/);
assert.match(reader, /renderedWeeklySlate\?\.unavailable \? <WeeklySlateEvidenceUnavailable/);
assert.match(reader, /this does not mean the weekly schedule is empty/i);

console.log("CFB member reader preserves the compact snapshot deadline, retries cached misses, and bridges verified release transitions.");
