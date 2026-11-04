import assert from "node:assert/strict";
import { readCbbMarketBehavior } from "../lib/cbb/marketBehaviorCandidate";
import { buildCbbProvisionalBoard } from "../lib/cbb/provisionalBoard";
import { CBB_CURRENT_SCORE_RELEASE } from "../lib/cbb/currentScoreRuntime";
import { normalCdf } from "../lib/cbb/model";
import { reviewCbbQuote } from "../lib/cbb/marketEvidence";
import { decideCbbJointMargin } from "../lib/cbb/jointMarginDecision";
import { readCbbMarketBehaviorPath } from "../lib/cbb/marketBehaviorPath";
import type { CbbForecast, CbbQuote } from "../lib/cbb/types";

const asOf = "2026-11-04T18:30:00Z", startsAt = "2026-11-04T23:00:00Z";
function fixture(line: number, firstPrice: number, secondPrice: number) {
  const margin = 1, total = 150, marginSd = 11;
  const zero = normalCdf((.5 - margin) / marginSd) - normalCdf((-.5 - margin) / marginSd);
  const independent: CbbForecast = {
    release: CBB_CURRENT_SCORE_RELEASE, gameId: 777, asOf, homeId: 1, awayId: 2,
    margin, total, homeScore: 75.5, awayScore: 74.5, possessions: 70,
    homeWinProbability: (1 - normalCdf((.5 - margin) / marginSd)) / (1 - zero),
    inputStatus: "complete", issues: [], uncertainty: { marginSd, totalSd: 16,
      marginTotalCorrelation: 0, marginCorrection: 0, totalCorrection: 0, fitThroughSeason: 2025, games: 1000 },
  };
  const quote = (book: string, value: number, time: string, a = -110, b = -110): CbbQuote & {orientationVerified: true} => ({
    gameId: 777, market: "spread", line: value, firstPrice: a, secondPrice: b,
    sportsbook: book, provider: "owls", orientationVerified: true, phase: "current",
    providerObservedAt: `2026-11-04T${time}:00Z`, fetchedAt: `2026-11-04T${time}:30Z`,
  });
  const historyQuotes = [quote("circa", -3.5, "18:00"), quote("circa", -6.5, "18:05"),
    quote("circa", -4.5, "18:10"), quote("circa", -4.5, "18:20"),
    quote("pinnacle", -4.5, "18:00"), quote("pinnacle", -8.5, "18:05"),
    quote("pinnacle", -5, "18:10"), quote("pinnacle", -5.5, "18:20")];
  const targets: CbbQuote[] = [
    { ...quote("draftkings", line, "18:25", firstPrice, secondPrice), requestedAt: "2026-11-04T18:24:00Z" },
    { ...quote("draftkings", 0, "18:25", -105, -115), market: "moneyline", line: null, requestedAt: "2026-11-04T18:24:00Z" },
    { ...quote("draftkings", 151.5, "18:25"), market: "total", requestedAt: "2026-11-04T18:24:00Z" },
  ];
  const flows = [{ provider: "owls" as const, gameId: 777, sourceBook: "circa", market: "spread" as const,
    line: -4.5, firstMoney: .8, secondMoney: .2, firstTickets: .4, secondTickets: .6,
    sourceEventId: "native:777", sourceIdentity: "independent_named_fixture_join" as const,
    observedAt: "2026-11-04T18:15:00Z", fetchedAt: "2026-11-04T18:16:00Z", orientationVerified: true }];
  return { independent, independentInputKey: "contextual-handoff", startsAt, targets,
    currentQuotes: [historyQuotes[3], historyQuotes[7]], historyQuotes, flows, anchors: null };
}

// This is an actual reader -> law -> board -> grade regression, not a test
// that substitutes a desired receipt/forecast after the reader has run.
for (const [name, args, expectedGrade] of [
  ["promotion", fixture(-3.5, -230, 200), "Lean"],
  ["demotion", fixture(-1.5, 150, -170), "No Play"],
] as const) {
  const result = readCbbMarketBehavior(args);
  const held = result.receipt.pressureDecisions.find(p => p.book === "circa");
  assert.equal(held?.resolution, "held");
  assert.equal(held?.moneyDirection, 1);
  assert.equal(result.receipt.margin.authority?.status, "retained", `${name}: current resistance must survive numerical arbitration`);
  assert.equal(result.receipt.margin.authority?.reason, "qualified_current_resistance");
  assert.equal(result.forecast.margin, args.independent.margin);
  assert.deepEqual(result.forecast.uncertainty, args.independent.uncertainty);
  assert.ok(result.receipt.jointMarginDecision!.candidates.some(p => p.margin! > 4), "the competing current source profile remains inspectable");
  const board = buildCbbProvisionalBoard(result.forecast, [...args.targets, ...args.currentQuotes], { marketBehavior: result.receipt });
  assert.equal(board.rows.length, 3);
  assert.equal(board.rows.find(r => r.market === "spread")?.grade, expectedGrade);
  for (const target of args.targets) {
    const expected = reviewCbbQuote(args.independent, target), actual = board.rows.find(r => r.market === target.market)!;
    assert.equal(actual.selection, expected.selection);
    assert.equal(actual.probability, expected.probability);
    assert.equal(actual.pushProbability, expected.pushProbability);
    assert.equal(actual.price, expected.selection === "first" ? target.firstPrice : target.secondPrice);
    assert.ok(Math.abs(actual.expectedValue! - expected.expectedValue) < 1e-12);
  }
  assert.equal(board.score.home - board.score.away, board.score.margin);
  assert.equal(board.score.home + board.score.away, board.score.total);
}

