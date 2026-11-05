#!/usr/bin/env tsx

/**
 * One provider/DB capture, two in-memory reader implementations, zero writes.
 * The incumbent modules are loaded from an explicit clean worktree at the
 * immutable predecessor commit; production never imports them.
 */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  runCfbForwardEvidenceWriter,
  type CfbCausalReaderAuditImplementation,
  type CfbCausalReaderSameInputComparison,
} from "../../lib/services/football/cfbForwardEvidenceWriter";
import type { CfbV1ExactPriceDecision, CfbV1Grade, CfbV1Market } from "../../lib/services/football/cfbV1Decision";

loadEnvConfig(process.cwd());

const MARKETS: CfbV1Market[] = ["moneyline", "spread", "total"];
const ACTIONABLE = new Set<CfbV1Grade>(["Best Angle", "Lean"]);

type DynamicModule = Record<string, unknown>;

async function importModule(root: string, relativePath: string): Promise<DynamicModule> {
  return import(pathToFileURL(path.join(root, relativePath)).href) as Promise<DynamicModule>;
}

function decisionFor(rows: CfbV1ExactPriceDecision[], market: CfbV1Market): CfbV1ExactPriceDecision | null {
  return rows.find((row) => row.market === market) ?? null;
}

function disposition(decision: CfbV1ExactPriceDecision | null): string {
  if (!decision) return "missing";
  if (decision.market === "moneyline") return decision.evaluatedQuote.price < 0 ? "favorite" : "underdog";
  if (decision.market === "spread") return decision.evaluatedQuote.line === null
    ? "unknown"
    : decision.evaluatedQuote.line < 0
      ? "favorite"
      : decision.evaluatedQuote.line > 0
        ? "underdog"
        : "pickem";
  return /^over\b/i.test(decision.side) ? "over" : "under";
}

function isActionable(decision: CfbV1ExactPriceDecision | null): boolean {
  return decision !== null && ACTIONABLE.has(decision.grade);
}

function heldReason(comparison: CfbCausalReaderSameInputComparison, lane: "incumbent" | "candidate", market: CfbV1Market): string[] {
  return comparison[lane].heldMarkets.find((row) => row.market === market)?.reasonCodes ?? [];
}

