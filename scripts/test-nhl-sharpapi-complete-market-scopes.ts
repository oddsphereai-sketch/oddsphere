import assert from "node:assert/strict";
import { fetchSharpNhlEventOdds } from "../lib/providers/nhl/_sharpApiNhlClient";
import { requiresNhlPregameMarketCoverage } from "../lib/services/nhl/nhlPregameCoverage";

const originalFetch = globalThis.fetch;
const requestedMarkets: string[] = [];

function row(
  id: string,
  marketType: "moneyline" | "puck_line" | "total_goals",
  sportsbook: string,
) {
  return {
    id,
    event_id: "nhl-event-1",
    home_team: "Washington Capitals",
    away_team: "Pittsburgh Penguins",
    market_type: marketType,
    sportsbook,
    selection_type: marketType === "total_goals" ? "over" : "home",
    odds_american: -110,
  };
}

globalThis.fetch = async (input) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  assert.equal(url.pathname, "/api/v1/odds");
  assert.equal(url.searchParams.get("event_id"), "nhl-event-1");
  assert.equal(url.searchParams.get("limit"), "200");
  const market = url.searchParams.get("market_type");
  assert.ok(market, "every NHL event-odds request must use an exact full-game market scope");
  requestedMarkets.push(market);
  const data = market === "moneyline"
    ? [row("ml-circa", "moneyline", "circa"), row("ml-pinnacle", "moneyline", "pinnacle")]
    : market === "puck_line"
      ? [row("pl-circa", "puck_line", "circa")]
      : [row("total-circa", "total_goals", "circa"), row("shared-id", "total_goals", "pinnacle")];
  // The same provider id appearing in another scoped response must remain
  // deterministic instead of creating duplicate database candidates.
  if (market === "moneyline") data.push(row("shared-id", "moneyline", "ballybet"));
  return new Response(JSON.stringify({ data, pagination: { has_more: false, next_cursor: null } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

async function main(): Promise<void> {
  assert.equal(requiresNhlPregameMarketCoverage("scheduled", true), true);
  assert.equal(requiresNhlPregameMarketCoverage(null, true), true, "an unknown state fails closed to the pregame coverage gate");
  assert.equal(requiresNhlPregameMarketCoverage("LIVE", false), true, "a missing live lock still requires complete coverage");
  assert.equal(requiresNhlPregameMarketCoverage("LIVE", true), false);
  assert.equal(requiresNhlPregameMarketCoverage("IN_PROGRESS", true), false);
  assert.equal(requiresNhlPregameMarketCoverage("FINAL", true), false);
  assert.equal(requiresNhlPregameMarketCoverage("POSTPONED", true), false);
  try {
    const rows = await fetchSharpNhlEventOdds("nhl-event-1", "test-token");
    assert.deepEqual(
      [...requestedMarkets].sort(),
      ["moneyline", "puck_line", "total_goals"],
      "NHL collection must fetch exactly the three full-game market scopes",
    );
    assert.equal(requestedMarkets.length, 3, "no generic event page or prop pagination may be requested");
    assert.equal(rows.length, 5, "scoped market rows are combined and provider ids are deduplicated");
    assert.equal(rows.find((candidate) => candidate.id === "shared-id")?.market_type, "total_goals");
    assert.equal(rows.filter((candidate) => candidate.market_type === "moneyline").length, 2);
    assert.equal(rows.filter((candidate) => candidate.market_type === "puck_line").length, 1);
    assert.equal(rows.filter((candidate) => candidate.market_type === "total_goals").length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("NHL SharpAPI complete-market scope tests passed.");
}

void main();
