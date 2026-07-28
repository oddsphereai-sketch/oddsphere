import {
  alignMarketReadsToDisplayedPublicSplits,
  overlayResolvedPublicSplits,
  refreshDisplayedSplitFreshness,
  type ResolvedDisplayByExtId,
} from "../lib/services/publicSplitsDisplayOverlay";
import type { DailyEdgeGameDto } from "../app/lab/lib/labTypes";

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, details = "") {
  if (ok) {
    pass += 1;
    console.log(`ok - ${name}`);
  } else {
    fail += 1;
    console.error(`not ok - ${name}${details ? ` (${details})` : ""}`);
  }
}

function game(): DailyEdgeGameDto {
  return {
    external_id: 5059011,
    homeTeam: "BAL",
    awayTeam: "WSH",
    markets: {
      total: {
        pick: "Under 9",
        moneyPct: 28,
        betsPct: 71,
        publicSplits: [
          { side: "over", label: "Over", moneyPct: 72, betsPct: 29 },
          { side: "under", label: "Under", moneyPct: 28, betsPct: 71 },
        ],
      },
      moneyline: {
        pick: "WSH",
        moneyPct: 35,
        betsPct: 40,
        publicSplits: [
          { side: "home", label: "BAL", moneyPct: 65, betsPct: 60 },
          { side: "away", label: "WSH", moneyPct: 35, betsPct: 40 },
        ],
        marketReadV2: {
          label: "Projection-Led",
          score: 0,
          tone: "gray",
          explanation: "The model edge is clear, but betting consensus is not fully aligned.",
          copyMode: "context_only_not_pick_changing",
          exactLineEvidenceStatus: "moneyline_line_not_required",
          evidenceAsOf: "2026-06-27T15:00:00.000Z",
          generatedAt: "2026-06-27T15:00:01.000Z",
          validityStatus: "valid_nondirectional",
          movement: {
            firstTrackedLine: null,
            firstTrackedPrice: -110,
            currentLine: null,
            currentPrice: -110,
            directionRelativeToPick: "neutral",
            observedAt: "2026-06-27T15:00:00.000Z",
          },
          consensus: { betsPct: 0.4, moneyPct: 0.35, booksUsed: 8, lineBasis: "paired_same_ingestion" },
          sourceSummary: {
            priceAction: "The model edge is clear, but betting consensus is not fully aligned.",
            playbookConsensus: "Consensus: 35% money / 40% bets across 8 books.",
            sharpApiSourceSpecific: null,
            sharpMoney: null,
          },
        },
      },
    },
  } as DailyEdgeGameDto;
}

const resolved: ResolvedDisplayByExtId = new Map([
  [
    5059011,
    {
      total: {
        over: { moneyPct: 53, betsPct: 59, observedAt: "2026-06-27T16:27:32.238Z", isStale: false },
        under: { moneyPct: 47, betsPct: 41, observedAt: "2026-06-27T16:27:32.238Z", isStale: false },
      },
      moneyline: {
        home: { moneyPct: 44, betsPct: 45, observedAt: "2026-06-27T16:27:32.238Z", isStale: false },
        away: { moneyPct: 56, betsPct: 55, booksUsed: 11, observedAt: "2026-06-27T16:27:32.238Z", isStale: false },
      },
    },
  ],
]);

const [out] = overlayResolvedPublicSplits([game()], resolved);
const total = out!.markets.total!;
const moneyline = out!.markets.moneyline!;

check("total publicSplits replaced by resolved display values", total.publicSplits[1]?.moneyPct === 47 && total.publicSplits[1]?.betsPct === 41);
check("total picked-side scalar mirrors displayed Under row", total.moneyPct === 47 && total.betsPct === 41);
check("total scalar timestamps mirror displayed Under row", total.moneyPctObservedAt === "2026-06-27T16:27:32.238Z" && total.betsPctObservedAt === "2026-06-27T16:27:32.238Z");
check("moneyline publicSplits replaced by resolved display values", moneyline.publicSplits[1]?.moneyPct === 56 && moneyline.publicSplits[1]?.betsPct === 55);
check("moneyline picked-side scalar mirrors displayed WSH row", moneyline.moneyPct === 56 && moneyline.betsPct === 55);
check("moneyline Market Read consensus mirrors final resolved bars", moneyline.marketReadV2?.consensus?.moneyPct === 0.56 && moneyline.marketReadV2?.consensus?.betsPct === 0.55);
check("moneyline Market Read consensus summary mirrors final resolved bars", moneyline.marketReadV2?.sourceSummary.playbookConsensus === "Consensus: 56% money / 55% bets across 11 books.");
check("moneyline qualitative consensus copy follows the resolved side", moneyline.marketReadV2?.explanation === "Consensus leans our way, but the line has not confirmed the move.");
check("consensus overlay never changes the pick", moneyline.pick === "WSH");

