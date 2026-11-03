import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CBB_CURRENT_SCORE_RELEASE } from "../lib/cbb/currentScoreRuntime";
import {normalCdf} from "../lib/cbb/model";
import { retainCbbLevelInput, CBB_RETAINED_LEVEL_INPUT_MAX_BYTES, type CbbRetainedLevelInput, type CbbRetainedLevelInputArgs } from "../lib/cbb/retainedLevelInput";
import type { CbbForecast, CbbMarket, CbbQuote } from "../lib/cbb/types";

const asOf = "2026-11-03T12:00:00.000Z", startsAt = "2026-11-04T00:00:00.000Z";
const independent: CbbForecast = {
  release: CBB_CURRENT_SCORE_RELEASE, gameId: 123, asOf, homeId: 4, awayId: 5,
  homeScore: 78, awayScore: 72, margin: 6, total: 150, possessions: 70,
  homeWinProbability: (1-normalCdf((.5-6)/12))/(1-normalCdf((.5-6)/12)+normalCdf((-.5-6)/12)), inputStatus: "complete", issues: [],
  uncertainty: { marginSd: 12, totalSd: 17, marginTotalCorrelation: .1,
    marginCorrection: 0, totalCorrection: 0, fitThroughSeason: 2025, games: 1000 },
};
function quote(market: CbbMarket, sportsbook = "pinnacle", override: Partial<CbbQuote> = {}) {
  return { provider: "owls" as const, gameId: 123, market, line: market === "spread" ? -4.5 : market === "total" ? 150.5 : null,
    firstPrice: -110, secondPrice: -110, sportsbook, phase: "current" as const, orientationVerified: true,
    providerObservedAt: "2026-11-03T11:58:00.000Z", requestedAt: "2026-11-03T11:59:00.000Z", fetchedAt: "2026-11-03T11:59:05.000Z", ...override };
}
const args = (): CbbRetainedLevelInputArgs => ({ independent: structuredClone(independent), independentInputKey: "actual-r3-input-key",
  startsAt, asOf, sourceQuotes: [quote("spread"), quote("total")], targets: [quote("spread", "draftkings"), quote("total", "fanduel"), quote("moneyline", "betmgm")],
  historyCompleteness: { price: false, split: false } });
const checkpoint = (r: ReturnType<typeof retainCbbLevelInput>) => { assert.equal(r.disposition, "captured"); return r.checkpoint as CbbRetainedLevelInput; };
const unavailable = (a: CbbRetainedLevelInputArgs, reason?: string) => { const r = retainCbbLevelInput(a); assert.equal(r.disposition, "unavailable"); assert.equal(r.checkpoint, null); if (reason) assert.equal(r.reason, reason); };

const input = args(), before = JSON.stringify(input), first = retainCbbLevelInput(input), saved = checkpoint(first);
assert.equal(saved.hoursToStart, 12);
assert.deepEqual(saved.independent, independent, "retain actual complete pristine input/uncertainty without generating a forecast");
assert.notEqual(saved.independent, input.independent, "new checkpoint does not alias mutable caller input");
assert.deepEqual(saved.sourceQuotes, input.sourceQuotes);
assert.deepEqual(saved.targets, input.targets);
assert.deepEqual(saved.historyCompleteness, { price: false, split: false }, "partial history is not promoted to complete");
assert.equal(saved.historyStatus, "provided");
assert.equal(JSON.stringify(input), before, "retention does not mutate decisions or evidence");
assert.ok(first.bytes! < CBB_RETAINED_LEVEL_INPUT_MAX_BYTES);
assert.equal(first.bytes, Buffer.byteLength(JSON.stringify(saved), "utf8"));
assert.deepEqual(retainCbbLevelInput(args()), first, "deterministic/idempotent capture");
for (const hours of [1.01, 2, 6, 18, 48]) {
  const a = args(); a.startsAt = new Date(Date.parse(asOf) + hours * 3600_000).toISOString();
  assert.ok(Math.abs(checkpoint(retainCbbLevelInput(a)).hoursToStart - hours) < 1e-10, "retain actual early/late horizons rather than a selected bin");
}
for (const hours of [1, .9, 0, -1]) { const a = args(); a.startsAt = new Date(Date.parse(asOf) + hours * 3600_000).toISOString(); unavailable(a, "not_open_pre_t60"); }
for (const field of ["asOf", "startsAt"] as const) { const a = args(); a[field] = "invalid"; unavailable(a); }
for (const mutate of [
  (a: CbbRetainedLevelInputArgs) => { a.independent.release = "adjusted-r5"; },
  (a: CbbRetainedLevelInputArgs) => { a.independent.inputStatus = "incomplete"; },
  (a: CbbRetainedLevelInputArgs) => { a.independent.homeId = a.independent.awayId; },
  (a: CbbRetainedLevelInputArgs) => { a.independent.asOf = "2026-11-03T11:59:00.000Z"; },
  (a: CbbRetainedLevelInputArgs) => { a.independent.homeScore++; },
  (a: CbbRetainedLevelInputArgs) => { a.independent.homeWinProbability=.01; },
  (a: CbbRetainedLevelInputArgs) => { a.independent.uncertainty.totalSd = NaN; },
  (a: CbbRetainedLevelInputArgs) => { a.independent.uncertainty.marginTotalCorrelation = 2; },
  (a: CbbRetainedLevelInputArgs) => { a.independentInputKey = ""; },
]) { const a = args(); mutate(a); unavailable(a, "invalid_pristine_r3_input"); }