async function main(): Promise<void> {
  const incumbentRoot = process.argv.find((value) => value.startsWith("--incumbent-root="))?.slice(17);
  const output = process.argv.find((value) => value.startsWith("--output="))?.slice(9);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const balldontlieApiKey = process.env.BALLDONTLIE_API_KEY;
  const owlsApiKey = process.env.OWLS_INSIGHT_API_KEY;
  if (!incumbentRoot || !output || !url || !serviceKey || !balldontlieApiKey || !owlsApiKey) {
    throw new Error("Explicit --incumbent-root, --output, Supabase, BALLDONTLIE and Owls credentials are required.");
  }
  const shadow = await importModule(incumbentRoot, "lib/services/football/cfbMarketSharpAwareShadow.ts");
  const complete = await importModule(incumbentRoot, "lib/services/football/cfbCompleteMarketReader.ts");
  const incumbent: CfbCausalReaderAuditImplementation = {
    label: "4fcc4129ce17fa5e7ed2b848e1f123b1ab8d5766:R41/R7",
    modelSharpSplits: (rows) => rows.filter((row) => row.provider !== "owls"),
    buildMarketForecast: shadow.buildCfbMarketSharpAwareForecast as CfbCausalReaderAuditImplementation["buildMarketForecast"],
    applyCompleteReader: complete.applyCfbCompleteMarketReader as CfbCausalReaderAuditImplementation["applyCompleteReader"],
    applyMarketGrades: shadow.applyCfbMarketSharpAwareGrades as CfbCausalReaderAuditImplementation["applyMarketGrades"],
  };
  const comparisons: CfbCausalReaderSameInputComparison[] = [];
  const now = new Date().toISOString();
  const result = await runCfbForwardEvidenceWriter({
    client: createClient(url, serviceKey, { auth: { persistSession: false } }),
    season: 2026,
    runId: `audit-${randomUUID()}`,
    now,
    apply: false,
    balldontlieApiKey,
    playbookApiKey: process.env.PLAYBOOK_API_KEY ?? "audit-provider-unavailable",
    owlsApiKey,
    collegeFootballDataApiKey: process.env.CFBD_API_KEY ?? null,
    // This comparison explicitly consumes zero paid Odds API credits.
    theOddsApiKey: null,
    sportsDataIoApiKey: process.env.SPORTSDATAIO_CFB_API_KEY ?? null,
    weatherProvider: null,
    auditForceUnlocked: true,
    auditIncumbentCausalReader: incumbent,
    auditCausalReaderComparison: (comparison) => comparisons.push(comparison),
  });
  if (comparisons.length === 0) throw new Error("Same-input CFB replay produced no comparisons.");

  let promotions = 0;
  let demotions = 0;
  let removals = 0;
  let additions = 0;
  let sideChanges = 0;
  let scoreChanges = 0;
  let probabilityChanges = 0;
  let gradeChanges = 0;
  let favoriteUnderdogChanges = 0;
  let totalDirectionChanges = 0;
  let incumbentActionables = 0;
  let candidateActionables = 0;
  const rows = comparisons.flatMap((comparison) => {
    const incumbentForecast = comparison.incumbent.forecast;
    const candidateForecast = comparison.candidate.forecast;
    const scoreChanged = JSON.stringify({
      away: incumbentForecast.expectedAwayPoints,
      home: incumbentForecast.expectedHomePoints,
      representative: incumbentForecast.representativeScore,
    }) !== JSON.stringify({
      away: candidateForecast.expectedAwayPoints,
      home: candidateForecast.expectedHomePoints,
      representative: candidateForecast.representativeScore,
    });
    if (scoreChanged) scoreChanges += 1;
    return MARKETS.map((market) => {
      const oldDecision = decisionFor(comparison.incumbent.evaluatedBets, market);
      const nextDecision = decisionFor(comparison.candidate.evaluatedBets, market);
      const oldActionable = isActionable(oldDecision);
      const nextActionable = isActionable(nextDecision);
      incumbentActionables += oldActionable ? 1 : 0;
      candidateActionables += nextActionable ? 1 : 0;
      if (!oldActionable && nextActionable) promotions += 1;
      if (oldActionable && !nextActionable) demotions += 1;
      if (oldDecision && !nextDecision) removals += 1;
      if (!oldDecision && nextDecision) additions += 1;
      const sideChanged = oldDecision?.side !== nextDecision?.side;
      const probabilityChanged = oldDecision?.modelProbability !== nextDecision?.modelProbability;
      const gradeChanged = oldDecision?.grade !== nextDecision?.grade;
      const oldDisposition = disposition(oldDecision);
      const nextDisposition = disposition(nextDecision);
      if (sideChanged) sideChanges += 1;
      if (probabilityChanged) probabilityChanges += 1;
      if (gradeChanged) gradeChanges += 1;
      if (market !== "total" && oldDisposition !== nextDisposition) favoriteUnderdogChanges += 1;
      if (market === "total" && oldDisposition !== nextDisposition) totalDirectionChanges += 1;
      return {
        providerGameId: comparison.providerGameId,
        matchup: `${candidateForecast.awayTeam}@${candidateForecast.homeTeam}`,
        inputSha256: comparison.inputSha256,
        market,
        scoreChanged,
        incumbentScore: {
          expectedAway: incumbentForecast.expectedAwayPoints,
          expectedHome: incumbentForecast.expectedHomePoints,
          representative: incumbentForecast.representativeScore,
        },
        candidateScore: {
          expectedAway: candidateForecast.expectedAwayPoints,
          expectedHome: candidateForecast.expectedHomePoints,
          representative: candidateForecast.representativeScore,
        },
        incumbent: oldDecision ? {
          side: oldDecision.side,
          disposition: oldDisposition,
          probability: oldDecision.modelProbability,
          grade: oldDecision.grade,
          actionable: oldActionable,
          line: oldDecision.evaluatedQuote.line,
          price: oldDecision.evaluatedQuote.price,
          sportsbook: oldDecision.evaluatedQuote.sportsbook,
        } : { held: heldReason(comparison, "incumbent", market) },
        candidate: nextDecision ? {
          side: nextDecision.side,
          disposition: nextDisposition,
          probability: nextDecision.modelProbability,
          grade: nextDecision.grade,
          actionable: nextActionable,
          line: nextDecision.evaluatedQuote.line,
          price: nextDecision.evaluatedQuote.price,
          sportsbook: nextDecision.evaluatedQuote.sportsbook,
        } : { held: heldReason(comparison, "candidate", market) },
        changes: {
          side: sideChanged,
          probability: probabilityChanged,
          grade: gradeChanged,
          disposition: oldDisposition !== nextDisposition,
          promotion: !oldActionable && nextActionable,
          demotion: oldActionable && !nextActionable,
          removal: oldDecision !== null && nextDecision === null,
          addition: oldDecision === null && nextDecision !== null,
        },
      };
    });
  });
  const grades = (lane: "incumbent" | "candidate") => Object.fromEntries(
    ["Best Angle", "Lean", "Watchlist", "No Play"].map((grade) => [grade,
      comparisons.reduce((sum, comparison) => sum + comparison[lane].evaluatedBets.filter((decision) => decision.grade === grade).length, 0)]),
  );
  const report = {
    audit: "cfb_causal_relative_innovation_same_frozen_input_2026_11_04_r1",
    now,
    apply: false,
    writes: 0,
    paidOddsApiCalls: 0,
    incumbentCommit: "4fcc4129ce17fa5e7ed2b848e1f123b1ab8d5766",
    candidateRelease: comparisons[0]!.candidateLabel,
    games: comparisons.length,
    markets: rows.length,
    counts: {
      incumbentGrades: grades("incumbent"),
      candidateGrades: grades("candidate"),
      incumbentActionables,
      candidateActionables,
      promotions,
      demotions,
      removals,
      additions,
      sideChanges,
      scoreChanges,
      probabilityChanges,
      gradeChanges,
      favoriteUnderdogChanges,
      totalDirectionChanges,
      incumbentHeld: comparisons.reduce((sum, comparison) => sum + comparison.incumbent.heldMarkets.length, 0),
      candidateHeld: comparisons.reduce((sum, comparison) => sum + comparison.candidate.heldMarkets.length, 0),
    },
    rows,
    writerResult: result,
    safeguards: [
      "One writer capture; each game input is structured-cloned, recursively frozen and SHA-256 stamped before both evaluations.",
      "Candidate replay must be byte-identical to the authoritative writer bundle or the audit throws.",
      "The incumbent implementation is loaded only by this operator from the explicit immutable predecessor worktree.",
      "No database writes and THE_ODDS_API_KEY is not passed.",
    ],
  };
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
