import {
  wnbaObservedConsensusPrices,
  type WnbaPriceTrailRow,
} from "../lib/services/wnba/wnbaPriceTrail";

function assert(name: string, condition: boolean): void {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

const rows: WnbaPriceTrailRow[] = [
  {
    market_type: "moneyline",
    side: "away",
    line_value: null,
    odds_american: -1300,
    recorded_at: "2026-07-26T13:20:30.068Z",
  },
  {
    market_type: "moneyline",
    side: "away",
    line_value: null,
    odds_american: -320,
    recorded_at: "2026-07-26T13:20:30.068Z",
  },
  {
    market_type: "moneyline",
    side: "away",
    line_value: null,
    odds_american: -315,
    recorded_at: "2026-07-26T13:20:30.068Z",
  },
  {
    market_type: "moneyline",
    side: "away",
    line_value: null,
    odds_american: -350,
    recorded_at: "2026-07-28T20:20:30.068Z",
  },
  {
    market_type: "moneyline",
    side: "away",
    line_value: null,
    odds_american: -360,
    recorded_at: "2026-07-28T20:20:30.068Z",
  },
  {
    market_type: "moneyline",
    side: "away",
    line_value: null,
    odds_american: -355,
    recorded_at: "2026-07-28T20:20:30.068Z",
  },
];

const trail = wnbaObservedConsensusPrices(rows, "moneyline", "away", null);
assert("opening trail uses timestamp consensus instead of first provider", trail[0] === -320);
assert("latest trail uses latest timestamp consensus", trail[1] === -355);

const fallback = wnbaObservedConsensusPrices(
  rows.map((row) => ({
    market_type: row.market_type,
    side: row.side,
    line_value: row.line_value,
    odds_american: row.odds_american,
  })),
  "moneyline",
  "away",
  null,
);
assert("un-timestamped rows fall back to overall consensus", fallback[0] === -350);

console.log("WNBA price trail consensus: 3/3 pass");
