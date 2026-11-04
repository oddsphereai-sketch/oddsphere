import assert from "node:assert/strict";
import {
  arbitrateNhlMarketEpisode,
  type NhlBookPathReceipt,
  type NhlSplitPressureReceipt,
} from "../lib/services/nhl/nhlMarketEpisodeArbiter";

const decisionAt = "2026-11-03T22:00:00.000Z";
const path = (overrides: Partial<NhlBookPathReceipt> = {}): NhlBookPathReceipt => {
  const openingValue = overrides.openingValue ?? 0.50;
  const currentValue = overrides.currentValue ?? 0.53;
  const openingObservedAt = overrides.openingObservedAt ?? "2026-11-03T18:00:00.000Z";
  const firstMaterialMoveAt = overrides.firstMaterialMoveAt === undefined
    ? "2026-11-03T20:20:00.000Z"
    : overrides.firstMaterialMoveAt;
  const currentObservedAt = overrides.currentObservedAt ?? "2026-11-03T21:55:00.000Z";
  return ({
  market: "moneyline",
  sportsbook: "Circa",
  sportsbookFamily: "circa",
  sourceClass: "named",
  contractKey: "full_game_ml",
  complete: true,
  state: "stable",
  openingValue,
  currentValue,
  openingObservedAt,
  firstMaterialMoveAt,
  currentObservedAt,
  observations: overrides.observations ?? [
    { at: openingObservedAt, value: openingValue },
    ...(firstMaterialMoveAt && firstMaterialMoveAt !== currentObservedAt
      ? [{ at: firstMaterialMoveAt, value: currentValue }]
      : []),
    { at: currentObservedAt, value: currentValue },
  ],
  ...overrides,
  });
};
const pressure = (overrides: Partial<NhlSplitPressureReceipt> = {}): NhlSplitPressureReceipt => ({
  market: "moneyline",
  source: "playbook",
  sourceClass: "public",
  pressureSide: "home",
  ticketsPct: 62,
  moneyPct: 66,
  confidence: "high",
  completePair: true,
  observedAt: "2026-11-03T20:00:00.000Z",
  receivedAt: "2026-11-03T20:01:00.000Z",
  ...overrides,
});
const arbitrate = (overrides: Partial<Parameters<typeof arbitrateNhlMarketEpisode>[0]> = {}) => arbitrateNhlMarketEpisode({
  market: "moneyline",
  contractKey: "full_game_ml",
  decisionAt,
  executionSportsbookFamily: null,
  paths: [path()],
  pressure: pressure(),
  materialMove: 0.01,
  maximumPathAgeMs: 30 * 60_000,
  maximumPressureAgeMs: 180 * 60_000,
  followerWindowMs: 45 * 60_000,
  ...overrides,
});

const confirmation = arbitrate();
assert.equal(confirmation.state, "confirmation");
assert.equal(confirmation.author?.sportsbookFamily, "circa");
assert.ok(Math.abs(confirmation.innovation - 0.03) < 1e-12);
assert.equal(confirmation.reason, "qualified_split_response");

const resistance = arbitrate({ paths: [path({ currentValue: 0.47 })] });
assert.equal(resistance.state, "resistance");
assert.equal(resistance.direction, "away");

const latePressure = arbitrate({
  pressure: pressure({ observedAt: "2026-11-03T20:30:00.000Z", receivedAt: "2026-11-03T20:31:00.000Z" }),
});
assert.equal(latePressure.state, "resistance", "a verified post-receipt hold remains contextual resistance");
assert.equal(latePressure.reason, "qualified_split_response");
assert.equal(latePressure.innovation, 0);

const postPressureLeg = arbitrate({
  paths: [path({
    openingValue: 0.54,
    currentValue: 0.575,
    firstMaterialMoveAt: "2026-11-03T19:00:00.000Z",
    observations: [
      { at: "2026-11-03T18:00:00.000Z", value: 0.54 },
      { at: "2026-11-03T19:00:00.000Z", value: 0.56 },
      { at: "2026-11-03T20:20:00.000Z", value: 0.575 },
      { at: "2026-11-03T21:55:00.000Z", value: 0.575 },
    ],
  })],
});
assert.equal(postPressureLeg.state, "confirmation");
assert.ok(Math.abs(postPressureLeg.innovation - 0.015) < 1e-12, "only the causal post-pressure leg supplies amplitude");