const sourceAwareOnly = game();
sourceAwareOnly.markets.moneyline!.publicSplits = [
  { side: "home", label: "BAL", moneyPct: 58, betsPct: 54, observedAt: "2026-06-27T17:00:00.000Z" },
  { side: "away", label: "WSH", moneyPct: 42, betsPct: 46, observedAt: "2026-06-27T17:00:00.000Z" },
];
alignMarketReadsToDisplayedPublicSplits([sourceAwareOnly]);
const sourceAwareMl = sourceAwareOnly.markets.moneyline!;
check("final coherence pass aligns Market Read with already-overlaid bars", sourceAwareMl.marketReadV2?.consensus?.moneyPct === 0.42 && sourceAwareMl.marketReadV2?.consensus?.betsPct === 0.46);
check("final coherence pass preserves the existing book count when display rows omit it", sourceAwareMl.marketReadV2?.consensus?.booksUsed === 8);
check("final coherence pass updates qualitative copy for opposing consensus", sourceAwareMl.marketReadV2?.explanation === "The model edge is clear, but betting consensus is not fully aligned.");
check("final coherence pass never changes the pick", sourceAwareMl.pick === "WSH");

const expandedReaderAuthority = game();
expandedReaderAuthority.markets.moneyline!.publicSplits = [
  { side: "home", label: "BAL", moneyPct: 35, betsPct: 39, observedAt: "2026-06-27T16:00:00.000Z", isStale: true },
  { side: "away", label: "WSH", moneyPct: 65, betsPct: 61, observedAt: "2026-06-27T16:00:00.000Z", isStale: true },
];
expandedReaderAuthority.markets.moneyline!.recommendationDecision = {
  consensusSplits: {
    label: "Consensus Splits",
    rows: [
      { side: "home", label: "BAL", moneyPct: 37, betsPct: 41, observedAt: "2026-06-27T17:00:00.000Z" },
      { side: "away", label: "WSH", moneyPct: 63, betsPct: 59, observedAt: "2026-06-27T17:00:00.000Z" },
    ],
    signal: null,
    lastUpdated: "2026-06-27T17:00:00.000Z",
  },
} as NonNullable<typeof expandedReaderAuthority.markets.moneyline>["recommendationDecision"];
alignMarketReadsToDisplayedPublicSplits([expandedReaderAuthority]);
const expandedMl = expandedReaderAuthority.markets.moneyline!;
check("canonical recommendation consensus replaces stale collapsed bars", expandedMl.publicSplits[1]?.moneyPct === 63 && expandedMl.publicSplits[1]?.betsPct === 59);
check("Market Read follows canonical recommendation consensus", expandedMl.marketReadV2?.consensus?.moneyPct === 0.63 && expandedMl.marketReadV2?.consensus?.betsPct === 0.59);
check("canonical consensus alignment leaves the pick unchanged", expandedMl.pick === "WSH");

const agingSnapshot = game();
agingSnapshot.markets.moneyline!.publicSplits = [
  { side: "home", label: "BAL", moneyPct: 45, betsPct: 44, observedAt: "2026-07-28T16:20:00.000Z", isStale: false },
  { side: "away", label: "WSH", moneyPct: 55, betsPct: 56, observedAt: "2026-07-28T16:20:00.000Z", isStale: false },
];
agingSnapshot.markets.moneyline!.recommendationDecision = {
  consensusSplits: {
    label: "Consensus Splits",
    rows: [
      { side: "home", label: "BAL", moneyPct: 45, betsPct: 44, observedAt: "2026-07-28T16:20:00.000Z", isStale: false },
      { side: "away", label: "WSH", moneyPct: 55, betsPct: 56, observedAt: "2026-07-28T16:20:00.000Z", isStale: false },
    ],
    signal: null,
    lastUpdated: "2026-07-28T16:20:00.000Z",
  },
  sharpBookSplits: {
    label: "Sharp Book Splits",
    rows: [
      { side: "home", label: "BAL", moneyPct: 40, betsPct: 42, observedAt: "2026-07-28T16:10:00.000Z", isStale: false },
      { side: "away", label: "WSH", moneyPct: 60, betsPct: 58, observedAt: "2026-07-28T16:10:00.000Z", isStale: false },
    ],
    signal: null,
    lastUpdated: "2026-07-28T16:10:00.000Z",
  },
} as NonNullable<typeof agingSnapshot.markets.moneyline>["recommendationDecision"];
refreshDisplayedSplitFreshness(
  [agingSnapshot],
  new Date("2026-07-28T16:40:00.000Z"),
);
const agedMl = agingSnapshot.markets.moneyline!;
check("cached collapsed split rows become stale after the observation TTL", agedMl.publicSplits.every((row) => row.isStale === true));
check("cached canonical consensus rows become stale after the observation TTL", agedMl.recommendationDecision?.consensusSplits?.rows.every((row) => row.isStale === true) === true);
check("cached sharp-book rows become stale after the observation TTL", agedMl.recommendationDecision?.sharpBookSplits?.rows.every((row) => row.isStale === true) === true);
check("read-time freshness repair never changes the pick", agedMl.pick === "WSH");

if (fail > 0) {
  console.error(`public splits display overlay tests: ${pass} passed, ${fail} failed`);
  process.exit(1);
}

console.log(`public splits display overlay tests: ${pass} passed, ${fail} failed`);
