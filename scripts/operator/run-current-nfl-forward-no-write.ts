#!/usr/bin/env tsx

/** Executes the current NFL forward writer against live inputs without database writes. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runNflForwardEvidenceWriter } from "../../lib/services/football/nflForwardEvidenceWriter";
import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";
import { resolveNflForwardWeek } from "../../lib/services/football/nflForwardWeekSelection";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const ahead = Number(process.argv.find((arg) => arg.startsWith("--ahead-minutes="))?.slice(16) ?? 0);
  if (!Number.isInteger(ahead) || ahead < 0 || ahead > 60) {
    throw new Error("--ahead-minutes must be an integer from 0 through 60 for read-only cadence rehearsal.");
  }
  const now = new Date(Date.now() + ahead * 60_000);
  const season = 2026;
  const week = resolveNflForwardWeek({ season, configuredWeek: 1, now });
  const client = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const auditRows: Array<Record<string, unknown>> = [];
  const jointImpactRows: Array<Record<string, unknown>> = [];
  const playbookApiKey = process.env.PLAYBOOK_API_KEY?.trim();
  const result = await runNflForwardEvidenceWriter({
    client,
    season,
    week,
    runId: `readonly-rollover-${now.toISOString()}`,
    now: now.toISOString(),
    apply: false,
    balldontlieApiKey: requiredEnv("BALLDONTLIE_API_KEY"),
    playbookApiKey: playbookApiKey || "read_only_cached_playbook_audit",
    playbookAuditOnlySkip: !playbookApiKey,
    exactProviderCandidate: true,
    owlsApiKey: requiredEnv("OWLS_INSIGHT_API_KEY"),
    weatherProvider: null,
    auditJointImpact: process.argv.includes("--joint-impact")
      ? (rows) => { jointImpactRows.push(...rows); }
      : undefined,
    auditPayloads: process.argv.includes("--detail") ? (payloads) => {
      for (const payload of payloads) {
        auditRows.push({
          providerGameId: payload.game.providerGameId,
          game: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
          stage: payload.stage,
          comparableBooks: payload.market.comparableCurrentBooks.map((book) => book.sportsbook),
          contextBooks: Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => [
            market,
            payload.contextualEvidenceCapture?.markets[market].families.map((family) => family[0]) ?? [],
          ])),
          score: [payload.outcomeForecast.expectedAwayScore, payload.outcomeForecast.expectedHomeScore],
          marketRead: payload.fullGameEvidenceInterpretation && {
            status: payload.fullGameEvidenceInterpretation.status,
            sideStory: payload.fullGameEvidenceInterpretation.sideStory,
            totalStory: payload.fullGameEvidenceInterpretation.totalStory,
            accounting: payload.fullGameEvidenceInterpretation.interpretationAccounting,
            roles: payload.fullGameEvidenceInterpretation.signalInterpretations.reduce<Record<string, number>>(
              (counts, item) => {
                for (const role of item.roles) counts[role] = (counts[role] ?? 0) + 1;
                return counts;
              }, {}),
          },
          decisions: payload.decisions.evaluatedBets.map((bet) => ({
            market: bet.market, side: bet.side, grade: bet.grade,
          })),
        });
      }
    } : undefined,
  });
  const storedRows = process.argv.includes("--compare-stored")
    ? await readNflForwardEvidence({ client, season, week })
    : [];
  const latestStored = new Map<string, (typeof storedRows)[number]>();
  for (const row of storedRows) {
    const previous = latestStored.get(row.providerGameId);
    if (!previous || Date.parse(row.capturedAt) > Date.parse(previous.capturedAt)) {
      latestStored.set(row.providerGameId, row);
    }
  }
  const storedComparison = auditRows.map((candidate) => {
    const stored = latestStored.get(String(candidate.providerGameId));
    const payload = stored?.payload;
    return {
      providerGameId: candidate.providerGameId,
      game: candidate.game,
      storedAt: stored?.capturedAt ?? null,
      storedRelease: payload && "fullGameEvidenceInterpretation" in payload
        ? payload.fullGameEvidenceInterpretation?.runtimeRelease ?? null
        : null,
      storedScore: payload && "outcomeForecast" in payload
        ? [payload.outcomeForecast.expectedAwayScore, payload.outcomeForecast.expectedHomeScore]
        : null,
      candidateScore: candidate.score,
      storedDecisions: payload && "decisions" in payload
        ? payload.decisions.evaluatedBets.map((bet) => ({ market: bet.market, side: bet.side, grade: bet.grade }))
        : null,
      candidateDecisions: candidate.decisions,
    };
  });
  console.log(JSON.stringify({ readOnly: true, aheadMinutes: ahead, season, week,
    playbookSource: playbookApiKey ? "live_provider" : "stored_timestamped_fallback",
    result,
    ...(process.argv.includes("--detail") ? { auditRows } : {}),
    ...(process.argv.includes("--compare-stored") ? { storedComparison } : {}),
    ...(process.argv.includes("--joint-impact") ? { jointImpactRows } : {}),
  }, null, 2));
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
