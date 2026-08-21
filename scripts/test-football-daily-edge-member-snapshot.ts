import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NFL_MEMBER_SNAPSHOT_RELEASE } from "../lib/services/football/nflMemberSnapshotStore";
import {
  NFL_REGULAR_LOCAL_CALIBRATION_RELEASE,
  NFL_REGULAR_LOCAL_FEATURE_RELEASE,
  NFL_REGULAR_LOCAL_MODEL_RELEASE,
  NFL_REGULAR_LOCAL_REFERENCE_RELEASE,
  NFL_REGULAR_LOCAL_SNAPSHOT_RELEASE,
  NFL_REGULAR_LOCAL_SOURCE_MODEL_RELEASE,
} from "../lib/services/football/nflRegularLocalSlate";
import { NFL_REGULAR_MARKET_EVIDENCE_RELEASE } from "../lib/services/football/nflRegularMarketEvidence";
import { NFL_REGULAR_DECISION_RELEASE } from "../lib/services/football/nflRegularDecision";

const root = path.resolve("football-research/cache/nfl-model/current");
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function readPointer(name: string) {
  const pointer = JSON.parse(readFileSync(path.join(root, name), "utf8")) as {
    memberSnapshotRelease: string;
    filename: string;
    sha256: string;
    seasonPhase: string;
    week: number;
  };
  const bytes = readFileSync(path.join(root, pointer.filename));
  assert.equal(pointer.memberSnapshotRelease, NFL_MEMBER_SNAPSHOT_RELEASE);
  assert.equal(sha256(bytes), pointer.sha256);
  return { pointer, payload: JSON.parse(bytes.toString("utf8")) };
}

const current = readPointer("nfl_daily_edge.current.json");
assert.equal(current.pointer.seasonPhase, "preseason");
assert.equal(current.pointer.week, 2);
assert.equal(current.payload.snapshot.games.length, 16);
assert.equal(current.payload.snapshot.games.length * 3, 48);
assert.equal(current.payload.tracking.trackingEligible, false);
assert.equal(current.payload.tracking.reason, "NFL preseason is excluded from official and lifetime tracking.");
assert.deepEqual(
  current.payload.snapshot.games.slice(0, 2).map((game: { awayTeam: string; homeTeam: string }) => [game.awayTeam, game.homeTeam]),
  [["LV", "HOU"], ["SF", "LAC"]],
);
const currentMarkets = current.payload.snapshot.games.flatMap(
  (game: { markets: Record<string, { verdict: { label: string } }> }) => Object.values(game.markets),
);
assert.equal(currentMarkets.length, 48);
assert.equal(currentMarkets.filter((market: { verdict: { label: string } }) => market.verdict.label === "Lean").length > 0, true);
assert.equal(current.payload.provenance.firstObservedCoverageGames, 16);
assert.equal(current.payload.provenance.minimumStoredPriceObservations >= 3, true);

const regular = readPointer("nfl_daily_edge.regular.json");
assert.equal(regular.pointer.seasonPhase, "regular");
assert.equal(regular.pointer.week, 1);
assert.equal(regular.payload.snapshot.games.length, 16);
assert.equal(regular.payload.snapshot.games.length * 3, 48);
assert.equal(regular.payload.tracking.trackingEligible, false);
assert.equal(regular.payload.provenance.firstObservedCoverageGames, 16);
assert.equal(regular.payload.provenance.minimumStoredPriceObservations >= 2, true);
assert.equal(regular.payload.provenance.splitCoverageGames, 16);
assert.equal(regular.payload.provenance.decisionRelease, NFL_REGULAR_DECISION_RELEASE);
const regularMarkets = regular.payload.snapshot.games.flatMap(
  (game: { markets: Record<string, { verdict: { label: string }; publicSplits: unknown[] }> }) => Object.values(game.markets),
);
assert.equal(regularMarkets.filter((market: { verdict: { label: string } }) => market.verdict.label === "Watchlist").length, 3);
assert.equal(regularMarkets.filter((market: { verdict: { label: string } }) => market.verdict.label === "No Play").length, 45);
assert.equal(regularMarkets.filter((market: { verdict: { label: string } }) => market.verdict.label === "Lean").length, 0);
assert.equal(regularMarkets.every((market: { publicSplits: unknown[] }) => market.publicSplits.length === 2), true);

const scored = JSON.parse(readFileSync(path.join(root, "nfl_regular_2026_week_1.daily-edge.scored.json"), "utf8")) as {
  snapshotRelease: string;
  modelRelease: string;
  referenceRelease: string;
  sourceModelRelease: string;
  calibrationRelease: string;
  featureRelease: string;
  marketEvidenceRelease: string;
  marketEvidenceSha256: string;
  localOnly: boolean;
  actionable: boolean;
  trackingEligible: boolean;
  projectionsByGame: Record<string, {
    referenceProjectedHomeMargin: number;
    projectedHomeMargin: number;
    playerValueTotalCorrection: number;
    homeQuarterbackHistoryMatched: boolean;
    awayQuarterbackHistoryMatched: boolean;
  }>;
};
assert.equal(scored.snapshotRelease, NFL_REGULAR_LOCAL_SNAPSHOT_RELEASE);
assert.equal(scored.modelRelease, NFL_REGULAR_LOCAL_MODEL_RELEASE);
assert.equal(scored.referenceRelease, NFL_REGULAR_LOCAL_REFERENCE_RELEASE);
assert.equal(scored.sourceModelRelease, NFL_REGULAR_LOCAL_SOURCE_MODEL_RELEASE);
assert.equal(scored.calibrationRelease, NFL_REGULAR_LOCAL_CALIBRATION_RELEASE);
assert.equal(scored.featureRelease, NFL_REGULAR_LOCAL_FEATURE_RELEASE);
assert.equal(scored.marketEvidenceRelease, NFL_REGULAR_MARKET_EVIDENCE_RELEASE);
assert.equal(scored.marketEvidenceSha256.length, 64);
assert.equal(scored.localOnly, true);
assert.equal(scored.actionable, false);
assert.equal(scored.trackingEligible, false);
assert.equal(Object.keys(scored.projectionsByGame).length, 16);
for (const projection of Object.values(scored.projectionsByGame)) {
  assert.equal(projection.projectedHomeMargin, projection.referenceProjectedHomeMargin);
  assert.equal(Math.abs(projection.playerValueTotalCorrection) <= 1, true);
  assert.equal(projection.homeQuarterbackHistoryMatched, true);
  assert.equal(projection.awayQuarterbackHistoryMatched, true);
}

const pageSource = readFileSync("app/lab/daily-edge/page.tsx", "utf8");
const candidateSource = readFileSync("app/lab/daily-edge/CandidateDailyEdgePage.tsx", "utf8");
assert.match(pageSource, /nflMemberRead/);
assert.match(pageSource, /requestedSport === "nfl"/);
assert.match(candidateSource, /readCurrentNflMemberSnapshot/);
assert.match(candidateSource, /readCurrentNflPublishedMemberSnapshot/);
assert.match(candidateSource, /initialAvailability=\{nflFixture\?\.availability\}/);
assert.match(candidateSource, /preseason is excluded from official tracking/);

console.log("Football Daily Edge member snapshot: real slate, 48-market contract, releases, tracking boundary, and member route passed");
