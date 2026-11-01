import assert from "node:assert/strict";
import {
  buildNflMarketState,
  NFL_MARKET_STATE_RELEASE,
} from "../lib/services/football/nflMarketState";
import type { NflForwardContextFamily, NflForwardContextMarket } from "../lib/services/football/nflForwardEvidenceCapture";
import type { NflRegularSharpSplitSet } from "../lib/services/football/sharpApiNflSplits";

type Market = "moneyline" | "spread" | "total";

function family(args: {
  source: string;
  openingAt?: string;
  currentAt: string;
  openingLine: number;
  currentLine: number;
  openingAway?: number;
  openingHome?: number;
  currentAway?: number;
  currentHome?: number;
}): NflForwardContextFamily {
  return [
    args.source,
    args.source === "circa" || args.source === "pinnacle" ? "s" : "b",
    args.source === "circa" ? "c" : args.source === "pinnacle" ? "p" : "n",
    null,
    [args.openingAt ?? "2026-10-09T10:00:00.000Z", 60, "f", args.openingLine,
      args.openingAway ?? -110, args.openingHome ?? -110],
    [args.currentAt, 5, "f", args.currentLine, args.currentAway ?? -110, args.currentHome ?? -110],
  ];
}

function snapshot(capturedAt: string, spread: NflForwardContextFamily[]) {
  const market = (name: Market, families: NflForwardContextFamily[]): Pick<NflForwardContextMarket, "families"> => ({ families });
  return { capturedAt, markets: { moneyline: market("moneyline", []), spread: market("spread", spread), total: market("total", []) } };
}

function splitSet(sportsbook: string): NflRegularSharpSplitSet {
  const base = {
    provider: "sharpapi" as const,
    providerGameId: "game-1",
    sourceEventId: "event-1",
    sourceSportsbook: sportsbook,
    capturedAt: "2026-10-09T11:30:00.000Z",
    providerFetchedAt: "2026-10-09T11:29:00.000Z",
  };
  return {
    moneyline: { ...base, homeMoneyPct: 50, awayMoneyPct: 50, homeBetsPct: 50, awayBetsPct: 50,
      overMoneyPct: null, underMoneyPct: null, overBetsPct: null, underBetsPct: null },
    spread: { ...base, homeMoneyPct: 70, awayMoneyPct: 30, homeBetsPct: 50, awayBetsPct: 50,
      overMoneyPct: null, underMoneyPct: null, overBetsPct: null, underBetsPct: null },
    total: { ...base, homeMoneyPct: null, awayMoneyPct: null, homeBetsPct: null, awayBetsPct: null,
      overMoneyPct: 50, underMoneyPct: 50, overBetsPct: 50, underBetsPct: 50 },
  };
}

const snapshots = [
  snapshot("2026-10-09T11:00:00.000Z", [
    family({ source: "circa", currentAt: "2026-10-09T11:00:00.000Z", openingLine: -1.5, currentLine: -2 }),
    family({ source: "pinnacle", currentAt: "2026-10-09T11:00:00.000Z", openingLine: -1.5, currentLine: -1.5 }),
    family({ source: "draftkings", currentAt: "2026-10-09T11:00:00.000Z", openingLine: -1.5, currentLine: -2 }),
  ]),
  snapshot("2026-10-09T11:10:00.000Z", [
    family({ source: "circa", currentAt: "2026-10-09T11:10:00.000Z", openingLine: -1.5, currentLine: -2 }),
    family({ source: "pinnacle", currentAt: "2026-10-09T11:10:00.000Z", openingLine: -1.5, currentLine: -2 }),
    family({ source: "draftkings", currentAt: "2026-10-09T11:10:00.000Z", openingLine: -1.5, currentLine: -2 }),
  ]),
  snapshot("2026-10-09T11:20:00.000Z", [
    family({ source: "circa", currentAt: "2026-10-09T11:20:00.000Z", openingLine: -1.5, currentLine: -2 }),
    family({ source: "pinnacle", currentAt: "2026-10-09T11:20:00.000Z", openingLine: -1.5, currentLine: -2 }),
    family({ source: "draftkings", currentAt: "2026-10-09T11:20:00.000Z", openingLine: -1.5, currentLine: -2 }),
    family({ source: "fanduel", currentAt: "2026-10-09T11:20:00.000Z", openingLine: -1.5, currentLine: -2 }),
    family({ source: "caesars", currentAt: "2026-10-09T11:20:00.000Z", openingLine: -1.5, currentLine: -2 }),
  ]),
];

