#!/usr/bin/env tsx

/** SELECT-only 2026 CFB Total market-reading tournament. Zero writes/provider calls. */

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readCfbForwardWriterEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import type {
  CfbForwardContextCapture,
  CfbForwardContextFamily,
} from "../../lib/services/football/cfbForwardEvidenceCapture";

loadEnvConfig(process.cwd());

type Direction = "over" | "under";
type Block = "development" | "confirmation" | "holdout";
type Result = "win" | "loss" | "push";
type FinalGame = {
  external_id: string | number;
  status: string | null;
  away_score: number | null;
  home_score: number | null;
};
type GameEvidence = {
  gameId: string;
  date: string;
  kickoffAt: string;
  capture: CfbForwardContextCapture;
  independentTotal: number;
  authoritativeTotal: number;
  actualTotal: number;
  families: Map<string, CfbForwardContextFamily>;
};
type Signal = {
  candidate: string;
  game: GameEvidence;
  source: string;
  line: number;
  side: Direction;
  magnitude: number;
  currentObservedAt: string;
};
type Evaluation = {
  candidate: string;
  gameId: string;
  date: string;
  block: Block;
  source: string;
  side: Direction;
  result: Result;
  authoritativeSide: Direction;
  authoritativeResult: Result;
  disagrees: boolean;
  correction: boolean;
  harm: boolean;
  authoritativeMae: number;
  reflectedMae: number;
};

const SOURCES = ["circa", "pinnacle", "bookmaker"] as const;
const LINE_THRESHOLDS = [0.5, 1, 1.5] as const;
const PRICE_THRESHOLDS_PP = [1, 1.5, 2.5] as const;

function isFinal(row: FinalGame): boolean {
  return ["final", "completed", "post"].includes(row.status?.trim().toLowerCase() ?? "") &&
    Number.isFinite(row.away_score) && Number.isFinite(row.home_score);
}