const unknown = args(); delete unknown.historyCompleteness;
const unknownSaved = checkpoint(retainCbbLevelInput(unknown));
assert.equal(unknownSaved.historyCompleteness, null); assert.equal(unknownSaved.historyStatus, "unknown_not_recorded");
const requestUnknown = args(); requestUnknown.targets.forEach(q => delete q.requestedAt);
assert.ok(checkpoint(retainCbbLevelInput(requestUnknown)).targets.every(q => !Object.hasOwn(q, "requestedAt")), "missing request clocks are not fabricated");
const nativeTargets=args(); nativeTargets.targets.forEach(q=>{q.provider="balldontlie";delete q.orientationVerified;delete q.requestedAt;});
assert.ok(checkpoint(retainCbbLevelInput(nativeTargets)).targets.every(q=>!Object.hasOwn(q,"orientationVerified")),"native-ID BDL target identity does not invent named-selection orientation");
nativeTargets.targets[0].orientationVerified=false;unavailable(nativeTargets,"invalid_current_targets");
for(const provider of ["owls","sharpapi"] as const){const a=args();a.targets[0].provider=provider;delete a.targets[0].orientationVerified;unavailable(a,"invalid_current_targets");}
const targetUnion = args(); targetUnion.targets.push(quote("moneyline", "PS3838"));
unavailable(targetUnion, "joint_qualified_spread_total_unavailable");
const quarantine = args(); quarantine.quarantinedSources = [{ book: "PS3838", market: "spread", sourceAt: asOf, reason: "known source family conflict" }];
unavailable(quarantine, "joint_qualified_spread_total_unavailable");
quarantine.sourceQuotes.push(quote("spread", "circa"), quote("total", "circa"));
const quarantineSaved = checkpoint(retainCbbLevelInput(quarantine));
assert.ok(quarantineSaved.sourceQuotes.every(q => q.sportsbook === "circa"));
assert.deepEqual(quarantineSaved.quarantinedSources, quarantine.quarantinedSources);
assert.deepEqual(quarantineSaved.excludedQuarantinedFamilies, ["pinnacle"]);

for (const mutate of [
  (q: ReturnType<typeof quote>) => { q.gameId++; },
  (q: ReturnType<typeof quote>) => { q.orientationVerified = false; },
  (q: ReturnType<typeof quote>) => { q.sportsbook = "Pinnacle MQTT"; },
  (q: ReturnType<typeof quote>) => { q.phase = "opening"; },
  (q: ReturnType<typeof quote>) => { q.firstPrice = 0; },
  (q: ReturnType<typeof quote>) => { q.firstPrice = -1000; q.secondPrice = -1000; },
  (q: ReturnType<typeof quote>) => { q.line = -4.25; },
  (q: ReturnType<typeof quote>) => { q.providerObservedAt = "2026-11-03T10:59:59.999Z"; },
  (q: ReturnType<typeof quote>) => { q.providerObservedAt = "2026-11-03T10:59:59.999999Z"; },
  (q: ReturnType<typeof quote>) => { q.providerObservedAt = "2026-11-03T12:00:01.000Z"; },
  (q: ReturnType<typeof quote>) => { q.fetchedAt = "2026-11-03T12:00:01.000Z"; },
  (q: ReturnType<typeof quote>) => { q.fetchedAt = "2026-11-03T12:00:00.000001Z"; },
  (q: ReturnType<typeof quote>) => { q.providerObservedAt = "invalid"; },
  (q: ReturnType<typeof quote>) => { q.requestedAt = "2026-11-03T11:59:06.000Z"; },
]) { const a = args(), q = quote("spread"); mutate(q); a.sourceQuotes[0] = q; unavailable(a); }
const exactlyFresh = args(); exactlyFresh.sourceQuotes[0].providerObservedAt = "2026-11-03T11:00:00.000Z";
checkpoint(retainCbbLevelInput(exactlyFresh));
for (const field of ["gameId", "fetchedAt", "line"] as const) {
  const a = args(); if (field === "gameId") a.targets[0].gameId++; else if (field === "fetchedAt") a.targets[0].fetchedAt = "2026-11-03T12:00:01.000Z"; else a.targets[0].line = -4.25;
  unavailable(a, "invalid_current_targets");
}

