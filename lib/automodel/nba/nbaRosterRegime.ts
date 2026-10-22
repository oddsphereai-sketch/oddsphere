import type { NbaPlayerInjury } from "./types";
import type { NbaPortableScore } from "./nbaPortableScoreModel";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const artifact = require("./modelArtifacts/nbaRosterRegimeR1.json") as NbaRosterRegimeArtifact;

export const NBA_ROSTER_REGIME_RELEASE =
  "nba_roster_regime_residual_2026_10_22_r2_symmetric_winner_confirmation" as const;

type PlayerProfile = {
  id: number;
  name: string;
  games: number;
  minutes: number;
  pie: number;
  estimatedNet: number;
};

type TeamRoster = { team: string; teamId: number; playerIds: number[] };

type NbaRosterRegimeArtifact = {
  release: typeof NBA_ROSTER_REGIME_RELEASE;
  provider: "balldontlie";
  providerSeason: number;
  priorSeason: number;
  features: string[];
  retainedMinutesThreshold: number;
  decayGames: number;
  model: { family: "zero_intercept_ridge"; alpha: number };
  margin: { coefficients: number[]; rms: number[] };
  total: { coefficients: number[]; rms: number[] };
  winnerConfirmation: {
    family: "home_away_symmetric_zero_intercept_ridge";
    policy: "primary_flip_requires_symmetric_confirmation";
    retainedMinutesThreshold: number;
    model: { family: "zero_intercept_ridge"; alpha: number };
    margin: { coefficients: number[]; rms: number[] };
  };
  players: PlayerProfile[];
  teamRosters: TeamRoster[];
};

export type NbaLiveRosterSnapshot = {
  release: typeof NBA_ROSTER_REGIME_RELEASE;
  status: "complete" | "unavailable";
  observedAt: string | null;
  reason: string | null;
  playerIdsByTeam: ReadonlyMap<number, readonly number[]>;
};

export type NbaRosterRegimeAudit = {
  release: typeof NBA_ROSTER_REGIME_RELEASE;
  status: "applied" | "stable_roster" | "unavailable";
  reason: string | null;
  homeRetainedMinutesShare: number | null;
  awayRetainedMinutesShare: number | null;
  homeExcludedOutPlayers: string[];
  awayExcludedOutPlayers: string[];
  marginCorrection: number;
  totalCorrection: number;
  primaryMarginCorrection: number;
  winnerConfirmationMarginCorrection: number;
  winnerConfirmationApplied: boolean;
};

const profileById = new Map(artifact.players.map((player) => [player.id, player]));
const priorRosterByTeam = new Map(artifact.teamRosters.map((team) => [team.teamId, team.playerIds]));
const teamIdByAbbreviation = new Map(artifact.teamRosters.map((team) => [team.team, team.teamId]));
const abbreviationAliases: Readonly<Record<string, string>> = {
  GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS",
};

function normalizeName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/[^a-z0-9]/g, "");
}

function teamId(abbreviation: string): number | null {
  const normalized = abbreviationAliases[abbreviation.trim().toUpperCase()] ?? abbreviation.trim().toUpperCase();
  return teamIdByAbbreviation.get(normalized) ?? null;
}

function outNames(injuries: readonly NbaPlayerInjury[]): Set<string> {
  return new Set(injuries.filter((injury) => injury.status === "out").map((injury) => normalizeName(injury.name)));
}

function weighted(players: readonly PlayerProfile[], field: "pie" | "estimatedNet"): number | null {
  const minutes = players.reduce((sum, player) => sum + player.minutes, 0);
  return minutes > 0
    ? players.reduce((sum, player) => sum + player.minutes * player[field], 0) / minutes
    : null;
}

function rotation(args: {
  teamId: number;
  currentIds: readonly number[];
  injuries: readonly NbaPlayerInjury[];
}): {
  retained: number;
  netDelta: number;
  pieDelta: number;
  excluded: string[];
} | null {
  const previousIds = priorRosterByTeam.get(args.teamId);
  if (!previousIds) return null;
  const excludedNames = outNames(args.injuries);
  const excluded: string[] = [];
  const current = args.currentIds.flatMap((id) => {
    const player = profileById.get(id);
    if (!player) return [];
    if (excludedNames.has(normalizeName(player.name))) {
      excluded.push(player.name);
      return [];
    }
    return [player];
  }).sort((left, right) => right.minutes - left.minutes).slice(0, 8);
  const previous = previousIds.flatMap((id) => {
    const player = profileById.get(id);
    return player ? [player] : [];
  }).sort((left, right) => right.minutes - left.minutes).slice(0, 8);
  if (current.length === 0 || previous.length === 0) return null;
  const currentMinutes = current.reduce((sum, player) => sum + player.minutes, 0);
  const previousSet = new Set(previousIds);
  const retainedMinutes = current
    .filter((player) => previousSet.has(player.id))
    .reduce((sum, player) => sum + player.minutes, 0);
  const currentNet = weighted(current, "estimatedNet");
  const previousNet = weighted(previous, "estimatedNet");
  const currentPie = weighted(current, "pie");
  const previousPie = weighted(previous, "pie");
  if (
    currentMinutes <= 0 || currentNet === null || previousNet === null ||
    currentPie === null || previousPie === null
  ) return null;
  return {
    retained: retainedMinutes / currentMinutes,
    netDelta: currentNet - previousNet,
    pieDelta: currentPie - previousPie,
    excluded: [...new Set(excluded)].sort(),
  };
}

