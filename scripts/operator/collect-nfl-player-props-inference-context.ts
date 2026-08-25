import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  collectNflPlayerPropsInferenceContext,
} from "../../lib/services/football/nflPlayerPropsInferenceContext";
import type { NflPlayerPropsObservationSnapshot } from "../../lib/services/football/nflPlayerPropsContract";

async function main(): Promise<void> {
  const snapshotPath = process.argv[2];
  if (!snapshotPath) throw new Error("Pass the persisted NFL props observation snapshot path.");
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as NflPlayerPropsObservationSnapshot;
  const context = await collectNflPlayerPropsInferenceContext({ snapshot });
  const payload = `${JSON.stringify(context, null, 2)}\n`;
  const sha256 = createHash("sha256").update(payload).digest("hex");
  const root = path.resolve(process.cwd(), "football-research/cache/nfl-player-props-context");
  await mkdir(root, { recursive: true });
  const filename = `nfl_props_context_${context.season}_${context.phase}_week_${context.week}_${sha256.slice(0, 16)}.json`;
  await writeFile(path.join(root, filename), payload, "utf8");
  console.log(JSON.stringify({ release: context.release, filename, sha256, coverage: context.coverage, requestBudget: context.requestBudget, healthHolds: context.healthHolds }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
