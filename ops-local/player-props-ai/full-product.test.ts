import assert from "node:assert/strict";
import { PRODUCT_RELEASE, type GamePacket } from "./catalog";
import { digest, requiredReviewSchema, parseRequiredReview, validateReview, type Review } from "./core";
import { enrichCachedPacket, type EnrichedSource } from "./enrichment";
import { planPartitions } from "./partitions";
import { pointForecasts } from "./point-forecast";
import { summarizeNumbers, readableInput, expandReadableCitations } from "./readable";
import { probabilityProposals, scoreProspective } from "./probability-proposals";
const packet: GamePacket = { release: PRODUCT_RELEASE, sport: "nba", gameId: "synthetic-game", start: "2026-11-06T23:00:00Z", lock: "2026-11-06T22:00:00Z", stage: "final", cutoff: "2026-11-06T21:55:00Z", quotes: [], sourceLimitations: [],
  players: [{ id: "p", name: "Synthetic Player", team: "A", opponent: "B", markets: ["points", "rebounds", "points_rebounds"], missing: [], evidence: [
    { id: "model-points", kind: "independent_model", source: "synthetic-model", availableAt: "2026-11-06T12:00:00Z", value: { market: "points", line: 20.5, independentProjection: 18, storedGrade: "synthetic-private-prior-grade", lockedPayloadDigest: "synthetic-audit-hash" } },
    { id: "model-rebounds", kind: "independent_model", source: "synthetic-model", availableAt: "2026-11-06T12:00:00Z", value: { market: "rebounds", line: 3.5, independentProjection: 3 } },
  ] }] };
const baseline = digest(packet);
const review: Review = { players: [{ playerId: "p", assessment: "Synthetic player assessment", gaps: [], markets: packet.players[0].markets.map(market => ({ market, proposedProjection: market === "points" ? 19 : market === "rebounds" ? 4 : 999, forecastDirection: "raise", interpretation: "Synthetic forecast", evidenceIds: ["model-points"], gaps: [] })) }] };
const rows = pointForecasts(packet, review);
assert.equal(rows[0].direction, "raise"); // 19 is below the 20.5 line but ABOVE the 18 baseline.
assert.equal(rows[2].coherentPointProjection, 23); assert.equal(rows[2].aiProposedProjection, 999);
const wrong = structuredClone(review); wrong.players[0].markets[0].forecastDirection = "lower";
assert.equal(pointForecasts(packet, wrong)[0].directionConsistent, false);
const schema = requiredReviewSchema(packet);
const players = schema.properties.players as { required: string[]; properties: Record<string, { properties: { markets: { required: string[] } } }> };
assert.deepEqual(players.required, ["p"]); assert.deepEqual(players.properties.p.properties.markets.required, packet.players[0].markets);
const wire = { globalGaps: [], players: { p: { assessment: "Synthetic", gaps: [], markets: Object.fromEntries(review.players[0].markets.map(m => [m.market, { proposedProjection: m.proposedProjection, proposedEventProbability: 0.5, evidenceIds: m.evidenceIds, exception: null }])) } } };
validateReview(packet, parseRequiredReview(wire, packet));
assert.throws(() => parseRequiredReview({ players: [] }, packet));
const aliased = structuredClone(review); aliased.players[0].markets.forEach(m => { m.evidenceIds = ["e0"]; });
assert.equal(expandReadableCitations(packet, aliased).players[0].markets[0].evidenceIds[0], "model-points");
const readable = JSON.stringify(readableInput(packet));
assert.ok(!readable.includes("synthetic-private-prior-grade") && !readable.includes("synthetic-audit-hash"));
assert.ok(JSON.stringify(packet).includes("synthetic-private-prior-grade")); // Archive unchanged; prior grade is not an AI instruction/input.
assert.deepEqual(summarizeNumbers([0, 1, 2, 3, null]), { n: 4, missing: 1, mean: 1.5, sd: Math.sqrt(1.25), min: 0, max: 3, q25: 0.75, median: 1.5, q75: 2.25, zeroFraction: 0.25 });

