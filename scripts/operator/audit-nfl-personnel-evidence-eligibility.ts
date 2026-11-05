#!/usr/bin/env tsx

/** Read/provider-only same-input rehearsal for the NFL personnel-evidence eligibility gate. */

import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import type { DailyEdgeGameDto, MarketEdgeDto } from "@/app/lab/lib/labTypes";
import type { NflForwardEvidencePayload } from "@/lib/services/football/nflForwardEvidence";
import type { NflForwardTeamDepthSnapshot } from "@/lib/services/football/nflForwardEvidence";
import type { DailyEdgeGameAvailability } from "@/lib/services/dailyEdge/gameAvailability";
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

function sameNumber(first: number | null | undefined, second: number | null | undefined): boolean {
  if (first == null || second == null) return first == null && second == null;
  return Math.abs(first - second) < 1e-12;
}

function legacyAvailabilityAdjustedDepth(
  depth: NflForwardTeamDepthSnapshot,
  injuries: DailyEdgeGameAvailability | null,
): NflForwardTeamDepthSnapshot {
  const starter = depth.expectedStartingQuarterback?.name?.trim();
  if (!starter) return depth;
  const team = injuries?.teams.find((entry) => normalizedTeam(entry.abbreviation) === normalizedTeam(depth.team));
  const reportStatuses = new Map((team?.players ?? []).map((entry) => [normalizedPlayer(entry.name), normalizedStatus(entry.status)]));
  const starterStatus = strongestStatus(
    normalizedStatus(depth.expectedStartingQuarterback?.injuryStatus),
    reportStatuses.get(normalizedPlayer(starter)) ?? "",
  );
  if (starterStatus !== "out" && starterStatus !== "doubtful") return depth;
  const unavailable = new Set((team?.players ?? []).filter((entry) => {
    const status = normalizedStatus(entry.status);
    return status === "out" || status === "doubtful";
  }).map((entry) => normalizedPlayer(entry.name)));
  const replacement = depth.quarterbackDepth
    .filter((entry) => normalizedPlayer(entry.name) !== normalizedPlayer(starter))
    .filter((entry) => !unavailable.has(normalizedPlayer(entry.name)))
    .filter((entry) => {
      const status = strongestStatus(
        normalizedStatus(entry.injuryStatus),
        reportStatuses.get(normalizedPlayer(entry.name)) ?? "",
      );
      return status !== "out" && status !== "doubtful";
    })
    .sort((first, second) => (first.depthRank ?? 99) - (second.depthRank ?? 99))[0] ?? null;
  return { ...depth, expectedStartingQuarterback: replacement, starterStatus: replacement ? "projected" : "unknown" };
}

function normalizedStatus(value: string | null | undefined): string {
  const status = value?.toLowerCase().trim() ?? "";
  if (status === "o" || ["ir", "out", "inactive", "did not play", "pup", "nfi", "suspend"]
    .some((token) => status.includes(token))) return "out";
  if (status === "d" || status.includes("doubtful")) return "doubtful";
  if (status === "q" || status.includes("questionable")) return "questionable";
  return "";
}

function strongestStatus(first: string, second: string): string {
  const severity = (status: string) => status === "out" ? 1 : status === "doubtful" ? 0.65 : status === "questionable" ? 0.25 : 0;
  return severity(first) >= severity(second) ? first : second;
}

