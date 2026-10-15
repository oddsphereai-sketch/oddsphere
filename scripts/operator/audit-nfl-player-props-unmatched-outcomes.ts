#!/usr/bin/env tsx

/**
 * SELECT-only audit of NFL private-tracking rows that do not join to the
 * retained BALLDONTLIE player-stat state. This script does not settle rows or
 * mutate locked records; it exports the evidence needed to distinguish an
 * identity mismatch from a valid player omitted from the box score.
 */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import {
  readNflPlayerPropsCurrentSeasonState,
  type NflPlayerPropsCurrentSeasonStat,
} from "../../lib/services/football/nflPlayerPropsCurrentSeasonState";
import type { NflPlayerPropsPrivateTrackingHistory } from "../../lib/services/football/nflPlayerPropsPrivateTrackingStore";

loadEnvConfig(process.cwd());

type Evidence = Readonly<{ privateHistory: NflPlayerPropsPrivateTrackingHistory }>;

async function main(): Promise<void> {
  const season = numberArg("season", 2026);
  const week = numberArg("week", 5);
  const input = stringArg("input");
  const output = stringArg("out");
  if (!input) throw new Error("--input=<loss-ledger-evidence.json> is required");
  const evidence = JSON.parse(readFileSync(input, "utf8")) as Evidence;
  if (evidence.privateHistory.season !== season || evidence.privateHistory.week !== week) {
    throw new Error("Private-history season/week does not match the requested audit scope.");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const state = await readNflPlayerPropsCurrentSeasonState({ client, season });
  if (!state) throw new Error(`NFL current-season state is unavailable for ${season}.`);

  const byId = new Map(state.stats.map((row) => [`${row.gameId}|${row.playerId}`, row]));
  const byName = new Map(state.stats.map((row) => [`${row.gameId}|${normalize(row.playerName)}`, row]));
  const unmatched = evidence.privateHistory.rows.filter((row) => {
    const exact = row.providerPlayerId ? byId.get(`${row.gameId}|${row.providerPlayerId}`) : undefined;
    return !exact && !byName.get(`${row.gameId}|${normalize(row.playerName)}`);
  });
  const scopes = new Map<string, typeof unmatched>();
  for (const row of unmatched) {
    const key = `${row.gameId}|${row.providerPlayerId ?? ""}|${normalize(row.playerName)}|${row.market}`;
    scopes.set(key, [...(scopes.get(key) ?? []), row]);
  }
  const allStatsByPlayerId = group(state.stats, (row) => row.playerId);
  const allStatsByName = group(state.stats, (row) => normalize(row.playerName));
  const report = {
    release: "nfl_player_props_unmatched_outcomes_audit_2026_10_15_r1",
    readOnly: true,
    productionWrites: 0,
    lockedRecordMutations: 0,
    season,
    week,
    exactOfferRows: unmatched.length,
    scopes: [...scopes.values()].map((rows) => {
      const row = rows[0];
      const game = state.games.find((candidate) => candidate.gameId === row.gameId) ?? null;
      const gameStats = state.stats.filter((candidate) => candidate.gameId === row.gameId);
      const nameMatches = allStatsByName.get(normalize(row.playerName)) ?? [];
      const idMatches = row.providerPlayerId ? allStatsByPlayerId.get(row.providerPlayerId) ?? [] : [];
      return {
        gameId: row.gameId,
        scheduledStart: row.scheduledStart,
        playerName: row.playerName,
        providerPlayerId: row.providerPlayerId,
        team: row.team,
        opponent: row.opponent,
        market: row.market,
        exactOfferCount: rows.length,
        sportsbooks: [...new Set(rows.map((candidate) => candidate.sportsbook))].sort(),
        lines: [...new Set(rows.map((candidate) => candidate.line))].sort((a, b) => a - b),
        healthHolds: [...new Set(rows.flatMap((candidate) => candidate.healthHolds))].sort(),
        game,
        sameProviderIdOtherGames: summarize(idMatches),
        sameNormalizedNameOtherGames: summarize(nameMatches),
        sameGameSameTeamStats: summarize(gameStats.filter((candidate) => candidate.team === row.team)),
      };
    }),
  };
  const encoded = `${JSON.stringify(report, null, 2)}\n`;
  if (output) writeFileSync(output, encoded, "utf8");
  else process.stdout.write(encoded);
}

function summarize(rows: readonly NflPlayerPropsCurrentSeasonStat[]) {
  return rows.map((row) => ({
    gameId: row.gameId,
    week: row.week,
    playerId: row.playerId,
    playerName: row.playerName,
    team: row.team,
  }));
}

function group<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) result.set(key(row), [...(result.get(key(row)) ?? []), row]);
  return result;
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function numberArg(name: string, fallback: number): number {
  const value = stringArg(name);
  return value === null ? fallback : Number(value);
}

function stringArg(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
