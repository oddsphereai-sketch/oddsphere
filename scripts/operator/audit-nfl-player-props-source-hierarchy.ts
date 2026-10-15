#!/usr/bin/env tsx

/**
 * SELECT-only audit of source-specific NFL player-prop probabilities.
 *
 * The report joins immutable market-observer landmarks to the immutable
 * full-board private archive and official box-score outcomes. It never writes
 * production state and deliberately keeps sportsbook identities separate.
 */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  decodeNflPlayerPropsMarketObserverHistory,
  nflPlayerPropsMarketObserverKey,
  type NflPlayerPropsMarketObserverLandmark,
  type NflPlayerPropsMarketObserverRow,
} from "../../lib/services/football/nflPlayerPropsMarketObserverStore";
import {
  readNflPlayerPropsPrivateTrackingHistory,
  type NflPlayerPropsPrivateTrackingRow,
} from "../../lib/services/football/nflPlayerPropsPrivateTrackingStore";
import {
  readNflPlayerPropsCurrentSeasonState,
  type NflPlayerPropsCurrentSeasonStat,
} from "../../lib/services/football/nflPlayerPropsCurrentSeasonState";

loadEnvConfig(process.cwd());

type Side = "over" | "under";
type SettledIdentity = {
  key: string;
  actual: number;
  independentProjection: number | null;
};

const SHARP_CONFIRMATION_BOOKS = new Set(["pinnacle", "circa", "novig", "bet365"]);
const LANDMARKS: readonly NflPlayerPropsMarketObserverLandmark[] = ["provider_opening", "t24", "t6", "t60_lock"];

async function main(): Promise<void> {
  const season = Number(argument("season") ?? "2026");
  const week = Number(argument("week") ?? "5");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase service credentials are unavailable.");
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const [{ data, error }, tracking, state] = await Promise.all([
    client.from("lab_response_snapshots").select("payload")
      .eq("snapshot_key", nflPlayerPropsMarketObserverKey(season, week)).maybeSingle(),
    readNflPlayerPropsPrivateTrackingHistory({ client, season, week }),
    readNflPlayerPropsCurrentSeasonState({ client, season }),
  ]);
  if (error) throw new Error(`Market-observer read failed: ${error.message}`);
  const observer = decodeNflPlayerPropsMarketObserverHistory(data?.payload);
  if (!observer || !tracking || !state) throw new Error("Required immutable NFL props evidence is unavailable.");

  const statsById = new Map(state.stats.map((row) => [`${row.gameId}|id:${row.playerId}`, row]));
  const statsByName = new Map(state.stats.map((row) => [`${row.gameId}|name:${normalize(row.playerName)}`, row]));
  const identities = settledIdentities(tracking.rows, statsById, statsByName);
  const output = LANDMARKS.map((landmark) => auditLandmark(observer.rows.filter((row) => row.landmark === landmark), identities));

  process.stdout.write(`${JSON.stringify({
    release: "nfl_player_props_source_hierarchy_audit_2026_10_15_r1",
    readOnly: true,
    productionWrites: 0,
    season,
    week,
    observerRows: observer.rows.length,
    settledCanonicalIdentities: identities.size,
    landmarks: output,
  }, null, 2)}\n`);
}

