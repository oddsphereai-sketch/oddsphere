import { createHash } from "node:crypto";
import { cbbProviderStoredSchoolMatches } from "../../cbb/providerInstitutionIdentity";
import type { CbbGame } from "../../cbb/types";
import type { CbbStoredMemberGame } from "./cbbMemberGameStore";

export const CBB_UNLOCKED_ORIENTATION_RELEASE = "cbb_unlocked_orientation_2026_11_20_r1_exact_pair_rebuild" as const;
export type CbbOrientationRebuildReceipt = {
  release: typeof CBB_UNLOCKED_ORIENTATION_RELEASE; archivedSnapshotKey: string; originalSha256: string;
  rebuiltAt: string; priorHomeId: number; priorAwayId: number; homeId: number; awayId: number;
};

/** Same two independently identified schools, with their provider designations
 * reversed. No new school, started game, or original/new T-60 record can enter
 * this path. An orientation change always needs a fresh forecast, not relabeling. */
export function canRebuildCbbUnlockedOrientation(stored: CbbStoredMemberGame, game: CbbGame, now: string): boolean {
  const forecast = stored.snapshot.board.gameForecast;
  const at = Date.parse(now), oldStart = Date.parse(stored.snapshot.startsAt), newStart = Date.parse(game.date);
  const captured = Date.parse(stored.snapshot.capturedAt), forecastAt = Date.parse(stored.snapshot.board.asOf);
  return stored.snapshot.lockedAt === null && stored.memberGame.lockedAt === null &&
    stored.memberGame.lockState === "open" &&
    stored.snapshot.gameId === game.id && stored.memberGame.external_id === game.id &&
    [at, oldStart, newStart, captured, forecastAt].every(Number.isFinite) && forecastAt <= captured && captured <= at &&
    at < Math.min(oldStart, newStart) - 60 * 60_000 &&
    !!forecast && forecast.homeId === game.visitor_team.id && forecast.awayId === game.home_team.id &&
    game.home_team.id !== game.visitor_team.id &&
    cbbProviderStoredSchoolMatches(stored.memberGame.homeTeamDisplayName, game.visitor_team) &&
    cbbProviderStoredSchoolMatches(stored.memberGame.awayTeamDisplayName, game.home_team);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(k =>
    `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function cbbOrientationArchiveIdentity(stored: CbbStoredMemberGame) {
  const sha256 = createHash("sha256").update(canonical(stored)).digest("hex");
  return { sha256, key: `cbb::orientation-original::${stored.snapshot.gameId}::${sha256}` };
}
