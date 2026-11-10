/** Actual prospective MLB source path; every source/price is synthetic. */
import assert from "node:assert/strict";
import type { PlayerPropPreviewRow } from "../app/mlb/props/components/PlayerPropsDashboard";
import type { MlbPropsBoardSnapshot } from "../lib/mlb/props/boardSnapshotStore";
import type { GamePacket, Json } from "../lib/playerPropsAi/evidenceContract";
import { parseBallDontLiePlayerProps } from "../lib/mlb/props/providerClients";
import { buildMlbPropsMarketEvidenceCapture, attachMlbPropsMarketEvidenceReferences } from "../lib/mlb/props/marketEvidenceCapture";
import { liveMlbPacket, emptyCapturedSource } from "../lib/playerPropsAi/liveSources";
import { mlbPackets } from "../lib/playerPropsAi/cachedEnrichment";
import { sourceInput } from "../lib/playerPropsAi/request";
import { unpackReaderSource } from "../lib/playerPropsAi/sourceCodec";
import { compileMarketReport } from "../lib/playerPropsAi/marketReport";
import { independentPriorEvent, independentPriorEvents } from "../lib/playerPropsAi/priorEvents";
import { digest } from "../lib/playerPropsAi/evidence";
import { quoteContract } from "../lib/playerPropsAi/executionQuotes";
import { lawForecast, validateLaw } from "../lib/playerPropsAi/law";
import { sourceForecastIssues } from "../lib/playerPropsAi/forecastSanity";

globalThis.fetch = async () => { throw Error("MLB source-contract proof forbids HTTP"); };
const at = "2030-06-01T18:00:00Z", old = "2030-06-01T17:00:00Z", start = "2030-06-01T21:00:00Z", lock = "2030-06-01T20:00:00Z";
const raw = [
  { id: 123, prop_type: "hits", game_id: 1, player_id: 2, vendor: "draftkings", line_value: 1, market: { type: "milestone", odds: -180 } },
  { id: 124, prop_type: "hits", game_id: 1, player_id: 2, vendor: "draftkings", line_value: 1, market: { type: "over_under", over_odds: 200, under_odds: -250 } },
];
const current = parseBallDontLiePlayerProps({ data: raw }, at).map(q => ({ ...q, providerResponseAt: at }));
const opening = parseBallDontLiePlayerProps({ data: raw.map(p => ({ ...p, opened_at: old })) }, old, undefined, "opening");
const base = { providerIds: { gameId: "balldontlie-game-1", bdlGameId: "1", bdlPlayerId: 2, mlbStatsPlayerId: "mlbstats-player-2" }, player: "Synthetic Player", team: "NYY", opponent: "BOS", gameStartTime: start,
  market: "batter_hits", line: 1, book: "draftkings", lastUpdated: at, projection: 1, finalProbability: .7, playGrade: "WATCHLIST", missingFeatures: [], oddsSanity: [], units: 0 };
// Deliberate synthetic native-source boundary: source/capture fields are real;
// unrelated dashboard rendering fields are omitted from this partial fixture.
const milestone = { ...base, id: "milestone", offerContract: "milestone", side: "over", odds: -180, independentProbability: .7 } as unknown as PlayerPropPreviewRow;
const under = { ...base, id: "ordinary-under", offerContract: "two_way", side: "under", odds: -250, independentProbability: .6 } as unknown as PlayerPropPreviewRow;
const over = { ...base, id: "ordinary-over", offerContract: "two_way", side: "over", odds: 200, independentProbability: .4 } as unknown as PlayerPropPreviewRow;
const window = { gameId: base.providerIds.gameId, stage: "final" as const, cutoff: at, lock };
function snapshot(rows: PlayerPropPreviewRow[], suppliedOpening = true): MlbPropsBoardSnapshot {
  const captured = buildMlbPropsMarketEvidenceCapture({ rows, currentOdds: current, openingOdds: opening, contexts: new Map(), evaluatedAt: at, maximumQuoteAgeMinutes: 45 });
  return { slateDate: "2030-06-01", snapshotId: "synthetic-source", asOfTimestamp: at,
    data: { props: attachMlbPropsMarketEvidenceReferences(rows, captured.retainedIds) }, marketEvidence: captured.capture,
    modelContext: { modelReleaseId: "mlb_props_2026_10_21_r44", ...(suppliedOpening ? { openingPropOdds: opening } : {}) } } as MlbPropsBoardSnapshot;
}
const packet = (s: MlbPropsBoardSnapshot) => liveMlbPacket({ game: { id: window.gameId, start, away: "NYY", home: "BOS" }, window, snapshot: s, currentOdds: current, openingOdds: opening });
const object = (value: Json) => value as Record<string, Json>;
function report(p: GamePacket) { return object(p.players[0].evidence.find(e => e.id.startsWith("market-report:"))!.value); }
function books(p: GamePacket) { return report(p).books as Record<string, Json>[]; }
function model(p: GamePacket) { return unpackReaderSource(JSON.parse(sourceInput(p))) as unknown as { players: { evidence: unknown[][] }[]; quoteContracts: unknown[][] }; }
function pairs(p: GamePacket) { return books(p).flatMap(b => [b.anchorEarliestRetainedPair, b.anchorLatestRetainedPair, ...(b.openingPairs as Json[])]).filter(Boolean).map(v => v as Record<string, Json>); }

