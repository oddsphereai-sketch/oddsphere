import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { MarketIntelligence } from "../lib/services/nba/buildNbaDailyEdgeDto";
import {
  buildNbaComparableMovementEvidence,
  NBA_FORWARD_MARKET_EVIDENCE_RELEASE,
} from "../lib/services/nba/nbaForwardMarketEvidence";

function intel(overrides: Partial<MarketIntelligence> = {}): MarketIntelligence {
  return {
    market: "spread",
    pick_label: "DEN -4.5",
    pick_side: "home",
    consensus_line: -4.5,
    current_price: {
      odds_american: -125,
      odds_decimal: 1.8,
      sportsbook: "DraftKings",
      fetched_at: "2026-10-20T18:00:00Z",
    },
    ...overrides,
  } as MarketIntelligence;
}

const opening = {
  americanPrice: -105,
  sportsbook: "draftkings",
  line: -4.5,
  observedAt: "2026-10-20T12:00:00.000Z",
};
const evidence = buildNbaComparableMovementEvidence({
  market: "spread",
  intel: intel(),
  opening,
});
assert.ok(evidence !== null);
assert.equal(evidence.comparison_scope, "same_game_same_book_same_side_exact_line");
assert.equal(evidence.opening_american_price, -105);
assert.equal(evidence.current_american_price, -125);
assert.equal(evidence.opening_observed_at, "2026-10-20T12:00:00.000Z");
assert.ok(evidence.implied_probability_change_pp > 0);

assert.equal(buildNbaComparableMovementEvidence({
  market: "spread",
  intel: intel({
    current_price: {
      odds_american: -125,
      odds_decimal: 1.8,
      sportsbook: "FanDuel",
      fetched_at: "2026-10-20T18:00:00Z",
    },
  }),
  opening,
}), null, "a different book must fail closed");

assert.equal(buildNbaComparableMovementEvidence({
  market: "spread",
  intel: intel({ consensus_line: -5.5 }),
  opening,
}), null, "a different spread number must fail closed");

assert.equal(buildNbaComparableMovementEvidence({
  market: "spread",
  intel: intel({
    current_price: {
      odds_american: -125,
      odds_decimal: 1.8,
      sportsbook: "DraftKings",
      fetched_at: null,
    },
  }),
  opening,
}), null, "missing current quote time must fail closed");

assert.match(NBA_FORWARD_MARKET_EVIDENCE_RELEASE, /same_book_exact_line$/);

const pipelineSource = readFileSync(
  new URL("../lib/services/nba/buildNbaDailyEdgeAdapted.ts", import.meta.url),
  "utf8",
);
const writerSource = readFileSync(
  new URL("../lib/services/nba/buildNbaPredictionRecords.ts", import.meta.url),
  "utf8",
);
assert.match(
  pipelineSource,
  /comparableOpeningsByGame\.set\(ext, comparableOpenings\)/,
  "the pipeline must retain opener identity rather than only the UI price",
);
assert.match(
  writerSource,
  /forward_market_evidence_release: NBA_FORWARD_MARKET_EVIDENCE_RELEASE/,
  "future locked snapshots must identify their evidence schema",
);
assert.match(
  writerSource,
  /splits_provenance:[\s\S]+splits_sportsbook[\s\S]+splits_fetched_at/,
  "split values must retain sportsbook and observation-time provenance",
);
assert.match(
  writerSource,
  /if \(existing !== undefined && existing\.locked_at !== null\)[\s\S]+continue;/,
  "the evidence upgrade must not rewrite existing locked public records",
);
console.log("NBA forward market evidence tests passed.");
