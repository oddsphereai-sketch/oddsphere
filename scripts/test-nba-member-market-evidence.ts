import assert from "node:assert/strict";
import type { NbaDailyEdgeGameDto } from "../lib/services/nba/buildNbaDailyEdgeDto";
import {
  buildNbaMemberGameEvidence,
} from "../lib/services/nba/nbaMemberMarketEvidence";
import type {
  NbaReaderPriceRow,
  NbaReaderSplitRow,
} from "../lib/services/nba/nbaProfessionalMarketReader";

const evaluatedAt = "2026-10-16T18:00:00Z";

function intel(
  market: "moneyline" | "spread" | "total",
  side: "home" | "away" | "over" | "under",
  line: number | null,
  price: number,
  sportsbook: string,
) {
  return {
    market,
    pick_side: side,
    consensus_line: line,
    current_price: {
      odds_american: price,
      sportsbook,
      fetched_at: "2026-10-16T17:55:00Z",
    },
  };
}

const game = {
  game_external_id: 401909089,
  home_abbr: "NY",
  away_abbr: "PHI",
  intelligence: {
    ml: intel("moneyline", "home", null, -184, "sx_bet"),
    spread: intel("spread", "away", 5.5, -108, "fanduel"),
    total: intel("total", "under", 231.5, -110, "thescorebet"),
  },
} as unknown as NbaDailyEdgeGameDto;

function price(
  market: "moneyline" | "spread" | "total",
  side: "home" | "away" | "over" | "under",
  sportsbook: string,
  americanPrice: number,
  line: number | null,
  at: string,
): NbaReaderPriceRow {
  return {
    market,
    sportsbook,
    sharpBook: sportsbook === "pinnacle",
    selectionKey: `401909089:${market}:${side}`,
    americanPrice,
    line,
    providerTimestamp: at,
    fetchedAt: at,
  };
}

const priceRows: NbaReaderPriceRow[] = [
  price("spread", "away", "fanduel", -105, 5.5, "2026-10-16T13:00:00Z"),
  price("spread", "home", "fanduel", -115, -5.5, "2026-10-16T13:00:00Z"),
  price("spread", "away", "fanduel", -108, 5.5, "2026-10-16T15:00:00Z"),
  price("spread", "home", "fanduel", -112, -5.5, "2026-10-16T15:00:00Z"),
  price("spread", "away", "fanduel", -108, 5.5, "2026-10-16T17:55:00Z"),
  price("spread", "home", "fanduel", -112, -5.5, "2026-10-16T17:55:00Z"),
];

function split(
  market: "moneyline" | "spread" | "total",
  side: "home" | "away" | "over" | "under",
  betsPct: number,
  moneyPct: number,
): NbaReaderSplitRow {
  return {
    provider: "playbook",
    sourceBook: "consensus",
    sourceType: "multi_book_consensus",
    market,
    selectionKey: `401909089:${market}:${side}`,
    betsPct,
    moneyPct,
    marketLine: market === "moneyline" ? null : market === "spread" ? (side === "home" ? -5.5 : 5.5) : 231.5,
    sourceObservedAt: null,
    fetchedAt: "2026-10-16T17:45:00Z",
  };
}

const splitRows: NbaReaderSplitRow[] = [
  split("moneyline", "home", 0.63, 0.70), split("moneyline", "away", 0.37, 0.30),
  split("spread", "home", 0.38, 0.35), split("spread", "away", 0.62, 0.65),
  split("total", "over", 0.42, 0.30), split("total", "under", 0.58, 0.70),
];

const evidence = buildNbaMemberGameEvidence({ game, priceRows, splitRows, evaluatedAt });

assert.deepEqual(
  evidence.spread.publicSplits.map((row) => [row.side, row.betsPct, row.moneyPct]),
  [["home", 38, 35], ["away", 62, 65]],
  "verified Playbook consensus should preserve both sides and normalize percentages",
);
assert.deepEqual(
  evidence.spread.oddsTrail.map((stop) => [stop.label, stop.american, stop.line]),
  [["first", -105, 5.5], ["move", -108, 5.5], ["current", -108, 5.5]],
  "picked-side history should retain first, changed, and current observations at one book",
);
assert.deepEqual(
  evidence.spread.opposingOddsTrail?.stops.map((stop) => [stop.label, stop.american, stop.line]),
  [["first", -115, -5.5], ["move", -112, -5.5], ["current", -112, -5.5]],
  "the opposing side must use the same sportsbook chronology",
);
assert.equal(evidence.spread.movementReferenceSportsbook, "fanduel");
assert.equal(evidence.spread.lineTrail, evidence.spread.oddsTrail);
assert.deepEqual(
  evidence.moneyline.oddsTrail.map((stop) => stop.label),
  ["current"],
  "a current-only quote may render but must not fabricate an opening or move",
);

const sharpCurrentOnly = [
  price("spread", "away", "circa", -107, 5.5, "2026-10-16T17:56:00Z"),
  price("spread", "home", "circa", -113, -5.5, "2026-10-16T17:56:00Z"),
];
const retailDepthWins = buildNbaMemberGameEvidence({
  game,
  priceRows: [...priceRows, ...sharpCurrentOnly],
  splitRows,
  evaluatedAt,
});
assert.equal(
  retailDepthWins.spread.movementReferenceSportsbook,
  "fanduel",
  "a complete three-point retail chronology must beat a current-only sharp quote",
);
assert.equal(new Set(retailDepthWins.spread.oddsTrail.map((stop) => stop.sportsbook)).size, 1);