const state = buildNflMarketState({
  market: "spread",
  evaluatedAt: "2026-10-09T11:30:00.000Z",
  snapshots,
  current: { spread: { homeLine: -2 }, total: { line: 44.5 } },
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: splitSet("DraftKings"),
});

assert.equal(state.release, NFL_MARKET_STATE_RELEASE);
assert.equal(state.namedDirection, 1);
assert.equal(state.namedLeadCompletedAt, "2026-10-09T11:10:00.000Z");
assert.deepEqual(state.followerSources.sort(), ["caesars", "fanduel"]);
assert.ok(!state.followerSources.includes("draftkings"), "a retail move before named lead completion is not a follower");
assert.equal(state.splits[0]?.source, "retail_book", "DraftKings split remains retail evidence");
assert.equal(state.trails.find((trail) => trail.source === "circa")?.numberDelta, 0.5);
assert.equal(state.trails.find((trail) => trail.source === "circa")?.moveOrder, "number_only");

const singleNamedThenRetail = buildNflMarketState({
  market: "spread",
  evaluatedAt: "2026-10-09T11:30:00.000Z",
  snapshots: [snapshot("2026-10-09T11:20:00.000Z", [
    family({ source: "circa", currentAt: "2026-10-09T11:00:00.000Z", openingLine: -1.5, currentLine: -2 }),
    family({ source: "draftkings", currentAt: "2026-10-09T11:20:00.000Z", openingLine: -1.5, currentLine: -2 }),
  ])],
  current: { spread: { homeLine: -2 }, total: { line: 44.5 } },
  playbookLine: null, playbookSplits: null, sharpSplits: null,
});
assert.equal(singleNamedThenRetail.namedDirection, 1);
assert.deepEqual(singleNamedThenRetail.followerSources, ["draftkings"]);
const simultaneousRetail = buildNflMarketState({
  market: "spread",
  evaluatedAt: "2026-10-09T11:30:00.000Z",
  snapshots: [snapshot("2026-10-09T11:00:00.000Z", [
    family({ source: "circa", currentAt: "2026-10-09T11:00:00.000Z", openingLine: -1.5, currentLine: -2 }),
    family({ source: "draftkings", currentAt: "2026-10-09T11:00:00.000Z", openingLine: -1.5, currentLine: -2 }),
  ])],
  current: { spread: { homeLine: -2 }, total: { line: 44.5 } },
  playbookLine: null, playbookSplits: null, sharpSplits: null,
});
assert.equal(simultaneousRetail.namedDirection, null,
  "simultaneous retail movement cannot be invented as later independent follow-through");
assert.equal(simultaneousRetail.candidateNamedDirection, 1,
  "a real named episode survives for separate confirmation even without later retail follow-through");

const loneNamed = buildNflMarketState({
  market: "spread",
  evaluatedAt: "2026-10-09T11:30:00.000Z",
  snapshots: [snapshot("2026-10-09T11:20:00.000Z", [
    family({ source: "circa", currentAt: "2026-10-09T11:20:00.000Z", openingLine: -1.5, currentLine: -2 }),
  ])],
  current: { spread: { homeLine: -2 }, total: { line: 44.5 } },
  playbookLine: null, playbookSplits: null, sharpSplits: null,
});
assert.equal(loneNamed.candidateNamedDirection, 1,
  "the production builder retains a lone named move for independent paired-price corroboration downstream");
assert.equal(loneNamed.namedDirection, null,
  "retaining a lone episode must not manufacture the established consensus used by other readers");
assert.deepEqual(loneNamed.followerSources, []);
assert.equal(loneNamed.namedLeadCompletedAt, null);

const excludedLoneNamed = buildNflMarketState({
  market: "spread",
  evaluatedAt: "2026-10-09T11:30:00.000Z",
  snapshots: [snapshot("2026-10-09T11:20:00.000Z", [
    family({ source: "circa", currentAt: "2026-10-09T11:20:00.000Z", openingLine: -1.5, currentLine: -2 }),
  ])],
  excludedFamilies: ["Circa"],
  current: { spread: { homeLine: -2 }, total: { line: 44.5 } },
  playbookLine: null, playbookSplits: null, sharpSplits: null,
});
assert.equal(excludedLoneNamed.candidateNamedDirection, null,
  "the evaluated book cannot reappear as a lone candidate episode");

