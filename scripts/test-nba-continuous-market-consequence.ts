import assert from "node:assert/strict";
import { reconcileNbaMarketConsequence, type NbaMarketConsequenceContext, type NbaMarketKnowledgeState } from "../lib/services/nba/nbaMarketConsequence";
import { nbaResidualCdf, nbaResidualQuantile } from "../lib/services/nba/nbaPricedMarketMovement";
import { nbaIndependentInputFingerprint } from "../lib/services/nba/nbaIndependentKnowledge";
import { resolveNbaExecutionFixedPoint } from "../lib/services/nba/nbaMarketExecution";
import { buildNbaLockedMemberCapture } from "../lib/services/nba/nbaLockedMemberSnapshot";
import type { NbaDailyEdgeGameDto } from "../lib/services/nba/buildNbaDailyEdgeDto";
import type { DailyEdgeGameDto } from "../app/lab/lib/labTypes";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadNbaMarketKnowledgeStates } from "../lib/services/nba/nbaMarketKnowledgeStore";
import type { NbaReaderPriceRow, NbaReaderSplitRow } from "../lib/services/nba/nbaProfessionalMarketReader";

const law = { marginSigma: 12, totalSigma: 18 };
const epoch = "2026-10-31T14:00:00Z", next = "2026-10-31T15:00:00Z", now = "2026-10-31T16:00:00Z";
const pair = (market: "moneyline" | "spread" | "total", book: string, capture: string, threshold: number, fair: number,
  provider = "owls"): NbaReaderPriceRow[] => (market === "total" ? ["over", "under"] : ["home", "away"]).map((side, i) => {
    const p = i === 0 ? fair : 1 - fair;
    const price = p >= .5 ? -100 * p / (1 - p) : 100 * (1 - p) / p;
    return { provider, providerEventId: "9", ingestionRunId: `run:${capture}`, sportsbook: book, sharpBook: ["circa", "pinnacle"].includes(book),
      market, selectionKey: `9:${market}:${side}`, fetchedAt: capture, providerTimestamp: capture, americanPrice: price,
      line: market === "moneyline" ? null : market === "spread" ? i === 0 ? -threshold : threshold : threshold };
  });
function run(rows: NbaReaderPriceRow[], previousState?: NbaMarketKnowledgeState | null, overrides: Partial<NbaMarketConsequenceContext> = {},
  independentMargin = nbaResidualQuantile("spread", .6, law), independentTotal = 220) {
  return reconcileNbaMarketConsequence({ independentMargin, independentTotal, law, spreadHome: -5.5, totalLine: 220,
    context: { eventId: "9", inputFingerprint: "semantic_A", evaluatedAt: now, previousState, priceRows: rows, splitRows: [],
      pricesTrusted: true, splitsTrusted: true, ...overrides } });
}
const initialized = run(pair("moneyline", "circa", epoch, 0, .5), null, { evaluatedAt: epoch });
assert.equal(initialized.marginApplied, false);
const sequence = [...pair("moneyline", "circa", epoch, 0, .5), ...pair("moneyline", "circa", next, 0, .55)];
const moved = run(sequence, initialized.state);
assert.equal(moved.marginApplied, true);
assert.ok(moved.margin > initialized.margin);
assert.ok(Math.abs(moved.books[0]!.proposals[0]!.probability - .6470588235294118) < 1e-8);
assert.deepEqual(run(sequence, moved.state), moved, "same state/input rebuild is idempotent and never compounds its previous adjusted score");
const tiny = run([...pair("moneyline", "circa", epoch, 0, .5), ...pair("moneyline", "circa", next, 0, .5001)], initialized.state);
assert.ok(tiny.margin > initialized.margin && tiny.margin < moved.margin, "0.01pp is a real continuous innovation, not a 1pp/2pt gate");
const awayPrior = run(sequence, initialized.state, {}, -nbaResidualQuantile("spread", .6, law));
assert.ok(awayPrior.margin < 0 && awayPrior.margin > -initialized.margin, "same market can weaken an Away pick without blindly following Home");
const flipped = run([...pair("moneyline", "circa", epoch, 0, .5), ...pair("moneyline", "circa", next, 0, .8)], initialized.state, {}, -1);
assert.ok(flipped.margin > 0, "strong coherent direct ML may naturally flip the winner");
const reset = run(sequence, moved.state, { inputFingerprint: "semantic_B" });
assert.equal(reset.independentInputChanged, true);
assert.equal(reset.marginApplied, false, "a changed effective independent law explicitly retires old-epoch evidence; no claim all news was consumed");
assert.equal(reset.state.knowledgeAt, now);
assert.ok(reset.reasons.some(r => r.includes("awaiting_post_input_anchor")));
const resetAgain = run(sequence, reset.state, { inputFingerprint: "semantic_B", evaluatedAt: "2026-10-31T16:01:00Z" });
assert.equal(resetAgain.independentInputChanged, false);
assert.equal(resetAgain.state.knowledgeAt, now, "unchanged semantic inputs do not keep resetting the epoch");
const firstPost = run([...sequence, ...pair("moneyline", "circa", "2026-10-31T16:01:00Z", 0, .56)], resetAgain.state,
  { inputFingerprint: "semantic_B", evaluatedAt: "2026-10-31T16:02:00Z" });
