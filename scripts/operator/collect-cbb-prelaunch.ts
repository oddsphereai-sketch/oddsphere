/** Local research capture only. Does not import database or production write services. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CbbBallDontLieClient } from "../../lib/cbb/ballDontLie";
import { matchCbbVenue, type EspnCbbEvent } from "../../lib/cbb/dataset";
import type { CbbGame, CbbVenue } from "../../lib/cbb/types";

const args = process.argv.slice(2);
if (args.some(arg => /^(--write|--publish|--activate)/.test(arg))) throw new Error("CBB prelaunch capture has no publication mode");
const flag = (name: string, fallback: string) => args.find(arg => arg.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;
const directory = resolve(flag("out", "/private/tmp/oddsphere-cbb-data"));
const seasons = flag("seasons", "2022,2023,2024,2025,2026").split(",").map(Number);
if (seasons.some(season => !Number.isInteger(season) || season < 2003 || season > 2026)) throw new Error("invalid CBB seasons");
const client = new CbbBallDontLieClient(process.env.BALLDONTLIE_API_KEY ?? "");
const manifest: Array<{ file: string; sha256: string; fetchedAt: string; rows: number }> = [];

async function cached<T>(name: string, load: () => Promise<T[]>): Promise<T[]> {
  const file = resolve(directory, name);
  let rows: T[], fetchedAt: string;
  try { const body = JSON.parse(await readFile(file, "utf8")); rows = body.data; fetchedAt = body.fetchedAt;
    if (!Array.isArray(rows) || !Number.isFinite(Date.parse(fetchedAt))) throw new Error("invalid cache");
  } catch {
    rows = await load(); fetchedAt = new Date().toISOString();
    await writeFile(file, JSON.stringify({ fetchedAt, data: rows }));
  }
  manifest.push({ file: name, fetchedAt, rows: rows.length, sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex") });
  console.log(`${name}: ${rows.length} rows; ${client.calls} paid requests this run`);
  return rows;
}

async function main() {
  await mkdir(directory, { recursive: true });
  await cached("teams.json", () => client.teams());
  if (args.includes("--identity")) await cached("espn-teams.json", async () => {
    const response = await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams?limit=500", {
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`ESPN CBB teams: HTTP ${response.status}`);
    const body = await response.json();
    const teams = body.sports?.[0]?.leagues?.[0]?.teams?.map((row: { team: unknown }) => row.team);
    if (!Array.isArray(teams) || teams.length < 300) throw new Error("ESPN CBB team catalog incomplete");
    return teams;
  });
  for (const season of seasons) {
    const games = await cached(`games-${season}.json`, () => client.games(season));
    if (season < 2026) {
      await cached(`boxes-${season}.json`, () => client.boxes(season));
      // Top-level row.team is the historical team; nested player.team is current and cannot be used as historical roster identity.
      if (season === 2025) await cached(`players-${season}.json`, () => client.playerSeasons(season));
    }
    if (args.includes("--venues")) await cached(`venues-${season}.json`, async () => {
      const byDate = new Map<string, CbbGame[]>();
      for (const game of games) {
        if (!game.home_team.conference_id || !game.visitor_team.conference_id) continue;
        if (season === 2026 && game.date.slice(0, 10) > "2026-11-08") continue;
        const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(game.date));
        byDate.set(date, [...(byDate.get(date) ?? []), game]);
      }
      const queue = [...byDate];
      const out: CbbVenue[] = [];
      let cursor = 0;
      const worker = async () => {
        while (cursor < queue.length) {
          const [date, dayGames] = queue[cursor++];
          const cacheName = resolve(directory, `espn-${date}.json`);
          let events: EspnCbbEvent[], fetchedAt: string;
          try { const cache = JSON.parse(await readFile(cacheName, "utf8")); events = cache.events; fetchedAt = cache.fetchedAt; }
          catch {
            const url = new URL("https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard");
            url.searchParams.set("dates", date.replaceAll("-", "")); url.searchParams.set("groups", "50"); url.searchParams.set("limit", "500");
            const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
            if (!response.ok) throw new Error(`ESPN ${date}: HTTP ${response.status}`);
            const body = await response.json(); events = body.events;
            if (!Array.isArray(events) || events.length >= 500) throw new Error(`ESPN ${date}: incomplete scoreboard`);
            fetchedAt = new Date().toISOString();
            await writeFile(cacheName, JSON.stringify({ fetchedAt, events }));
          }
          for (const game of dayGames) { const venue = matchCbbVenue(game, events, fetchedAt); if (venue) out.push(venue); }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      return out;
    });
  }
  if (seasons.includes(2026)) {
    await cached("active-players.json", () => client.activePlayers());
    const dates = ["2026-11-01", "2026-11-02"];
    for (const phase of ["opening", "current"] as const) await cached(`odds-${phase}.json`, () => client.odds(dates, phase));
  }
  await writeFile(resolve(directory, "capture-manifest.json"), JSON.stringify({
    capturedAt: new Date().toISOString(), productionWrites: 0, paidRequests: client.calls, manifest,
  }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "CBB capture failed"); process.exitCode = 1; });