function normalizedPlayer(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizedTeam(value: string): string {
  const team = value.trim().toUpperCase();
  return ({ LAR: "LA", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LA" } as Record<string, string>)[team] ?? team;
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
  const playbookApiKey = process.env.PLAYBOOK_API_KEY?.trim() ?? "audit-only-unavailable";
  const result = await runNflForwardEvidenceWriter({
    client,
    season,
    week,
    runId: `personnel-eligibility-audit-${randomUUID()}`,
    now: now.toISOString(),
    apply: false,
    balldontlieApiKey: requiredEnv("BALLDONTLIE_API_KEY"),
    playbookApiKey,
    playbookAuditOnlySkip: !process.env.PLAYBOOK_API_KEY?.trim(),
    owlsApiKey: process.env.OWLS_INSIGHT_API_KEY?.trim(),
    weatherProvider: null,
    exactProviderCandidate: true,
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
  const scoreChanges: Array<Record<string, unknown>> = [];
  for (const game of candidateFixture.snapshot.games) {
    const baseline = baselineByGame.get(game.id);
    if (!baseline) {
      changes.push({ game: game.id, kind: "added_game" });
      continue;
    }
    const previousScore = baseline.footballProjection ?? baseline.projected;
    const candidateScore = game.footballProjection ?? game.projected;
    const previousAway = "expectedAwayPoints" in previousScore ? previousScore.expectedAwayPoints : previousScore.away;
    const previousHome = "expectedHomePoints" in previousScore ? previousScore.expectedHomePoints : previousScore.home;
    const candidateAway = "expectedAwayPoints" in candidateScore ? candidateScore.expectedAwayPoints : candidateScore.away;
    const candidateHome = "expectedHomePoints" in candidateScore ? candidateScore.expectedHomePoints : candidateScore.home;
    if (!sameNumber(previousAway, candidateAway) || !sameNumber(previousHome, candidateHome)) {
      scoreChanges.push({
        game: `${game.awayTeam}@${game.homeTeam}`,
        previous: { away: previousAway, home: previousHome },
        candidate: { away: candidateAway, home: candidateHome },
      });
    }
    for (const [market, candidate] of marketRows(game)) {
      const previous = market === "moneyline"
        ? baseline.markets.moneyline
        : market === "spread"
          ? baseline.markets.first_inning
          : baseline.markets.total;
      if (candidate.pick === previous.pick && sameNumber(candidate.modelProb, previous.modelProb) &&
          candidate.verdict?.label === previous.verdict?.label && candidate.held === previous.held) continue;
      changes.push({
        game: `${game.awayTeam}@${game.homeTeam}`,
        market,
        previous: { pick: previous.pick, probability: previous.modelProb, grade: previous.verdict?.label, held: previous.held },
        candidate: { pick: candidate.pick, probability: candidate.modelProb, grade: candidate.verdict?.label, held: candidate.held },
      });
    }
  }
  const actionable = (grade: string | undefined) => grade === "Lean" || grade === "Best Angle";
  const actionablePromotions = changes.filter((change) => {
    const previous = change.previous as { grade?: string };
    const candidate = change.candidate as { grade?: string };
    return !actionable(previous.grade) && actionable(candidate.grade);
  }).length;
  const actionableDemotions = changes.filter((change) => {
    const previous = change.previous as { grade?: string };
    const candidate = change.candidate as { grade?: string };
    return actionable(previous.grade) && !actionable(candidate.grade);
  }).length;
  const availabilityResolutionChanges = candidatePayloads.flatMap((payload) => {
    const provider = payload.providerStartersAndDepth ?? payload.startersAndDepth;
    return (["away", "home"] as const).flatMap((side) => {
      const legacy = legacyAvailabilityAdjustedDepth(provider[side], payload.injuries);
      const previous = legacy.expectedStartingQuarterback?.name ?? null;
      const candidate = payload.startersAndDepth[side].expectedStartingQuarterback?.name ?? null;
      return previous === candidate ? [] : [{
        game: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
        side,
        previous,
        candidate,
      }];
    });
  });
  console.log(JSON.stringify({
    readOnly: true,
    writes: 0,
    season,
    week,
    baseline: summarize(baselineFixture.snapshot.games),
    candidate: summarize(candidateFixture.snapshot.games),
    boardImpact: {
      actionablePromotions,
      actionableDemotions,
      scoreChanges: scoreChanges.length,
      changedMarkets: changes.length,
      availabilityResolutionChanges,
    },
    candidateWriter: result,
    blockingEvidence: candidatePayloads.flatMap((payload) => payload.decisions.evaluatedBets.length === 0
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
    scoreChangeRows: scoreChanges,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
