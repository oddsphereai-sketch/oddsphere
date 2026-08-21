import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  collectNflPlayerPropsObservations,
  NFL_PLAYER_PROPS_COLLECTION_LIMITS,
} from "../../lib/services/football/nflPlayerPropsCollector";
import type { NflPlayerPropPhase } from "../../lib/services/football/nflPlayerPropsContract";

async function main(): Promise<void> {
  const season = integerArg("season", 2026);
  const week = integerArg("week", 1);
  const phaseValue = stringArg("phase", "regular");
  if (phaseValue !== "preseason" && phaseValue !== "regular" && phaseValue !== "postseason") {
    throw new Error("--phase must be preseason, regular, or postseason.");
  }
  const phase = phaseValue as NflPlayerPropPhase;
  const includeOpenings = booleanArg("include-openings", false);
  const persist = booleanArg("persist", false);
  const result = await collectNflPlayerPropsObservations({ season, week, phase, includeOpenings });
  const summary = {
    mode: result.snapshot.mode,
    actionable: result.snapshot.actionable,
    persisted: persist,
    release: result.snapshot.snapshotRelease,
    identity: { season, week, phase },
    games: result.snapshot.games.length,
    observations: result.snapshot.observations.length,
    collectionComplete: result.snapshot.collectionComplete,
    modelingReady: result.snapshot.modelingReady,
    providerRequests: result.snapshot.providerRequests,
    providerCoverage: result.snapshot.providerCoverage,
    normalization: {
      balldontlie: withoutRows(result.normalization.balldontlie),
      balldontlieOpenings: withoutRows(result.normalization.balldontlieOpenings),
      sharpapi: withoutRows(result.normalization.sharpapi),
    },
    healthFindings: result.snapshot.healthFindings,
    limits: NFL_PLAYER_PROPS_COLLECTION_LIMITS,
  };
  if (persist) {
    const payload = `${JSON.stringify(result.snapshot, null, 2)}\n`;
    const sha256 = createHash("sha256").update(payload).digest("hex");
    const root = path.resolve(process.cwd(), "football-research/cache/nfl-player-props");
    await mkdir(root, { recursive: true });
    const stem = `nfl_props_${season}_${phase}_week_${week}`;
    const filename = `${stem}_${sha256.slice(0, 16)}.json`;
    await writeFile(path.join(root, filename), payload, "utf8");
    await writeFile(path.join(root, `${stem}.latest.json`), `${JSON.stringify({
      snapshotRelease: result.snapshot.snapshotRelease,
      schemaRelease: result.snapshot.schemaRelease,
      generatedAt: result.snapshot.generatedAt,
      filename,
      sha256,
      rows: result.snapshot.observations.length,
      collectionComplete: result.snapshot.collectionComplete,
    }, null, 2)}\n`, "utf8");
    Object.assign(summary, { filename, sha256 });
  }
  console.log(JSON.stringify(summary, null, 2));
}

function withoutRows(value: { rows: unknown[]; inputRows: number; rejectedRows: number; unknownMarkets: Record<string, number> }) {
  return { inputRows: value.inputRows, normalizedRows: value.rows.length, rejectedRows: value.rejectedRows, unknownMarkets: value.unknownMarkets };
}

function stringArg(name: string, fallback: string): string {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
}

function integerArg(name: string, fallback: number): number {
  const parsed = Number(stringArg(name, String(fallback)));
  if (!Number.isInteger(parsed)) throw new Error(`--${name} must be an integer.`);
  return parsed;
}

function booleanArg(name: string, fallback: boolean): boolean {
  const value = stringArg(name, String(fallback));
  if (value !== "true" && value !== "false") throw new Error(`--${name} must be true or false.`);
  return value === "true";
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
