import assert from "node:assert/strict";
import {
  buildNflProfessionalMarketAuthority,
  NFL_PROFESSIONAL_MARKET_AUTHORITY_RELEASE,
} from "@/lib/services/football/nflProfessionalMarketAuthority";
import type { NflForwardContextFamily } from "@/lib/services/football/nflForwardEvidenceCapture";
import type { NflRegularSharpSplitSet } from "@/lib/services/football/sharpApiNflSplits";

const OPEN = "2026-10-01T12:00:00.000Z";
const MOVE = "2026-10-02T13:00:00.000Z";
const EVALUATED = "2026-10-02T14:00:00.000Z";

function family(args: {
  source: string;
  openingNumber: number | null;
  currentNumber: number | null;
  direction: "first" | "second" | "flat";
}): NflForwardContextFamily {
  const currentPrices = args.direction === "first" ? [-130, 110]
    : args.direction === "second" ? [110, -130] : [-110, -110];
  return [
    args.source,
    args.source === "circa" || args.source === "pinnacle" ? "s" : "b",
    args.source === "circa" ? "c" : args.source === "pinnacle" ? "p" : "n",
    null,
    [OPEN, 0, "f", args.openingNumber, -110, -110],
    [MOVE, 0, "f", args.currentNumber, currentPrices[0], currentPrices[1]],
  ];
}

function authority(args: {
  moneyline?: NflForwardContextFamily[];
  spread?: NflForwardContextFamily[];
  total?: NflForwardContextFamily[];
  selectedBook?: string;
  excluded?: Partial<Record<"moneyline" | "spread" | "total", string[]>>;
  spreadFlow?: "home" | "away" | null;
}) {
  return buildNflProfessionalMarketAuthority({
    evaluatedAt: EVALUATED,
    snapshots: [{
      capturedAt: EVALUATED,
      markets: {
        moneyline: { families: args.moneyline ?? [] },
        spread: { families: args.spread ?? [] },
        total: { families: args.total ?? [] },
      },
    }],
    current: { sportsbook: args.selectedBook ?? "fanduel", spread: { homeLine: -4 }, total: { line: 45 } },
    playbookLine: null,
    playbookSplits: null,
    sharpSplits: args.spreadFlow ? sharpSplits(args.spreadFlow) : null,
    excludedFamiliesByMarket: args.excluded,
  });
}

function sharpSplits(spreadFlow: "home" | "away"): NflRegularSharpSplitSet {
  const base = {
    provider: "sharpapi" as const,
    providerGameId: "test-game",
    sourceEventId: "test-event",
    sourceSportsbook: "circa",
    capturedAt: EVALUATED,
    providerFetchedAt: EVALUATED,
  };
  const neutral = {
    ...base,
    homeMoneyPct: 50, awayMoneyPct: 50, homeBetsPct: 50, awayBetsPct: 50,
    overMoneyPct: null, underMoneyPct: null, overBetsPct: null, underBetsPct: null,
  };
  const total = {
    ...base,
    homeMoneyPct: null, awayMoneyPct: null, homeBetsPct: null, awayBetsPct: null,
    overMoneyPct: 50, underMoneyPct: 50, overBetsPct: 50, underBetsPct: 50,
  };
  const homeMoneyPct = spreadFlow === "home" ? 70 : 30;
  return {
    moneyline: neutral,
    spread: {
      ...neutral,
      homeMoneyPct,
      awayMoneyPct: 100 - homeMoneyPct,
    },
    total,
  };
}

