/** Independent admission controls. Synthetic sources/output only; no fitted caps. */
import assert from "node:assert/strict";
import { PRODUCT_RELEASE, type Evidence, type GamePacket, type Json } from "../lib/playerPropsAi/evidenceContract";
import { digest } from "../lib/playerPropsAi/evidence";
import { primitives, validateLaw, lawForecast, type PlayerLaw } from "../lib/playerPropsAi/law";
import { sourceForecastIssues, validateSourceForecast, sourceMeanAdmissionSupport } from "../lib/playerPropsAi/forecastSanity";
import { readerLogWindows } from "../lib/playerPropsAi/readerLogs";
import { independentPriorEvents } from "../lib/playerPropsAi/priorEvents";
import { evidenceAliases } from "../lib/playerPropsAi/input";
import { encodeCanonicalScenarioLaw, decodeGenerativeScenarioLaw } from "../lib/playerPropsAi/generativeCoordinates";
import { parseJointReview } from "../lib/playerPropsAi/request";
import { PROPS_AI_WIRE_RELEASE } from "../lib/playerPropsAi/scenarioCoordinates";
import { criticalContextHashes } from "../lib/playerPropsAi/criticalContext";
import { siteAiDecisions, siteReviewQualification } from "../lib/playerPropsAi/publication";
import type { AcceptedGameReview } from "../lib/playerPropsAi/reviewer";
import { verifiedReaderFixture } from "./lib/player-props-ai-reader-fixture";

globalThis.fetch = async () => { throw Error("Sparse source-unit controls forbid network"); };
const at = "2030-06-01T16:00:00Z", start = "2030-06-01T23:00:00Z", lock = "2030-06-01T22:00:00Z";
const v = (n: number) => Array<number>(16).fill(n);
const pad = (values: number[]) => [...values, ...Array<number>(16 - values.length).fill(0)];
const log = (i: number, box: Record<string, Json>, suffix = ""): Evidence => ({ id: `log:${i}${suffix}`, kind: "recent_games", source: "Synthetic exact played game", availableAt: at,
  value: { game: { startTime: `2030-05-${String(i + 1).padStart(2, "0")}T23:00:00Z`, homeTeam: "A", awayTeam: "B" }, box } });
const mlbLogs = (market: string, values: number[], suffix = ""): Evidence => ({ id: `p:${market}:recentForm${suffix}`, kind: "recent_games", source: "Synthetic retained canonical MLB recentForm", availableAt: at,
  value: { logs: values.map((value, i) => ({ gameId: i, value, plateAppearances: 4 })) } });
const prior = (market: string, mean: number, line: number, suffix = ""): Evidence => ({ id: `prior:${market}${suffix}`, kind: "independent_model", source: "Synthetic same-unit native prior", availableAt: at,
  value: { market, independentProjection: mean, line, independentOver: .6, independentUnder: .4 } });
const packet = (sport: GamePacket["sport"], markets: string[], evidence: Evidence[]): GamePacket => ({ release: PRODUCT_RELEASE, sport, gameId: "independent-sparse-control", stage: "final", cutoff: at, start, lock,
  quotes: [], sourceLimitations: [], players: [{ id: "p", name: "Synthetic Player", team: "A", opponent: "B", markets, evidence, missing: [] }] });
