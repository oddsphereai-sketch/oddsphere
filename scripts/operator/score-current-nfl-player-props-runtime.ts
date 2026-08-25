import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NflPlayerPropsObservationSnapshot } from "../../lib/services/football/nflPlayerPropsContract";
import type { NflPlayerPropsInferenceContext } from "../../lib/services/football/nflPlayerPropsInferenceContext";
import type { NflPlayerPropsExactOffer } from "../../lib/services/football/nflPlayerPropsMarketBoard";
import {
  buildNflPlayerPropsRuntimeBoard,
  buildNflPlayerPropsRuntimeFeatureRows,
  verifyNflPlayerPropsRuntimeParity,
} from "../../lib/services/football/nflPlayerPropsRuntime";

async function main(): Promise<void> {
  const observationPath = required("--observation");
  const contextPath = required("--context");
  const exactPath = required("--exact-board");
  const outputRoot = optional("--output-root") ?? "football-research/cache/nfl-player-props-production-candidate";
  const observation = await json<NflPlayerPropsObservationSnapshot>(observationPath);
  const context = await json<NflPlayerPropsInferenceContext>(contextPath);
  const exactPayload = await json<{ evaluatedAt: string; offers: NflPlayerPropsExactOffer[] }>(exactPath);
  verifyNflPlayerPropsRuntimeParity();
  const features = buildNflPlayerPropsRuntimeFeatureRows({ snapshot: observation, context });
  const board = buildNflPlayerPropsRuntimeBoard({ offers: exactPayload.offers, features, evaluatedAt: exactPayload.evaluatedAt });
  const payload = {
    ...board,
    inputs: {
      observationSha256: await sha256(observationPath), contextSha256: await sha256(contextPath), exactBoardSha256: await sha256(exactPath),
    },
    featureCoverage: {
      rows: features.length, scoreEligible: features.filter((row) => row.scoreEligible).length,
      holds: Object.fromEntries([...new Set(features.flatMap((row) => row.healthHolds))].sort().map((hold) => [hold, features.filter((row) => row.healthHolds.includes(hold)).length])),
    },
  };
  await mkdir(outputRoot, { recursive: true });
  const outputPath = path.join(outputRoot, "nfl_player_props_2026_week_1_runtime_board_r1.json");
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, counts: board.counts, diagnostics: board.diagnostics, featureCoverage: payload.featureCoverage }, null, 2));
}

function required(flag: string): string {
  const value = optional(flag); if (!value) throw new Error(`${flag} is required.`); return value;
}
function optional(flag: string): string | null {
  const prefix = `${flag}=`; const argument = process.argv.slice(2).find((value) => value.startsWith(prefix)); return argument?.slice(prefix.length) ?? null;
}
async function json<T>(filename: string): Promise<T> { return JSON.parse(await readFile(filename, "utf8")) as T; }
async function sha256(filename: string): Promise<string> { return createHash("sha256").update(await readFile(filename)).digest("hex"); }

main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
