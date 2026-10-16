#!/usr/bin/env tsx

/** Read/provider-only Week 6 board rehearsal for the NFL r11 candidate. */

import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import type { DailyEdgeGameDto, MarketEdgeDto } from "@/app/lab/lib/labTypes";
import type { NflForwardEvidencePayload } from "@/lib/services/football/nflForwardEvidence";
import { readNflForwardEvidence } from "@/lib/services/football/nflForwardEvidenceStore";
import { runNflForwardEvidenceWriter } from "@/lib/services/football/nflForwardEvidenceWriter";
import { resolveNflForwardWeek } from "@/lib/services/football/nflForwardWeekSelection";
import { buildNflWeekOneHeldMemberFixture } from "@/lib/services/football/nflWeekOneHeldMemberFixture";

loadEnvConfig(process.cwd());

type MarketName = "moneyline" | "spread" | "total";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function marketRows(game: DailyEdgeGameDto): Array<[MarketName, MarketEdgeDto]> {
  return [["moneyline", game.markets.moneyline], ["spread", game.markets.first_inning], ["total", game.markets.total]];
}

function summarize(games: DailyEdgeGameDto[]) {
  const rows = games.flatMap(marketRows);
  const bestAnglesByGame = games.map((game) => ({
    game: `${game.awayTeam}@${game.homeTeam}`,
    markets: marketRows(game).filter(([, market]) => market.verdict?.label === "Best Angle").map(([market]) => market),
  })).filter((game) => game.markets.length > 0);
  const grades = rows.reduce<Record<string, number>>((counts, [, market]) => {
    const grade = market.verdict?.label ?? "Missing";
    counts[grade] = (counts[grade] ?? 0) + 1;
    return counts;
  }, {});
  return {
    games: games.length, markets: rows.length,
    actionables: (grades["Best Angle"] ?? 0) + (grades.Lean ?? 0), grades,
    actionableByMarket: Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => [
      market,
      rows.filter(([name, row]) => name === market && ["Best Angle", "Lean"].includes(row.verdict?.label ?? "")).length,
    ])),
    bestAngleByMarket: Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => [
      market,
      rows.filter(([name, row]) => name === market && row.verdict?.label === "Best Angle").length,
    ])),
    gamesWithBestAngle: bestAnglesByGame.length,
    gamesWithMultipleBestAngles: bestAnglesByGame.filter((game) => game.markets.length > 1),
    heldGames: games.filter((game) => marketRows(game).every(([, market]) => market.held)).length,
  };
}

function isActionable(market: MarketEdgeDto): boolean {
  return ["Best Angle", "Lean"].includes(market.verdict?.label ?? "");
}

function compareBoards(beforeGames: DailyEdgeGameDto[], afterGames: DailyEdgeGameDto[]) {
  const beforeByGame = new Map(beforeGames.map((game) => [game.id, game]));
  const impact = {
    promotions: 0,
    demotions: 0,
    sideChanges: 0,
    probabilityChanges: 0,
    byMarket: {
      moneyline: { promotions: 0, demotions: 0 },
      spread: { promotions: 0, demotions: 0 },
      total: { promotions: 0, demotions: 0 },
    },
  };
  for (const game of afterGames) {
    const prior = beforeByGame.get(game.id);
    if (!prior) continue;
    for (const [market, row] of marketRows(game)) {
      const before = market === "moneyline" ? prior.markets.moneyline : market === "spread" ? prior.markets.first_inning : prior.markets.total;
      if (!isActionable(before) && isActionable(row)) {
        impact.promotions += 1;
        impact.byMarket[market].promotions += 1;
      }
      if (isActionable(before) && !isActionable(row)) {
        impact.demotions += 1;
        impact.byMarket[market].demotions += 1;
      }
      if (before.pick !== row.pick) impact.sideChanges += 1;
      if (probabilityChanged(before.modelProb, row.modelProb)) impact.probabilityChanges += 1;
    }
  }
  return impact;
}

