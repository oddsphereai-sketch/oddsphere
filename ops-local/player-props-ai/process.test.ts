/** Process correctness, not a retrospective performance benchmark. No network calls. */
import assert from "node:assert/strict";
import { PRODUCT_RELEASE, type GamePacket, type Json, type Quote } from "./catalog";
import { compileMarketReport } from "./market-report";
import { digest, pack, referencePairs, unpack } from "./core";
import { readableInput } from "./readable";
const packet: GamePacket = { release: PRODUCT_RELEASE, sport: "nba", gameId: "clock-process", stage: "final", start: "2026-11-06T23:00:00Z", lock: "2026-11-06T22:00:00Z", cutoff: "2026-11-06T21:55:00Z", sourceLimitations: [],
  players: [{ id: "p", name: "Synthetic Player", team: "A", opponent: "B", markets: ["points"], missing: [], evidence: [] }], quotes: [] };
const quote = (id: string, side: Quote["side"], observedAt: string): Quote => ({ id, playerId: "p", market: "points", provider: "synthetic", book: "reference", line: 10.5, side, american: -110, observedAt, receivedAt: "2026-11-06T21:54:00Z", opening: false, receivedAtProvenance: "provider_response", live: false });
packet.quotes = [quote("over", "over", "2026-11-05T12:00:00Z"), quote("under", "under", "2026-11-06T12:00:00Z")];
const target = { playerId: "p", market: "points", line: 10.5, book: "execution" };
const original = digest(packet);
const report = compileMarketReport(packet);
const market = report.players[0].evidence.find(e => e.kind === "market")!.value as { books: { anchorLatestRetainedPair: Record<string, Json> | null }[] };
assert.ok(market.books[0].anchorLatestRetainedPair); // Native change clocks need not match.
assert.equal(market.books[0].anchorLatestRetainedPair!.overReceivedAt, packet.quotes[0].receivedAt);
assert.equal(referencePairs(packet, target, 300000).length, 1);
const tables = readableInput(report);
assert.equal(tables.format, "player_props_readable_tables_r6_cross_line_openings");
assert.match(tables.schema.clockMeaning, /NOT confirmation/);
const trace = tables.quoteTraces[0] as Json[];
assert.equal(trace[6], "provider_response");
const run = (trace[7] as Json[][])[0];
assert.equal(run[2], -1); assert.equal(run[3], -1); // Both provider-receipt clocks survive compression.
assert.notEqual(run[0], run[2]);
assert.deepEqual(unpack(pack(packet)), packet);
assert.equal(digest(packet), original);

const snapshot = structuredClone(packet);
snapshot.quotes.forEach(q => { q.receivedAtProvenance = "snapshot_availability"; });
assert.equal(referencePairs(snapshot, target, 300000).length, 0); // Export time is not a provider poll.
assert.deepEqual(unpack(pack(snapshot)), snapshot);
const started = structuredClone(packet);
started.quotes.forEach(q => { q.receivedAtProvenance = "collection_start"; });
assert.equal(referencePairs(started, target, 300000).length, 0); // Request/job start is not a completed provider receipt.
assert.deepEqual(unpack(pack(started)), started);
const legacy = structuredClone(packet);
legacy.quotes.forEach(q => { delete q.opening; delete q.receivedAtProvenance; });
assert.equal(referencePairs(legacy, target, 300000).length, 0);
assert.deepEqual(unpack(pack(legacy)), legacy); // No fabricated provenance added to legacy payloads.
const mixed = structuredClone(packet);
mixed.quotes.forEach(q => { q.observedAt = "2026-11-06T21:53:00Z"; });
mixed.quotes[0].opening = true;
const mixedValue = compileMarketReport(mixed).players[0].evidence[0].value as typeof market;
assert.equal(mixedValue.books[0].anchorLatestRetainedPair, null); // Never devig an opening leg against current.

const repeated = structuredClone(packet);
repeated.quotes.push({ ...packet.quotes[0], id: "over-confirmed-again", receivedAt: "2026-11-06T21:54:30Z" });
const repeatedTrace = readableInput(compileMarketReport(repeated)).quoteTraces.find(t => (t as Json[])[4] === "over") as Json[];
const repeatedRun = (repeatedTrace[7] as Json[][])[0];
assert.equal(repeatedRun[2], -1); assert.equal(repeatedRun[3], -0.5); assert.equal(repeatedRun[5], 2);
const correction = structuredClone(packet);
correction.quotes.push({ ...packet.quotes[0], id: "corrected-current", american: -120, observedAt: "2026-11-04T12:00:00Z", receivedAt: "2026-11-06T21:54:30Z" });
const refs = referencePairs(correction, target, 300000);
assert.equal(refs.length, 1);
assert.ok(refs[0].evidence.includes("corrected-current")); // Latest actual receipt wins, even if native clock regresses.
console.log("Process checks passed: dual clocks, unchanged-price freshness, export/opening isolation, exact legacy roundtrip and latest provider receipt. No API calls.");
