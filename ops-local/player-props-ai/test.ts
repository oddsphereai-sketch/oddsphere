import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CATALOG, PRODUCT_RELEASE, type GamePacket, type Json } from "./catalog";
import { coverage, decode, digest, encode, pack, unpack, price, referencePairs, request, reweight, slots, validatePacket, validateReview } from "./core";
import { bill, evaluate, monthPlan, receiptTotal, type PairedForecast } from "./validation";
import { compileMarketReport } from "./market-report";
import { fromCachedExport, type CachedExport } from "./adapters";

const packet: GamePacket = {
  release: PRODUCT_RELEASE, sport: "nba", gameId: "synthetic-game", start: "2026-11-06T23:00:00Z", lock: "2026-11-06T22:00:00Z",
  cutoff: "2026-11-06T21:55:00Z", stage: "final", sourceLimitations: [],
  players: [{ id: "player-1", name: "Synthetic Player", team: "A", opponent: "B", markets: ["points", "points_rebounds"],
    evidence: [{ id: "e1", kind: "recent_games", availableAt: "2026-11-05T20:00:00Z", source: "synthetic-fixture", value: { points: 10.1234567890123, details: [null, {}, [], "quote"] } }], missing: [] }],
  quotes: [
    { id: "q1", playerId: "player-1", market: "points", provider: "synthetic", book: "target", line: 10.5, side: "over", american: -300, observedAt: "2026-11-06T21:54:00Z", receivedAt: "2026-11-06T21:54:01Z", live: false },
    { id: "q2", playerId: "player-1", market: "points", provider: "synthetic", book: "reference", line: 10.5, side: "over", american: -110, observedAt: "2026-11-06T21:54:00Z", receivedAt: "2026-11-06T21:54:01Z", live: false },
    { id: "q3", playerId: "player-1", market: "points", provider: "synthetic", book: "reference", line: 10.5, side: "under", american: -110, observedAt: "2026-11-06T21:54:00Z", receivedAt: "2026-11-06T21:54:01Z", live: false },
  ],
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const before = digest(packet);
assert.equal(validatePacket(packet).players, 1);
assert.deepEqual(decode(encode(packet as unknown as Json)), packet);
assert.deepEqual(unpack(pack(packet)), packet);
assert.deepEqual(decode(encode(["s", "a", "o", "", {}, [], 0, false, null])), ["s", "a", "o", "", {}, [], 0, false, null]);
assert.equal(digest({ a: 1, b: 2 }), digest({ b: 2, a: 1 }));
assert.equal(request(packet, "gpt-6-luna", 12000).store, false);
const research = compileMarketReport(packet);
assert.deepEqual(research.players.map(p => p.markets), packet.players.map(p => p.markets));
assert.equal(research.players[0].evidence.filter(e => e.kind === "market").length, 2);
assert.deepEqual(unpack(pack(research)), research);
const alternate = clone(packet); alternate.quotes.push({ ...alternate.quotes[0], id: "alternate-over", line: 20.5 }, { ...alternate.quotes[2], id: "alternate-under", line: 20.5 });
const summarized = compileMarketReport(alternate);
assert.equal(summarized.players[0].markets.length, 2);
assert.ok(summarized.quotes.length < alternate.quotes.length);
assert.equal(alternate.quotes.length, 5);
for (const mutate of [
  (p: GamePacket) => { p.players[0].evidence[0].availableAt = "2026-11-06T22:01:00Z"; },
  (p: GamePacket) => { p.quotes[0].receivedAt = "2026-11-06T22:01:00Z"; },
  (p: GamePacket) => { p.cutoff = "2026-11-05T21:55:00Z"; },
  (p: GamePacket) => { p.players.push(p.players[0]); },
  (p: GamePacket) => { p.quotes[0].line = NaN; },
]) { const p = clone(packet); mutate(p); assert.throws(() => validatePacket(p)); }

for (const start of ["2026-11-01T14:30:00Z", "2026-03-08T16:00:00Z", "2026-11-09T01:15:00Z"]) {
  const game = { ...packet, start, lock: new Date(Date.parse(start) - 3600000).toISOString() };
  const jobs = slots(game);
  assert.deepEqual(jobs.map(j => j.stage), ["early", "final"]);
  assert.notEqual(jobs[0].key, jobs[1].key);
  assert.ok(Date.parse(jobs[0].at) < Date.parse(jobs[1].at));
}
assert.throws(() => slots({ ...packet, start: "2026-11-06T05:05:00Z", lock: "2026-11-06T04:05:00Z" }));
const pairs = referencePairs(packet, { playerId: "player-1", market: "points", line: 10.5, book: "target" }, 300000);
assert.equal(pairs.length, 1); assert.equal(pairs[0].over, 0.5);
const mismatched = clone(packet); mismatched.quotes[2].line = 11.5;
assert.equal(referencePairs(mismatched, { playerId: "player-1", market: "points", line: 10.5, book: "target" }, 300000).length, 0);

const law = [{ id: "low", weight: 0.5, stats: { points: 8, rebounds: 2, assists: 1 } }, { id: "high", weight: 0.5, stats: { points: 12, rebounds: 6, assists: 3 } }];
const changed = reweight(law, [{ id: "low", multiplier: 1 }, { id: "high", multiplier: 3 }]);
assert.equal(price(changed, "points_rebounds", 15.5, "over", 100).win, 0.75);
assert.equal(price(changed, "points_rebounds", 15.5, "over", 100).mean, price(changed, "points", 9, "over", 100).mean + price(changed, "rebounds", 3, "over", 100).mean);
assert.deepEqual(price(changed, "points", 12, "under", -100), { mean: 11, win: 0.25, push: 0.75, loss: 0, ev: 0.25 });
assert.equal(law[0].weight, 0.5);
assert.throws(() => reweight(law, [{ id: "low", multiplier: 1 }, { id: "low", multiplier: 1 }]));
assert.throws(() => price(changed, "anytime_td", 0.5, "yes", 500)); // Never infer a TD event from yardage.
assert.equal(price(reweight([{ id: "negative", weight: 0.5, stats: { rushing_yards: -2 } }, { id: "positive", weight: 0.5, stats: { rushing_yards: 4 } }], [{ id: "negative", multiplier: 1 }, { id: "positive", multiplier: 1 }]), "rushing_yards", 0.5, "under", 100).win, 0.5);

const review = { players: [{ playerId: "player-1", markets: packet.players[0].markets.map(market => ({ market, interpretation: "Synthetic workload evidence supports retaining the baseline", forecastDirection: "retain", evidenceIds: ["e1"], gaps: [] })) }] };
validateReview(packet, review);
assert.throws(() => validateReview(packet, { players: [] }));
const fabricated = clone(review); fabricated.players[0].markets[0].evidenceIds = ["nonexistent"];
assert.throws(() => validateReview(packet, fabricated));
assert.equal(digest(packet), before); // All local readers/compilers left supplied records untouched.

assert.equal(bill("gpt-6-luna", { input: 100000, output: 12000 }), 0.016);
assert.equal(bill("gpt-6.1-terra", { input: 272000, output: 10000 }), 0.619);
const planArgs = { month: "2026-11", games: [{ sport: "nba" as const, id: "game", start: packet.start, input: { early: 100000, final: 100000 }, maxOutput: { early: 12000, final: 12000 } }], fullScheduleConfirmed: true, completeEvidenceConfirmed: true, inputCounts: "api" as const, observedOutputQualityPassed: true };
assert.equal(monthPlan(planArgs).logicalReviews, 2);
assert.equal(monthPlan(planArgs).budgetValidated, true);
assert.equal(monthPlan({ ...planArgs, inputCounts: "proxy" }).budgetValidated, false);
assert.equal(monthPlan({ ...planArgs, fullScheduleConfirmed: false }).budgetValidated, false);
assert.equal(monthPlan({ ...planArgs, ceiling: 0.01 }).budgetValidated, false);
assert.equal(monthPlan({ ...planArgs, maxStrongFinalFraction: 0.1 }).budgetValidated, false);
assert.equal(monthPlan({ ...planArgs, maxStrongFinalFraction: 0.1, games: planArgs.games.map(g => ({ ...g, finalModel: "gpt-6-luna" as const })) }).logicalReviews, 2);
assert.throws(() => monthPlan({ ...planArgs, games: [...planArgs.games, ...planArgs.games] }));
const receipt = { jobKey: "same-logical-review", attemptId: "attempt1", model: "gpt-6-luna" as const, usage: { input: 100000, output: 12000 } };
assert.equal(receiptTotal([receipt, { ...receipt, attemptId: "retry" }]), 0.032);
assert.throws(() => receiptTotal([receipt, receipt]));
assert.equal(coverage([packet]).find(c => c.sport === "nfl")?.complete, false);
assert.equal(CATALOG.nba.required.length, 8);
assert.ok(CATALOG.nfl.required.includes("passing_tds"));
assert.ok(CATALOG.mlb.required.includes("batter_stolen_bases"));

const paired: PairedForecast = { id: "p1", gameId: "game1", sport: "nba", market: "points", baselineRelease: "baseline", candidateRelease: "offline-candidate", issuedAt: packet.cutoff, lock: packet.lock,
  outcomeAvailableAt: "2026-11-07T02:00:00Z", line: 10.5, americanOver: 100, americanUnder: -110, outcome: 1,
  baselineOver: 0.4, candidateOver: 0.6, baselineAction: "under", candidateAction: "over" };
const result = evaluate([paired], "2026-11-05T23:00:00Z")[0];
assert.ok(result.candidate.brier! < result.baseline.brier!);
assert.equal(result.flips, 1); assert.equal(result.candidateActions.profitAtOneUnit, 1);
assert.equal(evaluate([paired, { ...paired, id: "p2", baselineRelease: "different" }], "2026-11-05T23:00:00Z").length, 2);
assert.throws(() => evaluate([{ ...paired, issuedAt: "2026-11-07T03:00:00Z" }], "2026-11-05T23:00:00Z"));
assert.throws(() => evaluate([{ ...paired, americanUnder: null }], "2026-11-05T23:00:00Z"));

// A current source export cannot reconstruct a past NFL early/final model input.
const source = {
  readOnly: true, generatedAt: "2026-11-07T12:00:00Z", priorNba: { games: [], boxes: [], advanced: [] }, currentNba: { games: [], boxes: [], advanced: [] },
  nba: [{ date: "2026-11-06", market: { observations: [] }, snapshot: { generatedAt: "2026-11-06T14:00:00Z", games: [{ gameId: "nba-synthetic", scheduledStart: packet.start, homeTeam: "A", awayTeam: "B" }], decisions: [{ gameId: "nba-synthetic", playerId: "1", playerName: "Synthetic A", team: "A", opponent: "B", market: "points", line: 10.5, independentProjection: 10, independentProbability: 0.5, side: "over", role: [], production: [], matchup: [], modelRelease: "synthetic", calibrationRelease: "synthetic", evaluatedAt: "2026-11-06T14:00:00Z", lockedAt: packet.lock }] } }],
  nfl: [{ week: 1, snapshot: { generatedAt: "2026-11-07T12:00:00Z", memberDecisions: [{ gameId: "nfl-synthetic", scheduledStart: packet.start, lockAt: packet.lock, team: "A", opponent: "B", playerName: "Synthetic B", market: "passing_yards", line: 220.5, side: "over", modelRelease: "synthetic", forecastContext: { featureAsOf: "2026-11-07T12:00:00Z" }, bookEvidence: [], healthHolds: [], participationProbability: 1 }] } }],
} as unknown as CachedExport;
const originalSource = digest(source), adapted = fromCachedExport(source);
assert.equal(adapted.packets.length, 4);
for (const p of adapted.packets) validatePacket(p);
assert.deepEqual(adapted.packets.filter(p => p.sport === "nfl").map(p => p.players[0].evidence.length), [0, 0]);
assert.ok(coverage(adapted.packets).find(c => c.sport === "nfl")!.missingMarkets.includes("passing_tds"));
assert.equal(digest(source), originalSource);

// Offline entry points must not acquire writer/provider/network capabilities as this evolves.
for (const name of ["catalog.ts", "core.ts", "validation.ts", "adapters.ts", "market-report.ts", "cli.ts"]) {
  const code = readFileSync(new URL(name, import.meta.url), "utf8");
  assert.doesNotMatch(code, /\bfetch\s*\(|process\.env|createClient\s*\(|\b(?:client|supabase)\.from\s*\(/);
  for (const match of code.matchAll(/^import (?!type\b).*from ["']([^"']+)["']/gm)) assert.ok(match[1].startsWith("./") || match[1].startsWith("node:"), `Runtime dependency escapes offline boundary: ${match[1]}`);
}
console.log("Full-product offline validation tests passed (synthetic evidence; no AI/provider/database calls).");