function law(p: GamePacket, values: Record<string, number[]>, weights = v(1)): PlayerLaw {
  return { weights, outcomes: Object.fromEntries(primitives(p.sport, p.players[0]).map(key => [key, values[key] ?? v(key === "passing_attempts" ? 30 : key === "passing_completions" ? 20 : 0)])) };
}
function parsed(p: GamePacket, raw: PlayerLaw, exceptions = p.players[0].markets.map((): string | null => null)) {
  const aliases = new Map([...evidenceAliases(p)].map(([alias, id]) => [id, alias]));
  const row = verifiedReaderFixture(p, "p", { evidenceIds: [aliases.get(p.players[0].evidence[0].id)!], gaps: [],
    priorRead: Object.fromEntries(independentPriorEvents(p.players[0]).map(event => [aliases.get(event.sourceId)!, event.preferredOutcome])),
    law: encodeCanonicalScenarioLaw(p.sport, p.players[0], raw), confidence: p.players[0].markets.map(() => 2), exceptions });
  return parseJointReview(p, { wireRelease: PROPS_AI_WIRE_RELEASE, players: { p: row } });
}
function review(p: GamePacket, read: ReturnType<typeof parsed>): AcceptedGameReview {
  return { ...read, gameId: p.gameId, start, lock, cutoff: at, issuedAt: at, inputHash: "synthetic-original-input", model: "synthetic", stage: "final",
    criticalContextHashes: criticalContextHashes(p), marketScopes: { p: [...p.players[0].markets] }, partProvenance: [], inputEvidence: { digest: "synthetic-original-input" } } as unknown as AcceptedGameReview;
}
function priced(p: GamePacket, market: string, line: number): GamePacket {
  const quotes = (["over", "under"] as const).map(side => ({ id: `${market}:${side}`, playerId: "p", market, line, side, american: 100, book: "synthetic", provider: "synthetic",
    observedAt: at, receivedAt: at, receivedAtProvenance: "provider_response" as const, opening: false, live: false }));
  return { ...p, quotes, executionQuotes: quotes };
}
function rejects(p: GamePacket, raw: PlayerLaw, markets = p.players[0].markets) {
  const accepted = validateLaw(p.sport, p.players[0], raw), before = digest({ p, accepted });
  const issues = sourceForecastIssues(p, p.players[0], accepted);
  assert(issues.some(issue => /forecast_mean_outside_supplied_support|numeric_support_unavailable/.test(issue.code) && markets.every(m => issue.markets.includes(m))), `${p.sport} ${markets}: unsupported mean must be diagnosed`);
  assert.throws(() => parsed(p, raw), /outside_supplied_support|S:mean|numeric_support_unavailable|no source-grounded mean range/, "The actual future parser cannot accept the unsupported source unit/magnitude");
  assert.equal(digest({ p, accepted }), before, "Admission diagnoses without rewriting source or accepted mathematical law");
}

// A lone scalar is evidence, but does not define an invented exact-point or
// ratio envelope. Honest abstention must not claim that the source is missing.
const onlyPrior = priced(packet("nba", ["points"], [prior("points", 18.4, 13.5)]), "points", 13.5);
const exactPriorLaw = law(onlyPrior, { points: pad([0, 20]) }, pad([2, 23]));
assert(Math.abs(lawForecast(validateLaw("nba", onlyPrior.players[0], exactPriorLaw), "points", 13.5).mean - 18.4) < 1e-12);
const onlyPriorIssues = sourceForecastIssues(onlyPrior, onlyPrior.players[0], validateLaw("nba", onlyPrior.players[0], exactPriorLaw));
assert(onlyPriorIssues.some(issue => issue.code.includes("numeric_support_unavailable")));
assert.throws(() => parsed(onlyPrior, exactPriorLaw), /numeric_support_unavailable|no source-grounded mean range/);
const onlyPriorBefore = digest(onlyPrior), priorDecline = parsed(onlyPrior, exactPriorLaw, ["forecast_declined"]);
assert.deepEqual(priorDecline.players[0].sourceDeclinedMarkets, ["points"]);
assert.equal(priorDecline.players[0].gaps.length, 0, "Numeric abstention cannot invent a missing-source gap");
assert.equal(siteAiDecisions(onlyPrior, review(onlyPrior, priorDecline), at).length, 0);
assert.equal(digest(onlyPrior), onlyPriorBefore);