function correction(values: readonly number[], head: NbaRosterRegimeArtifact["margin"]): number {
  if (values.length !== head.coefficients.length || values.length !== head.rms.length) {
    throw new Error("NBA roster-regime artifact dimensions are incoherent.");
  }
  return values.reduce((sum, value, index) => sum +
    (value / head.rms[index]!) * head.coefficients[index]!, 0);
}

function confirmedMarginCorrection(args: {
  independentMargin: number;
  primaryCorrection: number;
  confirmationCorrection: number;
}): { correction: number; applied: boolean } {
  const side = (margin: number) => margin >= 0 ? "home" : "away";
  const independentSide = side(args.independentMargin);
  const primarySide = side(args.independentMargin + args.primaryCorrection);
  const confirmationSide = side(args.independentMargin + args.confirmationCorrection);
  const applied = primarySide !== independentSide && confirmationSide !== primarySide;
  return {
    correction: applied ? args.confirmationCorrection : args.primaryCorrection,
    applied,
  };
}

export function applyNbaRosterRegime(args: {
  independent: NbaPortableScore;
  providerSeason: number;
  homeTeam: string;
  awayTeam: string;
  homeCurrentGames: number;
  awayCurrentGames: number;
  homeInjuries: readonly NbaPlayerInjury[];
  awayInjuries: readonly NbaPlayerInjury[];
  liveRoster: NbaLiveRosterSnapshot;
}): { score: NbaPortableScore; audit: NbaRosterRegimeAudit } {
  const neutral = (reason: string): { score: NbaPortableScore; audit: NbaRosterRegimeAudit } => ({
    score: args.independent,
    audit: {
      release: NBA_ROSTER_REGIME_RELEASE,
      status: "unavailable",
      reason,
      homeRetainedMinutesShare: null,
      awayRetainedMinutesShare: null,
      homeExcludedOutPlayers: [],
      awayExcludedOutPlayers: [],
      marginCorrection: 0,
      totalCorrection: 0,
      primaryMarginCorrection: 0,
      winnerConfirmationMarginCorrection: 0,
      winnerConfirmationApplied: false,
    },
  });
  if (artifact.release !== NBA_ROSTER_REGIME_RELEASE) return neutral("artifact_release_mismatch");
  if (artifact.providerSeason !== args.providerSeason) return neutral("provider_season_mismatch");
  if (args.liveRoster.status !== "complete") return neutral(args.liveRoster.reason ?? "live_roster_unavailable");
  const homeTeamId = teamId(args.homeTeam);
  const awayTeamId = teamId(args.awayTeam);
  if (homeTeamId === null || awayTeamId === null) return neutral("team_identity_unavailable");
  const homeIds = args.liveRoster.playerIdsByTeam.get(homeTeamId);
  const awayIds = args.liveRoster.playerIdsByTeam.get(awayTeamId);
  if (!homeIds || !awayIds) return neutral("active_roster_unavailable");
  const home = rotation({ teamId: homeTeamId, currentIds: homeIds, injuries: args.homeInjuries });
  const away = rotation({ teamId: awayTeamId, currentIds: awayIds, injuries: args.awayInjuries });
  if (!home || !away) return neutral("prior_player_profile_unavailable");

  const sideValues = (state: typeof home, games: number, threshold: number) => {
    if (state.retained > threshold) return [0, 0, 0] as const;
    const decay = artifact.decayGames / (Math.max(0, games) + artifact.decayGames);
    const turnoverDecay = (1 - state.retained) * decay;
    return [state.netDelta * turnoverDecay, state.pieDelta * turnoverDecay, turnoverDecay] as const;
  };
  const homeValues = sideValues(home, args.homeCurrentGames, artifact.retainedMinutesThreshold);
  const awayValues = sideValues(away, args.awayCurrentGames, artifact.retainedMinutesThreshold);
  const values = [
    homeValues[0], awayValues[0], homeValues[1], awayValues[1], homeValues[2], awayValues[2],
  ];
  const primaryMarginCorrection = correction(values, artifact.margin);
  const totalCorrection = correction(values, artifact.total);
  const confirmationHomeValues = sideValues(
    home,
    args.homeCurrentGames,
    artifact.winnerConfirmation.retainedMinutesThreshold,
  );
  const confirmationAwayValues = sideValues(
    away,
    args.awayCurrentGames,
    artifact.winnerConfirmation.retainedMinutesThreshold,
  );
  const confirmationValues = [
    confirmationHomeValues[0] - confirmationAwayValues[0],
    confirmationHomeValues[1] - confirmationAwayValues[1],
    confirmationHomeValues[2] - confirmationAwayValues[2],
  ];
  const winnerConfirmationMarginCorrection = correction(
    confirmationValues,
    artifact.winnerConfirmation.margin,
  );
  const confirmed = confirmedMarginCorrection({
    independentMargin: args.independent.marginHome,
    primaryCorrection: primaryMarginCorrection,
    confirmationCorrection: winnerConfirmationMarginCorrection,
  });
  const marginCorrection = confirmed.correction;
  const status = values.every((value) => value === 0) ? "stable_roster" as const : "applied" as const;
  const marginHome = args.independent.marginHome + marginCorrection;
  const total = args.independent.total + totalCorrection;
  return {
    score: {
      marginHome,
      total,
      homeScore: (total + marginHome) / 2,
      awayScore: (total - marginHome) / 2,
    },
    audit: {
      release: NBA_ROSTER_REGIME_RELEASE,
      status,
      reason: null,
      homeRetainedMinutesShare: home.retained,
      awayRetainedMinutesShare: away.retained,
      homeExcludedOutPlayers: home.excluded,
      awayExcludedOutPlayers: away.excluded,
      marginCorrection,
      totalCorrection,
      primaryMarginCorrection,
      winnerConfirmationMarginCorrection,
      winnerConfirmationApplied: confirmed.applied,
    },
  };
}

