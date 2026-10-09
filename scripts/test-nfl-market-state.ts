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
assert.equal(latePersistentMove.trails[0]?.reversalMagnitude, 0,
  "sub-threshold price shading before a material move is not a reversal");

console.log("NFL market-state tests passed.");