const twoPlayed = packet("nba", ["points"], [log(0, { minutes: 30, points: 14 }), log(1, { minutes: 30, points: 18 })]);
assert.doesNotThrow(() => parsed(twoPlayed, law(twoPlayed, { points: pad([14, 18]) }, pad([1, 1]))), "Two genuinely distinct played outcomes establish their actual observed range");
for (const evidence of [
  [log(0, { minutes: 30, points: 18 }), prior("points", 18, 13.5)],
  [log(0, { minutes: 30, points: 18 }), log(1, { minutes: 30, points: 18 })],
  [log(0, { minutes: 30, points: 18 }), log(0, { minutes: 30, points: 18 }, ":alias")],
]) {
  const p = packet("nba", ["points"], evidence), raw = law(p, { points: pad([0, 20]) }, pad([1, 9]));
  assert.throws(() => parsed(p, raw), /numeric_support_unavailable|no source-grounded mean range/, "Repeated identical observations/aliases and a matching scalar cannot manufacture a real support span");
}
const established = packet("nba", ["points"], [0, 1, 2].map(i => log(i, { minutes: 30, points: 18 })));
assert.doesNotThrow(() => parsed(established, law(established, { points: v(18) })), "The original three-game nonzero boundary retains its existing point-range behavior");

// A combo prior describes the derived total, not an invented component prior.
for (const [sport, market, primitive, mean] of [
  ["nba", "points_rebounds", "points", 18.4],
  ["nfl", "rushing_receiving_yards", "rushing_yards", 84],
  ["mlb", "batter_hits_runs_rbis", "batter_singles", 2.4],
] as const) {
  const p = packet(sport, [market], [prior(market, mean, .5)]);
  rejects(p, law(p, { [primitive]: pad([0, 5000]) }, pad([1, 9])));
}

// Preserve a complete independent matrix over one/two games and prior-only.
// Values are deliberate thousand-unit mistakes, not proposed model ceilings.
for (const n of [0, 1, 2]) {
  for (const test of [
    { sport: "nba" as const, market: "points", values: [14, 18], mean: 18.4, line: 13.5, bad: 5000, box: (value: number) => ({ minutes: 30, points: value }) },
    { sport: "nfl" as const, market: "passing_yards", values: [140, 180], mean: 184, line: 135.5, bad: 5000, box: (value: number) => ({ passing_yards: value, passing_attempts: 30, passing_completions: 20 }) },
    { sport: "nfl" as const, market: "receptions", values: [2, 4], mean: 3.4, line: 1.5, bad: 1000, box: (value: number) => ({ receptions: value }) },
    { sport: "mlb" as const, market: "pitcher_outs", values: [15, 18], mean: 18.4, line: 14.5, bad: 1000, box: (value: number) => ({ pitcher_outs: value }) },
    { sport: "mlb" as const, market: "batter_total_bases", values: [1, 2], mean: 1.8, line: .5, bad: 1000, box: (value: number) => ({ batter_total_bases: value }) },
  ]) {
    const history = test.sport === "mlb" ? (n ? [mlbLogs(test.market, test.values.slice(0, n))] : []) : test.values.slice(0, n).map((value, i) => log(i, test.box(value)));
    const p = packet(test.sport, [test.market], [...history, prior(test.market, test.mean, test.line)]);
    const primitive = test.market === "batter_total_bases" ? "batter_singles" : test.market;
    rejects(p, law(p, { [primitive]: pad([0, test.bad]) }, pad([1, 9])));
  }
}

// Same old two NBA logs become promotable after an actual supported repair.
const nba = priced(packet("nba", ["points", "points_rebounds", "rebounds"], [log(0, { minutes: 30, points: 14, rebounds: 2 }), log(1, { minutes: 30, points: 18, rebounds: 4 }), prior("points", 18.4, 13.5), prior("points_rebounds", 20, 13.5), prior("rebounds", 3, 2.5)]), "points", 13.5);
const nbaBad = law(nba, { points: pad([0, 5000]), rebounds: pad([2, 4]) }, pad([1, 9]));
rejects(nba, nbaBad, ["points", "points_rebounds"]);
assert.throws(() => parsed(nba, nbaBad, ["forecast_declined", null, null]), /outside_supplied_support|S:mean/, "An invalid primitive cannot escape through an undeclined combination");
const declined = parsed(nba, nbaBad, ["forecast_declined", "forecast_declined", null]);
assert.deepEqual(declined.players[0].sourceDeclinedMarkets.slice().sort(), ["points", "points_rebounds"]);
assert.equal(siteAiDecisions(nba, review(nba, declined), at).length, 0);
assert.equal(siteReviewQualification(nba, review(nba, declined), at).sourceDeclinedScopes, 2);
const repaired = law(nba, { points: pad([0, 18]), rebounds: pad([2, 4]) }, pad([1, 9]));
const accepted = parsed(nba, repaired), promoted = siteAiDecisions(nba, review(nba, accepted), at);
assert.equal(promoted.length, 1); assert.equal(promoted[0].grade, "Best Angle");
assert.equal(promoted[0].projection, 16.2); assert.equal(promoted[0].probability, .9);

