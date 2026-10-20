import type { Sport } from "@/lib/types/domain/Sport";

export function shouldPublishOfficialEmptyMlbRollover(input: {
  sport: Sport;
  rolloverSeed: boolean;
  officialScheduledGameCount: number | null;
}): boolean {
  return input.sport === "mlb" &&
    input.rolloverSeed &&
    input.officialScheduledGameCount === 0;
}