const excluded = buildNflMarketState({
  market: "spread",
  evaluatedAt: "2026-10-09T11:30:00.000Z",
  snapshots,
  excludedFamilies: ["FanDuel"],
  current: { spread: { homeLine: -2 }, total: { line: 44.5 } },
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: splitSet("Circa"),
});
assert.ok(!excluded.trails.some((trail) => trail.source === "fanduel"));
assert.ok(!excluded.followerSources.includes("fanduel"));
assert.equal(excluded.splits[0]?.source, "named_book", "Circa split is named source-specific evidence");

const priceOnly = buildNflMarketState({
  market: "spread",
  evaluatedAt: "2026-10-09T11:30:00.000Z",
  snapshots: [snapshot("2026-10-09T11:20:00.000Z", [family({
    source: "circa", currentAt: "2026-10-09T11:20:00.000Z", openingLine: -1.5, currentLine: -1.5,
    openingAway: -110, openingHome: -110, currentAway: 105, currentHome: -125,
  })])],
  current: { spread: { homeLine: -1.5 }, total: { line: 44.5 } },
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: null,
});
assert.equal(priceOnly.trails[0]?.numberDirection, null);
assert.equal(priceOnly.trails[0]?.priceDirection, 1);
assert.equal(priceOnly.trails[0]?.moveOrder, "price_only");
assert.ok((priceOnly.trails[0]?.holdDeltaPp ?? 0) !== 0, "hold change is preserved separately");

const resisted = buildNflMarketState({
  market: "spread",
  evaluatedAt: "2026-10-09T11:30:00.000Z",
  snapshots: [snapshot("2026-10-09T11:20:00.000Z", [family({
    source: "circa", currentAt: "2026-10-09T11:20:00.000Z", openingLine: -1.5, currentLine: -1.5,
  })])],
  current: { spread: { homeLine: -1.5 }, total: { line: 44.5 } },
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: splitSet("Circa"),
});
assert.equal(resisted.resistance, "flow_resistance");

const namedVersusRetail = buildNflMarketState({
  market: "spread",
  evaluatedAt: "2026-10-09T11:30:00.000Z",
  snapshots: [snapshot("2026-10-09T11:20:00.000Z", [
    family({ source: "circa", currentAt: "2026-10-09T11:00:00.000Z", openingLine: -1.5, currentLine: -2 }),
    family({ source: "pinnacle", currentAt: "2026-10-09T11:00:00.000Z", openingLine: -1.5, currentLine: -2 }),
    family({ source: "fanduel", currentAt: "2026-10-09T11:20:00.000Z", openingLine: -1.5, currentLine: -1 }),
  ])],
  current: { spread: { homeLine: -2 }, total: { line: 44.5 } },
  playbookLine: null, playbookSplits: null, sharpSplits: null,
});
assert.equal(namedVersusRetail.namedDirection, 1);
assert.equal(namedVersusRetail.resistance, "retail_price_resistance",
  "opposing retail price movement must not be mislabeled as disagreement between named books");
const opposedFlowSet = splitSet("Circa");
opposedFlowSet.spread = { ...opposedFlowSet.spread, homeMoneyPct: 30, awayMoneyPct: 70 };
const namedRetailAndFlow = buildNflMarketState({
  market: "spread",
  evaluatedAt: "2026-10-09T11:30:00.000Z",
  snapshots: [snapshot("2026-10-09T11:20:00.000Z", [
    family({ source: "circa", currentAt: "2026-10-09T11:00:00.000Z", openingLine: -1.5, currentLine: -2 }),
    family({ source: "pinnacle", currentAt: "2026-10-09T11:00:00.000Z", openingLine: -1.5, currentLine: -2 }),
    family({ source: "fanduel", currentAt: "2026-10-09T11:20:00.000Z", openingLine: -1.5, currentLine: -1 }),
  ])],
  current: { spread: { homeLine: -2 }, total: { line: 44.5 } },
  playbookLine: null, playbookSplits: null, sharpSplits: opposedFlowSet,
});
assert.equal(namedRetailAndFlow.resistance, "reverse_flow",
  "genuine opposite money flow must not be hidden by a simultaneous opposing retail price");