function auditLandmark(rows: readonly NflPlayerPropsMarketObserverRow[], identities: Map<string, SettledIdentity>) {
  const observations = rows.flatMap((row) => {
    const settled = identities.get(playerMarketKey(row));
    const probability = fairOverProbability(row);
    if (!settled || probability === null || probability === 0.5 || settled.actual === row.canonicalLine) return [];
    const side: Side = probability > 0.5 ? "over" : "under";
    const won = side === "over" ? settled.actual > row.canonicalLine : settled.actual < row.canonicalLine;
    const independentSide = settled.independentProjection === null || settled.independentProjection === row.canonicalLine
      ? null
      : settled.independentProjection > row.canonicalLine ? "over" : "under";
    return [{ row, identity: { ...settled, key: identityKey(row), independentSide }, probability, side, won }];
  });
  const books = [...new Set(observations.map(({ row }) => row.sportsbook))].sort();
  const sourceMetrics = books.map((sportsbook) => {
    const source = observations.filter(({ row }) => row.sportsbook === sportsbook);
    return summarize(source.map(({ probability, side, won }) => ({ probability, side, won })), sportsbook);
  });

  const byIdentity = Map.groupBy(observations, ({ identity }) => identity.key);
  const fanDuelCases = [...byIdentity.values()].flatMap((group) => {
    const fanDuel = group.find(({ row }) => row.sportsbook === "fanduel");
    if (!fanDuel) return [];
    const others = group.filter(({ row }) => row.sportsbook !== "fanduel");
    const sharp = others.filter(({ row }) => SHARP_CONFIRMATION_BOOKS.has(row.sportsbook));
    const sharpConfirmations = sharp.filter(({ side }) => side === fanDuel.side).length;
    const sharpOppositions = sharp.filter(({ side }) => side !== fanDuel.side).length;
    const allConfirmations = others.filter(({ side }) => side === fanDuel.side).length;
    const allOppositions = others.filter(({ side }) => side !== fanDuel.side).length;
    const independentSide = fanDuel.identity.independentSide;
    const disagreement = independentSide !== null && independentSide !== fanDuel.side;
    return [{
      won: fanDuel.won,
      probability: fanDuel.probability,
      side: fanDuel.side,
      sharpConfirmations,
      sharpOppositions,
      allConfirmations,
      allOppositions,
      disagreement,
      independentWon: independentSide
        ? independentSide === "over"
          ? fanDuel.identity.actual > fanDuel.row.canonicalLine
          : fanDuel.identity.actual < fanDuel.row.canonicalLine
        : null,
    }];
  });

  const cohorts = [0, 1, 2].map((minimumConfirmations) => {
    const cases = fanDuelCases.filter((row) => row.sharpConfirmations >= minimumConfirmations && row.sharpOppositions === 0);
    return summarize(cases, `fanduel_plus_${minimumConfirmations}_sharp_confirmations`);
  });
  const retailCohorts = [1, 2].map((minimumConfirmations) => {
    const cases = fanDuelCases.filter((row) => row.allConfirmations >= minimumConfirmations && row.allOppositions === 0);
    return summarize(cases, `fanduel_plus_${minimumConfirmations}_any_confirmations`);
  });
  const flips = [0, 1, 2].map((minimumConfirmations) => {
    const cases = fanDuelCases.filter((row) => row.disagreement && row.sharpConfirmations >= minimumConfirmations && row.sharpOppositions === 0);
    const corrections = cases.filter((row) => row.won && row.independentWon === false).length;
    const harms = cases.filter((row) => !row.won && row.independentWon === true).length;
    return { minimumConfirmations, cases: cases.length, corrections, harms, net: corrections - harms };
  });

  return {
    landmark: rows[0]?.landmark ?? null,
    observerRows: rows.length,
    settledTwoWayObservations: observations.length,
    sourceMetrics,
    fanDuel: summarize(fanDuelCases, "fanduel"),
    sharpConfirmedFanDuel: cohorts,
    diagnosticAnyBookConfirmedFanDuel: retailCohorts,
    independentToFanDuelDisagreement: flips,
  };
}

function settledIdentities(
  rows: readonly NflPlayerPropsPrivateTrackingRow[],
  statsById: Map<string, NflPlayerPropsCurrentSeasonStat>,
  statsByName: Map<string, NflPlayerPropsCurrentSeasonStat>,
): Map<string, SettledIdentity> {
  const result = new Map<string, SettledIdentity>();
  for (const row of rows) {
    if (!row.canonicalMainLine || row.market === "anytime_td") continue;
    const stat = (row.providerPlayerId ? statsById.get(`${row.gameId}|id:${row.providerPlayerId}`) : undefined)
      ?? statsByName.get(`${row.gameId}|name:${normalize(row.playerName)}`);
    const actual = stat ? nflActual(row.market, stat) : null;
    if (actual === null) continue;
    const key = playerMarketKey(row);
    if (result.has(key)) continue;
    result.set(key, {
      key,
      actual,
      independentProjection: row.independentProjection,
    });
  }
  return result;
}

function summarize<T extends { won: boolean; probability?: number }>(rows: readonly T[], label: string) {
  const wins = rows.filter((row) => row.won).length;
  const probabilities = rows.filter((row) => typeof row.probability === "number");
  const brier = probabilities.length === 0 ? null : probabilities.reduce((sum, row) => {
    const probability = row.probability!;
    return sum + (probability - (row.won ? 1 : 0)) ** 2;
  }, 0) / probabilities.length;
  return {
    label,
    sample: rows.length,
    wins,
    losses: rows.length - wins,
    hitRate: rows.length === 0 ? null : wins / rows.length,
    brier,
  };
}

function fairOverProbability(row: NflPlayerPropsMarketObserverRow): number | null {
  if (row.overPrice === null || row.underPrice === null) return null;
  const over = implied(row.overPrice);
  const under = implied(row.underPrice);
  return over / (over + under);
}

function implied(price: number): number {
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

function identityKey(row: Pick<NflPlayerPropsMarketObserverRow, "gameId" | "playerName" | "market" | "canonicalLine"> | NflPlayerPropsPrivateTrackingRow): string {
  const line = "canonicalLine" in row ? row.canonicalLine : row.line;
  return `${row.gameId}|${normalize(row.playerName)}|${row.market}|${line}`;
}

function playerMarketKey(row: Pick<NflPlayerPropsMarketObserverRow, "gameId" | "playerName" | "market"> | NflPlayerPropsPrivateTrackingRow): string {
  return `${row.gameId}|${normalize(row.playerName)}|${row.market}`;
}

function nflActual(market: string, stat: NflPlayerPropsCurrentSeasonStat): number | null {
  const value = stat[market as keyof NflPlayerPropsCurrentSeasonStat];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function argument(name: string): string | null {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
