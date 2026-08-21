/**
 * Download one bulk NFL schedule/results/market file into the ignored local
 * football research cache. This script has no database or production writes.
 */

import { createHash } from "node:crypto";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const CACHE_RELEASE = "football_nflverse_games_cache_2026_08_19_r1" as const;
const SOURCE_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";

async function main() {
  const root = path.resolve(process.cwd(), "football-research/cache/nflverse");
  const workspace = path.resolve(process.cwd());
  if (!root.startsWith(`${workspace}${path.sep}`)) throw new Error("Research cache must stay inside the workspace.");
  const response = await fetch(SOURCE_URL, {
    headers: { Accept: "text/csv", "User-Agent": "OddSphere-local-football-research" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`nflverse games download failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const text = bytes.toString("utf8");
  const header = text.slice(0, text.indexOf("\n"));
  for (const required of ["game_id", "season", "game_type", "week", "away_team", "home_team", "away_score", "home_score", "spread_line", "total_line"]) {
    if (!header.split(",").includes(required)) throw new Error(`nflverse games file is missing ${required}`);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const filename = `games_${sha256.slice(0, 16)}.csv`;
  await mkdir(root, { recursive: true });
  const destination = path.join(root, filename);
  try {
    await stat(destination);
  } catch {
    const temporary = path.join(root, `.games-${process.pid}.tmp`);
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, destination);
  }
  const manifest = {
    cacheRelease: CACHE_RELEASE,
    source: "nflverse/nfldata",
    sourceUrl: SOURCE_URL,
    fetchedAt: new Date().toISOString(),
    sha256,
    bytes: bytes.length,
    dataRows: Math.max(0, text.trimEnd().split("\n").length - 1),
    filename,
    usage: "local_shadow_research_only",
  };
  await writeFile(path.join(root, "games.latest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
