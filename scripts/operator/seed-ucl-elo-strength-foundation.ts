import { BallDontLieUclProvider } from "../../lib/providers/real_api/BallDontLieUclProvider";
import { loadUclEloStrengthFoundation } from "../../lib/services/ucl/uclEloStrengthFoundation";

async function main() {
  const key = process.env.BALLDONTLIE_API_KEY;
  if (!key) throw new Error("BALLDONTLIE_API_KEY is required");
  const provider = new BallDontLieUclProvider(key);
  const [history, current, teams2024, teams2025, teams2026] = await Promise.all([
    provider.listHistoricalMatches([2024, 2025]),
    provider.listCurrentSeasonMatches(2026),
    provider.listTeams(2024),
    provider.listTeams(2025),
    provider.listTeams(2026),
  ]);
  const teamNames = new Map([...teams2024, ...teams2025, ...teams2026].map((team) => [team.id, team.name]));
  const payload = await loadUclEloStrengthFoundation({
    uclMatches: [...history.matches, ...current.filter((match) => match.status_state === "final")],
    teamNames,
    allowWrite: true,
  });
  console.log(JSON.stringify({
    release: payload.release,
    generatedAt: payload.generatedAt,
    clubs: Object.keys(payload.clubs).length,
    domesticMatches: payload.domesticMatches,
    uclMatches: payload.uclMatches,
  }));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