assert.equal(firstPost.marginApplied, false, "the first post-input quote is an anchor, not evidence movement");

const spreadRows = [...pair("spread", "circa", epoch, 5.5, .5), ...pair("spread", "circa", next, 5.5, .505)];
const spreadSeed = run(spreadRows.slice(0, 2), null, { evaluatedAt: epoch });
assert.ok(run(spreadRows, spreadSeed.state).margin > spreadSeed.margin, "fixed-number juice changes margin continuously");
const totalRows = [...pair("total", "circa", epoch, 220, .5), ...pair("total", "circa", next, 220.5, .5)];
const totalSeed = run(totalRows.slice(0, 2), null, { evaluatedAt: epoch });
assert.ok(run(totalRows, totalSeed.state).total > totalSeed.total, "sub-five-point Total move changes Total");
const equivalentFair = .6;
const originalLocation = 5.5 + nbaResidualQuantile("spread", equivalentFair, law);
const zeroRows = [...pair("spread", "circa", epoch, 5.5, equivalentFair), ...pair("spread", "circa", next, originalLocation, .5)];
const zeroSeed = run(zeroRows.slice(0, 2), null, { evaluatedAt: epoch });
assert.equal(run(zeroRows, zeroSeed.state).marginApplied, false, "equivalent number/price relabeling is zero economic innovation");

const baselineMargin = 3;
const baseMl = [...pair("moneyline", "circa", epoch, 0, .5)];
const baseSpread = [...pair("spread", "circa", epoch, 5.5, .5)];
const jointSeed = run([...baseMl, ...baseSpread], null, { evaluatedAt: epoch }, baselineMargin);
const joint = run([...baseMl, ...baseSpread, ...pair("moneyline", "circa", next, 0, .6), ...pair("spread", "circa", next, 5.5, .6)], jointSeed.state, {}, baselineMargin);
assert.equal(joint.books[0]!.jointStatus, "joint_constraints");
assert.ok(joint.marginApplied);
assert.equal(joint.books.length, 1, "ML+Spread constrain one book distribution, not two votes");
const impossible = run([...baseMl, ...baseSpread, ...pair("moneyline", "circa", next, 0, .1), ...pair("spread", "circa", next, 5.5, .9)], jointSeed.state, {}, baselineMargin);
assert.equal(impossible.books[0]!.jointStatus, "joint_conflict");
assert.equal(impossible.margin, baselineMargin, "impossible ML/Spread probability ordering cannot force a winner");

