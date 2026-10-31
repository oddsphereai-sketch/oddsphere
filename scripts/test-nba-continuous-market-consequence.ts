import assert from "node:assert/strict";
import { NBA_MARKET_CONSEQUENCE_COEFFICIENTS, reconcileNbaMarketConsequence, type NbaMarketConsequenceContext, type NbaMarketKnowledgeState } from "../lib/services/nba/nbaMarketConsequence";
import { nbaResidualCdf, nbaResidualQuantile } from "../lib/services/nba/nbaPricedMarketMovement";
import { nbaIndependentInputFingerprint } from "../lib/services/nba/nbaIndependentKnowledge";
import { resolveNbaExecutionFixedPoint } from "../lib/services/nba/nbaMarketExecution";
import { buildNbaLockedMemberCapture } from "../lib/services/nba/nbaLockedMemberSnapshot";
import type { NbaDailyEdgeGameDto } from "../lib/services/nba/buildNbaDailyEdgeDto";
import type { DailyEdgeGameDto } from "../app/lab/lib/labTypes";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadNbaMarketKnowledgeStates } from "../lib/services/nba/nbaMarketKnowledgeStore";
import { resolveNbaConsequencePosture } from "../lib/services/nba/nbaNamedBookPosture";
import { gradeNbaMarket } from "../lib/services/nba/nbaMarketReview";
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
function fittedMargin(independent: number, anchor: number, current: number) {
  const gap = independent - anchor, movement = current - anchor;
  if (Math.abs(movement) <= 1e-9) return independent;
  if (Math.abs(gap) <= 1e-9 || Math.sign(movement) !== Math.sign(gap)) {
    return independent + NBA_MARKET_CONSEQUENCE_COEFFICIENTS.margin * movement;
  }
  const innovation = Math.sign(movement) * Math.max(0, Math.abs(movement) - Math.abs(gap));
  return independent + NBA_MARKET_CONSEQUENCE_COEFFICIENTS.margin * innovation;
}
const initialized = run(pair("moneyline", "circa", epoch, 0, .5), null, { evaluatedAt: epoch });
assert.equal(initialized.marginApplied, false);
const confirmingSequence = [...pair("moneyline", "circa", epoch, 0, .5), ...pair("moneyline", "circa", next, 0, .55)];
const confirming = run(confirmingSequence, initialized.state);
assert.equal(confirming.marginApplied, false, "movement toward an already stronger independent forecast confirms instead of double counting");
assert.equal(confirming.books[0]!.proposals[0]!.application, "confirmation_only");
const sequence = [...pair("moneyline", "circa", epoch, 0, .5), ...pair("moneyline", "circa", next, 0, .45)];
const moved = run(sequence, initialized.state);
assert.equal(moved.marginApplied, true);
assert.ok(moved.margin < initialized.margin);
assert.ok(Math.abs(moved.margin - initialized.margin -
  NBA_MARKET_CONSEQUENCE_COEFFICIENTS.margin * nbaResidualQuantile("spread", .45, law)) < 1e-8,
"the selected new information uses the frozen chronology-fitted margin consequence");
assert.equal(moved.books[0]!.proposals[0]!.consequenceCoefficient, NBA_MARKET_CONSEQUENCE_COEFFICIENTS.margin);
assert.ok(Math.abs(moved.books[0]!.proposals[0]!.innovation - nbaResidualQuantile("spread", .45, law)) < 1e-8);
const bootstrappedTrail = run(sequence, null);
assert.equal(bootstrappedTrail.margin, moved.margin,
"a new release consumes the already stored verified opening-to-current trail instead of waiting for a post-deploy tick");
assert.equal(Date.parse(bootstrappedTrail.state.knowledgeAt), Date.parse(epoch));
assert.deepEqual(run(sequence, moved.state), moved, "same state/input rebuild is idempotent and never compounds its previous adjusted score");
const tiny = run([...pair("moneyline", "circa", epoch, 0, .5), ...pair("moneyline", "circa", next, 0, .4999)], initialized.state);
assert.ok(tiny.margin < initialized.margin && tiny.margin > moved.margin, "0.01pp is a real continuous innovation, not a 1pp/2pt gate");
const awayPrior = run(confirmingSequence, initialized.state, {}, -nbaResidualQuantile("spread", .6, law));
assert.ok(awayPrior.margin < 0 && awayPrior.margin > -initialized.margin, "same market can weaken an Away pick without blindly following Home");
const flipped = run([...pair("moneyline", "circa", epoch, 0, .5), ...pair("moneyline", "circa", next, 0, .8)], initialized.state, {}, -1);
assert.ok(flipped.margin > 0, "strong coherent direct ML may naturally flip the winner");
const crossingIndependent = 3;
const crossingEpsilon = 1e-6;
const crossingSeed = run(pair("moneyline", "circa", epoch, 0, .5), null, { evaluatedAt: epoch }, crossingIndependent);
const belowCrossing = run([...pair("moneyline", "circa", epoch, 0, .5),
  ...pair("moneyline", "circa", next, 0, nbaResidualCdf("spread", crossingIndependent - crossingEpsilon, law))], crossingSeed.state, {}, crossingIndependent);