const control = fixture(-3.5, -230, 200);
for (const args of [
  {...control, flows: []},
  {...control, flows: control.flows.map(f => ({...f, line: -9.5}))},
  {...control, flows: control.flows.map(f => ({...f, observedAt: "2026-11-04T18:29:00Z", fetchedAt: "2026-11-04T18:29:30Z"}))},
]) {
  const read = readCbbMarketBehavior(args);
  assert.notEqual(read.receipt.jointMarginDecision?.status, "retained", "absent/unbound pressure cannot invent a retained decision");
}
const incompleteJoint = readCbbMarketBehavior({...control, currentQuotes: [...control.currentQuotes,
  {...control.currentQuotes[0], market: "moneyline", line: null, firstPrice: 200, secondPrice: -230}]});
assert.equal(incompleteJoint.receipt.jointMarginDecision?.status, "unresolved");
assert.equal(incompleteJoint.receipt.jointMarginDecision?.relativeInterpretation?.disposition, "current_source_unresolved");

// The retained context really is present here, but complete current physical
// sources favor opposite winners. Retention cannot clear that unresolved
// source conflict or manufacture a clean confirmation for grading.
const oppositeQuote = (quote: CbbQuote): CbbQuote => quote.sportsbook !== "pinnacle" ? quote : ({
  ...quote, line: quote.line === -4.5 ? 6.5 : quote.line === -8.5 ? 2.5 : quote.line === -5 ? 6 : 5.5,
});
const opposite = readCbbMarketBehavior({ ...control,
  currentQuotes: control.currentQuotes.map(oppositeQuote), historyQuotes: control.historyQuotes.map(oppositeQuote),
});
assert.equal(opposite.receipt.jointMarginDecision?.relativeInterpretation?.read.authority?.status, "retained");
assert.equal(opposite.receipt.jointMarginDecision?.status, "unresolved");
assert.equal(opposite.receipt.jointMarginDecision?.reason, "current_professional_winner_opposition");
assert.equal(opposite.receipt.margin.status, "unresolved");
assert.equal(opposite.forecast.margin, control.independent.margin);

// A symmetric away-pressure case must retain the same physical interpretation,
// without creating a home/favorite bias or changing the untouched Total law.
const mirrorQuote = (quote: CbbQuote): CbbQuote => quote.market === "total" ? { ...quote } : ({
  ...quote, line: quote.line === null ? null : -quote.line,
  firstPrice: quote.secondPrice, secondPrice: quote.firstPrice,
});
const mirroredArgs = { ...control,
  independent: { ...control.independent, homeId: control.independent.awayId, awayId: control.independent.homeId,
    homeScore: control.independent.awayScore, awayScore: control.independent.homeScore,
    margin: -control.independent.margin, homeWinProbability: 1 - control.independent.homeWinProbability,
    uncertainty: { ...control.independent.uncertainty,
      marginCorrection: -control.independent.uncertainty.marginCorrection,
      marginTotalCorrelation: -control.independent.uncertainty.marginTotalCorrelation } },
  targets: control.targets.map(mirrorQuote), currentQuotes: control.currentQuotes.map(mirrorQuote),
  historyQuotes: control.historyQuotes.map(mirrorQuote),
  flows: control.flows.map(flow => ({ ...flow, line: -flow.line,
    firstMoney: flow.secondMoney, secondMoney: flow.firstMoney,
    firstTickets: flow.secondTickets, secondTickets: flow.firstTickets })),
};
const mirrored = readCbbMarketBehavior(mirroredArgs);
assert.equal(mirrored.receipt.pressureDecisions.find(p => p.book === "circa")?.moneyDirection, -1);
assert.equal(mirrored.receipt.jointMarginDecision?.status, "retained");
assert.equal(mirrored.forecast.margin, -control.independent.margin);
assert.equal(mirrored.forecast.total, control.independent.total);
assert.ok(Math.abs(mirrored.forecast.homeWinProbability - (1 - control.independent.homeWinProbability)) < 1e-12);
const mirroredBoard = buildCbbProvisionalBoard(mirrored.forecast,
  [...mirroredArgs.targets, ...mirroredArgs.currentQuotes], { marketBehavior: mirrored.receipt });
assert.equal(mirroredBoard.rows.find(row => row.market === "spread")?.grade, "Lean");
assert.equal(mirroredBoard.rows.find(row => row.market === "spread")?.selection, "first");

// A retained label is not its own evidence. Exercise the public numerical
// handoff with the genuine upstream read but no pressure witness, and with
// a real witness that no longer matches the current native contract.
const genuine = readCbbMarketBehavior(control);
const path = readCbbMarketBehaviorPath({ independent: control.independent, startsAt,
  currentQuotes: control.currentQuotes, seedQuotes: control.historyQuotes,
  flows: control.flows, excludedFamilies: ["draftkings"] });
const relative = genuine.receipt.jointMarginDecision!.relativeInterpretation!.read;
assert.equal(relative.authority?.status, "retained");
const jointArgs = { base: control.independent, current: control.currentQuotes,
  episodes: genuine.receipt.episodes, path, relative };
for (const pressure of [
  [],
  genuine.receipt.pressureDecisions.map(row => ({ ...row, reaction: "unbound" as const, resolution: "unavailable" as const })),
  genuine.receipt.pressureDecisions.map(row => ({ ...row,
    current: row.current ? { ...row.current, line: -99.5 } : null })),
]) assert.notEqual(decideCbbJointMargin({ ...jointArgs, pressure }).decision.status, "retained",
  "a fabricated retained label cannot substitute for a matching qualified response");

// A genuine earlier-price frame and its future locks keep their own semantics.
// Static-price, ML/Spread opposition, large-flip and tiny-juice controls also
// remain in the existing joint-decision and integrated suites.
console.log("PASS CBB contextual handoff: genuine held-pressure interpretation survives final scores, all three markets and paired grades");
