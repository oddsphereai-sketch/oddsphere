import assert from "node:assert/strict";
import { qualifyNflPublicSourceReaction } from "@/lib/services/football/nflPublicSourceReaction";
import type { NflForwardPlaybookLine, NflForwardPlaybookSplitSet } from "@/lib/services/football/nflForwardEvidence";
import type { NflEpisodeHistoryBook } from "@/lib/services/football/nflMoneylineEpisodeTransport";

const splitAt = "2026-11-02T14:00:00.000Z";
const lineAt = "2026-11-02T13:55:00.000Z";
const quoteAt = "2026-11-02T13:50:00.000Z";
const evaluatedAt = "2026-11-02T14:30:00.000Z";
const gameStartsAt = "2026-11-02T18:00:00.000Z";
const line: NflForwardPlaybookLine = { provider: "playbook", capturedAt: lineAt, sourceTier: null,
  homeMoneyline: -110, awayMoneyline: -110, homeSpread: -3.5, awaySpread: 3.5, total: 45.5 };
const split = { provider: "playbook" as const, capturedAt: splitAt, booksUsed: 11,
  homeMoneyPct: 60, awayMoneyPct: 40, homeBetsPct: 40, awayBetsPct: 60,
  overMoneyPct: 30, underMoneyPct: 70, overBetsPct: 40, underBetsPct: 60 };
const splits: NflForwardPlaybookSplitSet = { moneyline: { ...split }, spread: { ...split }, total: { ...split } };
const paired: NflEpisodeHistoryBook = { providerGameId: "exact-game", provider: "owls", providerEventId: "exact-event",
  sportsbook: "circa", observedAt: quoteAt, targetEligible: false,
  moneyline: { homePrice: -110, awayPrice: -110 },
  spread: { homeLine: -3.5, awayLine: 3.5, homePrice: -110, awayPrice: -110 },
  total: { line: 45.5, overPrice: -110, underPrice: -110 } };
const args = { providerGameId: "exact-game", evaluatedAt, gameStartsAt, line, splits,
  history: [paired], excludedFamiliesByMarket: { moneyline: [], spread: [], total: [] } };
const before = JSON.stringify(args);
const qualified = qualifyNflPublicSourceReaction(args);
assert.deepEqual(Object.keys(qualified), ["moneyline", "spread", "total"]);
for (const market of ["moneyline", "spread", "total"] as const) {
  const flow = qualified[market]!.flows[0]!;
  assert.equal(flow.observedAt, splitAt);
  assert.equal(flow.sourceLine, market === "spread" ? -3.5 : market === "total" ? 45.5 : null);
  assert.equal(flow.direction, market === "total" ? -1 : 1);
  assert.equal(flow.authority, "public_source_contract_reaction_context_only");
  assert.deepEqual(qualified[market]!.books, [], "public pressure cannot relabel a physical book as the public source");
  assert.ok(!("probability" in flow) && !("targetProbability" in flow) && !("forecast" in flow),
    "source pressure supplies no member-market probability or new score authority");
}
assert.equal(JSON.stringify(args), before, "qualification preserves the original public line, split and quote evidence");

// The target is deliberately a different contract. Only the recorded public
// line and an intact earlier source pair establish this pressure's identity.
const targetOnly = { ...paired, sportsbook: "pinnacle", spread: { ...paired.spread!, homeLine: -4.5, awayLine: 4.5 },
  total: { ...paired.total!, line: 46.5 } };
assert.equal(qualifyNflPublicSourceReaction({ ...args, history: [targetOnly] }).total, undefined);
assert.equal(qualifyNflPublicSourceReaction({ ...args, history: [targetOnly] }).spread, undefined);
assert.ok(qualifyNflPublicSourceReaction({ ...args, history: [paired, targetOnly] }).total,
  "the genuine prior public contract is retained even if another physical book offers a different target line");

for (const invalid of [
  { ...paired, providerGameId: "other-game" },
  { ...paired, observedAt: "2026-11-02T14:01:00.000Z" },
  { ...paired, observedAt: "2026-11-02T11:00:00.000Z" },
  { ...paired, moneyline: { homePrice: -10, awayPrice: -10 },
    spread: { ...paired.spread!, homePrice: -10, awayPrice: -10 }, total: { ...paired.total!, overPrice: -10, underPrice: -10 } },
]) assert.deepEqual(qualifyNflPublicSourceReaction({ ...args, history: [invalid] }), {},
  "wrong-event, future-only, stale or malformed pairs cannot establish public source-contract pressure");
const mismatchedSpread = qualifyNflPublicSourceReaction({ ...args,
  history: [{ ...paired, spread: { ...paired.spread!, awayLine: 4.5 } }] });
assert.equal(mismatchedSpread.spread, undefined);
assert.ok(mismatchedSpread.total);
const futureLine = qualifyNflPublicSourceReaction({ ...args, line: { ...line, capturedAt: "2026-11-02T14:01:00.000Z" } });
assert.deepEqual(futureLine, {}, "a line first observed after public pressure cannot attest its original contract");
const staleLine = qualifyNflPublicSourceReaction({ ...args, line: { ...line, capturedAt: "2026-11-02T11:00:00.000Z" } });
assert.deepEqual(staleLine, {});
for (const capturedAt of ["2026-11-02T11:00:00.000Z", "2026-11-02T14:31:00.000Z", "invalid"]) {
  const invalidSplits = Object.fromEntries(Object.entries(splits).map(([market, row]) => [market, { ...row, capturedAt }])) as NflForwardPlaybookSplitSet;
  assert.deepEqual(qualifyNflPublicSourceReaction({ ...args, splits: invalidSplits }), {});
}
assert.deepEqual(qualifyNflPublicSourceReaction({ ...args, evaluatedAt: gameStartsAt }), {});
const incomplete = qualifyNflPublicSourceReaction({ ...args, splits: { ...splits,
  total: { ...split, underMoneyPct: null }, spread: { ...split, awayBetsPct: 50 } } });
assert.equal(incomplete.total, undefined);
assert.equal(incomplete.spread, undefined);
assert.ok(incomplete.moneyline);
const excluded = qualifyNflPublicSourceReaction({ ...args,
  excludedFamiliesByMarket: { moneyline: [], spread: [], total: ["Circa"] } });
assert.equal(excluded.total, undefined);
assert.ok(excluded.spread);
const refreshed = qualifyNflPublicSourceReaction({ ...args, history: [{ ...paired,
  observedAt: "2026-11-02T14:20:00.000Z", marketObservedAt: { moneyline: quoteAt, spread: quoteAt, total: quoteAt } }] });
assert.deepEqual(refreshed, qualified, "market-specific source clocks take precedence over a later fetch clock");
const conflictPair = { ...paired, total: { ...paired.total!, overPrice: -115 } };
assert.equal(qualifyNflPublicSourceReaction({ ...args, history: [paired, conflictPair] }).total, undefined,
  "contradictory paired prices at one source clock cannot establish public contract evidence");
const heldHeavy = qualifyNflPublicSourceReaction({ ...args, splits: { ...splits,
  total: { ...split, overMoneyPct: 90, underMoneyPct: 10, overBetsPct: 90, underBetsPct: 10 } } });
assert.equal(heldHeavy.total!.flows[0]!.direction, 1,
  "equal money/ticket shares still reveal heavy same-side pressure for a later held-price interpretation");
console.log("NFL public source reaction: own contracts, prior paired evidence, exact source clocks and contextual authority passed.");