const aboveCrossing = run([...pair("moneyline", "circa", epoch, 0, .5),
  ...pair("moneyline", "circa", next, 0, nbaResidualCdf("spread", crossingIndependent + crossingEpsilon, law))], crossingSeed.state, {}, crossingIndependent);
assert.ok(Math.abs(belowCrossing.margin - crossingIndependent) < 1e-7);
assert.ok(Math.abs(aboveCrossing.margin - crossingIndependent -
  NBA_MARKET_CONSEQUENCE_COEFFICIENTS.margin * crossingEpsilon) < 1e-6,
"the chronology-fitted consequence is continuous at the independent-score crossing");
const positiveReflection = run([...pair("moneyline", "circa", epoch, 0, .5), ...pair("moneyline", "circa", next, 0, .45)], initialized.state, {}, 3);
const negativeReflection = run([...pair("moneyline", "circa", epoch, 0, .5), ...pair("moneyline", "circa", next, 0, .55)], initialized.state, {}, -3);
assert.ok(Math.abs(positiveReflection.margin + negativeReflection.margin) < 1e-8,
"home/away reflection uses the same frozen consequence law");
const revised = run(sequence, moved.state, { inputFingerprint: "semantic_B" });
assert.equal(revised.margin, moved.margin, "a fingerprint revision is not proof that market evidence was consumed");
assert.equal(Date.parse(revised.state.knowledgeAt), Date.parse(epoch));
const reset = run(sequence, moved.state, { inputFingerprint: "semantic_B",
  consumedInformation: [{ at: now, coordinates: ["margin"], evidenceIds: ["fixture:attested-consumed-information"] }] });
assert.equal(reset.independentInputChanged, true);
assert.equal(reset.marginApplied, false, "only attested consumption retires evidence for its own coordinate");
assert.equal(Date.parse(reset.state.knowledgeAt), Date.parse(epoch));
assert.equal(reset.state.retiredBefore.margin!.at, now);
assert.ok(reset.reasons.some(r => r.includes("awaiting_post_input_anchor")));
const resetAgain = run(sequence, reset.state, { inputFingerprint: "semantic_B", evaluatedAt: "2026-10-31T16:01:00Z" });
assert.equal(resetAgain.independentInputChanged, false);
assert.equal(resetAgain.state.retiredBefore.margin!.at, now, "unchanged semantic inputs do not keep resetting the cutoff");
const firstPost = run([...sequence, ...pair("moneyline", "circa", "2026-10-31T16:01:00Z", 0, .56)], resetAgain.state,
  { inputFingerprint: "semantic_B", evaluatedAt: "2026-10-31T16:02:00Z" });
assert.equal(firstPost.marginApplied, false, "the first post-input quote is an anchor, not evidence movement");

