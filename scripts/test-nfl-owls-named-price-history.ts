import assert from "node:assert/strict";
import {
  pairNflOwlsNamedPriceRows,
  type NflOwlsNamedPriceRow,
} from "../lib/services/football/nflOwlsNamedPriceHistory";
import { buildNflForwardContextMarket } from "../lib/services/football/nflForwardEvidenceCapture";
import { buildNflMarketState } from "../lib/services/football/nflMarketState";

const gameId = "nfl-exact-game-1";
let id = 1;
function row(args: {
  book: string; market: string; side: string; line: number | null;
  price: number; run: string; at: string;
}): NflOwlsNamedPriceRow {
  return {
    id: id++, canonical_event_id: gameId, provider: "owls", provider_event_id: `source-${gameId}`,
    ingestion_run_id: args.run, sportsbook: args.book, market_type: args.market,
    selection_key: `${gameId}:${args.market}:${args.side}`,
    line: args.line, american_price: args.price, provider_timestamp: args.at, fetched_at: args.at,
  };
}
function cycle(book: string, run: string, at: string, awayPrice: number, homePrice: number) {
  return [
    row({ book, market: "moneyline", side: "away", line: null, price: awayPrice, run, at }),
    row({ book, market: "moneyline", side: "home", line: null, price: homePrice, run, at }),
    row({ book, market: "spread", side: "away", line: 3, price: -110, run, at }),
    row({ book, market: "spread", side: "home", line: -3, price: -110, run, at }),
    row({ book, market: "total", side: "over", line: 44.5, price: -108, run, at }),
    row({ book, market: "total", side: "under", line: 44.5, price: -112, run, at }),
  ];
}
const early = "2026-10-31T12:00:00.000Z";
const late = "2026-10-31T13:00:00.000Z";
const valid = [
  ...cycle("circa", "run-early", early, 125, -145),
  ...cycle("pinnacle", "run-early", early, 128, -148),
  ...cycle("circa", "run-late", late, 105, -125),
  ...cycle("pinnacle", "run-late", late, 108, -128),
];
const paired = pairNflOwlsNamedPriceRows(valid, 2);
assert.equal(paired.queries, 2);
assert.equal(paired.rows, 24);
assert.equal(paired.rejectedPairs, 0);
assert.equal(paired.historyByGame[gameId]?.length, 2);
assert.equal(paired.earliestByGame[gameId]?.length, 2);
assert.equal(paired.latestByGame[gameId]?.length, 2);
assert.equal(paired.earliestByGame[gameId]?.find((book) => book.sportsbook === "circa")?.moneyline?.awayPrice, 125);
assert.equal(paired.latestByGame[gameId]?.find((book) => book.sportsbook === "circa")?.moneyline?.awayPrice, 105);
assert.ok(paired.latestByGame[gameId]?.every((book) => book.provider === "owls" && book.targetEligible === false));
const openingBook = paired.earliestByGame[gameId]!.find((book) => book.sportsbook === "circa")!;
const snapshots = paired.historyByGame[gameId]!.map((capture) => ({
  capturedAt: capture.capturedAt,
  markets: Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => [market,
    buildNflForwardContextMarket({
      market, capturedAt: capture.capturedAt, currentBooks: capture.books,
      openingBooks: paired.earliestByGame[gameId]!, operationalOpening: openingBook,
      decision: null, homeTeam: "HOME", publicEvidence: null, sharpEvidence: null,
    }),
  ])) as Record<"moneyline" | "spread" | "total", ReturnType<typeof buildNflForwardContextMarket>>,
}));
assert.ok(snapshots[1]?.markets.moneyline.families.every((family) => family[1] === "o"),
  "Owl's provenance must not be mislabeled SharpAPI in the compact market tape");
const state = buildNflMarketState({
  market: "moneyline", evaluatedAt: late, snapshots,
  current: { spread: { homeLine: -3 }, total: { line: 44.5 } },
  playbookLine: null, playbookSplits: null, sharpSplits: null,
});
assert.equal(state.trails.filter((trail) => trail.sourceClass === "named" && trail.direction !== null).length, 2,
  "the stored named-book chronology must produce interpreted directional evidence");

const badPair = [
  row({ book: "circa", market: "spread", side: "away", line: 3, price: -110, run: "bad", at: late }),
  row({ book: "circa", market: "spread", side: "home", line: -2.5, price: -110, run: "bad", at: late }),
];
const bad = pairNflOwlsNamedPriceRows([...valid, ...badPair]);
assert.equal(bad.rejectedPairs, 1, "a mismatched spread pair cannot become market evidence");
assert.equal(bad.latestByGame[gameId]?.find((book) => book.sportsbook === "circa")?.spread?.homeLine, -3);

const crossRun = [
  row({ book: "circa", market: "moneyline", side: "away", line: null, price: 100, run: "run-a", at: late }),
  row({ book: "circa", market: "moneyline", side: "home", line: null, price: -120, run: "run-b", at: late }),
];
assert.equal(pairNflOwlsNamedPriceRows(crossRun).rejectedPairs, 2,
  "sides from different receipts cannot be stitched into a fabricated market");

console.log("NFL Owl's named-price exact pairing and chronology tests passed.");