const opposingNamed = buildNflMarketState({
  market: "spread",
  evaluatedAt: "2026-10-09T11:30:00.000Z",
  snapshots: [snapshot("2026-10-09T11:20:00.000Z", [
    family({ source: "circa", currentAt: "2026-10-09T11:00:00.000Z", openingLine: -1.5, currentLine: -2 }),
    family({ source: "pinnacle", currentAt: "2026-10-09T11:00:00.000Z", openingLine: -1.5, currentLine: -1 }),
  ])],
  current: { spread: { homeLine: -1.5 }, total: { line: 44.5 } },
  playbookLine: null, playbookSplits: null, sharpSplits: null,
});
assert.equal(opposingNamed.namedDirection, null);
assert.equal(opposingNamed.candidateNamedDirection, null,
  "opposing named episodes cannot become a single candidate direction");
assert.equal(opposingNamed.resistance, "book_disagreement",
  "opposing Circa and Pinnacle moves remain a genuine named-book conflict");

const latePersistentMove = buildNflMarketState({
  market: "spread",
  evaluatedAt: "2026-10-09T11:30:00.000Z",
  snapshots: [
    snapshot("2026-10-09T10:10:00.000Z", [family({
      source: "circa", openingAt: "2026-10-09T10:00:00.000Z", currentAt: "2026-10-09T10:10:00.000Z",
      openingLine: -1.5, currentLine: -1.5, currentAway: -112, currentHome: -108,
    })]),
    snapshot("2026-10-09T11:20:00.000Z", [family({
      source: "circa", openingAt: "2026-10-09T10:00:00.000Z", currentAt: "2026-10-09T11:20:00.000Z",
      openingLine: -1.5, currentLine: -2,
    })]),
  ],
  current: { spread: { homeLine: -2 }, total: { line: 44.5 } },
  playbookLine: null,
  playbookSplits: null,
  sharpSplits: null,
});
assert.equal(latePersistentMove.trails[0]?.persistenceTimeShare, 1,
  "persistence begins with the first material directional move, not the market opening");
assert.ok(latePersistentMove.trails[0]!.reversalMagnitude > 0,
  "real early price shading against the final direction remains visible, however small");

// Actual paired repricing is available for interpretation before any arbiter
// decides whether it is persuasive. It cannot vanish behind a one-point floor.
const priceOnlyState = (away: number, home: number, excludedFamilies: string[] = []) => {
  const families = ["circa", "pinnacle"].map((source) => family({
    source, currentAt: "2026-10-09T11:20:00.000Z", openingLine: 0, currentLine: 0,
    currentAway: away, currentHome: home,
  }));
  return buildNflMarketState({
    market: "moneyline", evaluatedAt: "2026-10-09T11:30:00.000Z", excludedFamilies,
    snapshots: [{ capturedAt: "2026-10-09T11:20:00.000Z", markets: {
      moneyline: { families }, spread: { families: [] }, total: { families: [] },
    } }],
    current: { spread: null, total: null }, playbookLine: null, playbookSplits: null, sharpSplits: null,
  });
};
const smallPriceEpisode = priceOnlyState(-107, -113);
assert.equal(smallPriceEpisode.namedDirection, 1);
assert.equal(smallPriceEpisode.candidateNamedDirection, 1);
for (const trail of smallPriceEpisode.trails) {
  assert.ok(Math.abs(trail.fairProbabilityDeltaPp - 0.6496037417175526) < 1e-9);
  assert.equal(trail.priceDirection, 1);
  assert.equal(trail.moveOrder, "price_only");
  assert.equal(trail.lastEconomicMoveAt, "2026-10-09T11:20:00.000Z");
}
const tinyPriceEpisode = priceOnlyState(-110, -110.001);
assert.equal(tinyPriceEpisode.namedDirection, 1,
  "even a tiny genuine fair-price reaction is exposed, not automatically trusted or flipped");
assert.ok(tinyPriceEpisode.trails[0]!.fairProbabilityDeltaPp > 0);
assert.ok(tinyPriceEpisode.trails[0]!.fairProbabilityDeltaPp < 0.25);
assert.equal(priceOnlyState(-110, -110).namedDirection, null,
  "unchanged paired prices cannot create an episode");
const vigOnly = priceOnlyState(-120, -120);
assert.equal(vigOnly.namedDirection, null,
  "a symmetric hold change without a no-vig probability move is non-directional");
assert.equal(vigOnly.trails[0]?.priceDirection, null);
assert.equal(vigOnly.trails[0]?.lastEconomicMoveAt, null);
assert.ok(vigOnly.trails[0]!.holdDeltaPp > 0);
const excludedSmall = priceOnlyState(-107, -113, ["circa"]);
assert.deepEqual(excludedSmall.trails.map((trail) => trail.source), ["pinnacle"]);
assert.equal(excludedSmall.namedDirection, null);
assert.equal(excludedSmall.candidateNamedDirection, 1,
  "excluding the target book preserves only a candidate, not a second named vote");
