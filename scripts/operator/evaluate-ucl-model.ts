import { BallDontLieUclProvider } from "../../lib/providers/real_api/BallDontLieUclProvider";
import { evaluateUclChronologically } from "../../lib/services/ucl/uclChronologicalEvaluation";
import { UCL_CALIBRATION_RELEASE, UCL_MODEL_RELEASE } from "../../lib/services/ucl/uclModel";

async function main() {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required");
  const provider = new BallDontLieUclProvider(apiKey);
  const history = await provider.listHistoricalMatches([2024, 2025]);
  const matches = history.matches;
  const finalIds = matches.filter((match) => match.status_state === "final").map((match) => match.id);
  const stats = await provider.listTeamMatchStats(finalIds);
  const evaluation = evaluateUclChronologically(matches, stats);
  console.log(JSON.stringify({
    mode: "read_only",
    providerContract: "balldontlie_ucl_v1_empirical_singular_season_cohorts_return_validated",
    providerHistory: history.telemetry,
    releases: { model: UCL_MODEL_RELEASE, calibration: UCL_CALIBRATION_RELEASE },
    returnedSeasons: Object.fromEntries([...new Set(matches.map((match) => match.season))].sort().map((season) => [season, matches.filter((match) => match.season === season).length])),
    statsRows: stats.length,
    ...evaluation,
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