const stableMoneyline = [
  family({ source: "circa", openingNumber: null, currentNumber: null, direction: "second" }),
  family({ source: "pinnacle", openingNumber: null, currentNumber: null, direction: "second" }),
];
const spreadAlignment = [
  family({ source: "circa", openingNumber: -3, currentNumber: -4, direction: "second" }),
  family({ source: "pinnacle", openingNumber: -3, currentNumber: -4, direction: "second" }),
  family({ source: "fanatics", openingNumber: -3, currentNumber: -4, direction: "second" }),
];
const twoNamedTotal = [
  family({ source: "circa", openingNumber: 44, currentNumber: 45, direction: "first" }),
  family({ source: "pinnacle", openingNumber: 44, currentNumber: 45, direction: "first" }),
  family({ source: "fanatics", openingNumber: 44, currentNumber: 45, direction: "first" }),
];
const qualified = authority({
  moneyline: stableMoneyline,
  spread: spreadAlignment,
  total: twoNamedTotal,
  spreadFlow: "home",
});
assert.equal(qualified.release, NFL_PROFESSIONAL_MARKET_AUTHORITY_RELEASE);
assert.equal(qualified.moneylineSide, "home");
assert.equal(qualified.spreadSide, "home");
assert.equal(qualified.totalSide, "over");
assert.equal(qualified.reads.total.reason, "two_named_total_number_moves");

const unsupportedSpread = authority({ spread: spreadAlignment });
assert.equal(unsupportedSpread.spreadSide, null, "line and price movement without aligned flow is not side authority");

const opposingSpreadFlow = authority({ spread: spreadAlignment, spreadFlow: "away" });
assert.equal(opposingSpreadFlow.spreadSide, null, "opposing named flow vetoes a line-and-price side override");

const retailBooks = ["fanduel", "draftkings", "caesars", "betmgm", "fanatics"];
const broadRetail = authority({
  selectedBook: "fanduel",
  total: retailBooks.map((source) => family({ source, openingNumber: 45, currentNumber: 44, direction: "second" })),
  excluded: { total: ["betrivers"] },
});
assert.equal(broadRetail.totalSide, "under");
assert.equal(broadRetail.reads.total.reason, "broad_stable_retail_total_number_move");

const targetBookCannotConfirmItself = authority({
  selectedBook: "fanduel",
  total: retailBooks.map((source) => family({ source, openingNumber: 45, currentNumber: 44, direction: "second" })),
  excluded: { total: ["fanduel"] },
});
assert.equal(targetBookCannotConfirmItself.totalSide, null,
  "an excluded evaluated family cannot re-enter the broad-retail confirmation path");

const selectedOpposes = authority({
  selectedBook: "fanduel",
  total: [
    family({ source: "fanduel", openingNumber: 45, currentNumber: 46, direction: "first" }),
    ...retailBooks.slice(1).map((source) => family({ source, openingNumber: 45, currentNumber: 44, direction: "second" })),
    family({ source: "betrivers", openingNumber: 45, currentNumber: 44, direction: "second" }),
  ],
});
assert.equal(selectedOpposes.totalSide, null, "broad retail movement cannot qualify against the selected-book confirmation");

const targetExcluded = authority({
  total: [
    ...twoNamedTotal,
    family({ source: "fanduel", openingNumber: 44, currentNumber: 43, direction: "second" }),
  ],
  excluded: { total: ["fanduel"] },
});
assert.equal(targetExcluded.totalSide, "over", "the evaluated target family must be removed before authority is resolved");
assert.deepEqual(targetExcluded.excludedFamiliesByMarket.total, ["fanduel"]);

const oneNamedTotal = authority({
  total: [
    family({ source: "circa", openingNumber: 44, currentNumber: 45, direction: "first" }),
    family({ source: "draftkings", openingNumber: 44, currentNumber: 45, direction: "first" }),
  ],
});
assert.equal(oneNamedTotal.totalSide, null, "one named move and thin retail support are insufficient");

const fourRetailPlusNamed = authority({
  selectedBook: "fanduel",
  total: [
    ...retailBooks.slice(0, 4).map((source) =>
      family({ source, openingNumber: 45, currentNumber: 44, direction: "second" })),
    family({ source: "circa", openingNumber: 45, currentNumber: 44, direction: "second" }),
  ],
});
assert.equal(fourRetailPlusNamed.totalSide, null,
  "one named book cannot be counted as the fifth source in the five-retail confirmation path");

console.log("NFL professional market authority tests passed.");
