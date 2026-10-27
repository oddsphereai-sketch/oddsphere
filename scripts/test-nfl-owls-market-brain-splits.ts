import assert from "node:assert/strict";

import {
  MARKET_BRAIN_BLIND_SPOTS,
  buildMarketBrainCase,
} from "../lib/services/marketBrain/marketBrainContract";
import {
  NFL_OWLS_MARKET_BRAIN_SPLIT_EVIDENCE_RELEASE,
  buildNflOwlsMarketBrainSplitEvidence,
  type NflOwlsMarketBrainSplitRow,
} from "../lib/services/football/nflOwlsMarketBrainSplits";

const evaluatedAt = "2026-10-27T20:00:00.000Z";
const gameId = "424242";
let id = 0;
function row(args: {
  book: "circa" | "draftkings" | "betmgm";
  market: "moneyline" | "spread" | "total";
  side: "away" | "home" | "over" | "under";
  observedAt: string;
  betsPct: number;
  moneyPct: number;
  insertedAt?: string;
}): NflOwlsMarketBrainSplitRow {
  id++;
  return {
    id,
    canonical_event_id: gameId,
    market_type: args.market,
    selection_key: `${gameId}:${args.market}:${args.side}`,
    source_book: args.book,
    bets_pct: args.betsPct,
    money_pct: args.moneyPct,
    market_line: args.market === "moneyline" ? null : args.market === "spread" ? 3.5 : 47.5,
    market_price: args.market === "moneyline" ? (args.side === "away" ? 130 : -150) : null,
    provider_event_id: `nfl:Away@Home-20261027`,
    source_observed_at: args.observedAt,
    fetched_at: args.insertedAt ?? "2026-10-27T19:46:00.000Z",
    raw_payload_hash: String(id).padStart(64, "a").slice(-64),
    inserted_at: args.insertedAt ?? "2026-10-27T19:47:00.000Z",
  };
}

const current = "2026-10-27T19:45:00.000Z";
const stale = "2026-10-27T14:00:00.000Z";
const future = "2026-10-27T21:00:00.000Z";
const rows: NflOwlsMarketBrainSplitRow[] = [
  row({ book: "circa", market: "moneyline", side: "away", observedAt: current, betsPct: 0.42, moneyPct: 0.62 }),
  row({ book: "circa", market: "moneyline", side: "home", observedAt: current, betsPct: 0.58, moneyPct: 0.38 }),
  row({ book: "draftkings", market: "moneyline", side: "away", observedAt: current, betsPct: 0.60, moneyPct: 0.40 }),
  row({ book: "draftkings", market: "moneyline", side: "home", observedAt: current, betsPct: 0.40, moneyPct: 0.60 }),
  row({ book: "betmgm", market: "moneyline", side: "away", observedAt: current, betsPct: 0.48, moneyPct: 0.52 }),
  row({ book: "betmgm", market: "moneyline", side: "home", observedAt: current, betsPct: 0.52, moneyPct: 0.48 }),
  row({ book: "circa", market: "spread", side: "away", observedAt: stale, betsPct: 0.45, moneyPct: 0.55 }),
  row({ book: "circa", market: "spread", side: "home", observedAt: stale, betsPct: 0.55, moneyPct: 0.45 }),
  row({ book: "circa", market: "total", side: "over", observedAt: future, betsPct: 0.45, moneyPct: 0.55,
    insertedAt: future }),
  row({ book: "circa", market: "total", side: "under", observedAt: future, betsPct: 0.55, moneyPct: 0.45,
    insertedAt: future }),
];

const evidence = buildNflOwlsMarketBrainSplitEvidence({ gameId, evaluatedAt, rows });
assert.equal(evidence.observations.length, 4, "all three current books plus the stale chronology row survive");
assert.deepEqual(
  evidence.observations.filter((observation) => observation.market === "moneyline")
    .map((observation) => observation.source.participant).sort(),
  ["betmgm", "circa", "draftkings"],
  "the internal reader must not collapse to the display-priority book",
);
assert.equal(
  evidence.observations.find((observation) => observation.source.participant === "circa" &&
    observation.market === "moneyline")?.values.first_money_minus_bets_pp.value,
  20,
  "normalized 0..1 storage must become percentage points exactly once",
);
assert.ok(Math.abs((evidence.observations.find((observation) =>
  observation.source.participant === "draftkings")?.values.first_money_minus_bets_pp.value ?? 0) + 20) < 1e-9,
"opposing named-book evidence must remain visible rather than averaged away");
assert.equal(evidence.observations.find((observation) => observation.market === "spread")?.availability, "stale");
assert.equal(evidence.observations.some((observation) => observation.market === "total"), false,
  "future evidence must not enter a point-in-time case");
assert.equal(evidence.expectedInputs.length, 9);
assert.equal(evidence.expectedInputs.find((input) => input.market === "total" && input.participant === "circa")
  ?.availability, "unavailable", "missing/future evidence must remain explicitly unavailable");
assert.equal(evidence.sourceManifests.length, 1);
assert.equal(evidence.sourceManifests[0]?.release, NFL_OWLS_MARKET_BRAIN_SPLIT_EVIDENCE_RELEASE);
assert.deepEqual(new Set(evidence.sourceManifests[0]?.retainedObservationIds),
  new Set(evidence.observations.map((observation) => observation.id)));

assert.doesNotThrow(() => buildMarketBrainCase({
  sport: "nfl",
  eventId: gameId,
  evaluatedAt,
  captureBoundary: "normalized_provider_observation",
  captureLimitations: ["provider raw response archive is not linked to this normalized evidence release"],
  subject: { kind: "two_team_game", awayId: "AWY", homeId: "HME", startsAt: "2026-10-28T00:00:00.000Z" },
  prior: { kind: "unavailable", release: "fixture", reason: "fixture" },
  evaluatedTargets: {},
  observations: evidence.observations,
  sourceManifests: evidence.sourceManifests,
  expectedInputs: evidence.expectedInputs,
  blindSpots: MARKET_BRAIN_BLIND_SPOTS,
}));

console.log("NFL Owls Market Brain named-book evidence tests passed.");
