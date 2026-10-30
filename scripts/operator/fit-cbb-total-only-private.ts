/** Fits an explicit local preview artifact only; does not publish or write a member record. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fitCbbTotalOnlyMarketHead } from "../../lib/cbb/totalOnlyMarketResearch";
import type { CbbScoreFeatureRow } from "../../lib/cbb/scoreResearch";

if (process.argv.some(arg => /^(--publish|--activate|--live)/.test(arg))) throw new Error("private CBB fit only");
const dir = resolve(process.argv.find(arg => arg.startsWith("--data="))?.slice(7) ?? "/private/tmp/oddsphere-cbb-data");
const files = ["market-reader-feature-rows.json", "date-diverse-feature-rows.json", "weekdays-feature-rows.json",
  "saturation-feature-rows.json"];
async function main() {
  const rows = (await Promise.all(files.map(async file => JSON.parse(await readFile(resolve(dir, file), "utf8")) as CbbScoreFeatureRow[]))).flat();
  if (rows.length !== 1070 || rows.some(row => row.game.season !== 2025)) throw new Error("CBB r17 training cohort changed");
  const head = fitCbbTotalOnlyMarketHead(rows);
  await writeFile(resolve(dir, "candidate-r17-total-only-head.json"), JSON.stringify(head, null, 2));
  console.log(JSON.stringify({ release: head.release, trainingGames: rows.length, trainedThrough: head.trainedThrough,
    destination: resolve(dir, "candidate-r17-total-only-head.json"), productionWrites: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