const spreadRows = [...pair("spread", "circa", epoch, 5.5, .5), ...pair("spread", "circa", next, 5.5, .505)];
const spreadSeed = run(spreadRows.slice(0, 2), null, { evaluatedAt: epoch });
assert.ok(run(spreadRows, spreadSeed.state).margin > spreadSeed.margin, "fixed-number juice changes margin continuously");
const totalRows = [...pair("total", "circa", epoch, 220, .5), ...pair("total", "circa", next, 220.5, .5)];
const totalSeed = run(totalRows.slice(0, 2), null, { evaluatedAt: epoch });
assert.ok(run(totalRows, totalSeed.state).total > totalSeed.total, "sub-five-point Total move changes Total");
// Exact outside-review reproductions: a tiny independent revision must not
// erase a whole accepted episode or unrelated Total knowledge.
const strongRows = [...pair("moneyline", "circa", epoch, 0, .5), ...pair("moneyline", "circa", next, 0, .8), ...totalRows];
const strongSeed = run(strongRows.filter(r => r.fetchedAt === epoch), null, { evaluatedAt: epoch }, -1);
const strongBefore = run(strongRows, strongSeed.state, {}, -1);
const strongAfter = run(strongRows, strongBefore.state, { inputFingerprint: "margin-revised" }, -.99);
assert.ok(Math.abs(strongAfter.margin - strongBefore.margin - .01) < 1e-8,
  "a .01 datum revision cannot erase ten points of accepted market evidence");
assert.equal(strongAfter.total, strongBefore.total, "margin-only revision preserves Total evidence");
assert.deepEqual(strongAfter.state.unresolvedInputRevisions, ["margin"]);
assert.ok(strongAfter.reasons.some(r => r.includes("revision_overlap_unresolved")));
const revisedMarginPosture = resolveNbaConsequencePosture({ consequence: strongAfter, market: "moneyline", pickedSide: "home" });
const unchangedTotalPosture = resolveNbaConsequencePosture({ consequence: strongAfter, market: "total", pickedSide: "over" });
assert.equal(revisedMarginPosture.informationOverlapUnresolved, true);
assert.equal(unchangedTotalPosture.informationOverlapUnresolved, false);
const earnedBest = { market: "moneyline" as const, pick: "home" as const, confidence: 80, modelProbabilityOnPick: .8,
  band: "support" as const, edge: .1, dataQualityTier: "high" as const, injuriesKnown: true, currentPriceAmerican: -160 };
assert.equal(gradeNbaMarket(earnedBest).grade, "best_angle");
assert.equal(gradeNbaMarket({ ...earnedBest, namedBookPosture: revisedMarginPosture }).grade, "best_angle",
  "a numerical revision alone cannot invent opposition or a permanent Best→Lean permission gate");
const marginConsumed = run(strongRows, strongAfter.state, { inputFingerprint: "margin-revised",
  consumedInformation: [{ at: now, coordinates: ["margin"], evidenceIds: ["fixture:new-margin-information"] }] }, -.99);
assert.equal(marginConsumed.margin, -.99);
assert.equal(marginConsumed.total, strongBefore.total, "margin consumption cannot retire unrelated Total evidence");
assert.deepEqual(marginConsumed.state.unresolvedInputRevisions, []);
assert.deepEqual(run(strongRows, marginConsumed.state, { inputFingerprint: "margin-revised",
  consumedInformation: [{ at: now, coordinates: ["margin"], evidenceIds: ["fixture:new-margin-information"] }] }, -.99), marginConsumed);
const replayAfterRevision = run(strongRows, marginConsumed.state, { inputFingerprint: "later-margin-revision",
  evaluatedAt: "2026-10-31T16:01:00Z", consumedInformation: [{ at: now, coordinates: ["margin"], evidenceIds: ["fixture:new-margin-information"] }] }, -.98);
assert.deepEqual(replayAfterRevision.state.unresolvedInputRevisions, ["margin"],
  "a replayed prior attestation cannot resolve overlap from a newer independent revision");
