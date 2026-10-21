import assert from "node:assert/strict";
import { selectNbaCurrentLineBoard } from "../lib/services/nba/nbaCurrentLineBoard";

type Row = {
  id: number;
  market_type: string;
  sportsbook: string;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  fetched_at: string | null;
};

const rows: Row[] = [
  { id: 1, market_type: "moneyline", sportsbook: "old_book", side: "home", line_value: null, odds_american: 190, fetched_at: "2026-10-17T12:00:00Z" },
  { id: 2, market_type: "moneyline", sportsbook: "active_book", side: "home", line_value: null, odds_american: 120, fetched_at: "2026-10-21T12:00:00Z" },
  { id: 3, market_type: "moneyline", sportsbook: "active_book", side: "away", line_value: null, odds_american: -130, fetched_at: "2026-10-21T12:00:00Z" },
  { id: 4, market_type: "spread", sportsbook: "active_book", side: "home", line_value: -1.5, odds_american: 115, fetched_at: "2026-10-21T11:00:00Z" },
  { id: 5, market_type: "spread", sportsbook: "active_book", side: "home", line_value: -2.5, odds_american: -105, fetched_at: "2026-10-21T12:00:00Z" },
  { id: 6, market_type: "spread", sportsbook: "active_book", side: "away", line_value: 2.5, odds_american: -105, fetched_at: "2026-10-21T12:00:00Z" },
];

const current = selectNbaCurrentLineBoard(rows);
assert.deepEqual(
  current.map((row) => row.id).sort((left, right) => left - right),
  [2, 3, 5, 6],
  "current NBA line board must remove abandoned books and superseded same-book quotes",
);

const uniformlyOlder = selectNbaCurrentLineBoard([
  { ...rows[1]!, id: 7, fetched_at: "2026-10-17T12:00:00Z" },
  { ...rows[2]!, id: 8, fetched_at: "2026-10-17T12:00:00Z" },
]);
assert.deepEqual(
  uniformlyOlder.map((row) => row.id),
  [7, 8],
  "relative freshness must retain a coherent far-future board collected in one older cycle",
);

const independentlyTimedMarkets = selectNbaCurrentLineBoard([
  { ...rows[1]!, id: 9, market_type: "moneyline", fetched_at: "2026-10-21T08:00:00Z" },
  { ...rows[2]!, id: 10, market_type: "moneyline", fetched_at: "2026-10-21T08:00:00Z" },
  { ...rows[4]!, id: 11, market_type: "spread", fetched_at: "2026-10-21T12:00:00Z" },
  { ...rows[5]!, id: 12, market_type: "spread", fetched_at: "2026-10-21T12:00:00Z" },
]);
assert.deepEqual(
  independentlyTimedMarkets.map((row) => row.id),
  [9, 10, 11, 12],
  "a fresh spread cycle must not erase a coherent moneyline board collected on another cadence",
);

assert.throws(
  () => selectNbaCurrentLineBoard(rows, -1),
  /freshness must be non-negative/,
  "invalid freshness policy must fail closed",
);

console.log("NBA current-line board tests passed");