// A source-supported change in role remains available with sparse old-role logs.
const role = packet("nba", ["points"], [log(0, { minutes: 8, points: 4 }), prior("points", 32, 20.5), { id: "role", kind: "availability", source: "Synthetic explicit workload source", availableAt: at, value: { expectedMinutes: 36, role: "starter" } }]);
assert.doesNotThrow(() => parsed(role, law(role, { points: pad([16, 32]) }, pad([1, 3]))));

// The boundary is on a weighted mean, never an observed maximum scenario cap.
const largeTail = packet("nba", ["points"], [log(0, { minutes: 30, points: 14 }), log(1, { minutes: 30, points: 18 }), prior("points", 18.4, 13.5)]);
const tailLaw = law(largeTail, { points: pad([0, 5000]) }, pad([4984, 16]));
assert.equal(lawForecast(validateLaw("nba", largeTail.players[0], tailLaw), "points", 13.5).mean, 16);
assert.doesNotThrow(() => parsed(largeTail, tailLaw), "Large scenarios with a supported mean cannot be clipped by a fabricated tail cap");

// Signed NFL net yards and the potential/actual completion coordinate differ.
const negative = packet("nfl", ["rushing_yards"], [log(0, { rushing_yards: -3 }), log(1, { rushing_yards: -1 }), prior("rushing_yards", -2, -1.5)]);
assert.doesNotThrow(() => parsed(negative, law(negative, { rushing_yards: pad([-3, -1]) }, pad([1, 1]))));
const qb = packet("nfl", ["passing_yards"], [log(0, { passing_yards: 0 }), log(1, { passing_yards: -1 }), { id: "zero-passing", kind: "independent_model", source: "Synthetic zero production without a declared event", availableAt: at, value: { market: "passing_yards", independentProjection: 0 } }]);
const potential = encodeCanonicalScenarioLaw("nfl", qb.players[0], law(qb, { passing_attempts: v(1), passing_completions: v(0), passing_yards: v(0) }));
potential.outcomes.passing_yards_if_completion = v(10000);
const actual = decodeGenerativeScenarioLaw("nfl", qb.players[0], potential);
assert(actual.outcomes.passing_yards.every(n => n === 0), "Unused potential passing values are not canonical production");
assert.doesNotThrow(() => validateSourceForecast(qb, qb.players[0], validateLaw("nfl", qb.players[0], actual), [null]));

// Integer pushes are real event uncertainty, not invented negative counts.
const pushes = priced(packet("nba", ["points"], [log(0, { minutes: 1, points: 0 }), prior("points", .6, 0)]), "points", 0);
pushes.players[0].evidence[1].value = { market: "points", independentProjection: .6, line: 0, independentOver: .6, independentUnder: 0 };
const pushLaw = law(pushes, { points: pad([1, 0]) }, pad([3, 2]));
const pushRead = parsed(pushes, pushLaw), pushPrices = siteAiDecisions(pushes, review(pushes, pushRead), at);
assert.equal(pushPrices.length, 1); assert.equal(pushPrices[0].push, .4); assert.equal(pushPrices[0].projection, .6);

