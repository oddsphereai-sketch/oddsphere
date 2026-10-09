import type { NcaafGame } from "./balldontlieNcaafSlate";
import type { CfbForwardTeamQuarterbacks } from "./cfbForwardEvidence";
import type { CfbV1DecisionBundle, CfbV1Grade } from "./cfbV1Decision";
import type { PlaybookInjuryTeamRow } from "@/lib/providers/playbook/types";
import type { DailyEdgeGameAvailability, DailyEdgeAvailabilityPlayer } from "@/lib/services/dailyEdge/gameAvailability";

export const CFB_VERIFIED_AVAILABILITY_RELEASE =
  "cfb_verified_availability_2026_10_02_r1_source_attributed_likely_out" as const;

export type CfbVerifiedQuarterbackAvailability = {
  release: typeof CFB_VERIFIED_AVAILABILITY_RELEASE;
  providerGameId: string;
  teamId: number;
  team: string;
  unavailablePlayerId: string;
  unavailablePlayerName: string;
  replacementPlayerId: string;
  replacementPlayerName: string;
  designation: "out" | "doubtful" | "questionable" | "likely_out" | "available";
  sourceAuthority: "official_provider" | "credentialed_report";
  observedAt: string;
  sources: Array<{
    publisher: string;
    url: string;
  }>;
};

const VERIFIED_QUARTERBACK_AVAILABILITY: readonly CfbVerifiedQuarterbackAvailability[] = [
  {
    release: CFB_VERIFIED_AVAILABILITY_RELEASE,
    providerGameId: "457727",
    teamId: 66,
    team: "DEL",
    unavailablePlayerId: "59644",
    unavailablePlayerName: "Nick Minicucci",
    replacementPlayerId: "78900",
    replacementPlayerName: "Braden Streeter",
    designation: "likely_out",
    sourceAuthority: "credentialed_report",
    observedAt: "2026-10-02T17:30:00.000Z",
    sources: [
      {
        publisher: "Delaware News Journal",
        url: "https://www.aol.com/articles/delawares-qb-conference-usa-opener-162854000.html",
      },
      {
        publisher: "Action Network",
        url: "https://www.actionnetwork.com/ncaaf-game/liberty-flames-delaware-fightin-blue-hens/289269",
      },
    ],
  },
] as const;

export function verifiedCfbQuarterbackAvailability(
  providerGameId: string,
  providerEvidence?: CfbVerifiedQuarterbackAvailability | null,
): CfbVerifiedQuarterbackAvailability | null {
  const embedded = VERIFIED_QUARTERBACK_AVAILABILITY.find((row) => row.providerGameId === providerGameId) ?? null;
  if (!providerEvidence || providerEvidence.providerGameId !== providerGameId) return embedded;
  if (!embedded || providerEvidence.sourceAuthority === "official_provider" || Date.parse(providerEvidence.observedAt) >= Date.parse(embedded.observedAt)) {
    return providerEvidence;
  }
  return embedded;
}

export function playbookCfbQuarterbackAvailability(args: {
  game: NcaafGame;
  away: CfbForwardTeamQuarterbacks;
  home: CfbForwardTeamQuarterbacks;
  injuryRows: PlaybookInjuryTeamRow[];
  capturedAt: string;
  previousEvidence?: CfbVerifiedQuarterbackAvailability | null;
}): CfbVerifiedQuarterbackAvailability | null {
  for (const quarterbacks of [args.away, args.home]) {
    const expected = quarterbacks.expectedStartingQuarterback;
    if (!expected) continue;
    const teamRow = args.injuryRows.find((row) =>
      row.modelAuthorityEligible !== false && teamMatches(row, quarterbacks));
    const prior = args.previousEvidence?.teamId === quarterbacks.teamId
      ? args.previousEvidence
      : verifiedCfbQuarterbackAvailability(args.game.providerGameId)?.teamId === quarterbacks.teamId
        ? verifiedCfbQuarterbackAvailability(args.game.providerGameId)
        : null;
    const targetNames = new Set([
      normalizeName(expected.name),
      ...(prior ? [normalizeName(prior.unavailablePlayerName)] : []),
    ]);
    const injury = teamRow?.players?.find((player) => targetNames.has(normalizeName(player.name ?? "")));
    const designation = injuryDesignation(injury?.status ?? injury?.statusContext ?? null);
    if (!designation) continue;
    const affected = quarterbacks.activeQuarterbacks.find((quarterback) =>
      normalizeName(quarterback.name) === normalizeName(injury?.name ?? "")) ?? expected;
    const replacement = designation === "out" || designation === "doubtful"
      ? quarterbacks.activeQuarterbacks.find((quarterback) => quarterback.playerId !== affected.playerId)
      : affected;
    if (!replacement) continue;
    const observedAt = validIso(teamRow?.updatedAt) ?? validIso(teamRow?.reportDate) ?? new Date(args.capturedAt).toISOString();
    return {
      release: CFB_VERIFIED_AVAILABILITY_RELEASE,
      providerGameId: args.game.providerGameId,
      teamId: quarterbacks.teamId,
      team: quarterbacks.team,
      unavailablePlayerId: affected.playerId,
      unavailablePlayerName: affected.name,
      replacementPlayerId: replacement.playerId,
      replacementPlayerName: replacement.name,
      designation,
      sourceAuthority: "official_provider",
      observedAt,
      sources: [{ publisher: "Playbook", url: "https://api.playbook-api.com/v1/injuries" }],
    };
  }
  return null;
}

