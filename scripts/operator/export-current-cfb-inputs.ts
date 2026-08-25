import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchBalldontlieNcaafSlate } from "../../lib/services/football/balldontlieNcaafSlate";
import { PlaybookClient } from "../../lib/providers/playbook/playbookClient";

function argument(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/^hawai i\b/, "hawaii")
    .replace(/^massachusetts\b/, "umass")
    .replace(/^ualbany\b/, "albany");
}

function playbookMatch(game: { away: { name: string }; home: { name: string }; scheduledStart: string }, row: Record<string, unknown>): boolean {
  const home = normalize(String(row.homeTeamName ?? row.homeTeam ?? ""));
  const away = normalize(String(row.awayTeamName ?? row.awayTeam ?? ""));
  const start = String(row.startTime ?? row.startTimeEst ?? "");
  return home === normalize(game.home.name) && away === normalize(game.away.name) &&
    Number.isFinite(Date.parse(start)) && Math.abs(Date.parse(start) - Date.parse(game.scheduledStart)) <= 3 * 60 * 60_000;
}

async function main() {
  const season = Number(argument("season", "2026"));
  const startDate = argument("start", "2026-08-25");
  const endDate = argument("end", "2026-09-08");
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  const playbookKey = process.env.PLAYBOOK_API_KEY;
  if (!apiKey || !playbookKey) throw new Error("BALLDONTLIE_API_KEY and PLAYBOOK_API_KEY are required.");
  const slate = await fetchBalldontlieNcaafSlate({ season, startDate, endDate, apiKey });
  const playbook = new PlaybookClient(playbookKey);
  const [lineResult, splitResult] = await Promise.all([playbook.lines("ncaaf"), playbook.splits("ncaaf")]);
  const lines = (lineResult.body.data ?? []) as unknown as Record<string, unknown>[];
  const splits = (splitResult.body.data ?? []) as unknown as Record<string, unknown>[];
  const candidateGames = slate.games.filter((game) =>
    (game.home.fbs || game.away.fbs) && (
      Boolean(slate.currentOddsByGame[game.providerGameId]) || lines.some((row) => playbookMatch(game, row))
    )
  );
  const payload = {
    release: "cfb_current_inputs_2026_08_25_r1",
    generatedAt: new Date().toISOString(),
    sourceRelease: slate.release,
    sourceRequests: slate.providerRequests + 2,
    season,
    startDate,
    endDate,
    games: candidateGames.map((game) => ({
      ...game,
      current: slate.currentOddsByGame[game.providerGameId],
      currentBooks: slate.currentOddsComparableBooksByGame[game.providerGameId],
      opening: slate.openingOddsByGame[game.providerGameId] ?? null,
      openingBooks: slate.openingOddsComparableBooksByGame[game.providerGameId],
      playbookLine: lines.find((row) => playbookMatch(game, row)) ?? null,
      playbookSplits: splits.find((row) => playbookMatch(game, row)) ?? null,
    })),
    coverage: {
      providerGames: slate.games.length,
      fbsMarketGames: candidateGames.length,
      currentNamedBooks: candidateGames.filter((game) => slate.currentOddsComparableBooksByGame[game.providerGameId]?.length > 0).length,
      opening: candidateGames.filter((game) => Boolean(slate.openingOddsByGame[game.providerGameId])).length,
      playbookLines: candidateGames.filter((game) => lines.some((row) => playbookMatch(game, row))).length,
      playbookSplits: candidateGames.filter((game) => splits.some((row) => playbookMatch(game, row))).length,
    },
  };
  const serialized = JSON.stringify(payload, null, 2) + "\n";
  const output = path.resolve(argument("output", "football-research/cache/cfb-model/current/cfb_current_inputs.json"));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, serialized, "utf8");
  console.log(JSON.stringify({ output, sha256: createHash("sha256").update(serialized).digest("hex"), coverage: payload.coverage, games: payload.games.map((game) => `${game.away.abbreviation}@${game.home.abbreviation}`) }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