function implied(price: number): number {
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

function fairOver(landmark: NonNullable<CfbForwardContextFamily[4]>): number {
  const over = implied(landmark[4]);
  const under = implied(landmark[5]);
  return over / (over + under);
}

function splitDirection(value: readonly unknown[] | null, minimumGap = 10): Direction | null {
  if (!value) return null;
  const overMoney = Number(value.at(-4));
  const overTickets = Number(value.at(-3));
  const underMoney = Number(value.at(-2));
  const underTickets = Number(value.at(-1));
  if (![overMoney, overTickets, underMoney, underTickets].every(Number.isFinite)) return null;
  const overGap = overMoney - overTickets;
  const underGap = underMoney - underTickets;
  if (Math.max(Math.abs(overGap), Math.abs(underGap)) < minimumGap) return null;
  return overGap >= underGap ? "over" : "under";
}

function publicTicketDirection(value: readonly unknown[] | null, minimumGap = 10): Direction | null {
  if (!value) return null;
  const overTickets = Number(value.at(-3));
  const underTickets = Number(value.at(-1));
  if (!Number.isFinite(overTickets) || !Number.isFinite(underTickets) || Math.abs(overTickets - underTickets) < minimumGap) return null;
  return overTickets > underTickets ? "over" : "under";
}

function blockFor(date: string): Block {
  if (date <= "2026-09-27") return "development";
  if (date <= "2026-10-04") return "confirmation";
  return "holdout";
}

function sideAt(total: number, line: number): Direction {
  return total > line ? "over" : "under";
}

function settle(side: Direction, actual: number, line: number): Result {
  if (Math.abs(actual - line) < 1e-9) return "push";
  return (actual > line ? "over" : "under") === side ? "win" : "loss";
}

function currentIsPregame(family: CfbForwardContextFamily, kickoffAt: string): boolean {
  return family[5][2] !== "x" && Date.parse(family[5][0]) < Date.parse(kickoffAt);
}

function baseDirection(family: CfbForwardContextFamily): { side: Direction; channel: "line" | "price"; magnitude: number } | null {
  const opening = family[4];
  const current = family[5];
  if (!opening || opening[2] === "x" || current[2] === "x" || opening[3] === null || current[3] === null || opening[0] >= current[0]) return null;
  const lineDelta = current[3] - opening[3];
  if (Math.abs(lineDelta) >= 0.5) return { side: lineDelta > 0 ? "over" : "under", channel: "line", magnitude: Math.abs(lineDelta) };
  if (Math.abs(lineDelta) > 1e-9) return null;
  const priceDeltaPp = (fairOver(current) - fairOver(opening)) * 100;
  if (Math.abs(priceDeltaPp) < 1) return null;
  return { side: priceDeltaPp > 0 ? "over" : "under", channel: "price", magnitude: Math.abs(priceDeltaPp) };
}

async function readResults(client: SupabaseClient, ids: string[]): Promise<Map<string, FinalGame>> {
  const output = new Map<string, FinalGame>();
  for (let index = 0; index < ids.length; index += 150) {
    const { data, error } = await client.from("games")
      .select("external_id,status,away_score,home_score")
      .eq("sport", "cfb")
      .in("external_id", ids.slice(index, index + 150));
    if (error) throw new Error(`CFB result read failed: ${error.message}`);
    for (const row of (data ?? []) as FinalGame[]) output.set(String(row.external_id), row);
  }
  return output;
}

function evaluate(signal: Signal): Evaluation {
  const authoritativeSide = sideAt(signal.game.authoritativeTotal, signal.line);
  const result = settle(signal.side, signal.game.actualTotal, signal.line);
  const authoritativeResult = settle(authoritativeSide, signal.game.actualTotal, signal.line);
  const disagrees = signal.side !== authoritativeSide;
  return {
    candidate: signal.candidate,
    gameId: signal.game.gameId,
    date: signal.game.date,
    block: blockFor(signal.game.date),
    source: signal.source,
    side: signal.side,
    result,
    authoritativeSide,
    authoritativeResult,
    disagrees,
    correction: disagrees && result === "win" && authoritativeResult === "loss",
    harm: disagrees && result === "loss" && authoritativeResult === "win",
    authoritativeMae: Math.abs(signal.game.authoritativeTotal - signal.game.actualTotal),
    reflectedMae: Math.abs((2 * signal.line - signal.game.authoritativeTotal) - signal.game.actualTotal),
  };
}

function metrics(rows: Evaluation[]) {
  const resolved = rows.filter((row) => row.result !== "push");
  const authoritativeResolved = rows.filter((row) => row.authoritativeResult !== "push");
  const disagreements = rows.filter((row) => row.disagrees);
  return {
    games: new Set(rows.map((row) => row.gameId)).size,
    dates: [...new Set(rows.map((row) => row.date))].sort(),
    wins: resolved.filter((row) => row.result === "win").length,
    losses: resolved.filter((row) => row.result === "loss").length,
    pushes: rows.length - resolved.length,
    accuracy: resolved.length ? resolved.filter((row) => row.result === "win").length / resolved.length : null,
    authoritativeWins: authoritativeResolved.filter((row) => row.authoritativeResult === "win").length,
    authoritativeLosses: authoritativeResolved.filter((row) => row.authoritativeResult === "loss").length,
    authoritativeAccuracy: authoritativeResolved.length
      ? authoritativeResolved.filter((row) => row.authoritativeResult === "win").length / authoritativeResolved.length
      : null,
    disagreements: disagreements.length,
    corrections: disagreements.filter((row) => row.correction).length,
    harms: disagreements.filter((row) => row.harm).length,
    authoritativeMaeOnDisagreements: disagreements.length
      ? disagreements.reduce((sum, row) => sum + row.authoritativeMae, 0) / disagreements.length
      : null,
    reflectedMaeOnDisagreements: disagreements.length
      ? disagreements.reduce((sum, row) => sum + row.reflectedMae, 0) / disagreements.length
      : null,
  };
}

function summarize(rows: Evaluation[]) {
  const candidates = [...new Set(rows.map((row) => row.candidate))].sort();
  return Object.fromEntries(candidates.map((candidate) => {
    const candidateRows = rows.filter((row) => row.candidate === candidate);
    const byBlock = Object.fromEntries((["development", "confirmation", "holdout"] as const).map((block) => [
      block,
      metrics(candidateRows.filter((row) => row.block === block)),
    ]));
    const overall = metrics(candidateRows);
    const confirmation = byBlock.confirmation;
    const holdout = byBlock.holdout;
    const passesFixedGates = overall.games >= 12 && overall.dates.length >= 3 &&
      confirmation.disagreements >= 4 && holdout.disagreements >= 2 &&
      confirmation.corrections > confirmation.harms && holdout.corrections > holdout.harms &&
      confirmation.reflectedMaeOnDisagreements !== null && confirmation.authoritativeMaeOnDisagreements !== null &&
      confirmation.reflectedMaeOnDisagreements <= confirmation.authoritativeMaeOnDisagreements &&
      holdout.reflectedMaeOnDisagreements !== null && holdout.authoritativeMaeOnDisagreements !== null &&
      holdout.reflectedMaeOnDisagreements <= holdout.authoritativeMaeOnDisagreements &&
      overall.accuracy !== null && overall.authoritativeAccuracy !== null && overall.accuracy > overall.authoritativeAccuracy;
    return [candidate, { overall, byBlock, passesFixedGates }];
  }));
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const evidence = (await readCfbForwardWriterEvidence({ client, season: 2026 })).evidence;
  const results = await readResults(client, [...new Set(evidence.map((row) => row.providerGameId))]);
  const latest = new Map<string, typeof evidence[number]>();
  for (const row of evidence) {
    if (!row.payload.contextualEvidenceCapture || Date.parse(row.capturedAt) >= Date.parse(row.gameStartAt)) continue;
    const prior = latest.get(row.providerGameId);
    if (!prior || Date.parse(row.capturedAt) > Date.parse(prior.capturedAt)) latest.set(row.providerGameId, row);
  }

  const games: GameEvidence[] = [];
  for (const row of latest.values()) {
    const result = results.get(row.providerGameId);
    const capture = row.payload.contextualEvidenceCapture;
    if (!capture || !result || !isFinal(result)) continue;
    const independent = row.payload.independentForecast ?? row.payload.decisions.forecast;
    games.push({
      gameId: row.providerGameId,
      date: row.gameStartAt.slice(0, 10),
      kickoffAt: row.gameStartAt,
      capture,
      independentTotal: independent.expectedTotal,
      authoritativeTotal: row.payload.decisions.forecast.expectedTotal,
      actualTotal: result.away_score! + result.home_score!,
      families: new Map(capture.markets.total.families
        .filter((family) => SOURCES.includes(family[0] as typeof SOURCES[number]) && currentIsPregame(family, row.gameStartAt))
        .map((family) => [family[0], family])),
    });
  }

  const signals: Signal[] = [];
  for (const game of games) {
    const baseSignals = new Map<string, Signal>();
    for (const source of SOURCES) {
      const family = game.families.get(source);
      if (!family) continue;
      const opening = family[4];
      const current = family[5];
      if (!opening || current[3] === null || opening[3] === null || opening[0] >= current[0]) continue;
      const lineDelta = current[3] - opening[3];
      for (const threshold of LINE_THRESHOLDS) {
        if (Math.abs(lineDelta) < threshold) continue;
        signals.push({
          candidate: `line_${source}_${threshold.toFixed(1)}`,
          game,
          source,
          line: current[3],
          side: lineDelta > 0 ? "over" : "under",
          magnitude: Math.abs(lineDelta),
          currentObservedAt: current[0],
        });
      }
      if (Math.abs(lineDelta) < 1e-9) {
        const priceDeltaPp = (fairOver(current) - fairOver(opening)) * 100;
        for (const threshold of PRICE_THRESHOLDS_PP) {
          if (Math.abs(priceDeltaPp) < threshold) continue;
          signals.push({
            candidate: `price_${source}_${threshold.toFixed(1)}pp`,
            game,
            source,
            line: current[3],
            side: priceDeltaPp > 0 ? "over" : "under",
            magnitude: Math.abs(priceDeltaPp),
            currentObservedAt: current[0],
          });
        }
      }
      const base = baseDirection(family);
      if (!base) continue;
      const signal: Signal = {
        candidate: `base_${source}_${base.channel}`,
        game,
        source,
        line: current[3],
        side: base.side,
        magnitude: base.magnitude,
        currentObservedAt: current[0],
      };
      baseSignals.set(source, signal);
      const hoursToKickoff = (Date.parse(game.kickoffAt) - Date.parse(current[0])) / 3_600_000;
      if (hoursToKickoff >= 0 && hoursToKickoff <= 6) signals.push({ ...signal, candidate: `late6h_${source}_${base.channel}` });
      if (hoursToKickoff >= 0 && hoursToKickoff <= 2) signals.push({ ...signal, candidate: `late2h_${source}_${base.channel}` });
      const sharp = game.capture.markets.total.sharp;
      const sharpSide = splitDirection(sharp);
      if (sharpSide === signal.side) {
        const sharpBook = String(sharp?.[1] ?? "unknown").toLowerCase().replace(/[^a-z0-9]/g, "");
        const sharpClass = ["circa", "pinnacle", "bookmaker"].includes(sharpBook) ? "named" : "fallback";
        signals.push({ ...signal, candidate: `${sharpClass}_sharp_agrees_${source}_${base.channel}` });
      }
      const publicMoneySide = splitDirection(game.capture.markets.total.public);
      if (publicMoneySide === signal.side) signals.push({ ...signal, candidate: `public_money_agrees_${source}_${base.channel}` });
      const publicTickets = publicTicketDirection(game.capture.markets.total.public);
      if (publicTickets && publicTickets !== signal.side) signals.push({ ...signal, candidate: `rlm_${source}_${base.channel}` });
    }
    const directions = new Map<Direction, Signal[]>();
    for (const signal of baseSignals.values()) directions.set(signal.side, [...(directions.get(signal.side) ?? []), signal]);
    for (const [side, agreeing] of directions) {
      if (agreeing.length < 2) continue;
      const representative = agreeing.sort((left, right) => SOURCES.indexOf(left.source as typeof SOURCES[number]) - SOURCES.indexOf(right.source as typeof SOURCES[number]))[0]!;
      signals.push({ ...representative, side, source: agreeing.map((row) => row.source).sort().join("+"), candidate: "originator_agreement_2" });
    }
  }

  const evaluations = signals.map(evaluate);
  const summary = summarize(evaluations);
  console.log(JSON.stringify({
    release: "cfb_2026_total_market_reading_tournament_2026_10_08_r1",
    mode: "select_only_zero_writes_zero_provider_calls",
    evidenceRows: evidence.length,
    settledEvidenceGames: games.length,
    gamesWithNamedTotalChronology: games.filter((game) => game.families.size > 0).length,
    signalRows: evaluations.length,
    captureReleases: [...new Set(games.map((game) => game.capture.release))].sort(),
    candidatesPassingFixedGates: Object.entries(summary).filter(([, value]) => value.passesFixedGates).map(([candidate]) => candidate),
    summary,
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