export function reportedCfbQuarterbackAvailability(args: {
  game: NcaafGame;
  away: CfbForwardTeamQuarterbacks;
  home: CfbForwardTeamQuarterbacks;
  report: DailyEdgeGameAvailability | null;
  capturedAt: string;
  previousEvidence?: CfbVerifiedQuarterbackAvailability | null;
}): CfbVerifiedQuarterbackAvailability | null {
  if (!args.report || args.report.eventId !== args.game.providerGameId) return null;
  for (const quarterbacks of [args.away, args.home]) {
    const expected = quarterbacks.expectedStartingQuarterback;
    if (!expected) continue;
    const team = args.report.teams.find((candidate) => normalizeName(candidate.abbreviation) === normalizeName(quarterbacks.team));
    if (!team) continue;
    const prior = args.previousEvidence?.teamId === quarterbacks.teamId ? args.previousEvidence : null;
    const targets = [expected.name, ...(prior ? [prior.unavailablePlayerName] : [])];
    const reported = team.players.filter((player) =>
      player.position?.toUpperCase() === "QB" && targets.some((target) => reportedNameMatches(player, target))
    );
    if (reported.length !== 1) continue;
    const player = reported[0]!;
    const designation = injuryDesignation(player.status);
    if (!designation) continue;
    const affectedMatches = quarterbacks.activeQuarterbacks.filter((quarterback) => reportedNameMatches(player, quarterback.name));
    const affected = affectedMatches.length === 1 ? affectedMatches[0]! : expected;
    const replacement = designation === "out" || designation === "doubtful"
      ? quarterbacks.activeQuarterbacks.find((quarterback) => quarterback.playerId !== affected.playerId)
      : affected;
    if (!replacement) continue;
    return {
      release: CFB_VERIFIED_AVAILABILITY_RELEASE,
      providerGameId: args.game.providerGameId,
      teamId: quarterbacks.teamId,
      team: quarterbacks.team,
      unavailablePlayerId: affected.playerId,
      unavailablePlayerName: affected.name,
      replacementPlayerId: replacement.playerId,
      replacementPlayerName: replacement.name,
      designation,
      sourceAuthority: args.report.source === "Playbook" ? "official_provider" : "credentialed_report",
      observedAt: validIso(player.reportedAt) ?? validIso(args.report.reportUpdatedAt) ?? new Date(args.capturedAt).toISOString(),
      sources: [{ publisher: args.report.source, url: args.report.sourceUrl ?? "https://api.playbook-api.com/v1/injuries" }],
    };
  }
  return null;
}

export function applyVerifiedCfbQuarterbackAvailability(args: {
  game: NcaafGame;
  away: CfbForwardTeamQuarterbacks;
  home: CfbForwardTeamQuarterbacks;
  providerEvidence?: CfbVerifiedQuarterbackAvailability | null;
}): {
  away: CfbForwardTeamQuarterbacks;
  home: CfbForwardTeamQuarterbacks;
  availability: CfbVerifiedQuarterbackAvailability | null;
} {
  const availability = verifiedCfbQuarterbackAvailability(args.game.providerGameId, args.providerEvidence);
  if (!availability) return { away: args.away, home: args.home, availability: null };

  const side = args.away.teamId === availability.teamId
    ? "away"
    : args.home.teamId === availability.teamId ? "home" : null;
  if (!side) throw new Error(`CFB verified quarterback availability team mismatch for ${args.game.providerGameId}.`);

  const quarterbacks = side === "away" ? args.away : args.home;
  const selectedPlayerId = availability.designation === "out" || availability.designation === "doubtful" || availability.designation === "likely_out"
    ? availability.replacementPlayerId
    : availability.unavailablePlayerId;
  const selectedPlayerName = availability.designation === "out" || availability.designation === "doubtful" || availability.designation === "likely_out"
    ? availability.replacementPlayerName
    : availability.unavailablePlayerName;
  const selected = quarterbacks.activeQuarterbacks.find((quarterback) =>
    quarterback.playerId === selectedPlayerId ||
    normalizeName(quarterback.name) === normalizeName(selectedPlayerName));
  if (!selected) {
    throw new Error(`CFB verified quarterback ${selectedPlayerName} is not on the active roster for ${args.game.providerGameId}.`);
  }

  const adjusted: CfbForwardTeamQuarterbacks = {
    ...quarterbacks,
    starterStatus: "projected",
    expectedStartingQuarterback: selected,
  };
  return {
    away: side === "away" ? adjusted : args.away,
    home: side === "home" ? adjusted : args.home,
    availability,
  };
}