const duplicate = run([...sequence, ...sequence], initialized.state);
assert.equal(duplicate.margin, moved.margin);
const oneSided = run(sequence.filter(r => r.selectionKey.endsWith(":home")), initialized.state);
assert.equal(oneSided.marginApplied, false);
const future = run([...sequence, ...pair("moneyline", "circa", "2026-10-31T16:01:00Z", 0, .9)], initialized.state);
assert.equal(future.margin, moved.margin);
const splitFailure = run(sequence, initialized.state, { splitsTrusted: false });
assert.equal(splitFailure.margin, moved.margin, "supplemental split failure does not erase valid price evidence");
const priceFailure = run(sequence, initialized.state, { pricesTrusted: false });
assert.equal(priceFailure.marginApplied, false);

const buybackRows = [...pair("spread", "circa", epoch, 2, .5), ...pair("spread", "circa", "2026-10-31T14:30:00Z", 7, .5),
  ...pair("spread", "circa", next, 4, .5)];
const buybackSeed = run(buybackRows.slice(0, 2), null, { evaluatedAt: epoch });
const partial = run(buybackRows, buybackSeed.state);
assert.ok(partial.sequences[0]!.retracement > 2.9);
assert.ok(partial.sequences[0]!.latestLeg < 0);
const full = run([...buybackRows.slice(0, 4), ...pair("spread", "circa", next, 2, .5)], buybackSeed.state);
assert.equal(full.marginApplied, false, "complete buyback cancels earlier innovation instead of accumulating both legs");

const heldRows = [...pair("spread", "circa", epoch, 5.5, .5), ...pair("spread", "circa", next, 5.5, .5)];
const heldSeed = run(heldRows.slice(0, 2), null, { evaluatedAt: epoch });
const split: NbaReaderSplitRow = { provider: "owls", sourceBook: "circa", sourceType: "sharp_adjacent_book", market: "spread",
  selectionKey: "9:spread:home", betsPct: .8, moneyPct: .8, marketLine: -5.5,
  sourceObservedAt: "2026-10-31T14:30:00Z", fetchedAt: "2026-10-31T14:30:00Z" };
const held = run(heldRows, heldSeed.state, { splitRows: [split] });
assert.equal(held.pressure[0]!.reaction, "held", "80% tickets AND money must not disappear because their difference is zero");
assert.equal(held.marginApplied, false, "held pressure is conviction evidence, not invented points");
const notMatching = run(heldRows, heldSeed.state, { splitRows: [{ ...split, marketLine: 5.5 }] });
assert.equal(notMatching.pressure[0]!.reaction, "unmatched_quote_context");

const followerRows = [...sequence, ...pair("moneyline", "draftkings", epoch, 0, .5), ...pair("moneyline", "draftkings", "2026-10-31T15:30:00Z", 0, .55)];
assert.equal(run(followerRows, initialized.state).followers[0]!.reaction, "followed");
const preceding = [...sequence, ...pair("moneyline", "draftkings", epoch, 0, .5), ...pair("moneyline", "draftkings", "2026-10-31T14:30:00Z", 0, .55)];
assert.equal(run(preceding, initialized.state).followers[0]!.reaction, "preceded");

