/** Private, resumable historical player-appearance capture; never publishes predictions. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CbbBallDontLieClient } from "../../lib/cbb/ballDontLie";
import { cbbPlayedMinutes } from "../../lib/cbb/rosterContext";
import type { CbbGame, CbbPlayerGame } from "../../lib/cbb/types";

const args = process.argv.slice(2);
if (args.some(arg => /^(--write|--publish|--activate)/.test(arg))) throw new Error("private capture only");
const value = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const season = Number(value("season"));
if (![2023, 2024, 2025].includes(season)) throw new Error("choose one historical CBB season");
const directory = resolve(value("out") ?? "/private/tmp/oddsphere-cbb-data");
const client = new CbbBallDontLieClient(process.env.BALLDONTLIE_API_KEY ?? "", { maxRequests: 5000 });
const read = async <T>(file: string): Promise<T> => JSON.parse(await readFile(resolve(directory, file), "utf8"));

async function main() {
  const games = (await read<{ data: CbbGame[] }>(`games-${season}.json`)).data
    .filter(game => game.status_state === "final" && game.home_team.conference_id && game.visitor_team.conference_id)
    .sort((a, b) => a.id - b.id);
  if (!games.length || games.some(game => game.season !== season)) throw new Error("missing or mixed CBB game archive");
  const gameIds = new Set(games.map(game => game.id));
  const chunks: number[][] = [];
  for (let i = 0; i < games.length; i += 10) chunks.push(games.slice(i, i + 10).map(game => game.id));
  const batchDir = resolve(directory, `player-games-${season}-batches`);
  await mkdir(batchDir, { recursive: true });
  const rows: CbbPlayerGame[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const file = resolve(batchDir, `${String(i).padStart(4, "0")}.json`);
    let body: { gameIds: number[]; fetchedAt: string; data: CbbPlayerGame[] };
    try {
      body = JSON.parse(await readFile(file, "utf8"));
      if (JSON.stringify(body.gameIds) !== JSON.stringify(chunks[i]) ||
        !Number.isFinite(Date.parse(body.fetchedAt)) || !Array.isArray(body.data) ||
        body.data.some(row => !chunks[i].includes(row.game.id) || row.game.season !== season)) {
        throw new Error("invalid historical CBB player batch");
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      const data = await client.playerGames(chunks[i], season);
      body = { gameIds: chunks[i], fetchedAt: new Date().toISOString(), data };
      await writeFile(file, JSON.stringify(body), { flag: "wx" });
    }
    rows.push(...body.data);
    if ((i + 1) % 50 === 0) console.log(JSON.stringify({ season, batches: i + 1, totalBatches: chunks.length, paidRequests: client.calls }));
  }
  const played = new Map<string, Set<number>>();
  for (const row of rows) if (cbbPlayedMinutes(row.min) > 0) {
    const key = `${row.game.id}:${row.team.id}`;
    const ids = played.get(key) ?? new Set<number>(); ids.add(row.player.id); played.set(key, ids);
  }
  const observed = new Set(games.filter(game => (played.get(`${game.id}:${game.home_team.id}`)?.size ?? 0) >= 5 &&
    (played.get(`${game.id}:${game.visitor_team.id}`)?.size ?? 0) >= 5).map(game => game.id));
  const missingGames = [...gameIds].filter(id => !observed.has(id));
  const duplicate = new Set<string>();
  for (const row of rows) {
    const id = `${row.game.id}:${row.team.id}:${row.player.id}`;
    if (duplicate.has(id)) throw new Error("duplicate historical CBB player appearance");
    duplicate.add(id);
  }
  const payload = { capturedAt: new Date().toISOString(), season, source: "balldontlie_player_stats",
    eventTimeRule: "Use only player appearances in games ending at least six hours before forecast as-of; never use target or later games",
    games: games.length, observedGames: observed.size, missingGames, coverageStatus: missingGames.length ? "partial" : "complete",
    rows: rows.length, paidRequests: client.calls,
    sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"), data: rows };
  if (missingGames.length) {
    await writeFile(resolve(directory, `player-games-${season}-coverage-gaps.json`), JSON.stringify({
      season, missingGames, source: payload.source, observedGames: observed.size, expectedGames: games.length,
      requiresExplicitCensoring: true,
    }, null, 2));
  }
  await writeFile(resolve(directory, `player-games-${season}.json`), JSON.stringify(payload));
  console.log(JSON.stringify({ season, games: payload.games, observedGames: payload.observedGames,
    missingGames: missingGames.length, rows: rows.length, paidRequests: client.calls }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "CBB player history capture failed"); process.exitCode = 1; });
