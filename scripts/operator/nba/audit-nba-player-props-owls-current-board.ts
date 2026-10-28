#!/usr/bin/env tsx

/**
 * Read-only same-input audit of Owl's Insight NBA prop prices on the current
 * unlocked board. It uses the production collector and frozen runtime, makes
 * provider reads only, and performs no database, lock, tracking, or member writes.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

import { collectNbaPlayerPropsLiveMarket } from "../../../lib/services/nba/nbaPlayerPropsLiveCollector";
import { readNbaPlayerPropsCurrentState } from "../../../lib/services/nba/nbaPlayerPropsCurrentState";
import {
  buildNbaPlayerPropsForwardDecisions,
  buildNbaPlayerPropsForwardDecisionsFromArtifactForAudit,
  nbaPlayerPropsFrozenRuntimeArtifact,
  type NbaPlayerPropsForwardDecision,
} from "../../../lib/services/nba/nbaPlayerPropsFrozenRuntime";
import { readNbaPlayerPropsMarketHistory } from "../../../lib/services/nba/nbaPlayerPropsPrivateStore";
import {
  buildNbaPlayerPropsPointInTimeFeatures,
  type NbaPlayerPropCandidate,
} from "../../../lib/services/nba/nbaPlayerPropsPointInTimeFeatures";

loadEnvConfig(argument("env-dir") ?? process.cwd());

const LOCK_LEAD_MS = 60 * 60_000;

async function main(): Promise<void> {
  const slateDate = requiredArgument("date");
  const season = Number(argument("season") ?? slateDate.slice(0, 4));
  const evaluatedAt = new Date().toISOString();
  const client = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [prior, current, history] = await Promise.all([
    readNbaPlayerPropsCurrentState({ client, season: season - 1 }),
    readNbaPlayerPropsCurrentState({ client, season }),
    readNbaPlayerPropsMarketHistory({ client, slateDate }),
  ]);
  if (!prior || !current) throw new Error("NBA props current-state inputs are incomplete.");

  const players = new Map([...prior.players, ...current.players].map((row) => [row.playerId, row]));
  const live = await collectNbaPlayerPropsLiveMarket({
    slateDate,
    ballDontLieApiKey: required("BALLDONTLIE_API_KEY"),
    owlsInsightApiKey: required("OWLS_INSIGHT_API_KEY"),
    includeOpenings: false,
    useTheOddsApiForGameIds: new Set(),
    canonicalPlayersByName: Object.fromEntries([...players.values()].flatMap((player) => player.playerName
      ? [[normalize(player.playerName), `nba-bdl-player:${player.playerId}`] as const]
      : [])),
    knownPlayerIdentitiesById: Object.fromEntries([...players.values()].map((player) => [String(player.playerId), {
      playerName: player.playerName,
      playerTeam: player.latestTeamId === null ? null : String(player.latestTeamId),
    }])),
  });
  const candidates: NbaPlayerPropCandidate[] = [];
  const candidateKeys = new Set<string>();
  const upcomingGames = live.games.flatMap((game) => {
    const ids = live.teamIdsByGame[game.canonicalGameId];
    if (!ids) return [];
    return [{
      gameId: Number(game.providerGameId),
      season,
      startTime: game.scheduledStart,
      homeTeamId: ids.home,
      awayTeamId: ids.away,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
    }];
  });
  const gameById = new Map(upcomingGames.map((game) => [game.gameId, game]));
  for (const row of live.observations) {
    if (!row.canonicalGameId) continue;
    const gameId = Number(row.canonicalGameId.replace(/^.*:/, ""));
    const playerId = playerIdFromObservation(row.canonicalPlayerId);
    if (playerId === null) continue;
    const game = gameById.get(gameId);
    const player = players.get(playerId);
    if (!game || !player || player.latestTeamId === null) continue;
    const teamId = player.latestTeamId;
    if (teamId !== game.homeTeamId && teamId !== game.awayTeamId) continue;
    const key = `${gameId}|${playerId}`;
    if (candidateKeys.has(key)) continue;
    candidateKeys.add(key);
    candidates.push({ gameId, playerId, playerName: player.playerName ?? row.playerName, teamId });
  }
  const features = buildNbaPlayerPropsPointInTimeFeatures({
    games: [...prior.games, ...current.games],
    upcomingGames,
    boxes: [...prior.boxes, ...current.boxes],
    advanced: [...prior.advanced, ...current.advanced],
    candidates,
    emitGameIds: new Set(upcomingGames.map((game) => game.gameId)),
  });
  const baselineCurrent = live.observations.filter((row) => row.provider !== "owls");
  const owlsCurrent = live.observations.filter((row) => row.provider === "owls");
  const stored = history?.observations ?? [];
  const baseline = buildNbaPlayerPropsForwardDecisions({
    features,
    observations: [...stored, ...baselineCurrent],
    currentObservations: baselineCurrent,
    evaluatedAt,
  });
  const candidate = buildNbaPlayerPropsForwardDecisions({
    features,
    observations: [...stored, ...baselineCurrent, ...owlsCurrent],
    currentObservations: [...baselineCurrent, ...owlsCurrent],
    evaluatedAt,
  });
  const incumbentArtifact = nbaPlayerPropsFrozenRuntimeArtifact();
  const readerCandidateArtifact = {
    ...incumbentArtifact,
    selectedByMarket: {
      ...incumbentArtifact.selectedByMarket,
      rebounds: "market_read_all_disagreements",
      points_rebounds_assists: "ridge_r2_minutes_regression",
    },
    candidateMarketMinimumDistance: {
      ...incumbentArtifact.candidateMarketMinimumDistance,
      rebounds: 0,
      points_rebounds_assists: null,
    },
    exactPriceArbitrationMinimumDistance: {
      ...incumbentArtifact.exactPriceArbitrationMinimumDistance,
      rebounds: null,
      points_rebounds_assists: null,
    },
  };
  const readerCandidate = buildNbaPlayerPropsForwardDecisionsFromArtifactForAudit({
    artifact: readerCandidateArtifact,
    features,
    observations: [...stored, ...baselineCurrent, ...owlsCurrent],
    currentObservations: [...baselineCurrent, ...owlsCurrent],
    evaluatedAt,
  });
  const unlockedGameIds = new Set(upcomingGames
    .filter((game) => Date.parse(game.startTime) - LOCK_LEAD_MS > Date.parse(evaluatedAt))
    .map((game) => game.gameId));
  const baselineUnlocked = baseline.filter((row) => unlockedGameIds.has(row.gameId));
  const candidateUnlocked = candidate.filter((row) => unlockedGameIds.has(row.gameId));
  const readerCandidateUnlocked = readerCandidate.filter((row) => unlockedGameIds.has(row.gameId));
  const baselineByScope = new Map(baselineUnlocked.map((row) => [scope(row), row]));
  const candidateByScope = new Map(candidateUnlocked.map((row) => [scope(row), row]));
  const common = [...baselineByScope.keys()].filter((key) => candidateByScope.has(key));
  const changes = common.flatMap((key) => {
    const before = baselineByScope.get(key)!;
    const after = candidateByScope.get(key)!;
    if (before.side === after.side && before.grade === after.grade
      && before.finalProjection === after.finalProjection && before.sportsbook === after.sportsbook
      && before.line === after.line) return [];
    return [{
      player: after.playerName,
      market: after.market,
      before: compact(before),
      after: compact(after),
    }];
  });
  const readerChanges = compare(candidateUnlocked, readerCandidateUnlocked);
  process.stdout.write(`${JSON.stringify({
    release: "nba_player_props_owls_current_board_audit_2026_10_28_r1",
    mode: "read_only",
    publicWrites: false,
    lockWrites: false,
    trackingWrites: false,
    slateDate,
    evaluatedAt,
    providerRequests: live.providerRequests,
    findings: live.findings,
    inputs: {
      games: live.games.length,
      unlockedGames: unlockedGameIds.size,
      features: features.length,
      baselineObservations: baselineCurrent.length,
      owlsObservations: owlsCurrent.length,
      owlsBooks: counts(owlsCurrent.map((row) => row.sportsbook)),
      owlsMarkets: counts(owlsCurrent.map((row) => row.market)),
    },
    baseline: summarize(baselineUnlocked),
    candidate: summarize(candidateUnlocked),
    readerCandidate: summarize(readerCandidateUnlocked),
    impact: {
      commonRows: common.length,
      newlyCoveredRows: [...candidateByScope.keys()].filter((key) => !baselineByScope.has(key)).length,
      removedRows: [...baselineByScope.keys()].filter((key) => !candidateByScope.has(key)).length,
      sideChanges: changes.filter((row) => row.before.side !== row.after.side).length,
      promotions: changes.filter((row) => rank(row.after.grade) > rank(row.before.grade)).length,
      demotions: changes.filter((row) => rank(row.after.grade) < rank(row.before.grade)).length,
      actionablePromotions: changes.filter((row) => rank(row.after.grade) >= 2 && rank(row.before.grade) < 2).length,
      actionableDemotions: changes.filter((row) => rank(row.before.grade) >= 2 && rank(row.after.grade) < 2).length,
    },
    changes,
    readerCandidateImpact: impact(readerChanges, candidateUnlocked, readerCandidateUnlocked),
    readerCandidateChanges: readerChanges,
    combinedImpact: impact(compare(baselineUnlocked, readerCandidateUnlocked), baselineUnlocked, readerCandidateUnlocked),
  }, null, 2)}\n`);
}

function compare(
  beforeRows: readonly NbaPlayerPropsForwardDecision[],
  afterRows: readonly NbaPlayerPropsForwardDecision[],
) {
  const beforeByScope = new Map(beforeRows.map((row) => [scope(row), row]));
  const afterByScope = new Map(afterRows.map((row) => [scope(row), row]));
  return [...beforeByScope.keys()].filter((key) => afterByScope.has(key)).flatMap((key) => {
    const before = beforeByScope.get(key)!;
    const after = afterByScope.get(key)!;
    if (before.side === after.side && before.grade === after.grade
      && before.finalProjection === after.finalProjection && before.sportsbook === after.sportsbook
      && before.line === after.line) return [];
    return [{ player: after.playerName, market: after.market, before: compact(before), after: compact(after) }];
  });
}

function impact(
  changes: ReturnType<typeof compare>,
  beforeRows: readonly NbaPlayerPropsForwardDecision[],
  afterRows: readonly NbaPlayerPropsForwardDecision[],
) {
  const beforeScopes = new Set(beforeRows.map(scope));
  const afterScopes = new Set(afterRows.map(scope));
  return {
    commonRows: [...beforeScopes].filter((key) => afterScopes.has(key)).length,
    newlyCoveredRows: [...afterScopes].filter((key) => !beforeScopes.has(key)).length,
    removedRows: [...beforeScopes].filter((key) => !afterScopes.has(key)).length,
    sideChanges: changes.filter((row) => row.before.side !== row.after.side).length,
    promotions: changes.filter((row) => rank(row.after.grade) > rank(row.before.grade)).length,
    demotions: changes.filter((row) => rank(row.after.grade) < rank(row.before.grade)).length,
    actionablePromotions: changes.filter((row) => rank(row.after.grade) >= 2 && rank(row.before.grade) < 2).length,
    actionableDemotions: changes.filter((row) => rank(row.before.grade) >= 2 && rank(row.after.grade) < 2).length,
  };
}

function summarize(rows: readonly NbaPlayerPropsForwardDecision[]) {
  return {
    rows: rows.length,
    sides: counts(rows.map((row) => row.side)),
    grades: counts(rows.map((row) => row.grade)),
    books: counts(rows.map((row) => row.sportsbook)),
    evidenceModes: counts(rows.map((row) => row.marketEvidenceMode)),
    byMarket: Object.fromEntries([...new Set(rows.map((row) => row.market))].sort().map((market) => [market, {
      rows: rows.filter((row) => row.market === market).length,
      sides: counts(rows.filter((row) => row.market === market).map((row) => row.side)),
      grades: counts(rows.filter((row) => row.market === market).map((row) => row.grade)),
    }])),
  };
}

function compact(row: NbaPlayerPropsForwardDecision) {
  return {
    side: row.side,
    projection: row.finalProjection,
    grade: row.grade,
    sportsbook: row.sportsbook,
    line: row.line,
    price: row.americanPrice,
    targetExcludedBooks: row.targetExcludedBooks,
    targetExcludedReferenceBooks: row.targetExcludedReferenceBooks,
    marketEvidenceMode: row.marketEvidenceMode,
  };
}

function scope(row: NbaPlayerPropsForwardDecision): string { return `${row.gameId}|${row.playerId}|${row.market}`; }
function rank(grade: NbaPlayerPropsForwardDecision["grade"]): number {
  return grade === "Best Angle" ? 3 : grade === "Lean" ? 2 : grade === "Watchlist" ? 1 : 0;
}
function counts(values: readonly string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((result, value) => {
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
}
function playerIdFromObservation(value: string | null): number | null {
  const parsed = Number(value?.match(/(\d+)$/)?.[1]);
  return Number.isInteger(parsed) ? parsed : null;
}
function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function argument(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}
function requiredArgument(name: string): string { const found = argument(name); if (!found) throw new Error(`--${name} is required.`); return found; }
function required(name: string): string { const found = process.env[name]?.trim(); if (!found) throw new Error(`${name} is required.`); return found; }

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
