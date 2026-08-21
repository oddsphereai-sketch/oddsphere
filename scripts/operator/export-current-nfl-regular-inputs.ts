import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchBalldontlieNflRegularSlate } from "../../lib/services/football/balldontlieNflPreviewSlate";
import { fetchBalldontlieNflSlateAvailability } from "../../lib/services/football/balldontlieNflAvailability";

const INPUT_RELEASE = "nfl_regular_current_provider_inputs_2026_08_19_r1" as const;
const ROSTER_CONCURRENCY = 4;

type RosterRow = {
  player?: { first_name?: unknown; last_name?: unknown; position_abbreviation?: unknown };
  position?: unknown;
  depth?: unknown;
  player_name?: unknown;
  injury_status?: unknown;
};

async function main() {
  const weekArg = process.argv.find((value) => value.startsWith("--week="));
  const week = Number(weekArg?.split("=")[1] ?? "1");
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required.");
  const slate = await fetchBalldontlieNflRegularSlate({ season: 2026, week, apiKey });
  const teams = [...new Map(slate.games.flatMap((game) => [game.away, game.home]).map((team) => [team.id, team])).values()];
  const rosters: Record<string, RosterRow[]> = {};
  let rosterRequests = 0;
  for (let index = 0; index < teams.length; index += ROSTER_CONCURRENCY) {
    const batch = teams.slice(index, index + ROSTER_CONCURRENCY);
    await Promise.all(batch.map(async (team) => {
      rosterRequests += 1;
      const url = new URL(`https://api.balldontlie.io/nfl/v1/teams/${team.id}/roster`);
      url.searchParams.set("season", "2026");
      const response = await fetch(url, {
        headers: { Authorization: apiKey, accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`BALLDONTLIE roster failed for ${team.abbreviation} with HTTP ${response.status}.`);
      const body = await response.json() as { data?: unknown };
      if (!Array.isArray(body.data)) throw new Error(`BALLDONTLIE roster was malformed for ${team.abbreviation}.`);
      rosters[team.abbreviation] = body.data.filter((row): row is RosterRow => row !== null && typeof row === "object");
    }));
  }
  const availabilityRows = await fetchBalldontlieNflSlateAvailability(
    slate.games.map((game) => ({
      id: `nfl-${game.providerGameId}`,
      awayTeam: game.away.abbreviation,
      homeTeam: game.home.abbreviation,
      awayTeamId: game.away.id,
      homeTeamId: game.home.id,
    })),
    { apiKey },
  );
  if (availabilityRows === null) throw new Error("BALLDONTLIE regular-season injury snapshot is unavailable.");
  const body = {
    inputRelease: INPUT_RELEASE,
    exportedAt: new Date().toISOString(),
    slate,
    rosters,
    availability: Object.fromEntries(availabilityRows.map((row) => [row.eventId, row])),
    requestBudget: {
      slateRequests: slate.providerRequests,
      rosterRequests,
      injuryRequestsMaximum: 4,
      rosterConcurrency: ROSTER_CONCURRENCY,
    },
  };
  const payload = `${JSON.stringify(body, null, 2)}\n`;
  const checksum = createHash("sha256").update(payload).digest("hex");
  const root = path.resolve(process.cwd(), "football-research/cache/nfl-model/current");
  await mkdir(root, { recursive: true });
  const filename = `nfl_regular_2026_week_${week}_${checksum.slice(0, 16)}.json`;
  await writeFile(path.join(root, filename), payload, "utf8");
  await writeFile(path.join(root, `nfl_regular_2026_week_${week}.latest.json`), `${JSON.stringify({
    inputRelease: INPUT_RELEASE,
    providerRelease: slate.release,
    exportedAt: body.exportedAt,
    season: slate.season,
    week,
    games: slate.games.length,
    teams: teams.length,
    requestBudget: body.requestBudget,
    filename,
    sha256: checksum,
  }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ week, games: slate.games.length, teams: teams.length, filename, sha256: checksum, requestBudget: body.requestBudget }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