// A conflicting source game must not become multiple observations or an
// arbitrary winner. The independent same-unit mean remains separately usable.
const conflicts = packet("nba", ["points"], [log(0, { minutes: 30, points: 14 }), log(0, { minutes: 30, points: 10000 }, ":conflict"), prior("points", 18.4, 13.5)]);
const reconciled = readerLogWindows("nba", conflicts.players[0].evidence.filter(e => e.kind === "recent_games"), at);
assert.equal(reconciled.distinctGames, 1); assert.equal(reconciled.observedSupport.points, undefined); assert.equal(reconciled.conflicts[0].field, "points");
rejects(conflicts, law(conflicts, { points: pad([0, 5000]) }, pad([1, 9])));
const missing = packet("nba", ["points"], [log(0, { minutes: 30, ast: 4 }), prior("points", 18.4, 13.5)]);
assert.equal(readerLogWindows("nba", missing.players[0].evidence.filter(e => e.kind === "recent_games"), at).observedSupport.points, undefined);
rejects(missing, law(missing, { points: pad([0, 5000]) }, pad([1, 9])));

// Previously accepted rare-count support stays possible. Zero observations
// neither prove a zero ceiling nor manufacture a calibrated nonzero rate.
for (const n of [1, 2, 3]) {
  const rare = packet("mlb", ["batter_triples"], [mlbLogs("batter_triples", v(0).slice(0, n))]);
  const rareLaw = law(rare, { batter_triples: pad([1]) });
  assert.doesNotThrow(() => parsed(rare, rareLaw));
  assert.equal(lawForecast(validateLaw("mlb", rare.players[0], rareLaw), "batter_triples", .5).mean, 1 / 16);
}
const rareThrees = packet("nba", ["threes"], [log(0, { minutes: 30, points: 0, fg3m: 0 }), prior("threes", .1, .5)]);
assert.doesNotThrow(() => parsed(rareThrees, law(rareThrees, { threes: pad([1]), points: pad([3]) })));
const rarePassing = packet("nfl", ["passing_tds"], [log(0, { passing_attempts: 20, passing_completions: 10, passing_tds: 0 }), prior("passing_tds", .1, .5)]);
assert.doesNotThrow(() => parsed(rarePassing, law(rarePassing, { passing_tds: pad([1]) })));
const binary = packet("nfl", ["anytime_td"], [{ id: "binary", kind: "independent_model", source: "Synthetic genuine binary event", availableAt: at,
  value: { market: "anytime_td", line: 1, selectedSide: "yes", independentSelectedSideProbability: .7 } }]);
const binaryRead = parsed(binary, law(binary, { touchdowns: pad([0, 2]) }, pad([1, 1])));
assert.equal(lawForecast(binaryRead.players[0].law!, "anytime_td", 1).mean, .5, "The offered event is a binary indicator; a multiple-TD scenario is still one winning binary outcome");
assert.equal(binaryRead.players[0].sourceDeclinedMarkets.length, 0, "A genuine mathematical binary unit already has range 0..1 without inventing empirical magnitude or a fixed rate");

