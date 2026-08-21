import {
  selectWnbaSameBookTrail,
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

const historyOnlySpread: WnbaPriceTrailRow[] = [
  { market_type: "spread", side: "away", sportsbook: "fanduel", line_value: -4.5, odds_american: -110, recorded_at: "2026-08-21T01:00:00Z" },
  { market_type: "spread", side: "home", sportsbook: "fanduel", line_value: 4.5, odds_american: -110, recorded_at: "2026-08-21T01:00:00Z" },
  { market_type: "spread", side: "away", sportsbook: "fanduel", line_value: -3.5, odds_american: -115, recorded_at: "2026-08-21T03:00:00Z" },
  { market_type: "spread", side: "home", sportsbook: "fanduel", line_value: 3.5, odds_american: -105, recorded_at: "2026-08-21T03:00:00Z" },
];
const pickedSpread = selectWnbaSameBookTrail([], historyOnlySpread, "spread", "away", -3.5, true);
const opposingSpread = selectWnbaSameBookTrail([], historyOnlySpread, "spread", "home", 3.5, true);
assert("history-only spread retains the picked side", pickedSpread?.rows.at(-1)?.odds_american === -115);
assert("history-only spread retains the opposing side", opposingSpread?.rows.at(-1)?.odds_american === -105);
assert("history-only spread labels both terminals as persisted history", pickedSpread?.terminalSource === "line_history" && opposingSpread?.terminalSource === "line_history");

const oneCapturePerSide: WnbaPriceTrailRow[] = historyOnlySpread.slice(-2);
const onePicked = selectWnbaSameBookTrail([], oneCapturePerSide, "spread", "away", -3.5);
const oneOpposing = selectWnbaSameBookTrail([], oneCapturePerSide, "spread", "home", 3.5);
assert("one captured quote still retains picked-side current context", onePicked?.rows.length === 1);
assert("one captured quote still retains opposing-side current context", oneOpposing?.rows.length === 1);

console.log("WNBA price trail consensus and history fallback: 8/8 pass");
