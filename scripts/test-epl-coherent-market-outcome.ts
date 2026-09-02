import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  deriveEplCoherentMarketOutcome,
  EPL_COHERENT_MARKET_OUTCOME_RELEASE,
} from "../lib/services/epl/eplCoherentMarketOutcome";
import type { EplForwardBookVector } from "../lib/services/epl/eplForwardEvidenceCapture";
import { deriveEplPreviewGrade, EPL_PREVIEW_GRADE_RELEASE } from "../lib/services/epl/eplPreviewGrade";
import { EPL_SHADOW_CALIBRATION_RELEASE, EPL_SHADOW_MODEL_RELEASE } from "../lib/services/epl/eplShadowModel";

const decisionAt = "2026-09-12T13:00:00.000Z";
const kickoff = "2026-09-12T14:00:00.000Z";
const eventId = "epl-event-501";

function vector(input: {
  book: string;
  over: number;
  fetchedAt?: string | null;
  secondFetchedAt?: string | null;
  providerEventId?: string | null;
  sourceClass?: EplForwardBookVector["sourceClass"];
  market?: EplForwardBookVector["market"];
  line?: number | null;
}): EplForwardBookVector {
  const firstFetchedAt = input.fetchedAt === undefined ? "2026-09-12T12:55:00.000Z" : input.fetchedAt;
  const secondFetchedAt = input.secondFetchedAt === undefined ? "2026-09-12T12:55:20.000Z" : input.secondFetchedAt;
  const times = [firstFetchedAt, secondFetchedAt].filter((value): value is string => value !== null).sort();
  return {
    identity: `sharpapi:${input.providerEventId ?? eventId}:${input.book}:${input.market ?? "total"}:${input.line ?? 2.5}`,
    sportsbook: input.book,
    canonicalBook: input.book,
    sourceClass: input.sourceClass ?? "named_retail",
    provider: "sharpapi",
    providerEndpoint: `/odds?event_id=${input.providerEventId ?? eventId}`,
    providerEventId: input.providerEventId === undefined ? eventId : input.providerEventId,
    market: input.market ?? "total",
    line: input.line === undefined ? 2.5 : input.line,
    capturedAt: decisionAt,
    fetchedAtMin: times[0] ?? null,
    fetchedAtMax: times.at(-1) ?? null,
    vectorSkewMs: firstFetchedAt && secondFetchedAt ? Math.abs(Date.parse(secondFetchedAt) - Date.parse(firstFetchedAt)) : null,
    overround: 1.04,
    probabilityTotal: 1,
    outcomes: [
      { side: "over", american: -110, decimal: 1.91, rawImpliedProbability: input.over * 1.04, noVigProbability: input.over, fetchedAt: firstFetchedAt, fetchedAtSource: firstFetchedAt ? "provider" : null },
      { side: "under", american: -110, decimal: 1.91, rawImpliedProbability: (1 - input.over) * 1.04, noVigProbability: 1 - input.over, fetchedAt: secondFetchedAt, fetchedAtSource: secondFetchedAt ? "provider" : null },
    ],
  };
}

const common = {
  independentLambdaHome: 1.61,
  independentLambdaAway: 1.08,
  evaluatedMatchResultCanonicalBook: "caesars",
  evaluatedTotalCanonicalBook: "pinnacle",
  evaluatedBttsCanonicalBook: "fanduel",
  providerEventId: eventId,
  decisionAt,
  kickoff,
};
const independent = deriveEplCoherentMarketOutcome({ ...common, totalVectors: [] });
const qualifyingVectors = [
  vector({ book: "pinnacle", over: 0.61 }),
  vector({ book: "fanduel", over: 0.59 }),
  vector({ book: "draftkings", over: 0.57 }),
  vector({ book: "circa", over: 0.56, sourceClass: "named_originator" }),
];
const candidate = deriveEplCoherentMarketOutcome({ ...common, totalVectors: qualifyingVectors });

assert.equal(candidate.release, EPL_COHERENT_MARKET_OUTCOME_RELEASE);
assert.equal(candidate.source, "target_excluded_total_tilt");
assert.deepEqual(candidate.audit.evaluatedCanonicalBooksExcluded, ["caesars", "fanduel", "pinnacle"]);
assert.deepEqual(candidate.audit.eligibleAlternativeBooks, ["circa", "draftkings"]);
assert.equal(candidate.audit.targetOverProbability, 0.565, "the deterministic target is the median independent-family probability");
assert.ok(candidate.audit.totalProbabilityResidual < 1e-12);
assert.ok(candidate.audit.maximumMatchResultResidual < 1e-12);
for (const side of ["home", "draw", "away"] as const) {
  assert.ok(Math.abs(candidate.markets.match_result[side] - independent.markets.match_result[side]) < 1e-12, `${side} Match Result marginal must remain identical`);
}
assert.ok(Math.abs(
  candidate.markets.double_chance.home_or_draw
  - candidate.markets.match_result.home
  - candidate.markets.match_result.draw,
) < 1e-12, "Double Chance must remain an exact Match Result sum");
assert.ok(Math.abs(candidate.markets.btts.yes + candidate.markets.btts.no - 1) < 1e-12);
assert.ok(Number.isFinite(candidate.expectedGoals.home) && Number.isFinite(candidate.expectedGoals.away));
assert.ok(Number.isInteger(candidate.likelyScore.home) && Number.isInteger(candidate.likelyScore.away));

