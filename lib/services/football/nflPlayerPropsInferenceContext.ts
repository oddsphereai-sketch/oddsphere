import { createHash } from "node:crypto";
import {
  fetchBalldontlieNflSlateAvailability,
  type NflAvailabilityMatchup,
} from "./balldontlieNflAvailability";
import {
  fetchBalldontlieNflTeamDepthSnapshots,
} from "./balldontlieNflRoster";
import type { NflPreviewTeam } from "./balldontlieNflPreviewSlate";
import {
  fetchBalldontlieNflRegularSlate,
  type NflPreviewBookOdds,
} from "./balldontlieNflPreviewSlate";
import {
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  type NflForwardTeamDepthSnapshot,
  type NflForwardEvidencePayload,
  type NflForwardStoredEvidence,
} from "./nflForwardEvidence";
import type { DailyEdgeGameAvailability } from "../dailyEdge/gameAvailability";
import type { NflPlayerPropsObservationSnapshot } from "./nflPlayerPropsContract";

export const NFL_PLAYER_PROPS_INFERENCE_CONTEXT_RELEASE =
  "nfl_player_props_inference_context_2026_08_25_r3_shared_forward_evidence" as const;

export type NflPlayerPropsInferenceGameContext = {
  canonicalGameId: string;
  scheduledStart: string;
  awayTeam: string;
  homeTeam: string;
  awayDepth: NflForwardTeamDepthSnapshot;
  homeDepth: NflForwardTeamDepthSnapshot;
  injuries: DailyEdgeGameAvailability;
  mainMarket: {
    capturedAt: string;
    currentBooks: NflPreviewBookOdds[];
  };
};

export type NflPlayerPropsInferenceContext = {
  release: typeof NFL_PLAYER_PROPS_INFERENCE_CONTEXT_RELEASE;
  source: "direct_provider" | "nfl_forward_evidence";
  providerSnapshotRelease: NflPlayerPropsObservationSnapshot["snapshotRelease"];
  providerSnapshotGeneratedAt: string;
  capturedAt: string;
  season: number;
  week: number;
  phase: NflPlayerPropsObservationSnapshot["phase"];
  games: NflPlayerPropsInferenceGameContext[];
  requestBudget: { teams: number; rosters: number; injuriesMaximum: number; mainMarket: number; totalMaximum: number };
  coverage: {
    games: number;
    teams: number;
    depthTeams: number;
    injuryGames: number;
    expectedQuarterbacks: number;
    mainMarketGames: number;
  };
  sourceSha256: string;
  healthHolds: string[];
};

