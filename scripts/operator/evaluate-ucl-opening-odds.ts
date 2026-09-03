import { BallDontLieUclProvider, type BdlUclOdds } from "../../lib/providers/real_api/BallDontLieUclProvider";
import { partitionUclChronologicalMatches } from "../../lib/services/ucl/uclChronologicalEvaluation";
import { assessUclOpeningOddsCoverage, canonicalUclOpeningOdds, evaluateUclOpeningOddsActionability } from "../../lib/services/ucl/uclOpeningOddsEvaluation";

async function oddsInBatches(provider: BallDontLieUclProvider, matchIds: number[]): Promise<BdlUclOdds[]> {
  const rows: BdlUclOdds[] = [];
  for (let index = 0; index < matchIds.length; index += 40) {
    rows.push(...await provider.listOdds({ matchIds: matchIds.slice(index, index + 40), opening: true }));
  }
  return rows;
}

async function main() {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required");
  const coverageOnly = process.argv.includes("--coverage-only");
  const provider = new BallDontLieUclProvider(apiKey);
  const history = await provider.listHistoricalMatches([2024, 2025]);
  const partition = partitionUclChronologicalMatches(history.matches);
  const holdoutOdds = await oddsInBatches(provider, partition.holdout.map((match) => match.id));
  const holdoutBoards = canonicalUclOpeningOdds(holdoutOdds);
  const coverage = { quoted: partition.holdout.filter((match) => holdoutBoards.has(match.id)).length, total: partition.holdout.length };
  if (coverageOnly) {
    console.log(JSON.stringify({ mode: "read_only_coverage", providerHistory: history.telemetry, block: "untouched_holdout", rawOddsRows: holdoutOdds.length, coverage, vendors: [...new Set([...holdoutBoards.values()].flat().map((row) => row.vendor))].sort() }, null, 2));
    return;
  }
  const calibrationOdds = await oddsInBatches(provider, partition.calibration.map((match) => match.id));
  const allOdds = [...calibrationOdds, ...holdoutOdds];
  const preOutcomeCoverage = assessUclOpeningOddsCoverage(history.matches, allOdds);
  if (!preOutcomeCoverage.coverageQualified) {
    const evaluation = evaluateUclOpeningOddsActionability({ matches: history.matches, stats: [], odds: allOdds });
    console.log(JSON.stringify({ mode: "read_only_predeclared_coverage_rejected_before_outcome_join", providerHistory: history.telemetry, rawOddsRows: { calibration: calibrationOdds.length, holdout: holdoutOdds.length }, ...evaluation }, null, 2));
    return;
  }
  const stats = await provider.listTeamMatchStats(partition.finalRows.map((match) => match.id));
  const evaluation = evaluateUclOpeningOddsActionability({ matches: history.matches, stats, odds: allOdds });
  console.log(JSON.stringify({
    mode: "read_only_predeclared",
    providerHistory: history.telemetry,
    rawOddsRows: { calibration: calibrationOdds.length, holdout: holdoutOdds.length },
    ...evaluation,
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