assert.throws(() => run(strongRows, strongAfter.state, { consumedInformation: [{ at: "2026-10-31T17:00:00Z", coordinates: ["margin"], evidenceIds: ["future"] }] }), /Invalid NBA information/);
assert.throws(() => run(strongRows, strongAfter.state, { consumedInformation: [{ at: now, coordinates: ["margin"], evidenceIds: [7 as unknown as string] }] }), /Invalid NBA information/);
// Guard against the outside-review rejected absolute replacement. Quote
// epsilon and zero-boundary datum changes cannot manufacture a huge flip.
const epsilonOpen = pair("moneyline", "circa", epoch, 0, .8);
const epsilonSeed = run(epsilonOpen, null, { evaluatedAt: epoch }, -10);
const epsilonMove = run([...epsilonOpen, ...pair("moneyline", "circa", next, 0, .800001)], epsilonSeed.state, {}, -10);
assert.ok(Math.abs(epsilonMove.margin + 10) < .001);
const justBelow = run([...epsilonOpen, ...pair("moneyline", "circa", next, 0, .800001)], epsilonSeed.state, {}, -.000001);
const justAbove = run([...epsilonOpen, ...pair("moneyline", "circa", next, 0, .800001)], epsilonSeed.state, {}, .000001);
assert.ok(Math.abs(justAbove.margin - justBelow.margin - .000002) < 1e-8);
const equivalentFair = .6;
const originalLocation = 5.5 + nbaResidualQuantile("spread", equivalentFair, law);
const zeroRows = [...pair("spread", "circa", epoch, 5.5, equivalentFair), ...pair("spread", "circa", next, originalLocation, .5)];
const zeroSeed = run(zeroRows.slice(0, 2), null, { evaluatedAt: epoch });
assert.equal(run(zeroRows, zeroSeed.state).marginApplied, false, "equivalent number/price relabeling is zero economic innovation");

const baselineMargin = 3;
const baseMl = [...pair("moneyline", "circa", epoch, 0, .5)];
const baseSpread = [...pair("spread", "circa", epoch, 0, .5)];
const jointSeed = run([...baseMl, ...baseSpread], null, { evaluatedAt: epoch }, baselineMargin);
const joint = run([...baseMl, ...baseSpread, ...pair("moneyline", "circa", next, 0, .45), ...pair("spread", "circa", next, 0, .45)], jointSeed.state, {}, baselineMargin);
assert.equal(joint.books[0]!.jointStatus, "joint_constraints");
assert.ok(joint.marginApplied);
assert.equal(joint.books.length, 1, "ML+Spread constrain one book distribution, not two votes");
const impossible = run([...baseMl, ...baseSpread, ...pair("moneyline", "circa", next, 0, .1), ...pair("spread", "circa", next, 5.5, .9)], jointSeed.state, {}, baselineMargin);
assert.equal(impossible.books[0]!.jointStatus, "single_contract");
assert.deepEqual(impossible.books[0]!.ignoredMarkets, ["moneyline"]);
assert.equal(impossible.margin, impossible.books[0]!.proposals.find(proposal => proposal.market === "spread")!.location,
"an incompatible ML transform cannot erase the coherent direct Spread consequence");

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

const followerRows = [...sequence, ...pair("moneyline", "draftkings", epoch, 0, .5), ...pair("moneyline", "draftkings", "2026-10-31T15:30:00Z", 0, .45)];
assert.equal(run(followerRows, initialized.state).followers[0]!.reaction, "followed");
const preceding = [...sequence, ...pair("moneyline", "draftkings", epoch, 0, .5), ...pair("moneyline", "draftkings", "2026-10-31T14:30:00Z", 0, .45)];
assert.equal(run(preceding, initialized.state).followers[0]!.reaction, "preceded");

