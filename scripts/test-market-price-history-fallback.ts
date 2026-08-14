import {
  mergeCanonicalPriceHistoryForDisplay,
  type CanonicalPriceObservationRow,
  type DisplayLineHistoryRow,
} from "../lib/services/dailyEdge/marketPriceHistoryFallback";

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label}`);
  }
}

const legacy = new Map<string, DisplayLineHistoryRow[]>([
  [
    "1::moneyline::home",
    [
      { game_id: 1, market_type: "moneyline", sportsbook: "BookA", side: "home", odds_american: -120, line_value: null, recorded_at: "2026-08-14T10:00:00Z", id: 1 },
      { game_id: 1, market_type: "moneyline", sportsbook: "BookA", side: "home", odds_american: -125, line_value: null, recorded_at: "2026-08-14T11:00:00Z", id: 2 },
    ],
  ],
]);

const observations: CanonicalPriceObservationRow[] = [
  { id: 101, canonical_event_id: "event-1", market_type: "moneyline", selection_key: "mlb:event-1:moneyline:home", sportsbook: "BookA", american_price: -130, line: null, provider_timestamp: "2026-08-14T12:00:00Z", fetched_at: "2026-08-14T12:00:01Z" },
  { id: 102, canonical_event_id: "event-1", market_type: "moneyline", selection_key: "mlb:event-1:moneyline:away", sportsbook: "BookA", american_price: 110, line: null, provider_timestamp: "2026-08-14T10:00:00Z", fetched_at: "2026-08-14T10:00:01Z" },
  { id: 103, canonical_event_id: "event-1", market_type: "moneyline", selection_key: "mlb:event-1:moneyline:away", sportsbook: "BookA", american_price: 115, line: null, provider_timestamp: "2026-08-14T12:00:00Z", fetched_at: "2026-08-14T12:00:01Z" },
  { id: 104, canonical_event_id: "event-1", market_type: "total", selection_key: "mlb:event-1:total:over", sportsbook: "BookA", american_price: -105, line: 8.5, provider_timestamp: null, fetched_at: "2026-08-14T12:00:00Z" },
  { id: 105, canonical_event_id: "event-1", market_type: "total", selection_key: "mlb:event-1:total:under", sportsbook: "Blocked", american_price: -115, line: 8.5, provider_timestamp: "2026-08-14T12:00:00Z", fetched_at: "2026-08-14T12:00:01Z" },
  { id: 106, canonical_event_id: "event-1", market_type: "moneyline", selection_key: "malformed", sportsbook: "BookA", american_price: -110, line: null, provider_timestamp: "2026-08-14T12:00:00Z", fetched_at: "2026-08-14T12:00:01Z" },
];

const merged = mergeCanonicalPriceHistoryForDisplay({
  legacy,
  eventToGameId: new Map([["event-1", 1]]),
  observations,
  blockedSportsbook: (book) => book === "Blocked",
});

check("complete legacy same-book trails remain authoritative", merged.get("1::moneyline::home")?.length === 2);
check("missing opposite-side history is recovered from canonical observations", merged.get("1::moneyline::away")?.length === 2);
check("a single genuine observation remains a single observation (nothing fabricated)", merged.get("1::total::over")?.length === 1);
check("blocked sportsbooks are excluded", !merged.has("1::total::under"));
check("malformed selection keys are ignored", Array.from(merged.keys()).every((key) => !key.endsWith("::malformed")));

if (failures > 0) process.exit(1);
console.log("market-price-history fallback tests passed");