const source = { priorNba: { updatedAt: "2026-11-06T12:00:00Z" }, currentNba: { updatedAt: "2026-11-06T12:00:00Z" }, nbaContext: [{ generated_at: "2026-11-06T20:00:00Z", payload: { games: [{ awayTeam: "A", homeTeam: "B", gameStartAt: packet.start, generatedAt: "2026-11-06T20:00:00Z", nbaAvailability: { away: { known: true, players: [{ name: "Synthetic Player", status: "questionable", reportedAt: "2026-11-06T19:00:00Z" }] }, home: { known: true, players: [] } } }] } }] } as unknown as EnrichedSource;
assert.ok(enrichCachedPacket(packet, source).players[0].evidence.some(e => e.kind === "availability"));
const future = structuredClone(source); (future.nbaContext![0].payload.games[0].nbaAvailability as { away: { players: { reportedAt: string }[] } }).away.players[0].reportedAt = "2026-11-06T22:00:00Z";
assert.ok(!enrichCachedPacket(packet, future).players[0].evidence.some(e => e.kind === "availability"));
const wrongOpponent = structuredClone(source); wrongOpponent.nbaContext![0].payload.games[0].homeTeam = "C";
assert.ok(!enrichCachedPacket(packet, wrongOpponent).players[0].evidence.some(e => e.kind === "availability"));
const unknownAvailability = structuredClone(source);
(unknownAvailability.nbaContext![0].payload.games[0].nbaAvailability as { away: { known: boolean } }).away.known = false;
assert.ok(enrichCachedPacket(packet, unknownAvailability).players[0].missing.some(m => m.includes("incomplete team coverage")));
assert.equal(digest(packet), baseline);
const probabilistic = structuredClone(review); probabilistic.players[0].markets.forEach(m => { m.proposedEventProbability = m.market === "points" ? 0.6 : null; });
const proposals = probabilityProposals(packet, probabilistic, "synthetic", "2026-11-06T21:56:00Z");
assert.equal(scoreProspective(proposals, []).pending, 1);
const settled = [{ id: proposals[0].id, status: "settled" as const, stat: 22, availableAt: "2026-11-07T03:00:00Z", source: "synthetic-official-result" }];
const scored = scoreProspective(proposals, settled).rows[0]; assert.ok(scored.scored && Math.abs(scored.candidateBrier - 0.16) < 1e-12);
assert.equal(scoreProspective(proposals, [{ ...settled[0], status: "void", stat: null }]).rows[0].scored, false);
assert.equal(scoreProspective(proposals.map(p => ({ ...p, issuedAt: "2026-11-07T03:00:00Z" })), settled).rows[0].scored, false);
assert.throws(() => scoreProspective([...proposals, ...proposals], settled), /Duplicate stage/);

async function main() {
  const group = { ...packet, players: [packet.players[0], { ...packet.players[0], id: "p2", name: "Synthetic Two", evidence: [] }, { ...packet.players[0], id: "p3", name: "Synthetic Three", team: "B", opponent: "A", evidence: [] }] };
  const count = async (body: { input: string }) => JSON.parse(body.input).players.length > 2 ? 240_000 : 100_000;
  const parts = await planPartitions(group, "gpt-6-luna", 16000, count);
  assert.equal(parts.length, 2); assert.deepEqual(parts.flatMap(p => p.packet.players.map(p => p.id)).sort(), ["p", "p2", "p3"]);
  assert.ok(parts.every(p => p.packet.sharedGameContext && p.inputTokens <= 220000));
  assert.deepEqual(parts[0].packet.players[0].markets, group.players[0].markets);
  console.log("Full-product source, required-scope, partition and point-consequence tests passed: no network calls.");
}
void main();