// Same-book fixed-scale measurements must intersect. A separate physical book
// with incompatible scale-like pseudo-receipts cannot manufacture dispersion.
function fixedScaleReceipt(book: string, spreadThreshold: number, sourceAt: string) {
  return [...pair("moneyline", book, next, 0, .45), ...pair("spread", book, next, spreadThreshold, .5)]
    .map(row => ({ ...row, providerTimestamp: sourceAt }));
}
const twoBooks = ["circa", "pinnacle"].flatMap(book => [...pair("moneyline", book, epoch, 0, .5), ...pair("spread", book, epoch, 5.5, .5)]);
const twoSeed = run(twoBooks, null, { evaluatedAt: epoch }, 3);
const combined = run([...twoBooks, ...fixedScaleReceipt("circa", 1.5, "2026-10-31T14:59:59Z"),
  ...fixedScaleReceipt("pinnacle", -5, next)], twoSeed.state, {}, 3);
assert.ok(Math.abs(combined.margin - combined.books.find(book => book.book === "circa")!.margin!) < 1e-9 && Math.abs(combined.marginScale - 1) < 1e-6,
  `Circa's earlier source episode authors the state; no cross-book midpoint or synthetic scale: ${JSON.stringify({ margin: combined.margin, books: combined.books })}`);
assert.equal(combined.arbitration.margin.leader, "circa");
const sameMlUnequalLaw = run([...twoBooks, ...fixedScaleReceipt("circa", 1.5, next),
  ...fixedScaleReceipt("pinnacle", -5, next)], twoSeed.state, {}, 3);
assert.equal(sameMlUnequalLaw.arbitration.margin.status, "leader_unidentified");
assert.equal(sameMlUnequalLaw.margin, 3,
  "unequal simultaneous direct Spread consequences cannot be resolved by an arbitrary book preference");
assert.equal(sameMlUnequalLaw.books.find(book => book.book === "pinnacle")!.jointStatus, "single_contract");
assert.deepEqual(sameMlUnequalLaw.books.find(book => book.book === "pinnacle")!.ignoredMarkets, ["moneyline"]);
const unstable = run([...twoBooks.filter(r => r.sportsbook === "circa"), ...fixedScaleReceipt("circa", -5, next)], jointSeed.state, {}, 3);
assert.ok(Math.abs(unstable.marginScale - 1) < 1e-6);
assert.ok(unstable.reasons.some(r => r.includes("fixed_scale_conflict")));

// Exact 2026-10-28 LAL@LAC production failure. The old dynamic solve turned
// these ordinary relative receipts into +133 with scale 19.1. Fixed-scale
// contract intersection must reject that circular construction without a cap.
const incidentMargin = 2.4148853775858995;
const incidentAnchor = [
  ...pair("moneyline", "circa", epoch, 0, .36546943919344677),
  ...pair("spread", "circa", epoch, -4.5, .5),
];
const incidentCurrent = [
  ...pair("moneyline", "circa", next, 0, .5108342361863488),
  ...pair("spread", "circa", next, 1, .5),
];
const incidentSeed = run(incidentAnchor, null, { evaluatedAt: epoch }, incidentMargin);
const incident = run([...incidentAnchor, ...incidentCurrent], incidentSeed.state, {}, incidentMargin);
assert.equal(incident.margin, incidentMargin);
assert.equal(incident.marginScale, 1);
assert.equal(incident.books[0]!.jointStatus, "joint_constraints");
assert.deepEqual(incident.books[0]!.proposals.map(proposal => proposal.application), ["confirmation_only", "confirmation_only"]);

