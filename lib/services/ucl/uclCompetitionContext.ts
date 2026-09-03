import type { BdlUclMatch } from "@/lib/providers/real_api/BallDontLieUclProvider";

export const UCL_COMPETITION = "uefa_champions_league" as const;
export const UCL_EXTERNAL_ID_OFFSET = 30_000_000;
export const UCL_EXTERNAL_ID_UPPER_BOUND = 40_000_000;
export const UCL_CONTEXT_RELEASE = "ucl_competition_context_2026_09_03_r2_qualifying_truthful" as const;
export const UCL_SETTLEMENT_RELEASE = "ucl_regulation_settlement_2026_09_03_r3_complete_lock_manifest" as const;

export type UclStage =
  | "league_phase"
  | "qualifying"
  | "group_stage"
  | "knockout_playoff"
  | "round_of_16"
  | "quarterfinal"
  | "semifinal"
  | "final"
  | "knockout"
  | "unknown";

export type UclCompetitionContext = {
  release: typeof UCL_CONTEXT_RELEASE;
  stage: UclStage;
  leg: 1 | 2 | null;
  aggregateBefore: { home: number; away: number } | null;
  neutralVenue: boolean | null;
  regulationTime: true;
  advancementMarket: false;
  source: "schedule_topology" | "provider_round_and_schedule" | "unknown";
};

function unorderedPair(match: Pick<BdlUclMatch, "home_team_id" | "away_team_id">): string {
  return [match.home_team_id, match.away_team_id].sort((a, b) => a - b).join(":");
}

function calendarStage(match: BdlUclMatch, reciprocal: boolean): UclStage {
  const date = new Date(match.date);
  if (!Number.isFinite(date.getTime())) return "unknown";
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  // Since 2024-25 the main tournament uses a league phase through January.
  if (month === 7 || month === 8) return "qualifying";
  if (month >= 9 || month === 1) return match.season >= 2024 ? "league_phase" : "group_stage";
  if (!reciprocal) return month === 5 || (month === 6 && day <= 7) ? "final" : "knockout";
  if (month === 2) return "knockout_playoff";
  if (month === 3) return "round_of_16";
  if (month === 4 && day <= 18) return "quarterfinal";
  if (month === 4 || month === 5) return "semifinal";
  return "knockout";
}

export function regulationScore(match: BdlUclMatch): {
  score: { home: number; away: number } | null;
  source: "full_time" | "period_components" | "unavailable_special_final";
} {
  const special = match.status_detail === "AET" || match.status_detail === "FT-Pens"
    || match.status === "STATUS_FINAL_AET" || match.status === "STATUS_FINAL_PEN";
  if (!special) {
    return {
      score: match.home_score === null || match.away_score === null
        ? null
        : { home: match.home_score, away: match.away_score },
      source: "full_time",
    };
  }
  const parts = [
    match.first_half_home_score,
    match.first_half_away_score,
    match.second_half_home_score,
    match.second_half_away_score,
  ];
  if (parts.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    return { score: null, source: "unavailable_special_final" };
  }
  return {
    score: {
      home: match.first_half_home_score! + match.second_half_home_score!,
      away: match.first_half_away_score! + match.second_half_away_score!,
    },
    source: "period_components",
  };
}

export function buildUclCompetitionContexts(matches: BdlUclMatch[]): Map<number, UclCompetitionContext> {
  const pairRows = new Map<string, BdlUclMatch[]>();
  for (const match of matches) {
    const key = unorderedPair(match);
    pairRows.set(key, [...(pairRows.get(key) ?? []), match]);
  }
  const contexts = new Map<number, UclCompetitionContext>();
  for (const match of matches) {
    const matchTime = Date.parse(match.date);
    const legs = [...(pairRows.get(unorderedPair(match)) ?? [])]
      .filter((candidate) => Math.abs(Date.parse(candidate.date) - matchTime) <= 45 * 86_400_000)
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.id - b.id);
    const reciprocal = legs.length === 2
      && legs[0]!.home_team_id === legs[1]!.away_team_id
      && legs[0]!.away_team_id === legs[1]!.home_team_id;
    const legIndex = reciprocal ? legs.findIndex((candidate) => candidate.id === match.id) : -1;
    const leg = legIndex === 0 ? 1 : legIndex === 1 ? 2 : null;
    let aggregateBefore: UclCompetitionContext["aggregateBefore"] = null;
    if (leg === 2) {
      const first = legs[0]!;
      const firstScore = regulationScore(first).score;
      if (firstScore) {
        aggregateBefore = match.home_team_id === first.home_team_id
          ? { home: firstScore.home, away: firstScore.away }
          : { home: firstScore.away, away: firstScore.home };
      }
    }
    const stage = calendarStage(match, reciprocal);
    contexts.set(match.id, {
      release: UCL_CONTEXT_RELEASE,
      stage,
      leg,
      aggregateBefore,
      neutralVenue: stage === "final" ? true : null,
      regulationTime: true,
      advancementMarket: false,
      source: stage === "unknown" ? "unknown" : "schedule_topology",
    });
  }
  return contexts;
}

export function uclProviderIdFromExternal(externalId: number): number | null {
  if (externalId < UCL_EXTERNAL_ID_OFFSET || externalId >= UCL_EXTERNAL_ID_UPPER_BOUND) return null;
  const providerId = externalId - UCL_EXTERNAL_ID_OFFSET;
  return Number.isInteger(providerId) && providerId > 0 ? providerId : null;
}
