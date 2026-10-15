import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  __NBA_BDL_HISTORICAL_TEST__,
  fetchNbaBdlHistoricalRows,
  nbaBdlProviderGameId,
} from "../lib/services/nba/balldontlieNbaHistorical";

async function main(): Promise<void> {
  const urls: URL[] = [];
  const headers: Headers[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    urls.push(url);
    headers.push(new Headers(init?.headers));
    const page = url.searchParams.get("cursor");
    return new Response(JSON.stringify(page === null
      ? { data: [{ id: 1 }, { id: 2 }], meta: { next_cursor: 2 } }
      : { data: [{ id: 3 }], meta: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const result = await fetchNbaBdlHistoricalRows({
    dataset: "games",
    season: 2025,
    seasonType: "regular",
    apiKey: "test-key",
    fetchImpl,
    maxPages: 2,
  });
  assert.equal(result.complete, true);
  assert.equal(result.requests, 2);
  assert.deepEqual(result.rows.map((row) => row.id), [1, 2, 3]);
  assert.equal(urls[0]?.pathname, "/v1/games");
  assert.equal(urls[0]?.searchParams.get("seasons[]"), "2025");
  assert.equal(urls[0]?.searchParams.get("season_type"), "regular");
  assert.equal(urls[0]?.searchParams.get("per_page"), "100");
  assert.equal(urls[1]?.searchParams.get("cursor"), "2");
  assert.equal(headers[0]?.get("authorization"), "test-key");

  const truncated = await fetchNbaBdlHistoricalRows({
    dataset: "games",
    season: 2025,
    seasonType: "regular",
    apiKey: "test-key",
    fetchImpl,
    maxPages: 1,
  });
  assert.equal(truncated.complete, false);
  assert.equal(truncated.nextCursor, "2");

  const sleeps: number[] = [];
  let attempts = 0;
  const retried = await fetchNbaBdlHistoricalRows({
    dataset: "opening_odds",
    gameIds: [100, 101],
    apiKey: "test-key",
    maxRetries: 1,
    sleepImpl: async (milliseconds) => { sleeps.push(milliseconds); },
    fetchImpl: async (input) => {
      attempts += 1;
      const url = new URL(String(input));
      assert.deepEqual(url.searchParams.getAll("game_ids[]"), ["100", "101"]);
      if (attempts === 1) {
        return new Response("rate limited", { status: 429, headers: { "retry-after": "2" } });
      }
      return new Response(JSON.stringify({ data: [{ id: 8, game_id: 100 }], meta: {} }), { status: 200 });
    },
  });
  assert.equal(retried.requests, 2, "provider request accounting must include retries");
  assert.deepEqual(sleeps, [2_000]);

  await assert.rejects(
    () => fetchNbaBdlHistoricalRows({
      dataset: "opening_odds",
      apiKey: "test-key",
      fetchImpl,
    }),
    /requires exact dates or game IDs/,
  );
  assert.equal(nbaBdlProviderGameId({ id: 9, game: { id: 90 } }), 90);
  assert.equal(nbaBdlProviderGameId({ id: 9, game_id: 91 }), 91);
  assert.equal(nbaBdlProviderGameId({ id: 9 }), 9);

  const advancedUrl = __NBA_BDL_HISTORICAL_TEST__.buildUrl({
    dataset: "advanced",
    season: 2025,
    seasonType: "regular",
  });
  assert.equal(advancedUrl.pathname, "/nba/v2/stats/advanced");
  assert.equal(advancedUrl.searchParams.get("period"), "0");
  assert.equal(advancedUrl.searchParams.has("season_type"), false);

  const operatorSource = readFileSync(
    new URL("operator/nba/capture-nba-goat-historical-research.ts", import.meta.url),
    "utf8",
  );
  assert.match(operatorSource, /scoreBacktestEligible/);
  assert.match(operatorSource, /exactOpeningPriceBacktestEligible/);
  assert.match(operatorSource, /sample\s*\?\s*batches\.slice\(0,\s*1\)/);
  assert.match(operatorSource, /out_of_scope_rows/);

  console.log("NBA BALLDONTLIE historical research capture tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
