#!/usr/bin/env tsx

/** Read/provider-only same-input rehearsal for the NFL personnel-evidence eligibility gate. */

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

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function marketRows(game: DailyEdgeGameDto): Array<[MarketName, MarketEdgeDto]> {
  return [
    ["moneyline", game.markets.moneyline],
    ["spread", game.markets.first_inning],
    ["total", game.markets.total],
  ];
}

function summarize(games: DailyEdgeGameDto[]) {
  const markets = games.flatMap((game) => marketRows(game));
  const grades = markets.reduce<Record<string, number>>((counts, [, market]) => {
    const grade = market.verdict?.label ?? "Missing";
    counts[grade] = (counts[grade] ?? 0) + 1;
    return counts;
  }, {});
  return {
    games: games.length,
    markets: markets.length,
    heldGames: games.filter((game) => marketRows(game).every(([, market]) => market.held)).length,
    actionables: (grades["Best Angle"] ?? 0) + (grades.Lean ?? 0),
    grades,
  };
}

async function main(): Promise<void> {
  if (process.argv.includes("--apply")) throw new Error("This operator is read-only; --apply is not supported.");
  const now = new Date();
  const season = 2026;
  const configuredWeek = Number(process.env.NFL_FORWARD_WEEK ?? 1);
  const week = resolveNflForwardWeek({ season, configuredWeek, now });
  const client = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const existing = await readNflForwardEvidence({ client, season, week });
  const baselineFixture = buildNflWeekOneHeldMemberFixture(existing);
  let candidatePayloads: NflForwardEvidencePayload[] = [];
  const result = await runNflForwardEvidenceWriter({
    client,
    season,
    week,
    runId: `personnel-eligibility-audit-${randomUUID()}`,
    now: now.toISOString(),
    apply: false,
    balldontlieApiKey: requiredEnv("BALLDONTLIE_API_KEY"),
    playbookApiKey: requiredEnv("PLAYBOOK_API_KEY"),
    owlsApiKey: requiredEnv("OWLS_INSIGHT_API_KEY"),
    weatherProvider: null,
    auditPayloads: (payloads) => { candidatePayloads = payloads; },
  });
  const candidateRows = [
    ...existing,
    ...candidatePayloads.map((payload, index) => ({
      id: `audit-${index}`,
      providerGameId: payload.game.providerGameId,
      stage: payload.stage,
      capturedAt: payload.capturedAt,
      gameStartAt: payload.game.scheduledStart,
      payloadSha256: "audit-only",
      payload,
    })),
  ];
  const candidateFixture = buildNflWeekOneHeldMemberFixture(candidateRows);
  const baselineByGame = new Map(baselineFixture.snapshot.games.map((game) => [game.id, game]));
  const changes: Array<Record<string, unknown>> = [];
  for (const game of candidateFixture.snapshot.games) {
    const baseline = baselineByGame.get(game.id);
    if (!baseline) {
      changes.push({ game: game.id, kind: "added_game" });
      continue;
    }
    for (const [market, candidate] of marketRows(game)) {
      const previous = market === "moneyline"
        ? baseline.markets.moneyline
        : market === "spread"
          ? baseline.markets.first_inning
          : baseline.markets.total;
      if (candidate.pick === previous.pick && candidate.modelProb === previous.modelProb &&
          candidate.verdict?.label === previous.verdict?.label && candidate.held === previous.held) continue;
      changes.push({
        game: `${game.awayTeam}@${game.homeTeam}`,
        market,
        previous: { pick: previous.pick, probability: previous.modelProb, grade: previous.verdict?.label, held: previous.held },
        candidate: { pick: candidate.pick, probability: candidate.modelProb, grade: candidate.verdict?.label, held: candidate.held },
      });
    }
  }
  console.log(JSON.stringify({
    readOnly: true,
    writes: 0,
    season,
    week,
    baseline: summarize(baselineFixture.snapshot.games),
    candidate: summarize(candidateFixture.snapshot.games),
    candidateWriter: result,
    heldEvidence: candidatePayloads.flatMap((payload) => payload.coverage.healthHolds.length > 0
      ? [{
          game: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
          reasons: payload.coverage.healthHolds,
          quarterbacks: {
            away: payload.startersAndDepth.away.expectedStartingQuarterback?.name ?? null,
            home: payload.startersAndDepth.home.expectedStartingQuarterback?.name ?? null,
          },
          injuryReportUpdatedAt: payload.injuries?.reportUpdatedAt ?? null,
        }]
      : []),
    changes,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
