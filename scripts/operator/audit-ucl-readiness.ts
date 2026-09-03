import { buildUclSlate } from "../../lib/services/ucl/buildUclSlate";
import { buildUclDailyEdgePreview } from "../../lib/services/ucl/buildUclDailyEdgePreview";
import { evaluateUclPublicationCoverage } from "../../lib/services/ucl/uclPublicationReadiness";

async function main() {
  const slate = await buildUclSlate();
  const response = await buildUclDailyEdgePreview(slate);
  const coverage = evaluateUclPublicationCoverage(slate, response);
  const markets = response.games.flatMap((game) => [game.markets.moneyline, game.soccerDoubleChanceMarket, game.markets.total, game.markets.first_inning].filter(Boolean));
  const grades = markets.reduce<Record<string, number>>((counts, market) => {
    const label = market!.verdict?.label ?? "Unknown";
    counts[label] = (counts[label] ?? 0) + 1;
    return counts;
  }, {});
  const nonpositiveEvActionables = markets.filter((market) => {
    const actionable = market!.verdict?.key === "best_angle" || market!.verdict?.key === "lean";
    return actionable && !(typeof market!.pinnacleEvPct === "number" && market!.pinnacleEvPct > 0);
  }).length;
  const incoherent = response.games.filter((game) => {
    const p = game.soccerProjection?.goalOutlookProbabilities;
    return !p
      || Math.abs(p.home + p.draw + p.away - 1) > 1e-9
      || Math.abs(p.over25 + p.under25 - 1) > 1e-9
      || Math.abs(p.bttsYes + p.bttsNo - 1) > 1e-9;
  }).length;
  console.log(JSON.stringify({
    mode: "read_only",
    competition: "uefa_champions_league",
    season: slate.season,
    matchweek: slate.round,
    fixtures: slate.matches.length,
    kickoffRange: [slate.matches.at(0)?.kickoff ?? null, slate.matches.at(-1)?.kickoff ?? null],
    releases: { model: slate.modelRelease, calibration: slate.calibrationRelease },
    providerHealth: slate.providerHealth,
    coverage,
    grades,
    nonpositiveEvActionables,
    incoherent,
  }, null, 2));
  if (incoherent > 0 || nonpositiveEvActionables > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