const native = args(); native.historyCompleteness = { price: true, split: false }; native.sourceQuotes[0] = quote("spread", "pinnacle", { providerObservedAt: "2026-11-03T11:58:30.000Z", fetchedAt: "2026-11-03T11:58:00.000Z", requestedAt: undefined,
  canonicalReceipt: { kind: "db_inserted_upper_bound", availableBy: "2026-11-03T11:59:00.000001Z", providerEventId: "native-event", ingestionRunId: "run1", observationIds: [1, 2], rawPayloadHashes: ["a".repeat(64), "b".repeat(64)] } });
const nativeSaved = checkpoint(retainCbbLevelInput(native));
assert.equal(nativeSaved.sourceQuotes[0].fetchedAt, "2026-11-03T11:58:00.000Z", "native raw run-start is not retimed");
assert.deepEqual(nativeSaved.sourceQuotes[0].canonicalReceipt, native.sourceQuotes[0].canonicalReceipt);
for (const historyCompleteness of [undefined, { price: false, split: false }]) {
  const a = structuredClone(native); a.historyCompleteness = historyCompleteness;
  unavailable(a, "joint_qualified_spread_total_unavailable");
}
for (const availableBy of ["2026-11-03T12:00:00.000001Z", "invalid", "2026-11-03T11:57:59.000Z"]) {
  const a = structuredClone(native); a.sourceQuotes[0].canonicalReceipt!.availableBy = availableBy; unavailable(a);
}
const brokenNative = structuredClone(native); brokenNative.sourceQuotes[0].canonicalReceipt!.observationIds = [1, 1]; unavailable(brokenNative);
const historicalTarget = structuredClone(native); historicalTarget.targets[0] = historicalTarget.sourceQuotes[0]; unavailable(historicalTarget, "invalid_current_targets");

for (const line of [NaN, null, -4.25]) {
  const a = args(); a.sourceQuotes.push(quote("spread", "PS3838", { line, providerObservedAt: "2026-11-03T11:59:00.000Z" }));
  unavailable(a, "joint_qualified_spread_total_unavailable");
}
const conflicting = args(); conflicting.sourceQuotes.push(quote("spread", "PS3838", { line: -5.5 })); unavailable(conflicting);
const middleConflict=args();middleConflict.sourceQuotes.push(quote("spread","pinnacle",{line:-3.5,providerObservedAt:"2026-11-03T11:56:00Z"}),quote("spread","PS3838",{line:-5.5,providerObservedAt:"2026-11-03T11:56:00Z"}));unavailable(middleConflict);
const copied = args(); copied.sourceQuotes.push(quote("spread", "PS3838"));
assert.equal(checkpoint(retainCbbLevelInput(copied)).sourceQuotes.length, 2, "one pair per physical family and axis");

const priorJson = JSON.stringify(saved), later = args(); later.existing = saved; later.independentInputKey = "later-input";
later.asOf = "2026-11-03T13:00:00.000Z"; later.independent.asOf = later.asOf;
const preserved = retainCbbLevelInput(later);
assert.equal(preserved.checkpoint, saved); assert.equal(preserved.disposition, "preserved_valid"); assert.equal(JSON.stringify(saved), priorJson);
const shiftedStart = { ...later, startsAt: "2026-11-04T01:00:00.000Z" };
assert.equal(retainCbbLevelInput(shiftedStart).disposition, "preserved_invalid");
for (const prior of [false, 0, "legacy", {}, { ...saved, sha256: "bad" }, { ...saved, independent: { ...saved.independent, uncertainty: { ...saved.independent.uncertainty, totalSd: 99 } } }]) {
  const a = args(); a.existing = prior; const before = JSON.stringify(prior), r = retainCbbLevelInput(a);
  assert.equal(r.checkpoint, prior); assert.equal(r.disposition, "preserved_invalid"); assert.equal(JSON.stringify(prior), before);
}
const oversize = args(); oversize.independent.issues = ["é".repeat(10_000)];
const big = retainCbbLevelInput(oversize); assert.equal(big.reason, "input_checkpoint_exceeds_16kib"); assert.equal(big.checkpoint, null); assert.ok(big.bytes! > CBB_RETAINED_LEVEL_INPUT_MAX_BYTES);
assert.equal(oversize.independent.issues[0].length, 10_000, "oversize skips retention without truncation or input mutation");
const cyclic = args(); (cyclic.independent as unknown as { self: unknown }).self = cyclic.independent; unavailable(cyclic);
assert.equal(saved.sha256.length, createHash("sha256").update("").digest("hex").length);
console.log(`CBB retained level input: qualification, timing, immutable-first preservation, native receipts and 16KiB bound pass (${first.bytes} bytes representative checkpoint)`);
