import assert from "node:assert/strict";
import {
  fetchBalldontlieNflSlateAvailability,
  NFL_INJURY_MAX_PAGES,
} from "../lib/services/football/balldontlieNflAvailability";

const calls: string[] = [];
const fetchImpl: typeof fetch = async (input) => {
  const url = new URL(String(input));
  calls.push(url.toString());
  const cursor = Number(url.searchParams.get("cursor") ?? "0");
  const page = cursor + 1;
  const hasNext = page < 5;
  const row = {
    player: {
      first_name: `Player${page}`,
      last_name: "Test",
      position_abbreviation: "WR",
      team: { abbreviation: page % 2 === 0 ? "BUF" : "DET", full_name: "Test Team" },
    },
    status: "Questionable",
    date: "2026-09-16T12:00:00.000Z",
  };
  return new Response(JSON.stringify({ data: [row], meta: { next_cursor: hasNext ? page : null } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

async function main(): Promise<void> {
  assert.equal(NFL_INJURY_MAX_PAGES, 8);
  const result = await fetchBalldontlieNflSlateAvailability([{
    id: "1392232",
    awayTeam: "DET",
    homeTeam: "BUF",
    awayTeamId: 8,
    homeTeamId: 4,
  }], { apiKey: "test", fetchImpl });

  assert.ok(result);
  assert.equal(calls.length, 5, "a valid fifth injury page must be consumed");
  assert.equal(result?.[0]?.eventId, "1392232");
  assert.deepEqual(result?.[0]?.teams.map((team) => team.abbreviation), ["DET", "BUF"]);
  assert.equal(result?.[0]?.teams.reduce((sum, team) => sum + team.players.length, 0), 5);

  console.log("BALLDONTLIE NFL availability pagination: five-page weekly slate retained within the eight-page safety cap.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