async function main(): Promise<void> {
  if (process.argv.includes("--apply")) throw new Error("This audit is read-only; --apply is prohibited.");
  const now = new Date(); const season = 2026;
  const week = resolveNflForwardWeek({ season, configuredWeek: Number(process.env.NFL_FORWARD_WEEK ?? 1), now });
  const client = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const existing = await readNflForwardEvidence({ client, season, week });
  const baseline = buildNflWeekOneHeldMemberFixture(existing);
  let payloads: NflForwardEvidencePayload[] = [];
  const result = await runNflForwardEvidenceWriter({
    client, season, week, runId: `nfl-r11-audit-${randomUUID()}`, now: now.toISOString(), apply: false,
    balldontlieApiKey: required("BALLDONTLIE_API_KEY"),
    playbookApiKey: process.env.PLAYBOOK_API_KEY?.trim() || "audit-provider-unavailable",
    sharpApiKey: required("SHARPAPI_KEY"), weatherProvider: null, exactProviderCandidate: true,
    auditPayloads: (rows) => { payloads = rows; },
  });
  const candidate = buildNflWeekOneHeldMemberFixture([
    ...existing,
    ...payloads.map((payload, index) => ({
      id: `audit-${index}`, providerGameId: payload.game.providerGameId, stage: payload.stage,
      capturedAt: payload.capturedAt, gameStartAt: payload.game.scheduledStart,
      payloadSha256: "audit-only", payload,
    })),
  ]);
  const legacyCounterfactualPayloads = payloads.map((payload) => {
    const currentSeasonQuarterback = Object.values(payload.coverage.quarterbackHistory ?? {})
      .some((quarterback) => quarterback.historySource === "current_season_completed_games");
    const verifiedClear = payload.injuries?.verifiedClear === true;
    if (!currentSeasonQuarterback && !verifiedClear) return payload;
    const hold = currentSeasonQuarterback ? "quarterback_history_unmatched" : "injury_report_unavailable";
    return {
      ...payload,
      ...(verifiedClear ? { injuries: null } : {}),
      decisions: { ...payload.decisions, evaluatedBets: [], outcomeConfidence: [] },
      coverage: {
        ...payload.coverage,
        ...(verifiedClear ? { injuries: false } : {}),
        healthHolds: [...new Set([...payload.coverage.healthHolds, hold])].sort(),
      },
    } satisfies NflForwardEvidencePayload;
  });
  const sameInputLegacy = buildNflWeekOneHeldMemberFixture([
    ...existing,
    ...legacyCounterfactualPayloads.map((payload, index) => ({
      id: `audit-legacy-${index}`, providerGameId: payload.game.providerGameId, stage: payload.stage,
      capturedAt: payload.capturedAt, gameStartAt: payload.game.scheduledStart,
      payloadSha256: "audit-legacy-only", payload,
    })),
  ]);
  const baselineByGame = new Map(baseline.snapshot.games.map((game) => [game.id, game]));
  const changes: unknown[] = [];
  const boardImpact = {
    promotions: 0,
    demotions: 0,
    sideChanges: 0,
    probabilityChanges: 0,
    byMarket: {
      moneyline: { promotions: 0, demotions: 0 },
      spread: { promotions: 0, demotions: 0 },
      total: { promotions: 0, demotions: 0 },
    },
  };
  for (const game of candidate.snapshot.games) {
    const prior = baselineByGame.get(game.id);
    if (!prior) { changes.push({ game: `${game.awayTeam}@${game.homeTeam}`, kind: "added" }); continue; }
    for (const [market, row] of marketRows(game)) {
      const before = market === "moneyline" ? prior.markets.moneyline : market === "spread" ? prior.markets.first_inning : prior.markets.total;
      if (!isActionable(before) && isActionable(row)) {
        boardImpact.promotions += 1;
        boardImpact.byMarket[market].promotions += 1;
      }
      if (isActionable(before) && !isActionable(row)) {
        boardImpact.demotions += 1;
        boardImpact.byMarket[market].demotions += 1;
      }
      if (before.pick !== row.pick) boardImpact.sideChanges += 1;
      if (probabilityChanged(before.modelProb, row.modelProb)) boardImpact.probabilityChanges += 1;
      if (before.pick === row.pick && !probabilityChanged(before.modelProb, row.modelProb) && before.verdict?.label === row.verdict?.label && before.held === row.held) continue;
      changes.push({
        game: `${game.awayTeam}@${game.homeTeam}`, market,
        baseline: { pick: before.pick, probability: before.modelProb, grade: before.verdict?.label, held: before.held },
        candidate: { pick: row.pick, probability: row.modelProb, grade: row.verdict?.label, held: row.held },
      });
    }
  }
  console.log(JSON.stringify({
    release: "nfl_personnel_coverage_repair_current_board_audit_2026_10_15_r2",
    readOnly: true, writes: 0, season, week,
    baseline: summarize(baseline.snapshot.games), candidate: summarize(candidate.snapshot.games),
    boardImpact,
    sameInputRepairImpact: {
      legacy: summarize(sameInputLegacy.snapshot.games),
      candidate: summarize(candidate.snapshot.games),
      boardImpact: compareBoards(sameInputLegacy.snapshot.games, candidate.snapshot.games),
    },
    writer: result,
    holds: payloads.filter((payload) => payload.coverage.healthHolds.length > 0).map((payload) => ({
      game: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
      reasons: payload.coverage.healthHolds,
      quarterbackDepth: {
        away: payload.startersAndDepth.away.roster.filter((player) => player.position === "QB"),
        home: payload.startersAndDepth.home.roster.filter((player) => player.position === "QB"),
      },
      injuryPlayers: payload.injuries?.teams.flatMap((team) => team.players.map((player) => ({
        team: team.abbreviation, name: player.name, position: player.position, status: player.status,
      }))) ?? [],
    })),
    noWeightActions: payloads.map((payload) => ({
      game: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
      score: { away: payload.outcomeForecast.expectedAwayScore, home: payload.outcomeForecast.expectedHomeScore },
      reader: payload.outcomeForecast.noWeightMarketReader ?? null,
      targetExclusion: payload.coverage.forecastTargetExclusion,
      healthHolds: payload.coverage.healthHolds,
      quarterbackContext: payload.coverage.quarterbackHistory ??
        payload.decisions.shadowEvaluatedBets?.[0]?.quarterbackContext ?? null,
      expectedQuarterbacks: {
        away: payload.startersAndDepth.away.expectedStartingQuarterback,
        home: payload.startersAndDepth.home.expectedStartingQuarterback,
      },
      injuriesAvailable: payload.coverage.injuries,
    })),
    changes,
  }, null, 2));
}

function probabilityChanged(before: number | null, after: number | null): boolean {
  if (before === null || after === null) return before !== after;
  return Math.abs(before - after) > 1e-12;
}

void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
