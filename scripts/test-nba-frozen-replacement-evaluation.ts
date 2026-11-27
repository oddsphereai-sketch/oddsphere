import assert from "node:assert/strict";
import { evaluateNbaFrozenReplacement, type NbaFrozenReplacement, type NbaFrozenFinal } from "../lib/research/nba/nbaFrozenReplacementEvaluation";
const base = { side: "home" as const, grade: "lean", probability: .6, line: null, price: -200, book: "real_frozen_book" };
const frozen: NbaFrozenReplacement = { generatedAt: "2026-11-20T16:00:00Z", frozenAt: "2026-11-20T16:01:00Z", sourceSha256: "a".repeat(64), incumbentRelease: "incumbent_release", candidateRelease: "candidate_release", games: [{
  gameId: 1, startAt: "2026-11-21T00:00:00Z", incumbentProjection: { marginHome: 7, total: 223 }, candidateProjection: { marginHome: 7, total: 218 },
  markets: [{ market: "moneyline", incumbent: base, candidate: base },
    { market: "spread", incumbent: { ...base, line: -5, price: -110 }, candidate: { ...base, side: "away", line: 5, price: 105, grade: "watch" } },
    { market: "total", incumbent: { ...base, side: "over", line: 220, price: -115 }, candidate: { ...base, side: "under", line: 220, price: 102, grade: "best_angle" } }] }] };
const outcome: NbaFrozenFinal = { gameId: 1, homeScore: 111, awayScore: 105, finalAt: "2026-11-21T03:00:00Z", observedAt: "2026-11-21T03:01:00Z" };
const bytes = JSON.stringify(frozen);
const pending = evaluateNbaFrozenReplacement(frozen, []); assert(pending.summary.every(m => m.incumbent.pending === 1 && m.incumbent.wins === 0));
assert(pending.summary.every(m => m.incumbent.actionable === 1 && m.incumbent.settledActionable === 0), "pending wagers retain their frozen grade eligibility");
const scored = evaluateNbaFrozenReplacement(frozen, [outcome]);
assert.equal(scored.rows[0].incumbent!.units, .5); assert.equal(scored.rows[1].incumbent!.units, 100 / 110);
assert.equal(scored.rows[1].candidate!.result, "loss"); assert.equal(scored.rows[2].incumbent!.result, "loss");
assert.equal(scored.rows[2].candidate!.units, 1.02); assert.equal(scored.summary[1].demotions, 1);
assert.equal(scored.rows[2].incumbentAbsoluteError, 7); assert.equal(scored.rows[2].candidateAbsoluteError, 2);
const push = evaluateNbaFrozenReplacement(frozen, [{ ...outcome, homeScore: 112, awayScore: 108 }]);
assert.equal(push.rows[2].incumbent!.result, "push"); assert.equal(push.rows[2].candidate!.units, 0); assert.equal(push.rows[2].candidate!.brier, null);
assert.throws(() => evaluateNbaFrozenReplacement(frozen, [outcome, { ...outcome, homeScore: 110 }]), /conflicting_final/);
assert.throws(() => evaluateNbaFrozenReplacement({ ...frozen, generatedAt: outcome.finalAt }, [outcome]), /frozen_release|pregame/);
assert.throws(() => evaluateNbaFrozenReplacement({ ...frozen, frozenAt: outcome.finalAt }, [outcome]), /pregame/);
assert.throws(() => evaluateNbaFrozenReplacement(frozen, [{ ...outcome, finalAt: frozen.generatedAt }]), /final_before/);
assert.throws(() => evaluateNbaFrozenReplacement({ ...frozen, games: [...frozen.games, frozen.games[0]] }, []), /pregame/);
assert.throws(() => evaluateNbaFrozenReplacement(frozen, [{ ...outcome, gameId: 2 }]), /unmatched_final/);
assert.equal(JSON.stringify(frozen), bytes); assert.equal(pending.frozenHash, scored.frozenHash);
console.log("NBA frozen replacement: pending stays pending, exact spread/Total orientation and prices, pushes, unit returns, unchanged frozen inputs, invalid/future/duplicate outcome refusals passed; no network/writes/refit.");