export async function collectNflPlayerPropsInferenceContext(args: {
  snapshot: NflPlayerPropsObservationSnapshot;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  capturedAt?: string;
}): Promise<NflPlayerPropsInferenceContext> {
  const apiKey = args.apiKey ?? process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required for NFL props inference context.");
  const fetchImpl = args.fetchImpl ?? fetch;
  const capturedAt = args.capturedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error("NFL props context capturedAt is invalid.");
  if (args.snapshot.games.length < 1 || args.snapshot.games.length > 18) throw new Error("NFL props context slate size is invalid.");
  const teams = await fetchTeams(apiKey, fetchImpl);
  const requested = [...new Set(args.snapshot.games.flatMap((game) => [game.awayTeam, game.homeTeam]))];
  const selectedTeams = requested.map((abbreviation) => teams.get(abbreviation)).filter((team): team is NflPreviewTeam => team !== undefined);
  if (selectedTeams.length !== requested.length) throw new Error("NFL props context team identity is incomplete.");
  const depth = await fetchBalldontlieNflTeamDepthSnapshots({ teams: selectedTeams, season: args.snapshot.season, capturedAt, apiKey, fetchImpl });
  const matchupArgs: NflAvailabilityMatchup[] = args.snapshot.games.map((game) => ({
    id: game.providerGameId,
    awayTeam: game.awayTeam,
    homeTeam: game.homeTeam,
    awayTeamId: teams.get(game.awayTeam)!.id,
    homeTeamId: teams.get(game.homeTeam)!.id,
  }));
  const availability = await fetchBalldontlieNflSlateAvailability(matchupArgs, { apiKey, fetchImpl });
  if (!availability) throw new Error("NFL props context injury collection is unavailable.");
  const mainMarket = await fetchBalldontlieNflRegularSlate({ season: args.snapshot.season, week: args.snapshot.week, apiKey, fetchImpl });
  const byGame = new Map(availability.map((game) => [game.eventId, game]));
  const games = args.snapshot.games.map((game) => {
    const awayDepth = depth.byTeam[game.awayTeam];
    const homeDepth = depth.byTeam[game.homeTeam];
    const injuries = byGame.get(game.providerGameId);
    if (!awayDepth || !homeDepth || !injuries) throw new Error(`NFL props context is incomplete for ${game.providerGameId}.`);
    const currentBooks = mainMarket.currentOddsAllBooksByGame[game.providerGameId] ?? [];
    return { canonicalGameId: game.providerGameId, scheduledStart: game.scheduledStart, awayTeam: game.awayTeam, homeTeam: game.homeTeam, awayDepth, homeDepth, injuries, mainMarket: { capturedAt: mainMarket.fetchedAt, currentBooks } };
  });
  const healthHolds = [
    games.some((game) => !game.awayDepth.expectedStartingQuarterback || !game.homeDepth.expectedStartingQuarterback) ? "expected_quarterback_incomplete" : null,
    games.some((game) => game.injuries.reportUpdatedAt === null) ? "injury_report_timestamp_incomplete" : null,
    games.some((game) => game.mainMarket.currentBooks.length === 0) ? "main_market_incomplete" : null,
  ].filter((value): value is string => value !== null);
  const sourceSha256 = createHash("sha256").update(JSON.stringify({ snapshot: args.snapshot.snapshotRelease, generatedAt: args.snapshot.generatedAt, capturedAt, games })).digest("hex");
  return {
    release: NFL_PLAYER_PROPS_INFERENCE_CONTEXT_RELEASE,
    source: "direct_provider",
    providerSnapshotRelease: args.snapshot.snapshotRelease,
    providerSnapshotGeneratedAt: args.snapshot.generatedAt,
    capturedAt,
    season: args.snapshot.season,
    week: args.snapshot.week,
    phase: args.snapshot.phase,
    games,
    requestBudget: { teams: 1, rosters: depth.requests, injuriesMaximum: 4, mainMarket: mainMarket.providerRequests, totalMaximum: 1 + depth.requests + 4 + mainMarket.providerRequests },
    coverage: {
      games: games.length,
      teams: selectedTeams.length,
      depthTeams: Object.keys(depth.byTeam).length,
      injuryGames: availability.length,
      expectedQuarterbacks: games.reduce((count, game) => count + Number(Boolean(game.awayDepth.expectedStartingQuarterback)) + Number(Boolean(game.homeDepth.expectedStartingQuarterback)), 0),
      mainMarketGames: games.filter((game) => game.mainMarket.currentBooks.length > 0).length,
    },
    sourceSha256,
    healthHolds,
  };
}

