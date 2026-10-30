import { readFile, writeFile } from "node:fs/promises";
import { buildCbbTrainingGames } from "../../lib/cbb/dataset";
import { CBB_DEVELOPMENT_UNCERTAINTY, evaluateCbbRows, fitCbbUncertainty } from "../../lib/cbb/evaluation";
import { replayCbbScoreResearch, type CbbScoreFeatureRow } from "../../lib/cbb/scoreResearch";
import { applyCbbShotHead, enrichCbbShotProfiles, fitCbbShotHead } from "../../lib/cbb/shotProfileResearch";
import type { CbbBox, CbbGame, CbbVenue } from "../../lib/cbb/types";

const dir = "/private/tmp/oddsphere-cbb-data", release = "cbb_candidate_2026_10_28_r4_temporal_profile";
if (process.argv.some(arg => /^(--write|--publish|--activate)/.test(arg))) throw new Error("private research only");
const read = async <T>(file: string): Promise<T> => JSON.parse(await readFile(`${dir}/${file}`, "utf8"));
async function main() {
  const games: CbbGame[] = [], boxes: CbbBox[] = [], venues: CbbVenue[] = [];
  for (const season of [2022, 2023, 2024, 2025]) {
    games.push(...(await read<{ data: CbbGame[] }>(`games-${season}.json`)).data);
    boxes.push(...(await read<{ data: CbbBox[] }>(`boxes-${season}.json`)).data);
    venues.push(...(await read<{ data: CbbVenue[] }>(`venues-${season}.json`)).data);
  }
  const history = buildCbbTrainingGames(games, boxes, venues).games;
  const r3 = await read<{ selected: { metrics: ReturnType<typeof evaluateCbbRows> } }>("shot-profile-report.json");
  const baseline = r3.selected.metrics;
  const candidates = [];
  const cached = new Map<number, { development: CbbScoreFeatureRow[]; selection: CbbScoreFeatureRow[] }>();
  for (const recencyDays of [30, 60, 120]) {
    const config = { id: `temporal_${recencyDays}`, ridge: 1, paceRidge: 0.25, priorCarry: 0.8, recencyDays };
    const rawDev = replayCbbScoreResearch(history, 2023, config, CBB_DEVELOPMENT_UNCERTAINTY);
    const rawSelection = replayCbbScoreResearch(history, 2024, config, fitCbbUncertainty(rawDev, 2023));
    const development = enrichCbbShotProfiles(rawDev, history, boxes), selection = enrichCbbShotProfiles(rawSelection, history, boxes);
    const metrics = evaluateCbbRows(applyCbbShotHead(selection, fitCbbShotHead(development, 2023, 10, "huber")));
    const eligible = metrics.marginMae < baseline.marginMae && metrics.totalMae < baseline.totalMae && metrics.brier <= baseline.brier && metrics.accuracy >= baseline.accuracy - 0.005;
    const score = (metrics.marginMae / baseline.marginMae + metrics.totalMae / baseline.totalMae) / 2;
    candidates.push({ config, metrics, eligible, score }); cached.set(recencyDays, { development, selection });
    console.log(JSON.stringify({ recencyDays, eligible, marginMae: metrics.marginMae, totalMae: metrics.totalMae, accuracy: metrics.accuracy, brier: metrics.brier }));
  }
  const selected = candidates.filter(c => c.eligible).sort((a, b) => a.score - b.score)[0] ?? null;
  const report: Record<string, unknown> = { release, productionWrites: 0, baseline, candidates, selected, trainingSeason: 2023, selectionSeason: 2024,
    diagnosticStatus: "2025 already opened; not pristine holdout" };
  if (selected) {
    const { development, selection } = cached.get(selected.config.recencyDays)!;
    const raw = replayCbbScoreResearch(history, 2025, selected.config, fitCbbUncertainty([...development, ...selection], 2024));
    const head = { ...fitCbbShotHead([...development, ...selection], 2024, 10, "huber"), release };
    const result = applyCbbShotHead(enrichCbbShotProfiles(raw, history, boxes), head);
    report.diagnostic = evaluateCbbRows(result);
    await writeFile(`${dir}/candidate-r4-diagnostic.json`, JSON.stringify(result));
    await writeFile(`${dir}/candidate-r4-head.json`, JSON.stringify({ config: selected.config, head }, null, 2));
  }
  await writeFile(`${dir}/temporal-profile-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ selected: selected?.config, diagnostic: report.diagnostic }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
