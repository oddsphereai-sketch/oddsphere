/**
 * Rebuild the immutable NBA professional point-in-time feature ledger from
 * the compact checked-in bootstrap. Research-only: no provider or DB calls.
 *
 * Usage:
 *   npx tsx scripts/operator/nba/materialize-nba-professional-research-features.ts \
 *     --output=/private/tmp/oddsphere-nba-research/features.jsonl
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildNbaPointInTimeFeatures,
  NBA_POINT_IN_TIME_FEATURE_RELEASE,
  type NbaHistoricalGame,
  type NbaHistoricalPlayerBox,
} from "../../../lib/services/nba/nbaPointInTimeFeatures";

type Bootstrap = {
  release: string;
  seasons: number[];
  games: NbaHistoricalGame[];
  boxes: NbaHistoricalPlayerBox[];
};

function outputPath(argv: string[]): string {
  const argument = argv.find((value) => value.startsWith("--output="));
  if (!argument) throw new Error("--output=<absolute-or-relative-jsonl-path> is required");
  return resolve(argument.slice("--output=".length));
}

function main(): void {
  const output = outputPath(process.argv.slice(2));
  const bootstrapPath = resolve(
    process.cwd(),
    "lib/automodel/nba/modelArtifacts/nbaProfessionalBootstrap.json",
  );
  const bootstrap = JSON.parse(readFileSync(bootstrapPath, "utf8")) as Bootstrap;
  if (bootstrap.games.length === 0 || bootstrap.boxes.length !== bootstrap.games.length * 2) {
    throw new Error("NBA professional bootstrap is incomplete");
  }
  const emitGameIds = new Set(bootstrap.games.map((game) => game.gameId));
  const rows = buildNbaPointInTimeFeatures({
    games: bootstrap.games,
    boxes: bootstrap.boxes,
    emitGameIds,
  });
  if (rows.length !== bootstrap.games.length) {
    throw new Error(`NBA feature materialization emitted ${rows.length}/${bootstrap.games.length} rows`);
  }
  if (rows.some((row) => row.release !== NBA_POINT_IN_TIME_FEATURE_RELEASE)) {
    throw new Error("NBA feature materialization mixed feature releases");
  }
  const body = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, body);
  console.log(JSON.stringify({
    mode: "offline_research_only",
    providerCalls: 0,
    databaseWrites: 0,
    output,
    rows: rows.length,
    seasons: bootstrap.seasons,
    featureRelease: NBA_POINT_IN_TIME_FEATURE_RELEASE,
    sha256: createHash("sha256").update(body).digest("hex"),
  }, null, 2));
}

main();