// Exact reviewer reproductions: common-contract aggregation cannot invent ML
// conviction; unresolved joint scale retains the usable scalar evidence.
function targets(book: string, mu: number, scale: number, baseMargin: number) {
  return (["moneyline", "spread"] as const).flatMap(market => {
    const k = market === "moneyline" ? 0 : 5.5;
    const prior = nbaResidualCdf("spread", baseMargin - k, law);
    const target = nbaResidualCdf("spread", (mu - k) / scale, law);
    const odds = target / (1 - target) / (prior / (1 - prior));
    return pair(market, book, next, k, odds / (1 + odds));
  });
}
const twoBooks = ["circa", "pinnacle"].flatMap(book => [...pair("moneyline", book, epoch, 0, .5), ...pair("spread", book, epoch, 5.5, .5)]);
const twoSeed = run(twoBooks, null, { evaluatedAt: epoch }, 3);
const combined = run([...twoBooks, ...targets("circa", 6, 1, 3), ...targets("pinnacle", 24, 4, 3)], twoSeed.state, {}, 3);
assert.ok(Math.abs(nbaResidualCdf("spread", combined.margin / combined.marginScale, law) - nbaResidualCdf("spread", 6, law)) < 1e-7);
const nearTargets = (["moneyline", "spread"] as const).flatMap(market => {
  const k = market === "moneyline" ? 0 : 5.5, target = market === "moneyline" ? .5 : .49999999;
  const prior = nbaResidualCdf("spread", 3 - k, law), odds = target / (1 - target) / (prior / (1 - prior));
  return pair(market, "circa", next, k, odds / (1 + odds));
});
const unstable = run([...twoBooks.filter(r => r.sportsbook === "circa"), ...nearTargets], jointSeed.state, {}, 3);
assert.ok(Math.abs(unstable.marginScale - 1) < 1e-6);
assert.ok(unstable.reasons.some(r => r.includes("scale_unidentified")));
const regressed = run([...sequence, ...pair("moneyline", "circa", "2026-10-31T15:30:00Z", 0, .8).map(r => ({ ...r, providerTimestamp: "2026-10-31T13:00:00Z" }))], initialized.state);
assert.equal(regressed.margin, moved.margin, "later capture cannot launder pre-epoch source evidence");
assert.ok(regressed.reasons.some(r => r.includes("source_clock")));
const unsynced = run(sequence.map(r => r.fetchedAt === next && r.selectionKey.endsWith(":away") ? { ...r, providerTimestamp: "2026-10-31T14:59:00Z" } : r), initialized.state);
assert.equal(unsynced.marginApplied, false, "paired sides require the same source instant");
const awaySplit = { ...split, selectionKey: "9:spread:away", marketLine: 5.5, betsPct: .2, moneyPct: .2 };
assert.deepEqual(run(heldRows, heldSeed.state, { splitRows: [awaySplit] }).pressure, held.pressure);
const differential = run(heldRows, heldSeed.state, { splitRows: [{ ...split, betsPct: .8, moneyPct: .6 }] });
assert.equal(differential.pressure[0]!.side, "away");
assert.equal(differential.pressure[0]!.majoritySide, "home");
const badPressureClock = run(heldRows.map(r => r.fetchedAt === next ? { ...r, providerTimestamp: "2026-10-31T13:00:00Z" } : r), heldSeed.state, { splitRows: [split] });
assert.ok(badPressureClock.pressure.every(p => p.reaction === "unmatched_quote_context"), "rejected source clocks cannot re-enter through grade-only pressure");
const preSplitMove = [...pair("spread", "circa", epoch, 3.5, .5), ...pair("spread", "circa", "2026-10-31T14:15:00Z", 5.5, .5), ...pair("spread", "circa", next, 5.5, .5)];
assert.equal(run(preSplitMove, run(preSplitMove.slice(0, 2), null, { evaluatedAt: epoch }).state, { splitRows: [split] }).pressure[0]!.reaction, "held", "pre-split movement is not a reaction to later pressure");

const fingerprintInput = { modelRelease: "m", artifactRelease: "a", featureRelease: "f", rosterRelease: "r", features: {}, independentMargin: 3, independentTotal: 220,
  residualLaw: law, injuriesKnown: [true, true] as [boolean, boolean], homeInjuries: [{ name: "Unmodeled", status: "questionable" }], awayInjuries: [], rosterStatus: "unchanged", homeRetained: 1, awayRetained: 1 };
assert.equal(nbaIndependentInputFingerprint(fingerprintInput), nbaIndependentInputFingerprint({ ...fingerprintInput, homeInjuries: [{ name: "Unmodeled", status: "probable" }] }));
assert.notEqual(nbaIndependentInputFingerprint(fingerprintInput), nbaIndependentInputFingerprint({ ...fingerprintInput, independentMargin: 4 }));