export function buildNflPlayerPropsInferenceContextFromForwardEvidence(args: {
  snapshot: NflPlayerPropsObservationSnapshot;
  evidence: NflForwardStoredEvidence[];
  capturedAt: string;
}): NflPlayerPropsInferenceContext & { source: "nfl_forward_evidence" } {
  const capturedAtMs = Date.parse(args.capturedAt);
  if (!Number.isFinite(capturedAtMs)) throw new Error("NFL props shared context capturedAt is invalid.");
  const latest = new Map<string, NflForwardStoredEvidence & { payload: NflForwardEvidencePayload }>();
  for (const row of args.evidence) {
    if (row.payload.schemaRelease !== NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE) continue;
    if (row.payload.season !== args.snapshot.season || row.payload.week !== args.snapshot.week) continue;
    if (Date.parse(row.capturedAt) > capturedAtMs) continue;
    const current = latest.get(row.providerGameId);
    if (!current || compareEvidence(row, current) > 0) {
      latest.set(row.providerGameId, row as NflForwardStoredEvidence & { payload: NflForwardEvidencePayload });
    }
  }
  const sourceRows: Array<NflForwardStoredEvidence & { payload: NflForwardEvidencePayload }> = [];
  const games = args.snapshot.games.map((game) => {
    const row = latest.get(game.providerGameId);
    if (!row) throw new Error(`NFL props shared context is missing forward evidence for ${game.providerGameId}.`);
    const payload = row.payload;
    if (Date.parse(payload.game.scheduledStart) !== Date.parse(game.scheduledStart)
      || payload.game.away.abbreviation !== game.awayTeam
      || payload.game.home.abbreviation !== game.homeTeam) {
      throw new Error(`NFL props shared context game identity mismatch for ${game.providerGameId}.`);
    }
    if (!payload.injuries) throw new Error(`NFL props shared context injury evidence is missing for ${game.providerGameId}.`);
    if (!payload.coverage.rosterAndDepth || payload.market.currentBooks.length === 0) {
      throw new Error(`NFL props shared context coverage is incomplete for ${game.providerGameId}.`);
    }
    sourceRows.push(row);
    return {
      canonicalGameId: game.providerGameId,
      scheduledStart: game.scheduledStart,
      awayTeam: game.awayTeam,
      homeTeam: game.homeTeam,
      awayDepth: payload.startersAndDepth.away,
      homeDepth: payload.startersAndDepth.home,
      injuries: payload.injuries,
      mainMarket: { capturedAt: payload.capturedAt, currentBooks: payload.market.currentBooks },
    };
  });
  const healthHolds = [
    games.some((game) => !game.awayDepth.expectedStartingQuarterback || !game.homeDepth.expectedStartingQuarterback) ? "expected_quarterback_incomplete" : null,
    games.some((game) => game.injuries.reportUpdatedAt === null) ? "injury_report_timestamp_incomplete" : null,
    games.some((game) => game.mainMarket.currentBooks.length === 0) ? "main_market_incomplete" : null,
  ].filter((value): value is string => value !== null);
  const sourceSha256 = createHash("sha256").update(JSON.stringify({
    snapshot: args.snapshot.snapshotRelease,
    generatedAt: args.snapshot.generatedAt,
    capturedAt: args.capturedAt,
    evidence: sourceRows.map((row) => ({ id: row.id, capturedAt: row.capturedAt, sha256: row.payloadSha256 })),
  })).digest("hex");
  return {
    release: NFL_PLAYER_PROPS_INFERENCE_CONTEXT_RELEASE,
    source: "nfl_forward_evidence",
    providerSnapshotRelease: args.snapshot.snapshotRelease,
    providerSnapshotGeneratedAt: args.snapshot.generatedAt,
    capturedAt: new Date(capturedAtMs).toISOString(),
    season: args.snapshot.season,
    week: args.snapshot.week,
    phase: args.snapshot.phase,
    games,
    requestBudget: { teams: 0, rosters: 0, injuriesMaximum: 0, mainMarket: 0, totalMaximum: 0 },
    coverage: {
      games: games.length,
      teams: new Set(games.flatMap((game) => [game.awayTeam, game.homeTeam])).size,
      depthTeams: games.length * 2,
      injuryGames: games.length,
      expectedQuarterbacks: games.reduce((count, game) => count + Number(Boolean(game.awayDepth.expectedStartingQuarterback)) + Number(Boolean(game.homeDepth.expectedStartingQuarterback)), 0),
      mainMarketGames: games.filter((game) => game.mainMarket.currentBooks.length > 0).length,
    },
    sourceSha256,
    healthHolds,
  };
}

function compareEvidence(first: NflForwardStoredEvidence, second: NflForwardStoredEvidence): number {
  const timestamp = Date.parse(first.capturedAt) - Date.parse(second.capturedAt);
  if (timestamp !== 0) return timestamp;
  const stageRank = { opening: 0, unlocked: 1, t60: 2 } as const;
  return stageRank[first.stage] - stageRank[second.stage];
}

async function fetchTeams(apiKey: string, fetchImpl: typeof fetch): Promise<Map<string, NflPreviewTeam>> {
  const response = await fetchImpl("https://api.balldontlie.io/nfl/v1/teams", {
    headers: { Authorization: apiKey, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`BALLDONTLIE NFL teams failed with HTTP ${response.status}.`);
  const body = await response.json() as { data?: unknown };
  if (!Array.isArray(body.data)) throw new Error("BALLDONTLIE NFL teams payload is malformed.");
  const teams = new Map<string, NflPreviewTeam>();
  for (const value of body.data) {
    if (value === null || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const id = typeof row.id === "number" && Number.isInteger(row.id) ? row.id : null;
    const abbreviation = typeof row.abbreviation === "string" ? row.abbreviation.trim().toUpperCase() : null;
    const name = typeof row.full_name === "string" ? row.full_name.trim() : abbreviation;
    if (id !== null && abbreviation && name) teams.set(abbreviation, { id, abbreviation, name });
  }
  return teams;
}
