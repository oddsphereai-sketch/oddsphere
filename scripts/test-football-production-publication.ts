import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  isNflDailyEdgeEnabled,
  isNflDailyEdgePublicationEnabled,
  NFL_DAILY_EDGE_PUBLICATION_RELEASE,
} from "../lib/config/nflDailyEdge";
import type { NflMemberSnapshot } from "../lib/services/football/nflMemberSnapshotStore";
import {
  auditNflMemberSnapshot,
  buildNflPublishedMemberSnapshot,
} from "../lib/services/football/nflPublishedMemberSnapshotStore";

const root = path.resolve("football-research/cache/nfl-model/current");
const pointer = JSON.parse(readFileSync(path.join(root, "nfl_daily_edge.current.json"), "utf8")) as {
  filename: string;
  sha256: string;
};
const fixture = JSON.parse(readFileSync(path.join(root, pointer.filename), "utf8")) as NflMemberSnapshot;
const publicationReadyFixture = structuredClone(fixture);
publicationReadyFixture.storedAt = "2026-08-20T23:00:00.000Z";
publicationReadyFixture.snapshot.as_of = "2026-08-20T23:00:00.000Z";

const healthy = auditNflMemberSnapshot({
  fixture: publicationReadyFixture,
  now: new Date("2026-08-20T23:10:00.000Z"),
});
assert.equal(healthy.healthy, true, healthy.critical.join("; "));
assert.equal(healthy.metrics.games, 16);
assert.equal(healthy.metrics.predictions, 48);
assert.equal(healthy.metrics.pricedMarkets, 48);
assert.equal(healthy.metrics.openingTrailGames, 16);
assert.equal(healthy.metrics.availabilityGames, 16);

const trackingViolation = structuredClone(publicationReadyFixture);
(trackingViolation.tracking as { trackingEligible: boolean }).trackingEligible = true;
assert.equal(
  auditNflMemberSnapshot({
    fixture: trackingViolation,
    now: new Date("2026-08-20T23:10:00.000Z"),
  }).critical.some((finding) => finding.includes("tracking-eligible")),
  true,
);

const stale = structuredClone(publicationReadyFixture);
stale.snapshot.as_of = "2026-08-20T20:00:00.000Z";
assert.equal(
  auditNflMemberSnapshot({
    fixture: stale,
    now: new Date("2026-08-20T23:10:00.000Z"),
  }).critical.some((finding) => finding.includes("provider snapshot age")),
  true,
);

const initial = buildNflPublishedMemberSnapshot({
  fixture: publicationReadyFixture,
  sourceSnapshotSha256: pointer.sha256,
  now: new Date("2026-08-20T23:10:00.000Z"),
});
assert.equal(initial.publicationRelease, NFL_DAILY_EDGE_PUBLICATION_RELEASE);
assert.deepEqual(initial.lockedGameIds, []);
const refreshed = structuredClone(publicationReadyFixture);
refreshed.snapshot.games[0].decisionLine = "This post-kickoff mutation must not publish.";
const afterKickoff = buildNflPublishedMemberSnapshot({
  fixture: refreshed,
  sourceSnapshotSha256: pointer.sha256,
  existing: initial,
  now: new Date("2026-08-21T00:01:00.000Z"),
});
assert.equal(afterKickoff.lockedGameIds.includes(initial.fixture.snapshot.games[0].id), true);
assert.equal(
  afterKickoff.fixture.snapshot.games[0].decisionLine,
  initial.fixture.snapshot.games[0].decisionLine,
);

assert.equal(isNflDailyEdgeEnabled({ NODE_ENV: "development" }), true);
assert.equal(isNflDailyEdgeEnabled({ NODE_ENV: "production" }), false);
assert.equal(isNflDailyEdgeEnabled({ NODE_ENV: "production", NFL_DAILY_EDGE_ENABLED: "true" }), true);
assert.equal(isNflDailyEdgePublicationEnabled({}), false);
assert.equal(isNflDailyEdgePublicationEnabled({ NFL_DAILY_EDGE_PUBLICATION_ENABLED: "true" }), true);

const pageSource = readFileSync("app/lab/daily-edge/page.tsx", "utf8");
const candidateSource = readFileSync("app/lab/daily-edge/CandidateDailyEdgePage.tsx", "utf8");
const operatorSource = readFileSync("scripts/operator/publish-current-nfl-member-snapshot.ts", "utf8");
const healthSource = readFileSync("app/api/cron/nfl-daily-edge-health/route.ts", "utf8");
assert.match(pageSource, /isNflDailyEdgeEnabled/);
assert.match(candidateSource, /readCurrentNflPublishedMemberSnapshot/);
assert.match(operatorSource, /NFL_DAILY_EDGE_PUBLICATION_ENABLED/);
assert.match(operatorSource, /cronJobName\("prediction_pipeline", "nfl"\)/);
assert.match(operatorSource, /readback/);
assert.match(healthSource, /tracking_eligible/);

console.log("Football production publication: feature gates, freshness, coverage, tracking exclusion, post-kickoff freeze, and readback contract passed");