const source = snapshot([milestone, under]), before = digest(source), p = packet(source), reverse = packet(snapshot([under, milestone]));
for (const value of [p, reverse]) {
  assert.equal(value.executionQuotes?.length, 3);
  assert.deepEqual(value.executionQuotes!.map(q => [q.side, q.american, quoteContract(q)]).sort(), [["yes", -180, "milestone"], ["over", 200, "two_way"], ["under", -250, "two_way"]].sort());
  for (const provider of ["stored_member_quote", "b"]) {
    const quote = value.quotes.find(q => q.provider === provider && q.american === -180);
    assert(quote && quote.side === "yes" && quote.offerContract === "milestone", `${provider} preserves the explicit milestone`);
    assert.equal(books(value).find(b => b.provider === provider)?.anchorLatestRetainedPair, null, "A milestone plus ordinary Under is not a pair");
  }
  assert(value.quotes.some(q => q.provider === "b" && q.opening === true && q.side === "yes" && q.american === -180 && q.offerContract === "milestone"), "An exact original opening declaration preserves the inclusive event");
  assert(!pairs(value).some(pair => pair.over === -180), "No current or opening milestone supplies an ordinary Over leg");
  const prior = independentPriorEvents(value.players[0])[0];
  assert.equal(prior.preferredOutcome, "unavailable", "A mixed-contract bounded output cannot declare either independent event");
  const nativeHead = object(value.players[0].evidence.find(e => e.kind === "independent_model")!.value);
  assert.equal(nativeHead.unqualifiedCapturedIndependentOver, .7);
  assert.equal(nativeHead.unqualifiedCapturedIndependentUnder, .6);
  const decoded = model(value), evidence = decoded.players[0].evidence;
  const bookRows = (evidence.find(e => (e[4] as { bookRows?: unknown[] })?.bookRows)?.[4] as { bookRows: unknown[][] }).bookRows;
  for (const provider of ["stored_member_quote", "b"]) assert.equal(bookRows.find(b => b[1] === provider)?.[5], null, "Actual model source has no fabricated ordinary pair");
  assert(decoded.quoteContracts.some(q => q[5] === "milestone" && q[4] === "yes"));
}
assert.equal(digest(source), before, "The original native snapshot/capture/locked payloads remain byte-equivalent");

// Explicit ordinary semantics retain the exact source side, price and probability.
const ordinarySource = snapshot([over, under]), ordinary = mlbPackets(emptyCapturedSource(at), window, [ordinarySource])[0];
const ordinaryPrior = independentPriorEvents(ordinary.players[0])[0];
assert.equal(ordinaryPrior.overProbability, .4); assert.equal(ordinaryPrior.underProbability, .6); assert.equal(ordinaryPrior.preferredOutcome, "under");
const legacyPrior = independentPriorEvent({ id: "legacy-prior", kind: "independent_model", source: "synthetic unchanged legacy", availableAt: at, value: { market: "batter_hits", line: .5, selectedSide: "over", independentSelectedSideProbability: .6 } });
assert.equal(legacyPrior.preferredOutcome, "over"); assert.equal(legacyPrior.overProbability, .6);
assert(!Object.hasOwn(legacyPrior, "offerContract") && !Object.hasOwn(legacyPrior, "noProbability"), "Optional type declarations cannot insert new keys into legacy canonical events");
assert(ordinary.quotes.some(q => q.provider === "stored_member_quote" && q.side === "over" && q.american === 200 && q.offerContract === "two_way"));
const milestoneSource = snapshot([milestone]), milestonePacket = mlbPackets(emptyCapturedSource(at), window, [milestoneSource])[0];
const milestonePrior = independentPriorEvents(milestonePacket.players[0])[0];
assert.equal(milestonePrior.preferredOutcome, "yes"); assert.equal(milestonePrior.yesProbability, .7); assert(Math.abs(milestonePrior.noProbability! - .3) < 1e-12);
assert.equal(milestonePrior.overProbability, null); assert.equal(milestonePrior.underProbability, null); assert.equal(milestonePrior.referenceContractSide, "yes");