const circaTrailRows = [
  price("spread", "away", "circa", -104, 5.5, "2026-10-16T13:05:00Z"),
  price("spread", "home", "circa", -116, -5.5, "2026-10-16T13:05:00Z"),
  price("spread", "away", "circa", -106, 5.5, "2026-10-16T15:05:00Z"),
  price("spread", "home", "circa", -114, -5.5, "2026-10-16T15:05:00Z"),
  ...sharpCurrentOnly,
];
const circaDepthWins = buildNbaMemberGameEvidence({
  game,
  priceRows: [...priceRows, ...circaTrailRows],
  splitRows,
  evaluatedAt,
});
assert.equal(
  circaDepthWins.spread.movementReferenceSportsbook,
  "circa",
  "Circa must win when it has the same complete three-point depth",
);
assert.equal(new Set(circaDepthWins.spread.oddsTrail.map((stop) => stop.sportsbook)).size, 1);
assert.equal(new Set(circaDepthWins.spread.opposingOddsTrail?.stops.map((stop) => stop.sportsbook)).size, 1);

const stale = buildNbaMemberGameEvidence({
  game,
  priceRows,
  splitRows,
  evaluatedAt: "2026-10-16T20:00:01Z",
});
assert.equal(stale.spread.publicSplits.length, 2, "the last complete public pair should remain visible during a collector gap");
assert.equal(stale.spread.publicSplits.every((row) => row.isStale === true), true, "retained public rows must be marked stale");

function sharpSplit(args: {
  book: "circa" | "draftkings" | "betmgm";
  side: "home" | "away";
  betsPct: number | null;
  moneyPct: number | null;
  at: string;
}): NbaReaderSplitRow {
  return {
    provider: "sharpapi",
    sourceBook: args.book,
    sourceType: args.book === "circa" ? "sharp_adjacent_book" : "retail_book",
    market: "moneyline",
    selectionKey: `401909089:moneyline:${args.side}`,
    betsPct: args.betsPct,
    moneyPct: args.moneyPct,
    marketLine: null,
    sourceObservedAt: args.at,
    fetchedAt: args.at,
  };
}

const fallbackRows: NbaReaderSplitRow[] = [
  ...splitRows,
  sharpSplit({ book: "draftkings", side: "home", betsPct: 0.48, moneyPct: 0.57, at: "2026-10-16T17:50:00Z" }),
  sharpSplit({ book: "draftkings", side: "away", betsPct: 0.52, moneyPct: 0.43, at: "2026-10-16T17:50:00Z" }),
  sharpSplit({ book: "betmgm", side: "home", betsPct: 0.51, moneyPct: null, at: "2026-10-16T17:52:00Z" }),
  sharpSplit({ book: "betmgm", side: "away", betsPct: 0.49, moneyPct: null, at: "2026-10-16T17:52:00Z" }),
];
const fallbackEvidence = buildNbaMemberGameEvidence({ game, priceRows, splitRows: fallbackRows, evaluatedAt });
assert.equal(fallbackEvidence.moneyline.sportsbookSplits?.sourceBook, "draftkings", "the newest complete approved fallback should fill for absent Circa");
assert.equal(fallbackEvidence.moneyline.sportsbookSplits?.label, "Sharp Book Splits", "fallback provenance must stay internal to one stable member label");
assert.deepEqual(
  fallbackEvidence.moneyline.sportsbookSplits?.rows.map((row) => [row.side, row.betsPct, row.moneyPct]),
  [["home", 48, 57], ["away", 52, 43]],
  "a partial source must never be mixed into a different book's complete pair",
);

const withCirca = [
  ...fallbackRows,
  sharpSplit({ book: "circa", side: "home", betsPct: 0.44, moneyPct: 0.63, at: "2026-10-16T17:53:00Z" }),
  sharpSplit({ book: "circa", side: "away", betsPct: 0.56, moneyPct: 0.37, at: "2026-10-16T17:53:00Z" }),
];
const circaEvidence = buildNbaMemberGameEvidence({ game, priceRows, splitRows: withCirca, evaluatedAt });
assert.equal(circaEvidence.moneyline.sportsbookSplits?.sourceBook, "circa", "a complete current Circa pair must silently reclaim priority");
assert.equal(circaEvidence.moneyline.sharpBookAvailability.status, "complete");

const staleCircaWithFreshFallback = [
  ...splitRows,
  sharpSplit({ book: "circa", side: "home", betsPct: 0.44, moneyPct: 0.63, at: "2026-10-16T14:00:00Z" }),
  sharpSplit({ book: "circa", side: "away", betsPct: 0.56, moneyPct: 0.37, at: "2026-10-16T14:00:00Z" }),
  sharpSplit({ book: "draftkings", side: "home", betsPct: 0.48, moneyPct: 0.57, at: "2026-10-16T17:50:00Z" }),
  sharpSplit({ book: "draftkings", side: "away", betsPct: 0.52, moneyPct: 0.43, at: "2026-10-16T17:50:00Z" }),
];
const staleFallbackEvidence = buildNbaMemberGameEvidence({ game, priceRows, splitRows: staleCircaWithFreshFallback, evaluatedAt });
assert.equal(staleFallbackEvidence.moneyline.sportsbookSplits?.sourceBook, "draftkings", "a fresher complete fallback should replace stale Circa until Circa resumes");

console.log("NBA member market evidence tests passed");