const prePressureReversalDoesNotEraseCausalResponse = arbitrate({
  paths: [path({
    state: "reversal",
    openingValue: 0.50,
    currentValue: 0.52,
    firstMaterialMoveAt: "2026-11-03T18:30:00.000Z",
    observations: [
      { at: "2026-11-03T18:00:00.000Z", value: 0.50 },
      { at: "2026-11-03T18:30:00.000Z", value: 0.54 },
      { at: "2026-11-03T19:30:00.000Z", value: 0.47 },
      { at: "2026-11-03T20:20:00.000Z", value: 0.52 },
      { at: "2026-11-03T21:55:00.000Z", value: 0.52 },
    ],
  })],
});
assert.equal(prePressureReversalDoesNotEraseCausalResponse.state, "confirmation");
assert.ok(
  Math.abs(prePressureReversalDoesNotEraseCausalResponse.innovation - 0.05) < 1e-12,
  "pre-pressure volatility is audit context; a clean post-availability response owns the causal amplitude",
);

const causalFullBuyback = arbitrate({
  paths: [path({
    state: "flat",
    openingValue: 0.50,
    currentValue: 0.50,
    firstMaterialMoveAt: "2026-11-03T20:20:00.000Z",
    observations: [
      { at: "2026-11-03T18:00:00.000Z", value: 0.50 },
      { at: "2026-11-03T20:20:00.000Z", value: 0.54 },
      { at: "2026-11-03T21:55:00.000Z", value: 0.50 },
    ],
  })],
});
assert.equal(causalFullBuyback.state, "disagreement");
assert.equal(causalFullBuyback.author, null, "a complete post-pressure buyback cannot be frozen as a hold author");
assert.equal(causalFullBuyback.innovation, 0);

const heldResistance = arbitrate({
  paths: [path({
    state: "flat",
    currentValue: 0.50,
    firstMaterialMoveAt: null,
  })],
});
assert.equal(heldResistance.state, "resistance");
assert.equal(heldResistance.direction, "away");
assert.equal(heldResistance.innovation, 0);

const stalePressure = arbitrate({
  pressure: pressure({ observedAt: "2026-11-03T12:00:00.000Z", receivedAt: "2026-11-03T12:01:00.000Z" }),
});
assert.equal(stalePressure.rejectedPressure?.reason, "stale_observation");
assert.equal(stalePressure.state, "unresolved");

const futurePath = arbitrate({
  paths: [path({ currentObservedAt: "2026-11-03T22:01:00.000Z" })],
});
assert.equal(futurePath.state, "unavailable");
assert.equal(futurePath.rejectedPaths[0]?.reason, "future_observation");

for (const state of ["buyback", "reversal", "incomplete"] as const) {
  const rejected = arbitrate({ paths: [path({ state, complete: state !== "incomplete" })] });
  assert.equal(
    rejected.state,
    state === "incomplete" ? "unavailable" : "confirmation",
    "global pre-pressure path shape cannot erase a clean causal post-pressure response",
  );
  if (state === "incomplete") assert.equal(rejected.innovation, 0);
}

const reversalVeto = arbitrate({
  paths: [
    path({ sportsbookFamily: "circa", currentValue: 0.54 }),
    path({
      sportsbook: "Pinnacle",
      sportsbookFamily: "pinnacle",
      state: "reversal",
      currentValue: 0.47,
      observations: [
        { at: "2026-11-03T18:00:00.000Z", value: 0.50 },
        { at: "2026-11-03T20:20:00.000Z", value: 0.54 },
        { at: "2026-11-03T21:55:00.000Z", value: 0.47 },
      ],
    }),
  ],
});
assert.equal(reversalVeto.state, "disagreement", "a named reversal vetoes another book's apparent response");

const holdVetoesConfirmation = arbitrate({
  paths: [
    path({ sportsbookFamily: "circa", currentValue: 0.54 }),
    path({
      sportsbook: "Pinnacle",
      sportsbookFamily: "pinnacle",
      state: "flat",
      currentValue: 0.50,
      firstMaterialMoveAt: null,
    }),
  ],
});
assert.equal(holdVetoesConfirmation.state, "disagreement", "a named hold resisting pressure vetoes another book's confirming move");

const excluded = arbitrate({ executionSportsbookFamily: "Circa" });
assert.equal(excluded.state, "unavailable");
assert.equal(excluded.counts.excludedExecutionFamilies, 1);
assert.equal(excluded.rejectedPaths[0]?.reason, "execution_book_excluded");

