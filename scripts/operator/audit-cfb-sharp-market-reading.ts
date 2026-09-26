#!/usr/bin/env tsx

/** SELECT-only outcome audit of pregame CFB market-reading evidence. */

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readCfbForwardEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import type {
  CfbForwardContextCapture,
  CfbForwardContextFamily,
} from "../../lib/services/football/cfbForwardEvidenceCapture";

loadEnvConfig(process.cwd());

type Market = "moneyline" | "spread" | "total";
type Side = "first" | "second";
type ResultRow = {
  gameId: string;
  date: string;
  market: Market;
  channel: string;
  source: string;
  side: Side;
  result: "win" | "loss" | "push";
};
type GameResult = {
  external_id: string | number;
  status: string | null;
  away_score: number | null;
  home_score: number | null;
};

const MARKETS: Market[] = ["moneyline", "spread", "total"];
const SOURCES = ["circa", "pinnacle", "bookmaker"] as const;

function isFinal(result: GameResult): boolean {
  const status = result.status?.trim().toLowerCase() ?? "";
  return status === "final" || status === "completed" || status === "post";
}

function implied(price: number): number {
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

function fairFirstProbability(market: Market, landmark: CfbForwardContextFamily[5]): number | null {
  if (market !== "moneyline") return null;
  const first = implied(landmark[4]);
  const second = implied(landmark[5]);
  return first / (first + second);
}

function movementSide(market: Market, family: CfbForwardContextFamily): Side | null {
  const opening = family[4];
  const current = family[5];
  if (!opening || opening[0] >= current[0] || opening[2] === "x" || current[2] === "x") return null;
  if (market === "moneyline") {
    const before = fairFirstProbability(market, opening);
    const after = fairFirstProbability(market, current);
    if (before === null || after === null || Math.abs(after - before) < 0.015) return null;
    return after > before ? "first" : "second";
  }
  if (opening[3] === null || current[3] === null || Math.abs(current[3] - opening[3]) < 0.5) return null;
  if (market === "spread") return current[3] < opening[3] ? "second" : "first";
  return current[3] > opening[3] ? "first" : "second";
}

function splitSide(value: readonly unknown[] | null): Side | null {
  if (!value) return null;
  const firstMoney = Number(value.at(-4));
  const firstTickets = Number(value.at(-3));
  const secondMoney = Number(value.at(-2));
  const secondTickets = Number(value.at(-1));
  if (![firstMoney, firstTickets, secondMoney, secondTickets].every(Number.isFinite)) return null;
  const firstGap = firstMoney - firstTickets;
  const secondGap = secondMoney - secondTickets;
  if (Math.max(Math.abs(firstGap), Math.abs(secondGap)) < 10) return null;
  return firstGap >= secondGap ? "first" : "second";
}

function publicTicketSide(value: readonly unknown[] | null): Side | null {
  if (!value) return null;
  const firstTickets = Number(value.at(-3));
  const secondTickets = Number(value.at(-1));
  if (!Number.isFinite(firstTickets) || !Number.isFinite(secondTickets) || Math.abs(firstTickets - secondTickets) < 10) return null;
  return firstTickets > secondTickets ? "first" : "second";
}

function settle(args: {
  market: Market;
  side: Side;
  current: CfbForwardContextFamily[5];
  awayScore: number;
  homeScore: number;
}): "win" | "loss" | "push" {
  if (args.market === "moneyline") {
    const firstWon = args.awayScore > args.homeScore;
    return (args.side === "first") === firstWon ? "win" : "loss";
  }
  const line = args.current[3];
  if (line === null) return "push";
  const firstScore = args.market === "spread"
    ? args.awayScore - args.homeScore - line
    : args.awayScore + args.homeScore - line;
  if (Math.abs(firstScore) < 1e-9) return "push";
  return (args.side === "first") === (firstScore > 0) ? "win" : "loss";
}

async function readResults(client: SupabaseClient, ids: string[]): Promise<Map<string, GameResult>> {
  const result = new Map<string, GameResult>();
  for (let index = 0; index < ids.length; index += 150) {
    const { data, error } = await client.from("games")
      .select("external_id,status,away_score,home_score")
      .eq("sport", "cfb")
      .in("external_id", ids.slice(index, index + 150));
    if (error) throw new Error(`CFB result read failed: ${error.message}`);
    for (const row of (data ?? []) as GameResult[]) result.set(String(row.external_id), row);
  }
  return result;
}

function summarize(rows: ResultRow[]) {
  const groups = new Map<string, ResultRow[]>();
  for (const row of rows) {
    const key = `${row.channel}:${row.source}:${row.market}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return Object.fromEntries([...groups].sort(([left], [right]) => left.localeCompare(right)).map(([key, values]) => {
    const resolved = values.filter((row) => row.result !== "push");
    const wins = resolved.filter((row) => row.result === "win").length;
    return [key, {
      games: new Set(values.map((row) => row.gameId)).size,
      resolved: resolved.length,
      wins,
      losses: resolved.length - wins,
      pushes: values.length - resolved.length,
      accuracy: resolved.length ? wins / resolved.length : null,
      dates: [...new Set(values.map((row) => row.date))].sort(),
    }];
  }));
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const evidence = await readCfbForwardEvidence({ client, season: 2026 });
  const results = await readResults(client, [...new Set(evidence.map((row) => row.providerGameId))]);
  const latest = new Map<string, { capture: CfbForwardContextCapture; family: CfbForwardContextFamily; gameStartAt: string }>();
  for (const row of evidence) {
    const capture = row.payload.contextualEvidenceCapture;
    if (!capture || Date.parse(row.capturedAt) >= Date.parse(row.gameStartAt)) continue;
    for (const market of MARKETS) {
      for (const source of SOURCES) {
        const family = capture.markets[market].families.find((value) => value[0] === source);
        if (!family || family[5][0] > row.gameStartAt || movementSide(market, family) === null) continue;
        const key = `${row.providerGameId}:${source}:${market}`;
        const prior = latest.get(key);
        if (!prior || prior.capture.capturedAt < capture.capturedAt) latest.set(key, { capture, family, gameStartAt: row.gameStartAt });
      }
    }
  }

  const rows: ResultRow[] = [];
  for (const [key, value] of latest) {
    const [gameId, source, marketValue] = key.split(":");
    const market = marketValue as Market;
    const result = results.get(gameId!);
    if (!result || !isFinal(result) || !Number.isFinite(result.away_score) || !Number.isFinite(result.home_score)) continue;
    const side = movementSide(market, value.family);
    if (!side) continue;
    const base = {
      gameId: gameId!,
      date: value.gameStartAt.slice(0, 10),
      market,
      source: source!,
    };
    rows.push({
      ...base,
      channel: "movement",
      side,
      result: settle({ market, side, current: value.family[5], awayScore: result.away_score!, homeScore: result.home_score! }),
    });
    const publicTickets = publicTicketSide(value.capture.markets[market].public);
    if (publicTickets && publicTickets !== side) {
      rows.push({
        ...base,
        channel: "rlm",
        side,
        result: settle({ market, side, current: value.family[5], awayScore: result.away_score!, homeScore: result.home_score! }),
      });
    }
    const sharp = value.capture.markets[market].sharp;
    const sharpSide = splitSide(sharp);
    if (sharpSide) {
      rows.push({
        ...base,
        channel: `split_${String(sharp?.[1] ?? "unknown")}`,
        side: sharpSide,
        result: settle({ market, side: sharpSide, current: value.family[5], awayScore: result.away_score!, homeScore: result.home_score! }),
      });
    }
    const publicSide = splitSide(value.capture.markets[market].public);
    if (publicSide) {
      rows.push({
        ...base,
        channel: "split_public",
        side: publicSide,
        result: settle({ market, side: publicSide, current: value.family[5], awayScore: result.away_score!, homeScore: result.home_score! }),
      });
    }
  }

  console.log(JSON.stringify({
    release: "cfb_sharp_market_reading_select_audit_2026_09_26_r1",
    mode: "select_only_zero_writes_zero_provider_calls",
    evidenceRows: evidence.length,
    settledGames: [...results.values()].filter((row) => isFinal(row) && Number.isFinite(row.away_score) && Number.isFinite(row.home_score)).length,
    qualifyingMovementKeys: latest.size,
    evaluatedSignals: rows.length,
    captureReleases: [...new Set([...latest.values()].map((value) => value.capture.release))].sort(),
    summary: summarize(rows),
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