export function applyCfbVerifiedAvailabilityGradeCap(args: {
  bundle: CfbV1DecisionBundle;
  availability: CfbVerifiedQuarterbackAvailability | null;
}): CfbV1DecisionBundle {
  if (!args.availability || args.availability.designation === "available") return args.bundle;
  return {
    ...args.bundle,
    evaluatedBets: args.bundle.evaluatedBets.map((decision) => {
      const grade = capAtWatchlist(decision.grade);
      return {
        ...decision,
        grade,
        gradeAdjustment: {
          release: decision.gradeAdjustment?.release ?? CFB_VERIFIED_AVAILABILITY_RELEASE,
          candidateRelease: decision.gradeAdjustment?.candidateRelease ?? CFB_VERIFIED_AVAILABILITY_RELEASE,
          sharpDirection: decision.gradeAdjustment?.sharpDirection ?? "unknown",
          publicDirection: decision.gradeAdjustment?.publicDirection ?? "unknown",
          movementDirection: decision.gradeAdjustment?.movementDirection ?? "unknown",
          confidenceScore: decision.gradeAdjustment?.confidenceScore,
          confidenceAdjustment: decision.gradeAdjustment?.confidenceAdjustment,
          executionStatus: decision.gradeAdjustment?.executionStatus ?? "shop",
          reasonCodes: [
            ...(decision.gradeAdjustment?.reasonCodes ?? []),
            "verified_qb_availability_projection_uncalibrated",
          ],
        },
      };
    }),
  };
}

function capAtWatchlist(grade: CfbV1Grade): CfbV1Grade {
  return grade === "Best Angle" || grade === "Lean" ? "Watchlist" : grade;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function teamMatches(row: PlaybookInjuryTeamRow, quarterbacks: CfbForwardTeamQuarterbacks): boolean {
  const abbreviation = normalizeName(row.teamAbbr ?? "");
  const teamId = String(row.teamId ?? "").trim();
  return abbreviation === normalizeName(quarterbacks.team) || teamId === String(quarterbacks.teamId);
}

function injuryDesignation(value: string | null): CfbVerifiedQuarterbackAvailability["designation"] | null {
  const normalized = normalizeName(value ?? "");
  if (normalized.includes("inactive") || normalized.includes("out") || normalized === "ir" || normalized.includes("injuredreserve")) return "out";
  if (normalized.includes("doubtful")) return "doubtful";
  if (normalized.includes("questionable") || normalized.includes("gametimedecision")) return "questionable";
  if (normalized.includes("available") || normalized.includes("active") || normalized.includes("healthy") || normalized.includes("cleared")) return "available";
  return null;
}

function reportedNameMatches(player: DailyEdgeAvailabilityPlayer, rosterName: string): boolean {
  const reported = normalizeName(player.name);
  const roster = normalizeName(rosterName);
  if (reported === roster) return true;
  const reportedParts = player.name.trim().toLowerCase().replace(/[^a-z0-9.' -]+/g, "").split(/\s+/).filter(Boolean);
  const rosterParts = rosterName.trim().toLowerCase().replace(/[^a-z0-9.' -]+/g, "").split(/\s+/).filter(Boolean);
  if (reportedParts.length < 2 || rosterParts.length < 2) return false;
  const reportedInitial = reportedParts[0]!.replace(/[^a-z]/g, "").slice(0, 1);
  const rosterInitial = rosterParts[0]!.replace(/[^a-z]/g, "").slice(0, 1);
  const reportedLast = reportedParts.at(-1)!.replace(/[^a-z0-9]/g, "");
  const rosterLast = rosterParts.at(-1)!.replace(/[^a-z0-9]/g, "");
  return reportedInitial.length === 1 && reportedInitial === rosterInitial && reportedLast.length >= 3 && reportedLast === rosterLast;
}

function validIso(value: string | null | undefined): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