const namedDiscovery = arbitrate({
  pressure: null,
  paths: [
    path({ sportsbook: "Pinnacle", sportsbookFamily: "pinnacle", firstMaterialMoveAt: "2026-11-03T20:00:00.000Z", currentValue: 0.54 }),
    path({ sportsbook: "Bookmaker", sportsbookFamily: "bookmaker", firstMaterialMoveAt: "2026-11-03T20:20:00.000Z", currentValue: 0.52 }),
  ],
});
assert.equal(namedDiscovery.state, "discovery");
assert.equal(namedDiscovery.author?.sportsbookFamily, "pinnacle");
assert.equal(namedDiscovery.followers[0]?.sportsbookFamily, "bookmaker");
assert.ok(
  Math.abs(namedDiscovery.innovation - 0.04) < 1e-12,
  "only the leader owns amplitude; follower movement is not added or averaged",
);

const disagreement = arbitrate({
  pressure: null,
  paths: [
    path({ sportsbookFamily: "circa", currentValue: 0.54 }),
    path({ sportsbook: "Pinnacle", sportsbookFamily: "pinnacle", currentValue: 0.47, firstMaterialMoveAt: "2026-11-03T20:30:00.000Z" }),
  ],
});
assert.equal(disagreement.state, "disagreement");
assert.equal(disagreement.author, null);
assert.equal(disagreement.innovation, 0);

const simultaneous = arbitrate({
  pressure: null,
  paths: [
    path({ sportsbookFamily: "circa", currentValue: 0.54 }),
    path({ sportsbook: "Pinnacle", sportsbookFamily: "pinnacle", currentValue: 0.53 }),
  ],
});
assert.equal(simultaneous.state, "unresolved");
assert.equal(simultaneous.reason, "indistinguishable_leader");

const total = arbitrateNhlMarketEpisode({
  market: "total",
  contractKey: "total:6.5",
  decisionAt,
  executionSportsbookFamily: "pinnacle",
  paths: [
    path({ market: "total", contractKey: "total:6.5", sportsbookFamily: "circa", openingValue: 6.40, currentValue: 6.58 }),
    path({ market: "total", contractKey: "total:6.5", sportsbook: "Pinnacle", sportsbookFamily: "pinnacle", openingValue: 6.42, currentValue: 6.60 }),
    path({ market: "moneyline", contractKey: "full_game_ml", sportsbook: "Bookmaker", sportsbookFamily: "bookmaker" }),
  ],
  pressure: pressure({ market: "total", pressureSide: "over" }),
  materialMove: 0.12,
  maximumPathAgeMs: 30 * 60_000,
  maximumPressureAgeMs: 180 * 60_000,
  followerWindowMs: 45 * 60_000,
});
assert.equal(total.state, "confirmation");
assert.equal(total.author?.sportsbookFamily, "circa");
assert.equal(total.counts.receivedForMarket, 2, "book counts are market-specific");
assert.equal(total.counts.excludedExecutionFamilies, 1);
assert.equal(total.rejectedPaths.some((row) => row.reason === "market_mismatch"), true);

const duplicateFamily = arbitrate({
  pressure: null,
  paths: [
    path({ sportsbook: "Circa", sportsbookFamily: "circa" }),
    path({ sportsbook: "Circa Sports", sportsbookFamily: "Circa Sports", firstMaterialMoveAt: "2026-11-03T20:30:00.000Z" }),
    path({ sportsbook: "Pinnacle", sportsbookFamily: "pinnacle", firstMaterialMoveAt: "2026-11-03T20:40:00.000Z" }),
  ],
});
assert.equal(duplicateFamily.rejectedPaths.filter((row) => row.reason === "duplicate_book_family").length, 2);
assert.equal(duplicateFamily.state, "unresolved");

const aliasExecutionExclusion = arbitrate({
  pressure: null,
  executionSportsbookFamily: "Pinnacle",
  paths: [
    path({ sportsbook: "Pinnacle Sportsbook", sportsbookFamily: "Pinnacle Sportsbook" }),
    path({ sportsbook: "Bookmaker", sportsbookFamily: "bookmaker", firstMaterialMoveAt: "2026-11-03T20:40:00.000Z" }),
  ],
});
assert.equal(aliasExecutionExclusion.counts.excludedExecutionFamilies, 1);
assert.equal(aliasExecutionExclusion.state, "unresolved", "an alias of the execution book cannot fabricate independent breadth");

console.log("NHL market episode arbiter: causality, freshness, exclusion, disagreement, leadership, one-author innovation, and market-scoped counts passed.");