// Every valid neighboring integer price receipt stays finite and fixed-scale;
// one displayed tick can never revive the unbounded joint solve.
const roundedIncident = [...incidentAnchor, ...incidentCurrent].map(row => ({
  ...row,
  americanPrice: Math.sign(row.americanPrice!) * Math.max(100, Math.round(Math.abs(row.americanPrice!))),
}));
const currentIndexes = roundedIncident.map((row, index) => row.fetchedAt === next ? index : -1).filter(index => index >= 0);
for (let mask = 0; mask < 16; mask++) {
  const perturbed = roundedIncident.map(row => ({ ...row }));
  currentIndexes.forEach((index, bit) => {
    const row = perturbed[index]!;
    const direction = (mask >> bit) & 1 ? 1 : -1;
    const candidate = row.americanPrice! + direction;
    row.americanPrice = Math.sign(candidate) === Math.sign(row.americanPrice!) && Math.abs(candidate) >= 100
      ? candidate : row.americanPrice;
  });
  const receipt = run(perturbed, run(perturbed.filter(row => row.fetchedAt === epoch), null,
    { evaluatedAt: epoch }, incidentMargin).state, {}, incidentMargin);
  assert.equal(receipt.marginScale, 1);
  assert.ok(Number.isFinite(receipt.margin) && Math.abs(receipt.margin - incidentMargin) < 20);
}
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

const half = "2026-10-31T14:30:00Z", quarter = "2026-10-31T14:45:00Z";
const openingBooks = [...pair("moneyline", "circa", epoch, 0, .5), ...pair("moneyline", "pinnacle", epoch, 0, .5)];
const episodeSeed = run(openingBooks, null, { evaluatedAt: epoch }, 3);
const leaderRows = [...openingBooks, ...pair("moneyline", "circa", half, 0, .6),
  ...pair("moneyline", "circa", next, 0, .6).map(r => ({ ...r, providerTimestamp: half })), ...pair("moneyline", "pinnacle", next, 0, .7)];
const led = run(leaderRows, episodeSeed.state, {}, 3);
assert.equal(led.arbitration.margin.leader, "circa");
const fitted60 = fittedMargin(3, 0, nbaResidualQuantile("spread", .6, law));
const fitted70 = fittedMargin(3, 0, nbaResidualQuantile("spread", .7, law));
assert.ok(Math.abs(led.margin - fitted60) < 1e-7);
assert.deepEqual(led.arbitration.margin.followers, ["pinnacle"]);
assert.equal(run([...leaderRows, ...leaderRows.filter(r => r.sportsbook === "pinnacle")], episodeSeed.state, {}, 3).margin, led.margin,
  "copied follower rows add zero amplitude");
const resistance = run([...openingBooks, ...pair("moneyline", "pinnacle", half, 0, .6),
  ...pair("moneyline", "pinnacle", next, 0, .6).map(r => ({ ...r, providerTimestamp: half })), ...pair("moneyline", "circa", next, 0, .4)], episodeSeed.state, {}, 3);
assert.equal(resistance.arbitration.margin.status, "unresolved_conflict");
assert.equal(resistance.margin, 3, "fresh opposite peers are contested, not a synthetic midpoint");
const spreadOpening = [...pair("spread", "circa", epoch, 5.5, .5), ...pair("spread", "pinnacle", epoch, 5.5, .5)];
const spreadEpisodeSeed = run(spreadOpening, null, { evaluatedAt: epoch }, -4);
const correctionVsConfirmation = run([...spreadOpening, ...pair("spread", "circa", next, 6.5, .5),
  ...pair("spread", "pinnacle", next, 4.5, .5)], spreadEpisodeSeed.state, {}, -4);
assert.equal(correctionVsConfirmation.arbitration.margin.status, "unresolved_correction_confirmation_conflict");
assert.equal(correctionVsConfirmation.margin, -4,
  "a zero-point confirmation remains evidence and prevents an overlapping opposing correction from winning by default");
const laterConfirmation = run([...spreadOpening, ...pair("spread", "circa", half, 6.5, .5),
  ...pair("spread", "pinnacle", next, 4.5, .5)], spreadEpisodeSeed.state, {}, -4);
