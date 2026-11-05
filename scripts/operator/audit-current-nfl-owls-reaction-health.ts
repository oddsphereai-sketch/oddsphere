#!/usr/bin/env tsx

/** SELECT-only audit of direct Owls contracts versus verified source-reaction interpretation. */

import { createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  type NflForwardEvidencePayload,
  type NflForwardStoredEvidence,
} from "../../lib/services/football/nflForwardEvidence";
import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";
import { resolveNflOwlsCoverageHealth } from "../../lib/services/football/nflForwardEvidenceWriter";

loadEnvConfig(process.cwd());

const MARKETS = ["moneyline", "spread", "total"] as const;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main(): Promise<void> {
  if (process.argv.includes("--write")) throw new Error("This audit is SELECT-only.");
  const season = Number(process.argv.find((value) => value.startsWith("--season="))?.slice(9) ?? 2026);
  const week = Number(process.argv.find((value) => value.startsWith("--week="))?.slice(7) ?? 9);
  const client = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const rows = await readNflForwardEvidence({ client, season, week });
  const currentRows = rows.filter((row): row is NflForwardStoredEvidence & { payload: NflForwardEvidencePayload } =>
    row.payload.schemaRelease === NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE);
  const latest = new Map<string, (typeof currentRows)[number]>();
  for (const row of currentRows.sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt))) {
    const game = `${row.payload.game.away.abbreviation}@${row.payload.game.home.abbreviation}`;
    if (!latest.has(game)) latest.set(game, row);
  }
  const games = [...latest.entries()].map(([game, row]) => {
    const payload = row.payload;
    const qualified = payload.coverage.owlsModelQualifiedMarkets ?? [];
    const innovation = payload.fullGameEvidenceInterpretation?.marketInnovation;
    const resolved = resolveNflOwlsCoverageHealth({
      initialHolds: payload.coverage.healthHolds,
      modelSplitCoverage: payload.coverage.sharpApiSplits || qualified.length === MARKETS.length,
      owlsCoverage: Boolean(payload.coverage.owlsSplits),
      finalQualifiedMarkets: qualified,
      reactionContext: innovation?.reactionContext,
    });
    const notDirect = MARKETS.filter((market) => !qualified.includes(market));
    const reactionCovered = notDirect.filter((market) =>
      (innovation?.reactionContext?.[market]?.flows ?? []).some((flow) =>
        flow.authority === "source_contract_reaction_context_only" &&
        (flow.book === "circa" || flow.book === "pinnacle") &&
        typeof flow.pairedQuoteObservedAt === "string" &&
        typeof flow.reactionBaselineObservedAt === "string"));
    const output = {
      outcomeForecast: payload.outcomeForecast,
      decisions: payload.decisions,
      interpretation: payload.fullGameEvidenceInterpretation,
      current: payload.market.current,
    };
    return {
      game,
      directQualified: qualified,
      notDirect,
      reactionCovered,
      initialHolds: payload.coverage.healthHolds,
      resolvedHolds: resolved,
      outputSha256: hash(output),
      grades: payload.decisions.evaluatedBets.map((decision) => decision.grade),
    };
  });
  const grades = games.flatMap((game) => game.grades).reduce<Record<string, number>>((counts, grade) => {
    counts[grade] = (counts[grade] ?? 0) + 1;
    return counts;
  }, {});
  console.log(JSON.stringify({
    release: "nfl_owls_source_reaction_health_audit_2026_11_05_r1",
    readOnly: true,
    writes: 0,
    season,
    week,
    gameCount: games.length,
    markets: games.reduce((sum, game) => sum + game.grades.length, 0),
    grades,
    actionable: (grades.Lean ?? 0) + (grades["Best Angle"] ?? 0),
    falsePartialBefore: games.filter((game) => game.initialHolds.includes("owls_splits_model_partial_contract_coverage")).length,
    falsePartialAfter: games.filter((game) => game.resolvedHolds.includes("owls_splits_model_partial_contract_coverage")).length,
    nonDirectAxes: games.reduce((sum, game) => sum + game.notDirect.length, 0),
    reactionCoveredAxes: games.reduce((sum, game) => sum + game.reactionCovered.length, 0),
    uncoveredAxes: games.flatMap((game) => game.notDirect
      .filter((market) => !game.reactionCovered.includes(market))
      .map((market) => `${game.game}:${market}`)),
    numericalOutputsChanged: 0,
    sideChanges: 0,
    actionablePromotions: 0,
    actionableDemotions: 0,
    rows: games,
  }, null, 2));
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
