import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MEMBER_DATA_READ_TIMEOUT_MS } from "../lib/services/memberDataAvailability";

const page = readFileSync("app/lab/daily-edge/CandidateDailyEdgePage.tsx", "utf8");
const reader = readFileSync("app/dev/experience-preview/ActualDailyEdgePreview.tsx", "utf8");

assert.match(page, /const readCachedCfbMemberFixture = unstable_cache\(/);
assert.match(page, /readCfbForwardMemberSnapshot\(\{ client: supabase, season \}\)/);
assert.match(page, /if \(published\) return published\.fixture/);
assert.match(page, /\["cfb-current-member-fixture", CFB_MEMBER_FIXTURE_RELEASE, CFB_FORWARD_MEMBER_SNAPSHOT_RELEASE\]/);
assert.match(page, /revalidate: 60, tags: \[CFB_MEMBER_FIXTURE_RELEASE\]/);
assert.match(page, /const CFB_MEMBER_DATA_READ_TIMEOUT_MS = 15_000/);
assert.match(page, /label: "cfb-daily-edge-fixture",[\s\S]*timeoutMs: CFB_MEMBER_DATA_READ_TIMEOUT_MS,[\s\S]*read: \(\) => readCachedCfbMemberFixture\(/);
assert.equal(MEMBER_DATA_READ_TIMEOUT_MS, 8_000, "other member reads retain the existing bounded deadline");
assert.match(page, /read: \(\) => readCachedCfbMemberFixture\(/);
assert.match(page, /label: "CFB · Weekly slate · evidence temporarily unavailable"[\s\S]*unavailable: true/);
assert.match(reader, /weeklySlate\?\.unavailable \? <WeeklySlateEvidenceUnavailable/);
assert.match(reader, /this does not mean the weekly schedule is empty/i);

console.log("CFB member reader caches the expensive fixture and never labels a read timeout as an empty slate.");