assert.equal(laterConfirmation.arbitration.margin.status, "later_confirmation_supersedes_prior_correction");
assert.equal(laterConfirmation.margin, -4, "a chronologically later confirmation cancels the earlier opposing correction without inventing points");
const tie = run([...openingBooks, ...pair("moneyline", "circa", next, 0, .6), ...pair("moneyline", "pinnacle", next, 0, .6)], episodeSeed.state, {}, 3);
assert.equal(tie.arbitration.margin.status, "equivalent_simultaneous_episode");
assert.equal(tie.arbitration.margin.leader, null, "equivalent effects do not identify which physical book led");
assert.equal(tie.arbitration.margin.selectedSource, null, "equivalent evidence cannot falsely credit a single arbitrary physical source");
assert.deepEqual(tie.arbitration.margin.equivalentSources, ["circa", "pinnacle"]);
assert.ok(Math.abs(tie.margin - fitted60) < 1e-7,
  "identical observed consequences can apply once without a vote quota, pooling, or invented leadership");
const tiedRows = [...openingBooks, ...pair("moneyline", "circa", next, 0, .6), ...pair("moneyline", "pinnacle", next, 0, .6)];
assert.equal(run([...tiedRows].reverse(), episodeSeed.state, {}, 3).margin, tie.margin);
assert.equal(run([...tiedRows, ...tiedRows], episodeSeed.state, {}, 3).margin, tie.margin);
const unequalTie = run([...openingBooks, ...pair("moneyline", "circa", next, 0, .6), ...pair("moneyline", "pinnacle", next, 0, .7)], episodeSeed.state, {}, 3);
assert.equal(unequalTie.margin, 3, "unequal simultaneous effects are not averaged or resolved by a hidden book preference");
assert.equal(unequalTie.arbitration.margin.status, "leader_unidentified");
assert.equal(unequalTie.actions.margin, "unresolved");
const totalTiedRows = ["circa", "pinnacle"].flatMap(book => [...pair("total", book, epoch, 220, .5), ...pair("total", book, next, 221, .5)]);
const totalTied = run(totalTiedRows, run(totalTiedRows.filter(r => r.fetchedAt === epoch), null, { evaluatedAt: epoch }).state);
assert.equal(totalTied.total, 221);
assert.equal(totalTied.arbitration.total.leader, null);
assert.equal(totalTied.arbitration.total.status, "equivalent_simultaneous_episode");
const frontier = run([...openingBooks, ...pair("moneyline", "circa", half, 0, .6), ...pair("moneyline", "pinnacle", next, 0, .7)], episodeSeed.state, {}, 3);
assert.equal(frontier.arbitration.margin.status, "frontier_extension");
assert.equal(frontier.arbitration.margin.leader, "pinnacle");
assert.ok(Math.abs(frontier.arbitration.margin.incrementalExtension! - (fitted70 - fitted60)) < 1e-7);
assert.ok(Math.abs(frontier.margin - fitted70) < 1e-7,
  "a frontier extension replaces the prior causal endpoint, not add the whole follower move twice");
const lateReverse = run([...openingBooks, ...pair("moneyline", "circa", half, 0, .6), ...pair("moneyline", "pinnacle", quarter, 0, .6),
  ...pair("moneyline", "circa", next, 0, .4)], episodeSeed.state, {}, 3);
assert.equal(lateReverse.arbitration.margin.leader, "circa");
assert.equal(lateReverse.arbitration.margin.status, "later_episode_supersedes_unobserved_laggards");
assert.ok(Math.abs(lateReverse.margin - fittedMargin(3, 0, nbaResidualQuantile("spread", .4, law))) < 1e-7);
const staticOpposition = run(pair("moneyline", "circa", epoch, 0, .2), null, { evaluatedAt: epoch }, 10);
assert.equal(staticOpposition.margin, 10);
assert.equal(staticOpposition.currentContexts[0]!.authority, "context_only");
assert.equal(staticOpposition.currentContexts[0]!.favoredSide, "away");
assert.equal(staticOpposition.actions.margin, "context_only");
const cancelledLead = run([...openingBooks, ...pair("moneyline", "circa", half, 0, .6), ...pair("moneyline", "pinnacle", quarter, 0, .6),
  ...pair("moneyline", "circa", next, 0, .5)], episodeSeed.state, {}, 3);