type PlayerEnvelope = { data?: unknown; meta?: { next_cursor?: unknown } | null };

export async function fetchNbaLiveRosterSnapshot(args: {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  now?: string;
} = {}): Promise<NbaLiveRosterSnapshot> {
  const apiKey = args.apiKey ?? process.env.BALLDONTLIE_API_KEY;
  const unavailable = (reason: string): NbaLiveRosterSnapshot => ({
    release: NBA_ROSTER_REGIME_RELEASE,
    status: "unavailable",
    observedAt: null,
    reason,
    playerIdsByTeam: new Map(),
  });
  if (!apiKey) return unavailable("balldontlie_key_unavailable");
  const fetchImpl = args.fetchImpl ?? fetch;
  const playersByTeam = new Map<number, number[]>();
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const url = new URL("https://api.balldontlie.io/v1/players/active");
    url.searchParams.set("per_page", "100");
    if (cursor !== null) url.searchParams.set("cursor", cursor);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      return unavailable("active_roster_request_failed");
    }
    if (!response.ok) return unavailable(`active_roster_http_${response.status}`);
    const envelope = await response.json() as PlayerEnvelope;
    if (!Array.isArray(envelope.data)) return unavailable("active_roster_malformed");
    for (const raw of envelope.data) {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
      const row = raw as Record<string, unknown>;
      const nestedTeam = row.team !== null && typeof row.team === "object" && !Array.isArray(row.team)
        ? row.team as Record<string, unknown> : null;
      const playerId = Number(row.id);
      const providerTeamId = Number(row.team_id ?? nestedTeam?.id);
      if (!Number.isInteger(playerId) || !Number.isInteger(providerTeamId)) continue;
      const ids = playersByTeam.get(providerTeamId) ?? [];
      ids.push(playerId);
      playersByTeam.set(providerTeamId, ids);
    }
    const next = envelope.meta?.next_cursor;
    cursor = typeof next === "string" || typeof next === "number" ? String(next) : null;
    if (cursor === null) {
      const completeTeams = [...playersByTeam.keys()].filter((id) => priorRosterByTeam.has(id)).length;
      if (completeTeams !== artifact.teamRosters.length) {
        return unavailable(`active_roster_team_coverage_${completeTeams}_of_${artifact.teamRosters.length}`);
      }
      return {
        release: NBA_ROSTER_REGIME_RELEASE,
        status: "complete",
        observedAt: args.now ?? new Date().toISOString(),
        reason: null,
        playerIdsByTeam: playersByTeam,
      };
    }
  }
  return unavailable("active_roster_pagination_incomplete");
}

export const __NBA_ROSTER_REGIME_TEST__ = {
  artifact,
  normalizeName,
  rotation,
  confirmedMarginCorrection,
};