// Historical capture/opening absence remains raw, explicitly unqualified data.
const { offerContract: omittedContract, ...legacyMilestone } = milestone; void omittedContract;
const legacy = snapshot([{ ...legacyMilestone, lockStatus: { status: "locked", lockedAt: old } }, under], false), legacyBefore = digest(legacy), legacyPacket = packet(legacy);
const unqualified = legacyPacket.players[0].evidence.find(e => e.id.endsWith(":unqualified-legacy-quotes"))!;
const unqualifiedRows = object(unqualified.value).quotes as Record<string, Json>[];
assert(unqualifiedRows.some(q => q.provider === "stored_member_quote" && q.side === "over" && q.american === -180 && q.contractStatus === "unresolved_legacy_contract"));
assert(unqualifiedRows.some(q => q.provider === "b" && q.opening === true && q.american === -180));
assert(!legacyPacket.quotes.some(q => q.provider === "stored_member_quote" && q.american === -180));
assert(!pairs(legacyPacket).some(pair => pair.over === -180));
const legacyModel = model(legacyPacket);
assert(legacyModel.players[0].evidence.some(e => (e[4] as { contractStatus?: string })?.contractStatus === "unresolved_legacy_contract"), "Unknown exact raw quotes reach the actual model as unqualified evidence");
assert.equal(digest(legacy), legacyBefore);

// Direct explicit milestone Over spellings must also be excluded defensively.
const defensive = compileMarketReport({ ...ordinary, quotes: ordinary.quotes.map(q => q.side === "over" ? { ...q, offerContract: "milestone" as const } : q) });
assert(!pairs(defensive).length);
const v = (n: number) => Array<number>(16).fill(n);
const law = validateLaw("nfl", { markets: ["anytime_td"] }, { weights: [1, 1, ...v(0).slice(2)], outcomes: { touchdowns: [0, 1, ...v(0).slice(2)] } });
assert.deepEqual(lawForecast(law, "anytime_td", .5), lawForecast(law, "anytime_td", 1));
const hits = validateLaw("mlb", { markets: ["batter_hits"] }, { weights: [1, 1, 1, ...v(0).slice(3)], outcomes: { batter_singles: [0, 1, 2, ...v(0).slice(3)], batter_doubles: v(0), batter_triples: v(0), batter_home_runs: v(0), batter_walks: v(0), batter_strikeouts: v(0), batter_rbis: v(0), batter_runs_scored: v(0), batter_stolen_bases: v(0) } });
assert.equal(lawForecast(hits, "batter_hits", 1).push, 1 / 3);
assert.equal(lawForecast(hits, "batter_hits", 1, true).push, 0);
assert.equal(lawForecast(hits, "batter_hits", 1, true).over, 2 / 3);

// No fresh or archival quotes: this must exercise the supplied prior's exact
// inclusive event, without the separate offered-price tail guard masking it.
const priorOnly = { ...milestonePacket, quotes: [], executionQuotes: [] }, priorOnlyBefore = digest(priorOnly);
const hitLaw = (singles: number[]) => validateLaw("mlb", { markets: ["batter_hits"] }, {
  weights: [...singles.map(() => 1), ...v(0).slice(singles.length)],
  outcomes: { ...hits.outcomes, batter_singles: [...singles, ...v(0).slice(singles.length)] },
});
for (const singles of [[1], [0]]) {
  const oneTail = hitLaw(singles), lawBefore = digest(oneTail), issues = sourceForecastIssues(priorOnly, priorOnly.players[0], oneTail);
  assert.deepEqual(issues.map(issue => ({ code: issue.code, events: issue.events })), [{ code: "unsupported_zero_probability_tail", events: [{ market: "batter_hits", line: 1, contract: "milestone" }] }], "An uncertain 1+ prior requires both inclusive winning and losing outcomes");
  assert.equal(digest(oneTail), lawBefore, "The guard diagnoses a law without changing it");
}
const supportedMilestone = hitLaw([0, 1]);
assert.equal(lawForecast(supportedMilestone, "batter_hits", 1).over, 0, "The ordinary event differs at equality");
assert.equal(lawForecast(supportedMilestone, "batter_hits", 1, true).over, .5);
assert.deepEqual(sourceForecastIssues(priorOnly, priorOnly.players[0], supportedMilestone), [], "0/1 supports both outcomes of 1+; ordinary >1 semantics must not reject it");
assert.deepEqual(sourceForecastIssues({ ...ordinary, quotes: [], executionQuotes: [] }, ordinary.players[0], hits), [], "Ordinary Over/Under/push support remains unchanged");
assert.equal(digest(priorOnly), priorOnlyBefore);
const binaryPacket: GamePacket = { ...priorOnly, sport: "nfl", players: [{ ...priorOnly.players[0], markets: ["anytime_td"], evidence: [{ id: "binary-prior", kind: "independent_model", source: "synthetic binary event", availableAt: at, value: { market: "anytime_td", line: 1, selectedSide: "yes", independentSelectedSideProbability: .7 } }] }] };
assert.deepEqual(sourceForecastIssues(binaryPacket, binaryPacket.players[0], law), [], "Genuine binary TD keeps its existing two-outcome event");
console.log("MLB source contracts passed: actual BDL→native bounded/member source→live packet→market report→model source, mixed same-line contracts and reverse order, explicit milestones/ordinary priors, unknown opening/legacy raw retention, current execution, immutable source, exact prior-only inclusive tails, binary TD and integer push controls. No HTTP/DB/paid calls.");