assert.equal(cancelledLead.margin, 3, "full buyback cannot resurrect a copied follower's old move");
assert.deepEqual(cancelledLead.arbitration.margin.lagging, ["pinnacle"]);
assert.deepEqual(cancelledLead.arbitration.margin.cancelledBy, ["circa"]);
const notCopiedOpposite = run([...openingBooks, ...pair("moneyline", "circa", half, 0, .6), ...pair("moneyline", "pinnacle", quarter, 0, .4),
  ...pair("moneyline", "circa", next, 0, .5)], episodeSeed.state, {}, 3);
assert.equal(notCopiedOpposite.arbitration.margin.selectedSource, "pinnacle", "a buyback cannot erase a different book's opposite episode");
assert.ok(notCopiedOpposite.margin < 3);
assert.deepEqual(notCopiedOpposite.arbitration.margin.lagging, []);
const notCopiedAmplitude = run([...openingBooks, ...pair("moneyline", "circa", half, 0, .6), ...pair("moneyline", "pinnacle", quarter, 0, .7),
  ...pair("moneyline", "circa", next, 0, .5)], episodeSeed.state, {}, 3);
assert.equal(notCopiedAmplitude.arbitration.margin.selectedSource, "pinnacle", "a distinct frontier is not assumed a canceled copy merely because directions agree");
const heldNamed = run([...openingBooks, ...pair("moneyline", "circa", half, 0, .6), ...pair("moneyline", "pinnacle", next, 0, .5)], episodeSeed.state, {}, 3);
assert.equal(heldNamed.arbitration.margin.leader, "circa");
assert.deepEqual(heldNamed.arbitration.margin.heldSources, ["pinnacle"]);
const thirdOpen = [...openingBooks, ...pair("moneyline", "bookmaker", epoch, 0, .5)];
const thirdFrontier = run([...thirdOpen, ...pair("moneyline", "circa", half, 0, .6), ...pair("moneyline", "pinnacle", quarter, 0, .7),
  ...pair("moneyline", "bookmaker", next, 0, .8)], run(thirdOpen, null, { evaluatedAt: epoch }, 3).state, {}, 3);
assert.equal(thirdFrontier.arbitration.margin.selectedSource, "bookmaker");
assert.deepEqual(thirdFrontier.arbitration.margin.frontierPath, ["circa", "pinnacle", "bookmaker"]);
const fitted80 = fittedMargin(3, 0, nbaResidualQuantile("spread", .8, law));
assert.ok(Math.abs(thirdFrontier.arbitration.margin.incrementalExtension! - (fitted80 - fitted70)) < 1e-7);
assert.ok(Math.abs(thirdFrontier.margin - fitted80) < 1e-7,
  "the latest distinct frontier must not be lost after processing the first extension");
const ambiguousFrontier = run([...thirdOpen, ...pair("moneyline", "circa", half, 0, .6), ...pair("moneyline", "pinnacle", next, 0, .7),
  ...pair("moneyline", "bookmaker", next, 0, .75)], run(thirdOpen, null, { evaluatedAt: epoch }, 3).state, {}, 3);
assert.equal(ambiguousFrontier.arbitration.margin.status, "frontier_extension_unresolved");
assert.equal(ambiguousFrontier.arbitration.margin.leader, "circa");
assert.ok(Math.abs(ambiguousFrontier.margin - fitted60) < 1e-7,
  "ambiguous extension retains the last uncontested source, never selects/averages the tied new sources");
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
  console.log("NBA continuous consequence: source clocks/pairs, coordinate continuity/attested retirement/replay, persisted refreshes, direct ML/flip, tiny/price-only/Total, joint constraints, compensation, buyback, pressure, target fixed-point and rejected absolute-sign override regressions passed; numerical revision alone adds no grade gate; zero historical games/provider calls/DB writes.");
}
persistenceBoundary().catch(error => { console.error(error); process.exitCode = 1; });
