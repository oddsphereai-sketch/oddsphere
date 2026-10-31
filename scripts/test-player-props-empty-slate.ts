import assert from "node:assert/strict";

// No network or production credentials: the only allowed operations are reads.
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test";

async function main() {
  const { supabase } = await import("../lib/db/supabase");
  const { GET } = await import("../app/api/lab/player-props/route");
  const originalFrom = supabase.from;
  const historicalDate = "2026-10-28";
  const historicalProp = {
    id: 91, game_id: 41, player_id: 7, prop_market: "batter_hits", prop_line: 1.5,
    model_probability: 0.62, edge_pct: 8, confidence_score: 70, tier: "good",
    best_odds_american: 110, computed_at: `${historicalDate}T18:00:00Z`, signals: [],
    player: { full_name: "Historical Player", position_abbr: "OF", team_id: 1 },
  };
  const originalPayload = JSON.stringify(historicalProp);
  const queries: Array<{ table: string; filters: Map<string, unknown> }> = [];
  supabase.from = ((table: string) => {
    const query = { table, filters: new Map<string, unknown>() };
    queries.push(query);
    let selection = "";
    const builder = {
      select(value: string) { selection = value; return builder; },
      eq(key: string, value: unknown) { query.filters.set(key, value); return builder; },
      neq() { return builder; },
      in() { return builder; },
      order() { return builder; },
      then(resolve: (value: unknown) => unknown) {
        let data: unknown[] = [];
        if (table === "games") {
          // An unscoped latest-slate query would return the old game.
          const date = query.filters.get("slate_date");
          if (!date || date === historicalDate) data = [{
            id: 41, slate_date: historicalDate, game_date: `${historicalDate}T23:00:00Z`,
            home_team: { id: 1, abbreviation: "HOM" }, away_team: { id: 2, abbreviation: "AWY" },
          }];
        } else if (table === "prop_predictions" && selection.includes("prop_line")) {
          data = [historicalProp];
        } else if (table === "teams") {
          data = [{ id: 1, abbreviation: "HOM" }];
        }
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return builder;
  }) as unknown as typeof supabase.from;
  try {
    const empty = await GET(new Request("https://example.test/api/lab/player-props?sport=mlb&date=2026-10-31"));
    const emptyBody = await empty.json();
    assert.equal(empty.status, 200);
    assert.equal(emptyBody.date, "2026-10-31");
    assert.equal(emptyBody.fallback_used, false);
    assert.deepEqual(emptyBody.entries, []);
    assert.equal(queries.length, 1, "empty slate must not query a historical board");
    assert.equal(queries[0].filters.get("slate_date"), "2026-10-31");

    const historical = await GET(new Request(`https://example.test/api/lab/player-props?sport=mlb&date=${historicalDate}`));
    const historicalBody = await historical.json();
    assert.equal(historical.status, 200);
    assert.equal(historicalBody.date, historicalDate);
    assert.equal(historicalBody.fallback_used, false);
    assert.equal(historicalBody.entries.length, 1);
    assert.equal(historicalBody.entries[0].id, "91");
    assert.equal(historicalBody.entries[0].line, 1.5);
    assert.equal(historicalBody.entries[0].odds, "+110");
    assert.equal(JSON.stringify(historicalProp), originalPayload, "historical stored values remain unchanged");
    console.log("Player Props empty-slate and explicit historical-date regressions passed.");
  } finally {
    supabase.from = originalFrom;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