// Existing writer capture helper includes the grounding audit on EVERY
// unlocked refresh, not just lock time. Round-trip its exact JSON boundary.
const capture = (state: NbaMarketKnowledgeState) => JSON.parse(JSON.stringify(buildNbaLockedMemberCapture({
  gameDto: { game_external_id: 9, grounding_audit: { market_reader_knowledge_state: state } } as unknown as NbaDailyEdgeGameDto,
  memberGame: { external_id: 9 } as DailyEdgeGameDto,
}))).nba_game_dto_at_capture.grounding_audit.market_reader_knowledge_state as NbaMarketKnowledgeState;
const refreshTwo = run(sequence, capture(initialized.state));
const refreshThree = run(sequence, capture(refreshTwo.state));
assert.deepEqual(refreshThree, refreshTwo, "two persisted refresh cycles preserve epoch/anchors and never compound scores");
const choose = (side: string) => ({ moneyline: [side === "home" ? "draftkings" : "fanduel"], spread: ["draftkings"], total: ["draftkings"] });
const stable = resolveNbaExecutionFixedPoint({ initial: "home", executionBooks: choose, evaluate: () => "away" });
assert.deepEqual(stable.exclusions.moneyline, ["fanduel"]);
assert.equal(stable.exclusions.moneyline.includes("draftkings"), false, "opposite-side execution book remains eligible");
const cycle = resolveNbaExecutionFixedPoint({ initial: "home", executionBooks: choose,
  evaluate: (excluded, disabled) => disabled.includes("moneyline") ? "home" : excluded.moneyline.includes("draftkings") ? "away" : "home" });
assert.deepEqual(cycle.cycleMarkets, ["moneyline", "spread"]);
assert.equal(cycle.candidate, "home");
async function persistenceBoundary() {
  let stored = capture(initialized.state);
  const queries: unknown[][] = [];
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ["select", "eq", "in", "is"]) chain[method] = (...args) => { queries.push([method, ...args]); return chain; };
  chain.limit = (...args) => { queries.push(["limit", ...args]); return Promise.resolve({ data: [{ game_id: 44, market: "spread", knowledge: stored }], error: null }); };
  const client = { from: (table: string) => { assert.equal(table, "prediction_records"); return chain; } } as unknown as SupabaseClient;
  const load = () => loadNbaMarketKnowledgeStates({ client, slateDate: "2026-10-31", modelRelease: "test_release", externalIdByDbId: new Map([[44, 9]]) });
  const second = run(sequence, (await load()).get(9));
  stored = capture(second.state);
  const third = run(sequence, (await load()).get(9));
  assert.deepEqual(third, second);
  assert.ok(queries.some(q => q[0] === "is" && q[1] === "locked_at" && q[2] === null), "immutable locks cannot enter the mutable epoch lookup");
  assert.ok(queries.some(q => q[0] === "eq" && q[1] === "model_version" && q[2] === "test_release"));
  assert.ok(queries.some(q => q[0] === "in" && q[1] === "market" && JSON.stringify(q[2]) === '["moneyline","spread","total"]'), "held ML does not erase another market's persisted state");
  assert.ok(queries.some(q => q[0] === "select" && String(q[1]).includes("snapshot_json->nba_game_dto_at_capture->grounding_audit->market_reader_knowledge_state")));
  stored = { ...stored, eventId: "wrong_event" };
  await assert.rejects(load, /corrupt/);
  console.log("NBA continuous consequence: numerical reviewer regressions, source clocks/pairs, epoch/reset, persisted two-refresh boundary, direct ML/flip, tiny/price-only/Total, joint constraints, compensation, buyback, pressure and target fixed-point passed; zero historical games/provider calls/DB writes.");
}
persistenceBoundary().catch(error => { console.error(error); process.exitCode = 1; });