// Opportunity is a canonical count, reconciled within the same actual game.
// A conflicting duplicate cannot authorize choosing its largest value.
for (const pas of [[.1], [4, 4000]]) {
  const p = packet("mlb", ["batter_triples"], [{ id: "p:batter_triples:recentForm", kind: "recent_games", source: "Synthetic malformed/conflicting opportunity", availableAt: at,
    value: { logs: pas.map(plateAppearances => ({ gameId: "same-game", value: 0, plateAppearances })) } }]);
  assert.equal(sourceMeanAdmissionSupport(p, p.players[0]).batter_triples.state, "unavailable", "A fractional/conflicting opportunity count cannot create a usable production scale");
  assert.throws(() => parsed(p, law(p, { batter_triples: pad([1]) })), /numeric_support_unavailable|no source-grounded mean range/);
}
for (const logs of [
  [{ gameId: "same", value: 0, plateAppearances: 4 }, { gameId: "same", value: 0, plateAppearances: 4 }],
  [{ gameId: "bad", value: 0, plateAppearances: 4 }, { gameId: "bad", value: 0, plateAppearances: 4000 }, { gameId: "good", value: 0, plateAppearances: 3 }],
]) {
  const p = packet("mlb", ["batter_triples"], [{ id: "p:batter_triples:recentForm", kind: "recent_games", source: "Synthetic localized opportunity reconciliation", availableAt: at, value: { logs } }]);
  const envelope = sourceMeanAdmissionSupport(p, p.players[0]).batter_triples;
  assert.equal(envelope.state, "source_opportunity"); assert.equal(envelope.maximum, logs.length === 2 ? 4 : 3);
  assert.doesNotThrow(() => parsed(p, law(p, { batter_triples: pad([1]) })), "One conflicting game's opportunity cannot erase another game's valid scale; equal duplicate values stay usable");
}
for (const conflicting of [false, true]) {
  const evidence = ["batter_hits", "batter_triples"].map((market, i): Evidence => ({ id: `p:${market}:recentForm`, kind: "recent_games", source: "Synthetic same-player cross-market opportunity", availableAt: at,
    value: { logs: [{ gameId: "same-game", value: 0, plateAppearances: conflicting && i === 0 ? 4000 : 4 }] } }));
  const p = packet("mlb", ["batter_hits", "batter_triples"], evidence), envelopes = sourceMeanAdmissionSupport(p, p.players[0]);
  if (conflicting) {
    assert.equal(envelopes.batter_hits.state, "unavailable"); assert.equal(envelopes.batter_triples.state, "unavailable", "Plate appearances for one player-game cannot depend on the offered market");
    assert.throws(() => parsed(p, law(p, { batter_singles: pad([0, 4000]), batter_triples: pad([0, 1]) }, pad([1, 9]))), /numeric_support_unavailable|no source-grounded mean range/);
  } else {
    assert.equal(envelopes.batter_hits.maximum, 4); assert.equal(envelopes.batter_triples.maximum, 4);
    assert.doesNotThrow(() => parsed(p, law(p, { batter_triples: pad([1]) })), "Consistent shared opportunity keeps genuine positive rare counts and their derived hit scope available");
  }
}

