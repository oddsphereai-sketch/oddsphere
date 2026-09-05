import { sportsInSeasonToday } from "./seasons";
import type { Sport } from "@/lib/types/domain/Sport";

const GENERIC_PREGAME_SWEEP_OWNERS = new Set<Sport>(["mlb", "nba", "nhl"]);

export function pregameSweepSports(
  env: Record<string, string | undefined> = process.env,
): Sport[] {
  // CFB, NFL, soccer/UCL, and CBB have authoritative sport-specific writers
  // and lock evidence. Running the legacy game_predictions sweep for them
  // duplicates ownership and falsely reports unlocked games because their real
  // lock lives in prediction_records/forward evidence.
  const sports: Sport[] = [...sportsInSeasonToday()].filter((sport) =>
    GENERIC_PREGAME_SWEEP_OWNERS.has(sport));
  if (env.WNBA_PREGAME_SWEEP_ENABLED === "true") sports.push("wnba");
  return [...new Set(sports)];
}