const reordered = deriveEplCoherentMarketOutcome({ ...common, totalVectors: [...qualifyingVectors].reverse() });
assert.deepEqual(reordered, candidate, "book input order must not alter the coherent posterior");
const perturbedExcluded = deriveEplCoherentMarketOutcome({ ...common, totalVectors: [
  vector({ book: "pinnacle", over: 0.2 }),
  vector({ book: "fanduel", over: 0.8 }),
  vector({ book: "caesars", over: 0.1 }),
  ...qualifyingVectors.filter((row) => row.canonicalBook !== "pinnacle" && row.canonicalBook !== "fanduel"),
] });
assert.deepEqual(perturbedExcluded.joint, candidate.joint, "evaluated MR, Total, and BTTS book perturbations must have zero PMF effect");
assert.deepEqual(perturbedExcluded.markets, candidate.markets, "evaluated MR, Total, and BTTS books must not alter derived markets");
assert.deepEqual(perturbedExcluded.expectedGoals, candidate.expectedGoals, "evaluated MR, Total, and BTTS books must not alter decimal xG");

const incomplete = vector({ book: "draftkings", over: 0.57 });
incomplete.outcomes = incomplete.outcomes.slice(0, 1);

const identityCases: Array<[string, EplForwardBookVector[]]> = [
  ["missing", []],
  ["singleton", [vector({ book: "draftkings", over: 0.57 })]],
  ["evaluated_only", [vector({ book: "pinnacle", over: 0.57 }), vector({ book: "fanduel", over: 0.56 })]],
  ["incomplete", [incomplete, vector({ book: "betmgm", over: 0.56 })]],
  ["even", [vector({ book: "draftkings", over: 0.5 }), vector({ book: "betmgm", over: 0.56 })]],
  ["disagreement", [vector({ book: "draftkings", over: 0.57 }), vector({ book: "betmgm", over: 0.49 })]],
  ["cloned", [vector({ book: "draftkings", over: 0.57 }), vector({ book: "betmgm", over: 0.57 })]],
  ["correlated_family", [vector({ book: "draftkings", over: 0.57 }), vector({ book: "betmgm", over: 0.56 })]],
  ["stale", [vector({ book: "draftkings", over: 0.57, fetchedAt: "2026-09-12T12:30:00.000Z", secondFetchedAt: "2026-09-12T12:30:20.000Z" }), vector({ book: "betmgm", over: 0.56 })]],
  ["future", [vector({ book: "draftkings", over: 0.57, fetchedAt: "2026-09-12T13:01:00.000Z", secondFetchedAt: "2026-09-12T13:01:20.000Z" }), vector({ book: "betmgm", over: 0.56 })]],
  ["missing_timestamp", [vector({ book: "draftkings", over: 0.57, fetchedAt: null, secondFetchedAt: null }), vector({ book: "betmgm", over: 0.56 })]],
  ["skew", [vector({ book: "draftkings", over: 0.57, fetchedAt: "2026-09-12T12:55:00.000Z", secondFetchedAt: "2026-09-12T12:56:01.000Z" }), vector({ book: "betmgm", over: 0.56 })]],
  ["wrong_event", [vector({ book: "draftkings", over: 0.57, providerEventId: "other" }), vector({ book: "betmgm", over: 0.56 })]],
];
for (const [name, totalVectors] of identityCases) {
  const result = deriveEplCoherentMarketOutcome({ ...common, totalVectors });
  assert.equal(result.source, "independent_club_pmf", `${name} evidence must preserve identity`);
  assert.deepEqual(result.joint, independent.joint, `${name} evidence must not flatten or nudge the PMF`);
  assert.deepEqual(result.markets, independent.markets, `${name} evidence must not alter any market`);
  assert.deepEqual(result.expectedGoals, independent.expectedGoals, `${name} evidence must preserve decimal xG`);
}
const postStart = deriveEplCoherentMarketOutcome({ ...common, totalVectors: qualifyingVectors, decisionAt: "2026-09-12T14:01:00.000Z" });
assert.equal(postStart.source, "independent_club_pmf", "a poststart decision must preserve the exact independent PMF");
assert.deepEqual(postStart.joint, independent.joint);
const atKickoffDecision = deriveEplCoherentMarketOutcome({ ...common, totalVectors: qualifyingVectors, decisionAt: kickoff });
assert.equal(atKickoffDecision.source, "independent_club_pmf", "a decision exactly at kickoff is not prestart and must preserve identity");
assert.ok(atKickoffDecision.audit.gateReasons.includes("decision_not_before_kickoff"));
const atKickoffQuote = deriveEplCoherentMarketOutcome({
  ...common,
  totalVectors: [
    vector({ book: "draftkings", over: 0.57, fetchedAt: "2026-09-12T12:59:50.000Z", secondFetchedAt: kickoff }),
    vector({ book: "circa", over: 0.56, sourceClass: "named_originator" }),
  ],
});
assert.equal(atKickoffQuote.source, "independent_club_pmf", "a quote exactly at kickoff is not prestart and must preserve identity");
assert.ok(atKickoffQuote.audit.inactiveVectors.some((row) => row.identity.includes(":draftkings:") && row.reason === "outcome_timestamp_future_or_postdecision"));
const correlated = deriveEplCoherentMarketOutcome({
  ...common,
  totalVectors: [vector({ book: "draftkings", over: 0.57 }), vector({ book: "betmgm", over: 0.56 })],
});
assert.ok(correlated.audit.gateReasons.includes("eligible_total_alternatives_correlated"));
assert.equal(new Set(correlated.audit.eligibleAlternativeSources.map((source) => source.evidenceFamily)).size, 1);