// Actual played counts/net yards use the same canonical integer units as the
// law. A fractional forecast MEAN/prior is valid; a fractional actual box-score
// count is not a game outcome and cannot manufacture an admission range.
for (const [sport, market] of [["nba", "points"], ["nfl", "passing_yards"], ["mlb", "pitcher_outs"]] as const) {
  const history = sport === "mlb" ? [mlbLogs(market, [14.5, 5000.5])] : [log(0, { minutes: 30, [market]: 14.5 }), log(1, { minutes: 30, [market]: 5000.5 })];
  const p = packet(sport, [market], [...history, prior(market, 18.4, .5)]);
  assert.equal(sourceMeanAdmissionSupport(p, p.players[0])[market].state, "unavailable", "Malformed played units cannot become credible anchors beside a valid fractional forecast mean");
  assert.throws(() => parsed(p, law(p, { [market]: pad([0, 5000]) }, pad([1, 9]))), /numeric_support_unavailable|no source-grounded mean range/);
}
const negativeCountPrior = packet("nba", ["points"], [log(0, { minutes: 30, points: 14 }), prior("points", -5000, .5)]);
assert.equal(sourceMeanAdmissionSupport(negativeCountPrior, negativeCountPrior.players[0]).points.state, "unavailable", "A negative count prior cannot manufacture a credible range; signed net-yard priors remain valid above");
const fractionalRebounds = packet("nba", ["rebounds"], [log(0, { minutes: 30, oreb: 2500.5, dreb: 2499.5 }), log(1, { minutes: 30, oreb: 7, dreb: 7 }), prior("rebounds", 18.4, 13.5)]);
rejects(fractionalRebounds, law(fractionalRebounds, { rebounds: pad([0, 5000]) }, pad([1, 9])));
const integerRebounds = packet("nba", ["rebounds"], [log(0, { minutes: 30, oreb: 7, dreb: 7 }), log(1, { minutes: 30, oreb: 10, dreb: 10 }), prior("rebounds", 18.4, 16.5)]);
assert.doesNotThrow(() => parsed(integerRebounds, law(integerRebounds, { rebounds: pad([14, 20]) }, pad([1, 1]))), "Legitimate integer offensive/defensive rebounds still derive their exact total");
// Signed components can cancel an unsupported scale into an ordinary total.
// A combination prior never supplies a guessed allocation to either component.
const cancellation = priced(packet("nfl", ["rushing_receiving_yards"], [log(0, { rushing_yards: 10, receiving_yards: 40 }), prior("rushing_receiving_yards", 84, 55.5)]), "rushing_receiving_yards", 55.5);
const cancellingLaw = law(cancellation, { rushing_yards: pad([4500, 4500, 10]), receiving_yards: pad([-4450, -4430, 40]) }, pad([1, 9, 1]));
assert.equal(lawForecast(validateLaw("nfl", cancellation.players[0], cancellingLaw), "rushing_receiving_yards", 55.5).mean, 730 / 11);
rejects(cancellation, cancellingLaw);
const cancellationDeclined = parsed(cancellation, cancellingLaw, ["forecast_declined"]);
assert.deepEqual(cancellationDeclined.players[0].sourceDeclinedMarkets, ["rushing_receiving_yards"]);
assert.equal(siteAiDecisions(cancellation, review(cancellation, cancellationDeclined), at).length, 0);
const signedRecovery = priced(packet("nfl", ["rushing_receiving_yards"], [log(0, { rushing_yards: 10, receiving_yards: 40 }), log(1, { rushing_yards: 20, receiving_yards: -30 })]), "rushing_receiving_yards", 9.5);
const signedRead = parsed(signedRecovery, law(signedRecovery, { rushing_yards: pad([10, 20]), receiving_yards: pad([40, -30]) }, pad([1, 3])));
const signedPrices = siteAiDecisions(signedRecovery, review(signedRecovery, signedRead), at);
assert.equal(signedPrices.length, 1); assert.equal(signedPrices[0].side, "under"); assert.equal(signedPrices[0].grade, "Best Angle");
assert.equal(signedPrices[0].projection, 5); assert.equal(signedPrices[0].probability, .75, "Supported signed production recovers its existing full action qualification without a nonnegative clamp");
for (const [sport, market] of [["nba", "points"], ["nfl", "passing_yards"], ["mlb", "pitcher_outs"]] as const) {
  const evidence: Evidence[] = sport === "mlb" ? [{ id: `p:${market}:recentForm`, kind: "recent_games", source: "Synthetic future-game exclusion", availableAt: at,
    value: { logs: [{ gameId: "past", date: "2030-05-31", value: 14 }, { gameId: "future", date: "2030-06-02", value: 5000 }] } }] :
    [log(0, { minutes: 30, [market]: 14 }), { ...log(1, { minutes: 30, [market]: 5000 }), value: { game: { startTime: "2030-06-02T23:00:00Z", homeTeam: "A", awayTeam: "B" }, box: { minutes: 30, [market]: 5000 } } }];
  const p = packet(sport, [market], [...evidence, prior(market, 14, .5)]), before = digest(p);
  assert.equal(sourceMeanAdmissionSupport(p, p.players[0])[market].state, "unavailable", "A future scheduled game's stats cannot become an already-played numeric anchor");
  assert.equal(digest(p), before, "Rejected future observations remain exact in the original source evidence");
}

// Scope checks are prospective. A previously accepted stored R33 law is not
// reparsed under a new admission rule, and its actual stored mean wins.
const old = review(nba, accepted);
const oldLaw = validateLaw("nba", nba.players[0], nbaBad);
old.release = "player_props_ai_2026_11_11_r33_two_phase_review_window";
old.players[0].law = oldLaw; old.players[0].sourceDeclinedMarkets = [];
const oldBefore = digest(old), legacyPrices = siteAiDecisions(nba, old, at);
assert.equal(legacyPrices.length, 1); assert.equal(legacyPrices[0].projection, 4500); assert.equal(legacyPrices[0].probability, .9);
assert.equal(digest(old), oldBefore, "A newer source admission rule cannot reinterpret an already accepted law");

console.log("Independent sparse source-unit controls passed: cross-sport prior-only/one/two-game magnitudes, actual parser/publication scope decline and supported repair, role change, supported mean with large tails, signed yards, conditional completion, integer pushes and conflicting/missing field provenance. No network/DB/model calls.");
