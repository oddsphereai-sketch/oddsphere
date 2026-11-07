import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TestBudget, evaluateApiCase } from "./api-eval";
import { PRODUCT_RELEASE, type GamePacket } from "./catalog";
const root = mkdtempSync(path.join(tmpdir(), "props-api-budget-test-"));
const previous = process.env.OPENAI_API_KEY;
process.env.OPENAI_API_KEY = "synthetic-test-credential";
const packet: GamePacket = { release: PRODUCT_RELEASE, sport: "nba", gameId: "synthetic", stage: "final", start: "2026-11-06T23:00:00Z", lock: "2026-11-06T22:00:00Z", cutoff: "2026-11-06T21:55:00Z", quotes: [], sourceLimitations: [],
  players: [{ id: "p", name: "Synthetic", team: "A", opponent: "B", markets: ["points"], missing: [], evidence: [{ id: "e", kind: "independent_model", source: "synthetic", availableAt: "2026-11-06T12:00:00Z", value: { mean: 10 } }] }] };
const review = { players: [{ playerId: "p", assessment: "Synthetic player assessment", gaps: [], markets: [{ market: "points", interpretation: "Retain synthetic baseline", proposedProjection: 10, forecastDirection: "retain", evidenceIds: ["e"], gaps: [] }] }] };
const wireReview = { globalGaps: [], players: Object.fromEntries(review.players.map(p => [p.playerId, { assessment: p.assessment, gaps: p.gaps, markets: Object.fromEntries(p.markets.map(m => [m.market, { proposedProjection: m.proposedProjection, proposedEventProbability: null, evidenceIds: m.evidenceIds, exception: null }])) }])) };
const response = (status: string, output = JSON.stringify(wireReview)) => ({ id: "synthetic-response", model: "gpt-6-luna", status, usage: { input_tokens: 1000, output_tokens: 500, output_tokens_details: { reasoning_tokens: 100 } }, output: [{ type: "message", content: [{ type: "output_text", text: output }] }] });
async function main() {
  try {
    const budget = new TestBudget(path.join(root, "ledger.json"));
    let generations = 0;
    const mock = ((url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      if (url.endsWith("input_tokens")) return Promise.resolve(Response.json({ input_tokens: 1000 }));
      generations++; assert.equal(body.service_tier, "default"); assert.equal(body.truncation, "disabled"); assert.equal(body.max_output_tokens, 1000);
      assert.deepEqual(body.prompt_cache_options, { mode: "explicit" });
      const reserved = JSON.parse(readFileSync(budget.file, "utf8")); assert.equal(reserved.attempts.at(-1).status, "sending");
      return Promise.resolve(Response.json(response("completed")));
    }) as typeof fetch;
    const args = { packet, model: "gpt-6-luna" as const, maxOutput: 1000, budget, label: "first", outputFile: path.join(root, "first.json"), fetchImpl: mock };
    const result = await evaluateApiCase(args);
    assert.equal(result.qualityError, null); assert.equal(generations, 1); assert.equal(result.actualUsdConservativeNoCacheDiscount, 0.00035);
    await assert.rejects(() => evaluateApiCase(args), /already attempted/); assert.equal(generations, 1);
    const failed = ((url: string) => url.endsWith("input_tokens") ? Promise.resolve(Response.json({ input_tokens: 1000 })) : Promise.reject(new Error("synthetic timeout"))) as typeof fetch;
    await assert.rejects(() => evaluateApiCase({ ...args, label: "timeout", outputFile: path.join(root, "timeout.json"), fetchImpl: failed }), /timeout/);
    const ledger = JSON.parse(readFileSync(budget.file, "utf8")); assert.equal(ledger.attempts[1].actualUsd, null); assert.equal(ledger.attempts[1].status, "failed_reservation_retained");
    const incomplete = ((url: string) => Promise.resolve(Response.json(url.endsWith("input_tokens") ? { input_tokens: 1000 } : response("incomplete")))) as typeof fetch;
    const partial = await evaluateApiCase({ ...args, label: "incomplete", outputFile: path.join(root, "incomplete.json"), fetchImpl: incomplete });
    assert.equal(partial.qualityError, "Response incomplete"); assert.ok(partial.actualUsdConservativeNoCacheDiscount > 0);
    const inconsistent = structuredClone(packet); inconsistent.players[0].markets = ["points", "threes"];
    const invalidWire = structuredClone(wireReview);
    invalidWire.players.p.markets.points.proposedProjection = 5;
    invalidWire.players.p.markets.threes = { ...invalidWire.players.p.markets.points, proposedProjection: 2 };
    const impossible = ((url: string) => Promise.resolve(Response.json(url.endsWith("input_tokens") ? { input_tokens: 1000 } : response("completed", JSON.stringify(invalidWire))))) as typeof fetch;
    const impossibleFile = path.join(root, "inconsistent.json");
    const rejected = await evaluateApiCase({ ...args, packet: inconsistent, label: "inconsistent", outputFile: impossibleFile, fetchImpl: impossible });
    assert.match(rejected.qualityError!, /NBA points/);
    assert.ok(existsSync(impossibleFile.replace(/\.json$/, ".probabilities.json"))); // Failed games retained for honest raw scoring.
    assert.ok(!existsSync(impossibleFile.replace(/\.json$/, ".review.json"))); // Never an accepted review.
    const exhausted = new TestBudget(path.join(root, "exhausted.json"));
    exhausted.reserve({ id: "prior", job: "prior", model: "gpt-6-luna", reservedUsd: 2, actualUsd: null, status: "unknown", inputTokens: 0, outputTokens: null });
    await assert.rejects(() => evaluateApiCase({ ...args, label: "over-cap", budget: exhausted }), /ceiling/); assert.equal(generations, 1);
    const atomic = new TestBudget(path.join(root, "batch.json"));
    const one = { id: "one", job: "one", model: "gpt-6-luna" as const, reservedUsd: 1.1, actualUsd: null, status: "reserved", inputTokens: 1, outputTokens: null };
    assert.throws(() => atomic.reserveMany([one, { ...one, id: "two" }]), /ceiling/);
    assert.throws(() => readFileSync(atomic.file), /ENOENT/); // No half-reserved review.
    atomic.reserveMany([{...one,reservedUsd:.1},{...one,id:"two",reservedUsd:.1}]);
    atomic.claim({...one,reservedUsd:.1});
    assert.equal(atomic.cancelUnsent(["one","two"]),1); // Sending/unknown costs cannot be erased.
    const cancellation=JSON.parse(readFileSync(atomic.file,"utf8"));
    assert.equal(cancellation.attempts[0].actualUsd,null);assert.equal(cancellation.attempts[0].status,"sending");
    assert.equal(cancellation.attempts[1].actualUsd,0);assert.equal(cancellation.attempts[1].status,"cancelled_never_dispatched");
    assert.throws(()=>atomic.reserve({...one,id:"two",reservedUsd:.1}),/already attempted/);
    const held = JSON.parse(readFileSync(budget.file, "utf8"));
    assert.ok(held.attempts.reduce((n: number, a: { actualUsd: number | null; reservedUsd: number }) => n + (a.actualUsd ?? a.reservedUsd), 0) < 2);
    console.log("API evaluation budget/receipt tests passed: no real API calls.");
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous;
    rmSync(root, { recursive: true, force: true });
  }
}
void main();