for (const market of ["total", "btts"] as const) {
  const positive = deriveEplPreviewGrade({ market, modelProbability: 0.56, edgePp: 4, priceAmerican: 100, coherentMarket: true, promotedProxy: false });
  const negative = deriveEplPreviewGrade({ market, modelProbability: 0.56, edgePp: 4, priceAmerican: -140, coherentMarket: true, promotedProxy: false });
  assert.equal(positive.verdict.key, "lean", `${market} positive-EV forecast can promote`);
  assert.equal(negative.verdict.key, "watchlist", `${market} non-positive-EV forecast must demote`);
  assert.match(negative.reasons.join(" "), /exact forecast-side price does not have positive expected value/);
}
assert.equal(EPL_PREVIEW_GRADE_RELEASE, EPL_SHADOW_CALIBRATION_RELEASE);
assert.equal(EPL_SHADOW_MODEL_RELEASE, "epl_goals_coherent_2026_09_02_r18_structural_target_exclusion");

const previewSource = readFileSync("lib/services/epl/buildEplDailyEdgePreview.ts", "utf8");
const coherentSource = readFileSync("lib/services/epl/eplCoherentMarketOutcome.ts", "utf8");
const pipelineSource = readFileSync("lib/services/epl/eplProductionPipeline.ts", "utf8");
const captureSource = readFileSync("lib/services/epl/eplForwardEvidenceCapture.ts", "utf8");
assert.doesNotMatch(previewSource, /25% club \/ 75%|30% club \/ 70%|1X2 \+ Total-implied|coherent 1X2 \+ Total market/i);
assert.match(previewSource, /evaluated separately and never enters the forecast/);
assert.match(previewSource, /eplCurrentBookVectors\(sharp, "total", capturedAt\)/);
assert.match(previewSource, /const evaluatedTotalCanonicalBook = canonicalEplBook\(total\?\.sportsbook \?\? null\)/);
assert.match(previewSource, /evaluatedMatchResultCanonicalBook: canonicalEplBook\(mr\?\.sportsbook \?\? null\)/);
assert.match(previewSource, /providerEventId: sharp\.eventId/);
assert.match(previewSource, /evaluatedBttsCanonicalBook: canonicalEplBook\(btts\?\.sportsbook \?\? null\)/);
assert.ok(pipelineSource.indexOf("eplPriorRowsBlockWrite(priorRows)") < pipelineSource.indexOf("attachCapture(row, prior?.snapshot_json"), "any prior-release locked record must win before writer merge");
assert.equal((pipelineSource.match(/\.from\("prediction_records"\)/g) ?? []).length, 3, "lock protection must broaden the incumbent query, not add one");
assert.doesNotMatch(captureSource, /supabase|SharpApiClient|fetch\(/, "forecast vector reuse must stay pure over incumbent cached inputs");
assert.match(coherentSource, /maximum > input\.decisionMs \|\| maximum >= input\.kickoffMs/);
assert.match(coherentSource, /decisionMs >= kickoffMs/);

console.log("EPL r18 coherent PMF identity, target exclusion, correlation fallback, exact EV grading, copy, lock, and zero-load checks passed.");
