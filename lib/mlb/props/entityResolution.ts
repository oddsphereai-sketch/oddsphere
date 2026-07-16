import type { MlbPlayerEntity } from "./providers";

export type PlayerResolutionResult =
  | { status: "matched"; player: MlbPlayerEntity; confidence: number; method: "provider_id" | "normalized_name_team_game" | "normalized_name" }
  | { status: "blocked"; reason: "ambiguous" | "low_confidence" | "not_found" | "team_mismatch"; candidates: MlbPlayerEntity[]; confidence: number };

export function normalizePlayerName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

export function resolveMlbPlayer(args: {
  providerPlayerId?: string | number | null;
  providerName?: string | null;
  teamId?: string | null;
  players: MlbPlayerEntity[];
  minConfidence?: number;
}): PlayerResolutionResult {
  const minConfidence = args.minConfidence ?? 0.98;
  if (args.providerPlayerId !== null && args.providerPlayerId !== undefined) {
    const id = String(args.providerPlayerId);
    const providerMatches = args.players.filter((player) =>
      Object.values(player.providerIds).some((value) => value !== null && String(value) === id),
    );
    if (providerMatches.length === 1) return { status: "matched", player: providerMatches[0], confidence: 1, method: "provider_id" };
    if (providerMatches.length > 1) return { status: "blocked", reason: "ambiguous", candidates: providerMatches, confidence: 0 };
  }

  const normalized = args.providerName ? normalizePlayerName(args.providerName) : "";
  if (!normalized) return { status: "blocked", reason: "not_found", candidates: [], confidence: 0 };

  const nameMatches = args.players.filter((player) => player.normalizedName === normalized || normalizePlayerName(player.fullName) === normalized);
  if (nameMatches.length === 0) return { status: "blocked", reason: "not_found", candidates: [], confidence: 0 };

  if (args.teamId) {
    const teamMatches = nameMatches.filter((player) => !player.teamId || player.teamId === args.teamId);
    if (teamMatches.length === 1) {
      const confidence = teamMatches[0].teamId === args.teamId ? 0.99 : 0.985;
      return confidence >= minConfidence
        ? { status: "matched", player: teamMatches[0], confidence, method: "normalized_name_team_game" }
        : { status: "blocked", reason: "low_confidence", candidates: teamMatches, confidence };
    }
    if (teamMatches.length > 1) return { status: "blocked", reason: "ambiguous", candidates: teamMatches, confidence: 0.7 };
    return { status: "blocked", reason: "team_mismatch", candidates: nameMatches, confidence: 0.6 };
  }

  if (nameMatches.length === 1) {
    const confidence = 0.96;
    return confidence >= minConfidence
      ? { status: "matched", player: nameMatches[0], confidence, method: "normalized_name" }
      : { status: "blocked", reason: "low_confidence", candidates: nameMatches, confidence };
  }
  return { status: "blocked", reason: "ambiguous", candidates: nameMatches, confidence: 0.7 };
}
