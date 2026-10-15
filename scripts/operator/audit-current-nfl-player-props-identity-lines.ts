#!/usr/bin/env tsx

/** SELECT-only audit of live NFL player/team joins and canonical prop lines. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  nflPlayerPropsCanonicalMarketScopeKey,
  normalizeNflPlayerPropsPlayerIdentity,
  selectNflPlayerPropsCanonicalLines,
} from "../../lib/services/football/nflPlayerPropsCanonicalLine";
import { readNflPlayerPropsCurrentSeasonState } from "../../lib/services/football/nflPlayerPropsCurrentSeasonState";
import { resolveNflForwardWeek } from "../../lib/services/football/nflForwardWeekSelection";
import { readNflPlayerPropsReferenceOffers } from "../../lib/services/football/nflPlayerPropsReferenceOfferStore";
import { readNflPlayerPropsSnapshotRecord } from "../../lib/services/football/nflPlayerPropsSnapshotStore";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const season = Number(argument("season") ?? process.env.NFL_FORWARD_SEASON ?? "2026");
  const configuredWeek = Number(process.env.NFL_FORWARD_WEEK ?? "1");
  const week = Number(argument("week") ?? resolveNflForwardWeek({ season, configuredWeek }));
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const [record, currentSeason, references] = await Promise.all([
    readNflPlayerPropsSnapshotRecord({ client, season, week }),
    readNflPlayerPropsCurrentSeasonState({ client, season }),
    readNflPlayerPropsReferenceOffers({ client, season, week }),
  ]);
  if (!record) throw new Error(`NFL props snapshot is unavailable for ${season} Week ${week}.`);
  if (!currentSeason) throw new Error(`NFL current-season state is unavailable for ${season}.`);

  const rows = record.snapshot.board.decisions;
  const memberRows = record.snapshot.memberDecisions;
  const idNames = group(memberRows.filter((row) => row.providerPlayerId !== null), (row) => `${row.gameId}|${row.providerPlayerId}`);
  const nameIds = group(memberRows.filter((row) => row.providerPlayerId !== null), (row) => `${row.gameId}|${normalizeNflPlayerPropsPlayerIdentity(row.playerName)}`);
  const historicalNamesById = group(currentSeason.stats, (row) => row.playerId);
  const gameRows = group(memberRows, (row) => row.gameId);
  const scopes = group(memberRows, nflPlayerPropsCanonicalMarketScopeKey);
  const canonicalRows = selectNflPlayerPropsCanonicalLines(rows);
  const canonicalKeys = new Set(canonicalRows.map(decisionKey));
  const memberKeys = new Set(memberRows.map(decisionKey));

  const providerIdNameMismatches = [...idNames.entries()].flatMap(([key, values]) => {
    const names = unique(values.map((row) => normalizeNflPlayerPropsPlayerIdentity(row.playerName)));
    return names.length > 1 ? [{ key, names, displayNames: unique(values.map((row) => row.playerName)) }] : [];
  });
  const playerNameIdMismatches = [...nameIds.entries()].flatMap(([key, values]) => {
    const ids = unique(values.map((row) => row.providerPlayerId!));
    return ids.length > 1 ? [{ key, providerPlayerIds: ids }] : [];
  });
  const historicalNameMismatches = memberRows.flatMap((row) => {
    if (!row.providerPlayerId) return [];
    const historical = historicalNamesById.get(row.providerPlayerId) ?? [];
    const names = unique(historical.map((value) => normalizeNflPlayerPropsPlayerIdentity(value.playerName)));
    return names.length > 0 && !names.includes(normalizeNflPlayerPropsPlayerIdentity(row.playerName))
      ? [{ gameId: row.gameId, providerPlayerId: row.providerPlayerId, liveName: row.playerName, historicalNames: unique(historical.map((value) => value.playerName)) }]
      : [];
  });
  const teamOpponentMismatches = [...gameRows.entries()].flatMap(([gameId, values]) => {
    const pairs = unique(values.map((row) => `${row.team}|${row.opponent}`));
    const invalidSelf = values.some((row) => normalize(row.team) === normalize(row.opponent));
    const teams = unique(values.map((row) => row.team));
    const opponents = unique(values.map((row) => row.opponent));
    const reciprocal = teams.length === 2 && teams.every((team) => opponents.some((opponent) => normalize(opponent) === normalize(team)));
    return invalidSelf || teams.length > 2 || opponents.length > 2 || (teams.length === 2 && !reciprocal)
      ? [{ gameId, teams, opponents, pairs }]
      : [];
  });
  const multipleCanonicalLines = [...scopes.entries()].flatMap(([scope, values]) => {
    const lines = unique(values.map((row) => row.line)).sort((a, b) => a - b);
    return lines.length > 1 ? [{ scope, lines }] : [];
  });
  const duplicateBookSides = [...scopes.entries()].flatMap(([scope, values]) => {
    const duplicates = [...group(values, (row) => `${normalize(row.sportsbook)}|${row.side}`).entries()]
      .filter(([, matches]) => matches.length > 1)
      .map(([bookSide, matches]) => ({ bookSide, rows: matches.length }));
    return duplicates.length > 0 ? [{ scope, duplicates }] : [];
  });

  console.log(JSON.stringify({
    release: "nfl_player_props_identity_line_audit_2026_10_15_r1",
    readOnly: true,
    productionWrites: 0,
    season,
    week,
    generatedAt: record.generatedAt,
    snapshotRelease: record.snapshot.release,
    rows: rows.length,
    memberRows: memberRows.length,
    games: gameRows.size,
    playerMarketScopes: scopes.size,
    canonicalRowsSelected: canonicalRows.length,
    alternateLineRows: rows.length - canonicalRows.length,
    canonicalRowsMissingFromMember: [...canonicalKeys].filter((key) => !memberKeys.has(key)),
    nonCanonicalRowsInMember: [...memberKeys].filter((key) => !canonicalKeys.has(key)),
    providerIdNameMismatches,
    playerNameIdMismatches,
    historicalNameMismatches: dedupeObjects(historicalNameMismatches),
    teamOpponentMismatches,
    multipleCanonicalLines,
    duplicateBookSides,
    referenceCache: references ? {
      release: references.release,
      updatedAt: references.updatedAt,
      offers: references.offers.length,
      games: new Set(references.offers.map((row) => row.canonicalGameId)).size,
      books: unique(references.offers.map((row) => normalize(row.sportsbook))),
    } : null,
  }, null, 2));
}

function group<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) grouped.set(key(value), [...(grouped.get(key(value)) ?? []), value]);
  return grouped;
}

function unique<T>(values: readonly T[]): T[] { return [...new Set(values)]; }
function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function decisionKey(row: { gameId: string; playerName: string; team: string; market: string; line: number; side: string; sportsbook: string }): string {
  return [row.gameId, normalizeNflPlayerPropsPlayerIdentity(row.playerName), normalize(row.team), row.market, row.line, row.side, normalize(row.sportsbook)].join("|");
}
function dedupeObjects<T>(values: readonly T[]): T[] { return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()]; }
function argument(name: string): string | null { return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null; }
function requiredEnv(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} is required.`); return value; }

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