const smallBuyback = buildNflMarketState({
  market: "spread", evaluatedAt: "2026-10-09T11:30:00.000Z",
  snapshots: [
    snapshot("2026-10-09T11:10:00.000Z", [family({source: "circa", currentAt: "2026-10-09T11:10:00.000Z",
      openingLine: 0, currentLine: 0, currentAway: -107, currentHome: -113})]),
    snapshot("2026-10-09T11:20:00.000Z", [family({source: "circa", currentAt: "2026-10-09T11:20:00.000Z",
      openingLine: 0, currentLine: 0})]),
  ], current: {spread: {homeLine: 0}, total: null}, playbookLine: null, playbookSplits: null, sharpSplits: null,
});
assert.equal(smallBuyback.trails[0]?.buybackToOpening, true,
  "a return after a small real paired-price move remains a recorded buyback");
assert.equal(smallBuyback.namedDirection, null);

const partialNumberBuyback = buildNflMarketState({
  market: "spread", evaluatedAt: "2026-10-09T11:30:00.000Z",
  snapshots: [
    snapshot("2026-10-09T10:30:00.000Z", [family({ source: "circa",
      currentAt: "2026-10-09T10:30:00.000Z", openingLine: -3, currentLine: -7 })]),
    snapshot("2026-10-09T11:20:00.000Z", [family({ source: "circa",
      currentAt: "2026-10-09T11:20:00.000Z", openingLine: -3, currentLine: -4 })]),
  ], current: { spread: { homeLine: -4 }, total: null },
  playbookLine: null, playbookSplits: null, sharpSplits: null,
}).trails[0]!;
assert.equal(partialNumberBuyback.direction, 1,
  "the net opening-to-current number still supports the home side");
assert.equal(partialNumberBuyback.lastEconomicDirection, -1);
assert.equal(partialNumberBuyback.lastNumberDirection, -1);
assert.equal(partialNumberBuyback.lastPriceDirection, null);
assert.equal(partialNumberBuyback.retracementNumberMagnitude, 3);
assert.equal(partialNumberBuyback.numberPeakAt, "2026-10-09T10:30:00.000Z");
assert.equal(partialNumberBuyback.retracementPriceMagnitudePp, 0);
assert.equal(partialNumberBuyback.buybackToOpening, false,
  "a partial retracement is distinct from a complete return to opening");
assert.equal(partialNumberBuyback.persistenceTimeShare, 1,
  "opening-relative persistence remains a separate statistic, not a denial of the late retracement");
const partialPriceBuyback = buildNflMarketState({
  market: "spread", evaluatedAt: "2026-10-09T11:30:00.000Z",
  snapshots: [
    snapshot("2026-10-09T10:30:00.000Z", [family({ source: "circa",
      currentAt: "2026-10-09T10:30:00.000Z", openingLine: 0, currentLine: 0,
      currentAway: 100, currentHome: -140 })]),
    snapshot("2026-10-09T11:20:00.000Z", [family({ source: "circa",
      currentAt: "2026-10-09T11:20:00.000Z", openingLine: 0, currentLine: 0,
      currentAway: -105, currentHome: -115 })]),
  ], current: { spread: { homeLine: 0 }, total: null },
  playbookLine: null, playbookSplits: null, sharpSplits: null,
}).trails[0]!;
assert.equal(partialPriceBuyback.direction, 1);
assert.equal(partialPriceBuyback.lastEconomicDirection, -1);
assert.equal(partialPriceBuyback.lastPriceDirection, -1);
assert.equal(partialPriceBuyback.lastNumberDirection, null);
assert.ok(partialPriceBuyback.retracementPriceMagnitudePp! > 2);
assert.equal(partialPriceBuyback.pricePeakAt, "2026-10-09T10:30:00.000Z");
assert.equal(partialPriceBuyback.retracementNumberMagnitude, 0);
assert.ok(smallBuyback.trails[0]!.retracementPriceMagnitudePp! > 0,
  "a complete price buyback retains the size and time of the erased excursion");
assert.equal(smallBuyback.trails[0]!.lastPriceDirection, -1);
assert.equal(vigOnly.trails[0]!.pricePeakAt, null);
assert.equal(vigOnly.trails[0]!.retracementPriceMagnitudePp, 0,
  "hold-only changes cannot create a false directional peak or retracement");

console.log("NFL market-state tests passed.");
